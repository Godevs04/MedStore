'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { batchCreateSchema, batchDateIssues, priceLadderIssues } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import {
  BATCH_STATUS_LABEL,
  BATCH_STATUS_TONE,
  MOVEMENT_LABELS,
  ProductSearch,
  daysUntil,
  qtyFmt,
  useCan,
  useWarehouses,
  type ProductHit,
} from '@/lib/stock';
import { ConfirmDialog, ExpiryPill, FilterChips, FormSection, KpiGrid, MoneyInput, Pagination, QtyInput, SearchInput, useDebouncedValue, useFieldErrors, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Th, Tr, cn, fmtDate, money, todayIso, StatusBadge, MetricGroup } from '@/components/ui';

interface BatchRow {
  id: string;
  productId: string;
  warehouseId: string;
  batchNumber: string;
  expiryDate: string;
  manufacturingDate: string | null;
  status: string;
  purchaseRate: string;
  mrp: string;
  sourceDocument: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string; genericName: string | null; rackLocation: string | null; requiresRefrigeration: boolean };
  balances: Array<{ quantity: string; warehouseId: string }>;
}

interface RecallRow {
  id: string;
  reason: string;
  notes: string | null;
  status: string;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  batch: { id: string; batchNumber: string; expiryDate: string; product: { name: string; sku: string } };
}

interface StockSummary {
  value: { cost: string; mrp: string };
  batches: Record<string, { batches: number; quantity: number; cost: string }>;
  expired: { batches: number; cost: string };
  expiring30: { batches: number; cost: string };
}

type StatusFilter = 'SALEABLE' | 'QUARANTINED' | 'RECALLED' | 'DAMAGED' | 'EXPIRED_BLOCKED';
type ExpiryFilter = 'expired' | 'd30' | 'd90' | 'd180';
type StatusAction = { batch: BatchRow; to: 'SALEABLE' | 'QUARANTINED' | 'DAMAGED' | 'EXPIRED_BLOCKED' | 'RECALL' };

const BATCH_PATTERN = /^[A-Z0-9][A-Z0-9/.-]{0,31}$/;

const shiftIso = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const onHandOf = (b: BatchRow) => b.balances.reduce((s, x) => s + Number(x.quantity), 0);

// ── Opening stock ────────────────────────────────────────────────────────────

function OpeningStockDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const warehouses = useWarehouses();
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [f, setF] = useState({ warehouseId: '', batchNumber: '', manufacturingDate: '', expiryDate: '', quantity: '', freeQuantity: '', purchaseRate: '', mrp: '' });
  const { errors, clear, validate, setServerErrors } = useFieldErrors();
  const set = (k: keyof typeof f, v: string) => {
    setF((s) => ({ ...s, [k]: v }));
    clear(k);
  };
  useEffect(() => {
    if (!f.warehouseId && warehouses.list.length > 0) setF((s) => ({ ...s, warehouseId: (warehouses.list.find((w) => w.isDefault) ?? warehouses.list[0])!.id }));
  }, [warehouses.list, f.warehouseId]);

  const days = f.expiryDate ? daysUntil(f.expiryDate) : null;
  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (body: Record<string, unknown>) => api<BatchRow>('/inventory/batches', { method: 'POST', body }),
    onSuccess: (b) => {
      toast.success('Opening stock recorded', `${product?.name ?? ''} · batch ${b.batchNumber}`);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && setServerErrors(e.details)) toast.error('Please fix the highlighted fields', e.message);
      else toast.error('Could not record opening stock', e instanceof ApiClientError ? e.message : undefined);
    },
  });

  const submit = () => {
    const body = {
      productId: product?.id ?? '',
      warehouseId: f.warehouseId,
      batchNumber: f.batchNumber.trim(),
      expiryDate: f.expiryDate,
      manufacturingDate: f.manufacturingDate || null,
      quantity: f.quantity,
      freeQuantity: f.freeQuantity || '0',
      purchaseRate: f.purchaseRate,
      mrp: f.mrp,
    };
    const extra: Record<string, string> = {};
    if (!product) extra.productId = 'Select the product';
    if (!f.warehouseId) extra.warehouseId = 'Select the warehouse';
    if (body.batchNumber && !BATCH_PATTERN.test(body.batchNumber)) extra.batchNumber = 'Use the batch number printed on the pack (A–Z, 0–9, / . -)';
    if (!f.expiryDate) extra.expiryDate = 'Expiry date is required';
    for (const i of batchDateIssues({ expiryDate: f.expiryDate || null, manufacturingDate: f.manufacturingDate || null, requireFutureExpiry: true })) extra[i.field] ??= i.message;
    if (f.purchaseRate && f.mrp) {
      for (const i of priceLadderIssues({ mrp: f.mrp, purchasePrice: f.purchaseRate })) if (i.field === 'purchasePrice') extra.purchaseRate ??= i.message;
    }
    if (!(Number(f.quantity) > 0)) extra.quantity = 'Quantity must be greater than zero';
    if (!f.purchaseRate) extra.purchaseRate = 'Enter the purchase rate';
    if (!f.mrp) extra.mrp = 'Enter the MRP printed on the pack';
    if (!validate(batchCreateSchema, body, extra)) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate(body);
  };

  return (
    <Drawer open onClose={onClose} title="Record opening stock" subtitle="For stock you already hold. Purchases create batches through goods receipts." width="max-w-xl">
      <FormSection title="Product & location">
        <Field label="Product" required error={errors.productId}>
          <ProductSearch value={product?.id ?? null} onPick={(p) => { setProduct(p); clear('productId'); if (p?.mrp && !f.mrp) set('mrp', Number(p.mrp).toFixed(2)); }} invalid={Boolean(errors.productId)} />
        </Field>
        <Field label="Warehouse" required error={errors.warehouseId}>
          <Select value={f.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
            <option value="">Select…</option>
            {warehouses.list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>
      <FormSection title="Batch" hint="As printed on the strip/carton (Drugs Rules labelling).">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batch number" required error={errors.batchNumber} className="col-span-2">
            <Input value={f.batchNumber} onChange={(e) => set('batchNumber', e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="DL24A113" className="font-mono" />
          </Field>
          <Field label="Mfg. date" error={errors.manufacturingDate}>
            <Input type="date" value={f.manufacturingDate} max={todayIso()} onChange={(e) => set('manufacturingDate', e.target.value)} />
          </Field>
          <Field
            label="Expiry date"
            required
            error={errors.expiryDate}
            hint={days !== null && days >= 0 ? (days < 180 ? <span className="text-warning"><Icon name="warning" size={13} /> Short expiry — {days} days left</span> : `${days} days left`) : undefined}
          >
            <Input type="date" value={f.expiryDate} min={shiftIso(1)} onChange={(e) => set('expiryDate', e.target.value)} />
          </Field>
        </div>
      </FormSection>
      <FormSection title="Quantity & value">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" required error={errors.quantity}>
            <QtyInput value={f.quantity} onChange={(v) => set('quantity', v)} invalid={Boolean(errors.quantity)} />
          </Field>
          <Field label="Free quantity" error={errors.freeQuantity} hint="Scheme / bonus units">
            <QtyInput value={f.freeQuantity} onChange={(v) => set('freeQuantity', v)} />
          </Field>
          <Field label="Purchase rate" required error={errors.purchaseRate} hint="Per unit, excluding GST">
            <MoneyInput value={f.purchaseRate} onChange={(v) => set('purchaseRate', v)} invalid={Boolean(errors.purchaseRate)} />
          </Field>
          <Field label="MRP" required error={errors.mrp}>
            <MoneyInput value={f.mrp} onChange={(v) => set('mrp', v)} invalid={Boolean(errors.mrp)} />
          </Field>
        </div>
        {Number(f.quantity) > 0 && Number(f.purchaseRate) > 0 ? (
          <p className="mc-anim-fade-in text-xs text-neutral-600">
            Stock value at cost: <span className="font-semibold num">{money((Number(f.quantity) + Number(f.freeQuantity || 0)) * Number(f.purchaseRate))}</span> — posted to Inventory / Opening balance.
          </p>
        ) : null}
      </FormSection>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Record opening stock'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Drawer>
  );
}

// ── Batch detail ─────────────────────────────────────────────────────────────

function BatchDrawer({ batch, warehouseName, onClose, onAction, can }: { batch: BatchRow; warehouseName: string; onClose: () => void; onAction: (a: StatusAction) => void; can: (p: string) => boolean }) {
  const ledger = useQuery({
    queryKey: ['batch-ledger', batch.id],
    queryFn: () => api<{ items: Array<{ id: string; movementType: string; quantity: string; reason: string | null; sourceDocument: string | null; createdAt: string; actorName: string | null }> }>(`/inventory/ledger?page=1&pageSize=50&batchId=${batch.id}`),
  });
  const qty = onHandOf(batch);
  const days = daysUntil(batch.expiryDate);
  return (
    <Drawer
      open
      onClose={onClose}
      title={`${batch.product.name} · ${batch.batchNumber}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={batch.status} label={BATCH_STATUS_LABEL[batch.status]} tone={BATCH_STATUS_TONE[batch.status]} />
          <ExpiryPill days={days} />
          <span>{warehouseName}</span>
        </span>
      }
    >
      <MetricGroup columns={2}>
        <Stat label="On hand" value={qtyFmt(qty)} />
        <Stat label="Cost value" value={money(qty * Number(batch.purchaseRate))} hint={`@ ${money(batch.purchaseRate)}`} />
        <Stat label="MRP value" value={money(qty * Number(batch.mrp))} hint={`@ ${money(batch.mrp)}`} />
        <Stat label="Expiry" value={fmtDate(batch.expiryDate)} hint={batch.manufacturingDate ? `Mfg ${fmtDate(batch.manufacturingDate)}` : undefined} />
      </MetricGroup>
      {can('inventory.recall') ? (
        <div className="flex flex-wrap gap-2">
          {batch.status === 'SALEABLE' ? (
            <>
              <Button variant="secondary" onClick={() => onAction({ batch, to: 'QUARANTINED' })}>
                Quarantine
              </Button>
              <Button variant="secondary" onClick={() => onAction({ batch, to: 'DAMAGED' })}>
                Mark damaged
              </Button>
              <Button variant="danger" onClick={() => onAction({ batch, to: 'RECALL' })}>
                Recall
              </Button>
            </>
          ) : batch.status === 'QUARANTINED' || batch.status === 'DAMAGED' ? (
            <Button onClick={() => onAction({ batch, to: 'SALEABLE' })} disabled={days < 0}>
              Release to saleable
            </Button>
          ) : null}
        </div>
      ) : null}
      <Card variant="section" title="Movements">
        {ledger.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : (ledger.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No movements" />
        ) : (
          <Table
            head={
              <tr>
                <Th>When</Th>
                <Th>Movement</Th>
                <Th right>Qty</Th>
                <Th>By</Th>
              </tr>
            }
          >
            {ledger.data?.items.map((m) => {
              const q = Number(m.quantity);
              return (
                <Tr key={m.id}>
                  <Td className="whitespace-nowrap text-xs text-muted">{new Date(m.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                  <Td>
                    <div className="text-sm">{MOVEMENT_LABELS[m.movementType] ?? m.movementType}</div>
                    {m.reason ? <div className="text-2xs text-muted">{m.reason}</div> : null}
                  </Td>
                  <Td right className={cn('font-medium', q >= 0 ? 'text-success' : 'text-danger')}>
                    {q > 0 ? '+' : ''}
                    {qtyFmt(q)}
                  </Td>
                  <Td className="text-xs text-muted">{m.actorName ?? '—'}</Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>
    </Drawer>
  );
}

// ── Recalls ──────────────────────────────────────────────────────────────────

function RecallsPanel({ can }: { can: (p: string) => boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | ''>('OPEN');
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<RecallRow | null>(null);
  useEffect(() => setPage(1), [status]);
  const recalls = useQuery({
    queryKey: ['recalls', status, page],
    queryFn: () => api<{ items: RecallRow[]; pageInfo: PageInfo }>(`/inventory/recalls?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const resolve = useMutation({
    meta: { silent: true },
    mutationFn: ({ id, notes }: { id: string; notes: string }) => api(`/inventory/recalls/${id}/resolve`, { method: 'POST', body: { resolutionNotes: notes } }),
    onSuccess: () => {
      toast.success('Recall resolved', 'Closed in the recall register.');
      setResolving(null);
      void qc.invalidateQueries({ queryKey: ['recalls'] });
    },
  });
  const items = recalls.data?.items ?? [];
  return (
    <Card title="Recall register" actions={<FilterChips options={[{ id: 'OPEN', label: 'Open', tone: 'red' }, { id: 'RESOLVED', label: 'Resolved', tone: 'green' }]} value={status} onChange={setStatus} />}>
      {recalls.isLoading ? (
        <SkeletonRows rows={4} cols={5} />
      ) : recalls.error ? (
        <ErrorState message="Failed to load recalls" retry={() => void recalls.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={status === 'OPEN' ? 'No open recalls' : 'No recalls'} hint="Recall a batch from the Batches tab when a manufacturer or CDSCO/State FDA issues a notice." />
      ) : (
        <>
          <Table
            head={
              <tr>
                <Th>Raised</Th>
                <Th>Product / batch</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            }
          >
            {items.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.createdAt)}</Td>
                <Td>
                  <div className="font-medium text-ink">{r.batch.product.name}</div>
                  <div className="font-mono text-xs text-muted">{r.batch.batchNumber}</div>
                </Td>
                <Td className="max-w-xs text-xs text-neutral-600">
                  {r.reason}
                  {r.resolutionNotes ? <div className="mt-0.5 text-success"><Icon name="check" size={13} strokeWidth={2.5} /> {r.resolutionNotes}</div> : null}
                </Td>
                <Td>
                  <Badge tone={r.status === 'OPEN' ? 'red' : 'green'} dot={r.status === 'OPEN'}>
                    {r.status === 'OPEN' ? 'Open' : `Resolved ${r.resolvedAt ? fmtDate(r.resolvedAt) : ''}`}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {r.status === 'OPEN' && can('inventory.recall') ? (
                    <Button variant="secondary" onClick={() => setResolving(r)}>
                      Resolve
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Table>
          <Pagination info={recalls.data?.pageInfo} onChange={setPage} label="recalls" />
        </>
      )}
      <ConfirmDialog
        open={Boolean(resolving)}
        title={`Resolve recall of ${resolving?.batch.batchNumber ?? ''}`}
        message="Record how the stock was dealt with — returned to the manufacturer, destroyed, or cleared by the regulator."
        reason={{ label: 'Resolution notes', minLength: 3, placeholder: 'Returned 40 units to manufacturer, debit note DN/26/0012' }}
        confirmLabel="Resolve recall"
        busy={resolve.isPending}
        onConfirm={(notes) => resolving && resolve.mutate({ id: resolving.id, notes })}
        onCancel={() => setResolving(null)}
      />
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function BatchesInner() {
  const qc = useQueryClient();
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const warehouses = useWarehouses();
  const [tab, setTab] = useState<'batches' | 'recalls'>('batches');
  const [warehouseId, setWarehouseId] = useState('');
  const [status, setStatus] = useState<StatusFilter | ''>('');
  const [expiry, setExpiry] = useState<ExpiryFilter | ''>('');
  const [search, setSearch] = useState('');
  const dSearch = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<BatchRow | null>(null);
  const [action, setAction] = useState<StatusAction | null>(null);
  const focusId = params.get('focus');

  useEffect(() => setPage(1), [warehouseId, status, expiry, dSearch]);

  const qs = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (warehouseId) qs.set('warehouseId', warehouseId);
  if (status) qs.set('status', status);
  if (dSearch) qs.set('search', dSearch);
  if (expiry === 'expired') qs.set('expiryBefore', shiftIso(-1));
  if (expiry === 'd30' || expiry === 'd90' || expiry === 'd180') {
    qs.set('expiryAfter', todayIso());
    qs.set('expiryBefore', shiftIso(expiry === 'd30' ? 30 : expiry === 'd90' ? 90 : 180));
  }
  const batches = useQuery({
    queryKey: ['batches', qs.toString()],
    queryFn: () => api<{ items: BatchRow[]; pageInfo: PageInfo }>(`/inventory/batches?${qs.toString()}`),
    placeholderData: (prev) => prev,
  });
  const summary = useQuery({
    queryKey: ['stock-summary', warehouseId],
    queryFn: () => api<StockSummary>(`/inventory/stock-summary${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
  });

  useEffect(() => {
    if (!focusId) return;
    api<{ items: BatchRow[] }>(`/inventory/batches?page=1&pageSize=1&batchId=${focusId}`)
      .then((r) => (r.items[0] ? setSelected(r.items[0]) : toast.error('Batch not found')))
      .catch(() => toast.error('Batch not found'));
  }, [focusId]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['batches'] });
    void qc.invalidateQueries({ queryKey: ['stock-summary'] });
    void qc.invalidateQueries({ queryKey: ['batch-ledger'] });
    void qc.invalidateQueries({ queryKey: ['recalls'] });
  };
  const closeDrawer = () => {
    setSelected(null);
    if (focusId) router.replace('/batches');
  };

  const changeStatus = useMutation({
    meta: { silent: true },
    mutationFn: ({ a, reason }: { a: StatusAction; reason: string }) =>
      a.to === 'RECALL'
        ? api('/inventory/recalls', { method: 'POST', body: { batchId: a.batch.id, reason } })
        : api(`/inventory/batches/${a.batch.id}/status`, { method: 'PUT', body: { status: a.to, reason } }),
    onSuccess: (_, { a }) => {
      const label = a.to === 'RECALL' ? 'Batch recalled' : a.to === 'SALEABLE' ? 'Batch released' : a.to === 'QUARANTINED' ? 'Batch quarantined' : 'Batch marked damaged';
      toast.success(label, `${a.batch.product.name} · ${a.batch.batchNumber}`);
      setAction(null);
      setSelected(null);
      refresh();
    },
  });

  const s = summary.data;
  const items = batches.data?.items ?? [];
  const blocked = s ? ['QUARANTINED', 'DAMAGED', 'RECALLED', 'EXPIRED_BLOCKED'].reduce((n, k) => n + (s.batches[k]?.batches ?? 0), 0) : 0;
  const filtered = Boolean(status || expiry || dSearch || warehouseId);

  const actionCopy: Record<StatusAction['to'], { title: string; message: string; label: string; tone: 'primary' | 'danger' }> = {
    QUARANTINED: { title: 'Quarantine batch', message: 'The batch is blocked from billing until released (e.g. pending quality check or complaint).', label: 'Quarantine', tone: 'primary' },
    DAMAGED: { title: 'Mark batch damaged', message: 'Blocked from billing. Write the stock off from Adjustments once disposed.', label: 'Mark damaged', tone: 'danger' },
    SALEABLE: { title: 'Release to saleable', message: 'The batch becomes available for FEFO billing again.', label: 'Release', tone: 'primary' },
    EXPIRED_BLOCKED: { title: 'Block batch', message: 'Blocked from billing.', label: 'Block', tone: 'danger' },
    RECALL: { title: 'Recall batch', message: 'The batch is blocked immediately and added to the recall register. Notify customers who bought it if required by the notice.', label: 'Recall batch', tone: 'danger' },
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Batch inventory"
        subtitle="Live batch balances by warehouse with expiry, status, quarantine and recalls."
        actions={
          <>
            <Select className="w-full sm:w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
              <option value="">All warehouses</option>
              {warehouses.list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
            {can('inventory.opening') ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> Opening stock</Button> : null}
          </>
        }
      />

      {s ? (
        <KpiGrid bare cols={4}>
          <Stat icon="rupee" label="Stock at cost" value={money(s.value.cost)} hint={`MRP value ${money(s.value.mrp)}`} />
          <Stat icon="batches" label="Saleable batches" value={(s.batches.SALEABLE?.batches ?? 0).toLocaleString('en-IN')} hint={`${qtyFmt(s.batches.SALEABLE?.quantity ?? 0)} units`} />
          <Stat variant="alert" hue="amber" icon="ban" label="Blocked / recalled" value={blocked.toLocaleString('en-IN')} hint="Quarantined, damaged, recalled or blocked" tone={blocked > 0 ? 'amber' : 'neutral'} />
          <Stat
            variant="alert"
            hue="red"
            icon="expiry"
            label="Expiring ≤ 30 days"
            value={money(s.expiring30.cost)}
            hint={`${s.expiring30.batches} batches · ${s.expired.batches} already expired (${money(s.expired.cost)})`}
            tone={s.expiring30.batches + s.expired.batches > 0 ? 'red' : 'neutral'}
            href="/expiry"
          />
        </KpiGrid>
      ) : null}

      <Tabs
        tabs={[
          { id: 'batches', label: 'Batches', count: batches.data?.pageInfo.totalItems },
          { id: 'recalls', label: 'Recalls' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'recalls' ? (
        <RecallsPanel can={can} />
      ) : (
        <Card title="Batches" actions={<SearchInput value={search} onChange={setSearch} placeholder="Batch, product or SKU…" className="w-full sm:w-64" />}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <FilterChips
              options={(['SALEABLE', 'QUARANTINED', 'RECALLED', 'DAMAGED', 'EXPIRED_BLOCKED'] as const).map((k) => ({
                id: k,
                label: BATCH_STATUS_LABEL[k] ?? k,
                tone: k === 'SALEABLE' ? ('green' as const) : k === 'QUARANTINED' ? ('amber' as const) : k === 'EXPIRED_BLOCKED' ? ('neutral' as const) : ('red' as const),
                count: s?.batches[k]?.batches,
              }))}
              value={status}
              onChange={setStatus}
              allLabel="Any status"
            />
            <span className="h-4 w-px bg-neutral-200" />
            <FilterChips
              options={[
                { id: 'expired', label: 'Expired', tone: 'red' },
                { id: 'd30', label: '≤ 30 days', tone: 'red' },
                { id: 'd90', label: '≤ 90 days', tone: 'amber' },
                { id: 'd180', label: '≤ 180 days', tone: 'amber' },
              ]}
              value={expiry}
              onChange={setExpiry}
              allLabel="Any expiry"
            />
          </div>
          {batches.isLoading ? (
            <SkeletonRows rows={6} cols={7} />
          ) : batches.error ? (
            <ErrorState
              message={batches.error instanceof ApiClientError && batches.error.status === 403 ? 'You do not have permission to view inventory.' : 'Failed to load batches.'}
              retry={() => void batches.refetch()}
            />
          ) : items.length === 0 ? (
            <EmptyState title={filtered ? 'No batches match these filters' : 'No batches yet'} hint={filtered ? 'Clear a filter to see more.' : 'Record opening stock or receive a purchase to create batches.'} />
          ) : (
            <>
              <Table
                head={
                  <tr>
                    <Th>Product</Th>
                    <Th>Batch</Th>
                    <Th>Expiry</Th>
                    <Th right>On hand</Th>
                    <Th right>Cost / MRP</Th>
                    <Th right>Value</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                }
              >
                {items.map((b) => {
                  const qty = onHandOf(b);
                  const days = daysUntil(b.expiryDate);
                  return (
                    <Tr key={b.id} onClick={() => setSelected(b)} className={cn(days < 0 && qty > 0 && b.status === 'SALEABLE' && 'bg-danger/[0.04]')}>
                      <Td>
                        <div className="flex items-center gap-1.5 font-medium text-ink">
                          {b.product.name}
                          {b.product.requiresRefrigeration ? <span className="text-info" title="Cold chain"><Icon name="cold" size={13} label="Cold chain" /></span> : null}
                        </div>
                        <div className="text-xs text-muted">
                          <span className="font-mono">{b.product.sku}</span>
                          {!warehouseId ? ` · ${warehouses.nameOf(b.warehouseId)}` : ''}
                          {b.product.rackLocation ? ` · Rack ${b.product.rackLocation}` : ''}
                        </div>
                      </Td>
                      <Td className="font-mono text-xs">{b.batchNumber}</Td>
                      <Td>
                        <div className="text-xs text-neutral-600">{fmtDate(b.expiryDate)}</div>
                        <ExpiryPill days={days} />
                      </Td>
                      <Td right className={cn('font-medium', qty <= 0 && 'text-faint')}>
                        {qtyFmt(qty)}
                      </Td>
                      <Td right className="text-xs">
                        {money(b.purchaseRate)}
                        <div className="text-faint">{money(b.mrp)}</div>
                      </Td>
                      <Td right className="text-sm">{money(qty * Number(b.purchaseRate))}</Td>
                      <Td>
                        <StatusBadge status={b.status} label={BATCH_STATUS_LABEL[b.status]} tone={BATCH_STATUS_TONE[b.status]} />
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
                          {can('inventory.recall') && b.status === 'SALEABLE' ? (
                            <>
                              <Button variant="ghost" onClick={() => setAction({ batch: b, to: 'QUARANTINED' })}>
                                Quarantine
                              </Button>
                              <Button variant="ghost" onClick={() => setAction({ batch: b, to: 'RECALL' })}>
                                Recall
                              </Button>
                            </>
                          ) : can('inventory.recall') && (b.status === 'QUARANTINED' || b.status === 'DAMAGED') && days >= 0 ? (
                            <Button variant="secondary" onClick={() => setAction({ batch: b, to: 'SALEABLE' })}>
                              Release
                            </Button>
                          ) : null}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
              <Pagination info={batches.data?.pageInfo} onChange={setPage} label="batches" />
            </>
          )}
        </Card>
      )}

      {creating ? (
        <OpeningStockDrawer
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      ) : null}
      {selected ? <BatchDrawer key={selected.id} batch={selected} warehouseName={warehouses.nameOf(selected.warehouseId)} onClose={closeDrawer} onAction={setAction} can={can} /> : null}
      <ConfirmDialog
        open={Boolean(action)}
        tone={action ? actionCopy[action.to].tone : 'primary'}
        title={action ? `${actionCopy[action.to].title} ${action.batch.batchNumber}` : ''}
        message={action ? actionCopy[action.to].message : undefined}
        reason={{
          label: action?.to === 'RECALL' ? 'Recall notice / reason' : 'Reason (kept in the audit trail)',
          minLength: 3,
          placeholder: action?.to === 'RECALL' ? 'Manufacturer recall notice MFR-2026-0412' : 'Customer complaint — pending QC',
        }}
        confirmLabel={action ? actionCopy[action.to].label : 'Confirm'}
        busy={changeStatus.isPending}
        onConfirm={(reason) => action && changeStatus.mutate({ a: action, reason })}
        onCancel={() => setAction(null)}
      />
    </div>
  );
}

export default function BatchesPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} cols={6} />}>
      <BatchesInner />
    </Suspense>
  );
}
