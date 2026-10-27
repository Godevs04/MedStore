'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { countCancelSchema, countCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { BATCH_STATUS_LABEL, BATCH_STATUS_TONE, daysUntil, qtyFmt, saveCsv, useCan, useWarehouses } from '@/lib/stock';
import { ConfirmDialog, ExpiryPill, KpiGrid, Meter, Pagination, QtyInput, SearchInput, useDebouncedValue, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Textarea, Th, Tr, cn, money } from '@/components/ui';

interface CountLine {
  id: string;
  countedQty: string;
  systemQty: string;
  variance: string;
  batch: { id: string; batchNumber: string; purchaseRate: string; product: { name: string; sku: string } };
}

interface CountRow {
  id: string;
  status: string;
  warehouseId: string;
  notes: string | null;
  createdAt: string;
  postedAt: string | null;
  lines: CountLine[];
}

interface SheetRow {
  batchId: string;
  productId: string;
  productName: string;
  sku: string;
  rackLocation: string | null;
  batchNumber: string;
  expiryDate: string;
  status: string;
  purchaseRate: string;
  systemQty: number;
}

const STATUS_TONE: Record<string, 'neutral' | 'green' | 'amber' | 'red' | 'blue'> = {
  DRAFT: 'neutral',
  IN_PROGRESS: 'blue',
  COMPLETED: 'amber',
  POSTED: 'green',
  CANCELLED: 'red',
};
const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', IN_PROGRESS: 'In progress', COMPLETED: 'Awaiting post', POSTED: 'Posted', CANCELLED: 'Cancelled' };

function countStats(lines: CountLine[]) {
  let gain = 0;
  let loss = 0;
  let exact = 0;
  for (const l of lines) {
    const v = Number(l.variance);
    const value = Math.abs(v) * Number(l.batch.purchaseRate);
    if (v === 0) exact += 1;
    else if (v > 0) gain += value;
    else loss += value;
  }
  return { gain, loss, net: gain - loss, accuracy: lines.length ? (exact / lines.length) * 100 : 100 };
}

function CountSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const dq = useDebouncedValue(search.trim(), 300);

  useEffect(() => {
    if (!warehouseId && warehouses.list.length > 0) setWarehouseId((warehouses.list.find((w) => w.isDefault) ?? warehouses.list[0])!.id);
  }, [warehouses.list, warehouseId]);

  const sheet = useQuery({
    queryKey: ['count-sheet', warehouseId, dq, includeZero],
    queryFn: () => api<{ items: SheetRow[]; truncated: boolean }>(`/inventory/counts/sheet?warehouseId=${warehouseId}&includeZero=${includeZero}${dq ? `&search=${encodeURIComponent(dq)}` : ''}`),
    enabled: Boolean(warehouseId),
    placeholderData: (prev) => prev,
  });
  const [known, setKnown] = useState<Record<string, SheetRow>>({});
  useEffect(() => {
    if (sheet.data) setKnown((k) => ({ ...k, ...Object.fromEntries(sheet.data.items.map((r) => [r.batchId, r])) }));
  }, [sheet.data]);

  const entered = Object.entries(counted).filter(([, v]) => v !== '');
  const summary = useMemo(() => {
    let gain = 0;
    let loss = 0;
    let exact = 0;
    for (const [id, v] of entered) {
      const row = known[id];
      if (!row) continue;
      const diff = Number(v) - row.systemQty;
      if (diff === 0) exact += 1;
      else if (diff > 0) gain += diff * Number(row.purchaseRate);
      else loss += -diff * Number(row.purchaseRate);
    }
    return { gain, loss, exact };
  }, [entered, known]);

  const rows = (sheet.data?.items ?? []).filter((r) => !onlyEntered || (counted[r.batchId] ?? '') !== '');

  const body = () => ({
    warehouseId,
    notes: notes.trim() || null,
    lines: entered.map(([batchId, countedQty]) => ({ productId: known[batchId]?.productId ?? '', batchId, countedQty })),
  });

  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: () => api('/inventory/counts', { method: 'POST', body: body() }),
    onSuccess: () => {
      toast.success('Count saved', `${entered.length} batches counted · review and post variances from the list`);
      setConfirm(false);
      onDone();
      onClose();
    },
    onError: (e) => {
      setConfirm(false);
      toast.error('Count could not be saved', e instanceof ApiClientError ? e.message : undefined);
    },
  });

  const review = () => {
    if (!entered.length) {
      toast.warning('Nothing counted yet', 'Enter the physical quantity for at least one batch. Blank rows are skipped.');
      return;
    }
    const parsed = countCreateSchema.safeParse(body());
    if (!parsed.success) {
      toast.error('Check the counted quantities', parsed.error.issues[0]?.message);
      return;
    }
    setConfirm(true);
  };

  const fillMatches = () => {
    const next = { ...counted };
    for (const r of rows) if ((next[r.batchId] ?? '') === '') next[r.batchId] = String(r.systemQty);
    setCounted(next);
    toast.info('System quantities filled', 'Overwrite only the rows that differ on the shelf.');
  };

  return (
    <Card title="New stock count" actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Warehouse" required hint={warehouses.isSuccess && warehouses.list.length === 0 ? 'No warehouse yet — add one under Branches' : undefined} className="md:col-span-4">
          <Select
            value={warehouseId}
            onChange={(e) => {
              if (entered.length && !window.confirm('Switching warehouse discards the quantities entered so far. Continue?')) return;
              setWarehouseId(e.target.value);
              setCounted({});
              setKnown({});
            }}
          >
            {warehouses.list.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Find batch or product" className="md:col-span-5">
          <SearchInput value={search} onChange={setSearch} placeholder="Name, SKU or batch no." />
        </Field>
        <div className="flex flex-col justify-end gap-1 text-xs text-neutral-600 md:col-span-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            Include zero-stock batches
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={onlyEntered} onChange={(e) => setOnlyEntered(e.target.checked)} />
            Show counted rows only
          </label>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-neutral-50 p-3 text-xs md:grid-cols-4">
        <div>
          <div className="text-neutral-500">Counted</div>
          <div className="text-base font-semibold tabular-nums">
            {entered.length} / {sheet.data?.items.length ?? 0}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">Exact matches</div>
          <div className="text-base font-semibold tabular-nums">{summary.exact}</div>
        </div>
        <div>
          <div className="text-neutral-500">Gain (cost)</div>
          <div className="text-base font-semibold tabular-nums text-emerald-700">{money(summary.gain)}</div>
        </div>
        <div>
          <div className="text-neutral-500">Loss (cost)</div>
          <div className="text-base font-semibold tabular-nums text-red-600">{money(summary.loss)}</div>
        </div>
      </div>

      <div className="mt-3 max-h-[480px] overflow-auto rounded-lg border border-neutral-100">
        {sheet.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : sheet.error ? (
          <ErrorState message="Failed to load the count sheet." retry={() => void sheet.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No batches to count" hint={dq ? 'Nothing matches this search.' : 'This warehouse has no stocked batches.'} />
        ) : (
          <Table
            head={
              <tr>
                <Th>Rack</Th>
                <Th>Product / batch</Th>
                <Th>Expiry</Th>
                <Th right>System</Th>
                <Th right>Counted</Th>
                <Th right>Variance</Th>
              </tr>
            }
          >
            {rows.map((r) => {
              const v = counted[r.batchId] ?? '';
              const diff = v === '' ? null : Number(v) - r.systemQty;
              return (
                <Tr key={r.batchId}>
                  <Td className="font-mono text-xs text-neutral-500">{r.rackLocation ?? '—'}</Td>
                  <Td>
                    <div className="font-medium text-neutral-800">{r.productName}</div>
                    <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                      <span className="font-mono">{r.batchNumber}</span>
                      {r.status !== 'SALEABLE' ? <Badge tone={BATCH_STATUS_TONE[r.status] ?? 'neutral'}>{BATCH_STATUS_LABEL[r.status] ?? r.status}</Badge> : null}
                    </div>
                  </Td>
                  <Td>
                    <ExpiryPill days={daysUntil(r.expiryDate)} />
                  </Td>
                  <Td right className="tabular-nums">
                    {qtyFmt(r.systemQty)}
                  </Td>
                  <Td right>
                    <div className="ml-auto w-24">
                      <QtyInput value={v} onChange={(x) => setCounted((c) => ({ ...c, [r.batchId]: x }))} placeholder="—" aria-label={`Counted quantity for ${r.batchNumber}`} />
                    </div>
                  </Td>
                  <Td right className={cn('font-semibold tabular-nums', diff === null ? 'text-neutral-300' : diff === 0 ? 'text-emerald-700' : diff > 0 ? 'text-blue-700' : 'text-red-600')}>
                    {diff === null ? '—' : diff === 0 ? <Icon name="check" size={14} strokeWidth={2.5} label="Matches" /> : `${diff > 0 ? '+' : ''}${qtyFmt(diff)}`}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </div>
      {sheet.data?.truncated ? <p className="mt-1 text-xs text-amber-700">Showing the first 2,000 batches — narrow with search.</p> : null}

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
        <Field label="Notes" className="md:col-span-7">
          <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Counted by, rack range, observations…" maxLength={500} />
        </Field>
        <div className="flex items-end justify-end gap-2 md:col-span-5">
          <Button variant="ghost" onClick={fillMatches} disabled={!rows.length}>
            Fill blanks with system
          </Button>
          <Button onClick={review}>Save count ({entered.length})</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Save this count?"
        message={
          <>
            {entered.length} batch{entered.length === 1 ? '' : 'es'} at <b>{warehouses.nameOf(warehouseId)}</b>. Expected gain {money(summary.gain)}, loss {money(summary.loss)}. Stock does not change until you post the count.
          </>
        }
        confirmLabel="Save count"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

export default function CountsPage() {
  const qc = useQueryClient();
  const can = useCan();
  const warehouses = useWarehouses();
  const [tab, setTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [posting, setPosting] = useState<CountRow | null>(null);
  const [cancelling, setCancelling] = useState<CountRow | null>(null);
  useEffect(() => setPage(1), [tab]);

  const status = tab === 'pending' ? 'COMPLETED' : tab === 'posted' ? 'POSTED' : tab === 'cancelled' ? 'CANCELLED' : '';
  const list = useQuery({
    queryKey: ['counts', status, page],
    queryFn: () => api<{ items: CountRow[]; pageInfo: PageInfo }>(`/inventory/counts?page=${page}&pageSize=10${status ? `&status=${status}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const pending = useQuery({
    queryKey: ['counts', 'pending-count'],
    queryFn: () => api<{ items: CountRow[]; pageInfo: PageInfo }>('/inventory/counts?page=1&pageSize=50&status=COMPLETED'),
  });
  const posted = useQuery({
    queryKey: ['counts', 'recent-posted'],
    queryFn: () => api<{ items: CountRow[]; pageInfo: PageInfo }>('/inventory/counts?page=1&pageSize=20&status=POSTED'),
  });
  const recentLines = (posted.data?.items ?? []).flatMap((c) => c.lines);
  const recent = countStats(recentLines);
  const pendingValue = (pending.data?.items ?? []).reduce((s, c) => s + countStats(c.lines).net, 0);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['counts'] });
    void qc.invalidateQueries({ queryKey: ['count-sheet'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
    void qc.invalidateQueries({ queryKey: ['ledger'] });
    void qc.invalidateQueries({ queryKey: ['stock-batch-options'] });
  };

  const post = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (id: string) => api(`/inventory/counts/${id}/post`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Count posted', 'Variances were booked to stock and to Inventory gain/loss');
      setPosting(null);
      refresh();
    },
    onError: (e) => {
      setPosting(null);
      toast.error('Posting failed', e instanceof ApiClientError ? e.message : undefined);
    },
  });
  const cancel = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (v: { id: string; reason: string }) => api(`/inventory/counts/${v.id}/cancel`, { method: 'POST', body: { reason: v.reason } }),
    onSuccess: () => {
      toast.success('Count cancelled', 'No stock was changed');
      setCancelling(null);
      refresh();
    },
    onError: (e) => toast.error('Cancel failed', e instanceof ApiClientError ? e.message : undefined),
  });

  const exportCount = (c: CountRow) =>
    saveCsv(
      `stock-count-${c.id.slice(0, 8)}.csv`,
      ['Product', 'SKU', 'Batch', 'System qty', 'Counted qty', 'Variance', 'Variance value'],
      c.lines.map((l) => [l.batch.product.name, l.batch.product.sku, l.batch.batchNumber, l.systemQty, l.countedQty, l.variance, (Number(l.variance) * Number(l.batch.purchaseRate)).toFixed(2)]),
    );

  const items = list.data?.items ?? [];
  const postingStats = posting ? countStats(posting.lines) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Stock counts"
        subtitle="Physical verification by rack. Variances post as compensating movements and to the books — keep counts regular for Drugs & Cosmetics Rules inspections."
        actions={can('inventory.count') && !creating ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> New count</Button> : null}
      />

      <KpiGrid cols={3}>
        <Stat label="Awaiting post" value={String(pending.data?.pageInfo.totalItems ?? 0)} hint={`Net ${money(pendingValue)} pending`} tone={(pending.data?.pageInfo.totalItems ?? 0) > 0 ? 'amber' : 'green'} />
        <Stat label="Count accuracy" value={`${recent.accuracy.toFixed(1)}%`} hint={`Exact lines in last ${posted.data?.items.length ?? 0} posted counts`} tone={recent.accuracy >= 95 ? 'green' : recent.accuracy >= 85 ? 'amber' : 'red'} delay={60} />
        <Stat label="Shrinkage (recent)" value={money(recent.loss)} hint={`Gains ${money(recent.gain)}`} tone={recent.loss > 0 ? 'red' : 'green'} delay={120} />
      </KpiGrid>

      {creating ? <CountSheet onClose={() => setCreating(false)} onDone={refresh} /> : null}

      <Card>
        <Tabs
          tabs={[
            { id: 'pending', label: 'Awaiting post', count: pending.data?.pageInfo.totalItems },
            { id: 'posted', label: 'Posted' },
            { id: 'cancelled', label: 'Cancelled' },
            { id: 'all', label: 'All' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="mt-3">
          {list.isLoading ? (
            <SkeletonRows rows={4} cols={4} />
          ) : list.error ? (
            <ErrorState message="Failed to load counts." retry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title="No counts here" hint={tab === 'pending' ? 'Nothing is waiting to be posted.' : 'Start a count from the button above.'} />
          ) : (
            <>
              <div className="space-y-2">
                {items.map((c, i) => {
                  const st = countStats(c.lines);
                  const isOpen = expanded === c.id;
                  const variances = c.lines.filter((l) => Number(l.variance) !== 0);
                  return (
                    <div key={c.id} className="mc-anim-fade-up rounded-xl border border-neutral-200 p-3" style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button type="button" className="text-left" onClick={() => setExpanded(isOpen ? null : c.id)} aria-expanded={isOpen}>
                          <div className="text-sm font-medium text-neutral-800">
                            <Icon name="chevronRight" size={14} className={cn('transition-transform duration-200', isOpen && 'rotate-90')} /> Count {c.id.slice(0, 8).toUpperCase()} · {warehouses.nameOf(c.warehouseId)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {c.lines.length} batches · {variances.length} with variance
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('text-xs font-semibold tabular-nums', st.net < 0 ? 'text-red-600' : st.net > 0 ? 'text-emerald-700' : 'text-neutral-500')}>
                            {st.net === 0 ? 'No variance' : `${st.net > 0 ? '+' : '−'}${money(Math.abs(st.net))}`}
                          </span>
                          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'} dot>
                            {STATUS_LABEL[c.status] ?? c.status}
                          </Badge>
                          <Button variant="ghost" onClick={() => exportCount(c)}>
                            CSV
                          </Button>
                          {c.status === 'COMPLETED' && can('inventory.count') ? (
                            <>
                              <Button variant="ghost" onClick={() => setCancelling(c)}>
                                Cancel
                              </Button>
                              <Button onClick={() => setPosting(c)}>Post variances</Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 max-w-xs">
                        <Meter value={st.accuracy} tone={st.accuracy >= 95 ? 'green' : st.accuracy >= 85 ? 'amber' : 'red'} label={`Accuracy ${st.accuracy.toFixed(1)}%`} />
                      </div>
                      {c.notes ? <p className="mt-1 text-xs text-neutral-500">{c.notes}</p> : null}
                      {isOpen ? (
                        <div className="mc-anim-fade-in mt-3">
                          <Table
                            head={
                              <tr>
                                <Th>Product / batch</Th>
                                <Th right>System</Th>
                                <Th right>Counted</Th>
                                <Th right>Variance</Th>
                                <Th right>Value</Th>
                              </tr>
                            }
                          >
                            {c.lines.map((l) => {
                              const v = Number(l.variance);
                              return (
                                <Tr key={l.id}>
                                  <Td>
                                    <div className="font-medium text-neutral-800">{l.batch.product.name}</div>
                                    <div className="font-mono text-xs text-neutral-500">{l.batch.batchNumber}</div>
                                  </Td>
                                  <Td right>{qtyFmt(Number(l.systemQty))}</Td>
                                  <Td right>{qtyFmt(Number(l.countedQty))}</Td>
                                  <Td right className={cn('font-semibold', v === 0 ? 'text-emerald-700' : v > 0 ? 'text-blue-700' : 'text-red-600')}>
                                    {v === 0 ? <Icon name="check" size={14} strokeWidth={2.5} label="Matches" /> : `${v > 0 ? '+' : ''}${qtyFmt(v)}`}
                                  </Td>
                                  <Td right>{v === 0 ? '—' : money(v * Number(l.batch.purchaseRate))}</Td>
                                </Tr>
                              );
                            })}
                          </Table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <Pagination info={list.data?.pageInfo} onChange={setPage} label="counts" />
            </>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(posting)}
        title="Post count variances?"
        message={
          posting && postingStats ? (
            <>
              {posting.lines.filter((l) => Number(l.variance) !== 0).length} batch variances will adjust stock at <b>{warehouses.nameOf(posting.warehouseId)}</b>: gain {money(postingStats.gain)}, loss {money(postingStats.loss)}. Posting is permanent and books the net to Inventory gain/loss.
            </>
          ) : null
        }
        confirmLabel="Post variances"
        busy={post.isPending}
        onConfirm={() => posting && post.mutate(posting.id)}
        onCancel={() => setPosting(null)}
      />
      <ConfirmDialog
        open={Boolean(cancelling)}
        tone="danger"
        title="Cancel this count?"
        message="The count is kept for audit but its variances will never be posted."
        confirmLabel="Cancel count"
        busy={cancel.isPending}
        reason={{ label: 'Reason', minLength: 5, placeholder: 'Recount scheduled, wrong rack…' }}
        onConfirm={(reason) => {
          const ok = countCancelSchema.safeParse({ reason });
          if (!ok.success || !cancelling) {
            toast.error(ok.success ? 'Nothing to cancel' : (ok.error.issues[0]?.message ?? 'Give a reason'));
            return;
          }
          cancel.mutate({ id: cancelling.id, reason: ok.data.reason });
        }}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}
