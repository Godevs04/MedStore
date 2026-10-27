import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';

export interface SearchHit {
  type: 'product' | 'customer' | 'vendor' | 'salesInvoice' | 'purchaseInvoice' | 'batch';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/**
 * Workspace-wide quick search for the command palette. Each result group is
 * only queried when the caller holds the matching read permission.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(request: TenantRequest, q: string, limit: number) {
    const { organizationId, permissions } = request.tenantContext;
    const can = (p: string) => permissions.has(p);
    const contains = { contains: q, mode: 'insensitive' as const };
    const take = limit;

    const [products, customers, vendors, sales, purchases, batches] = await Promise.all([
      can('products.read')
        ? this.prisma.product.findMany({
            where: { organizationId, OR: [{ name: contains }, { genericName: contains }, { sku: contains }, { barcodes: { some: { barcode: q } } }] },
            select: { id: true, name: true, genericName: true, sku: true, strength: true },
            orderBy: { name: 'asc' },
            take,
          })
        : [],
      can('customers.read')
        ? this.prisma.customer.findMany({
            where: { organizationId, OR: [{ name: contains }, { phone: { contains: q } }, { gstin: contains }] },
            select: { id: true, name: true, phone: true, city: true },
            orderBy: { name: 'asc' },
            take,
          })
        : [],
      can('vendors.read')
        ? this.prisma.vendor.findMany({
            where: { organizationId, OR: [{ legalName: contains }, { tradeName: contains }, { gstin: contains }] },
            select: { id: true, legalName: true, gstin: true, city: true },
            orderBy: { legalName: 'asc' },
            take,
          })
        : [],
      can('sales.read')
        ? this.prisma.salesInvoice.findMany({
            where: { organizationId, OR: [{ invoiceNumber: contains }, { walkInName: contains }, { customer: { name: contains } }] },
            select: { id: true, invoiceNumber: true, total: true, invoiceDate: true, walkInName: true, customer: { select: { name: true } } },
            orderBy: { invoiceDate: 'desc' },
            take,
          })
        : [],
      can('purchases.read')
        ? this.prisma.purchaseInvoice.findMany({
            where: { organizationId, OR: [{ invoiceNumber: contains }, { vendor: { legalName: contains } }] },
            select: { id: true, invoiceNumber: true, total: true, invoiceDate: true, vendor: { select: { legalName: true } } },
            orderBy: { invoiceDate: 'desc' },
            take,
          })
        : [],
      can('inventory.read')
        ? this.prisma.inventoryBatch.findMany({
            where: { organizationId, batchNumber: contains },
            select: { id: true, batchNumber: true, expiryDate: true, product: { select: { name: true } } },
            orderBy: { expiryDate: 'asc' },
            take,
          })
        : [],
    ]);

    const day = (d: Date) => d.toISOString().slice(0, 10);
    const hits: SearchHit[] = [
      ...products.map((p) => ({
        type: 'product' as const,
        id: p.id,
        title: [p.name, p.strength].filter(Boolean).join(' '),
        subtitle: [p.genericName, p.sku].filter(Boolean).join(' · ') || null,
        href: `/products?focus=${p.id}`,
      })),
      ...customers.map((c) => ({
        type: 'customer' as const,
        id: c.id,
        title: c.name,
        subtitle: [c.phone, c.city].filter(Boolean).join(' · ') || null,
        href: `/customers?focus=${c.id}`,
      })),
      ...vendors.map((v) => ({
        type: 'vendor' as const,
        id: v.id,
        title: v.legalName,
        subtitle: [v.gstin, v.city].filter(Boolean).join(' · ') || null,
        href: `/vendors?focus=${v.id}`,
      })),
      ...sales.map((s) => ({
        type: 'salesInvoice' as const,
        id: s.id,
        title: s.invoiceNumber,
        subtitle: `${s.customer?.name ?? s.walkInName ?? 'Walk-in'} · ₹${s.total.toFixed(2)} · ${day(s.invoiceDate)}`,
        href: `/sales-history/${s.id}`,
      })),
      ...purchases.map((p) => ({
        type: 'purchaseInvoice' as const,
        id: p.id,
        title: p.invoiceNumber,
        subtitle: `${p.vendor.legalName} · ₹${p.total.toFixed(2)} · ${day(p.invoiceDate)}`,
        href: `/purchasing?tab=invoices&focus=${p.id}`,
      })),
      ...batches.map((b) => ({
        type: 'batch' as const,
        id: b.id,
        title: `${b.product.name} — ${b.batchNumber}`,
        subtitle: `Expires ${day(b.expiryDate)}`,
        href: `/batches?focus=${b.id}`,
      })),
    ];
    return { query: q, items: hits };
  }
}
