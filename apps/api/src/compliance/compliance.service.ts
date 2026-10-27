import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { licenceSetWarnings, periodBounds } from '@medicore/validation';
import { AppException, Conflict, NotFound } from '../common/app-exception.js';
import { major, toPaise } from '../common/money.js';

/** GSTN offline-tool date format (dd-mm-yyyy) in IST. */
const gstDate = (d: Date) => {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`;
};
const num = (p: bigint) => Number(major(p));
/** Unregistered inter-state invoices above this value are B2CL (Notification 12/2024-CT, from 1 Aug 2024). */
const B2CL_THRESHOLD_PAISE = 100_000_00n;

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
    return this.licencesWithDays(request);
  }

  /** Licences plus set-level warnings (missing Form 20/21 pair, no drug licence). */
  async licenceOverview(request: TenantRequest) {
    const items = await this.licencesWithDays(request);
    return {
      items,
      warnings: licenceSetWarnings(items.filter((l) => l.daysToExpiry >= 0).map((l) => l.licenceType)),
      expired: items.filter((l) => l.bucket === 'EXPIRED').length,
      expiringSoon: items.filter((l) => l.bucket === 'DAYS_30').length,
    };
  }

  private async licencesWithDays(request: TenantRequest) {
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
    const duplicate = await this.prisma.pharmacyLicence.findFirst({
      where: {
        organizationId: orgId,
        licenceType: data.licenceType,
        licenceNumber: { equals: data.licenceNumber.trim(), mode: 'insensitive' },
        ...(licenceId ? { id: { not: licenceId } } : {}),
      },
    });
    if (duplicate) throw Conflict('LICENCE_DUPLICATE', `This ${data.licenceType.replace('_', ' ')} number is already on file`);
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

  // ── GST returns ────────────────────────────────────────────────────────────

  private async gstOrg(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { gstin: true, stateCode: true } });
    if (!org.gstin) throw new AppException('GSTIN_REQUIRED', 'Add your GSTIN under Settings before preparing GST returns', 422);
    return { ...org, gstin: org.gstin, stateCode: org.stateCode ?? org.gstin.slice(0, 2) };
  }

  /**
   * GSTR-1 for one month in the GSTN offline-tool JSON layout: B2B, B2CL,
   * B2CS, CDNR (credit notes to registered buyers), HSN summary and document
   * series. Built from posted invoice snapshots; nothing is recomputed.
   */
  async gstr1(request: TenantRequest, period: string) {
    const orgId = request.tenantContext.organizationId;
    const org = await this.gstOrg(orgId);
    const { from, to } = periodBounds(period);
    const invoiceDate = range(from, to)!;
    const [invoices, cancelled, returns] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, invoiceDate },
        include: { lines: { include: { product: { select: { hsnCode: true, name: true } } } }, customer: { select: { gstin: true, stateCode: true } } },
        orderBy: { invoiceNumber: 'asc' },
      }),
      this.prisma.salesInvoice.count({ where: { organizationId: orgId, status: 'CANCELLED', invoiceDate } }),
      this.prisma.salesReturn.findMany({
        where: { organizationId: orgId, createdAt: invoiceDate },
        include: {
          invoice: { select: { invoiceNumber: true, invoiceDate: true, customer: { select: { gstin: true, stateCode: true } } } },
          lines: { include: { invoiceLine: { select: { taxRatePercent: true } } } },
        },
        orderBy: { returnNumber: 'asc' },
      }),
    ]);

    type Item = { rt: number; txval: bigint; iamt: bigint; camt: bigint; samt: bigint; csamt: bigint };
    const byRate = (lines: Array<{ rate: number; txval: bigint; igst: bigint; cgst: bigint; sgst: bigint; cess: bigint }>) => {
      const m = new Map<number, Item>();
      for (const l of lines) {
        const it = m.get(l.rate) ?? { rt: l.rate, txval: 0n, iamt: 0n, camt: 0n, samt: 0n, csamt: 0n };
        it.txval += l.txval;
        it.iamt += l.igst;
        it.camt += l.cgst;
        it.samt += l.sgst;
        it.csamt += l.cess;
        m.set(l.rate, it);
      }
      return [...m.values()].sort((a, b) => a.rt - b.rt);
    };
    const itemJson = (it: Item, i: number) => ({
      num: i + 1,
      itm_det: { rt: it.rt, txval: num(it.txval), iamt: num(it.iamt), camt: num(it.camt), samt: num(it.samt), csamt: num(it.csamt) },
    });

    const b2b = new Map<string, Array<Record<string, unknown>>>();
    const b2cl = new Map<string, Array<Record<string, unknown>>>();
    const b2cs = new Map<string, { sply_ty: 'INTRA' | 'INTER'; pos: string; typ: 'OE'; rt: number; txval: bigint; iamt: bigint; camt: bigint; samt: bigint; csamt: bigint }>();
    const hsn = new Map<string, { hsn_sc: string; desc: string; uqc: string; rt: number; qty: number; txval: bigint; iamt: bigint; camt: bigint; samt: bigint; csamt: bigint }>();
    const counts = { b2b: 0, b2cl: 0, b2cs: 0 };

    for (const inv of invoices) {
      const lines = inv.lines.map((l) => ({
        rate: Number(l.taxRatePercent),
        txval: toPaise(l.taxableValue),
        igst: toPaise(l.igstAmount),
        cgst: toPaise(l.cgstAmount),
        sgst: toPaise(l.sgstAmount),
        cess: toPaise(l.cessAmount),
      }));
      for (const [i, l] of inv.lines.entries()) {
        const code = l.hsnCode ?? l.product.hsnCode ?? 'NA';
        const key = `${code}|${Number(l.taxRatePercent)}`;
        const h = hsn.get(key) ?? { hsn_sc: code, desc: l.product.name.slice(0, 30), uqc: 'NOS', rt: Number(l.taxRatePercent), qty: 0, txval: 0n, iamt: 0n, camt: 0n, samt: 0n, csamt: 0n };
        h.qty += Number(l.quantity);
        h.txval += lines[i]!.txval;
        h.iamt += lines[i]!.igst;
        h.camt += lines[i]!.cgst;
        h.samt += lines[i]!.sgst;
        h.csamt += lines[i]!.cess;
        hsn.set(key, h);
      }
      const pos = inv.customer?.stateCode ?? inv.customer?.gstin?.slice(0, 2) ?? org.stateCode;
      const inter = pos !== org.stateCode;
      const total = toPaise(inv.total);
      if (inv.customer?.gstin) {
        counts.b2b += 1;
        const list = b2b.get(inv.customer.gstin) ?? [];
        list.push({ inum: inv.invoiceNumber, idt: gstDate(inv.invoiceDate), val: num(total), pos, rchrg: 'N', inv_typ: 'R', itms: byRate(lines).map(itemJson) });
        b2b.set(inv.customer.gstin, list);
      } else if (inter && total > B2CL_THRESHOLD_PAISE) {
        counts.b2cl += 1;
        const list = b2cl.get(pos) ?? [];
        list.push({ inum: inv.invoiceNumber, idt: gstDate(inv.invoiceDate), val: num(total), itms: byRate(lines).map(itemJson) });
        b2cl.set(pos, list);
      } else {
        counts.b2cs += 1;
        for (const it of byRate(lines)) {
          const key = `${pos}|${it.rt}`;
          const row = b2cs.get(key) ?? { sply_ty: inter ? 'INTER' : 'INTRA', pos, typ: 'OE', rt: it.rt, txval: 0n, iamt: 0n, camt: 0n, samt: 0n, csamt: 0n };
          row.txval += it.txval;
          row.iamt += it.iamt;
          row.camt += it.camt;
          row.samt += it.samt;
          row.csamt += it.csamt;
          b2cs.set(key, row);
        }
      }
    }

    const cdnr = new Map<string, Array<Record<string, unknown>>>();
    let unregisteredNotes = 0;
    for (const r of returns) {
      const cust = r.invoice.customer;
      const pos = cust?.stateCode ?? cust?.gstin?.slice(0, 2) ?? org.stateCode;
      const inter = pos !== org.stateCode;
      const lines = r.lines.map((l) => {
        const tax = toPaise(l.taxAmount);
        const half = tax / 2n;
        return { rate: Number(l.invoiceLine.taxRatePercent), txval: toPaise(l.taxableValue), igst: inter ? tax : 0n, cgst: inter ? 0n : half, sgst: inter ? 0n : tax - half, cess: 0n };
      });
      if (cust?.gstin) {
        const list = cdnr.get(cust.gstin) ?? [];
        list.push({ ntty: 'C', nt_num: r.returnNumber, nt_dt: gstDate(r.createdAt), val: num(toPaise(r.refundTotal)), pos, rchrg: 'N', inv_typ: 'R', itms: byRate(lines).map(itemJson) });
        cdnr.set(cust.gstin, list);
      } else {
        // B2C credit notes reduce the B2CS figures of the same place of supply and rate.
        unregisteredNotes += 1;
        for (const it of byRate(lines)) {
          const key = `${pos}|${it.rt}`;
          const row = b2cs.get(key) ?? { sply_ty: inter ? 'INTER' : 'INTRA', pos, typ: 'OE', rt: it.rt, txval: 0n, iamt: 0n, camt: 0n, samt: 0n, csamt: 0n };
          row.txval -= it.txval;
          row.iamt -= it.iamt;
          row.camt -= it.camt;
          row.samt -= it.samt;
          b2cs.set(key, row);
        }
      }
    }

    const money = <T extends { txval: bigint; iamt: bigint; camt: bigint; samt: bigint; csamt: bigint }>(r: T) => ({
      ...r,
      txval: num(r.txval),
      iamt: num(r.iamt),
      camt: num(r.camt),
      samt: num(r.samt),
      csamt: num(r.csamt),
    });
    const [y, m] = period.split('-');
    const first = invoices[0]?.invoiceNumber;
    const last = invoices[invoices.length - 1]?.invoiceNumber;
    const sum = (xs: Array<{ txval: bigint; iamt: bigint; camt: bigint; samt: bigint; csamt: bigint }>) =>
      xs.reduce((a, r) => ({ txval: a.txval + r.txval, iamt: a.iamt + r.iamt, camt: a.camt + r.camt, samt: a.samt + r.samt, csamt: a.csamt + r.csamt }), { txval: 0n, iamt: 0n, camt: 0n, samt: 0n, csamt: 0n });

    const hsnTotals = sum([...hsn.values()]);
    return {
      gstin: org.gstin,
      fp: `${m}${y}`,
      version: 'GST3.2.1',
      hash: 'hash',
      b2b: [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv })),
      b2cl: [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv })),
      b2cs: [...b2cs.values()].filter((r) => r.txval !== 0n).map(money),
      cdnr: [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt })),
      hsn: { data: [...hsn.values()].sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc)).map((h, i) => ({ num: i + 1, ...money(h), qty: Math.round(h.qty * 1000) / 1000 })) },
      doc_issue: first
        ? { doc_det: [{ doc_num: 1, docs: [{ num: 1, from: first, to: last, totnum: invoices.length + cancelled, cancel: cancelled, net_issue: invoices.length }] }] }
        : { doc_det: [] },
      summary: {
        period,
        invoices: invoices.length,
        cancelled,
        b2b: counts.b2b,
        b2cl: counts.b2cl,
        b2cs: counts.b2cs,
        creditNotes: returns.length,
        unregisteredCreditNotes: unregisteredNotes,
        taxable: major(hsnTotals.txval),
        igst: major(hsnTotals.iamt),
        cgst: major(hsnTotals.camt),
        sgst: major(hsnTotals.samt),
        cess: major(hsnTotals.csamt),
      },
    };
  }

  /**
   * GSTR-3B for one month: 3.1 outward supplies, 3.2 inter-state B2C by
   * place of supply, 4 ITC (eligible, reversed by debit notes, ineligible)
   * and tax payable after set-off in the Rule 88A order (IGST credit first
   * against IGST, then CGST/SGST; CGST and SGST credits never cross).
   */
  async gstr3b(request: TenantRequest, period: string) {
    const orgId = request.tenantContext.organizationId;
    const org = await this.gstOrg(orgId);
    const { from, to } = periodBounds(period);
    const [sales, purchases, inter, debitNotes] = await Promise.all([
      this.gstSalesSummary(request, from, to),
      this.gstPurchaseSummary(request, from, to),
      this.prisma.salesInvoice.findMany({
        where: { organizationId: orgId, status: { not: 'CANCELLED' }, invoiceDate: range(from, to)!, customer: { gstin: null, stateCode: { not: org.stateCode } } },
        select: { taxableValue: true, igstAmount: true, customer: { select: { stateCode: true } } },
      }),
      this.prisma.purchaseReturn.findMany({
        where: { organizationId: orgId, createdAt: range(from, to)!, vendor: { gstin: { not: null } } },
        select: { taxAmount: true, vendor: { select: { stateCode: true, gstin: true } } },
      }),
    ]);
    const p = (v: string) => toPaise(v);
    const zeroRated = sales.rows.filter((r) => Number(r.rate) === 0).reduce((s, r) => s + p(r.taxable), 0n);
    const outward = {
      txval: p(sales.net.taxable) - zeroRated,
      iamt: p(sales.net.igst),
      camt: p(sales.net.cgst),
      samt: p(sales.net.sgst),
      csamt: p(sales.net.cess),
    };
    const pos = new Map<string, { pos: string; txval: bigint; iamt: bigint }>();
    for (const inv of inter) {
      const code = inv.customer!.stateCode!;
      const row = pos.get(code) ?? { pos: code, txval: 0n, iamt: 0n };
      row.txval += toPaise(inv.taxableValue);
      row.iamt += toPaise(inv.igstAmount);
      pos.set(code, row);
    }
    const reversed = { iamt: 0n, camt: 0n, samt: 0n };
    for (const d of debitNotes) {
      const tax = toPaise(d.taxAmount);
      const vendorState = d.vendor.stateCode ?? d.vendor.gstin?.slice(0, 2);
      if (vendorState && vendorState !== org.stateCode) reversed.iamt += tax;
      else {
        reversed.camt += tax / 2n;
        reversed.samt += tax - tax / 2n;
      }
    }
    const available = { iamt: p(purchases.eligible.igst), camt: p(purchases.eligible.cgst), samt: p(purchases.eligible.sgst), csamt: p(purchases.eligible.cess) };
    const credit = {
      igst: available.iamt - reversed.iamt,
      cgst: available.camt - reversed.camt,
      sgst: available.samt - reversed.samt,
      cess: available.csamt,
    };
    // Rule 88A set-off.
    let igstCr = credit.igst > 0n ? credit.igst : 0n;
    let cgstCr = credit.cgst > 0n ? credit.cgst : 0n;
    let sgstCr = credit.sgst > 0n ? credit.sgst : 0n;
    let cessCr = credit.cess > 0n ? credit.cess : 0n;
    const due = { igst: outward.iamt > 0n ? outward.iamt : 0n, cgst: outward.camt > 0n ? outward.camt : 0n, sgst: outward.samt > 0n ? outward.samt : 0n, cess: outward.csamt > 0n ? outward.csamt : 0n };
    const use = (need: bigint, avail: bigint) => (need < avail ? need : avail);
    let u = use(due.igst, igstCr);
    due.igst -= u;
    igstCr -= u;
    u = use(due.cgst, igstCr);
    due.cgst -= u;
    igstCr -= u;
    u = use(due.sgst, igstCr);
    due.sgst -= u;
    igstCr -= u;
    u = use(due.cgst, cgstCr);
    due.cgst -= u;
    cgstCr -= u;
    u = use(due.igst, cgstCr);
    due.igst -= u;
    cgstCr -= u;
    u = use(due.sgst, sgstCr);
    due.sgst -= u;
    sgstCr -= u;
    u = use(due.igst, sgstCr);
    due.igst -= u;
    sgstCr -= u;
    u = use(due.cess, cessCr);
    due.cess -= u;
    cessCr -= u;

    const fmt = (o: Record<string, bigint>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, major(v)]));
    return {
      period,
      gstin: org.gstin,
      from,
      to,
      outward: fmt(outward),
      zeroRatedNil: major(zeroRated),
      interStateB2C: [...pos.values()].map((r) => ({ pos: r.pos, txval: major(r.txval), iamt: major(r.iamt) })),
      itc: {
        available: fmt(available),
        reversed: fmt(reversed),
        ineligible: purchases.ineligibleTax,
        net: fmt(credit),
      },
      payable: { ...fmt(due), total: major(due.igst + due.cgst + due.sgst + due.cess) },
      carryForward: { ...fmt({ igst: igstCr, cgst: cgstCr, sgst: sgstCr, cess: cessCr }) },
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
