'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership, useSession } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select, Spinner, Table, cn } from '@/components/ui';

interface BatchRow {
  id: string;
  batchNumber: string;
  expiryDate: string;
  status: string;
  purchaseRate: string;
  mrp: string;
  product: { name: string; sku: string };
  balances: Array<{ quantity: string }>;
}

interface Warehouse {
  id: string;
  name: string;
  branchId: string;
}

export default function BatchesPage() {
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ batchNumber: '', expiryDate: '', quantity: '', purchaseRate: '', mrp: '' });
  const productId = ''; // batch creation picks product via id input below
  const [productIdInput, setProductIdInput] = useState('');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const branches = await api<Array<{ id: string; name: string; warehouses: Warehouse[] }>>('/organizations/branches');
      return branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, branchId: b.id })));
    },
    retry: false,
  });

  const batches = useQuery({
    queryKey: ['batches', warehouseId],
    queryFn: () =>
      api<{ items: BatchRow[]; pageInfo: { totalItems: number } }>(
        `/inventory/batches?page=1&pageSize=100${warehouseId ? `&warehouseId=${warehouseId}` : ''}`,
      ),
    retry: false,
  });

  const createBatch = useMutation({
    mutationFn: () =>
      api('/inventory/batches', {
        method: 'POST',
        body: {
          productId: productIdInput,
          warehouseId: warehouseId,
          batchNumber: form.batchNumber,
          expiryDate: form.expiryDate,
          quantity: form.quantity,
          purchaseRate: form.purchaseRate,
          mrp: form.mrp,
        },
      }),
    onSuccess: () => {
      setForm({ batchNumber: '', expiryDate: '', quantity: '', purchaseRate: '', mrp: '' });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to record opening stock'),
  });

  const daysToExpiry = (date: string) => {
    const d = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
    return d;
  };

  const expiryTone = (date: string, status: string) => {
    if (status === 'RECALLED') return 'red' as const;
    const d = daysToExpiry(date);
    if (d < 0) return 'red' as const;
    if (d <= 30) return 'amber' as const;
    return 'green' as const;
  };

  if (warehouses.isLoading) return <Spinner />;
  if (!tenant?.organizationId) return <Spinner />;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Batch inventory</h1>
        <Select className="w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>

      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <Card title="Record opening stock">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            createBatch.mutate();
          }}
        >
          <Field label="Product ID">
            <Input value={productIdInput} onChange={(e) => setProductIdInput(e.target.value)} placeholder="UUID" />
          </Field>
          <Field label="Batch number">
            <Input value={form.batchNumber} onChange={(e) => setForm((s) => ({ ...s, batchNumber: e.target.value }))} />
          </Field>
          <Field label="Expiry date">
            <Input type="date" value={form.expiryDate} onChange={(e) => setForm((s) => ({ ...s, expiryDate: e.target.value }))} />
          </Field>
          <Field label="Quantity">
            <Input value={form.quantity} onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))} />
          </Field>
          <Field label="Purchase rate (₹)">
            <Input value={form.purchaseRate} onChange={(e) => setForm((s) => ({ ...s, purchaseRate: e.target.value }))} />
          </Field>
          <Field label="MRP (₹)">
            <Input value={form.mrp} onChange={(e) => setForm((s) => ({ ...s, mrp: e.target.value }))} />
          </Field>
          <div className="flex items-end sm:col-span-6">
            <Button type="submit" disabled={createBatch.isPending || !warehouseId || !productIdInput}>
              {createBatch.isPending ? 'Saving…' : 'Record opening stock'}
            </Button>
          </div>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          Product picker will become a search box in the POS phase; for now paste the product UUID from the catalog page.
        </p>
      </Card>

      <Card title={`Batches (${batches.data?.pageInfo.totalItems ?? 0})`}>
        {batches.isLoading ? (
          <Spinner />
        ) : batches.error ? (
          <ErrorState
            message={
              batches.error instanceof ApiClientError && batches.error.status === 403
                ? 'You do not have permission to view inventory.'
                : 'Failed to load batches.'
            }
            retry={() => void batches.refetch()}
          />
        ) : (batches.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No batches" hint="Record opening stock or receive a purchase order to create batches." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2">Expiry</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">MRP</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            }
          >
            {batches.data?.items.map((b) => {
              const qty = b.balances.reduce((s, x) => s + Number(x.quantity), 0);
              return (
                <tr key={b.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-800">{b.product.name}</div>
                    <div className="font-mono text-xs text-neutral-500">{b.product.sku}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{b.batchNumber}</td>
                  <td className="px-3 py-2 text-sm">
                    {new Date(b.expiryDate).toLocaleDateString()}
                    <Badge tone={expiryTone(b.expiryDate, b.status)}>{daysToExpiry(b.expiryDate)}d</Badge>
                  </td>
                  <td className={cn('px-3 py-2 text-sm font-medium', qty <= 0 && 'text-neutral-400')}>{qty}</td>
                  <td className="px-3 py-2 text-sm">₹{b.mrp}</td>
                  <td className="px-3 py-2">
                    <Badge tone={b.status === 'SALEABLE' ? 'green' : b.status === 'RECALLED' ? 'red' : 'amber'}>
                      {b.status}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
