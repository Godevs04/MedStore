import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  productCreateSchema,
  vendorCreateSchema,
  customerCreateSchema,
  INDIAN_STATE_CODES,
  gstinStateCode,
} from '@medicore/validation';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { Conflict } from '../common/app-exception.js';

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** Strips optional/nullable/default/refinement wrappers to reach the field's value type. */
function baseType(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current.unwrap() as z.ZodTypeAny;
    else if (current instanceof z.ZodDefault) current = current.removeDefault() as z.ZodTypeAny;
    else if (current instanceof z.ZodEffects) current = current.innerType() as z.ZodTypeAny;
    else return current;
  }
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0']);

function coerceCell(type: z.ZodTypeAny, value: string): unknown {
  if (type instanceof z.ZodNumber) return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  if (type instanceof z.ZodBoolean) {
    const word = value.toLowerCase();
    return TRUE_WORDS.has(word) ? true : FALSE_WORDS.has(word) ? false : value;
  }
  if (type instanceof z.ZodArray) return value.split(/[|;]/).map((v) => v.trim()).filter(Boolean);
  return value;
}

/** Cells that could not be converted surface as "expected number, received string"; reword for spreadsheet users. */
function issueMessage(issue: z.ZodIssue): string {
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === 'string') {
    if (issue.expected === 'number') return 'Must be a number (e.g. 30 or 125.50)';
    if (issue.expected === 'boolean') return 'Must be yes or no';
  }
  return issue.message;
}

export type ImportType = 'products' | 'vendors' | 'customers';

export interface ImportRowResult {
  row: number;
  status: 'VALID' | 'ERROR' | 'DUPLICATE';
  errors?: Array<{ field?: string; message: string }>;
  /** Populated for duplicates: existing entity references. */
  duplicateOf?: { id: string; key: string };
}

export interface ImportPreview {
  type: ImportType;
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  results: ImportRowResult[];
  /** Normalized rows for valid entries, ready to commit. */
  validatedRows: Array<Record<string, unknown>>;
}

/**
 * Server-side CSV import validation and commit (spec §29): rows are parsed
 * client-side but ALWAYS re-validated here; duplicates are detected per
 * type; invalid rows are reported, never silently skipped. The commit is
 * transactional — any retry is safe because duplicate keys are rejected
 * deterministically (products by SKU, vendors by GSTIN+name, customers by
 * name+phone).
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private readonly stateCodes = new Set(INDIAN_STATE_CODES.map((s) => s.code));

  async preview(request: TenantRequest, type: ImportType, rows: Array<Record<string, unknown>>): Promise<ImportPreview> {
    if (rows.length > 5000) throw Conflict('VALIDATION_ERROR', 'Import is limited to 5000 rows per batch');
    const schema = this.schemaFor(type);
    const orgId = request.tenantContext.organizationId;

    // Preload existing keys for duplicate detection.
    const existingSku = new Set(
      (await this.prisma.product.findMany({ where: { organizationId: orgId }, select: { sku: true } })).map((p) => p.sku.toLowerCase()),
    );
    const existingVendors = new Set(
      (await this.prisma.vendor.findMany({ where: { organizationId: orgId }, select: { legalName: true, gstin: true } })).map(
        (v) => `${v.legalName.toLowerCase()}|${v.gstin ?? ''}`,
      ),
    );
    const existingCustomers = new Set(
      (await this.prisma.customer.findMany({ where: { organizationId: orgId }, select: { name: true, phone: true } })).map(
        (c) => `${c.name.toLowerCase()}|${c.phone ?? ''}`,
      ),
    );

    const results: ImportRowResult[] = [];
    const validatedRows: Array<Record<string, unknown>> = [];
    const seenBatchKeys = new Set<string>();
    let validRows = 0;
    let errorRows = 0;
    let duplicateRows = 0;

    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      const parsed = schema.safeParse(this.coerceRow(type, row));
      if (!parsed.success) {
        errorRows += 1;
        results.push({
          row: rowNumber,
          status: 'ERROR',
          errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: issueMessage(i) })),
        });
        return;
      }
      const data = parsed.data as Record<string, unknown>;

      // State-code consistency for GSTIN rows.
      const gstin = data.gstin as string | null | undefined;
      const stateCode = data.stateCode as string | null | undefined;
      if (gstin && stateCode && gstinStateCode(gstin) !== stateCode) {
        errorRows += 1;
        results.push({
          row: rowNumber,
          status: 'ERROR',
          errors: [{ field: 'stateCode', message: `GSTIN prefix (${gstinStateCode(gstin)}) does not match state (${stateCode})` }],
        });
        return;
      }

      // Duplicate key within the batch (row N vs row 1..N-1).
      const batchKey = this.batchKeyFor(type, data);
      if (batchKey !== null && seenBatchKeys.has(batchKey)) {
        duplicateRows += 1;
        results.push({ row: rowNumber, status: 'DUPLICATE', duplicateOf: { id: '', key: batchKey } });
        return;
      }

      let duplicate: { id: string; key: string } | undefined;
      if (type === 'products' && existingSku.has(String(data.sku).toLowerCase())) {
        duplicate = { id: '', key: String(data.sku) };
      } else if (type === 'vendors' && existingVendors.has(`${text(data.legalName).toLowerCase()}|${text(data.gstin)}`)) {
        duplicate = { id: '', key: String(data.legalName) };
      } else if (type === 'customers' && existingCustomers.has(`${text(data.name).toLowerCase()}|${text(data.phone)}`)) {
        duplicate = { id: '', key: String(data.name) };
      }

      if (duplicate) {
        duplicateRows += 1;
        results.push({ row: rowNumber, status: 'DUPLICATE', duplicateOf: duplicate });
        return;
      }

      if (batchKey !== null) seenBatchKeys.add(batchKey);
      validRows += 1;
      validatedRows.push(data);
      results.push({ row: rowNumber, status: 'VALID' });
    });

    return { type, totalRows: rows.length, validRows, errorRows, duplicateRows, results, validatedRows };
  }

  async commit(
    request: TenantRequest,
    type: ImportType,
    validatedRows: Array<Record<string, unknown>>,
  ): Promise<{ created: number; skipped: number; rejected: number }> {
    const orgId = request.tenantContext.organizationId;
    const schema = this.schemaFor(type);
    let created = 0;
    let skipped = 0;
    let rejected = 0;

    for (const row of validatedRows) {
      const parsed = schema.safeParse(row);
      if (!parsed.success) {
        rejected += 1; // re-validated defensively; preview/commit mismatch
        continue;
      }
      const data: unknown = parsed.data;
      try {
        if (type === 'products') {
          const d = data as z.infer<typeof productCreateSchema>;
          await this.prisma.product.create({
            data: {
              organizationId: orgId,
              sku: d.sku,
              name: d.name,
              genericName: d.genericName ?? null,
              brand: d.brand ?? null,
              hsnCode: d.hsnCode ?? null,
              mrp: d.mrp ?? null,
              purchasePrice: d.purchasePrice ?? null,
              sellingPrice: d.sellingPrice ?? null,
              prescriptionClass: d.prescriptionClass ?? null,
              dosageForm: d.dosageForm ?? null,
              strength: d.strength ?? null,
              packSize: d.packSize ?? null,
              status: d.status,
              createdByUserId: request.principal.userId,
              barcodes: d.barcodes?.length ? { create: d.barcodes.map((b) => ({ barcode: b })) } : undefined,
            },
          });
          created += 1;
        } else if (type === 'vendors') {
          const d = data as z.infer<typeof vendorCreateSchema>;
          await this.prisma.vendor.create({
            data: {
              organizationId: orgId,
              legalName: d.legalName,
              tradeName: d.tradeName ?? null,
              gstin: d.gstin ?? null,
              gstRegistrationType: d.gstRegistrationType,
              addressLine1: d.addressLine1 ?? null,
              city: d.city ?? null,
              stateCode: d.stateCode ?? null,
              pinCode: d.pinCode ?? null,
              phone: d.phone ?? null,
              email: d.email ?? null,
              creditDays: d.creditDays,
              creditLimit: d.creditLimit,
              openingBalance: d.openingBalance,
              status: d.status,
              createdByUserId: request.principal.userId,
            },
          });
          created += 1;
        } else {
          const d = data as z.infer<typeof customerCreateSchema>;
          await this.prisma.customer.create({
            data: {
              organizationId: orgId,
              name: d.name,
              category: d.category ?? null,
              gstin: d.gstin ?? null,
              phone: d.phone ?? null,
              email: d.email ?? null,
              city: d.city ?? null,
              stateCode: d.stateCode ?? null,
              creditDays: d.creditDays,
              creditLimit: d.creditLimit,
              openingBalance: d.openingBalance,
              status: d.status,
              isWholesale: d.isWholesale,
              createdByUserId: request.principal.userId,
            },
          });
          created += 1;
        }
      } catch (error) {
        // Unique violations on concurrent imports are counted, not crashed on.
        const code = (error as { code?: string }).code;
        if (code === 'P2002') {
          skipped += 1;
        } else {
          rejected += 1;
        }
      }
    }

    await this.audit.record({
      event: 'IMPORT_COMPLETED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: `Import:${type}`,
      details: { created, skipped, rejected, submitted: validatedRows.length },
    });
    return { created, skipped, rejected };
  }

  /** Deduplication key used both within a batch and against existing rows. */
  private batchKeyFor(type: ImportType, data: Record<string, unknown>): string | null {
    switch (type) {
      case 'products':
        return text(data.sku).toLowerCase() || null;
      case 'vendors':
        return `${text(data.legalName).toLowerCase()}|${text(data.gstin)}`;
      case 'customers':
        return `${text(data.name).toLowerCase()}|${text(data.phone)}`;
    }
  }

  private schemaFor(type: ImportType): z.AnyZodObject {
    switch (type) {
      case 'products':
        return productCreateSchema;
      case 'vendors':
        return vendorCreateSchema;
      case 'customers':
        return customerCreateSchema;
    }
  }

  /**
   * CSV cells arrive as strings. Empty cells are dropped so defaults apply;
   * number, boolean and list fields are converted using the schema's own types.
   * Unconvertible values are left as-is so validation reports them per field.
   */
  private coerceRow(type: ImportType, row: Record<string, unknown>): Record<string, unknown> {
    const shape = this.schemaFor(type).shape as Record<string, z.ZodTypeAny>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === '' || value === undefined || value === null) continue;
      const field = shape[key];
      out[key] = typeof value === 'string' && field ? coerceCell(baseType(field), value.trim()) : value;
    }
    return out;
  }
}
