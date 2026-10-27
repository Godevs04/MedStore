'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { transferCancelSchema, transferCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { MOVEMENT_LABELS, ProductSearch, batchItem, qtyFmt, useBatchOptions, useCan, useWarehouses, type BatchChoice, type ProductHit } from '@/lib/stock';
import { Combobox, ConfirmDialog, FormSection, KpiGrid, Meter, Pagination, QtyInput, useFieldErrors, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Textarea, Th, Tr, cn, money } from '@/components/ui';

interface TransferLine {
  id: string;
  quantity: string;
  receivedQty: string;
  batch: { id: string; batchNumber: string; expiryDate: string; purchaseRate: string; product: { name: string; sku: string } };
}

interface TransferRow {
  id: string;
  status: string;
  notes: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  lines: TransferLine[];
}

interface TransferDetail extends TransferRow {
  sourceWarehouseName: string | null;
  destinationWarehouseName: string | null;
  createdByName: string | null;
  movements: Array<{ id: string; movementType: string; quantity: string; warehouseId: string; reason: string | null; createdAt: string }>;
}

const STATUS_TONE: Record<string, 'neutral' | 'green' | 'amber' | 'red' | 'blue'> = {
  DRAFT: 'neutral',
  DISPATCHED: 'blue',
  IN_TRANSIT: 'blue',
  PARTIALLY_RECEIVED: 'amber',
  RECEIVED: 'green',
  CANCELLED: 'red',
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  DISPATCHED: 'In transit',
  IN_TRANSIT: 'In transit',
  PARTIALLY_RECEIVED: 'Part received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};
const OPEN = new Set(['DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED']);

const totals = (lines: TransferLine[]) => {
  const sent = lines.reduce((s, l) => s + Number(l.quantity), 0);
  const got = lines.reduce((s, l) => s + Number(l.receivedQty), 0);
  const value = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.batch.purchaseRate), 0);
  return { sent, got, value, pct: sent > 0 ? (got / sent) * 100 : 0 };
};

interface DraftLine {
  key: number;
  product: ProductHit | null;
  batchId: string | null;
  quantity: string;
  batch: BatchChoice | null;
}

function LineEditor({
  index,
  line,
  warehouseId,
  errors,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  line: DraftLine;
  warehouseId: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const batches = useBatchOptions(warehouseId, line.product?.id ?? '');
  const err = (f: string) => errors[`lines.${index}.${f}`];
  return (
    <div className={cn('mc-anim-fade-up grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-12', Object.keys(errors).some((k) => k.startsWith(`lines.${index}.`)) ? 'border-red-200 bg-red-50/40' : 'border-neutral-200')}>
      <Field label={`Line ${index + 1} · product`} required error={err('productId')} className="md:col-span-5">
        <ProductSearch value={line.product?.id ?? null} invalid={Boolean(err('productId'))} disabled={!warehouseId} onPick={(p) => onChange({ product: p, batchId: null, batch: null })} />
      </Field>
      <Field label="Batch" required error={err('batchId')} className="md:col-span-4">
        <Combobox
          key={`${warehouseId}-${line.product?.id ?? ''}`}
          items={batches.options.map((b) => batchItem(b, { allowBlocked: true, requireStock: true }))}
          value={line.batchId}
          onChange={(id) => onChange({ batchId: id, batch: batches.options.find((b) => b.id === id) ?? null })}
          disabled={!line.product}
          loading={batches.isFetching}
          placeholder={line.product ? 'Pick a batch…' : 'Select a product first'}
          emptyText="No stocked batches in the source warehouse"
          invalid={Boolean(err('batchId'))}
        />
      </Field>
      <Field label="Qty" required error={err('quantity')} hint={line.batch ? `max ${qtyFmt(line.batch.onHand)}` : undefined} className="md:col-span-2">
        <QtyInput value={line.quantity} onChange={(v) => onChange({ quantity: v })} invalid={Boolean(err('quantity'))} />
      </Field>
      <div className="flex items-end md:col-span-1">
        <Button variant="ghost" onClick={onRemove} disabled={!canRemove} aria-label={`Remove line ${index + 1}`}>
          <Icon name="close" size={14} />
        </Button>
      </div>
    </div>
  );
}

let lineSeq = 1;
const newLine = (): DraftLine => ({ key: lineSeq++, product: null, batchId: null, quantity: '', batch: null });

function NewTransfer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const warehouses = useWarehouses();
  const [source, setSource] = useState('');
  const [dest, setDest] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [confirm, setConfirm] = useState(false);
  const { errors, clear, validate, setServerErrors, setErrors } = useFieldErrors();

  useEffect(() => {
    if (!source && warehouses.list.length > 0) setSource((warehouses.list.find((w) => w.isDefault) ?? warehouses.list[0])!.id);
  }, [warehouses.list, source]);

  const patch = (key: number, p: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('lines.'))));
  };

  const body = () => ({
    sourceWarehouseId: source,
    destinationWarehouseId: dest,
    notes: notes.trim() || null,
    lines: lines.map((l) => ({ productId: l.product?.id ?? '', batchId: l.batchId ?? '', quantity: l.quantity })),
  });
  const units = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const value = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.batch?.purchaseRate ?? 0), 0);

  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: () => api<{ id: string }>('/inventory/transfers', { method: 'POST', body: body() }),
    onSuccess: () => {
      toast.success('Transfer dispatched', `${qtyFmt(units)} units on their way to ${warehouses.nameOf(dest)}`);
      setConfirm(false);
      onDone();
      onClose();
    },
    onError: (e) => {
      setConfirm(false);
      if (e instanceof ApiClientError && setServerErrors(e.details)) toast.error('Please fix the highlighted fields', e.message);
      else toast.error('Transfer failed', e instanceof ApiClientError ? e.message : undefined);
    },
  });

  const review = () => {
    const extra: Record<string, string> = {};
    if (!source) extra.sourceWarehouseId = 'Select the source warehouse';
    if (!dest) extra.destinationWarehouseId = 'Select the destination warehouse';
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      if (!l.product) extra[`lines.${i}.productId`] = 'Select a product';
      if (!l.batchId) extra[`lines.${i}.batchId`] = l.product ? 'Select a batch' : 'Pick the product first';
      if (l.batch && l.batch.days < 0) extra[`lines.${i}.batchId`] = 'Expired stock must stay segregated for destruction';
      if (l.batch && Number(l.quantity) > l.batch.onHand) extra[`lines.${i}.quantity`] = `Only ${qtyFmt(l.batch.onHand)} on hand`;
      if (l.batchId && seen.has(l.batchId)) extra[`lines.${i}.batchId`] = 'This batch is already on another line';
      if (l.batchId) seen.add(l.batchId);
    });
    if (!validate(transferCreateSchema, body(), extra)) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setConfirm(true);
  };

  return (
    <Card title="New stock transfer" actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <FormSection title="Route" hint="Stock leaves the source on dispatch and is in transit until received.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="From" required error={errors.sourceWarehouseId}>
              <Select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setLines([newLine()]);
                  clear('sourceWarehouseId');
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
            <Field label="To" required error={errors.destinationWarehouseId}>
              <Select
                value={dest}
                onChange={(e) => {
                  setDest(e.target.value);
                  clear('destinationWarehouseId');
                }}
              >
                <option value="">Select…</option>
                {warehouses.list
                  .filter((w) => w.id !== source)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Notes" error={errors.notes}>
              <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Vehicle no., courier, delivery challan…" />
            </Field>
          </div>
          {warehouses.list.length < 2 ? <p className="mt-2 text-xs text-amber-700">Only one warehouse exists. Add another under Branches to transfer stock.</p> : null}
        </FormSection>
        <FormSection title={`Lines (${lines.length})`}>
          {errors.lines ? <p className="mb-2 text-xs text-red-600">{errors.lines}</p> : null}
          <div className="space-y-2">
            {lines.map((l, i) => (
              <LineEditor
                key={l.key}
                index={i}
                line={l}
                warehouseId={source}
                errors={errors}
                onChange={(p) => patch(l.key, p)}
                onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                canRemove={lines.length > 1}
              />
            ))}
          </div>
          <Button variant="secondary" className="mt-2" onClick={() => setLines((ls) => [...ls, newLine()])} disabled={lines.length >= 50}>
            <Icon name="plus" size={14} strokeWidth={2.25} /> Add line
          </Button>
        </FormSection>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
          <p className="text-xs text-neutral-600">
            {qtyFmt(units)} units · {money(value)} at cost
          </p>
          <Button onClick={review}>Review & dispatch</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Dispatch this transfer?"
        message={
          <>
            {lines.length} line{lines.length === 1 ? '' : 's'} · {qtyFmt(units)} units ({money(value)}) will leave <b>{warehouses.nameOf(source)}</b> now and arrive at <b>{warehouses.nameOf(dest)}</b> once received.
          </>
        }
        confirmLabel="Dispatch"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

function TransferDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const can = useCan();
  const warehouses = useWarehouses();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cancel, setCancel] = useState(false);
  const { errors, setErrors } = useFieldErrors();
  const detail = useQuery({
    queryKey: ['transfer', id],
    queryFn: () => api<TransferDetail>(`/inventory/transfers/${id}`),
    enabled: Boolean(id),
  });
  const t = detail.data;
  useEffect(() => {
    setQty({});
    setErrors({});
  }, [id, setErrors]);

  const receive = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (lines: Array<{ transferLineId: string; receivedQty: string }>) => api(`/inventory/transfers/${id}/receive`, { method: 'POST', body: { lines } }),
    onSuccess: (_d, lines) => {
      toast.success('Stock received', `${qtyFmt(lines.reduce((s, l) => s + Number(l.receivedQty), 0))} units added to ${t?.destinationWarehouseName ?? 'the destination'}`);
      setQty({});
      onChanged();
      void detail.refetch();
    },
    onError: (e) => toast.error('Receipt failed', e instanceof ApiClientError ? e.message : undefined),
  });
  const cancelM = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (reason: string) => api(`/inventory/transfers/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast.success('Transfer cancelled', 'Undelivered stock was returned to the source warehouse');
      setCancel(false);
      onChanged();
      void detail.refetch();
    },
    onError: (e) => toast.error('Cancel failed', e instanceof ApiClientError ? e.message : undefined),
  });

  const open = t ? OPEN.has(t.status) : false;
  const remaining = (l: TransferLine) => Number(l.quantity) - Number(l.receivedQty);

  const receiveEntered = () => {
    if (!t) return;
    const next: Record<string, string> = {};
    const lines: Array<{ transferLineId: string; receivedQty: string }> = [];
    for (const l of t.lines) {
      const v = qty[l.id];
      if (!v) continue;
      if (Number(v) > remaining(l)) next[l.id] = `Max ${qtyFmt(remaining(l))}`;
      else if (Number(v) > 0) lines.push({ transferLineId: l.id, receivedQty: v });
    }
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error('Cannot receive more than was dispatched');
      return;
    }
    if (!lines.length) {
      toast.warning('Enter the quantities that arrived');
      return;
    }
    receive.mutate(lines);
  };
  const receiveAll = () => {
    if (!t) return;
    receive.mutate(t.lines.filter((l) => remaining(l) > 0).map((l) => ({ transferLineId: l.id, receivedQty: String(remaining(l)) })));
  };

  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={t ? `Transfer ${t.id.slice(0, 8).toUpperCase()}` : 'Transfer'} subtitle={t ? `${t.sourceWarehouseName ?? '—'} → ${t.destinationWarehouseName ?? '—'}` : undefined} width="max-w-2xl">
      {detail.isLoading ? (
        <SkeletonRows rows={5} cols={3} />
      ) : detail.error || !t ? (
        <ErrorState message="Transfer not found." retry={() => void detail.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[t.status] ?? 'neutral'} dot>
              {STATUS_LABEL[t.status] ?? t.status}
            </Badge>
            <span className="text-xs text-neutral-500">
              Dispatched {new Date(t.dispatchedAt ?? t.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {t.createdByName ? ` by ${t.createdByName}` : ''}
            </span>
          </div>
          {t.notes ? <p className="rounded-lg bg-neutral-50 p-2 text-xs text-neutral-600">{t.notes}</p> : null}
          <Meter value={totals(t.lines).pct} tone={t.status === 'RECEIVED' ? 'green' : 'brand'} label={`${qtyFmt(totals(t.lines).got)} of ${qtyFmt(totals(t.lines).sent)} units received`} />
          <Table
            head={
              <tr>
                <Th>Product / batch</Th>
                <Th right>Sent</Th>
                <Th right>Received</Th>
                {open && can('inventory.transfer') ? <Th right>Arrived now</Th> : null}
              </tr>
            }
          >
            {t.lines.map((l) => (
              <Tr key={l.id}>
                <Td>
                  <div className="font-medium text-neutral-800">{l.batch.product.name}</div>
                  <div className="font-mono text-xs text-neutral-500">{l.batch.batchNumber}</div>
                </Td>
                <Td right>{qtyFmt(Number(l.quantity))}</Td>
                <Td right className={remaining(l) === 0 ? 'text-emerald-700' : ''}>
                  {qtyFmt(Number(l.receivedQty))}
                </Td>
                {open && can('inventory.transfer') ? (
                  <Td right>
                    {remaining(l) > 0 ? (
                      <div className="ml-auto w-24">
                        <QtyInput
                          value={qty[l.id] ?? ''}
                          onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))}
                          invalid={Boolean(errors[l.id])}
                          placeholder={String(remaining(l))}
                          aria-label={`Received quantity for ${l.batch.batchNumber}`}
                        />
                        {errors[l.id] ? <p className="mt-0.5 text-[11px] text-red-600">{errors[l.id]}</p> : null}
                      </div>
                    ) : (
                      <span className="text-xs text-emerald-700"><Icon name="check" size={13} strokeWidth={2.5} /> done</span>
                    )}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </Table>
          {open && can('inventory.transfer') ? (
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="danger" onClick={() => setCancel(true)}>
                Cancel transfer
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={receiveEntered} disabled={receive.isPending}>
                  Receive entered
                </Button>
                <Button onClick={receiveAll} disabled={receive.isPending}>
                  {receive.isPending ? 'Receiving…' : 'Receive all'}
                </Button>
              </div>
            </div>
          ) : null}
          {t.movements.length ? (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Stock movements</h4>
              <ol className="space-y-2 border-l border-neutral-200 pl-4">
                {t.movements.map((m) => (
                  <li key={m.id} className="relative text-xs">
                    <span className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full', m.movementType === 'TRANSFER_OUT' ? 'bg-red-400' : 'bg-emerald-500')} />
                    <span className="font-medium text-neutral-800">{MOVEMENT_LABELS[m.movementType] ?? m.movementType}</span> · {qtyFmt(Math.abs(Number(m.quantity)))} units at {warehouses.nameOf(m.warehouseId)}
                    <div className="text-neutral-500">{new Date(m.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={cancel}
        tone="danger"
        title="Cancel this transfer?"
        message="Quantities not yet received go back to the source warehouse. Received stock stays at the destination."
        confirmLabel="Cancel transfer"
        busy={cancelM.isPending}
        reason={{ label: 'Reason', minLength: 3, placeholder: 'Wrong destination, vehicle breakdown…' }}
        onConfirm={(reason) => {
          const ok = transferCancelSchema.safeParse({ reason });
          if (!ok.success) {
            toast.error('Give a reason (min 3 characters)');
            return;
          }
          cancelM.mutate(ok.data.reason);
        }}
        onCancel={() => setCancel(false)}
      />
    </Drawer>
  );
}

function TransfersInner() {
  const qc = useQueryClient();
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const warehouses = useWarehouses();
  const [tab, setTab] = useState('open');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => setPage(1), [tab, warehouseId]);
  useEffect(() => {
    const f = params.get('focus');
    if (f) setFocus(f);
  }, [params]);

  const status = tab === 'open' ? 'DISPATCHED' : tab === 'partial' ? 'PARTIALLY_RECEIVED' : tab === 'received' ? 'RECEIVED' : tab === 'cancelled' ? 'CANCELLED' : '';
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (warehouseId) qs.set('warehouseId', warehouseId);

  const list = useQuery({
    queryKey: ['transfers', qs.toString(), page],
    queryFn: () => api<{ items: TransferRow[]; pageInfo: PageInfo }>(`/inventory/transfers?page=${page}&pageSize=20&${qs.toString()}`),
    placeholderData: (prev) => prev,
  });
  const countOf = (s: string) => ({
    queryKey: ['transfers', 'count', s],
    queryFn: () => api<{ items: TransferRow[]; pageInfo: PageInfo }>(`/inventory/transfers?page=1&pageSize=50&status=${s}`),
  });
  const inTransit = useQuery(countOf('DISPATCHED'));
  const partial = useQuery(countOf('PARTIALLY_RECEIVED'));
  const transitValue = [...(inTransit.data?.items ?? []), ...(partial.data?.items ?? [])].reduce(
    (s, t) => s + t.lines.reduce((x, l) => x + (Number(l.quantity) - Number(l.receivedQty)) * Number(l.batch.purchaseRate), 0),
    0,
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['transfers'] });
    void qc.invalidateQueries({ queryKey: ['stock-batch-options'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
    void qc.invalidateQueries({ queryKey: ['ledger'] });
  };
  const closeDrawer = () => {
    setFocus(null);
    if (params.get('focus')) router.replace('/transfers');
  };

  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Stock transfers"
        subtitle="Move stock between branches and warehouses with dispatch, part-receipt and full audit trail."
        actions={can('inventory.transfer') && !creating ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> New transfer</Button> : null}
      />

      <KpiGrid cols={3}>
        <Stat label="In transit" value={String(inTransit.data?.pageInfo.totalItems ?? 0)} hint="Dispatched, awaiting receipt" tone="blue" />
        <Stat label="Part received" value={String(partial.data?.pageInfo.totalItems ?? 0)} hint="Short or pending lines" tone={(partial.data?.pageInfo.totalItems ?? 0) > 0 ? 'amber' : 'green'} delay={60} />
        <Stat label="Value in transit" value={money(transitValue)} hint="At purchase cost" delay={120} />
      </KpiGrid>

      {creating ? <NewTransfer onClose={() => setCreating(false)} onDone={refresh} /> : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { id: 'open', label: 'In transit', count: inTransit.data?.pageInfo.totalItems },
              { id: 'partial', label: 'Part received', count: partial.data?.pageInfo.totalItems },
              { id: 'received', label: 'Received' },
              { id: 'cancelled', label: 'Cancelled' },
              { id: 'all', label: 'All' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-56" aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </div>
        {list.isLoading ? (
          <SkeletonRows rows={4} cols={4} />
        ) : list.error ? (
          <ErrorState message="Failed to load transfers." retry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No transfers here" hint={tab === 'open' ? 'Nothing is in transit right now.' : 'Transfers appear here once dispatched.'} />
        ) : (
          <>
            <div className="space-y-2">
              {items.map((t, i) => {
                const tt = totals(t.lines);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFocus(t.id)}
                    className="mc-anim-fade-up block w-full rounded-xl border border-neutral-200 p-3 text-left transition hover:border-brand-300 hover:shadow-sm"
                    style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-neutral-800">
                        {warehouses.nameOf(t.sourceWarehouseId)} <Icon name="arrowRight" size={13} className="text-neutral-400" /> {warehouses.nameOf(t.destinationWarehouseId)}
                      </div>
                      <Badge tone={STATUS_TONE[t.status] ?? 'neutral'} dot>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      {t.id.slice(0, 8).toUpperCase()} · {new Date(t.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })} · {t.lines.length} line{t.lines.length === 1 ? '' : 's'} · {qtyFmt(tt.sent)} units · {money(tt.value)}
                    </div>
                    <div className="mt-1 truncate text-xs text-neutral-600">{t.lines.map((l) => `${l.batch.product.name} (${l.batch.batchNumber})`).join(', ')}</div>
                    {t.status !== 'CANCELLED' ? (
                      <div className="mt-2">
                        <Meter value={tt.pct} tone={tt.pct >= 100 ? 'green' : tt.pct > 0 ? 'amber' : 'brand'} />
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <Pagination info={list.data?.pageInfo} onChange={setPage} label="transfers" />
          </>
        )}
      </Card>

      <TransferDrawer id={focus} onClose={closeDrawer} onChanged={refresh} />
    </div>
  );
}

export default function TransfersPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} cols={4} />}>
      <TransfersInner />
    </Suspense>
  );
}
