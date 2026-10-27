'use client';

import { useQuery } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Card, ErrorState, Spinner, Table, PageHeader } from '@/components/ui';

interface LedgerRow {
  id: string;
  movementType: string;
  quantity: string;
  reason: string | null;
  sourceDocument: string | null;
  createdAt: string;
  batch: {
    batchNumber: string;
    product: { name: string; sku: string };
  };
}

export default function LedgerPage() {
  const ledger = useQuery({
    queryKey: ['ledger'],
    queryFn: () => api<{ items: LedgerRow[]; pageInfo: { totalItems: number } }>('/inventory/ledger?page=1&pageSize=100'),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Stock ledger" subtitle="Every stock movement, append-only and traceable to its source document." />
      <Card title={`Movements (${ledger.data?.pageInfo.totalItems ?? 0}) — append-only`}>
        {ledger.isLoading ? (
          <Spinner />
        ) : ledger.error ? (
          <ErrorState
            message={
              ledger.error instanceof ApiClientError && ledger.error.status === 403
                ? 'You do not have permission to view the stock ledger.'
                : 'Failed to load ledger.'
            }
            retry={() => void ledger.refetch()}
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Product / batch</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Document</th>
              </tr>
            }
          >
            {ledger.data?.items.map((row) => {
              const qty = Number(row.quantity);
              return (
                <tr key={row.id} className="hover:bg-neutral-50">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-sm">
                    {row.batch.product.name}
                    <span className="ml-1 font-mono text-xs text-neutral-500">{row.batch.batchNumber}</span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={qty >= 0 ? 'green' : 'amber'}>{row.movementType}</Badge>
                  </td>
                  <td className={qty >= 0 ? 'px-3 py-2 text-sm font-medium text-green-700' : 'px-3 py-2 text-sm font-medium text-red-700'}>
                    {qty > 0 ? '+' : ''}
                    {qty}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{row.reason ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{row.sourceDocument ?? '—'}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
