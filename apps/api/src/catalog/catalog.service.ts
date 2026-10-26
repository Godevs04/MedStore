import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { Conflict, NotFound } from '../common/app-exception.js';

export interface PaginatedParams {
  page: number;
  pageSize: number;
}

/** Product creation payload: scalar fields plus plain barcode strings. Organization comes from the tenant context. */
export type CreateProductInput = Omit<Prisma.ProductUncheckedCreateInput, 'barcodes' | 'organizationId' | 'createdByUserId'> & {
  barcodes?: string[];
};

/** Product update payload: scalar fields plus plain barcode strings. */
export type UpdateProductInput = Partial<Omit<Prisma.ProductUncheckedUpdateInput, 'barcodes'>> & { barcodes?: string[] };

/**
 * Product catalog, taxonomy, and versioned tax configuration (spec §7, §13).
 * All operations are organization-scoped by the tenant context.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Taxonomy ───────────────────────────────────────────────────────────────

  listCategories(request: TenantRequest) {
    return this.prisma.productCategory.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      include: { children: true, _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(request: TenantRequest, data: { name: string; parentId?: string | null; description?: string | null }) {
    const category = await this.prisma.productCategory.create({
      data: { organizationId: request.tenantContext.organizationId, name: data.name, parentId: data.parentId ?? null, description: data.description ?? null },
    });
    return category;
  }

  listManufacturers(request: TenantRequest) {
    return this.prisma.manufacturer.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async createManufacturer(request: TenantRequest, data: { name: string; contactEmail?: string | null; contactPhone?: string | null; notes?: string | null }) {
    return this.prisma.manufacturer.create({
      data: {
        organizationId: request.tenantContext.organizationId,
        name: data.name,
        contactEmail: data.contactEmail ?? null,
        contactPhone: data.contactPhone ?? null,
        notes: data.notes ?? null,
      },
    });
  }

  // ── Tax rate versions ──────────────────────────────────────────────────────

  listTaxRates(request: TenantRequest) {
    return this.prisma.taxRateVersion.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async createTaxRate(
    request: TenantRequest,
    data: {
      hsnCode: string;
      description: string;
      cgstPercent?: string | null;
      sgstPercent?: string | null;
      igstPercent?: string | null;
      cessPercent?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ) {
    const taxRate = await this.prisma.taxRateVersion.create({
      data: {
        organizationId: request.tenantContext.organizationId,
        hsnCode: data.hsnCode,
        description: data.description,
        cgstPercent: data.cgstPercent ?? null,
        sgstPercent: data.sgstPercent ?? null,
        igstPercent: data.igstPercent ?? null,
        cessPercent: data.cessPercent ?? null,
        effectiveFrom: new Date(`${data.effectiveFrom}T00:00:00Z`),
        effectiveTo: data.effectiveTo ? new Date(`${data.effectiveTo}T00:00:00Z`) : null,
      },
    });
    await this.audit.record({
      event: 'TAX_CONFIG_UPDATED',
      organizationId: request.tenantContext.organizationId,
      actorUserId: request.principal.userId,
      entityType: 'TaxRateVersion',
      entityId: taxRate.id,
      details: { hsnCode: data.hsnCode, effectiveFrom: data.effectiveFrom },
    });
    return taxRate;
  }

  /** Resolves the tax version effective for an HSN at a point in time. */
  async resolveTaxRate(organizationId: string, hsnCode: string, at: Date) {
    return this.prisma.taxRateVersion.findFirst({
      where: {
        organizationId,
        hsnCode,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // ── Products ───────────────────────────────────────────────────────────────

  async listProducts(
    request: TenantRequest,
    params: PaginatedParams & { search?: string; categoryId?: string; status?: string; sortBy?: string; sortDirection?: 'asc' | 'desc' },
  ) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.ProductWhereInput = { organizationId: orgId };
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { genericName: { contains: params.search, mode: 'insensitive' } },
        { sku: { contains: params.search, mode: 'insensitive' } },
        { brand: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.status) where.status = params.status as Prisma.EnumProductStatusFilter['equals'];

    const sortable = new Set(['name', 'sku', 'mrp', 'sellingPrice', 'createdAt', 'status']);
    const sortBy = params.sortBy && sortable.has(params.sortBy) ? params.sortBy : 'createdAt';

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          manufacturer: { select: { id: true, name: true } },
          taxRateVersion: { select: { id: true, hsnCode: true, cgstPercent: true, sgstPercent: true, igstPercent: true } },
          barcodes: true,
        },
        orderBy: { [sortBy]: params.sortDirection ?? 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return { total, items };
  }

  async getProduct(request: TenantRequest, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: request.tenantContext.organizationId },
      include: {
        category: true,
        manufacturer: true,
        taxRateVersion: true,
        barcodes: true,
        changeHistory: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!product) throw NotFound('Product not found');
    return product;
  }

  /** Barcode search across multiple barcodes per product (POS lookup path). */
  async findByBarcode(request: TenantRequest, barcode: string) {
    return this.prisma.product.findFirst({
      where: {
        organizationId: request.tenantContext.organizationId,
        status: 'ACTIVE',
        barcodes: { some: { barcode } },
      },
      include: { barcodes: true, taxRateVersion: true },
    });
  }

  async createProduct(request: TenantRequest, data: CreateProductInput) {
    const orgId = request.tenantContext.organizationId;
    const { barcodes, ...productData } = data;
    const existing = await this.prisma.product.findUnique({
      where: { organizationId_sku: { organizationId: orgId, sku: productData.sku } },
    });
    if (existing) throw Conflict('DUPLICATE_ENTITY', `SKU "${productData.sku}" already exists`);

    const product = await this.prisma.product.create({
      data: {
        ...productData,
        organizationId: orgId,
        createdByUserId: request.principal.userId,
        barcodes: barcodes?.length ? { create: barcodes.map((b) => ({ barcode: b })) } : undefined,
        changeHistory: {
          create: { actorUserId: request.principal.userId, changeType: 'CREATED', details: { name: productData.name } },
        },
      },
      include: { barcodes: true },
    });
    await this.audit.record({
      event: 'PRODUCT_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      actorEmail: request.principal.email,
      entityType: 'Product',
      entityId: product.id,
      details: { sku: product.sku, name: product.name },
    });
    return product;
  }

  async updateProduct(request: TenantRequest, productId: string, data: UpdateProductInput) {
    const orgId = request.tenantContext.organizationId;
    const { barcodes, ...productData } = data;
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!existing) throw NotFound('Product not found');

    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: productId },
        data: productData,
        include: { barcodes: true },
      });
      if (barcodes) {
        await tx.productBarcode.deleteMany({ where: { productId } });
        if (barcodes.length > 0) {
          await tx.productBarcode.createMany({
            data: barcodes.map((b) => ({ productId, barcode: b })),
          });
        }
      }
      await tx.productChangeHistory.create({
        data: {
          productId,
          actorUserId: request.principal.userId,
          changeType: 'UPDATED',
          details: { fields: Object.keys(productData) },
        },
      });
      return updated;
    });

    await this.audit.record({
      event: 'PRODUCT_UPDATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Product',
      entityId: productId,
      details: { fields: Object.keys(productData) },
    });
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: { barcodes: true, category: true, manufacturer: true, taxRateVersion: true },
    });
  }

  async deactivateProduct(request: TenantRequest, productId: string) {
    const orgId = request.tenantContext.organizationId;
    const existing = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: orgId },
    });
    if (!existing) throw NotFound('Product not found');
    await this.prisma.product.update({ where: { id: productId }, data: { status: 'INACTIVE' } });
    await this.prisma.productChangeHistory.create({
      data: { productId, actorUserId: request.principal.userId, changeType: 'DEACTIVATED' },
    });
    await this.audit.record({
      event: 'PRODUCT_DEACTIVATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Product',
      entityId: productId,
    });
    return { deactivated: true };
  }

  /** Duplicate-detection helper for import flows and manual creation. */
  async findDuplicates(request: TenantRequest, candidates: Array<{ name: string; genericName?: string | null; strength?: string | null }>) {
    const orgId = request.tenantContext.organizationId;
    const names = candidates.map((c) => c.name.toLowerCase());
    const rows = await this.prisma.product.findMany({
      where: { organizationId: orgId, OR: [{ name: { in: names, mode: 'insensitive' } }] },
      select: { id: true, name: true, genericName: true, strength: true, dosageForm: true },
    });
    return candidates.map((c) => ({
      candidate: c,
      matches: rows.filter(
        (r) =>
          r.name.toLowerCase() === c.name.toLowerCase() &&
          // Never merge potentially different strengths/forms (spec §7).
          (r.strength ?? '') === (c.strength ?? ''),
      ),
    }));
  }
}
