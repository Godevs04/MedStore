'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { LICENCE_LABELS, LICENCE_TYPES, licenceNumberIssue, licenceUpsertSchema, periodBounds } from '@medicore/validation';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { DateRangePicker, KpiGrid, Pagination, SearchInput, useDebouncedValue, useFieldErrors, type DateRange, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Th, Tr, cn, fmtDate, money, todayIso } from '@/components/ui';

interface H1Row {
  id: string;
  patientName: string;
  prescriberName: string;
  prescriberAddress: string;
  drugName: string;
  quantity: string;
  dispensedAt: string;
  invoice: { id: string; invoiceNumber: string };
}
type Bucket = { taxable: string; cgst: string; sgst: string; igst: string; cess: string; totalTax: string; count: number };
interface GstPurchases {
  totals: Bucket;
  invoiceCount: number;
  eligible: Bucket;
  ineligibleTax: string;
  byVendor: Array<Bucket & { vendor: string; gstin: string | null; itcEligible: boolean }>;
  debitNoteTax: string;
  netItc: string;
}
type ItmDet = { rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number };
interface Gstr1 {
  gstin: string;
  fp: string;
  b2b: Array<{ ctin: string; inv: Array<{ inum: string; idt: string; val: number; pos: string; itms: Array<{ itm_det: ItmDet }> }> }>;
  b2cl: Array<{ pos: string; inv: Array<{ inum: string; val: number }> }>;
  b2cs: Array<{ sply_ty: string; pos: string; rt: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }>;
  cdnr: Array<{ ctin: string; nt: Array<{ nt_num: string; nt_dt: string; val: number }> }>;
  hsn: { data: Array<{ num: number; hsn_sc: string; rt: number; qty: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }> };
  summary: { invoices: number; cancelled: number; b2b: number; b2cl: number; b2cs: number; creditNotes: number; taxable: string; igst: string; cgst: string; sgst: string; cess: string };
}
type Heads = { txval?: string; iamt: string; camt: string; samt: string; csamt?: string };
interface Gstr3b {
  period: string;
  outward: Heads;
  zeroRatedNil: string;
  interStateB2C: Array<{ pos: string; txval: string; iamt: string }>;
  itc: { available: Heads; reversed: { iamt: string; camt: string; samt: string }; ineligible: string; net: { igst: string; cgst: string; sgst: string; cess: string } };
  payable: { igst: string; cgst: string; sgst: string; cess: string; total: string };
  carryForward: { igst: string; cgst: string; sgst: string; cess: string };
}
interface Licence {
  id: string;
  licenceType: string;
  licenceNumber: string;
  issuingAuthority: string | null;
  issueDate: string | null;
  expiryDate: string;
  branchId: string | null;
  branch: { name: string } | null;
  daysToExpiry: number;
  bucket: string;
}

const BUCKET_TONE: Record<string, 'red' | 'amber' | 'green'> = { EXPIRED: 'red', DAYS_30: 'red', DAYS_60: 'amber', DAYS_90: 'amber', OK: 'green' };
const n = (v: string | number | undefined) => Number(v ?? 0);
const errorText = (e: unknown, fb: string) => (e instanceof ApiClientError ? e.message : fb);
const istDate = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const LICENCE_HINT: Record<string, string> = {
  FSSAI: '14 digits, e.g. 11521999000123',
  GST: '15-character GSTIN, e.g. 27AAPFU0939F1ZV',
  FORM_20: 'As printed on the licence, e.g. MH-PZ-123456 or 20/MH/2024/1234',
  FORM_21: 'As printed on the licence, e.g. MH-PZ-123457',
};

function periodOptions() {
  const out: Array<{ value: string; label: string }> = [];
  const d = new Date(`${todayIso().slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < 15; i += 1) {
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

/** Monthly-filer due dates: GSTR-1 on the 11th and GSTR-3B on the 20th of the next month. */
function dueDates(period: string) {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1));
  const iso = (day: number) => `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { gstr1: iso(11), gstr3b: iso(20) };
}

function saveJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportCsv(path: string, name: string) {
  try {
    await downloadCsv(path, name);
    toast.success('Export ready', name);
  } catch (e) {
    toast.error('Export failed', errorText(e, 'Try again'));
  }
}

function H1Tab({ canExport }: { canExport: boolean }) {
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebouncedValue(search.trim(), 300);
  const valid = !range.from || !range.to || range.from <= range.to;
  const f = new URLSearchParams();
  if (range.from) f.set('from', range.from);
  if (range.to) f.set('to', range.to);
  const qs = new URLSearchParams(f);
  qs.set('page', String(page));
  qs.set('pageSize', '25');
  if (dq) qs.set('search', dq);
  const h1 = useQuery({
    queryKey: ['h1-register', qs.toString()],
    queryFn: () => api<{ items: H1Row[]; pageInfo: PageInfo }>(`/compliance/h1-register?${qs.toString()}`),
    enabled: valid,
    placeholderData: (prev) => prev,
  });
  return (
    <Card
      title={`Schedule H1 register · ${h1.data?.pageInfo.totalItems ?? 0} entries`}
      actions={canExport ? <Button variant="secondary" onClick={() => void exportCsv(`/compliance/h1-register/export?${f.toString()}`, 'h1-register.csv')}><Icon name="download" size={14} /> Export CSV</Button> : null}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <DateRangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Patient, prescriber or drug…" className="w-60" />
      </div>
      {h1.isLoading ? (
        <SkeletonRows rows={5} cols={6} />
      ) : h1.error ? (
        <ErrorState message={h1.error instanceof ApiClientError && h1.error.status === 403 ? 'Permission denied.' : 'Failed to load register.'} retry={() => void h1.refetch()} />
      ) : (h1.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No H1 entries in this view" hint="Schedule H1 sales capture patient, prescriber, drug and quantity automatically at POS. Entries are retained for 3 years (rule 65(3)(h))." />
      ) : (
        <>
          <Table head={<tr><Th>Date</Th><Th>Invoice</Th><Th>Patient</Th><Th>Prescriber</Th><Th>Drug</Th><Th right>Qty</Th></tr>}>
            {h1.data?.items.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(r.dispensedAt)}</Td>
                <Td><Link href={`/sales-history/${r.invoice.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.invoice.invoiceNumber}</Link></Td>
                <Td className="text-sm">{r.patientName}</Td>
                <Td className="text-sm">
                  {r.prescriberName}
                  <span className="block text-xs text-neutral-400">{r.prescriberAddress}</span>
                </Td>
                <Td className="text-sm">{r.drugName}</Td>
                <Td right>{n(r.quantity)}</Td>
              </Tr>
            ))}
          </Table>
          <Pagination info={h1.data?.pageInfo} onChange={setPage} label="entries" />
        </>
      )}
    </Card>
  );
}

function HeadsRow({ label, h, strong }: { label: string; h: { txval?: string | number; iamt: string | number; camt: string | number; samt: string | number; csamt?: string | number }; strong?: boolean }) {
  return (
    <Tr className={strong ? 'bg-neutral-50 font-semibold' : undefined}>
      <Td className="text-sm">{label}</Td>
      <Td right>{h.txval !== undefined ? money(h.txval, false) : ''}</Td>
      <Td right>{money(h.iamt, false)}</Td>
      <Td right>{money(h.camt, false)}</Td>
      <Td right>{money(h.samt, false)}</Td>
      <Td right>{money(h.csamt ?? 0, false)}</Td>
    </Tr>
  );
}

function GstTab({ canExport }: { canExport: boolean }) {
  const periods = useMemo(periodOptions, []);
  const [period, setPeriod] = useState(periods[1]!.value);
  const [view, setView] = useState<'gstr1' | 'gstr3b' | 'itc'>('gstr1');
  const { from, to } = periodBounds(period);
  const due = dueDates(period);
  const today = todayIso();
  const g1 = useQuery({ queryKey: ['gstr1', period], queryFn: () => api<Gstr1>(`/compliance/gst/gstr1/export?period=${period}`), enabled: canExport, retry: false });
  const g3 = useQuery({ queryKey: ['gstr3b', period], queryFn: () => api<Gstr3b>(`/compliance/gst/gstr3b?period=${period}`), retry: false });
  const purchases = useQuery({ queryKey: ['gst-purchases', from, to], queryFn: () => api<GstPurchases>(`/compliance/gst/purchase-summary?from=${from}&to=${to}`), enabled: view === 'itc' });
  const label = periods.find((p) => p.value === period)?.label ?? period;
  const needsGstin = [g1.error, g3.error].some((e) => e instanceof ApiClientError && e.code === 'GSTIN_REQUIRED');

  if (needsGstin) {
    return (
      <Card>
        <EmptyState title="Add your GSTIN to prepare returns" hint="GSTR-1 and GSTR-3B are built for your registration. Enter the GSTIN and state under Settings → Organisation." action={<Link href="/settings"><Button>Open settings</Button></Link>} />
      </Card>
    );
  }

  const s3 = g3.data;
  const outTax = s3 ? n(s3.outward.iamt) + n(s3.outward.camt) + n(s3.outward.samt) + n(s3.outward.csamt) : 0;
  const itc = s3 ? n(s3.itc.net.igst) + n(s3.itc.net.cgst) + n(s3.itc.net.sgst) + n(s3.itc.net.cess) : 0;
  const cf = s3 ? n(s3.carryForward.igst) + n(s3.carryForward.cgst) + n(s3.carryForward.sgst) + n(s3.carryForward.cess) : 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" aria-label="Return period">
              {periods.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
            <Badge tone={today > due.gstr1 ? 'neutral' : 'blue'}>GSTR-1 due {fmtDate(due.gstr1)}</Badge>
            <Badge tone={today > due.gstr3b ? 'neutral' : 'amber'}>GSTR-3B due {fmtDate(due.gstr3b)}</Badge>
          </div>
          {canExport ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void exportCsv(`/compliance/gst/sales-summary/export?from=${from}&to=${to}`, `gst-hsn-${period}.csv`)}><Icon name="download" size={14} /> HSN CSV</Button>
              <Button
                disabled={!g1.data}
                onClick={() => {
                  if (!g1.data) return;
                  saveJson(`GSTR1_${g1.data.gstin}_${g1.data.fp}.json`, (({ summary: _s, ...rest }) => rest)(g1.data));
                  toast.success(`GSTR-1 ${label} downloaded`, 'Import it in the GST offline tool, review and upload on the portal.');
                }}
              >
                <Icon name="download" size={14} /> GSTR-1 JSON
              </Button>
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">Due dates shown are for monthly filers; QRMP filers use IFF and quarterly GSTR-1. Filing itself happens on the GST portal.</p>
      </Card>

      <KpiGrid cols={4}>
        <Stat label="Output tax" value={s3 ? money(outTax) : '…'} hint={s3 ? `Taxable ${money(s3.outward.txval ?? 0)}` : undefined} tone="blue" />
        <Stat label="Input tax credit (net)" value={s3 ? money(itc) : '…'} hint={s3 && n(s3.itc.ineligible) ? `${money(s3.itc.ineligible)} not claimable` : 'After debit notes'} tone="green" delay={60} />
        <Stat label="Cash to pay" value={s3 ? money(s3.payable.total) : '…'} hint="After Rule 88A set-off" tone={s3 && n(s3.payable.total) > 0 ? 'amber' : 'green'} delay={120} />
        <Stat label="Credit carried forward" value={s3 ? money(cf) : '…'} delay={180} />
      </KpiGrid>

      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { id: 'gstr1', label: `GSTR-1 · ${label}` },
          { id: 'gstr3b', label: `GSTR-3B · ${label}` },
          { id: 'itc', label: 'ITC by supplier' },
        ]}
      />

      {view === 'gstr1' ? (
        !canExport ? (
          <Card><EmptyState title="Export permission needed" hint="Ask an owner for the reports.export permission to prepare GSTR-1." /></Card>
        ) : g1.isLoading ? (
          <SkeletonRows rows={5} cols={6} />
        ) : g1.error || !g1.data ? (
          <ErrorState message={errorText(g1.error, 'Failed to build GSTR-1.')} retry={() => void g1.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['B2B invoices', g1.data.summary.b2b, '4A'],
                ['B2C large', g1.data.summary.b2cl, '5A'],
                ['B2C small', g1.data.summary.b2cs, '7'],
                ['Credit notes', g1.data.summary.creditNotes, '9B'],
                ['HSN rows', g1.data.hsn.data.length, '12'],
                ['Cancelled', g1.data.summary.cancelled, '13'],
              ].map(([l, v, t], i) => (
                <div key={l as string} className="mc-anim-fade-up rounded-xl border border-neutral-200 px-3 py-2.5" style={{ animationDelay: `${i * 40}ms` }}>
                  <p className="text-[11px] uppercase tracking-wide text-neutral-500">{l} <span className="text-neutral-300">· table {t}</span></p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">{v}</p>
                </div>
              ))}
            </div>
            <Card title="B2B — registered buyers (table 4A)">
              {g1.data.b2b.length === 0 ? (
                <EmptyState title="No B2B invoices this month" />
              ) : (
                <Table head={<tr><Th>Buyer GSTIN</Th><Th>Invoice</Th><Th>Date</Th><Th>POS</Th><Th right>Value</Th><Th right>Taxable</Th><Th right>Tax</Th></tr>}>
                  {g1.data.b2b.flatMap((b) =>
                    b.inv.map((inv) => {
                      const tx = inv.itms.reduce((s, i) => s + i.itm_det.txval, 0);
                      const tax = inv.itms.reduce((s, i) => s + i.itm_det.iamt + i.itm_det.camt + i.itm_det.samt + i.itm_det.csamt, 0);
                      return (
                        <Tr key={`${b.ctin}-${inv.inum}`}>
                          <Td className="font-mono text-xs">{b.ctin}</Td>
                          <Td className="font-mono text-xs">{inv.inum}</Td>
                          <Td className="text-xs">{inv.idt}</Td>
                          <Td className="text-xs">{inv.pos}</Td>
                          <Td right>{money(inv.val, false)}</Td>
                          <Td right>{money(tx, false)}</Td>
                          <Td right>{money(tax, false)}</Td>
                        </Tr>
                      );
                    }),
                  )}
                </Table>
              )}
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="B2C small — by place of supply & rate (table 7)">
                {g1.data.b2cs.length === 0 ? (
                  <EmptyState title="No B2C sales this month" />
                ) : (
                  <Table head={<tr><Th>Supply</Th><Th>POS</Th><Th right>Rate</Th><Th right>Taxable</Th><Th right>Tax</Th></tr>}>
                    {g1.data.b2cs.map((r) => (
                      <Tr key={`${r.pos}-${r.rt}`}>
                        <Td><Badge tone={r.sply_ty === 'INTER' ? 'blue' : 'neutral'}>{r.sply_ty === 'INTER' ? 'Inter-state' : 'Intra-state'}</Badge></Td>
                        <Td className="text-xs">{r.pos}</Td>
                        <Td right className="text-xs">{r.rt}%</Td>
                        <Td right>{money(r.txval, false)}</Td>
                        <Td right>{money(r.iamt + r.camt + r.samt + r.csamt, false)}</Td>
                      </Tr>
                    ))}
                  </Table>
                )}
              </Card>
              <Card title="Credit notes to registered buyers (table 9B)">
                {g1.data.cdnr.length === 0 ? (
                  <EmptyState title="No B2B credit notes" hint={g1.data.summary.creditNotes ? 'Consumer returns are netted into the B2C figures.' : undefined} />
                ) : (
                  <Table head={<tr><Th>Buyer</Th><Th>Note</Th><Th>Date</Th><Th right>Value</Th></tr>}>
                    {g1.data.cdnr.flatMap((c) =>
                      c.nt.map((nt) => (
                        <Tr key={nt.nt_num}>
                          <Td className="font-mono text-xs">{c.ctin}</Td>
                          <Td className="font-mono text-xs">{nt.nt_num}</Td>
                          <Td className="text-xs">{nt.nt_dt}</Td>
                          <Td right>{money(nt.val, false)}</Td>
                        </Tr>
                      )),
                    )}
                  </Table>
                )}
              </Card>
            </div>
            <Card title="HSN-wise summary (table 12)">
              {g1.data.hsn.data.length === 0 ? (
                <EmptyState title="No outward supplies this month" />
              ) : (
                <Table head={<tr><Th>HSN</Th><Th right>Rate</Th><Th right>Qty</Th><Th right>Taxable</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th></tr>}>
                  {g1.data.hsn.data.map((h) => (
                    <Tr key={h.num}>
                      <Td className="font-mono text-xs">{h.hsn_sc}</Td>
                      <Td right className="text-xs">{h.rt}%</Td>
                      <Td right className="text-xs">{h.qty}</Td>
                      <Td right>{money(h.txval, false)}</Td>
                      <Td right>{money(h.iamt, false)}</Td>
                      <Td right>{money(h.camt, false)}</Td>
                      <Td right>{money(h.samt, false)}</Td>
                    </Tr>
                  ))}
                  <Tr className="bg-neutral-50 font-semibold">
                    <Td>Total</Td>
                    <Td />
                    <Td />
                    <Td right>{money(g1.data.summary.taxable, false)}</Td>
                    <Td right>{money(g1.data.summary.igst, false)}</Td>
                    <Td right>{money(g1.data.summary.cgst, false)}</Td>
                    <Td right>{money(g1.data.summary.sgst, false)}</Td>
                  </Tr>
                </Table>
              )}
            </Card>
          </>
        )
      ) : null}

      {view === 'gstr3b' ? (
        g3.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : g3.error || !s3 ? (
          <ErrorState message={errorText(g3.error, 'Failed to build GSTR-3B.')} retry={() => void g3.refetch()} />
        ) : (
          <>
            <Card title="3.1 Outward supplies & 4 Eligible ITC">
              <Table head={<tr><Th>Nature</Th><Th right>Taxable</Th><Th right>IGST</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>Cess</Th></tr>}>
                <HeadsRow label="3.1(a) Outward taxable supplies" h={s3.outward} strong />
                <HeadsRow label="3.1(c) Nil-rated / exempt" h={{ txval: s3.zeroRatedNil, iamt: 0, camt: 0, samt: 0 }} />
                <HeadsRow label="4(A)(5) All other ITC" h={s3.itc.available} />
                <HeadsRow label="4(B) ITC reversed (debit notes)" h={s3.itc.reversed} />
                <HeadsRow label="4(C) Net ITC available" h={{ iamt: s3.itc.net.igst, camt: s3.itc.net.cgst, samt: s3.itc.net.sgst, csamt: s3.itc.net.cess }} strong />
              </Table>
              {n(s3.itc.ineligible) ? <p className="mt-2 text-xs text-amber-800">4(D) Ineligible: {money(s3.itc.ineligible)} of tax on bills from unregistered suppliers (s.16 CGST Act).</p> : null}
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="3.2 Inter-state supplies to unregistered persons">
                {s3.interStateB2C.length === 0 ? (
                  <EmptyState title="None this month" />
                ) : (
                  <Table head={<tr><Th>Place of supply</Th><Th right>Taxable</Th><Th right>IGST</Th></tr>}>
                    {s3.interStateB2C.map((r) => (
                      <Tr key={r.pos}><Td className="text-xs">{r.pos}</Td><Td right>{money(r.txval, false)}</Td><Td right>{money(r.iamt, false)}</Td></Tr>
                    ))}
                  </Table>
                )}
              </Card>
              <Card title="6.1 Payment of tax (after set-off)">
                <div className="space-y-1.5 text-sm">
                  {(['igst', 'cgst', 'sgst', 'cess'] as const).map((k) => (
                    <div key={k} className="flex justify-between">
                      <span className="uppercase text-neutral-600">{k}</span>
                      <span className="tabular-nums">
                        {money(s3.payable[k])}
                        {n(s3.carryForward[k]) ? <span className="ml-2 text-xs text-emerald-700">+{money(s3.carryForward[k])} c/f</span> : null}
                      </span>
                    </div>
                  ))}
                  <div className={cn('mt-2 flex justify-between rounded-lg px-3 py-2 font-semibold', n(s3.payable.total) > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800')}>
                    <span>Cash ledger payment</span>
                    <span className="tabular-nums">{money(s3.payable.total)}</span>
                  </div>
                  <p className="text-[11px] text-neutral-500">Set-off order per Rule 88A: IGST credit first against IGST, then CGST and SGST; CGST and SGST credits never cross-utilise.</p>
                </div>
              </Card>
            </div>
          </>
        )
      ) : null}

      {view === 'itc' ? (
        <Card title="Inward supplies — ITC by supplier">
          {purchases.isLoading ? (
            <SkeletonRows rows={3} cols={5} />
          ) : purchases.error ? (
            <ErrorState message="Failed to load purchase summary." retry={() => void purchases.refetch()} />
          ) : (purchases.data?.byVendor.length ?? 0) === 0 ? (
            <EmptyState title="No supplier invoices this month" />
          ) : (
            <Table head={<tr><Th>Vendor</Th><Th>GSTIN</Th><Th right>Invoices</Th><Th right>Taxable</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>IGST</Th></tr>}>
              {purchases.data?.byVendor.map((v) => (
                <Tr key={v.vendor}>
                  <Td className="text-sm">{v.vendor}</Td>
                  <Td className="font-mono text-xs">{v.gstin ?? <span className="font-sans">Unregistered <Badge tone="amber">No ITC</Badge></span>}</Td>
                  <Td right className="text-xs">{v.count}</Td>
                  <Td right>{money(v.taxable, false)}</Td>
                  <Td right>{money(v.cgst, false)}</Td>
                  <Td right>{money(v.sgst, false)}</Td>
                  <Td right>{money(v.igst, false)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function LicencesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const blank = { licenceType: 'FORM_20', licenceNumber: '', issuingAuthority: '', issueDate: '', expiryDate: '', branchId: '' };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const { errors, clear, validate, setServerErrors, setErrors } = useFieldErrors();
  const overview = useQuery({ queryKey: ['licences'], queryFn: () => api<{ items: Licence[]; warnings: string[] }>('/compliance/licences/overview') });
  const branches = useQuery({ queryKey: ['branches-min'], queryFn: () => api<Array<{ id: string; name: string }>>('/organizations/branches') });
  const items = overview.data?.items ?? [];
  const duplicate = form.licenceNumber.trim() && items.some((l) => l.id !== editing && l.licenceType === form.licenceType && l.licenceNumber.toUpperCase() === form.licenceNumber.trim().toUpperCase());
  const liveIssue = form.licenceNumber.trim().length >= 4 ? licenceNumberIssue(form.licenceType, form.licenceNumber) : null;

  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (body: Record<string, unknown>) => api(editing ? `/compliance/licences/${editing}` : '/compliance/licences', { method: editing ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      toast.success(editing ? 'Licence updated' : 'Licence added', 'Expiry alerts at 90, 60 and 30 days are now tracked.');
      setForm(blank);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['licences'] });
      void qc.invalidateQueries({ queryKey: ['licence-alerts'] });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'LICENCE_DUPLICATE') {
        setErrors({ licenceNumber: e.message });
        toast.error('Duplicate licence', e.message);
      } else if (e instanceof ApiClientError && setServerErrors(e.details)) toast.error('Please fix the highlighted fields');
      else toast.error('Licence not saved', errorText(e, 'Try again'));
    },
  });
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => {
    setForm((s) => ({ ...s, [k]: e.target.value }));
    clear(k);
  };
  const submit = () => {
    const body = {
      licenceType: form.licenceType,
      licenceNumber: form.licenceNumber.trim(),
      issuingAuthority: form.issuingAuthority.trim() || null,
      issueDate: form.issueDate || null,
      expiryDate: form.expiryDate,
      branchId: form.branchId || null,
    };
    if (!validate(licenceUpsertSchema, body, duplicate ? { licenceNumber: 'This licence number is already on file' } : {})) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate(body);
  };

  return (
    <div className="space-y-4">
      {overview.data?.warnings.length ? (
        <div className="mc-anim-fade-up space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {overview.data.warnings.map((w) => <p key={w}><Icon name="warning" size={13} /> {w}</p>)}
        </div>
      ) : null}
      {canManage ? (
        <Card title={editing ? 'Edit licence' : 'Add licence'}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Type" required>
              <Select value={form.licenceType} onChange={set('licenceType')}>
                {LICENCE_TYPES.map((v) => (
                  <option key={v} value={v}>{LICENCE_LABELS[v]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Licence number" required error={errors.licenceNumber ?? (duplicate ? 'Already on file' : liveIssue ?? undefined)} hint={LICENCE_HINT[form.licenceType]}>
              <Input value={form.licenceNumber} onChange={set('licenceNumber')} className="uppercase" placeholder={form.licenceType === 'FSSAI' ? '11521999000123' : form.licenceType === 'GST' ? '27AAPFU0939F1ZV' : 'MH-PZ-123456'} />
            </Field>
            <Field label="Issuing authority" error={errors.issuingAuthority}>
              <Input value={form.issuingAuthority} onChange={set('issuingAuthority')} placeholder={form.licenceType === 'FSSAI' ? 'FSSAI' : 'State Drugs Control Dept.'} />
            </Field>
            <Field label="Issue date" error={errors.issueDate}>
              <Input type="date" value={form.issueDate} max={todayIso()} onChange={set('issueDate')} />
            </Field>
            <Field label="Valid until" required error={errors.expiryDate} hint="Drug licences under the 2017 amendment are perpetual subject to retention fee — use the retention due date.">
              <Input type="date" value={form.expiryDate} min={form.issueDate || undefined} onChange={set('expiryDate')} />
            </Field>
            <Field label="Premises (branch)">
              <Select value={form.branchId} onChange={set('branchId')}>
                <option value="">Organisation-wide</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : editing ? 'Save licence' : 'Add licence'}</Button>
            {editing ? <Button variant="secondary" onClick={() => { setEditing(null); setForm(blank); setErrors({}); }}>Cancel</Button> : null}
          </div>
        </Card>
      ) : null}
      <Card title={`Licences (${items.length})`}>
        {overview.isLoading ? (
          <SkeletonRows rows={3} cols={5} />
        ) : overview.error ? (
          <ErrorState message="Failed to load licences." retry={() => void overview.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title="No licences tracked" hint="Add drug licences (Form 20/21), FSSAI and GST so their numbers print on invoices and expiries raise alerts." />
        ) : (
          <Table head={<tr><Th>Licence</Th><Th>Number</Th><Th>Premises</Th><Th>Valid</Th><Th>Status</Th><Th right /></tr>}>
            {items.map((l) => (
              <Tr key={l.id}>
                <Td className="text-sm font-medium">{LICENCE_LABELS[l.licenceType as keyof typeof LICENCE_LABELS] ?? l.licenceType}</Td>
                <Td className="font-mono text-xs">{l.licenceNumber}<span className="block font-sans text-neutral-400">{l.issuingAuthority}</span></Td>
                <Td className="text-xs">{l.branch?.name ?? 'All'}</Td>
                <Td className="text-xs">{l.issueDate ? `${fmtDate(l.issueDate)} → ` : 'until '}{fmtDate(l.expiryDate)}</Td>
                <Td><Badge tone={BUCKET_TONE[l.bucket] ?? 'neutral'} dot={l.bucket !== 'OK'}>{l.daysToExpiry < 0 ? `Expired ${-l.daysToExpiry}d ago` : `${l.daysToExpiry}d left`}</Badge></Td>
                <Td right>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing(l.id);
                        setErrors({});
                        setForm({
                          licenceType: l.licenceType,
                          licenceNumber: l.licenceNumber,
                          issuingAuthority: l.issuingAuthority ?? '',
                          issueDate: l.issueDate ? istDate(l.issueDate) : '',
                          expiryDate: istDate(l.expiryDate),
                          branchId: l.branchId ?? '',
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      {l.daysToExpiry < 60 ? 'Renew' : 'Edit'}
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

const PROVIDERS: Array<{ id: string; label: string; fields: Array<{ key: string; label: string; placeholder: string; check?: (v: string) => string | null }> }> = [
  { id: 'GST_EINVOICE', label: 'GST e-invoice (IRP)', fields: [{ key: 'irpUsername', label: 'IRP API username', placeholder: 'API user created on einvoice1.gst.gov.in' }, { key: 'aatoThreshold', label: 'Aggregate turnover band', placeholder: 'e.g. above ₹5 crore' }] },
  { id: 'EWAY_BILL', label: 'E-way bill', fields: [{ key: 'ewbUsername', label: 'EWB API username', placeholder: 'From ewaybillgst.gov.in' }] },
  {
    id: 'WHATSAPP',
    label: 'WhatsApp invoices',
    fields: [{ key: 'businessPhone', label: 'Business number', placeholder: '9876543210', check: (v) => (/^[6-9]\d{9}$/.test(v) ? null : 'Enter a 10-digit Indian mobile number') }],
  },
  {
    id: 'SMS',
    label: 'SMS',
    fields: [
      { key: 'senderId', label: 'DLT sender ID (header)', placeholder: 'MEDSHP', check: (v) => (/^[A-Z]{6}$/.test(v) ? null : 'TRAI DLT headers are exactly 6 letters') },
      { key: 'dltEntityId', label: 'DLT principal entity ID', placeholder: '19-digit ID', check: (v) => (/^\d{19}$/.test(v) ? null : 'DLT entity IDs are 19 digits') },
    ],
  },
  {
    id: 'EMAIL_SMTP',
    label: 'Email (SMTP)',
    fields: [
      { key: 'host', label: 'SMTP host', placeholder: 'smtp.example.com', check: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : 'Enter a host name') },
      { key: 'port', label: 'Port', placeholder: '587', check: (v) => (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536 ? null : 'Port must be 1–65535') },
      { key: 'fromEmail', label: 'From address', placeholder: 'billing@yourpharmacy.in', check: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a valid email') },
    ],
  },
  { id: 'PAYMENT_GATEWAY', label: 'Payment gateway', fields: [{ key: 'provider', label: 'Provider', placeholder: 'Razorpay / PayU / Cashfree' }, { key: 'merchantId', label: 'Merchant ID', placeholder: 'Public merchant / key ID (no secrets)' }] },
];

function IntegrationsTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api<Array<{ provider: string; status: string; config: Record<string, string> | null }>>('/compliance/integrations') });
  const provider = PROVIDERS.find((p) => p.id === open);
  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: () => api('/compliance/integrations', { method: 'POST', body: { provider: open, config: values } }),
    onSuccess: () => {
      toast.success(`${provider?.label ?? 'Integration'} settings saved`, 'Status stays "not connected" until a live connectivity test passes.');
      setOpen(null);
      void qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onError: (e) => toast.error('Settings not saved', errorText(e, 'Try again')),
  });
  const submit = () => {
    if (!provider) return;
    const next: Record<string, string> = {};
    for (const f of provider.fields) {
      const v = (values[f.key] ?? '').trim();
      if (!v) next[f.key] = 'Required';
      else if (v.length > 200) next[f.key] = 'Too long';
      else if (f.check) {
        const issue = f.check(v);
        if (issue) next[f.key] = issue;
      }
    }
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate();
  };
  return (
    <Card title="Government & messaging integrations">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PROVIDERS.map((p) => {
          const row = integrations.data?.find((c) => c.provider === p.id);
          const status = row?.status ?? 'NOT_CONFIGURED';
          return (
            <button
              key={p.id}
              type="button"
              disabled={!canManage}
              onClick={() => {
                setOpen(p.id);
                setErrors({});
                setValues({ ...(row?.config ?? {}) });
              }}
              className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5 text-left transition hover:border-brand-300 hover:shadow-sm disabled:cursor-default disabled:hover:border-neutral-200 disabled:hover:shadow-none"
            >
              <span className="text-sm text-neutral-700">{p.label}</span>
              <Badge tone={status === 'CONNECTED' ? 'green' : status === 'ERROR' ? 'red' : row ? 'amber' : 'neutral'}>{row && status === 'NOT_CONNECTED' ? 'configured · not connected' : status.replace(/_/g, ' ').toLowerCase()}</Badge>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-neutral-500">Status is honest by construction: nothing shows connected until a provider adapter passes a live connectivity test. Never paste passwords or secret keys here.</p>
      <Drawer open={Boolean(provider)} onClose={() => setOpen(null)} title={provider?.label ?? ''} subtitle="Non-secret settings only" width="max-w-lg">
        {provider ? (
          <div className="space-y-3">
            {provider.fields.map((f) => (
              <Field key={f.key} label={f.label} required error={errors[f.key]}>
                <Input
                  value={values[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.key]: f.key === 'senderId' ? e.target.value.toUpperCase() : e.target.value }));
                    setErrors((er) => {
                      const nx = { ...er };
                      delete nx[f.key];
                      return nx;
                    });
                  }}
                />
              </Field>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
              <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </Card>
  );
}

export default function CompliancePage() {
  const can = useCan();
  const [tab, setTab] = useState<'h1' | 'gst' | 'licences' | 'integrations'>('gst');
  const alerts = useQuery({ queryKey: ['licence-alerts'], queryFn: () => api<Array<{ bucket: string; licenceType: string; daysToExpiry: number }>>('/compliance/licence-alerts') });
  const urgent = (alerts.data ?? []).filter((a) => a.bucket === 'EXPIRED' || a.bucket === 'DAYS_30');
  const upcoming = (alerts.data ?? []).filter((a) => a.bucket === 'DAYS_60').length;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Compliance" subtitle="GST returns, statutory registers and licence tracking — built from posted documents under the Drugs & Cosmetics Rules and CGST Act." />
      {urgent.length ? (
        <button type="button" onClick={() => setTab('licences')} className="mc-anim-fade-up block w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-left text-sm text-red-800">
          <Icon name="ban" size={14} /> {urgent.length} licence{urgent.length === 1 ? '' : 's'} expired or expiring within 30 days — selling scheduled drugs without a valid licence is an offence under s.18 of the Drugs & Cosmetics Act. <span className="font-semibold">Renew now</span> <Icon name="arrowRight" size={14} />
        </button>
      ) : upcoming ? (
        <button type="button" onClick={() => setTab('licences')} className="mc-anim-fade-up block w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left text-sm text-amber-900">
          <Icon name="expiry" size={14} /> {upcoming} licence{upcoming === 1 ? '' : 's'} expiring within 60 days — start the renewal application now <Icon name="arrowRight" size={14} />
        </button>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'gst', label: 'GST returns' },
          { id: 'h1', label: 'Schedule H1 register' },
          { id: 'licences', label: 'Licences', count: urgent.length || undefined },
          { id: 'integrations', label: 'Integrations' },
        ]}
      />
      {tab === 'h1' ? <H1Tab canExport={can('reports.export')} /> : null}
      {tab === 'gst' ? <GstTab canExport={can('reports.export')} /> : null}
      {tab === 'licences' ? <LicencesTab canManage={can('compliance.manage')} /> : null}
      {tab === 'integrations' ? <IntegrationsTab canManage={can('organization.settings.manage')} /> : null}
    </div>
  );
}
