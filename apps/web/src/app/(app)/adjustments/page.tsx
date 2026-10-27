'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { adjustmentCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { ADJUSTMENT_REASON_LABELS, ProductSearch, batchItem, qtyFmt, useBatchOptions, useCan, useWarehouses, type ProductHit } from '@/lib/stock';
import { BarChart, compactInr, Combobox, ConfirmDialog, DateRangePicker, FilterChips, KpiGrid, Pagination, QtyInput, useFieldErrors, type DateRange, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, Select, SkeletonRows, Stat, Table, Td, Textarea, Th, Tr, cn, money } from '@/components/ui';

interface AdjustmentRow {
  id: string;
  direction: 'IN' | 'OUT';
  quantity: string;
  reason: string;
  notes: string | null;
  warehouseId: string;
  createdAt: string;
  actorName: string | null;
  batch: { id: string; batchNumber: string; purchaseRate: string; product: { name: string; sku: string } };
}

interface Summary {
  count: number;
  inValue: string;
  outValue: string;
  netValue: string;
  byReason: Array<{ reason: string; count: number; inQty: number; outQty: number; inValue: string; outValue: string }>;
}

const OUT_ONLY = new Set(['DAMAGE', 'BREAKAGE', 'EXPIRY_WRITEOFF', 'THEFT_LOSS', 'TEMPERATURE_EXCURSION', 'CONTAMINATION']);
const REASONS = Object.keys(ADJUSTMENT_REASON_LABELS);

function AdjustForm({ onDone }: { onDone: () => void }) {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [productKey, setProductKey] = useState(0);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('DAMAGE');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { errors, clear, validate, setServerErrors, setErrors } = useFieldErrors();
  const batches = useBatchOptions(warehouseId, product?.id ?? '');
  const batch = batches.options.find((b) => b.id === batchId) ?? null;

  useEffect(() => {
    if (!warehouseId && warehouses.list.length > 0) setWarehouseId((warehouses.list.find((w) => w.isDefault) ?? warehouses.list[0])!.id);
  }, [warehouses.list, warehouseId]);
  useEffect(() => {
    if (direction === 'IN' && OUT_ONLY.has(reason)) setReason('COUNT_CORRECTION');
  }, [direction, reason]);

  const qty = Number(quantity || 0);
  const after = batch ? batch.onHand + (direction === 'IN' ? qty : -qty) : null;
  const value = batch ? qty * Number(batch.purchaseRate) : 0;

  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: () => api('/inventory/adjustments', { method: 'POST', body: { batchId, warehouseId, direction, quantity, reason, notes: notes.trim() || null } }),
    onSuccess: () => {
      toast.success('Stock adjusted', `${direction === 'IN' ? '+' : '−'}${qtyFmt(qty)} of ${product?.name ?? ''} · ${batch?.batchNumber ?? ''} (${ADJUSTMENT_REASON_LABELS[reason]})`);
      setConfirm(false);
      setQuantity('');
      setNotes('');
      setBatchId(null);
      onDone();
      void batches.refetch();
    },
    onError: (e) => {
      setConfirm(false);
      if (e instanceof ApiClientError && setServerErrors(e.details)) toast.error('Please fix the highlighted fields', e.message);
      else toast.error('Adjustment failed', e instanceof ApiClientError ? e.message : undefined);
    },
  });

  const review = () => {
    const extra: Record<string, string> = {};
    if (!warehouseId) extra.warehouseId = 'Select the warehouse';
    if (!product) extra.productId = 'Select the product';
    if (!batchId) extra.batchId = 'Select the batch';
    if (batch && direction === 'OUT' && qty > batch.onHand) extra.quantity = `Only ${qtyFmt(batch.onHand)} on hand in this batch`;
    if (direction === 'IN' && OUT_ONLY.has(reason)) extra.reason = 'This reason only applies to stock going out';
    if (batch && direction === 'IN' && batch.days < 0) extra.batchId = 'Cannot add stock to an expired batch';
    const ok = validate(adjustmentCreateSchema, { batchId: batchId ?? '', warehouseId, direction, quantity, reason, notes: notes.trim() || null }, extra);
    if (!ok) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setConfirm(true);
  };

  return (
    <Card title="New adjustment">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Warehouse" required hint={warehouses.isSuccess && warehouses.list.length === 0 ? 'No warehouse yet — add one under Branches' : undefined} error={errors.warehouseId} className="md:col-span-3">
          <Select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setBatchId(null);
              clear('warehouseId');
            }}
          >
            <option value="">Select…</option>
            {warehouses.list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Product" required error={errors.productId} className="md:col-span-5">
          <ProductSearch
            key={productKey}
            value={product?.id ?? null}
            invalid={Boolean(errors.productId)}
            onPick={(p) => {
              setProduct(p);
              setBatchId(null);
              clear('productId');
            }}
          />
        </Field>
        <Field label="Batch" required error={errors.batchId} className="md:col-span-4">
          <Combobox
            key={`${warehouseId}-${product?.id ?? ''}`}
            items={batches.options.map((b) => batchItem(b, { allowExpired: direction === 'OUT', allowBlocked: true, requireStock: direction === 'OUT' }))}
            value={batchId}
            onChange={(id) => {
              setBatchId(id);
              clear('batchId');
            }}
            disabled={!product || !warehouseId}
            loading={batches.isFetching}
            placeholder={product ? 'Pick a batch…' : 'Select a product first'}
            emptyText="No batches of this product in this warehouse"
            invalid={Boolean(errors.batchId)}
          />
        </Field>

        <Field label="Direction" className="md:col-span-3">
          <div className="inline-flex w-full rounded-lg bg-neutral-100 p-1" role="radiogroup">
            {(['OUT', 'IN'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => {
                  setDirection(d);
                  clear('quantity');
                }}
                className={cn(
                  'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                  direction === d ? (d === 'OUT' ? 'bg-surface text-danger ring-1 ring-line' : 'bg-surface text-success ring-1 ring-line') : 'text-muted hover:text-ink',
                )}
              >
                <Icon name={d === 'OUT' ? 'arrowDown' : 'arrowUp'} size={14} strokeWidth={2.25} />
                {d === 'OUT' ? 'Stock out' : 'Stock in'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Quantity" required error={errors.quantity} className="md:col-span-2" hint={batch ? `${qtyFmt(batch.onHand)} on hand` : 'Whole units'}>
          <QtyInput
            value={quantity}
            onChange={(v) => {
              setQuantity(v);
              clear('quantity');
            }}
            invalid={Boolean(errors.quantity)}
          />
        </Field>
        <Field label="Reason" required error={errors.reason} className="md:col-span-3">
          <Select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              clear('reason');
              clear('notes');
            }}
          >
            {REASONS.filter((r) => direction === 'OUT' || !OUT_ONLY.has(r)).map((r) => (
              <option key={r} value={r}>
                {ADJUSTMENT_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={reason === 'OTHER' ? 'Notes (required)' : 'Notes'} required={reason === 'OTHER'} error={errors.notes} className="md:col-span-4">
          <Textarea
            rows={1}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              clear('notes');
            }}
            placeholder={reason === 'TEMPERATURE_EXCURSION' ? 'Fridge logged 12 °C for 6 h on 14 Oct' : 'What happened?'}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {batch && qty > 0 ? (
          <p className="mc-anim-fade-in text-xs text-neutral-600">
            Balance <span className="font-semibold num">{qtyFmt(batch.onHand)}</span> → <span className={cn('font-semibold num', after !== null && after < 0 ? 'text-danger' : 'text-ink')}>{qtyFmt(after ?? 0)}</span> ·{' '}
            {direction === 'IN' ? 'gain' : 'loss'} of <span className="font-semibold">{money(value)}</span> at cost
          </p>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setProduct(null);
              setProductKey((k) => k + 1);
              setBatchId(null);
              setQuantity('');
              setNotes('');
              setErrors({});
            }}
          >
            Reset
          </Button>
          <Button onClick={review} variant={direction === 'OUT' ? 'danger' : 'primary'}>
            Review adjustment
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        tone={direction === 'OUT' ? 'danger' : 'primary'}
        title={`Post ${direction === 'OUT' ? 'stock-out' : 'stock-in'} adjustment?`}
        message={
          <>
            {direction === 'IN' ? '+' : '−'}
            {qtyFmt(qty)} units of <b>{product?.name}</b> batch <span className="font-mono">{batch?.batchNumber}</span> for <b>{ADJUSTMENT_REASON_LABELS[reason]}</b>. Value {money(value)} posts to Inventory {direction === 'IN' ? 'gain' : 'loss'}. Adjustments are permanent; correct mistakes with a reverse adjustment.
          </>
        }
        confirmLabel="Post adjustment"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

export default function AdjustmentsPage() {
  const qc = useQueryClient();
  const can = useCan();
  const warehouses = useWarehouses();
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT' | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [reason, direction, warehouseId, range]);

  const f = new URLSearchParams();
  if (direction) f.set('direction', direction);
  if (warehouseId) f.set('warehouseId', warehouseId);
  if (range.from && (!range.to || range.from <= range.to)) f.set('from', range.from);
  if (range.to && (!range.from || range.from <= range.to)) f.set('to', range.to);
  const listQs = new URLSearchParams(f);
  if (reason) listQs.set('reason', reason);

  const list = useQuery({
    queryKey: ['adjustments', listQs.toString(), page],
    queryFn: () => api<{ items: AdjustmentRow[]; pageInfo: PageInfo }>(`/inventory/adjustments?page=${page}&pageSize=25&${listQs.toString()}`),
    placeholderData: (prev) => prev,
  });
  const summary = useQuery({
    queryKey: ['adjustments-summary', f.toString()],
    queryFn: () => api<Summary>(`/inventory/adjustments/summary?${f.toString()}`),
    placeholderData: (prev) => prev,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['adjustments'] });
    void qc.invalidateQueries({ queryKey: ['adjustments-summary'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
    void qc.invalidateQueries({ queryKey: ['stock-summary'] });
  };

  const s = summary.data;
  const items = list.data?.items ?? [];
  const topOut = s?.byReason.filter((r) => Number(r.outValue) > 0).sort((a, b) => Number(b.outValue) - Number(a.outValue))[0];

  return (
    <div className="space-y-6">
      <PageHeader title="Stock adjustments" subtitle="Damage, breakage, theft, cold-chain loss and corrections — every change is valued at cost, posted to the books and audited." />

      {can('inventory.adjust') ? <AdjustForm onDone={refresh} /> : null}

      {s ? (
        <>
          <KpiGrid bare cols={3}>
            <Stat variant="alert" label="Stock lost" value={money(s.outValue)} hint={topOut ? `Mostly ${ADJUSTMENT_REASON_LABELS[topOut.reason]?.toLowerCase()}` : 'No losses'} tone={Number(s.outValue) > 0 ? 'red' : 'neutral'} />
            <Stat label="Stock gained" value={money(s.inValue)} hint="Corrections and finds" />
            <Stat label="Net impact" value={money(s.netValue)} hint={`${s.count} adjustment${s.count === 1 ? '' : 's'}`} tone={Number(s.netValue) < 0 ? 'amber' : 'neutral'} />
          </KpiGrid>
          <Card variant="section" title="Loss by reason (at cost)">
            <BarChart
              data={s.byReason
                .filter((r) => Number(r.outValue) > 0)
                .map((r) => ({ label: ADJUSTMENT_REASON_LABELS[r.reason] ?? r.reason, value: Number(r.outValue), hint: `${ADJUSTMENT_REASON_LABELS[r.reason]} · ${qtyFmt(r.outQty)} units · ${r.count} entries` }))}
              format={compactInr}
              detailFormat={(n) => money(n)}
              tone="red"
              height={150}
              emptyLabel="No stock losses in this period."
            />
          </Card>
        </>
      ) : null}

      <Card title={`Adjustment history (${list.data?.pageInfo.totalItems ?? 0})`}>
        <div className="mb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChips
              options={[
                { id: 'OUT', label: 'Out', icon: 'arrowDown', tone: 'red' },
                { id: 'IN', label: 'In', icon: 'arrowUp', tone: 'green' },
              ]}
              value={direction}
              onChange={setDirection}
            />
            <Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full sm:w-48" aria-label="Reason">
              <option value="">All reasons</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {ADJUSTMENT_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full sm:w-48" aria-label="Warehouse">
              <option value="">All warehouses</option>
              {warehouses.list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
        {list.isLoading ? (
          <SkeletonRows rows={5} cols={6} />
        ) : list.error ? (
          <ErrorState message="Failed to load adjustments." retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No adjustments in this view" hint="Adjustments appear here once posted." />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <Th>When</Th>
                  <Th>Product / batch</Th>
                  <Th>Reason</Th>
                  <Th right>Qty</Th>
                  <Th right>Value</Th>
                  <Th>Warehouse</Th>
                  <Th>By</Th>
                </tr>
              }
            >
              {items.map((a) => {
                const q = Number(a.quantity);
                return (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs text-muted">{new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                    <Td>
                      <div className="font-medium text-ink">{a.batch.product.name}</div>
                      <div className="font-mono text-xs text-muted">{a.batch.batchNumber}</div>
                    </Td>
                    <Td>
                      <Badge tone={a.direction === 'OUT' ? 'red' : 'green'}>{ADJUSTMENT_REASON_LABELS[a.reason] ?? a.reason}</Badge>
                      {a.notes ? <div className="mt-0.5 max-w-[240px] truncate text-2xs text-muted" title={a.notes}>{a.notes}</div> : null}
                    </Td>
                    <Td right className={cn('font-semibold', a.direction === 'OUT' ? 'text-danger' : 'text-success')}>
                      {a.direction === 'OUT' ? '−' : '+'}
                      {qtyFmt(q)}
                    </Td>
                    <Td right>{money(q * Number(a.batch.purchaseRate))}</Td>
                    <Td className="text-xs text-neutral-600">{warehouses.nameOf(a.warehouseId)}</Td>
                    <Td className="text-xs text-muted">{a.actorName ?? '—'}</Td>
                  </Tr>
                );
              })}
            </Table>
            <Pagination info={list.data?.pageInfo} onChange={setPage} label="adjustments" />
          </>
        )}
      </Card>
    </div>
  );
}
