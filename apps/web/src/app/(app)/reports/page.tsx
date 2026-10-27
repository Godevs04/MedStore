'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Input,
  PageHeader,
  SkeletonRows,
  Stat,
  SuccessBanner,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
  fmtDate,
  money,
  todayIso,
} from '@/components/ui';

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
interface Valuation {
  rows: Array<{ batchId: string; product: string; sku: string; batchNumber: string; expiryDate: string; status: string; quantity: number; purchaseRate: string; mrp: string; value: string }>;
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

type Tab = 'sales' | 'valuation' | 'aging';
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const BUCKETS: Array<[string, string]> = [
  ['CURRENT', 'Current'],
  ['D1_30', '1–30 d'],
  ['D31_60', '31–60 d'],
  ['D61_90', '61–90 d'],
  ['D90_PLUS', '90+ d'],
];
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const canExport = Boolean(membership && (membership.isOwner || membership.permissions.includes('reports.export')));
  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const sales = useQuery({ queryKey: ['report-sales', from, to], queryFn: () => api<SalesSummary>(`/reports/sales-summary?from=${from}&to=${to}`), retry: false });
  const valuation = useQuery({ queryKey: ['report-valuation'], queryFn: () => api<Valuation>('/reports/stock-valuation'), enabled: tab === 'valuation', retry: false });
  const aging = useQuery({ queryKey: ['report-aging'], queryFn: () => api<{ receivables: AgingSide; payables: AgingSide }>('/reports/aging'), enabled: tab === 'aging', retry: false });
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Array<{ id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string }> }>('/reports/notifications?page=1&pageSize=30'),
    retry: false,
  });

  const generate = useMutation({
    meta: { silent: true },
    mutationFn: () => api<{ generated: number; scanned: number }>('/reports/notifications/generate', { method: 'POST' }),
    onSuccess: (r) => {
      setNotice(r.generated ? `${r.generated} new alert${r.generated === 1 ? '' : 's'} raised.` : 'Scan complete — nothing new to flag.');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to generate'),
  });
  const markRead = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api(`/reports/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  async function exportCsv(report: string, withRange = false) {
    setExporting(report);
    setError(null);
    try {
      await downloadCsv(`/reports/export/${report}${withRange ? `?from=${from}&to=${to}` : ''}`, `${report}.csv`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }
  const csvButton = (report: string, withRange = false) =>
    canExport ? (
      <Button variant="secondary" className="text-xs" disabled={exporting === report} onClick={() => void exportCsv(report, withRange)}>
        {exporting === report ? 'Exporting…' : '⤓ CSV'}
      </Button>
    ) : null;

  const s = sales.data;
  const maxDay = Math.max(1, ...(s?.byDay.map((d) => n(d.revenue)) ?? [1]));
  const marginPct = s && n(s.totals.netSales) ? (n(s.totals.grossMargin) / n(s.totals.netSales)) * 100 : 0;
  const unread = notifications.data?.items.filter((x) => !x.readAt).length ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Reports & alerts" subtitle="Server-side aggregates over posted documents. Every export is audited." />
      <Tabs
        value={tab}
        onChange={(t) => { setTab(t); setError(null); }}
        tabs={[
          { id: 'sales', label: 'Sales' },
          { id: 'valuation', label: 'Stock valuation' },
          { id: 'aging', label: 'Receivables & payables' },
        ]}
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {tab === 'sales' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="w-36" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span className="text-xs text-neutral-400">to</span>
            <Input type="date" className="w-36" value={to} max={todayIso()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            <Button variant="ghost" className="text-xs" onClick={() => { setFrom(todayIso()); setTo(todayIso()); }}>Today</Button>
            <Button variant="ghost" className="text-xs" onClick={() => { setFrom(daysAgo(6)); setTo(todayIso()); }}>7 days</Button>
            <Button variant="ghost" className="text-xs" onClick={() => { setFrom(daysAgo(29)); setTo(todayIso()); }}>30 days</Button>
          </div>
          {sales.isLoading ? (
            <SkeletonRows rows={5} cols={4} />
          ) : sales.error || !s ? (
            <ErrorState message="Failed to load sales report." retry={() => void sales.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Billed (incl. GST)" value={money(s.totals.revenue)} hint={`${s.totals.invoices} invoices · avg ${money(s.totals.averageBill)}`} tone="blue" />
                <Stat label="Returns" value={money(s.totals.returnsValue)} hint={`${s.totals.returns} credit notes · net billed ${money(s.totals.netRevenue)}`} tone="amber" delay={60} />
                <Stat label="Net sales" value={money(s.totals.netSales)} hint={`before GST, after returns · GST ${money(s.totals.tax)}`} delay={120} />
                <Stat label="Gross margin" value={money(s.totals.grossMargin)} hint={`${marginPct.toFixed(1)}% · cost of goods ${money(s.totals.costOfGoods)}`} tone="green" delay={180} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card title="Daily sales" className="lg:col-span-2" actions={csvButton('sales-by-day', true)}>
                  {s.byDay.length === 0 ? (
                    <EmptyState title="No sales in this range" />
                  ) : (
                    <>
                    <div className="flex h-48 items-end justify-center gap-1.5 border-b border-neutral-200">
                      {s.byDay.map((d) => (
                        <div key={d.date} className="group relative flex max-w-14 flex-1 flex-col items-center justify-end" title={`${fmtDate(d.date)} · ${money(d.revenue)} · ${d.invoices} bills`}>
                          {s.byDay.length <= 14 ? <span className="mb-1 text-[10px] tabular-nums text-neutral-500">{money(d.revenue)}</span> : null}
                          <div className="w-full rounded-t-md bg-brand-500/80 transition-all group-hover:bg-brand-600" style={{ height: `${Math.max(4, (n(d.revenue) / maxDay) * 130)}px` }} />
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex justify-center gap-1.5">
                      {s.byDay.map((d, i) => (
                        <span key={d.date} className="max-w-14 flex-1 truncate text-center text-[10px] text-neutral-400">
                          {s.byDay.length <= 14 || i % Math.ceil(s.byDay.length / 10) === 0 ? d.date.slice(5).split('-').reverse().join('/') : ''}
                        </span>
                      ))}
                    </div>
                    </>
                  )}
                </Card>
                <Card title="Tender mix">
                  {s.byPayment.length === 0 ? (
                    <p className="text-sm text-neutral-500">No tenders.</p>
                  ) : (
                    <div className="space-y-2">
                      {s.byPayment.map((p) => {
                        const total = s.byPayment.reduce((a, b) => a + n(b.amount), 0) || 1;
                        return (
                          <div key={p.method}>
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{p.method}</span>
                              <span className="tabular-nums">{money(p.amount)}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(n(p.amount) / total) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      <p className="pt-1 text-[11px] text-neutral-400">Credit sales collected later appear as receipts, not here.</p>
                    </div>
                  )}
                </Card>
              </div>
              <Card title="Top products (taxable value)" actions={csvButton('sales-by-product', true)}>
                {s.byProduct.length === 0 ? (
                  <EmptyState title="No products sold in this range" />
                ) : (
                  <Table head={<tr><Th>Product</Th><Th right>Qty</Th><Th right>Revenue</Th><Th right>Margin</Th><Th right>Margin %</Th></tr>}>
                    {s.byProduct.map((p) => (
                      <Tr key={p.productId}>
                        <Td className="text-sm font-medium">{p.product}</Td>
                        <Td right>{p.quantity}</Td>
                        <Td right>{money(p.revenue)}</Td>
                        <Td right className={n(p.margin) >= 0 ? 'text-emerald-700' : 'text-red-700'}>{money(p.margin)}</Td>
                        <Td right className="text-xs text-neutral-500">{n(p.revenue) ? `${((n(p.margin) / n(p.revenue)) * 100).toFixed(1)}%` : '—'}</Td>
                      </Tr>
                    ))}
                  </Table>
                )}
              </Card>
            </>
          )}
        </>
      ) : null}

      {tab === 'valuation' ? (
        valuation.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : valuation.error || !valuation.data ? (
          <ErrorState message="Failed to load stock valuation." retry={() => void valuation.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Stock at cost" value={money(valuation.data.totalValue)} tone="blue" />
              <Stat label="Stock at MRP" value={money(valuation.data.totalMrp)} hint={n(valuation.data.totalValue) ? `${(((n(valuation.data.totalMrp) - n(valuation.data.totalValue)) / n(valuation.data.totalValue)) * 100).toFixed(0)}% potential mark-up` : undefined} delay={60} />
              <Stat label="Expired / blocked" value={money(n(valuation.data.expiredValue) + n(valuation.data.blockedValue))} hint={`expired ${money(valuation.data.expiredValue)}`} tone="red" delay={120} />
              <Stat label="Inventory in books" value={money(valuation.data.bookValue)} hint={n(valuation.data.unbookedDifference) ? `${money(valuation.data.unbookedDifference)} received but not yet billed` : 'matches physical stock'} tone="green" delay={180} />
            </div>
            <Card title={`Batches on hand (${valuation.data.rows.length})`} actions={csvButton('stock-valuation')}>
              {valuation.data.rows.length === 0 ? (
                <EmptyState title="No stock on hand" />
              ) : (
                <Table head={<tr><Th>Product</Th><Th>Batch</Th><Th>Expiry</Th><Th>Status</Th><Th right>Qty</Th><Th right>Cost</Th><Th right>MRP</Th><Th right>Value</Th></tr>}>
                  {valuation.data.rows.map((r) => (
                    <Tr key={r.batchId}>
                      <Td className="text-sm">
                        {r.product}
                        <span className="block font-mono text-[10px] text-neutral-400">{r.sku}</span>
                      </Td>
                      <Td className="font-mono text-xs">{r.batchNumber}</Td>
                      <Td className="text-xs">{fmtDate(r.expiryDate)}</Td>
                      <Td><Badge tone={r.status === 'ACTIVE' ? 'green' : r.status === 'EXPIRED' ? 'red' : 'amber'}>{r.status.toLowerCase()}</Badge></Td>
                      <Td right>{r.quantity}</Td>
                      <Td right className="text-xs">{money(r.purchaseRate, false)}</Td>
                      <Td right className="text-xs">{money(r.mrp, false)}</Td>
                      <Td right className="font-medium">{money(r.value)}</Td>
                    </Tr>
                  ))}
                </Table>
              )}
            </Card>
          </>
        )
      ) : null}

      {tab === 'aging' ? (
        aging.isLoading ? (
          <SkeletonRows rows={6} cols={4} />
        ) : aging.error || !aging.data ? (
          <ErrorState message="Failed to load aging." retry={() => void aging.refetch()} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(['receivables', 'payables'] as const).map((side) => {
              const d = aging.data[side];
              const total = n(d.total) || 1;
              return (
                <Card
                  key={side}
                  title={side === 'receivables' ? 'Receivables · customers owe you' : 'Payables · you owe suppliers'}
                  actions={
                    <div className="flex items-center gap-2">
                      <Badge tone={side === 'receivables' ? 'blue' : 'amber'}>{money(d.total)}</Badge>
                      {csvButton(side)}
                    </div>
                  }
                >
                  <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-neutral-100">
                    {BUCKETS.map(([k], i) => (
                      <div key={k} className={cn('h-full', ['bg-emerald-500', 'bg-amber-300', 'bg-amber-500', 'bg-orange-500', 'bg-red-500'][i])} style={{ width: `${(n(d.buckets[k]) / total) * 100}%` }} />
                    ))}
                  </div>
                  <div className="mb-3 grid grid-cols-5 gap-1 text-center">
                    {BUCKETS.map(([k, label]) => (
                      <div key={k} className="rounded-lg bg-neutral-50 px-1 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</p>
                        <p className="text-xs font-semibold tabular-nums">{money(d.buckets[k] ?? 0, false)}</p>
                      </div>
                    ))}
                  </div>
                  {d.rows.length === 0 ? (
                    <EmptyState title="Nothing outstanding" />
                  ) : (
                    <Table head={<tr><Th>Party</Th><Th>Document</Th><Th right>Outstanding</Th><Th right>Overdue</Th></tr>}>
                      {d.rows.map((r) => (
                        <Tr key={r.docId}>
                          <Td className="text-sm">{r.party}</Td>
                          <Td className="font-mono text-xs">
                            {side === 'receivables' ? <Link className="text-brand-700 hover:underline" href={`/sales-history/${r.docId}`}>{r.doc}</Link> : r.doc}
                          </Td>
                          <Td right className="font-medium">{money(r.outstanding)}</Td>
                          <Td right><Badge tone={r.daysOverdue > 60 ? 'red' : r.daysOverdue > 0 ? 'amber' : 'green'}>{r.daysOverdue ? `${r.daysOverdue}d` : 'current'}</Badge></Td>
                        </Tr>
                      ))}
                    </Table>
                  )}
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      <Card
        title={`Alerts${unread ? ` · ${unread} unread` : ''}`}
        actions={
          <Button variant="secondary" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Scanning…' : 'Scan now'}
          </Button>
        }
      >
        {notifications.isLoading ? (
          <SkeletonRows rows={3} cols={2} />
        ) : (notifications.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No alerts" hint="“Scan now” checks low stock, near-expiry batches and licences due for renewal." />
        ) : (
          <div className="space-y-2">
            {notifications.data?.items.map((x) => (
              <div key={x.id} className={cn('mc-anim-fade-up flex items-start justify-between gap-3 rounded-lg border px-3 py-2', x.readAt ? 'border-neutral-100 bg-white' : 'border-amber-200 bg-amber-50/60')}>
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={x.type === 'LOW_STOCK' ? 'red' : x.type.includes('LICEN') ? 'blue' : 'amber'} dot={!x.readAt}>{x.type.replaceAll('_', ' ').toLowerCase()}</Badge>
                    <span className="text-sm font-medium text-neutral-800">{x.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">{x.body}</p>
                </div>
                {x.readAt ? <span className="text-xs text-neutral-400">read</span> : <Button variant="ghost" className="text-xs" onClick={() => markRead.mutate(x.id)}>Mark read</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
