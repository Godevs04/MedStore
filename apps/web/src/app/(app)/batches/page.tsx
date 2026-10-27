'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select, Spinner, Table, cn, ErrorBanner } from '@/components/ui';

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
  const [productIdInput, setProductIdInput] = useState('');
  const [recallTarget, setRecallTarget] = useState<{ id: string; batchNumber: string } | null>(null);
  const [recallReason, setRecallReason] = useState('');

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const branches = await api<Array<{ id: string; name: string; warehouses: Warehouse[] }>>('/organizations/branches');
      return branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, branchId: b.id })));
    },
    retry: false,
  });

  const productOptions = useQuery({
    queryKey: ['product-options'],
    queryFn: () =>
      api<{ items: Array<{ id: string; name: string; sku: string }> }>(
        '/catalog/products?page=1&pageSize=200&status=ACTIVE',
      ),
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
    meta: { success: 'Opening stock recorded' },
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

  const recall = useMutation({
    meta: { success: 'Batch recalled' },
    mutationFn: () =>
      api('/inventory/recalls', {
        method: 'POST',
        body: { batchId: recallTarget?.id, reason: recallReason.trim() },
      }),
    onSuccess: () => {
      setRecallTarget(null);
      setRecallReason('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create recall'),
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
      <div className="mc-anim-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Batch inventory</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Opening stock and live batch balances by warehouse, with expiry status.</p>
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

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      <Card title="Record opening stock">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            createBatch.mutate();
          }}
        >
          <Field label="Product">
            <Select value={productIdInput} onChange={(e) => setProductIdInput(e.target.value)} aria-label="Product">
              <option value="">Select product…</option>
              {(productOptions.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </Select>
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
      </Card>

      {recallTarget ? (
        <Card title={`Recall batch ${recallTarget.batchNumber}`} className="border-red-200">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Recall reason (recorded in the audit trail)">
                <Input
                  value={recallReason}
                  onChange={(e) => setRecallReason(e.target.value)}
                  placeholder="e.g. Manufacturer recall notice MFR-2026-0412"
                />
              </Field>
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="danger"
                disabled={recallReason.trim().length < 3 || recall.isPending}
                onClick={() => recall.mutate()}
              >
                {recall.isPending ? 'Recalling…' : 'Recall batch'}
              </Button>
              <Button variant="secondary" onClick={() => { setRecallTarget(null); setRecallReason(''); }}>
                Cancel
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Recalled batches immediately become ineligible for allocation (status RECALLED, Drugs Rules workflow).
          </p>
        </Card>
      ) : null}

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
                  <td className="px-3 py-2 text-right">
                    {b.status === 'SALEABLE' ? (
                      <Button variant="secondary" onClick={() => setRecallTarget({ id: b.id, batchNumber: b.batchNumber })}>
                        Recall
                      </Button>
                    ) : null}
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
