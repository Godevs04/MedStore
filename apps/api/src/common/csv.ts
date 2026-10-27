import type { Response } from 'express';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  // Prisma Decimal cells rely on their own toString().
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // Neutralize spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

export function sendCsv(res: Response, filename: string, headers: string[], rows: unknown[][]): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send('\uFEFF' + toCsv(headers, rows));
}
