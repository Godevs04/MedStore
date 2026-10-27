'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { BATCH_STATUS_LABEL, BATCH_STATUS_TONE, qtyFmt, saveCsv, useCan, useWarehouses } from '@/lib/stock';
import { ConfirmDialog, ExpiryPill, KpiGrid, SearchInput, useDebouncedValue } from '@/components/kit';
import { Button, Card, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, Stat, Table, Td, Th, Tr, cn, fmtDate, money, todayIso, StatusBadge, MetricGroup } from '@/components/ui';

interface ExpiryRow {
  batchId: string;
  productId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  warehouseId: string;
  expiryDate: string;
  daysToExpiry: number;
  bucket: Bucket;
  quantity: number;
  status: string;
  purchaseRate: string;
  mrp: string;
  valueAtCost: string;
  valueAtMrp: string;
}

type Bucket = 'EXPIRED' | 'DAYS_30' | 'DAYS_60' | 'DAYS_90' | 'CUSTOM' | 'OK';

interface Dashboard {
  buckets: Record<Bucket, number>;
  bucketValues: Record<Bucket, { cost: string; mrp: string }>;
  valueAtRisk: { cost: string; mrp: string };
  customDays: number;
  rows: ExpiryRow[];
}

const BUCKETS: Array<{ id: Bucket; label: string; text: string }> = [
  { id: 'EXPIRED', label: 'Expired', text: 'text-danger' },
  { id: 'DAYS_30', label: '≤ 30 days', text: 'text-danger' },
  { id: 'DAYS_60', label: '31–60 days', text: 'text-warning' },
  { id: 'DAYS_90', label: '61–90 days', text: 'text-warning' },
  { id: 'CUSTOM', label: 'Custom', text: 'text-info' },
  { id: 'OK', label: 'Healthy', text: 'text-success' },
];

const writeOffEligible = (r: ExpiryRow) => r.daysToExpiry <= 30 || r.status !== 'SALEABLE';

export default function ExpiryPage() {
  const qc = useQueryClient();
  const can = useCan();
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [customDays, setCustomDays] = useState(180);
  const dDays = useDebouncedValue(customDays, 300);
  const [bucket, setBucket] = useState<Bucket | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [writeOff, setWriteOff] = useState<ExpiryRow[] | null>(null);
  const [block, setBlock] = useState<ExpiryRow | null>(null);

  const qs = new URLSearchParams({ customDays: String(dDays) });
  if (warehouseId) qs.set('warehouseId', warehouseId);
  const dashboard = useQuery({
    queryKey: ['expiry-dashboard', qs.toString()],
    queryFn: () => api<Dashboard>(`/inventory/expiry-dashboard?${qs.toString()}`),
    placeholderData: (prev) => prev,
  });

  useEffect(() => setSelected(new Set()), [bucket, warehouseId]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (dashboard.data?.rows ?? []).filter(
      (r) => (!bucket || r.bucket === bucket) && (!q || r.productName.toLowerCase().includes(q) || r.batchNumber.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q)),
    );
  }, [dashboard.data, bucket, search]);
  const selectedRows = rows.filter((r) => selected.has(r.batchId));
  const eligibleRows = rows.filter(writeOffEligible);

  const refresh = () => {
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ['expiry-dashboard'] });
    void qc.invalidateQueries({ queryKey: ['stock-summary'] });
    void qc.invalidateQueries({ queryKey: ['batches'] });
  };

  const doWriteOff = useMutation({
    meta: { silent: true },
    mutationFn: ({ batchIds, notes }: { batchIds: string[]; notes: string }) =>
      api<{ batches: number; quantity: number; value: string; skipped: string[] }>('/inventory/expiry/bulk-writeoff', {
        method: 'POST',
        body: { batchIds, notes, ...(warehouseId ? { warehouseId } : {}) },
      }),
    onSuccess: (r) => {
      toast.success('Stock written off', `${r.batches} batch(es) · ${qtyFmt(r.quantity)} units · ${money(r.value)} at cost. Keep the destruction record for the Drug Inspector.`);
      if (r.skipped.length) toast.info('Some batches had no stock', r.skipped.join(', '));
      setWriteOff(null);
      refresh();
    },
  });
  const doBlock = useMutation({
    meta: { silent: true },
    mutationFn: ({ row, reason }: { row: ExpiryRow; reason: string }) => api(`/inventory/batches/${row.batchId}/status`, { method: 'PUT', body: { status: 'EXPIRED_BLOCKED', reason } }),
    onSuccess: (_, { row }) => {
      toast.success('Batch blocked from sale', `${row.productName} · ${row.batchNumber}`);
      setBlock(null);
      refresh();
    },
  });

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.warning('Nothing to export');
      return;
    }
    saveCsv(
      `expiry-${bucket || 'all'}-${todayIso()}.csv`,
      ['Product', 'SKU', 'Batch', 'Warehouse', 'Expiry', 'Days', 'Quantity', 'Cost value', 'MRP value', 'Status'],
      rows.map((r) => [r.productName, r.sku, r.batchNumber, warehouses.nameOf(r.warehouseId), r.expiryDate.slice(0, 10), r.daysToExpiry, r.quantity, r.valueAtCost, r.valueAtMrp, r.status]),
    );
    toast.success('Export ready', `${rows.length} rows`);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const d = dashboard.data;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Expiry dashboard"
        subtitle="Stock on hand by days to expiry. Expired drugs must be segregated and destroyed — never sold (Drugs Rules 65(17))."
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
            <Button variant="secondary" onClick={exportCsv}>
              <Icon name="download" size={14} /> Export CSV
            </Button>
          </>
        }
      />

      {dashboard.isLoading ? (
        <SkeletonRows rows={6} cols={6} />
      ) : dashboard.error ? (
        <ErrorState
          message={dashboard.error instanceof ApiClientError && dashboard.error.status === 403 ? 'You do not have permission to view inventory.' : 'Failed to load expiry dashboard.'}
          retry={() => void dashboard.refetch()}
        />
      ) : d ? (
        <>
          <KpiGrid bare cols={3}>
            <Stat variant="alert" hue="red" icon="expiry" label="Value at risk (cost)" value={money(d.valueAtRisk.cost)} hint="Expired + expiring within 90 days" tone={Number(d.valueAtRisk.cost) > 0 ? 'red' : 'neutral'} />
            <Stat icon="rupee" label="Value at risk (MRP)" value={money(d.valueAtRisk.mrp)} hint="Potential sales lost if not sold or returned" tone={Number(d.valueAtRisk.mrp) > 0 ? 'amber' : 'neutral'} />
            <Stat variant="alert" hue="red" icon="expiry" label="Expired, still in stock" value={money(d.bucketValues.EXPIRED.cost)} hint={`${d.buckets.EXPIRED} batches — write off or return to supplier`} tone={d.buckets.EXPIRED > 0 ? 'red' : 'neutral'} />
          </KpiGrid>

          <MetricGroup columns={6}>
            {BUCKETS.map((b) => {
              const on = bucket === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBucket(on ? '' : b.id)}
                  className={cn(
                    'relative px-4 py-3 text-left transition-colors duration-150',
                    on ? 'bg-mint shadow-[inset_0_-2px_0_rgb(var(--mc-primary))]' : 'bg-surface hover:bg-canvas',
                  )}
                  aria-pressed={on}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('text-xs font-medium', b.text)}>{b.id === 'CUSTOM' ? `91–${d.customDays} days` : b.label}</span>
                    {on ? <Icon name="check" size={13} strokeWidth={2.5} className="text-teal-ink" /> : null}
                  </div>
                  <p className="mt-1 text-lg font-medium num text-ink">{d.buckets[b.id]}</p>
                  <p className="text-2xs text-muted">
                    {money(d.bucketValues[b.id].cost)} cost · {money(d.bucketValues[b.id].mrp)} MRP
                  </p>
                </button>
              );
            })}
          </MetricGroup>

          <Card
            title={`Batches${bucket ? ` · ${BUCKETS.find((b) => b.id === bucket)?.label}` : ''} (${rows.length})`}
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  Custom window
                  <input type="range" min={91} max={365} step={1} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} className="accent-brand-600" aria-label="Custom days" />
                  <span className="w-14 num font-medium">{customDays} days</span>
                </label>
                <SearchInput value={search} onChange={setSearch} placeholder="Product, batch or SKU…" className="w-full sm:w-56" />
              </div>
            }
          >
            {selectedRows.length > 0 ? (
              <div className="mc-anim-fade-in mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
                <span className="num text-xs font-medium text-ink">
                  {selectedRows.length} selected · {qtyFmt(selectedRows.reduce((s, r) => s + r.quantity, 0))} units · {money(selectedRows.reduce((s, r) => s + Number(r.valueAtCost), 0))} at cost
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                  {can('inventory.adjust') ? (
                    <Button variant="danger" size="sm" onClick={() => setWriteOff(selectedRows)}>
                      Write off selected
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {rows.length === 0 ? (
              <EmptyState title={bucket || search ? 'No batches in this view' : 'No stock on hand'} hint={bucket ? 'Pick another bucket or clear the filter.' : undefined} />
            ) : (
              <Table
                head={
                  <tr>
                    <Th>
                      {can('inventory.adjust') && eligibleRows.length > 0 ? (
                        <input
                          type="checkbox"
                          aria-label="Select all eligible"
                          checked={eligibleRows.every((r) => selected.has(r.batchId))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(eligibleRows.map((r) => r.batchId)) : new Set())}
                          className="h-4 w-4 rounded border-neutral-300"
                        />
                      ) : null}
                    </Th>
                    <Th>Product / batch</Th>
                    <Th>Expiry</Th>
                    <Th right>Qty</Th>
                    <Th right>Cost value</Th>
                    <Th right>MRP value</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                }
              >
                {rows.map((r) => {
                  const eligible = writeOffEligible(r);
                  return (
                    <Tr key={`${r.batchId}`} className={cn(selected.has(r.batchId) && 'bg-mint/50')}>
                      <Td>
                        {can('inventory.adjust') ? (
                          <input
                            type="checkbox"
                            disabled={!eligible}
                            title={eligible ? 'Select for write-off' : 'Saleable stock more than 30 days from expiry cannot be written off'}
                            checked={selected.has(r.batchId)}
                            onChange={() => toggle(r.batchId)}
                            className="h-4 w-4 rounded border-neutral-300 disabled:opacity-30"
                            aria-label={`Select ${r.batchNumber}`}
                          />
                        ) : null}
                      </Td>
                      <Td>
                        <div className="font-medium text-ink">{r.productName}</div>
                        <div className="text-xs text-muted">
                          <span className="font-mono">{r.batchNumber}</span> · {r.sku}
                          {!warehouseId ? ` · ${warehouses.nameOf(r.warehouseId)}` : ''}
                        </div>
                      </Td>
                      <Td>
                        <div className="text-xs text-neutral-600">{fmtDate(r.expiryDate)}</div>
                        <ExpiryPill days={r.daysToExpiry} />
                      </Td>
                      <Td right className="font-medium">
                        {qtyFmt(r.quantity)}
                      </Td>
                      <Td right>{money(r.valueAtCost)}</Td>
                      <Td right className="text-muted">
                        {money(r.valueAtMrp)}
                      </Td>
                      <Td>
                        <StatusBadge status={r.status} label={BATCH_STATUS_LABEL[r.status]} tone={BATCH_STATUS_TONE[r.status]} />
                      </Td>
                      <Td className="whitespace-nowrap text-right">
                        {r.status === 'SALEABLE' && r.daysToExpiry < 0 && can('inventory.recall') ? (
                          <Button variant="ghost" onClick={() => setBlock(r)}>
                            Block
                          </Button>
                        ) : null}
                        {eligible && can('inventory.adjust') ? (
                          <Button variant="secondary" onClick={() => setWriteOff([r])}>
                            Write off
                          </Button>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(writeOff)}
        tone="danger"
        title={`Write off ${writeOff?.length ?? 0} batch(es)?`}
        message={
          writeOff ? (
            <>
              {qtyFmt(writeOff.reduce((s, r) => s + r.quantity, 0))} units worth {money(writeOff.reduce((s, r) => s + Number(r.valueAtCost), 0))} at cost will be removed{warehouseId ? ' from this warehouse' : ''} as <b>Expiry write-off</b> and the batches blocked from sale. This posts to Inventory loss and cannot be undone.
            </>
          ) : undefined
        }
        reason={{ label: 'Destruction / disposal note', minLength: 3, placeholder: 'Handed to authorised bio-medical waste agency, challan BMW/0412' }}
        confirmLabel="Write off"
        busy={doWriteOff.isPending}
        onConfirm={(notes) => writeOff && doWriteOff.mutate({ batchIds: writeOff.map((r) => r.batchId), notes })}
        onCancel={() => setWriteOff(null)}
      />
      <ConfirmDialog
        open={Boolean(block)}
        title={`Block ${block?.batchNumber ?? ''} from sale?`}
        message="Expired stock is already excluded from FEFO billing; blocking also flags it for segregation until it is written off or returned."
        reason={{ label: 'Reason', minLength: 3, placeholder: 'Expired — moved to the segregated expiry shelf' }}
        confirmLabel="Block batch"
        busy={doBlock.isPending}
        onConfirm={(reason) => block && doBlock.mutate({ row: block, reason })}
        onCancel={() => setBlock(null)}
      />
    </div>
  );
}
