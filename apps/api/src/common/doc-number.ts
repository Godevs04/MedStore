import type { Prisma } from '@prisma/client';

type Tx = Omit<Prisma.TransactionClient, '$transaction'>;

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Indian financial year (April–March, IST) label, e.g. "2026-27". */
export function financialYearLabel(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Server-controlled, gapless-per-transaction document number scoped to the
 * organization and financial year. Format `SCOPE/YYYY/NNNNNN` (e.g.
 * SI/2627/000001) stays within GST Rule 46's 16-character limit for
 * scopes up to four letters.
 */
export async function nextDocNumber(db: Tx, organizationId: string, scope: string, date = new Date()): Promise<string> {
  const fy = financialYearLabel(date);
  const rows = await db.$queryRaw<Array<{ nextNumber: number }>>`
    INSERT INTO "DocumentNumberSequence" ("id", "organizationId", "scope", "fiscalYear", "prefix", "nextNumber")
    VALUES (gen_random_uuid()::text, ${organizationId}, ${scope}, ${fy}, '', 2)
    ON CONFLICT ("organizationId", "scope", "fiscalYear", "prefix")
    DO UPDATE SET "nextNumber" = "DocumentNumberSequence"."nextNumber" + 1
    RETURNING (CASE WHEN "DocumentNumberSequence"."nextNumber" = 2 THEN 1 ELSE "DocumentNumberSequence"."nextNumber" - 1 END) AS "nextNumber"
  `;
  const short = fy.slice(2, 4) + fy.slice(5, 7);
  return `${scope}/${short}/${String(rows[0]?.nextNumber ?? 1).padStart(6, '0')}`;
}
