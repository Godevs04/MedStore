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

  async markNotificationRead(request: TenantRequest, notificationId: string) {
    const orgId = request.tenantContext.organizationId;
    const n = await this.prisma.appNotification.findFirst({ where: { id: notificationId, organizationId: orgId } });
    if (!n) throw NotFound('Notification not found');
    return this.prisma.appNotification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
}
