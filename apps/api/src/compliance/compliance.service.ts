import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException, NotFound } from '../common/app-exception.js';
import { major, toPaise } from '../common/money.js';

export const LICENCE_TYPES = ['FORM_20', 'FORM_21', 'FORM_20B', 'FORM_21B', 'FORM_20F', 'FORM_20G', 'NARCOTIC', 'FSSAI', 'GST', 'TRADE', 'OTHER'] as const;

const range = (from?: string, to?: string): Prisma.DateTimeFilter | undefined =>
  from || to
    ? {
        ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}),
      }
    : undefined;

type TaxBucket = { taxable: bigint; cgst: bigint; sgst: bigint; igst: bigint; cess: bigint; count: number };
const emptyBucket = (): TaxBucket => ({ taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n, cess: 0n, count: 0 });
const fmtBucket = (b: TaxBucket) => ({
  taxable: major(b.taxable),
  cgst: major(b.cgst),
  sgst: major(b.sgst),
  igst: major(b.igst),
  cess: major(b.cess),
  totalTax: major(b.cgst + b.sgst + b.igst + b.cess),
  count: b.count,
});

/**
 * Pharmacy compliance (spec §14) and GST summaries (spec §13).
 * H1 register: 3-year retention window per rule 65(3)(h).
 * E-invoice/e-way: registry shows NOT_CONNECTED — no fabrication (spec §1.32).
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private h1Where(orgId: string, params: { from?: string; to?: string; search?: string }): Prisma.PrescriptionRecordWhereInput {
    const threeYearsAgo = new Date();
    threeYearsAgo.setUTCFullYear(threeYearsAgo.getUTCFullYear() - 3);
    const r = range(params.from, params.to);
    return {
      organizationId: orgId,
      dispensedAt: { gte: r?.gte && (r.gte as Date) > threeYearsAgo ? r.gte : threeYearsAgo, ...(r?.lte ? { lte: r.lte } : {}) },
      ...(params.search
        ? {
            OR: [
              { patientName: { contains: params.search, mode: 'insensitive' } },
              { prescriberName: { contains: params.search, mode: 'insensitive' } },
              { drugName: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  /** Schedule H1 register, entries within the 3-year retention window. */
  async h1Register(request: TenantRequest, params: { page: number; pageSize: number; from?: string; to?: string; search?: string }) {
    const where = this.h1Where(request.tenantContext.organizationId, params);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.prescriptionRecord.count({ where }),
      this.prisma.prescriptionRecord.findMany({
        where,
        include: { invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true } } },
        orderBy: { dispensedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return {
      items,
      pageInfo: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
        hasNextPage: params.page * params.pageSize < total,
        hasPreviousPage: params.page > 1,
      },
    };
  }

  /** Full H1 register rows for authorized inspection export (CSV). */
  async h1RegisterExport(request: TenantRequest, params: { from?: string; to?: string }) {
    const orgId = request.tenantContext.organizationId;
    const items = await this.prisma.prescriptionRecord.findMany({
      where: this.h1Where(orgId, params),
      include: { invoice: { select: { invoiceNumber: true } } },
      orderBy: { dispensedAt: 'asc' },
    });
    await this.audit.record({
      event: 'EXPORT_GENERATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'PrescriptionRecord',
      details: { export: 'H1_REGISTER', rows: items.length, from: params.from ?? null, to: params.to ?? null },
    });
    return {
      headers: ['Date', 'Invoice', 'Patient', 'Prescriber', 'Prescriber address', 'Drug', 'Quantity'],
      rows: items.map((r) => [r.dispensedAt, r.invoice.invoiceNumber, r.patientName, r.prescriberName, r.prescriberAddress, r.drugName, r.quantity.toFixed(3)]),
    };
  }

  // ── Licences ───────────────────────────────────────────────────────────────

  async listLicences(request: TenantRequest) {
    const orgId = request.tenantContext.organizationId;
    const licences = await this.prisma.pharmacyLicence.findMany({
      where: { organizationId: orgId },
      include: { branch: { select: { name: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    const now = Date.now();
    return licences.map((l) => {
      const days = Math.ceil((l.expiryDate.getTime() - now) / 86_400_000);
      return {
        ...l,
        daysToExpiry: days,
        bucket: days < 0 ? 'EXPIRED' : days <= 30 ? 'DAYS_30' : days <= 60 ? 'DAYS_60' : days <= 90 ? 'DAYS_90' : 'OK',
      };
    });
  }

  /** Licence expiry alerts (30/60/90 windows, spec §14). */
  async licenceAlerts(request: TenantRequest) {
    return (await this.listLicences(request)).map((l) => ({
      id: l.id,
      licenceType: l.licenceType,
      licenceNumber: l.licenceNumber,
      expiryDate: l.expiryDate,
      daysToExpiry: l.daysToExpiry,
      bucket: l.bucket,
    }));
  }

  async upsertLicence(
    request: TenantRequest,
    licenceId: string | null,
    data: { licenceType: string; licenceNumber: string; issuingAuthority?: string | null; issueDate?: string | null; expiryDate: string; branchId?: string | null },
  ) {
    const orgId = request.tenantContext.organizationId;
    if (data.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: data.branchId, organizationId: orgId } });
      if (!branch) throw NotFound('Branch not found');
    }
    const expiry = new Date(`${data.expiryDate}T23:59:59+05:30`);
    const issue = data.issueDate ? new Date(`${data.issueDate}T00:00:00+05:30`) : null;
    if (issue && issue > expiry) throw new AppException('VALIDATION_ERROR', 'Issue date must be before expiry date', 400);
    const payload = {
      licenceType: data.licenceType,
      licenceNumber: data.licenceNumber.trim(),
      issuingAuthority: data.issuingAuthority?.trim() || null,
      issueDate: issue,
      expiryDate: expiry,
      branchId: data.branchId ?? null,
    };
    let licence;
    if (licenceId) {
      const existing = await this.prisma.pharmacyLicence.findFirst({ where: { id: licenceId, organizationId: orgId } });
      if (!existing) throw NotFound('Licence not found');
      licence = await this.prisma.pharmacyLicence.update({ where: { id: licenceId }, data: payload });
    } else {
      licence = await this.prisma.pharmacyLicence.create({ data: { organizationId: orgId, ...payload } });
    }
    await this.audit.record({
      event: licenceId ? 'LICENCE_UPDATED' : 'LICENCE_CREATED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'PharmacyLicence',
      entityId: licence.id,
      details: { licenceType: licence.licenceType, licenceNumber: licence.licenceNumber, expiryDate: data.expiryDate },
    });
    return licence;
  }

  // ── GST ────────────────────────────────────────────────────────────────────

  /**
   * GSTR-1 style outward summary: B2B (customer GSTIN) vs B2C, HSN-wise with
   * rate, credit notes (sales returns) netted. Values come from posted
   * snapshots, never recomputed.
   */
  async gstSalesSummary(request: TenantRequest, from?: string, to?: string) {
    const orgId = request.tenantContext.organizationId;
    const invoiceDate = range(from, to);
    const [invoices, returns] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, ...(invoiceDate ? { invoiceDate } : {}) },
        include: { lines: { include: { product: { select: { hsnCode: true } } } }, customer: { select: { gstin: true } } },
      }),
      this.prisma.salesReturn.findMany({
        where: { organizationId: orgId, ...(invoiceDate ? { createdAt: invoiceDate } : {}) },
        include: { invoice: { select: { cgstAmount: true, igstAmount: true } } },
      }),
    ]);
    const hsn = new Map<string, TaxBucket & { hsnCode: string; rate: string; quantity: bigint }>();
    const b2b = emptyBucket();
    const b2c = emptyBucket();
    for (const inv of invoices) {
      const bucket = inv.customer?.gstin ? b2b : b2c;
      bucket.count += 1;
      for (const line of inv.lines) {
        const hsnCode = line.hsnCode ?? line.product.hsnCode ?? 'UNSPECIFIED';
        const key = `${hsnCode}|${line.taxRatePercent.toFixed(2)}`;
        const row = hsn.get(key) ?? { ...emptyBucket(), hsnCode, rate: line.taxRatePercent.toFixed(2), quantity: 0n };
        const vals = { taxable: toPaise(line.taxableValue), cgst: toPaise(line.cgstAmount), sgst: toPaise(line.sgstAmount), igst: toPaise(line.igstAmount), cess: toPaise(line.cessAmount) };
        for (const target of [row, bucket]) {
          target.taxable += vals.taxable;
          target.cgst += vals.cgst;
          target.sgst += vals.sgst;
          target.igst += vals.igst;
          target.cess += vals.cess;
        }
        row.count += 1;
        hsn.set(key, row);
      }
    }
    const creditNotes = emptyBucket();
    for (const r of returns) {
      creditNotes.count += 1;
      creditNotes.taxable += toPaise(r.refundTotal) - toPaise(r.taxAmount);
      const tax = toPaise(r.taxAmount);
      if (toPaise(r.invoice.igstAmount) > 0n && toPaise(r.invoice.cgstAmount) === 0n) creditNotes.igst += tax;
      else {
        const half = tax / 2n;
        creditNotes.cgst += half;
        creditNotes.sgst += tax - half;
      }
    }
    const outward = emptyBucket();
    for (const b of [b2b, b2c]) {
      outward.taxable += b.taxable;
      outward.cgst += b.cgst;
      outward.sgst += b.sgst;
      outward.igst += b.igst;
      outward.cess += b.cess;
      outward.count += b.count;
    }
    const net = {
      ...outward,
      taxable: outward.taxable - creditNotes.taxable,
      cgst: outward.cgst - creditNotes.cgst,
      sgst: outward.sgst - creditNotes.sgst,
      igst: outward.igst - creditNotes.igst,
    };
    return {
      period: { from: from ?? null, to: to ?? null },
      rows: [...hsn.values()]
        .sort((a, b) => a.hsnCode.localeCompare(b.hsnCode))
        .map((r) => ({ hsnCode: r.hsnCode, rate: r.rate, ...fmtBucket(r) })),
      b2b: fmtBucket(b2b),
      b2c: fmtBucket(b2c),
      creditNotes: fmtBucket(creditNotes),
      totals: fmtBucket(outward),
      net: fmtBucket(net),
    };
  }

  /** Inward supplies (input tax credit) summary net of debit notes. */
  async gstPurchaseSummary(request: TenantRequest, from?: string, to?: string) {
    const orgId = request.tenantContext.organizationId;
    const invoiceDate = range(from, to);
    const [invoices, returns] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, ...(invoiceDate ? { invoiceDate } : {}) },
        include: { lines: true, vendor: { select: { legalName: true, gstin: true } } },
      }),
      this.prisma.purchaseReturn.findMany({
        where: { organizationId: orgId, ...(invoiceDate ? { createdAt: invoiceDate } : {}) },
        include: { vendor: { select: { gstin: true } } },
      }),
    ]);
    const totals = emptyBucket();
    // Section 16 CGST Act: ITC needs a tax invoice from a registered supplier, so tax on invoices from vendors without a GSTIN is not claimable.
    const eligible = emptyBucket();
    const byVendor = new Map<string, TaxBucket & { vendor: string; gstin: string | null }>();
    for (const inv of invoices) {
      totals.count += 1;
      const v = byVendor.get(inv.vendorId) ?? { ...emptyBucket(), vendor: inv.vendor.legalName, gstin: inv.vendor.gstin };
      v.count += 1;
      if (inv.vendor.gstin) eligible.count += 1;
      for (const line of inv.lines) {
        for (const t of inv.vendor.gstin ? [totals, v, eligible] : [totals, v]) {
          t.taxable += toPaise(line.taxableValue);
          t.cgst += toPaise(line.cgstAmount);
          t.sgst += toPaise(line.sgstAmount);
          t.igst += toPaise(line.igstAmount);
          t.cess += toPaise(line.cessAmount);
        }
      }
      byVendor.set(inv.vendorId, v);
    }
    const debitNotes = returns.filter((r) => r.vendor.gstin).reduce((s, r) => s + toPaise(r.taxAmount), 0n);
    const taxOf = (b: TaxBucket) => b.cgst + b.sgst + b.igst + b.cess;
    return {
      period: { from: from ?? null, to: to ?? null },
      totals: fmtBucket(totals),
      eligible: fmtBucket(eligible),
      ineligibleTax: major(taxOf(totals) - taxOf(eligible)),
      invoiceCount: invoices.length,
      byVendor: [...byVendor.values()].map((v) => ({ vendor: v.vendor, gstin: v.gstin, itcEligible: Boolean(v.gstin), ...fmtBucket(v) })),
      debitNoteTax: major(debitNotes),
      netItc: major(taxOf(eligible) - debitNotes),
    };
  }

  // ── Integration registry (honest status, spec §30) ─────────────────────────

  listIntegrations(request: TenantRequest) {
    return this.prisma.integrationConnection.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      orderBy: { provider: 'asc' },
    });
  }

  /**
   * Saves non-secret configuration. Status stays NOT_CONNECTED: a provider is
   * only CONNECTED after a real connectivity test, which no adapter performs yet.
   */
  async upsertIntegration(request: TenantRequest, provider: string, data: { config?: unknown }) {
    const orgId = request.tenantContext.organizationId;
    return this.prisma.integrationConnection.upsert({
      where: { organizationId_provider: { organizationId: orgId, provider } },
      create: { organizationId: orgId, provider, status: 'NOT_CONNECTED', config: (data.config as object) ?? undefined },
      update: { status: 'NOT_CONNECTED', config: (data.config as object) ?? undefined, lastError: null },
    });
  }
}
