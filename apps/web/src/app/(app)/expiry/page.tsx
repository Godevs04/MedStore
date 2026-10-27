'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Card, ErrorState, Select, Spinner, Table } from '@/components/ui';

interface ExpiryRow {
  batchId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  bucket: string;
  quantity: number;
  status: string;
}

const BUCKET_TONES: Record<string, 'red' | 'amber' | 'neutral' | 'green' | 'blue'> = {
  EXPIRED: 'red',
  DAYS_30: 'red',
  DAYS_60: 'amber',
  DAYS_90: 'amber',
  CUSTOM: 'blue',
  OK: 'green',
};

export default function ExpiryPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const dashboard = useQuery({
    queryKey: ['expiry-dashboard', warehouseId],
    queryFn: () =>
      api<{ buckets: Record<string, number>; rows: ExpiryRow[] }>(
        `/inventory/expiry-dashboard${warehouseId ? `?warehouseId=${warehouseId}` : ''}`,
      ),
    retry: false,
  });

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const branches = await api<Array<{ id: string; name: string; warehouses: Array<{ id: string; name: string }> }>>(
        '/organizations/branches',
      );
      return branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, branch: b.name })));
    },
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="mc-anim-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Expiry dashboard</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Batches on hand bucketed by days to expiry — act before they block sales.</p>
        </div>
        <Select className="w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>

      {dashboard.isLoading ? (
        <Spinner />
      ) : dashboard.error ? (
        <ErrorState
          message={
            dashboard.error instanceof ApiClientError && dashboard.error.status === 403
              ? 'You do not have permission to view inventory.'
              : 'Failed to load expiry dashboard.'
          }
          retry={() => void dashboard.refetch()}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {Object.entries(dashboard.data?.buckets ?? {}).map(([bucket, count]) => (
              <Card key={bucket}>
                <div className="text-center">
                  <div className="text-2xl font-semibold">{count}</div>
                  <Badge tone={BUCKET_TONES[bucket] ?? 'neutral'}>{bucket.replace('DAYS_', '')}</Badge>
                </div>
              </Card>
            ))}
          </div>

          <Card title="Batches by expiry">
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Expiry</th>
                  <th className="px-3 py-2">Days</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Bucket</th>
                </tr>
              }
            >
              {dashboard.data?.rows.map((r) => (
                <tr key={r.batchId} className="hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-800">{r.productName}</div>
                    <div className="font-mono text-xs text-neutral-500">{r.sku}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.batchNumber}</td>
                  <td className="px-3 py-2 text-sm">{new Date(r.expiryDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-sm">{r.daysToExpiry}</td>
                  <td className="px-3 py-2 text-sm">{r.quantity}</td>
                  <td className="px-3 py-2">
                    <Badge tone={BUCKET_TONES[r.bucket] ?? 'neutral'}>{r.bucket}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
            {(dashboard.data?.rows.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-500">No stock on hand.</p>
            ) : null}
          </Card>
        </>
      )}
    </div>
  );
}
