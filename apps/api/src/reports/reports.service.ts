import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotFound } from '../common/app-exception.js';
import { PrismaService } from '../prisma/prisma.module.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { amountPaise, major, toPaise } from '../common/money.js';
import { AccountingService } from '../accounting/accounting.service.js';

const IST_MS = 330 * 60 * 1000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const range = (from?: string, to?: string): Prisma.DateTimeFilter | undefined =>
  from || to
    ? {
        ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}),
      }
    : undefined;

const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
const bucketOf = (days: number) => (days <= 0 ? 'CURRENT' : days <= 30 ? 'D1_30' : days <= 60 ? 'D31_60' : days <= 90 ? 'D61_90' : 'D90_PLUS');

/**
 * Reporting center (spec §21): server-side aggregation over real data with
 * tenant scoping; money in integer paise, serialized as decimal strings.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  async salesSummary(request: TenantRequest, from?: string, to?: string) {
    const orgId = request.tenantContext.organizationId;
    const invoiceDate = range(from, to);
    const [invoices, returns, pnl] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, ...(invoiceDate ? { invoiceDate } : {}) },
        include: { lines: true, payments: { orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.salesReturn.findMany({
        where: { organizationId: orgId, ...(invoiceDate ? { createdAt: invoiceDate } : {}) },
        include: { lines: { include: { invoiceLine: { select: { productId: true, quantity: true, costOfGoods: true } } } } },
      }),
      this.accounting.profitAndLoss(request, from, to),
    ]);
    let revenue = 0n;
    let taxable = 0n;
    let tax = 0n;
    let discount = 0n;
    const byDay = new Map<string, { invoices: number; revenue: bigint }>();
    const byProduct = new Map<string, { product: string; quantity: number; revenue: bigint; cost: bigint }>();
    const byPayment = new Map<string, bigint>();
    for (const inv of invoices) {
      const total = toPaise(inv.total);
      revenue += total;
      taxable += toPaise(inv.taxableValue);
      tax += toPaise(inv.cgstAmount) + toPaise(inv.sgstAmount) + toPaise(inv.igstAmount) + toPaise(inv.cessAmount);
      discount += toPaise(inv.discountAmount);
      const day = byDay.get(istDay(inv.invoiceDate)) ?? { invoices: 0, revenue: 0n };
      day.invoices += 1;
      day.revenue += total;
      byDay.set(istDay(inv.invoiceDate), day);
      for (const l of inv.lines) {
        const p = byProduct.get(l.productId) ?? { product: l.productName, quantity: 0, revenue: 0n, cost: 0n };
        p.quantity += Number(l.quantity);
        p.revenue += toPaise(l.taxableValue);
        p.cost += toPaise(l.costOfGoods);
        byProduct.set(l.productId, p);
      }
      // Tenders at the counter sum exactly to the bill; anything after that is a later collection.
      let tendered = 0n;
      for (const pay of inv.payments) {
        if (tendered >= total) break;
        const amount = toPaise(pay.amount);
        tendered += amount;
        byPayment.set(pay.method, (byPayment.get(pay.method) ?? 0n) + amount);
      }
    }
    for (const r of returns) {
      for (const l of r.lines) {
        const p = byProduct.get(l.invoiceLine.productId);
        if (!p) continue;
        p.quantity -= Number(l.quantity);
        p.revenue -= toPaise(l.taxableValue);
        const soldQty = Number(l.invoiceLine.quantity);
        if (l.restock && soldQty > 0) p.cost -= (toPaise(l.invoiceLine.costOfGoods) * BigInt(Math.round(Number(l.quantity) * 1000))) / BigInt(Math.round(soldQty * 1000));
      }
    }
    const returnsValue = returns.reduce((s, r) => s + toPaise(r.refundTotal), 0n);
    return {
      period: { from: from ?? null, to: to ?? null },
      totals: {
        invoices: invoices.length,
        revenue: major(revenue),
        taxable: major(taxable),
        tax: major(tax),
        discount: major(discount),
        // Net sales (before GST, after returns), cost of goods and margin come from the books so they match Accounting.
        netSales: pnl.netSales,
        costOfGoods: major(toPaise(pnl.netSales) - toPaise(pnl.grossProfit)),
        grossMargin: pnl.grossProfit,
        returns: returns.length,
        returnsValue: major(returnsValue),
        netRevenue: major(revenue - returnsValue),
        averageBill: invoices.length > 0 ? major(revenue / BigInt(invoices.length)) : '0.00',
      },
      byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, invoices: d.invoices, revenue: major(d.revenue) })),
      byProduct: [...byProduct.entries()]
        .sort(([, a], [, b]) => (b.revenue > a.revenue ? 1 : b.revenue < a.revenue ? -1 : 0))
        .slice(0, 50)
        .map(([productId, p]) => ({ productId, product: p.product, quantity: p.quantity, revenue: major(p.revenue), margin: major(p.revenue - p.cost) })),
      byPayment: [...byPayment.entries()].map(([method, amount]) => ({ method, amount: major(amount) })),
    };
  }

  /** Batch-wise stock valuation at carrying cost, reconciled to the Inventory GL account. */
  /**
   * Dead and slow-moving stock: products on hand with no sale in `days`
   * (dead, if stocked before the window) or more than 180 days of cover at
   * the current sales rate (slow). Ranked by value locked up at cost.
   */
  async deadStock(request: TenantRequest, params: { days: number; warehouseId?: string }) {
    const orgId = request.tenantContext.organizationId;
    const cutoff = new Date(Date.now() - params.days * 86_400_000);
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId: orgId, quantity: { gt: 0 }, ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}) },
      include: { batch: { select: { id: true, productId: true, purchaseRate: true, mrp: true, expiryDate: true, createdAt: true, product: { select: { name: true, sku: true, rackLocation: true } } } } },
    });
    const batchIds = [...new Set(balances.map((b) => b.batchId))];
    const productOf = new Map(balances.map((b) => [b.batchId, b.batch.productId]));
    const allBatches = batchIds.length
      ? await this.prisma.inventoryBatch.findMany({ where: { organizationId: orgId, productId: { in: [...new Set(balances.map((b) => b.batch.productId))] } }, select: { id: true, productId: true } })
      : [];
    for (const b of allBatches) productOf.set(b.id, b.productId);
    const saleWhere = { organizationId: orgId, movementType: 'SALE' as const, batchId: { in: allBatches.map((b) => b.id) }, ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}) };
    const [lastSales, windowSales] = allBatches.length
      ? await Promise.all([
          this.prisma.inventoryMovement.groupBy({ by: ['batchId'], where: saleWhere, _max: { createdAt: true } }),
          this.prisma.inventoryMovement.groupBy({ by: ['batchId'], where: { ...saleWhere, createdAt: { gte: cutoff } }, _sum: { quantity: true } }),
        ])
      : [[], []];

    type Row = { productId: string; name: string; sku: string; rackLocation: string | null; onHand: number; value: bigint; mrpValue: bigint; nearestExpiry: Date | null; firstStocked: Date; soldQty: number; lastSoldAt: Date | null };
    const byProduct = new Map<string, Row>();
    for (const b of balances) {
      const qty = b.quantity.toFixed(3);
      const r = byProduct.get(b.batch.productId) ?? {
        productId: b.batch.productId,
        name: b.batch.product.name,
        sku: b.batch.product.sku,
        rackLocation: b.batch.product.rackLocation,
        onHand: 0,
        value: 0n,
        mrpValue: 0n,
        nearestExpiry: null,
        firstStocked: b.batch.createdAt,
        soldQty: 0,
        lastSoldAt: null,
      };
      r.onHand += Number(qty);
      r.value += amountPaise(b.batch.purchaseRate, qty);
      r.mrpValue += amountPaise(b.batch.mrp, qty);
      if (!r.nearestExpiry || b.batch.expiryDate < r.nearestExpiry) r.nearestExpiry = b.batch.expiryDate;
      if (b.batch.createdAt < r.firstStocked) r.firstStocked = b.batch.createdAt;
      byProduct.set(b.batch.productId, r);
    }
    for (const s of lastSales) {
      const r = byProduct.get(productOf.get(s.batchId) ?? '');
      if (r && s._max.createdAt && (!r.lastSoldAt || s._max.createdAt > r.lastSoldAt)) r.lastSoldAt = s._max.createdAt;
    }
    for (const s of windowSales) {
      const r = byProduct.get(productOf.get(s.batchId) ?? '');
      if (r) r.soldQty += Math.abs(Number(s._sum.quantity ?? 0));
    }

    const now = Date.now();
    const items = [...byProduct.values()]
      .map((r) => {
        const daily = r.soldQty / params.days;
        const coverDays = daily > 0 ? Math.round(r.onHand / daily) : null;
        const cls = r.soldQty === 0 ? (r.firstStocked < cutoff ? 'DEAD' : 'NEW') : coverDays !== null && coverDays > 180 ? 'SLOW' : 'MOVING';
        return {
          productId: r.productId,
          name: r.name,
          sku: r.sku,
          rackLocation: r.rackLocation,
          onHand: r.onHand,
          value: major(r.value),
          mrpValue: major(r.mrpValue),
          soldQty: r.soldQty,
          lastSoldAt: r.lastSoldAt,
          daysSinceSale: r.lastSoldAt ? Math.floor((now - r.lastSoldAt.getTime()) / 86_400_000) : null,
          coverDays,
          nearestExpiry: r.nearestExpiry,
          classification: cls,
          valuePaise: r.value,
        };
      })
      .filter((r) => r.classification === 'DEAD' || r.classification === 'SLOW')
      .sort((a, b) => (b.valuePaise > a.valuePaise ? 1 : b.valuePaise < a.valuePaise ? -1 : 0));
    const sum = (cls: string) => items.filter((i) => i.classification === cls).reduce((s, i) => s + i.valuePaise, 0n);
    return {
      days: params.days,
      cutoff,
      summary: {
        deadItems: items.filter((i) => i.classification === 'DEAD').length,
        deadValue: major(sum('DEAD')),
        slowItems: items.filter((i) => i.classification === 'SLOW').length,
        slowValue: major(sum('SLOW')),
      },
      items: items.slice(0, 500).map(({ valuePaise: _v, ...rest }) => rest),
    };
  }

  async stockValuation(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const [balances, invAccount] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { organizationId: orgId, quantity: { gt: 0 } },
        include: { batch: { include: { product: { select: { name: true, sku: true } } } } },
        orderBy: { batch: { expiryDate: 'asc' } },
      }),
      this.prisma.account.findUnique({ where: { organizationId_systemKey: { organizationId: orgId, systemKey: 'INVENTORY' } } }),
    ]);
    const today = Date.now();
    let total = 0n;
    let totalMrp = 0n;
    let expiredValue = 0n;
    let blockedValue = 0n;
    const rows = balances.map((b) => {
      const qty = b.quantity.toFixed(3);
      const value = amountPaise(b.batch.purchaseRate, qty);
      const mrpValue = amountPaise(b.batch.mrp, qty);
      total += value;
      totalMrp += mrpValue;
      const expired = b.batch.expiryDate.getTime() < today;
      if (expired) expiredValue += value;
      if (b.batch.status !== 'SALEABLE') blockedValue += value;
      return {
        batchId: b.batchId,
        product: b.batch.product.name,
        sku: b.batch.product.sku,
        batchNumber: b.batch.batchNumber,
        expiryDate: b.batch.expiryDate,
        status: expired ? 'EXPIRED' : b.batch.status,
        quantity: Number(b.quantity),
        purchaseRate: b.batch.purchaseRate.toFixed(2),
        mrp: b.batch.mrp.toFixed(2),
        value: major(value),
      };
    });
    let book = 0n;
    if (invAccount) {
      const agg = await this.prisma.journalLine.aggregate({ where: { accountId: invAccount.id }, _sum: { debit: true, credit: true } });
      book = (agg._sum.debit ? toPaise(agg._sum.debit) : 0n) - (agg._sum.credit ? toPaise(agg._sum.credit) : 0n);
    }
    return {
      rows,
      totalValue: major(total),
      totalMrp: major(totalMrp),
      expiredValue: major(expiredValue),
      blockedValue: major(blockedValue),
      bookValue: major(book),
      /** Positive = stock received but not yet invoiced (GRN before supplier bill), or free goods. */
      unbookedDifference: major(total - book),
    };
  }

  /** Receivables / payables aging buckets (spec §16, §10). */
  async aging(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const now = Date.now();
    const [receivables, payables] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId, creditAmount: { gt: 0 } },
        include: { customer: { select: { id: true, name: true, creditDays: true } } },
        orderBy: { invoiceDate: 'asc' },
      }),
      this.prisma.purchaseInvoice.findMany({
        where: { organizationId: orgId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } },
        include: { vendor: { select: { id: true, legalName: true } } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);
    const arRows = receivables.map((i) => {
      const due = i.invoiceDate.getTime() + (i.customer?.creditDays ?? 0) * 86_400_000;
      const days = Math.floor((now - due) / 86_400_000);
      return { partyId: i.customer?.id ?? null, party: i.customer?.name ?? 'Walk-in', docId: i.id, doc: i.invoiceNumber, outstanding: toPaise(i.creditAmount), daysOverdue: Math.max(0, days), bucket: bucketOf(days) };
    });
    const apRows = payables
      .map((i) => {
        const days = Math.floor((now - i.dueDate.getTime()) / 86_400_000);
        return { partyId: i.vendor.id, party: i.vendor.legalName, docId: i.id, doc: i.invoiceNumber, outstanding: toPaise(i.total) - toPaise(i.paidAmount), daysOverdue: Math.max(0, days), bucket: bucketOf(days) };
      })
      .filter((r) => r.outstanding > 0n);
    const summarize = (rows: Array<{ bucket: string; outstanding: bigint }>) => {
      const out: Record<string, bigint> = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0n]));
      for (const r of rows) out[r.bucket] = (out[r.bucket] ?? 0n) + r.outstanding;
      return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, major(v)]));
    };
    const fmt = (rows: typeof arRows) => rows.map((r) => ({ ...r, outstanding: major(r.outstanding) }));
    return {
      receivables: { rows: fmt(arRows), buckets: summarize(arRows), total: major(arRows.reduce((s, r) => s + r.outstanding, 0n)) },
      payables: { rows: fmt(apRows), buckets: summarize(apRows), total: major(apRows.reduce((s, r) => s + r.outstanding, 0n)) },
    };
  }

  /** Live dashboard KPIs (today / this month, stock, receivables, payables, alerts). */
  async dashboard(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const todayStr = istDay(new Date());
    const monthStart = `${todayStr.slice(0, 8)}01`;
    const today = range(todayStr, todayStr)!;
    const month = range(monthStart, todayStr)!;
    const in30 = new Date(Date.now() + 30 * 86_400_000);
    const [todayAgg, monthAgg, ar, ap, expiring, expired, products, recent, valuation, openPOs, pendingGrn] = await Promise.all([
      this.prisma.salesInvoice.aggregate({ where: { organizationId: orgId, status: { not: 'CANCELLED' }, invoiceDate: today }, _sum: { total: true }, _count: true }),
      this.prisma.salesInvoice.aggregate({ where: { organizationId: orgId, status: { not: 'CANCELLED' }, invoiceDate: month }, _sum: { total: true }, _count: true }),
      this.prisma.salesInvoice.aggregate({ where: { organizationId: orgId }, _sum: { creditAmount: true } }),
      this.prisma.purchaseInvoice.findMany({ where: { organizationId: orgId, status: { in: ['POSTED', 'PARTIALLY_PAID'] } }, select: { total: true, paidAmount: true } }),
      this.prisma.inventoryBatch.count({ where: { organizationId: orgId, status: 'SALEABLE', expiryDate: { gte: new Date(), lte: in30 }, balances: { some: { quantity: { gt: 0 } } } } }),
      this.prisma.inventoryBatch.count({ where: { organizationId: orgId, expiryDate: { lt: new Date() }, balances: { some: { quantity: { gt: 0 } } } } }),
      this.prisma.product.findMany({ where: { organizationId: orgId, status: 'ACTIVE', reorderLevel: { not: null } }, select: { id: true, reorderLevel: true } }),
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId },
        select: { id: true, invoiceNumber: true, total: true, status: true, invoiceDate: true, walkInName: true, customer: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.inventoryBalance.findMany({ where: { organizationId: orgId, quantity: { gt: 0 } }, select: { quantity: true, batch: { select: { purchaseRate: true } } } }),
      this.prisma.purchaseOrder.count({ where: { organizationId: orgId, status: { in: ['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'] } } }),
      this.prisma.goodsReceipt.count({ where: { organizationId: orgId, invoices: { none: {} } } }),
    ]);
    const in60 = new Date(Date.now() + 60 * 86_400_000);
    const [todayReturns, monthReturns, licences] = await Promise.all([
      this.prisma.salesReturn.aggregate({ where: { organizationId: orgId, createdAt: today }, _sum: { refundTotal: true } }),
      this.prisma.salesReturn.aggregate({ where: { organizationId: orgId, createdAt: month }, _sum: { refundTotal: true } }),
      this.prisma.pharmacyLicence.findMany({
        where: { organizationId: orgId, expiryDate: { lte: in60 } },
        select: { id: true, licenceType: true, licenceNumber: true, expiryDate: true },
        orderBy: { expiryDate: 'asc' },
      }),
    ]);
    const paise = (v: Prisma.Decimal | null | undefined) => (v ? toPaise(v) : 0n);
    let lowStock = 0;
    if (products.length > 0) {
      const onHand = await this.prisma.inventoryBalance.groupBy({
        by: ['batchId'],
        where: { organizationId: orgId, batch: { productId: { in: products.map((p) => p.id) } } },
        _sum: { quantity: true },
      });
      const batches = await this.prisma.inventoryBatch.findMany({ where: { id: { in: onHand.map((o) => o.batchId) } }, select: { id: true, productId: true } });
      const productOf = new Map(batches.map((b) => [b.id, b.productId]));
      const qtyByProduct = new Map<string, number>();
      for (const o of onHand) {
        const pid = productOf.get(o.batchId);
        if (pid) qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + Number(o._sum.quantity ?? 0));
      }
      lowStock = products.filter((p) => (qtyByProduct.get(p.id) ?? 0) <= (p.reorderLevel ?? 0)).length;
    }
    return {
      today: {
        invoices: todayAgg._count,
        revenue: major(paise(todayAgg._sum.total) - paise(todayReturns._sum.refundTotal)),
        returns: major(paise(todayReturns._sum.refundTotal)),
      },
      month: {
        invoices: monthAgg._count,
        revenue: major(paise(monthAgg._sum.total) - paise(monthReturns._sum.refundTotal)),
        returns: major(paise(monthReturns._sum.refundTotal)),
      },
      licences: licences.map((l) => ({
        id: l.id,
        type: l.licenceType,
        number: l.licenceNumber,
        expiryDate: l.expiryDate.toISOString().slice(0, 10),
        daysLeft: Math.ceil((l.expiryDate.getTime() - Date.now()) / 86_400_000),
      })),
      receivables: major(ar._sum.creditAmount ? toPaise(ar._sum.creditAmount) : 0n),
      payables: major(ap.reduce((s, i) => s + toPaise(i.total) - toPaise(i.paidAmount), 0n)),
      stockValue: major(valuation.reduce((s, b) => s + amountPaise(b.batch.purchaseRate, b.quantity.toFixed(3)), 0n)),
      alerts: { expiring30: expiring, expiredOnHand: expired, lowStock, openPurchaseOrders: openPOs, receiptsAwaitingInvoice: pendingGrn },
      recentInvoices: recent.map((r) => ({ ...r, total: r.total.toFixed(2), party: r.customer?.name ?? r.walkInName ?? 'Walk-in' })),
    };
  }

  /** Daily net sales for the last `days` IST days (zero-filled) plus the month's best sellers. */
  async dashboardTrend(request: TenantRequest, days = 14) {
    const orgId = request.tenantContext.organizationId;
    const todayStr = istDay(new Date());
    const start = new Date(new Date(`${todayStr}T00:00:00+05:30`).getTime() - (days - 1) * 86_400_000);
    const monthStart = new Date(`${todayStr.slice(0, 8)}01T00:00:00+05:30`);
    const [invoices, top] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, invoiceDate: { gte: start } },
        select: { invoiceDate: true, total: true },
      }),
      this.prisma.salesInvoiceLine.groupBy({
        by: ['productId', 'productName'],
        where: { invoice: { organizationId: orgId, status: { not: 'CANCELLED' }, invoiceDate: { gte: monthStart } } },
        _sum: { lineTotal: true, quantity: true },
        orderBy: { _sum: { lineTotal: 'desc' } },
        take: 5,
      }),
    ]);
    const byDay = new Map<string, { invoices: number; revenue: bigint }>();
    for (let i = 0; i < days; i++) byDay.set(istDay(new Date(start.getTime() + i * 86_400_000)), { invoices: 0, revenue: 0n });
    for (const inv of invoices) {
      const d = byDay.get(istDay(inv.invoiceDate));
      if (!d) continue;
      d.invoices += 1;
      d.revenue += toPaise(inv.total);
    }
    return {
      days: [...byDay.entries()].map(([date, d]) => ({ date, invoices: d.invoices, revenue: major(d.revenue) })),
      topProducts: top.map((t) => ({
        productId: t.productId,
        product: t.productName,
        quantity: Number(t._sum.quantity ?? 0),
        revenue: major(t._sum.lineTotal ? toPaise(t._sum.lineTotal) : 0n),
      })),
    };
  }

  /** Counter tenders by method (what the till collected), plus credit extended. */
  async paymentMix(request: TenantRequest, from?: string, to?: string) {
    const orgId = request.tenantContext.organizationId;
    const invoiceDate = range(from, to);
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { organizationId: orgId, status: { not: 'CANCELLED' }, ...(invoiceDate ? { invoiceDate } : {}) },
      select: { total: true, payments: { orderBy: { createdAt: 'asc' }, select: { method: true, amount: true } } },
    });
    const mix = new Map<string, { amount: bigint; count: number }>();
    let grand = 0n;
    for (const inv of invoices) {
      const total = toPaise(inv.total);
      let tendered = 0n;
      for (const p of inv.payments) {
        if (tendered >= total) break;
        const amt = toPaise(p.amount);
        tendered += amt;
        grand += amt;
        const row = mix.get(p.method) ?? { amount: 0n, count: 0 };
        row.amount += amt;
        row.count += 1;
        mix.set(p.method, row);
      }
    }
    return {
      period: { from: from ?? null, to: to ?? null },
      total: major(grand),
      methods: [...mix.entries()]
        .sort(([, a], [, b]) => (b.amount > a.amount ? 1 : -1))
        .map(([method, r]) => ({
          method,
          amount: major(r.amount),
          count: r.count,
          share: grand > 0n ? Number((r.amount * 10_000n) / grand) / 100 : 0,
        })),
    };
  }

  /** Stock value at risk by days-to-expiry bucket, at cost and at MRP. */
  async expiryValue(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId: orgId, quantity: { gt: 0 } },
      select: { quantity: true, batchId: true, batch: { select: { expiryDate: true, purchaseRate: true, mrp: true } } },
    });
    const BUCKETS = [
      { key: 'EXPIRED', label: 'Expired', max: 0 },
      { key: 'D0_30', label: '0–30 days', max: 30 },
      { key: 'D31_60', label: '31–60 days', max: 60 },
      { key: 'D61_90', label: '61–90 days', max: 90 },
      { key: 'D91_180', label: '91–180 days', max: 180 },
    ] as const;
    const acc = new Map<string, { batches: Set<string>; quantity: number; cost: bigint; mrp: bigint }>(
      BUCKETS.map((b) => [b.key, { batches: new Set<string>(), quantity: 0, cost: 0n, mrp: 0n }]),
    );
    const now = Date.now();
    for (const b of balances) {
      const days = Math.ceil((b.batch.expiryDate.getTime() - now) / 86_400_000);
      const bucket = days < 0 ? BUCKETS[0] : BUCKETS.slice(1).find((x) => days <= x.max);
      if (!bucket) continue;
      const row = acc.get(bucket.key)!;
      const qty = b.quantity.toFixed(3);
      row.batches.add(b.batchId);
      row.quantity += Number(b.quantity);
      row.cost += amountPaise(b.batch.purchaseRate, qty);
      row.mrp += amountPaise(b.batch.mrp, qty);
    }
    const rows = BUCKETS.map((b) => {
      const r = acc.get(b.key)!;
      return { key: b.key, label: b.label, batches: r.batches.size, quantity: r.quantity, costValue: major(r.cost), mrpValue: major(r.mrp) };
    });
    const sum = (k: 'cost' | 'mrp') => major([...acc.values()].reduce((s, r) => s + r[k], 0n));
    return { buckets: rows, totalCost: sum('cost'), totalMrp: sum('mrp') };
  }

  // ── Notifications (spec §22) ───────────────────────────────────────────────

  /** Generates low-stock, near-expiry and licence notifications (idempotent per day). */
  async generateNotifications(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const notifications: Array<{ type: string; title: string; body: string; entityType: string; entityId: string }> = [];

    const reorderProducts = await this.prisma.product.findMany({ where: { organizationId: orgId, status: 'ACTIVE', reorderLevel: { not: null } } });
    for (const p of reorderProducts) {
      const agg = await this.prisma.inventoryBalance.aggregate({ where: { organizationId: orgId, batch: { productId: p.id } }, _sum: { quantity: true } });
      const onHand = Number(agg._sum.quantity ?? 0);
      if (onHand <= (p.reorderLevel ?? 0)) {
        notifications.push({ type: 'LOW_STOCK', title: `Low stock: ${p.name}`, body: `On hand ${onHand} at or below reorder level ${p.reorderLevel}.`, entityType: 'Product', entityId: p.id });
      }
    }
    const expiring = await this.prisma.inventoryBatch.findMany({
      where: { organizationId: orgId, status: 'SALEABLE', expiryDate: { gte: today, lte: new Date(today.getTime() + 30 * 86_400_000) }, balances: { some: { quantity: { gt: 0 } } } },
      include: { product: { select: { name: true } } },
    });
    for (const b of expiring) {
      notifications.push({
        type: 'NEAR_EXPIRY',
        title: `Near expiry: ${b.product.name} (${b.batchNumber})`,
        body: `Expires ${b.expiryDate.toISOString().slice(0, 10)} — plan supplier returns or prioritise sale.`,
        entityType: 'InventoryBatch',
        entityId: b.id,
      });
    }
    const licences = await this.prisma.pharmacyLicence.findMany({ where: { organizationId: orgId, expiryDate: { lte: new Date(today.getTime() + 60 * 86_400_000) } } });
    for (const l of licences) {
      notifications.push({
        type: 'LICENCE_EXPIRY',
        title: `Licence ${l.licenceType.replace('_', ' ')} ${l.expiryDate < today ? 'expired' : 'expiring'}`,
        body: `${l.licenceNumber} — ${l.expiryDate < today ? 'expired' : 'expires'} on ${l.expiryDate.toISOString().slice(0, 10)}.`,
        entityType: 'PharmacyLicence',
        entityId: l.id,
      });
    }

    let generated = 0;
    for (const n of notifications) {
      const dupe = await this.prisma.appNotification.findFirst({ where: { organizationId: orgId, type: n.type, entityId: n.entityId, createdAt: { gte: today } } });
      if (!dupe) {
        await this.prisma.appNotification.create({ data: { organizationId: orgId, ...n } });
        generated += 1;
      }
    }
    return { generated, scanned: notifications.length };
  }

  listNotifications(request: TenantRequest, params: { page: number; pageSize: number; unreadOnly?: boolean }) {
    const orgId = request.tenantContext.organizationId;
    const where = { organizationId: orgId, ...(params.unreadOnly ? { readAt: null } : {}) };
    return this.prisma.$transaction([
      this.prisma.appNotification.count({ where }),
      this.prisma.appNotification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    ]);
  }

  async markAllNotificationsRead(request: TenantRequest) {
    const result = await this.prisma.appNotification.updateMany({
      where: { organizationId: request.tenantContext.organizationId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async markNotificationRead(request: TenantRequest, notificationId: string) {
    const orgId = request.tenantContext.organizationId;
    const n = await this.prisma.appNotification.findFirst({ where: { id: notificationId, organizationId: orgId } });
    if (!n) throw NotFound('Notification not found');
    return this.prisma.appNotification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
}
