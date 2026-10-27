import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { TaxCalculator, type TaxComputation } from '../accounting/tax-calculator.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException, Conflict, NotFound } from '../common/app-exception.js';
import { nextDocNumber } from '../common/doc-number.js';
import { amountPaise, major, prorate, qty3, qtyStr, scaled, toPaise } from '../common/money.js';
import { divideHalfUp } from '@medicore/shared-types';

import { tenderAccount } from '../common/tender.js';
import { limitOf } from '../common/subscription-policy.js';

const H1_CLASSES = new Set(['SCHEDULE_H1']);

export interface SaleLineInput {
  productId: string;
  quantity: string;
  /** Charged price per unit, tax-inclusive (retail convention; DPCO para 26 cap vs MRP). */
  unitPrice: string;
  discountAmount?: string;
  /** Authorized FEFO override (audited). */
  explicitBatchId?: string | null;
}

export interface SaleInput {
  customerId?: string | null;
  walkInName?: string | null;
  warehouseId: string;
  lines: SaleLineInput[];
  payments: Array<{ method: PaymentMethod; amount: string; reference?: string | null }>;
  idempotencyKey?: string | null;
  /** Required when any line is Schedule H1 (rule 65(3)(h) register). */
  prescription?: { patientName: string; prescriberName: string; prescriberAddress: string } | null;
}

const invoiceDetailInclude = {
  customer: { select: { id: true, name: true, phone: true, gstin: true, stateCode: true, addressLine1: true, city: true } },
  lines: {
    include: {
      batchAllocations: { include: { batch: { select: { batchNumber: true, expiryDate: true } } } },
      product: { select: { sku: true, hsnCode: true, prescriptionClass: true } },
    },
  },
  payments: { orderBy: { createdAt: 'asc' as const } },
  returns: { include: { lines: true }, orderBy: { createdAt: 'asc' as const } },
  prescriptions: true,
} satisfies Prisma.SalesInvoiceInclude;

/**
 * POS sales engine (spec §11, §26.A): FEFO batch allocation, tax-inclusive
 * GST, server-controlled FY numbering, idempotency against double posting,
 * credit-limit enforcement, H1 register capture, double-entry posting.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
    private readonly tax: TaxCalculator,
    private readonly inventory: InventoryService,
  ) {}

  /** Plan quota (spec §5): invoices per calendar month in IST. */
  private async assertMonthlyInvoiceQuota(orgId: string) {
    const subscription = await this.prisma.subscription.findUnique({ where: { organizationId: orgId }, include: { plan: true } });
    const limit = limitOf(subscription?.plan.limits, 'monthlyInvoiceLimit');
    if (limit === null) return;
    const ist = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 7);
    const used = await this.prisma.salesInvoice.count({ where: { organizationId: orgId, invoiceDate: { gte: new Date(`${ist}-01T00:00:00+05:30`) } } });
    if (used >= limit) {
      throw Conflict('PLAN_LIMIT_REACHED', `Your ${subscription!.plan.name} plan allows ${limit} invoices per month. Upgrade to keep billing.`);
    }
  }

  async createInvoice(request: TenantRequest, data: SaleInput) {
    const orgId = request.tenantContext.organizationId;
    if (data.lines.length === 0) throw new AppException('VALIDATION_ERROR', 'Invoice needs at least one line', 400);

    // Idempotency (spec §1.31, §11): a retried request returns the original invoice.
    if (data.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(orgId, data.idempotencyKey);
      if (existing) return { invoice: existing, idempotentReplay: true };
    }
    await this.assertMonthlyInvoiceQuota(orgId);

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    const customer = data.customerId
      ? await this.prisma.customer.findFirst({ where: { id: data.customerId, organizationId: orgId } })
      : null;
    if (data.customerId && !customer) throw NotFound('Customer not found');
    if (customer && customer.status !== 'ACTIVE') {
      throw new AppException('VALIDATION_ERROR', `Customer ${customer.name} is ${customer.status.toLowerCase()}`, 422);
    }
    await this.inventory.assertWarehouse(orgId, data.warehouseId);

    const products = await this.prisma.product.findMany({
      where: { id: { in: data.lines.map((l) => l.productId) }, organizationId: orgId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let invoice;
    try {
      invoice = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const interState = Boolean(customer?.stateCode && org?.stateCode && customer.stateCode !== org.stateCode);

        let grossPaise = 0n;
        let discountPaise = 0n;
        let taxablePaise = 0n;
        let cgst = 0n;
        let sgst = 0n;
        let igst = 0n;
        let cess = 0n;
        let cogsPaise = 0n;
        const h1Lines: Array<{ name: string; qty: string }> = [];
        const payloads: Array<{
          input: SaleLineInput;
          product: NonNullable<ReturnType<typeof byId.get>>;
          allocations: Array<{ batchId: string; quantity: number; costPaise: bigint }>;
          comp: TaxComputation;
        }> = [];

        for (const line of data.lines) {
          const product = byId.get(line.productId);
          if (!product) throw NotFound(`Product ${line.productId} not found`);
          if (product.status !== 'ACTIVE') {
            throw new AppException('BATCH_INELIGIBLE', `Product ${product.name} is not active for sale`, 422);
          }
          if (qty3(line.quantity) <= 0n) throw new AppException('VALIDATION_ERROR', 'Sale quantities must be positive', 400);

          // DPCO para 26: no sale above label MRP.
          if (product.mrp && scaled(product.mrp, 4) > 0n && scaled(line.unitPrice, 4) > scaled(product.mrp, 4)) {
            throw new AppException(
              'VALIDATION_ERROR',
              `Unit price ${line.unitPrice} exceeds MRP ${product.mrp.toFixed(2)} for ${product.name} (DPCO para 26)`,
              422,
            );
          }

          const lineDiscount = toPaise(line.discountAmount ?? '0');
          const lineGross = amountPaise(line.unitPrice, line.quantity) - lineDiscount;
          if (lineGross < 0n) throw new AppException('VALIDATION_ERROR', 'Discount exceeds line amount', 400);

          const rate = await this.tax.requireRate(orgId, product, now);

          // FEFO allocation (audited override when explicitBatchId present); stock is
          // re-checked under row lock when the movements post below.
          const allocations = await this.inventory.allocateFEFO(request, {
            productId: line.productId,
            warehouseId: data.warehouseId,
            quantity: Number(line.quantity),
            explicitBatchId: line.explicitBatchId ?? null,
          });
          const costed: Array<{ batchId: string; quantity: number; costPaise: bigint }> = [];
          for (const a of allocations) {
            const batch = await tx.inventoryBatch.findUniqueOrThrow({ where: { id: a.batchId } });
            const cost = amountPaise(batch.purchaseRate, a.quantity.toFixed(3));
            cogsPaise += cost;
            costed.push({ batchId: a.batchId, quantity: a.quantity, costPaise: cost });
          }

          const comp = this.tax.computeInclusive(major(lineGross), rate, interState);
          grossPaise += lineGross;
          discountPaise += lineDiscount;
          taxablePaise += toPaise(comp.taxableValue);
          cgst += toPaise(comp.cgst);
          sgst += toPaise(comp.sgst);
          igst += toPaise(comp.igst);
          cess += toPaise(comp.cess);
          if (product.prescriptionClass && H1_CLASSES.has(product.prescriptionClass)) {
            h1Lines.push({ name: product.name, qty: line.quantity });
          }
          payloads.push({ input: line, product, allocations: costed, comp });
        }

        // Schedule H1 register (rule 65(3)(h)) — mandatory fields, not a checkbox (spec §14).
        if (h1Lines.length > 0 && !data.prescription) {
          throw new AppException(
            'VALIDATION_ERROR',
            'Schedule H1 medicines require prescriber and patient details for the statutory register',
            422,
          );
        }

        // Whole-rupee round-off (Indian retail convention).
        const totalPaise = divideHalfUp(grossPaise, 100n) * 100n;
        const roundOffPaise = totalPaise - grossPaise;

        // Tender: payments must equal the rounded invoice total.
        const debitByAccount = new Map<string, bigint>();
        let paidPaise = 0n;
        let creditPaise = 0n;
        for (const p of data.payments) {
          const amt = toPaise(p.amount);
          if (amt <= 0n) throw new AppException('VALIDATION_ERROR', 'Payment amounts must be positive', 400);
          if (p.method === 'CREDIT') {
            creditPaise += amt;
            continue;
          }
          paidPaise += amt;
          const acc = tenderAccount(p.method);
          debitByAccount.set(acc, (debitByAccount.get(acc) ?? 0n) + amt);
        }
        if (paidPaise + creditPaise !== totalPaise) {
          throw new AppException(
            'VALIDATION_ERROR',
            `Payments (${major(paidPaise + creditPaise)}) must equal the invoice total ${major(totalPaise)}`,
            400,
          );
        }
        if (creditPaise > 0n) {
          if (!customer) throw new AppException('VALIDATION_ERROR', 'Credit sales require a registered customer', 400);
          const limitPaise = toPaise(customer.creditLimit);
          if (limitPaise > 0n) {
            const outstanding = await this.customerOutstandingPaise(tx, orgId, customer.id, customer.openingBalance);
            if (outstanding + creditPaise > limitPaise) {
              throw new AppException(
                'CREDIT_LIMIT_EXCEEDED',
                `Credit limit exceeded: outstanding ${major(outstanding)} + ${major(creditPaise)} > limit ${major(limitPaise)}`,
                422,
              );
            }
          }
        }

        const invoiceNumber = await nextDocNumber(tx, orgId, 'SI', now);
        const created = await tx.salesInvoice.create({
          data: {
            organizationId: orgId,
            invoiceNumber,
            customerId: customer?.id ?? null,
            walkInName: customer ? null : (data.walkInName?.trim() || 'Walk-in customer'),
            status: 'POSTED',
            invoiceDate: now,
            subtotal: major(grossPaise),
            discountAmount: major(discountPaise),
            taxableValue: major(taxablePaise),
            cgstAmount: major(cgst),
            sgstAmount: major(sgst),
            igstAmount: major(igst),
            cessAmount: major(cess),
            roundOff: major(roundOffPaise),
            total: major(totalPaise),
            paidAmount: major(paidPaise),
            creditAmount: major(creditPaise),
            isWholesale: customer?.isWholesale ?? false,
            idempotencyKey: data.idempotencyKey ?? null,
            warehouseId: data.warehouseId,
            createdById: request.principal.userId,
          },
        });

        for (const p of payloads) {
          const line = await tx.salesInvoiceLine.create({
            data: {
              invoiceId: created.id,
              productId: p.product.id,
              productName: p.product.name,
              hsnCode: p.product.hsnCode,
              quantity: p.input.quantity,
              unitPrice: p.input.unitPrice,
              discountAmount: p.input.discountAmount ?? '0',
              taxableValue: p.comp.taxableValue,
              cgstAmount: p.comp.cgst,
              sgstAmount: p.comp.sgst,
              igstAmount: p.comp.igst,
              cessAmount: p.comp.cess,
              taxRatePercent: p.comp.ratePercent,
              lineTotal: p.comp.lineTotal,
              costOfGoods: major(p.allocations.reduce((s, a) => s + a.costPaise, 0n)),
            },
          });
          for (const a of p.allocations) {
            await tx.salesBatchAllocation.create({
              data: { lineId: line.id, batchId: a.batchId, quantity: a.quantity.toFixed(3) },
            });
            await this.inventory.applyStockDelta(tx, {
              organizationId: orgId,
              batchId: a.batchId,
              warehouseId: data.warehouseId,
              delta: -a.quantity,
              actorUserId: request.principal.userId,
              movementType: 'SALE',
              reason: `Sale ${invoiceNumber}`,
              sourceDocument: 'SALES_INVOICE',
              sourceDocumentId: created.id,
            });
          }
        }

        for (const p of data.payments) {
          await tx.salesPayment.create({
            data: { invoiceId: created.id, method: p.method, amount: p.amount, reference: p.reference ?? null },
          });
        }

        if (data.prescription) {
          for (const h1 of h1Lines) {
            await tx.prescriptionRecord.create({
              data: {
                organizationId: orgId,
                invoiceId: created.id,
                patientName: data.prescription.patientName,
                prescriberName: data.prescription.prescriberName,
                prescriberAddress: data.prescription.prescriberAddress,
                drugName: h1.name,
                quantity: h1.qty,
                dispensedAt: now,
              },
            });
          }
        }

        // Dr Cash/Bank per tender + Dr AR (credit); Cr Sales (taxable + round-off),
        // Cr GST Output (GST + cess); Dr COGS, Cr Inventory at batch cost.
        const journal = await this.accounting.postJournalEntry(
          request,
          orgId,
          {
            date: now,
            memo: `Retail sale ${invoiceNumber}${customer ? ` — ${customer.name}` : ''}`,
            sourceType: 'SALES_INVOICE',
            sourceId: created.id,
            lines: [
              ...[...debitByAccount.entries()].map(([systemKey, amt]) => ({ systemKey, debit: major(amt) })),
              ...(creditPaise > 0n ? [{ systemKey: 'AR', debit: major(creditPaise) }] : []),
              { systemKey: 'SALES', credit: major(taxablePaise + roundOffPaise) },
              ...(cgst + sgst + igst + cess > 0n ? [{ systemKey: 'GST_OUTPUT', credit: major(cgst + sgst + igst + cess) }] : []),
              ...(cogsPaise > 0n
                ? [
                    { systemKey: 'COGS', debit: major(cogsPaise) },
                    { systemKey: 'INVENTORY', credit: major(cogsPaise) },
                  ]
                : []),
            ],
          },
          tx,
        );
        if (journal) {
          await tx.salesInvoice.update({ where: { id: created.id }, data: { journalEntryId: journal.id } });
        }
        return tx.salesInvoice.findUniqueOrThrow({ where: { id: created.id }, include: invoiceDetailInclude });
      });
    } catch (error) {
      // Concurrent retry with the same key: the unique index wins, return the original.
      if (data.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByIdempotencyKey(orgId, data.idempotencyKey);
        if (existing) return { invoice: existing, idempotentReplay: true };
      }
      throw error;
    }

    await this.audit.record({
      event: 'SALES_INVOICE_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'SalesInvoice',
      entityId: invoice.id,
      details: { invoiceNumber: invoice.invoiceNumber, total: invoice.total.toFixed(2), lines: invoice.lines.length },
    });

    // Usage metering (spec §5): monthly invoice count per organization.
    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await this.prisma.usageRecord.upsert({
      where: { organizationId_metric_periodStart: { organizationId: orgId, metric: 'INVOICES', periodStart } },
      create: { organizationId: orgId, metric: 'INVOICES', periodStart, periodEnd, value: 1 },
      update: { value: { increment: 1 } },
    });

    return { invoice, idempotentReplay: false };
  }

  private findByIdempotencyKey(orgId: string, key: string) {
    return this.prisma.salesInvoice.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: orgId, idempotencyKey: key } },
      include: invoiceDetailInclude,
    });
  }

  /** Opening balance + open credit on invoices (creditAmount tracks the unpaid credit portion). */
  private async customerOutstandingPaise(
    db: Pick<PrismaService, 'salesInvoice'> | Prisma.TransactionClient,
    orgId: string,
    customerId: string,
    openingBalance: Prisma.Decimal,
  ): Promise<bigint> {
    const agg = await db.salesInvoice.aggregate({
      where: { organizationId: orgId, customerId },
      _sum: { creditAmount: true },
    });
    return toPaise(openingBalance) + toPaise(agg._sum.creditAmount ?? new Prisma.Decimal(0));
  }

  listInvoices(
    request: TenantRequest,
    params: { page: number; pageSize: number; search?: string; customerId?: string; from?: string; to?: string; status?: string },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.SalesInvoiceWhereInput = { organizationId: orgId };
    if (params.customerId) where.customerId = params.customerId;
    if (params.status) where.status = params.status as never;
    if (params.search) {
      where.OR = [
        { invoiceNumber: { contains: params.search, mode: 'insensitive' } },
        { walkInName: { contains: params.search, mode: 'insensitive' } },
        { customer: { name: { contains: params.search, mode: 'insensitive' } } },
      ];
    }
    if (params.from || params.to) {
      where.invoiceDate = {
        ...(params.from ? { gte: new Date(`${params.from}T00:00:00+05:30`) } : {}),
        ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999+05:30`) } : {}),
      };
    }
    return this.prisma.$transaction([
      this.prisma.salesInvoice.count({ where }),
      this.prisma.salesInvoice.findMany({
        where,
        include: { customer: { select: { name: true } }, lines: true, payments: true },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  async getInvoice(request: TenantRequest, invoiceId: string) {
    const orgId = request.tenantContext.organizationId;
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: invoiceDetailInclude,
    });
    if (!invoice) throw NotFound('Invoice not found');
    const [org, warehouse, licences] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, legalEntityName: true, gstin: true, stateCode: true, addressLine1: true, addressLine2: true, city: true, pinCode: true, contactPhone: true, contactEmail: true },
      }),
      this.prisma.warehouse.findUnique({ where: { id: invoice.warehouseId }, select: { name: true, branch: { select: { name: true } } } }),
      this.prisma.pharmacyLicence.findMany({
        where: { organizationId: orgId, expiryDate: { gte: invoice.invoiceDate } },
        select: { licenceType: true, licenceNumber: true },
        orderBy: { licenceType: 'asc' },
      }),
    ]);
    return { ...invoice, seller: org ? { ...org, licences } : null, warehouse };
  }

  // ── Sales returns (spec §15) ───────────────────────────────────────────────

  async createSalesReturn(
    request: TenantRequest,
    data: {
      invoiceId: string;
      reason: string;
      refundMethod?: 'CASH' | 'UPI' | 'CARD' | 'BANK';
      lines: Array<{ invoiceLineId: string; quantity: string; restock: boolean }>;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    const exists = await this.prisma.salesInvoice.findFirst({ where: { id: data.invoiceId, organizationId: orgId }, select: { id: true } });
    if (!exists) throw NotFound('Invoice not found');

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent returns against the same invoice.
      await tx.$queryRaw`SELECT id FROM "SalesInvoice" WHERE id = ${data.invoiceId} FOR UPDATE`;
      const invoice = await tx.salesInvoice.findUniqueOrThrow({
        where: { id: data.invoiceId },
        include: { lines: { include: { batchAllocations: { include: { batch: true } }, returnLines: true } } },
      });
      if (invoice.status === 'CANCELLED' || invoice.status === 'RETURNED') {
        throw Conflict('STATE_TRANSITION_INVALID', `Invoice ${invoice.invoiceNumber} is already fully returned or cancelled`);
      }

      const returnNumber = await nextDocNumber(tx, orgId, 'SRET');
      let refundPaise = 0n;
      let taxablePaise = 0n;
      let taxPaise = 0n;
      let restockCostPaise = 0n;
      const rows: Array<Omit<Prisma.SalesReturnLineUncheckedCreateInput, 'returnId'>> = [];
      const stockIns: Array<{ batchId: string; qty: string }> = [];
      const returnedNow = new Map<string, bigint>();

      for (const line of data.lines) {
        const invLine = invoice.lines.find((l) => l.id === line.invoiceLineId);
        if (!invLine) throw NotFound(`Invoice line ${line.invoiceLineId} not found`);
        const q = qty3(line.quantity);
        if (q <= 0n) throw new AppException('VALIDATION_ERROR', 'Return quantities must be positive', 400);
        const already = qty3(invLine.returnedQty) + (returnedNow.get(invLine.id) ?? 0n);
        const returnable = qty3(invLine.quantity) - already;
        if (q > returnable) {
          throw new AppException(
            'RETURN_QUANTITY_EXCEEDS_ORIGINAL',
            `Return ${qtyStr(q)} exceeds returnable ${qtyStr(returnable)} on ${invLine.productName}`,
            422,
          );
        }
        returnedNow.set(invLine.id, (returnedNow.get(invLine.id) ?? 0n) + q);

        // Spread the returned quantity over the original batch allocations.
        const returnedByBatch = new Map<string, bigint>();
        for (const rl of invLine.returnLines) {
          returnedByBatch.set(rl.batchId, (returnedByBatch.get(rl.batchId) ?? 0n) + qty3(rl.quantity));
        }
        let remaining = q;
        for (const alloc of invLine.batchAllocations) {
          if (remaining === 0n) break;
          const free = qty3(alloc.quantity) - (returnedByBatch.get(alloc.batchId) ?? 0n);
          if (free <= 0n) continue;
          const take = free < remaining ? free : remaining;
          remaining -= take;
          returnedByBatch.set(alloc.batchId, (returnedByBatch.get(alloc.batchId) ?? 0n) + take);
          const takeStr = qtyStr(take);

          // Proportional reversal of the original line's amounts (keeps CGST/SGST vs IGST as billed).
          const gross = prorate(toPaise(invLine.lineTotal), takeStr, invLine.quantity);
          const taxable = prorate(toPaise(invLine.taxableValue), takeStr, invLine.quantity);
          const tax = gross - taxable;
          refundPaise += gross;
          taxablePaise += taxable;
          taxPaise += tax;
          if (line.restock) {
            restockCostPaise += amountPaise(alloc.batch.purchaseRate, takeStr);
            stockIns.push({ batchId: alloc.batchId, qty: takeStr });
          }
          rows.push({
            invoiceLineId: invLine.id,
            batchId: alloc.batchId,
            quantity: takeStr,
            unitPrice: invLine.unitPrice,
            taxableValue: major(taxable),
            taxAmount: major(tax),
            lineTotal: major(gross),
            restock: line.restock,
          });
        }
        if (remaining > 0n) {
          throw new AppException('BATCH_INELIGIBLE', `Original batch allocation for ${invLine.productName} is incomplete`, 422);
        }
        await tx.salesInvoiceLine.update({
          where: { id: invLine.id },
          data: { returnedQty: qtyStr(qty3(invLine.returnedQty) + (returnedNow.get(invLine.id) ?? 0n)) },
        });
      }

      // Settle against open credit first; the rest is refunded in the chosen tender.
      const openCredit = toPaise(invoice.creditAmount);
      const creditAdjusted = refundPaise < openCredit ? refundPaise : openCredit;
      const cashRefund = refundPaise - creditAdjusted;
      const refundMethod = data.refundMethod ?? 'CASH';

      const created = await tx.salesReturn.create({
        data: {
          organizationId: orgId,
          returnNumber,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          reason: data.reason,
          refundTotal: major(refundPaise),
          taxAmount: major(taxPaise),
          creditAdjusted: major(creditAdjusted),
          refundMethod: cashRefund > 0n ? refundMethod : null,
          createdById: request.principal.userId,
          lines: { create: rows },
        },
      });

      for (const s of stockIns) {
        await this.inventory.applyStockDelta(tx, {
          organizationId: orgId,
          batchId: s.batchId,
          warehouseId: invoice.warehouseId,
          delta: Number(s.qty),
          actorUserId: request.principal.userId,
          movementType: 'SALES_RETURN_IN',
          reason: `Sales return ${returnNumber} (condition-checked restock)`,
          sourceDocument: 'SALES_RETURN',
          sourceDocumentId: created.id,
        });
      }

      const journal = await this.accounting.postJournalEntry(
        request,
        orgId,
        {
          date: new Date(),
          memo: `Sales return ${returnNumber} against ${invoice.invoiceNumber} (${data.reason})`,
          sourceType: 'SALES_RETURN',
          sourceId: created.id,
          lines: [
            { systemKey: 'SALES_RETURNS', debit: major(taxablePaise) },
            ...(taxPaise > 0n ? [{ systemKey: 'GST_OUTPUT', debit: major(taxPaise) }] : []),
            ...(creditAdjusted > 0n ? [{ systemKey: 'AR', credit: major(creditAdjusted) }] : []),
            ...(cashRefund > 0n ? [{ systemKey: tenderAccount(refundMethod), credit: major(cashRefund) }] : []),
            ...(restockCostPaise > 0n
              ? [
                  { systemKey: 'INVENTORY', debit: major(restockCostPaise) },
                  { systemKey: 'COGS', credit: major(restockCostPaise) },
                ]
              : []),
          ],
        },
        tx,
      );
      if (journal) await tx.salesReturn.update({ where: { id: created.id }, data: { journalEntryId: journal.id } });

      const lines = await tx.salesInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
      const fullyReturned = lines.every((l) => qty3(l.returnedQty) >= qty3(l.quantity));
      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          returnedAmount: major(toPaise(invoice.returnedAmount) + refundPaise),
          creditAmount: major(openCredit - creditAdjusted),
          status: fullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED',
        },
      });

      return { id: created.id, invoiceNumber: invoice.invoiceNumber };
    });

    await this.audit.record({
      event: 'SALES_RETURN_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'SalesReturn',
      entityId: result.id,
      details: { invoiceNumber: result.invoiceNumber, reason: data.reason },
    });

    return this.prisma.salesReturn.findUniqueOrThrow({
      where: { id: result.id },
      include: {
        lines: { include: { batch: { include: { product: { select: { name: true } } } } } },
        invoice: { select: { invoiceNumber: true } },
      },
    });
  }

  listReturns(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.salesReturn.count({ where: { organizationId: orgId } }),
      this.prisma.salesReturn.findMany({
        where: { organizationId: orgId },
        include: { invoice: { select: { invoiceNumber: true, customer: { select: { name: true } }, walkInName: true } }, lines: true },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  /** Customer receipt against outstanding credit (spec §16), FIFO over oldest invoices. */
  async recordCustomerReceipt(
    request: TenantRequest,
    data: { customerId: string; amount: string; method: 'CASH' | 'UPI' | 'CARD' | 'BANK'; reference?: string | null },
  ) {
    const orgId = request.tenantContext.organizationId;
    const customer = await this.prisma.customer.findFirst({ where: { id: data.customerId, organizationId: orgId } });
    if (!customer) throw NotFound('Customer not found');
    const amountPaise = toPaise(data.amount);
    if (amountPaise <= 0n) throw new AppException('VALIDATION_ERROR', 'Receipt amount must be positive', 400);

    const result = await this.prisma.$transaction(async (tx) => {
      const invoices = await tx.$queryRaw<Array<{ id: string; invoiceNumber: string; creditAmount: Prisma.Decimal }>>`
        SELECT id, "invoiceNumber", "creditAmount" FROM "SalesInvoice"
        WHERE "organizationId" = ${orgId} AND "customerId" = ${customer.id} AND "creditAmount" > 0
        ORDER BY "invoiceDate" ASC FOR UPDATE`;
      const duePaise = invoices.reduce((s, i) => s + toPaise(i.creditAmount), 0n);
      if (amountPaise > duePaise) {
        throw new AppException('ALLOCATION_EXCEEDS_BALANCE', `Receipt ${data.amount} exceeds invoice dues ${major(duePaise)}`, 422);
      }
      let remaining = amountPaise;
      const applied: Array<{ invoiceNumber: string; amount: string }> = [];
      for (const inv of invoices) {
        if (remaining <= 0n) break;
        const due = toPaise(inv.creditAmount);
        const take = due < remaining ? due : remaining;
        remaining -= take;
        await tx.salesInvoice.update({ where: { id: inv.id }, data: { creditAmount: major(due - take) } });
        await tx.salesPayment.create({
          data: { invoiceId: inv.id, method: data.method, amount: major(take), reference: data.reference ?? `Receipt against ${inv.invoiceNumber}` },
        });
        applied.push({ invoiceNumber: inv.invoiceNumber, amount: major(take) });
      }
      const journal = await this.accounting.postJournalEntry(
        request,
        orgId,
        {
          date: new Date(),
          memo: `Customer receipt — ${customer.name}${data.reference ? ` (${data.reference})` : ''}`,
          sourceType: 'CUSTOMER_RECEIPT',
          sourceId: customer.id,
          lines: [
            { systemKey: tenderAccount(data.method), debit: major(amountPaise) },
            { systemKey: 'AR', credit: major(amountPaise) },
          ],
        },
        tx,
      );
      return { recorded: true, amount: major(amountPaise), applied, journalNumber: journal?.entryNumber ?? null };
    });

    await this.audit.record({
      event: 'CUSTOMER_RECEIPT_RECORDED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Customer',
      entityId: customer.id,
      details: { amount: result.amount, method: data.method, invoices: result.applied.length },
    });
    return result;
  }

  /** Customer outstanding (receivables) = opening balance + unpaid credit on invoices. */
  async customerOutstanding(request: TenantRequest, customerId: string) {
    const orgId = request.tenantContext.organizationId;
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: orgId } });
    if (!customer) throw NotFound('Customer not found');
    const outstanding = await this.customerOutstandingPaise(this.prisma, orgId, customerId, customer.openingBalance);
    return {
      customer: { id: customer.id, name: customer.name, creditLimit: customer.creditLimit.toFixed(2) },
      outstanding: major(outstanding),
      availableCredit: toPaise(customer.creditLimit) > 0n ? major(toPaise(customer.creditLimit) - outstanding) : null,
    };
  }

  /**
   * Running customer statement: invoices (Dr), payments incl. at-counter
   * tenders and receipts (Cr), returns (Cr) with any cash refund (Dr).
   */
  async customerStatement(request: TenantRequest, customerId: string) {
    const orgId = request.tenantContext.organizationId;
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: orgId } });
    if (!customer) throw NotFound('Customer not found');
    const invoices = await this.prisma.salesInvoice.findMany({
      where: { organizationId: orgId, customerId },
      include: { payments: true, returns: true },
      orderBy: { invoiceDate: 'asc' },
    });
    type Row = { date: Date; type: string; doc: string; invoiceId: string | null; debit: bigint; credit: bigint };
    const events: Row[] = [];
    for (const inv of invoices) {
      events.push({ date: inv.invoiceDate, type: 'INVOICE', doc: inv.invoiceNumber, invoiceId: inv.id, debit: toPaise(inv.total), credit: 0n });
      for (const p of inv.payments) {
        if (p.method === 'CREDIT') continue;
        events.push({ date: p.createdAt, type: `PAYMENT · ${p.method}`, doc: p.reference ?? inv.invoiceNumber, invoiceId: inv.id, debit: 0n, credit: toPaise(p.amount) });
      }
      for (const r of inv.returns) {
        events.push({ date: r.createdAt, type: 'RETURN', doc: r.returnNumber, invoiceId: inv.id, debit: 0n, credit: toPaise(r.refundTotal) });
        const refunded = toPaise(r.refundTotal) - toPaise(r.creditAdjusted);
        if (refunded > 0n) {
          events.push({ date: r.createdAt, type: `REFUND · ${r.refundMethod ?? 'CASH'}`, doc: r.returnNumber, invoiceId: inv.id, debit: refunded, credit: 0n });
        }
      }
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    let balance = toPaise(customer.openingBalance);
    const rows: Array<{ date: Date; type: string; doc: string; invoiceId: string | null; debit: string; credit: string; balance: string }> = [
      { date: customer.createdAt, type: 'OPENING', doc: '—', invoiceId: null, debit: major(balance), credit: '0.00', balance: major(balance) },
    ];
    for (const e of events) {
      balance += e.debit - e.credit;
      rows.push({ date: e.date, type: e.type, doc: e.doc, invoiceId: e.invoiceId, debit: major(e.debit), credit: major(e.credit), balance: major(balance) });
    }
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        creditLimit: customer.creditLimit.toFixed(2),
        creditDays: customer.creditDays,
      },
      rows,
      outstanding: major(balance),
      totals: {
        invoiced: major(invoices.reduce((s, i) => s + toPaise(i.total), 0n)),
        invoices: invoices.length,
      },
    };
  }
}
