'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useInventoryPicker, type BatchOption } from '@/lib/inventory-picker';
import { Badge, Button, Card, EmptyState, ErrorBanner, ErrorState, Field, Input, Select, Spinner, Tr, Table, PageHeader } from '@/components/ui';

interface CountLine {
  id: string;
  countedQty: string;
  systemQty: string;
  variance: string;
  batch: { id: string; batchNumber: string; product: { name: string; sku: string } };
}

interface CountRow {
  id: string;
  status: string;
  warehouseId: string;
  notes: string | null;
  createdAt: string;
  lines: CountLine[];
}

export default function CountsPage() {
  const queryClient = useQueryClient();
  const picker = useInventoryPicker();
  const [selected, setSelected] = useState<Record<string, string>>({});

  const counts = useQuery({
    queryKey: ['counts'],
    queryFn: () => api<{ items: CountRow[]; pageInfo: { totalItems: number } }>('/inventory/counts?page=1&pageSize=50'),
    retry: false,
  });

  const toggle = (batch: BatchOption) => {
    setSelected((s) => {
      const next = { ...s };
      if (batch.id in next) delete next[batch.id];
      else next[batch.id] = '';
      return next;
    });
  };

  const create = useMutation({
    meta: { success: 'Count saved' },
    mutationFn: () =>
      api('/inventory/counts', {
        method: 'POST',
        body: {
          warehouseId: picker.warehouseId,
          lines: Object.entries(selected).map(([batchId, countedQty]) => ({
            productId: picker.productId,
            batchId,
            countedQty,
          })),
        },
      }),
    onSuccess: () => {
      setSelected({});
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
    },
  });

  const post = useMutation({
    meta: { success: 'Count posted to stock' },
    mutationFn: (countId: string) => api(`/inventory/counts/${countId}/post`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['batch-options'] });
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
  });

  const canCreate =
    Boolean(picker.warehouseId) &&
    Object.entries(selected).length > 0 &&
    Object.values(selected).every((v) => Number(v) >= 0) &&
    !create.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Stock counts" subtitle="Cycle counts with variance posting as compensating movements." />

      <Card title="New cycle count">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Warehouse">
            <Select
              value={picker.warehouseId}
              onChange={(e) => {
                picker.setWarehouseId(e.target.value);
                setSelected({});
              }}
            >
              <option value="">Select warehouse…</option>
              {picker.warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Product">
            <Select
              value={picker.productId}
              onChange={(e) => {
                picker.setProductId(e.target.value);
                setSelected({});
              }}
              disabled={!picker.warehouseId}
            >
              <option value="">Select product…</option>
              {picker.products.options.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </Select>
          </Field>
        </div>

        {picker.productId && picker.warehouseId ? (
          picker.batches.isLoading ? (
            <div className="mt-3"><Spinner /></div>
          ) : (picker.batches.options.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">No batches of this product in the selected warehouse.</p>
          ) : (
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">System qty</th>
                  <th className="px-3 py-2">Counted qty</th>
                  <th className="px-3 py-2">Include</th>
                </tr>
              }
            >
              {picker.batches.options.map((b) => {
                const onHand = b.onHand ?? 0;
                const counted = selected[b.id];
                return (
                  <Tr key={b.id}>
                    <td className="px-3 py-2 text-sm">
                      <span className="font-mono text-xs">{b.batchNumber}</span>
                      <span className="ml-2 text-xs text-neutral-500">exp {new Date(b.expiryDate).toLocaleDateString()}</span>
                    </td>
                    <td className="px-3 py-2 text-sm">{onHand}</td>
                    <td className="px-3 py-2">
                      <Input
                        className="w-24"
                        placeholder="Counted"
                        inputMode="decimal"
                        value={counted ?? ''}
                        disabled={!(b.id in selected)}
                        onChange={(e) => setSelected((s) => ({ ...s, [b.id]: e.target.value }))}
                      />
                      {counted !== undefined && counted !== '' && Number(counted) !== onHand ? (
                        <Badge tone={Number(counted) > onHand ? 'blue' : 'amber'}>
                          variance {Number(counted) - onHand > 0 ? '+' : ''}
                          {Number(counted) - onHand}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-teal-600"
                        checked={b.id in selected}
                        onChange={() => toggle(b)}
                      />
                    </td>
                  </Tr>
                );
              })}
            </Table>
          )
        ) : null}

        {create.error ? (
          <div className="mt-3">
            <ErrorBanner>{create.error instanceof ApiClientError ? create.error.message : 'Failed to create count'}</ErrorBanner>
          </div>
        ) : null}
        <div className="mt-4">
          <Button disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? 'Saving…' : `Save count (${Object.keys(selected).length} lines)`}
          </Button>
        </div>
      </Card>

      <Card title={`Counts (${counts.data?.pageInfo.totalItems ?? 0})`}>
        {counts.isLoading ? (
          <Spinner />
        ) : counts.error ? (
          <ErrorState
            message={
              counts.error instanceof ApiClientError && counts.error.status === 403
                ? 'You do not have permission to view counts.'
                : 'Failed to load counts.'
            }
            retry={() => void counts.refetch()}
          />
        ) : (counts.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No counts yet" hint="Count physical stock; variances post as compensating movements." />
        ) : (
          <div className="space-y-3">
            {counts.data?.items.map((c) => (
              <div key={c.id} className="mc-anim-fade-up rounded-lg border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-neutral-700">
                    Count {c.id.slice(0, 8)} · {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={c.status === 'POSTED' ? 'green' : c.status === 'COMPLETED' ? 'amber' : 'neutral'} dot>
                      {c.status}
                    </Badge>
                    {c.status === 'COMPLETED' ? (
                      <Button variant="secondary" disabled={post.isPending} onClick={() => post.mutate(c.id)}>
                        Post variances
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-xs text-neutral-600">
                  {c.lines.map((l) => (
                    <div key={l.id}>
                      {l.batch.product.name} <span className="font-mono">{l.batch.batchNumber}</span>
                      {' · '}system {Number(l.systemQty)} · counted {Number(l.countedQty)} ·{' '}
                      <span className={Number(l.variance) < 0 ? 'text-red-600' : 'text-emerald-700'}>
                        variance {Number(l.variance) > 0 ? '+' : ''}
                        {Number(l.variance)}
                      </span>
                    </div>
                  ))}
                </div>
                {post.error ? (
                  <div className="mt-2">
                    <ErrorBanner>{post.error instanceof ApiClientError ? post.error.message : 'Posting failed'}</ErrorBanner>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
