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
  SkeletonRows,
  Spinner,
  Table,
  Tr,
} from '@/components/ui';

interface AdjustmentRow {
  id: string;
  direction: string;
  quantity: string;
  reason: string;
  notes: string | null;
  createdAt: string;
  batch: { batchNumber: string; product: { name: string; sku: string } };
}

const REASONS = [
  'DAMAGE',
  'BREAKAGE',
  'EXPIRY_WRITEOFF',
  'THEFT_LOSS',
  'COUNT_CORRECTION',
  'DATA_ENTRY_CORRECTION',
  'TEMPERATURE_EXCURSION',
  'CONTAMINATION',
  'OTHER',
] as const;

export default function AdjustmentsPage() {
  const queryClient = useQueryClient();
  const picker = useInventoryPicker();
  const [batchId, setBatchId] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<string>('DAMAGE');
  const [notes, setNotes] = useState('');

  const adjustments = useQuery({
    queryKey: ['adjustments'],
    queryFn: () => api<{ items: AdjustmentRow[]; pageInfo: { totalItems: number } }>('/inventory/adjustments?page=1&pageSize=50'),
    retry: false,
  });

  const selectedBatch = picker.batches.options.find((b) => b.id === batchId) ?? null;

  const adjust = useMutation({
    mutationFn: () =>
      api('/inventory/adjustments', {
        method: 'POST',
        body: { batchId, warehouseId: picker.warehouseId, direction, quantity, reason, notes: notes || null },
      }),
    onSuccess: () => {
      setQuantity('');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      void queryClient.invalidateQueries({ queryKey: ['batch-options'] });
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
    },
  });

  const canSubmit = Boolean(batchId && picker.warehouseId && Number(quantity) > 0) && !adjust.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Stock adjustments</h1>

      <Card title="New adjustment">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Warehouse">
            <Select value={picker.warehouseId} onChange={(e) => { picker.setWarehouseId(e.target.value); setBatchId(''); }}>
              <option value="">Select warehouse…</option>
              {picker.warehouses.data?.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Product">
            <Select value={picker.productId} onChange={(e) => { picker.setProductId(e.target.value); setBatchId(''); }} disabled={!picker.warehouseId}>
              <option value="">Select product…</option>
              {picker.products.options.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
              ))}
            </Select>
          </Field>
          <Field label="Batch">
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} disabled={!picker.productId}>
              <option value="">Select batch…</option>
              {picker.batches.options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber} · exp {new Date(b.expiryDate).toLocaleDateString()} · {(b.onHand ?? 0)} on hand
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Direction">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}>
              <option value="OUT">OUT (reduce stock)</option>
              <option value="IN">IN (add stock)</option>
            </Select>
          </Field>
          <Field label="Quantity">
            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="Reason (mandatory)">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-3">
            <Field label="Notes (optional)">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details for the audit trail" />
            </Field>
          </div>
        </div>
        {selectedBatch && direction === 'OUT' && Number(quantity) > (selectedBatch.onHand ?? 0) ? (
          <div className="mt-3">
            <ErrorBanner>
              Quantity {quantity} exceeds on-hand {selectedBatch.onHand ?? 0} — the server will reject this adjustment.
            </ErrorBanner>
          </div>
        ) : null}
        {adjust.error ? (
          <div className="mt-3">
            <ErrorBanner>{adjust.error instanceof ApiClientError ? adjust.error.message : 'Failed to post adjustment'}</ErrorBanner>
          </div>
        ) : null}
        <div className="mt-4">
          <Button disabled={!canSubmit} onClick={() => adjust.mutate()}>
            {adjust.isPending ? 'Posting…' : 'Post adjustment'}
          </Button>
        </div>
      </Card>

      <Card title={`Adjustment history (${adjustments.data?.pageInfo.totalItems ?? 0})`}>
        {adjustments.isLoading ? (
          <Spinner />
        ) : adjustments.error ? (
          <ErrorState
            message={
              adjustments.error instanceof ApiClientError && adjustments.error.status === 403
                ? 'You do not have permission to view adjustments.'
                : 'Failed to load adjustments.'
            }
            retry={() => void adjustments.refetch()}
          />
        ) : (adjustments.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No adjustments yet" hint="Damage, expiry write-offs and corrections appear here with full audit context." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Product / batch</th>
                <th className="px-3 py-2">Direction</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            }
          >
            {adjustments.data?.items.map((a) => (
              <Tr key={a.id}>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                  {new Date(a.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-sm">
                  {a.batch.product.name}
                  <span className="ml-1.5 font-mono text-xs text-neutral-500">{a.batch.batchNumber}</span>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={a.direction === 'IN' ? 'green' : 'amber'}>{a.direction}</Badge>
                </td>
                <td className="px-3 py-2 text-sm font-medium">{Number(a.quantity)}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">
                  {a.reason}
                  {a.notes ? <span className="text-neutral-400"> · {a.notes}</span> : null}
                </td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
