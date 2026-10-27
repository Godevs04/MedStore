import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { NotFound, ValidationFailed } from '../common/app-exception.js';
import { major, toPaise } from '../common/money.js';
import { gstinIssues, INDIAN_STATE_CODES, vendorIssues } from '@medicore/validation';

const DAY = 86_400_000;

export interface VendorInput {
  legalName: string;
  tradeName?: string | null;
  gstin?: string | null;
  pan?: string | null;
  gstRegistrationType?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateCode?: string | null;
  pinCode?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  creditDays?: number;
  creditLimit?: string;
  openingBalance?: string;
  status?: string;
  drugLicenceNumber?: string | null;
  drugLicenceExpiry?: string | null;
  bankAccount?: string | null;
  ifsc?: string | null;
  notes?: string | null;
}

export interface CustomerInput {
  name: string;
  category?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  stateCode?: string | null;
  pinCode?: string | null;
  creditDays?: number;
  creditLimit?: string;
  openingBalance?: string;
  status?: string;
  isWholesale?: boolean;
  notes?: string | null;
}

/**
 * Vendor and customer master data with credit policy fields (spec §10, §16).
 * The ledger/balance effects of openingBalance are realised in Phase 7
 * (accounting); until then the field is stored and reported.
 */
@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GSTIN state prefix and embedded PAN must agree with the declared state/PAN
   * (spec §6). Format check only — never represented as government verification.
   */
  assertGstinStateConsistency(gstin: string | null | undefined, stateCode: string | null | undefined, pan?: string | null): void {
    const issues = gstinIssues({ gstin, stateCode, pan });
    if (issues.length) throw ValidationFailed(issues);
  }

  // ── Vendors ────────────────────────────────────────────────────────────────

  async listVendors(
    request: TenantRequest,
    params: { page: number; pageSize: number; search?: string; status?: string; stateCode?: string; withBalances?: boolean },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.VendorWhereInput = { organizationId: orgId };
    if (params.stateCode) where.stateCode = params.stateCode;
    if (params.search) {
      where.OR = [
        { legalName: { contains: params.search, mode: 'insensitive' } },
        { tradeName: { contains: params.search, mode: 'insensitive' } },
        { gstin: { contains: params.search.toUpperCase() } },
        { phone: { contains: params.search } },
        { contactName: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status) where.status = params.status as Prisma.EnumVendorStatusFilter['equals'];

    const [total, items] = await this.prisma.$transaction([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({
        where,
        orderBy: { legalName: 'asc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    if (!params.withBalances || items.length === 0) return { total, items };

    const open = await this.prisma.purchaseInvoice.findMany({
      where: { organizationId: orgId, vendorId: { in: items.map((v) => v.id) }, status: { not: 'CANCELLED' } },
      select: { vendorId: true, total: true, paidAmount: true, dueDate: true },
    });
    const now = Date.now();
    const byVendor = new Map<string, { payable: bigint; overdue: bigint; openInvoices: number }>();
    for (const inv of open) {
      const due = toPaise(inv.total) - toPaise(inv.paidAmount);
      if (due <= 0n) continue;
      const agg = byVendor.get(inv.vendorId) ?? { payable: 0n, overdue: 0n, openInvoices: 0 };
      agg.payable += due;
      agg.openInvoices += 1;
      if (inv.dueDate.getTime() < now) agg.overdue += due;
      byVendor.set(inv.vendorId, agg);
    }
    return {
      total,
      items: items.map((v) => {
        const agg = byVendor.get(v.id);
        return {
          ...v,
          payable: major(toPaise(v.openingBalance) + (agg?.payable ?? 0n)),
          overdue: major(agg?.overdue ?? 0n),
          openInvoices: agg?.openInvoices ?? 0,
        };
      }),
    };
  }

  /** Products bought from this vendor: quantity, spend and the latest rate paid. */
  async vendorProducts(request: TenantRequest, vendorId: string, limit: number) {
    const orgId = request.tenantContext.organizationId;
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, organizationId: orgId }, select: { id: true } });
    if (!vendor) throw NotFound('Vendor not found');
    const lines = await this.prisma.purchaseInvoiceLine.findMany({
      where: { invoice: { organizationId: orgId, vendorId, status: { not: 'CANCELLED' } } },
      select: {
        productId: true,
        quantity: true,
        freeQty: true,
        unitCost: true,
        lineTotal: true,
        invoice: { select: { invoiceDate: true } },
        product: { select: { name: true, sku: true, mrp: true } },
      },
      orderBy: { invoice: { invoiceDate: 'desc' } },
      take: 5000,
    });
    const agg = new Map<string, { productId: string; name: string; sku: string; mrp: string | null; quantity: number; freeQty: number; spend: bigint; invoices: number; lastRate: string; lastPurchased: Date }>();
    for (const l of lines) {
      const row = agg.get(l.productId);
      if (row) {
        row.quantity += Number(l.quantity);
        row.freeQty += Number(l.freeQty);
        row.spend += toPaise(l.lineTotal);
        row.invoices += 1;
      } else {
        agg.set(l.productId, {
          productId: l.productId,
          name: l.product.name,
          sku: l.product.sku,
          mrp: l.product.mrp ? l.product.mrp.toFixed(2) : null,
          quantity: Number(l.quantity),
          freeQty: Number(l.freeQty),
          spend: toPaise(l.lineTotal),
          invoices: 1,
          lastRate: l.unitCost.toFixed(2),
          lastPurchased: l.invoice.invoiceDate,
        });
      }
    }
    return [...agg.values()]
      .sort((a, b) => (b.spend > a.spend ? 1 : b.spend < a.spend ? -1 : 0))
      .slice(0, limit)
      .map((r) => ({ ...r, quantity: r.quantity.toFixed(3), freeQty: r.freeQty.toFixed(3), spend: major(r.spend) }));
  }

  async getVendor(request: TenantRequest, vendorId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: vendorId, organizationId: request.tenantContext.organizationId },
      include: { productLinks: { include: { product: { select: { id: true, name: true, sku: true } } } } },
    });
    if (!vendor) throw NotFound('Vendor not found');
    return vendor;
  }

  async createVendor(request: TenantRequest, data: VendorInput) {
    const orgId = request.tenantContext.organizationId;
    const issues = vendorIssues(data);
    if (issues.length) throw ValidationFailed(issues);
    const vendor = await this.prisma.vendor.create({
      data: this.toVendorCreate(orgId, data, request.principal.userId),
    });
    await this.audit.record({
      event: 'VENDOR_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Vendor',
      entityId: vendor.id,
      details: { legalName: vendor.legalName },
    });
    return vendor;
  }

  async updateVendor(request: TenantRequest, vendorId: string, data: Partial<VendorInput>) {
    const orgId = request.tenantContext.organizationId;
    const existing = await this.prisma.vendor.findFirst({ where: { id: vendorId, organizationId: orgId } });
    if (!existing) throw NotFound('Vendor not found');
    const pick = <K extends keyof VendorInput>(k: K) => (data[k] !== undefined ? data[k] : (existing as Record<string, unknown>)[k]) as VendorInput[K];
    const issues = vendorIssues({
      gstin: pick('gstin'),
      pan: pick('pan'),
      stateCode: pick('stateCode'),
      gstRegistrationType: pick('gstRegistrationType'),
      bankAccount: pick('bankAccount'),
      ifsc: pick('ifsc'),
    });
    if (issues.length) throw ValidationFailed(issues);
    const vendor = await this.prisma.vendor.update({ where: { id: vendorId }, data: this.toVendorUpdate(data) });
    await this.audit.record({
      event: 'VENDOR_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Vendor',
      entityId: vendorId,
      details: { fields: Object.keys(data) },
    });
    return vendor;
  }

  private toVendorCreate(orgId: string, data: VendorInput, userId: string): Prisma.VendorUncheckedCreateInput {
    return {
      organizationId: orgId,
      legalName: data.legalName,
      tradeName: data.tradeName ?? null,
      gstin: data.gstin ?? null,
      pan: data.pan ?? null,
      gstRegistrationType: data.gstRegistrationType ?? 'REGULAR',
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      stateCode: data.stateCode ?? null,
      pinCode: data.pinCode ?? null,
      contactName: data.contactName ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      creditDays: data.creditDays ?? 30,
      creditLimit: data.creditLimit ?? '0',
      openingBalance: data.openingBalance ?? '0',
      status: (data.status ?? 'ACTIVE') as Prisma.VendorUncheckedCreateInput['status'],
      drugLicenceNumber: data.drugLicenceNumber ?? null,
      drugLicenceExpiry: data.drugLicenceExpiry ? new Date(`${data.drugLicenceExpiry}T00:00:00Z`) : null,
      bankAccount: data.bankAccount ?? null,
      ifsc: data.ifsc ?? null,
      notes: data.notes ?? null,
      createdByUserId: userId,
    };
  }

  private toVendorUpdate(data: Partial<VendorInput>): Prisma.VendorUncheckedUpdateInput {
    const out: Prisma.VendorUncheckedUpdateInput = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      (out as Record<string, unknown>)[key] =
        key === 'drugLicenceExpiry' && typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
    }
    return out;
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  async listCustomers(
    request: TenantRequest,
    params: { page: number; pageSize: number; search?: string; status?: string; isWholesale?: boolean; withBalances?: boolean },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.CustomerWhereInput = { organizationId: orgId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
        { gstin: { contains: params.search.toUpperCase() } },
        { category: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.status) where.status = params.status as Prisma.EnumCustomerStatusFilter['equals'];
    if (params.isWholesale !== undefined) where.isWholesale = params.isWholesale;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    if (!params.withBalances || items.length === 0) return { total, items };

    const open = await this.prisma.salesInvoice.findMany({
      where: { organizationId: orgId, customerId: { in: items.map((c) => c.id) }, status: { not: 'CANCELLED' }, creditAmount: { gt: 0 } },
      select: { customerId: true, creditAmount: true, invoiceDate: true },
    });
    const now = Date.now();
    const terms = new Map(items.map((c) => [c.id, c.creditDays]));
    const byCustomer = new Map<string, { outstanding: bigint; overdue: bigint; oldestDueDays: number }>();
    for (const inv of open) {
      if (!inv.customerId) continue;
      const due = toPaise(inv.creditAmount);
      const agg = byCustomer.get(inv.customerId) ?? { outstanding: 0n, overdue: 0n, oldestDueDays: 0 };
      agg.outstanding += due;
      const overdueDays = Math.floor((now - inv.invoiceDate.getTime()) / DAY) - (terms.get(inv.customerId) ?? 0);
      if (overdueDays > 0) {
        agg.overdue += due;
        agg.oldestDueDays = Math.max(agg.oldestDueDays, overdueDays);
      }
      byCustomer.set(inv.customerId, agg);
    }
    return {
      total,
      items: items.map((c) => {
        const agg = byCustomer.get(c.id);
        return {
          ...c,
          outstanding: major(toPaise(c.openingBalance) + (agg?.outstanding ?? 0n)),
          overdue: major(agg?.overdue ?? 0n),
          oldestDueDays: agg?.oldestDueDays ?? 0,
        };
      }),
    };
  }

  /** What this customer buys most (net of returns), for repeat orders and counselling. */
  async customerTopProducts(request: TenantRequest, customerId: string, limit: number) {
    const orgId = request.tenantContext.organizationId;
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: orgId }, select: { id: true } });
    if (!customer) throw NotFound('Customer not found');
    const lines = await this.prisma.salesInvoiceLine.findMany({
      where: { invoice: { organizationId: orgId, customerId, status: { not: 'CANCELLED' } } },
      select: { productId: true, productName: true, quantity: true, returnedQty: true, lineTotal: true, invoice: { select: { invoiceDate: true } } },
      orderBy: { invoice: { invoiceDate: 'desc' } },
      take: 5000,
    });
    const agg = new Map<string, { productId: string; name: string; quantity: number; value: bigint; bills: number; lastBought: Date }>();
    for (const l of lines) {
      const sold = Number(l.quantity);
      const net = sold - Number(l.returnedQty);
      if (net <= 0) continue;
      const value = sold > 0 ? (toPaise(l.lineTotal) * BigInt(Math.round(net * 1000))) / BigInt(Math.round(sold * 1000)) : 0n;
      const row = agg.get(l.productId);
      if (row) {
        row.quantity += net;
        row.value += value;
        row.bills += 1;
      } else {
        agg.set(l.productId, { productId: l.productId, name: l.productName, quantity: net, value, bills: 1, lastBought: l.invoice.invoiceDate });
      }
    }
    return [...agg.values()]
      .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
      .slice(0, limit)
      .map((r) => ({ ...r, quantity: r.quantity.toFixed(3), value: major(r.value) }));
  }

  async getCustomer(request: TenantRequest, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: request.tenantContext.organizationId },
    });
    if (!customer) throw NotFound('Customer not found');
    return customer;
  }

  async createCustomer(request: TenantRequest, data: CustomerInput) {
    const orgId = request.tenantContext.organizationId;
    this.assertGstinStateConsistency(data.gstin, data.stateCode);
    const customer = await this.prisma.customer.create({
      data: {
        organizationId: orgId,
        name: data.name,
        category: data.category ?? null,
        gstin: data.gstin ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        addressLine1: data.addressLine1 ?? null,
        city: data.city ?? null,
        stateCode: data.stateCode ?? null,
        pinCode: data.pinCode ?? null,
        creditDays: data.creditDays ?? 0,
        creditLimit: data.creditLimit ?? '0',
        openingBalance: data.openingBalance ?? '0',
        status: (data.status ?? 'ACTIVE') as Prisma.CustomerUncheckedCreateInput['status'],
        isWholesale: data.isWholesale ?? false,
        notes: data.notes ?? null,
        createdByUserId: request.principal.userId,
      },
    });
    await this.audit.record({
      event: 'CUSTOMER_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Customer',
      entityId: customer.id,
      details: { name: customer.name },
    });
    return customer;
  }

  async updateCustomer(request: TenantRequest, customerId: string, data: Partial<CustomerInput>) {
    const orgId = request.tenantContext.organizationId;
    const existing = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: orgId } });
    if (!existing) throw NotFound('Customer not found');
    this.assertGstinStateConsistency(
      data.gstin !== undefined ? data.gstin : existing.gstin,
      data.stateCode !== undefined ? data.stateCode : existing.stateCode,
    );
    const update: Prisma.CustomerUncheckedUpdateInput = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      (update as Record<string, unknown>)[key] = value;
    }
    const customer = await this.prisma.customer.update({ where: { id: customerId }, data: update });
    await this.audit.record({
      event: 'CUSTOMER_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Customer',
      entityId: customerId,
      details: { fields: Object.keys(data) },
    });
    return customer;
  }
}

// Re-export for consumers needing state validation helpers.
export { INDIAN_STATE_CODES };
