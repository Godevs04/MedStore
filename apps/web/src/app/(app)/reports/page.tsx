'use client';

import { Icon } from '@/components/icons';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { toast } from '@/lib/toast';
import { BATCH_STATUS_LABEL, BATCH_STATUS_TONE, qtyFmt, useCan, useWarehouses } from '@/lib/stock';
import { BarChart, compactInr, DateRangePicker, Donut, FilterChips, KpiGrid, Pagination, SearchInput, SortableTh, datePresets, type DateRange, type PageInfo, type SortState } from '@/components/kit';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Th, Tr, cn, fmtDate, money, StatusBadge } from '@/components/ui';

interface SalesSummary {
  totals: {
    invoices: number;
    revenue: string;
    taxable: string;
    tax: string;
    discount: string;
    netSales: string;
    costOfGoods: string;
    grossMargin: string;
    returns: number;
    returnsValue: string;
    netRevenue: string;
    averageBill: string;
  };
  byDay: Array<{ date: string; invoices: number; revenue: string }>;
  byProduct: Array<{ productId: string; product: string; quantity: number; revenue: string; margin: string }>;
  byPayment: Array<{ method: string; amount: string }>;
}
interface ValuationRow {
  batchId: string;
  product: string;
  sku: string;
  batchNumber: string;
  expiryDate: string;
  status: string;
  quantity: number;
  purchaseRate: string;
  mrp: string;
  value: string;
}
interface Valuation {
  rows: ValuationRow[];
  totalValue: string;
  totalMrp: string;
  expiredValue: string;
  blockedValue: string;
  bookValue: string;
  unbookedDifference: string;
}
interface AgingRow {
  partyId: string | null;
  party: string;
  docId: string;
  doc: string;
  outstanding: string;
  daysOverdue: number;
  bucket: string;
}
interface AgingSide {
  rows: AgingRow[];
  buckets: Record<string, string>;
  total: string;
}
interface DeadRow {
  productId: string;
  name: string;
  sku: string;
  rackLocation: string | null;
  onHand: number;
  value: string;
  mrpValue: string;
  soldQty: number;
  lastSoldAt: string | null;
  daysSinceSale: number | null;
  coverDays: number | null;
  nearestExpiry: string | null;
  classification: 'DEAD' | 'SLOW';
}
interface DeadStock {
  days: number;
  summary: { deadItems: number; deadValue: string; slowItems: number; slowValue: string };
  items: DeadRow[];
}

type Tab = 'sales' | 'valuation' | 'dead' | 'aging';
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const BUCKETS: Array<[string, string]> = [
  ['CURRENT', 'Current'],
  ['D1_30', '1–30 d'],
  ['D31_60', '31–60 d'],
  ['D61_90', '61–90 d'],
  ['D90_PLUS', '90+ d'],
];
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK: 'Bank', CREDIT: 'Credit', CHEQUE: 'Cheque' };

/** Sorts and pages rows already in memory. */
function useTable<T, F extends string>(rows: T[], initial: SortState<F>, value: (row: T, field: F) => string | number | null, pageSize = 20) {
  const [sort, setSort] = useState<SortState<F>>(initial);
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a, sort.field);
      const y = value(b, sort.field);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, sort, value]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const info: PageInfo = { page: current, pageSize, totalItems: sorted.length, totalPages };
  return {
    sort,
    onSort: (s: SortState<F>) => {
      setSort(s);
      setPage(1);
    },
    rows: sorted.slice((current - 1) * pageSize, current * pageSize),
    info,
    setPage,
  };
}

async function exportCsv(path: string, name: string) {
  try {
    await downloadCsv(path, name);
    toast.success('Export ready', name);
  } catch (e) {
    toast.error('Export failed', e instanceof ApiClientError ? e.message : 'Try again');
  }
}

type ProductField = 'product' | 'quantity' | 'revenue' | 'margin' | 'pct';
const productValue = (p: SalesSummary['byProduct'][number], f: ProductField) =>
  f === 'product' ? p.product : f === 'quantity' ? p.quantity : f === 'revenue' ? n(p.revenue) : f === 'margin' ? n(p.margin) : n(p.revenue) ? n(p.margin) / n(p.revenue) : 0;

function SalesTab({ canExport }: { canExport: boolean }) {
  const presets = useMemo(() => datePresets(), []);
  const [range, setRange] = useState<DateRange>(presets.find((p) => p.id === '30d')!.range);
  const valid = !range.from || !range.to || range.from <= range.to;
  const rq = `from=${range.from}&to=${range.to}`;
  const sales = useQuery({ queryKey: ['report-sales', rq], queryFn: () => api<SalesSummary>(`/reports/sales-summary?${rq}`), enabled: valid, placeholderData: (prev) => prev });
  const s = sales.data;
  const table = useTable<SalesSummary['byProduct'][number], ProductField>(s?.byProduct ?? [], { field: 'revenue', direction: 'desc' }, productValue, 15);
  const marginPct = s && n(s.totals.netSales) ? (n(s.totals.grossMargin) / n(s.totals.netSales)) * 100 : 0;
  const csv = (report: string) => (canExport ? <Button variant="secondary" className="text-xs" onClick={() => void exportCsv(`/reports/export/${report}?${rq}`, `${report}-${range.from}-${range.to}.csv`)}><Icon name="download" size={14} /> CSV</Button> : null);

  return (
    <>
      <Card>
        <DateRangePicker value={range} onChange={setRange} />
      </Card>
      {sales.isLoading ? (
        <SkeletonRows rows={5} cols={4} />
      ) : sales.error || !s ? (
        <ErrorState message="Failed to load sales report." retry={() => void sales.refetch()} />
      ) : (
        <div className={cn('space-y-4 transition-opacity', sales.isFetching && 'opacity-60')}>
          <KpiGrid bare cols={4}>
            <Stat label="Billed (incl. GST)" value={money(s.totals.revenue)} hint={`${s.totals.invoices} invoices · avg ${money(s.totals.averageBill)}`} />
            <Stat label="Returns" value={money(s.totals.returnsValue)} hint={`${s.totals.returns} credit notes · net billed ${money(s.totals.netRevenue)}`} tone={n(s.totals.returnsValue) > 0 ? 'amber' : 'neutral'} />
            <Stat label="Net sales" value={money(s.totals.netSales)} hint={`before GST, after returns · GST ${money(s.totals.tax)}`} />
            <Stat label="Gross margin" value={money(s.totals.grossMargin)} hint={`${marginPct.toFixed(1)}% · cost of goods ${money(s.totals.costOfGoods)}`} />
          </KpiGrid>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Daily sales" className="lg:col-span-2" actions={csv('sales-by-day')}>
              <BarChart
                data={s.byDay.map((d) => ({ label: d.date.slice(5).split('-').reverse().join('/'), value: n(d.revenue), hint: `${fmtDate(d.date)} · ${d.invoices} bill${d.invoices === 1 ? '' : 's'}` }))}
                format={compactInr}
                detailFormat={(v) => money(v)}
                height={200}
                emptyLabel="No sales in this range."
              />
            </Card>
            <Card title="Tender mix">
              <Donut data={s.byPayment.map((p) => ({ label: METHOD_LABEL[p.method] ?? p.method, value: n(p.amount) }))} format={(v) => money(v)} centerLabel="Collected" />
              <p className="pt-2 text-2xs text-muted">Credit sales collected later appear as receipts, not here.</p>
            </Card>
          </div>
          <Card title={`Products sold (${s.byProduct.length})`} actions={csv('sales-by-product')}>
            {s.byProduct.length === 0 ? (
              <EmptyState title="No products sold in this range" />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <SortableTh label="Product" field="product" sort={table.sort} onSort={table.onSort} />
                      <SortableTh label="Qty" field="quantity" sort={table.sort} onSort={table.onSort} right />
                      <SortableTh label="Revenue" field="revenue" sort={table.sort} onSort={table.onSort} right />
                      <SortableTh label="Margin" field="margin" sort={table.sort} onSort={table.onSort} right />
                      <SortableTh label="Margin %" field="pct" sort={table.sort} onSort={table.onSort} right />
                    </tr>
                  }
                >
                  {table.rows.map((p) => (
                    <Tr key={p.productId}>
                      <Td className="text-sm font-medium"><Link href={`/products?focus=${p.productId}`} className="hover:text-teal-ink hover:underline">{p.product}</Link></Td>
                      <Td right>{qtyFmt(p.quantity)}</Td>
                      <Td right>{money(p.revenue)}</Td>
                      <Td right className={n(p.margin) >= 0 ? 'text-success' : 'text-danger'}>{money(p.margin)}</Td>
                      <Td right className="text-xs text-muted">{n(p.revenue) ? `${((n(p.margin) / n(p.revenue)) * 100).toFixed(1)}%` : '—'}</Td>
                    </Tr>
                  ))}
                </Table>
                <Pagination info={table.info} onChange={table.setPage} label="products" />
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

type ValField = 'product' | 'expiryDate' | 'quantity' | 'value';
const valValue = (r: ValuationRow, f: ValField) => (f === 'product' ? r.product : f === 'expiryDate' ? r.expiryDate : f === 'quantity' ? r.quantity : n(r.value));

function ValuationTab({ canExport }: { canExport: boolean }) {
  const valuation = useQuery({ queryKey: ['report-valuation'], queryFn: () => api<Valuation>('/reports/stock-valuation') });
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => (valuation.data?.rows ?? []).filter((r) => !q || r.product.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || r.batchNumber.toLowerCase().includes(q)), [valuation.data, q]);
  const table = useTable<ValuationRow, ValField>(rows, { field: 'value', direction: 'desc' }, valValue, 25);
  if (valuation.isLoading) return <SkeletonRows rows={6} cols={6} />;
  if (valuation.error || !valuation.data) return <ErrorState message="Failed to load stock valuation." retry={() => void valuation.refetch()} />;
  const v = valuation.data;
  return (
    <>
      <KpiGrid bare cols={4}>
        <Stat label="Stock at cost" value={money(v.totalValue)} />
        <Stat label="Stock at MRP" value={money(v.totalMrp)} hint={n(v.totalValue) ? `${(((n(v.totalMrp) - n(v.totalValue)) / n(v.totalValue)) * 100).toFixed(0)}% potential mark-up` : undefined} />
        <Stat variant="alert" hue="red" icon="expiry" label="Expired / blocked" value={money(n(v.expiredValue) + n(v.blockedValue))} hint={`expired ${money(v.expiredValue)}`} tone={n(v.expiredValue) + n(v.blockedValue) > 0 ? 'red' : 'neutral'} />
        <Stat label="Inventory in books" value={money(v.bookValue)} hint={n(v.unbookedDifference) ? `${money(v.unbookedDifference)} received but not yet billed` : 'matches physical stock'} />
      </KpiGrid>
      <Card
        title={`Batches on hand (${rows.length})`}
        actions={
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={(x) => { setSearch(x); table.setPage(1); }} placeholder="Product, SKU or batch" className="w-full sm:w-56" />
            {canExport ? <Button variant="secondary" className="text-xs" onClick={() => void exportCsv('/reports/export/stock-valuation', 'stock-valuation.csv')}><Icon name="download" size={14} /> CSV</Button> : null}
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={q ? 'Nothing matches this search' : 'No stock on hand'} />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <SortableTh label="Product" field="product" sort={table.sort} onSort={table.onSort} />
                  <Th>Batch</Th>
                  <SortableTh label="Expiry" field="expiryDate" sort={table.sort} onSort={table.onSort} />
                  <Th>Status</Th>
                  <SortableTh label="Qty" field="quantity" sort={table.sort} onSort={table.onSort} right />
                  <Th right>Cost</Th>
                  <Th right>MRP</Th>
                  <SortableTh label="Value" field="value" sort={table.sort} onSort={table.onSort} right />
                </tr>
              }
            >
              {table.rows.map((r) => (
                <Tr key={r.batchId}>
                  <Td className="text-sm">
                    {r.product}
                    <span className="block font-mono text-[10px] text-faint">{r.sku}</span>
                  </Td>
                  <Td className="font-mono text-xs"><Link href={`/batches?focus=${r.batchId}`} className="hover:text-teal-ink hover:underline">{r.batchNumber}</Link></Td>
                  <Td className="text-xs">{fmtDate(r.expiryDate)}</Td>
                  <Td><StatusBadge status={r.status} label={BATCH_STATUS_LABEL[r.status]} tone={BATCH_STATUS_TONE[r.status]} /></Td>
                  <Td right>{qtyFmt(r.quantity)}</Td>
                  <Td right className="text-xs">{money(r.purchaseRate, false)}</Td>
                  <Td right className="text-xs">{money(r.mrp, false)}</Td>
                  <Td right className="font-medium">{money(r.value)}</Td>
                </Tr>
              ))}
            </Table>
            <Pagination info={table.info} onChange={table.setPage} label="batches" />
          </>
        )}
      </Card>
    </>
  );
}

type DeadField = 'name' | 'onHand' | 'value' | 'daysSinceSale' | 'coverDays';
const deadValue = (r: DeadRow, f: DeadField) => (f === 'name' ? r.name : f === 'onHand' ? r.onHand : f === 'value' ? n(r.value) : f === 'daysSinceSale' ? r.daysSinceSale : r.coverDays);

function DeadStockTab({ canExport }: { canExport: boolean }) {
  const warehouses = useWarehouses();
  const [days, setDays] = useState('90');
  const [warehouseId, setWarehouseId] = useState('');
  const [cls, setCls] = useState<'' | 'DEAD' | 'SLOW'>('');
  const dead = useQuery({
    queryKey: ['dead-stock', days, warehouseId],
    queryFn: () => api<DeadStock>(`/reports/dead-stock?days=${days}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const rows = useMemo(() => (dead.data?.items ?? []).filter((r) => !cls || r.classification === cls), [dead.data, cls]);
  const table = useTable<DeadRow, DeadField>(rows, { field: 'value', direction: 'desc' }, deadValue, 20);
  const d = dead.data;
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            No sale in
            <FilterChips options={[{ id: '60', label: '60 days' }, { id: '90', label: '90 days' }, { id: '180', label: '180 days' }, { id: '365', label: '1 year' }]} value={days} onChange={(v) => setDays(v || '90')} allLabel={null} />
          </div>
          <div className="flex items-center gap-2">
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-full sm:w-52" aria-label="Warehouse">
              <option value="">All warehouses</option>
              {warehouses.list.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </Select>
            {canExport ? <Button variant="secondary" className="text-xs" onClick={() => void exportCsv('/reports/export/dead-stock', 'dead-stock-90d.csv')}><Icon name="download" size={14} /> CSV (90 d)</Button> : null}
          </div>
        </div>
      </Card>
      {dead.isLoading ? (
        <SkeletonRows rows={5} cols={6} />
      ) : dead.error || !d ? (
        <ErrorState message="Failed to load the dead-stock report." retry={() => void dead.refetch()} />
      ) : (
        <>
          <KpiGrid bare cols={4}>
            <Stat variant="alert" hue="red" icon="ban" label="Dead stock" value={money(d.summary.deadValue)} hint={`${d.summary.deadItems} products · no sale in ${d.days} days`} tone={d.summary.deadItems > 0 ? 'red' : 'neutral'} />
            <Stat label="Slow movers" value={money(d.summary.slowValue)} hint={`${d.summary.slowItems} products · over 6 months of cover`} tone={d.summary.slowItems > 0 ? 'amber' : 'neutral'} />
            <Stat label="Capital locked" value={money(n(d.summary.deadValue) + n(d.summary.slowValue))} hint="At purchase cost" />
            <Stat label="Suggested action" value={d.summary.deadItems ? 'Return / discount' : 'Healthy'} hint={d.summary.deadItems ? 'Ask suppliers for returns before expiry' : 'Nothing dead in this window'} tone={d.summary.deadItems ? 'amber' : 'green'} />
          </KpiGrid>
          <Card
            title={`Products (${rows.length})`}
            actions={<FilterChips options={[{ id: 'DEAD', label: 'Dead', count: d.summary.deadItems, tone: 'red' }, { id: 'SLOW', label: 'Slow', count: d.summary.slowItems, tone: 'amber' }]} value={cls} onChange={(v) => { setCls(v); table.setPage(1); }} />}
          >
            {rows.length === 0 ? (
              <EmptyState title="Nothing dead or slow" hint="Every stocked product sold recently enough. Try a shorter window." />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <SortableTh label="Product" field="name" sort={table.sort} onSort={table.onSort} />
                      <Th>Class</Th>
                      <SortableTh label="On hand" field="onHand" sort={table.sort} onSort={table.onSort} right />
                      <SortableTh label="Value" field="value" sort={table.sort} onSort={table.onSort} right />
                      <SortableTh label="Last sold" field="daysSinceSale" sort={table.sort} onSort={table.onSort} right />
                      <SortableTh label="Cover" field="coverDays" sort={table.sort} onSort={table.onSort} right />
                      <Th>Nearest expiry</Th>
                    </tr>
                  }
                >
                  {table.rows.map((r) => (
                    <Tr key={r.productId}>
                      <Td>
                        <Link href={`/products?focus=${r.productId}`} className="text-sm font-medium hover:text-teal-ink hover:underline">{r.name}</Link>
                        <span className="block font-mono text-[10px] text-faint">{r.sku}{r.rackLocation ? ` · rack ${r.rackLocation}` : ''}</span>
                      </Td>
                      <Td><Badge tone={r.classification === 'DEAD' ? 'red' : 'amber'} dot>{r.classification === 'DEAD' ? 'Dead' : 'Slow'}</Badge></Td>
                      <Td right>{qtyFmt(r.onHand)}</Td>
                      <Td right className="font-medium">{money(r.value)}</Td>
                      <Td right className="text-xs text-neutral-600">{r.daysSinceSale === null ? 'never' : `${r.daysSinceSale} d ago`}</Td>
                      <Td right className="text-xs">{r.coverDays === null ? '∞' : `${r.coverDays} d`}</Td>
                      <Td className="text-xs">{r.nearestExpiry ? fmtDate(r.nearestExpiry) : '—'}</Td>
                    </Tr>
                  ))}
                </Table>
                <Pagination info={table.info} onChange={table.setPage} label="products" />
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}

type AgingField = 'party' | 'outstanding' | 'daysOverdue';
const agingValue = (r: AgingRow, f: AgingField) => (f === 'party' ? r.party : f === 'outstanding' ? n(r.outstanding) : r.daysOverdue);

function AgingCard({ side, d, canExport }: { side: 'receivables' | 'payables'; d: AgingSide; canExport: boolean }) {
  const table = useTable<AgingRow, AgingField>(d.rows, { field: 'daysOverdue', direction: 'desc' }, agingValue, 10);
  const total = n(d.total) || 1;
  return (
    <Card
      title={side === 'receivables' ? 'Receivables · customers owe you' : 'Payables · you owe suppliers'}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={side === 'receivables' ? 'blue' : 'amber'}>{money(d.total)}</Badge>
          {canExport ? <Button variant="secondary" className="text-xs" onClick={() => void exportCsv(`/reports/export/${side}`, `${side}.csv`)}><Icon name="download" size={14} /> CSV</Button> : null}
        </div>
      }
    >
      <div className="mb-3 flex h-2 gap-px overflow-hidden rounded-full bg-neutral-100">
        {BUCKETS.map(([k], i) => (
          <div key={k} className={cn('mc-anim-grow-x h-full origin-left', ['bg-success', 'bg-amber-300', 'bg-warning', 'bg-orange-600', 'bg-danger'][i])} style={{ width: `${(n(d.buckets[k]) / total) * 100}%` }} />
        ))}
      </div>
      <div className="mb-3 grid grid-cols-5 gap-1 text-center">
        {BUCKETS.map(([k, label]) => (
          <div key={k} className="rounded-lg bg-subtle px-1 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-faint">{label}</p>
            <p className="text-xs font-semibold num">{money(d.buckets[k] ?? 0, false)}</p>
          </div>
        ))}
      </div>
      {d.rows.length === 0 ? (
        <EmptyState title="Nothing outstanding" />
      ) : (
        <>
          <Table
            head={
              <tr>
                <SortableTh label="Party" field="party" sort={table.sort} onSort={table.onSort} />
                <Th>Document</Th>
                <SortableTh label="Outstanding" field="outstanding" sort={table.sort} onSort={table.onSort} right />
                <SortableTh label="Overdue" field="daysOverdue" sort={table.sort} onSort={table.onSort} right />
              </tr>
            }
          >
            {table.rows.map((r) => (
              <Tr key={r.docId}>
                <Td className="text-sm">
                  {r.partyId ? <Link href={side === 'receivables' ? `/customers?focus=${r.partyId}` : `/vendors?focus=${r.partyId}`} className="hover:text-teal-ink hover:underline">{r.party}</Link> : r.party}
                </Td>
                <Td className="font-mono text-xs">
                  <Link className="text-teal-ink hover:underline" href={side === 'receivables' ? `/sales-history/${r.docId}` : `/purchasing?tab=invoices&focus=${r.docId}`}>{r.doc}</Link>
                </Td>
                <Td right className="font-medium">{money(r.outstanding)}</Td>
                <Td right><Badge tone={r.daysOverdue > 60 ? 'red' : r.daysOverdue > 0 ? 'amber' : 'green'}>{r.daysOverdue ? `${r.daysOverdue}d` : 'current'}</Badge></Td>
              </Tr>
            ))}
          </Table>
          <Pagination info={table.info} onChange={table.setPage} label="documents" />
        </>
      )}
    </Card>
  );
}

function AgingTab({ canExport }: { canExport: boolean }) {
  const aging = useQuery({ queryKey: ['report-aging'], queryFn: () => api<{ receivables: AgingSide; payables: AgingSide }>('/reports/aging') });
  if (aging.isLoading) return <SkeletonRows rows={6} cols={4} />;
  if (aging.error || !aging.data) return <ErrorState message="Failed to load aging." retry={() => void aging.refetch()} />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <AgingCard side="receivables" d={aging.data.receivables} canExport={canExport} />
      <AgingCard side="payables" d={aging.data.payables} canExport={canExport} />
    </div>
  );
}

export default function ReportsPage() {
  const can = useCan();
  const canExport = can('reports.export');
  const [tab, setTab] = useState<Tab>('sales');
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="Server-side aggregates over posted documents. Every export is audited; alerts live in the bell at the top." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'sales', label: 'Sales' },
          { id: 'valuation', label: 'Stock valuation' },
          { id: 'dead', label: 'Dead & slow stock' },
          { id: 'aging', label: 'Receivables & payables' },
        ]}
      />
      {tab === 'sales' ? <SalesTab canExport={canExport} /> : null}
      {tab === 'valuation' ? <ValuationTab canExport={canExport} /> : null}
      {tab === 'dead' ? <DeadStockTab canExport={canExport} /> : null}
      {tab === 'aging' ? <AgingTab canExport={canExport} /> : null}
    </div>
  );
}
