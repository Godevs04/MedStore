'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, Field, Select, Table } from '@/components/ui';

type ImportType = 'products' | 'vendors' | 'customers';

interface PreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  results: Array<{ row: number; status: string; errors?: Array<{ field?: string; message: string }> }>;
  validatedRows: Array<Record<string, unknown>>;
}

/** Minimal CSV parser handling quoted cells and CRLF. */
function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = r[i]?.trim() ?? '';
    });
    return obj;
  });
}

export default function ImportPage() {
  const [type, setType] = useState<ImportType>('products');
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<string | null>(null);

  const previewMutation = useMutation({
    mutationFn: (rows: Array<Record<string, string>>) =>
      api<PreviewResult>(`/imports/${type}/preview`, { method: 'POST', body: { rows } }),
    onSuccess: setPreview,
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Preview failed'),
  });

  const commitMutation = useMutation({
    mutationFn: (validatedRows: Array<Record<string, unknown>>) =>
      api<{ created: number; skipped: number; rejected: number }>(`/imports/${type}/commit`, {
        method: 'POST',
        body: { validatedRows },
      }),
    onSuccess: (r) => {
      setCommitResult(`Imported ${r.created} records (${r.skipped} skipped, ${r.rejected} rejected).`);
      setPreview(null);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Commit failed'),
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const sampleHeader: Record<ImportType, string> = {
    products: 'name,sku,genericName,strength,dosageForm,hsnCode,mrp,purchasePrice,sellingPrice,prescriptionClass',
    vendors: 'legalName,gstin,stateCode,city,pinCode,phone,creditDays,creditLimit',
    customers: 'name,phone,category,creditDays,creditLimit',
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-semibold">Import data</h1>
      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {commitResult ? <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{commitResult}</p> : null}

      <Card title="Upload a CSV file">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Import type">
              <Select value={type} onChange={(e) => { setType(e.target.value as ImportType); setPreview(null); setCommitResult(null); }}>
                <option value="products">Products</option>
                <option value="vendors">Vendors</option>
                <option value="customers">Customers</option>
              </Select>
            </Field>
            <Field label="CSV file">
              <input
                type="file"
                accept=".csv,text/csv"
                className="text-sm"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </Field>
          </div>
          <p className="text-xs text-neutral-500">
            First row must be the header. Expected columns for {type}:{' '}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[10px]">{sampleHeader[type]}</code>
          </p>
          <textarea
            className="h-32 w-full rounded-md border border-neutral-300 p-2 font-mono text-xs"
            placeholder="…or paste CSV text here"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              disabled={previewMutation.isPending || csvText.trim() === ''}
              onClick={() => {
                setError(null);
                setCommitResult(null);
                previewMutation.mutate(parseCsv(csvText));
              }}
            >
              {previewMutation.isPending ? 'Validating…' : 'Validate rows'}
            </Button>
            {preview ? (
              <Button
                variant="secondary"
                disabled={preview.validRows === 0 || commitMutation.isPending}
                onClick={() => commitMutation.mutate(preview.validatedRows)}
              >
                Commit {preview.validRows} valid rows
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {preview ? (
        <Card title={`Validation: ${preview.validRows} valid · ${preview.errorRows} errors · ${preview.duplicateRows} duplicates`}>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            }
          >
            {preview.results.map((r) => (
              <tr key={r.row} className="hover:bg-neutral-50">
                <td className="px-3 py-2">{r.row}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === 'VALID' ? 'green' : r.status === 'ERROR' ? 'red' : 'amber'}>{r.status}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-600">
                  {r.errors?.map((e) => `${e.field ? `${e.field}: ` : ''}${e.message}`).join('; ') ?? ''}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
