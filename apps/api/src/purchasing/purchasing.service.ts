import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { TaxCalculator } from '../accounting/tax-calculator.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException, Conflict, NotFound } from '../common/app-exception.js';
import { nextDocNumber } from '../common/doc-number.js';
import { amountPaise, major, qty3, qtyStr, toPaise } from '../common/money.js';
import { tenderAccount } from '../common/tender.js';

const RECEIVABLE_PO_STATUSES = new Set(['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED']);

/**
 * Purchasing lifecycle (spec §9): PO → goods receipt (creates batches +
 * stock) → supplier invoice reconciled against the receipt (liability +
 * input tax credit) → payment allocation → purchase returns (debit note).
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
    private readonly tax: TaxCalculator,
    private readonly inventory: InventoryService,
  ) {}

  private async vendorOrThrow(orgId: string, vendorId: string) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, organizationId: orgId } });
    if (!vendor) throw NotFound('Vendor not found');
    return vendor;
  }

  // ── Purchase orders ────────────────────────────────────────────────────────

  async createPO(
    request: TenantRequest,
    data: { vendorId: string; expectedDate?: string | null; notes?: string | null; lines: Array<{ productId: string; quantity: string; unitPrice: string }> },
  ) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.vendorOrThrow(orgId, data.vendorId);
    if (vendor.status !== 'ACTIVE') throw new AppException('VALIDATION_ERROR', `Vendor is ${vendor.status.toLowerCase()}`, 422);
    if (data.lines.length === 0) throw new AppException('VALIDATION_ERROR', 'PO needs at least one line', 400);
    const ids = new Set(data.lines.map((l) => l.productId));
    if (ids.size !== data.lines.length) throw new AppException('VALIDATION_ERROR', 'Each product may appear once per PO', 400);
    const found = await this.prisma.product.count({ where: { id: { in: [...ids] }, organizationId: orgId } });
    if (found !== ids.size) throw NotFound('One or more products not found');
    for (const l of data.lines) {
      if (qty3(l.quantity) <= 0n) throw new AppException('VALIDATION_ERROR', 'PO quantities must be positive', 400);
    }

    const po = await this.prisma.$transaction(async (tx) => {
      const poNumber = await nextDocNumber(tx, orgId, 'PO');
      return tx.purchaseOrder.create({
        data: {
          organizationId: orgId,
          poNumber,
          vendorId: data.vendorId,
          status: 'DRAFT',
          orderDate: new Date(),
          expectedDate: data.expectedDate ? new Date(`${data.expectedDate}T00:00:00+05:30`) : null,
          notes: data.notes ?? null,
          createdById: request.principal.userId,
          lines: { create: data.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })) },
        },
        include: { lines: { include: { product: { select: { name: true, sku: true } } } }, vendor: { select: { legalName: true } } },
      });
    });
    await this.audit.record({
      event: 'PURCHASE_ORDER_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'PurchaseOrder',
      entityId: po.id,
      details: { poNumber: po.poNumber, vendor: vendor.legalName, lines: po.lines.length },
    });
    return po;
  }

  async listPOs(request: TenantRequest, params: { page: number; pageSize: number; status?: string; vendorId?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId: orgId,
      ...(params.status ? { status: { in: params.status.split(',') as never[] } } : {}),
      ...(params.vendorId ? { vendorId: params.vendorId } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { legalName: true } },
          lines: { include: { product: { select: { name: true, sku: true, mrp: true } } } },
          receipts: { select: { id: true, grnNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  async setPOStatus(request: TenantRequest, poId: string, action: 'send' | 'confirm' | 'cancel') {
    const orgId = request.tenantContext.organizationId;
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id: poId, organizationId: orgId } });
    if (!po) throw NotFound('Purchase order not found');
    const transitions: Record<string, { from: string[]; to: 'SENT' | 'CONFIRMED' | 'CANCELLED' }> = {
      send: { from: ['DRAFT'], to: 'SENT' },
      confirm: { from: ['SENT'], to: 'CONFIRMED' },
      cancel: { from: ['DRAFT', 'SENT', 'CONFIRMED'], to: 'CANCELLED' },
    };
    const t = transitions[action];
    if (!t) throw new AppException('VALIDATION_ERROR', `Unknown PO action ${action}`, 400);
    if (!t.from.includes(po.status)) throw Conflict('STATE_TRANSITION_INVALID', `Cannot ${action} a PO in status ${po.status}`);
    const updated = await this.prisma.purchaseOrder.update({ where: { id: poId }, data: { status: t.to } });
    await this.audit.record({
      event: 'PURCHASE_ORDER_STATUS_CHANGED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'PurchaseOrder',
      entityId: poId,
      details: { poNumber: po.poNumber, from: po.status, to: t.to },
    });
    return updated;
  }

  // ── Goods receipt ──────────────────────────────────────────────────────────

  /**
   * Records a goods receipt: creates/merges batches with expiry + rates,
   * posts PURCHASE_RECEIPT movements, updates PO received quantities (no
   * over-receipt against the order). One transaction across all lines.
   */
  async createGRN(
    request: TenantRequest,
    data: {
      vendorId: string;
      poId?: string | null;
      warehouseId: string;
      notes?: string | null;
      lines: Array<{
        productId: string;
        poLineId?: string | null;
        batchNumber: string;
        expiryDate: string;
        manufacturingDate?: string | null;
        quantity: string;
        freeQuantity?: string;
        purchaseRate: string;
        mrp: string;
      }>;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.vendorOrThrow(orgId, data.vendorId);
    await this.inventory.assertWarehouse(orgId, data.warehouseId);
    if (data.lines.length === 0) throw new AppException('VALIDATION_ERROR', 'GRN needs at least one line', 400);
    const products = await this.prisma.product.findMany({
      where: { id: { in: data.lines.map((l) => l.productId) }, organizationId: orgId },
      select: { id: true, name: true },
    });
    const productName = new Map(products.map((p) => [p.id, p.name]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const grn = await this.prisma.$transaction(async (tx) => {
      if (data.poId) {
        await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${data.poId} FOR UPDATE`;
        const po = await tx.purchaseOrder.findFirst({ where: { id: data.poId, organizationId: orgId } });
        if (!po) throw NotFound('Purchase order not found');
        if (po.vendorId !== data.vendorId) throw new AppException('VALIDATION_ERROR', 'PO belongs to a different vendor', 422);
        if (!RECEIVABLE_PO_STATUSES.has(po.status)) {
          throw Conflict('STATE_TRANSITION_INVALID', `PO ${po.poNumber} is ${po.status}; send it before receiving goods`);
        }
      }
      const grnNumber = await nextDocNumber(tx, orgId, 'GRN');
      const receipt = await tx.goodsReceipt.create({
        data: {
          organizationId: orgId,
          grnNumber,
          poId: data.poId ?? null,
          vendorId: data.vendorId,
          warehouseId: data.warehouseId,
          receivedDate: new Date(),
          notes: data.notes ?? null,
          createdById: request.principal.userId,
        },
      });

      const receivedByPoLine = new Map<string, bigint>();
      for (const line of data.lines) {
        const name = productName.get(line.productId);
        if (!name) throw NotFound(`Product ${line.productId} not found`);
        const q = qty3(line.quantity);
        if (q <= 0n) throw new AppException('VALIDATION_ERROR', 'GRN quantities must be positive', 400);
        const expiry = new Date(`${line.expiryDate}T00:00:00Z`);
        if (expiry < today) {
          throw new AppException('BATCH_INELIGIBLE', `Batch ${line.batchNumber} of ${name} is already expired (${line.expiryDate})`, 422);
        }
        if (data.poId) {
          if (!line.poLineId) throw new AppException('VALIDATION_ERROR', `Line for ${name} must reference its PO line`, 400);
          receivedByPoLine.set(line.poLineId, (receivedByPoLine.get(line.poLineId) ?? 0n) + q);
        }
        const batch = await this.inventory.upsertBatchInTx(tx, {
          organizationId: orgId,
          productId: line.productId,
          warehouseId: data.warehouseId,
          batchNumber: line.batchNumber.trim(),
          expiryDate: expiry,
          purchaseRate: line.purchaseRate,
          mrp: line.mrp,
          supplierId: data.vendorId,
          sourceDocument: `GRN:${receipt.grnNumber}`,
          actorUserId: request.principal.userId,
        });
        await this.inventory.applyStockDelta(tx, {
          organizationId: orgId,
          batchId: batch.id,
          warehouseId: data.warehouseId,
          delta: Number(qtyStr(q + qty3(line.freeQuantity ?? '0'))),
          actorUserId: request.principal.userId,
          movementType: 'PURCHASE_RECEIPT',
          reason: `Goods receipt ${receipt.grnNumber}`,
          sourceDocument: 'GOODS_RECEIPT',
          sourceDocumentId: receipt.id,
        });
        await tx.goodsReceiptLine.create({
          data: {
            grnId: receipt.id,
            poLineId: line.poLineId ?? null,
            productId: line.productId,
            batchNumber: line.batchNumber.trim(),
            expiryDate: expiry,
            quantity: line.quantity,
            freeQuantity: line.freeQuantity ?? '0',
            purchaseRate: line.purchaseRate,
            mrp: line.mrp,
          },
        });
      }

      if (data.poId) {
        const poLines = await tx.purchaseOrderLine.findMany({ where: { poId: data.poId }, include: { product: { select: { name: true } } } });
        for (const [poLineId, q] of receivedByPoLine) {
          const poLine = poLines.find((l) => l.id === poLineId);
          if (!poLine) throw NotFound('PO line not found on this purchase order');
          const lineProducts = data.lines.filter((l) => l.poLineId === poLineId).map((l) => l.productId);
          if (lineProducts.some((p) => p !== poLine.productId)) {
            throw new AppException('VALIDATION_ERROR', `Receipt product does not match PO line for ${poLine.product.name}`, 422);
          }
          const received = qty3(poLine.receivedQty) + q;
          if (received > qty3(poLine.quantity)) {
            throw new AppException(
              'RECEIPT_QUANTITY_MISMATCH',
              `Receiving ${qtyStr(q)} of ${poLine.product.name} exceeds the open PO quantity ${qtyStr(qty3(poLine.quantity) - qty3(poLine.receivedQty))}`,
              422,
            );
          }
          poLine.receivedQty = qtyStr(received) as never;
          await tx.purchaseOrderLine.update({ where: { id: poLine.id }, data: { receivedQty: qtyStr(received) } });
        }
        const fully = poLines.every((l) => qty3(l.receivedQty) >= qty3(l.quantity));
        await tx.purchaseOrder.update({ where: { id: data.poId }, data: { status: fully ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
      }
      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
        include: { lines: { include: { product: { select: { name: true } } } }, vendor: { select: { legalName: true } }, po: { select: { poNumber: true } } },
      });
    });

    await this.audit.record({
      event: 'GOODS_RECEIPT_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'GoodsReceipt',
      entityId: grn.id,
      details: { grnNumber: grn.grnNumber, vendor: vendor.legalName, poNumber: grn.po?.poNumber ?? null, lines: data.lines.length },
    });
    return grn;
  }

  listGRNs(request: TenantRequest, params: { page: number; pageSize: number; vendorId?: string; uninvoiced?: boolean }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.GoodsReceiptWhereInput = {
      organizationId: orgId,
      ...(params.vendorId ? { vendorId: params.vendorId } : {}),
      ...(params.uninvoiced ? { invoices: { none: {} } } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.goodsReceipt.count({ where }),
      this.prisma.goodsReceipt.findMany({
        where,
        include: {
          lines: { include: { product: { select: { name: true, sku: true } } } },
          vendor: { select: { legalName: true } },
          po: { select: { poNumber: true } },
          invoices: { select: { id: true, invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  // ── Supplier invoices ──────────────────────────────────────────────────────

  /**
   * Posts a supplier invoice: liability + input tax credit + accounting.
   * Duplicate (vendor, invoiceNumber) is rejected (spec §9). When linked to a
   * goods receipt, billed quantities per product must match what was received
   * (three-way match: PO → GRN → invoice). Lines are tax-exclusive costs.
   */
  async createPurchaseInvoice(
    request: TenantRequest,
    data: {
      vendorId: string;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate?: string | null;
      grnId?: string | null;
      lines: Array<{ productId: string; quantity: string; freeQty?: string; unitCost: string }>;
    },
  ) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.vendorOrThrow(orgId, data.vendorId);
    const invoiceNumber = data.invoiceNumber.trim();
    const dupe = await this.prisma.purchaseInvoice.findFirst({ where: { organizationId: orgId, vendorId: data.vendorId, invoiceNumber } });
    if (dupe) throw Conflict('DUPLICATE_ENTITY', `Invoice ${invoiceNumber} is already posted for ${vendor.legalName}`);

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    const interState = Boolean(vendor.stateCode && org?.stateCode && vendor.stateCode !== org.stateCode);
    const at = new Date(`${data.invoiceDate}T12:00:00+05:30`);
    if (at.getTime() > Date.now() + 86_400_000) throw new AppException('VALIDATION_ERROR', 'Invoice date cannot be in the future', 400);

    if (data.grnId) {
      const grn = await this.prisma.goodsReceipt.findFirst({
        where: { id: data.grnId, organizationId: orgId },
        include: { lines: { include: { product: { select: { name: true } } } }, invoices: { select: { invoiceNumber: true } } },
      });
      if (!grn) throw NotFound('Goods receipt not found');
      if (grn.vendorId !== data.vendorId) throw new AppException('VALIDATION_ERROR', 'Goods receipt belongs to a different vendor', 422);
      if (grn.invoices.length > 0) {
        throw Conflict('DUPLICATE_ENTITY', `Goods receipt ${grn.grnNumber} is already invoiced (${grn.invoices[0]!.invoiceNumber})`);
      }
      const received = new Map<string, { qty: bigint; name: string }>();
      for (const l of grn.lines) {
        const r = received.get(l.productId) ?? { qty: 0n, name: l.product.name };
        r.qty += qty3(l.quantity);
        received.set(l.productId, r);
      }
      const billed = new Map<string, bigint>();
      for (const l of data.lines) billed.set(l.productId, (billed.get(l.productId) ?? 0n) + qty3(l.quantity));
      const issues: Array<{ field: string; message: string }> = [];
      for (const [productId, r] of received) {
        const b = billed.get(productId) ?? 0n;
        if (b !== r.qty) issues.push({ field: productId, message: `${r.name}: received ${qtyStr(r.qty)}, billed ${qtyStr(b)}` });
      }
      for (const productId of billed.keys()) {
        if (!received.has(productId)) issues.push({ field: productId, message: 'Billed product was not received on this GRN' });
      }
      if (issues.length > 0) {
        throw new AppException('RECEIPT_QUANTITY_MISMATCH', `Invoice does not match goods receipt ${grn.grnNumber}`, 422, issues);
      }
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: data.lines.map((l) => l.productId) }, organizationId: orgId } });
      const byId = new Map(products.map((p) => [p.id, p]));
      let subtotal = 0n;
      let taxTotal = 0n;
      const lineData: Array<Omit<Prisma.PurchaseInvoiceLineUncheckedCreateInput, 'invoiceId'>> = [];
      for (const line of data.lines) {
        const product = byId.get(line.productId);
        if (!product) throw NotFound(`Product ${line.productId} not found`);
        if (qty3(line.quantity) <= 0n) throw new AppException('VALIDATION_ERROR', 'Invoice quantities must be positive', 400);
        const taxable = amountPaise(line.unitCost, line.quantity);
        const rate = await this.tax.requireRate(orgId, product, at);
        const comp = this.tax.computeExclusive(major(taxable), rate, interState);
        subtotal += taxable;
        taxTotal += toPaise(comp.totalTax);
        lineData.push({
          productId: line.productId,
          quantity: line.quantity,
          freeQty: line.freeQty ?? '0',
          unitCost: line.unitCost,
          taxableValue: comp.taxableValue,
          cgstAmount: comp.cgst,
          sgstAmount: comp.sgst,
          igstAmount: comp.igst,
          cessAmount: comp.cess,
          lineTotal: comp.lineTotal,
        });
      }
      const total = subtotal + taxTotal;
      const created = await tx.purchaseInvoice.create({
        data: {
          organizationId: orgId,
          invoiceNumber,
          vendorId: data.vendorId,
          grnId: data.grnId ?? null,
          invoiceDate: at,
          dueDate: data.dueDate ? new Date(`${data.dueDate}T12:00:00+05:30`) : new Date(at.getTime() + vendor.creditDays * 86_400_000),
          subtotal: major(subtotal),
          taxAmount: major(taxTotal),
          total: major(total),
          status: 'POSTED',
          createdById: request.principal.userId,
          lines: { create: lineData },
        },
      });
      // Dr Inventory (taxable), Dr GST Input (ITC), Cr AP (total).
      const journal = await this.accounting.postJournalEntry(
        request,
        orgId,
        {
          date: at,
          memo: `Purchase invoice ${invoiceNumber} — ${vendor.legalName}`,
          sourceType: 'PURCHASE_INVOICE',
          sourceId: created.id,
          lines: [
            { systemKey: 'INVENTORY', debit: major(subtotal) },
            { systemKey: 'GST_INPUT', debit: major(taxTotal) },
            { systemKey: 'AP', credit: major(total) },
          ],
        },
        tx,
      );
      return tx.purchaseInvoice.update({
        where: { id: created.id },
        data: { journalEntryId: journal.id },
        include: { lines: { include: { product: { select: { name: true } } } }, vendor: { select: { legalName: true } } },
      });
    });

    await this.audit.record({
      event: 'PURCHASE_INVOICE_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'PurchaseInvoice',
      entityId: invoice.id,
      details: { invoiceNumber: invoice.invoiceNumber, vendor: vendor.legalName, total: invoice.total.toFixed(2) },
    });
    return invoice;
  }

  listInvoices(request: TenantRequest, params: { page: number; pageSize: number; status?: string; vendorId?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.PurchaseInvoiceWhereInput = {
      organizationId: orgId,
      ...(params.status ? { status: { in: params.status.split(',') as never[] } } : {}),
      ...(params.vendorId ? { vendorId: params.vendorId } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.purchaseInvoice.count({ where }),
      this.prisma.purchaseInvoice.findMany({
        where,
        include: { vendor: { select: { legalName: true } }, lines: { include: { product: { select: { name: true } } } }, grn: { select: { grnNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  // ── Supplier payments ──────────────────────────────────────────────────────

  async recordPayment(
    request: TenantRequest,
    data: { vendorId: string; amount: string; method: string; reference?: string | null; allocations: Array<{ invoiceId: string; amount: string }> },
  ) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.vendorOrThrow(orgId, data.vendorId);
    const totalPaise = toPaise(data.amount);
    if (totalPaise <= 0n) throw new AppException('VALIDATION_ERROR', 'Payment amount must be positive', 400);
    if (new Set(data.allocations.map((a) => a.invoiceId)).size !== data.allocations.length) {
      throw new AppException('VALIDATION_ERROR', 'Each invoice may be allocated once per payment', 400);
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      let allocated = 0n;
      for (const a of data.allocations) {
        await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE id = ${a.invoiceId} FOR UPDATE`;
        const inv = await tx.purchaseInvoice.findFirst({ where: { id: a.invoiceId, organizationId: orgId, vendorId: data.vendorId } });
        if (!inv) throw NotFound('Purchase invoice not found for this vendor');
        if (inv.status === 'CANCELLED') throw Conflict('STATE_TRANSITION_INVALID', `Invoice ${inv.invoiceNumber} is cancelled`);
        const outstanding = toPaise(inv.total) - toPaise(inv.paidAmount);
        const alloc = toPaise(a.amount);
        if (alloc <= 0n) throw new AppException('VALIDATION_ERROR', 'Allocation amounts must be positive', 400);
        if (alloc > outstanding) {
          throw new AppException('ALLOCATION_EXCEEDS_BALANCE', `Allocation ${a.amount} exceeds outstanding ${major(outstanding)} on invoice ${inv.invoiceNumber}`, 422);
        }
        allocated += alloc;
        const paid = toPaise(inv.paidAmount) + alloc;
        await tx.purchaseInvoice.update({
          where: { id: inv.id },
          data: { paidAmount: major(paid), status: paid >= toPaise(inv.total) ? 'PAID' : 'PARTIALLY_PAID' },
        });
      }
      if (allocated !== totalPaise) {
        throw new AppException('VALIDATION_ERROR', `Payment ${major(totalPaise)} must equal allocations ${major(allocated)}`, 400);
      }
      const paymentNumber = await nextDocNumber(tx, orgId, 'SPAY');
      const created = await tx.supplierPayment.create({
        data: {
          organizationId: orgId,
          paymentNumber,
          vendorId: data.vendorId,
          paymentDate: new Date(),
          amount: major(totalPaise),
          method: data.method,
          reference: data.reference ?? null,
          createdById: request.principal.userId,
          allocations: { create: data.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) },
        },
      });
      const journal = await this.accounting.postJournalEntry(
        request,
        orgId,
        {
          date: new Date(),
          memo: `Supplier payment ${paymentNumber} — ${vendor.legalName}`,
          sourceType: 'SUPPLIER_PAYMENT',
          sourceId: created.id,
          lines: [
            { systemKey: 'AP', debit: major(totalPaise) },
            { systemKey: tenderAccount(data.method), credit: major(totalPaise) },
          ],
        },
        tx,
      );
      return tx.supplierPayment.update({
        where: { id: created.id },
        data: { journalEntryId: journal.id },
        include: { allocations: { include: { invoice: { select: { invoiceNumber: true } } } }, vendor: { select: { legalName: true } } },
      });
    });

    await this.audit.record({
      event: 'SUPPLIER_PAYMENT_RECORDED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'SupplierPayment',
      entityId: payment.id,
      details: { paymentNumber: payment.paymentNumber, vendor: vendor.legalName, amount: payment.amount.toFixed(2), method: data.method },
    });
    return payment;
  }

  listPayments(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.supplierPayment.count({ where: { organizationId: orgId } }),
      this.prisma.supplierPayment.findMany({
        where: { organizationId: orgId },
        include: { vendor: { select: { legalName: true } }, allocations: { include: { invoice: { select: { invoiceNumber: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  /** Vendor ledger: opening, invoices (Cr payable), payments and debit notes (Dr) with running balance. */
  async vendorLedger(request: TenantRequest, vendorId: string) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.vendorOrThrow(orgId, vendorId);
    const [invoices, payments, returns] = await this.prisma.$transaction([
      this.prisma.purchaseInvoice.findMany({ where: { organizationId: orgId, vendorId }, orderBy: { invoiceDate: 'asc' } }),
      this.prisma.supplierPayment.findMany({ where: { organizationId: orgId, vendorId }, orderBy: { paymentDate: 'asc' } }),
      this.prisma.purchaseReturn.findMany({ where: { organizationId: orgId, vendorId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const events = [
      ...invoices.map((i) => ({ date: i.invoiceDate, type: 'INVOICE', doc: i.invoiceNumber, payable: toPaise(i.total), paid: 0n })),
      ...payments.map((p) => ({ date: p.paymentDate, type: `PAYMENT · ${p.method}`, doc: p.paymentNumber, payable: 0n, paid: toPaise(p.amount) })),
      ...returns.map((r) => ({ date: r.createdAt, type: 'DEBIT NOTE', doc: r.returnNumber, payable: 0n, paid: toPaise(r.total) })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    let balance = toPaise(vendor.openingBalance);
    const rows = [{ date: vendor.createdAt, type: 'OPENING', doc: '—', credit: major(balance), debit: '0.00', balance: major(balance) }];
    for (const e of events) {
      balance += e.payable - e.paid;
      rows.push({ date: e.date, type: e.type, doc: e.doc, credit: major(e.payable), debit: major(e.paid), balance: major(balance) });
    }
    const openInvoices = invoices
      .filter((i) => i.status !== 'CANCELLED' && toPaise(i.total) > toPaise(i.paidAmount))
      .map((i) => {
        const daysOverdue = Math.floor((Date.now() - i.dueDate.getTime()) / 86_400_000);
        return {
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          invoiceDate: i.invoiceDate,
          dueDate: i.dueDate,
          total: i.total.toFixed(2),
          paid: i.paidAmount.toFixed(2),
          outstanding: major(toPaise(i.total) - toPaise(i.paidAmount)),
          daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
        };
      });
    return {
      vendor: { id: vendor.id, legalName: vendor.legalName, gstin: vendor.gstin, creditDays: vendor.creditDays, creditLimit: vendor.creditLimit.toFixed(2) },
      rows,
      outstanding: major(balance),
      openInvoices,
    };
  }

  // ── Purchase returns ───────────────────────────────────────────────────────

  /**
   * Debit note: stock out of the returned batches, payable reduced by value +
   * GST, input tax credit reversed. Against an invoice, returned quantities
   * per product cannot exceed what was billed (net of earlier returns).
   */
  async createPurchaseReturn(
    request: TenantRequest,
    data: { vendorId: string; invoiceId?: string | null; reason: string; lines: Array<{ batchId: string; quantity: string; rate: string }> },
  ) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.vendorOrThrow(orgId, data.vendorId);
    if (data.lines.length === 0) throw new AppException('VALIDATION_ERROR', 'Return needs at least one line', 400);
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    const interState = Boolean(vendor.stateCode && org?.stateCode && vendor.stateCode !== org.stateCode);

    const ret = await this.prisma.$transaction(async (tx) => {
      let invoiceBilled: Map<string, bigint> | null = null;
      if (data.invoiceId) {
        await tx.$queryRaw`SELECT id FROM "PurchaseInvoice" WHERE id = ${data.invoiceId} FOR UPDATE`;
        const inv = await tx.purchaseInvoice.findFirst({ where: { id: data.invoiceId, organizationId: orgId }, include: { lines: true } });
        if (!inv) throw NotFound('Purchase invoice not found');
        if (inv.vendorId !== data.vendorId) throw new AppException('VALIDATION_ERROR', 'Invoice belongs to a different vendor', 422);
        invoiceBilled = new Map();
        for (const l of inv.lines) invoiceBilled.set(l.productId, (invoiceBilled.get(l.productId) ?? 0n) + qty3(l.quantity) + qty3(l.freeQty));
        const prior = await tx.purchaseReturnLine.findMany({
          where: { return: { invoiceId: inv.id, organizationId: orgId } },
          include: { batch: { select: { productId: true } } },
        });
        for (const p of prior) invoiceBilled.set(p.batch.productId, (invoiceBilled.get(p.batch.productId) ?? 0n) - qty3(p.quantity));
      }

      let taxable = 0n;
      let tax = 0n;
      let cost = 0n;
      const lineRows: Array<{ batchId: string; warehouseId: string; quantity: string; rate: string; taxAmount: bigint; lineTotal: bigint }> = [];
      for (const line of data.lines) {
        const q = qty3(line.quantity);
        if (q <= 0n) throw new AppException('VALIDATION_ERROR', 'Return quantities must be positive', 400);
        const batch = await tx.inventoryBatch.findFirst({ where: { id: line.batchId, organizationId: orgId }, include: { product: true } });
        if (!batch) throw NotFound('Batch not found');
        if (invoiceBilled) {
          const left = invoiceBilled.get(batch.productId);
          if (left === undefined) throw new AppException('VALIDATION_ERROR', `${batch.product.name} is not on the selected invoice`, 422);
          if (q > left) {
            throw new AppException('RETURN_QUANTITY_EXCEEDS_ORIGINAL', `Return ${qtyStr(q)} of ${batch.product.name} exceeds invoiced ${qtyStr(left)}`, 422);
          }
          invoiceBilled.set(batch.productId, left - q);
        }
        const lineTaxable = amountPaise(line.rate, line.quantity);
        const rate = await this.tax.requireRate(orgId, batch.product, new Date());
        const comp = this.tax.computeExclusive(major(lineTaxable), rate, interState);
        taxable += lineTaxable;
        tax += toPaise(comp.totalTax);
        cost += amountPaise(batch.purchaseRate, line.quantity);
        lineRows.push({ batchId: batch.id, warehouseId: batch.warehouseId, quantity: line.quantity, rate: line.rate, taxAmount: toPaise(comp.totalTax), lineTotal: toPaise(comp.lineTotal) });
      }

      const returnNumber = await nextDocNumber(tx, orgId, 'PRET');
      const created = await tx.purchaseReturn.create({
        data: {
          organizationId: orgId,
          returnNumber,
          vendorId: data.vendorId,
          invoiceId: data.invoiceId ?? null,
          reason: data.reason,
          status: 'DISPATCHED',
          total: major(taxable + tax),
          taxAmount: major(tax),
          createdById: request.principal.userId,
          lines: {
            create: lineRows.map((l) => ({ batchId: l.batchId, quantity: l.quantity, rate: l.rate, taxAmount: major(l.taxAmount), lineTotal: major(l.lineTotal) })),
          },
        },
      });
      for (const row of lineRows) {
        await this.inventory.applyStockDelta(tx, {
          organizationId: orgId,
          batchId: row.batchId,
          warehouseId: row.warehouseId,
          delta: -Number(row.quantity),
          actorUserId: request.principal.userId,
          movementType: 'PURCHASE_RETURN_OUT',
          reason: `Purchase return ${returnNumber}: ${data.reason}`,
          sourceDocument: 'PURCHASE_RETURN',
          sourceDocumentId: created.id,
        });
      }

      // Dr AP (value + GST); Cr GST Input (ITC reversal); Cr Inventory at carrying cost;
      // any rate-vs-cost difference goes to inventory gain/loss.
      const diff = taxable - cost;
      const journal = await this.accounting.postJournalEntry(
        request,
        orgId,
        {
          date: new Date(),
          memo: `Purchase return ${returnNumber} — ${vendor.legalName} (${data.reason})`,
          sourceType: 'PURCHASE_RETURN',
          sourceId: created.id,
          lines: [
            { systemKey: 'AP', debit: major(taxable + tax) },
            { systemKey: 'GST_INPUT', credit: major(tax) },
            { systemKey: 'INVENTORY', credit: major(cost) },
            ...(diff > 0n ? [{ systemKey: 'INVENTORY_GAIN', credit: major(diff) }] : []),
            ...(diff < 0n ? [{ systemKey: 'INVENTORY_LOSS', debit: major(-diff) }] : []),
          ],
        },
        tx,
      );
      return tx.purchaseReturn.update({
        where: { id: created.id },
        data: { journalEntryId: journal.id },
        include: { lines: { include: { batch: { include: { product: { select: { name: true, sku: true } } } } } }, vendor: { select: { legalName: true } } },
      });
    });

    await this.audit.record({
      event: 'PURCHASE_RETURN_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'PurchaseReturn',
      entityId: ret.id,
      details: { returnNumber: ret.returnNumber, vendor: vendor.legalName, total: ret.total.toFixed(2), reason: data.reason },
    });
    return ret;
  }

  listReturns(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.$transaction([
      this.prisma.purchaseReturn.count({ where: { organizationId: orgId } }),
      this.prisma.purchaseReturn.findMany({
        where: { organizationId: orgId },
        include: { lines: { include: { batch: { include: { product: { select: { name: true, sku: true } } } } } }, vendor: { select: { legalName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }
}
