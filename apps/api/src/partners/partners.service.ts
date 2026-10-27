import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { Conflict, NotFound } from '../common/app-exception.js';
import { INDIAN_STATE_CODES } from '@medicore/validation';

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
   * GSTIN state-code prefix must match the declared state (spec §6).
   * Format check only — never represented as government verification.
   */
  assertGstinStateConsistency(gstin: string | null | undefined, stateCode: string | null | undefined): void {
    if (gstin && stateCode) {
      const prefix = gstin.slice(0, 2);
      if (prefix !== stateCode) {
        throw Conflict(
          'VALIDATION_ERROR',
          `GSTIN state code (${prefix}) does not match the declared state (${stateCode})`,
        );
      }
    }
  }

  // ── Vendors ────────────────────────────────────────────────────────────────

  async listVendors(
    request: TenantRequest,
    params: { page: number; pageSize: number; search?: string; status?: string },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.VendorWhereInput = { organizationId: orgId };
    if (params.search) {
      where.OR = [
        { legalName: { contains: params.search, mode: 'insensitive' } },
        { tradeName: { contains: params.search, mode: 'insensitive' } },
        { gstin: { contains: params.search } },
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
    return { total, items };
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
    this.assertGstinStateConsistency(data.gstin, data.stateCode);
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
    this.assertGstinStateConsistency(data.gstin ?? existing.gstin, data.stateCode ?? existing.stateCode);
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
      notes: data.notes ?? null,
      createdByUserId: userId,
    };
  }

  private toVendorUpdate(data: Partial<VendorInput>): Prisma.VendorUncheckedUpdateInput {
    const out: Prisma.VendorUncheckedUpdateInput = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      (out as Record<string, unknown>)[key] =
        key === 'status' ? (value) : value;
    }
    return out;
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  async listCustomers(
    request: TenantRequest,
    params: { page: number; pageSize: number; search?: string; status?: string; isWholesale?: boolean },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.CustomerWhereInput = { organizationId: orgId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
        { gstin: { contains: params.search } },
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
    return { total, items };
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
    this.assertGstinStateConsistency(data.gstin ?? existing.gstin, data.stateCode ?? existing.stateCode);
    const update: Prisma.CustomerUncheckedUpdateInput = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      (update as Record<string, unknown>)[key] =
        key === 'status' ? (value) : value;
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
