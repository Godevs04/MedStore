'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useInventoryPicker } from '@/lib/inventory-picker';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Field,
  Input,
  Select,
  Spinner,
  Table,
  Tr,
} from '@/components/ui';

interface TransferLine {
  id: string;
  quantity: string;
  receivedQty: string;
  batch: { id: string; batchNumber: string; product: { name: string; sku: string } };
}

interface TransferRow {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  lines: TransferLine[];
}

const STATUS_TONES: Record<string, 'neutral' | 'green' | 'amber' | 'red' | 'blue'> = {
  DRAFT: 'neutral',
  DISPATCHED: 'blue',
  IN_TRANSIT: 'blue',
  PARTIALLY_RECEIVED: 'amber',
  RECEIVED: 'green',
  CANCELLED: 'red',
};

export default function TransfersPage() {
  const queryClient = useQueryClient();
  const picker = useInventoryPicker();
  const [destWarehouseId, setDestWarehouseId] = useState('');
  const [lines, setLines] = useState<Array<{ batchId: string; quantity: string }>>([]);
  const [receiptQty, setReceiptQty] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState<Record<string, string>>({});

  const transfers = useQuery({
    queryKey: ['transfers'],
    queryFn: () => api<{ items: TransferRow[]; pageInfo: { totalItems: number } }>('/inventory/transfers?page=1&pageSize=50'),
    retry: false,
  });

  const warehouseName = (id: string) => picker.warehouses.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8);

  const create = useMutation({
    mutationFn: () =>
      api('/inventory/transfers', {
        method: 'POST',
        body: {
          sourceWarehouseId: picker.warehouseId,
          destinationWarehouseId: destWarehouseId,
          lines: lines.map((l) => ({ productId: picker.productId, batchId: l.batchId, quantity: l.quantity })),
        },
      }),
    onSuccess: () => {
      setLines([]);
      setDestWarehouseId('');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['batch-options'] });
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
  });

  const receive = useMutation({
    mutationFn: (vars: { transferId: string; lines: Array<{ transferLineId: string; receivedQty: string }> }) =>
      api(`/inventory/transfers/${vars.transferId}/receive`, { method: 'POST', body: { lines: vars.lines } }),
    onSuccess: () => {
      setReceiptQty({});
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['batch-options'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
  });

  const cancel = useMutation({
    mutationFn: (vars: { transferId: string; reason: string }) =>
      api(`/inventory/transfers/${vars.transferId}/cancel`, { method: 'POST', body: { reason: vars.reason } }),
    onSuccess: () => {
      setCancelReason({});
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['batch-options'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
  });

  const addLine = () => {
    const batch = picker.batches.options.find((b) => b.id === batchSelection);
    if (!batch) return;
    setLines((s) => [...s, { batchId: batch.id, quantity: '' }]);
    setBatchSelection('');
  };
  const [batchSelection, setBatchSelection] = useState('');

  const canCreate =
    Boolean(picker.warehouseId && destWarehouseId && picker.warehouseId !== destWarehouseId) &&
    lines.length > 0 &&
    lines.every((l) => Number(l.quantity) > 0) &&
    !create.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Stock transfers</h1>

      <Card title="Dispatch transfer">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Source warehouse">
            <Select
              value={picker.warehouseId}
              onChange={(e) => { picker.setWarehouseId(e.target.value); setLines([]); }}
            >
              <option value="">Select source…</option>
              {picker.warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Destination warehouse">
            <Select value={destWarehouseId} onChange={(e) => setDestWarehouseId(e.target.value)}>
              <option value="">Select destination…</option>
              {picker.warehouses.data?.filter((w) => w.id !== picker.warehouseId).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Product">
            <Select value={picker.productId} onChange={(e) => { picker.setProductId(e.target.value); setLines([]); }} disabled={!picker.warehouseId}>
              <option value="">Select product…</option>
              {picker.products.options.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </Select>
          </Field>
        </div>

        {picker.productId ? (
          <div className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <Field label="Add batch line">
                <Select value={batchSelection} onChange={(e) => setBatchSelection(e.target.value)} disabled={!picker.productId}>
                  <option value="">Select batch…</option>
                  {picker.batches.options.filter((b) => (b.onHand ?? 0) > 0 && !lines.some((l) => l.batchId === b.id)).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batchNumber} · exp {new Date(b.expiryDate).toLocaleDateString()} · {(b.onHand ?? 0)} on hand
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button variant="secondary" onClick={addLine} disabled={!batchSelection}>
              + Add line
            </Button>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <div className="mt-3 space-y-2">
            {lines.map((l, idx) => {
              const batch = picker.batches.options.find((b) => b.id === l.batchId);
              return (
                <div key={l.batchId} className="mc-anim-fade-up flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
                  <div className="flex-1 text-sm">
                    <span className="font-mono text-xs text-neutral-600">{batch?.batchNumber}</span>
                    <span className="ml-2 text-xs text-neutral-500">on hand {batch?.onHand}</span>
                  </div>
                  <Input
                    className="w-28"
                    placeholder="Qty"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) =>
                      setLines((s) => s.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                    }
                  />
                  {batch && Number(l.quantity) > (batch.onHand ?? 0) ? (
                    <Badge tone="red">exceeds stock</Badge>
                  ) : null}
                  <Button variant="ghost" onClick={() => setLines((s) => s.filter((_, i) => i !== idx))}>
                    ✕
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}

        {create.error ? (
          <div className="mt-3">
            <ErrorBanner>{create.error instanceof ApiClientError ? create.error.message : 'Failed to dispatch transfer'}</ErrorBanner>
          </div>
        ) : null}
        <div className="mt-4">
          <Button disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending ? 'Dispatching…' : 'Dispatch transfer'}
          </Button>
        </div>
      </Card>

      <Card title={`Transfers (${transfers.data?.pageInfo.totalItems ?? 0})`}>
        {transfers.isLoading ? (
          <Spinner />
        ) : transfers.error ? (
          <ErrorState
            message={
              transfers.error instanceof ApiClientError && transfers.error.status === 403
                ? 'You do not have permission to view transfers.'
                : 'Failed to load transfers.'
            }
            retry={() => void transfers.refetch()}
          />
        ) : (transfers.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No transfers yet" hint="Move stock between warehouses — dispatch, track, receive." />
        ) : (
          <div className="space-y-3">
            {transfers.data?.items.map((t) => (
              <div key={t.id} className="mc-anim-fade-up rounded-lg border border-neutral-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <span className="font-medium text-neutral-800">
                      {warehouseName(t.sourceWarehouseId)} → {warehouseName(t.destinationWarehouseId)}
                    </span>
                    <span className="ml-2 text-xs text-neutral-500">{new Date(t.createdAt).toLocaleString()}</span>
                  </div>
                  <Badge tone={STATUS_TONES[t.status] ?? 'neutral'} dot>
                    {t.status}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1.5">
                  {t.lines.map((l) => {
                    const key = `${t.id}:${l.id}`;
                    const pending = t.status === 'DISPATCHED' || t.status === 'PARTIALLY_RECEIVED';
                    const outstanding = Number(l.quantity) - Number(l.receivedQty);
                    return (
                      <div key={l.id} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-neutral-600">
                          {l.batch.product.name} <span className="font-mono">{l.batch.batchNumber}</span>
                          {' · '}dispatched {Number(l.quantity)} · received {Number(l.receivedQty)}
                        </span>
                        {pending && outstanding > 0 ? (
                          <>
                            <Input
                              className="w-24"
                              placeholder="Receive"
                              inputMode="decimal"
                              value={receiptQty[key] ?? ''}
                              onChange={(e) => setReceiptQty((s) => ({ ...s, [key]: e.target.value }))}
                            />
                            <Button
                              variant="secondary"
                              disabled={!(Number(receiptQty[key]) > 0) || receive.isPending}
                              onClick={() =>
                                receive.mutate({
                                  transferId: t.id,
                                  lines: [{ transferLineId: l.id, receivedQty: receiptQty[key]! }],
                                })
                              }
                            >
                              Receive
                            </Button>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {receive.error ? (
                  <div className="mt-2">
                    <ErrorBanner>{receive.error instanceof ApiClientError ? receive.error.message : 'Receipt failed'}</ErrorBanner>
                  </div>
                ) : null}
                {(t.status === 'DISPATCHED' || t.status === 'PARTIALLY_RECEIVED') ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      className="w-56"
                      placeholder="Cancellation reason"
                      value={cancelReason[t.id] ?? ''}
                      onChange={(e) => setCancelReason((s) => ({ ...s, [t.id]: e.target.value }))}
                    />
                    <Button
                      variant="danger"
                      disabled={(cancelReason[t.id] ?? '').trim().length < 3 || cancel.isPending}
                      onClick={() => cancel.mutate({ transferId: t.id, reason: cancelReason[t.id]!.trim() })}
                    >
                      Cancel & return stock
                    </Button>
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
