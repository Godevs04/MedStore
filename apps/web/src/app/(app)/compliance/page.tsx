'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
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
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  SuccessBanner,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  fmtDate,
  money,
  todayIso,
} from '@/components/ui';

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
interface GstSales {
  rows: Array<Bucket & { hsnCode: string; rate: string }>;
  b2b: Bucket;
  b2c: Bucket;
  creditNotes: Bucket;
  totals: Bucket;
  net: Bucket;
}
interface GstPurchases {
  totals: Bucket;
  invoiceCount: number;
  eligible: Bucket;
  ineligibleTax: string;
  byVendor: Array<Bucket & { vendor: string; gstin: string | null; itcEligible: boolean }>;
  debitNoteTax: string;
  netItc: string;
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

const LICENCE_TYPES: Array<[string, string]> = [
  ['FORM_20', 'Form 20 — retail (non-Schedule C/C1)'],
  ['FORM_21', 'Form 21 — retail (Schedule C/C1)'],
  ['FORM_20B', 'Form 20B — wholesale'],
  ['FORM_21B', 'Form 21B — wholesale (C/C1)'],
  ['FORM_20F', 'Form 20F — Schedule X retail'],
  ['FORM_20G', 'Form 20G — Schedule X wholesale'],
  ['NARCOTIC', 'Narcotic (NDPS) licence'],
  ['FSSAI', 'FSSAI registration'],
  ['GST', 'GST registration'],
  ['TRADE', 'Trade / shop licence'],
  ['OTHER', 'Other'],
];
const BUCKET_TONE: Record<string, 'red' | 'amber' | 'green'> = { EXPIRED: 'red', DAYS_30: 'red', DAYS_60: 'amber', DAYS_90: 'amber', OK: 'green' };
const fyStart = () => {
  const t = todayIso();
  const y = Number(t.slice(0, 4));
  return Number(t.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
};
const monthStart = () => `${todayIso().slice(0, 8)}01`;
const n = (v: string | number | undefined) => Number(v ?? 0);

function DateRange({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" className="w-36" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
      <span className="text-xs text-neutral-400">to</span>
      <Input type="date" className="w-36" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To" />
      <Button variant="ghost" className="text-xs" onClick={() => { setFrom(monthStart()); setTo(todayIso()); }}>This month</Button>
      <Button variant="ghost" className="text-xs" onClick={() => { setFrom(fyStart()); setTo(todayIso()); }}>This FY</Button>
    </div>
  );
}

function H1Tab({ canExport }: { canExport: boolean }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const qs = new URLSearchParams({ page: '1', pageSize: '200' });
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (search) qs.set('search', search);
  const h1 = useQuery({ queryKey: ['h1-register', qs.toString()], queryFn: () => api<{ items: H1Row[]; pageInfo: { totalItems: number } }>(`/compliance/h1-register?${qs.toString()}`), retry: false });
  const exportCsv = async () => {
    setExportError(null);
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    try {
      await downloadCsv(`/compliance/h1-register/export?${p.toString()}`, 'h1-register.csv');
    } catch (e) {
      setExportError(e instanceof ApiClientError ? e.message : 'Export failed');
    }
  };
  return (
    <Card
      title={`Schedule H1 register · ${h1.data?.pageInfo.totalItems ?? 0} entries`}
      actions={canExport ? <Button variant="secondary" onClick={exportCsv}>⇩ Export CSV</Button> : null}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <Input className="w-56" placeholder="Patient, prescriber or drug…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {exportError ? <div className="mb-2"><ErrorBanner>{exportError}</ErrorBanner></div> : null}
      {h1.isLoading ? (
        <SkeletonRows rows={5} cols={6} />
      ) : h1.error ? (
        <ErrorState message={h1.error instanceof ApiClientError && h1.error.status === 403 ? 'Permission denied.' : 'Failed to load register.'} retry={() => void h1.refetch()} />
      ) : (h1.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="No H1 entries in this period" hint="Schedule H1 sales capture patient, prescriber, drug and quantity automatically at POS. Entries are retained for 3 years (rule 65(3)(h))." />
      ) : (
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
      )}
    </Card>
  );
}

function GstTab({ canExport }: { canExport: boolean }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [exportError, setExportError] = useState<string | null>(null);
  const qs = `from=${from}&to=${to}`;
  const sales = useQuery({ queryKey: ['gst-sales', qs], queryFn: () => api<GstSales>(`/compliance/gst/sales-summary?${qs}`), retry: false });
  const purchases = useQuery({ queryKey: ['gst-purchases', qs], queryFn: () => api<GstPurchases>(`/compliance/gst/purchase-summary?${qs}`), retry: false });
  const outputTax = n(sales.data?.net.totalTax);
  const itc = n(purchases.data?.netItc);
  const payable = outputTax - itc;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {canExport ? (
          <Button
            variant="secondary"
            onClick={async () => {
              setExportError(null);
              try {
                await downloadCsv(`/compliance/gst/sales-summary/export?${qs}`, `gst-hsn-${from}-${to}.csv`);
              } catch (e) {
                setExportError(e instanceof ApiClientError ? e.message : 'Export failed');
              }
            }}
          >
            ⇩ HSN summary CSV
          </Button>
        ) : null}
      </div>
      {exportError ? <ErrorBanner>{exportError}</ErrorBanner> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Output tax (net)" value={sales.data ? money(outputTax) : '…'} hint="after credit notes" tone="blue" />
        <Stat label="Input tax credit" value={purchases.data ? money(itc) : '…'} hint="after debit notes" tone="green" />
        <Stat label={payable >= 0 ? 'Net GST payable' : 'ITC carried forward'} value={sales.data && purchases.data ? money(Math.abs(payable)) : '…'} tone={payable > 0 ? 'amber' : 'green'} />
        <Stat label="Taxable outward (net)" value={sales.data ? money(sales.data.net.taxable) : '…'} hint={sales.data ? `${sales.data.totals.count} invoices` : undefined} />
      </div>

      <Card title="Outward supplies (GSTR-1 view)">
        {sales.isLoading ? (
          <SkeletonRows rows={4} cols={6} />
        ) : sales.error ? (
          <ErrorState message="Failed to load sales summary." retry={() => void sales.refetch()} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['B2B (customer GSTIN)', sales.data!.b2b],
                ['B2C (consumers)', sales.data!.b2c],
                ['Credit notes (returns)', sales.data!.creditNotes],
              ].map(([label, b]) => {
                const bucket = b as Bucket;
                return (
                  <div key={label as string} className="rounded-xl border border-neutral-200 px-3 py-2.5">
                    <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label as string}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{money(bucket.taxable)}</p>
                    <p className="text-xs text-neutral-500">tax {money(bucket.totalTax)} · {bucket.count} docs</p>
                  </div>
                );
              })}
            </div>
            {sales.data!.rows.length === 0 ? (
              <EmptyState title="No outward supplies in this period" />
            ) : (
              <Table head={<tr><Th>HSN</Th><Th right>Rate</Th><Th right>Taxable</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>IGST</Th><Th right>Cess</Th></tr>}>
                {sales.data!.rows.map((r) => (
                  <Tr key={`${r.hsnCode}-${r.rate}`}>
                    <Td className="font-mono text-xs">{r.hsnCode}</Td>
                    <Td right className="text-xs">{n(r.rate)}%</Td>
                    <Td right>{money(r.taxable, false)}</Td>
                    <Td right>{money(r.cgst, false)}</Td>
                    <Td right>{money(r.sgst, false)}</Td>
                    <Td right>{money(r.igst, false)}</Td>
                    <Td right>{money(r.cess, false)}</Td>
                  </Tr>
                ))}
                <Tr className="bg-neutral-50 font-semibold">
                  <Td>Gross</Td>
                  <Td />
                  <Td right>{money(sales.data!.totals.taxable, false)}</Td>
                  <Td right>{money(sales.data!.totals.cgst, false)}</Td>
                  <Td right>{money(sales.data!.totals.sgst, false)}</Td>
                  <Td right>{money(sales.data!.totals.igst, false)}</Td>
                  <Td right>{money(sales.data!.totals.cess, false)}</Td>
                </Tr>
                <Tr className="font-semibold text-brand-800">
                  <Td>Net of credit notes</Td>
                  <Td />
                  <Td right>{money(sales.data!.net.taxable, false)}</Td>
                  <Td right>{money(sales.data!.net.cgst, false)}</Td>
                  <Td right>{money(sales.data!.net.sgst, false)}</Td>
                  <Td right>{money(sales.data!.net.igst, false)}</Td>
                  <Td right>{money(sales.data!.net.cess, false)}</Td>
                </Tr>
              </Table>
            )}
          </div>
        )}
      </Card>

      <Card title="Inward supplies — input tax credit (GSTR-3B 4A view)">
        {purchases.isLoading ? (
          <SkeletonRows rows={3} cols={5} />
        ) : purchases.error ? (
          <ErrorState message="Failed to load purchase summary." retry={() => void purchases.refetch()} />
        ) : (purchases.data?.byVendor.length ?? 0) === 0 ? (
          <EmptyState title="No supplier invoices in this period" />
        ) : (
          <Table head={<tr><Th>Vendor</Th><Th>GSTIN</Th><Th right>Invoices</Th><Th right>Taxable</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>IGST</Th></tr>}>
            {purchases.data!.byVendor.map((v) => (
              <Tr key={v.vendor}>
                <Td className="text-sm">{v.vendor}</Td>
                <Td className="font-mono text-xs">
                  {v.gstin ?? (
                    <span className="font-sans">
                      Unregistered <Badge tone="amber">No ITC</Badge>
                    </span>
                  )}
                </Td>
                <Td right className="text-xs">{v.count}</Td>
                <Td right>{money(v.taxable, false)}</Td>
                <Td right>{money(v.cgst, false)}</Td>
                <Td right>{money(v.sgst, false)}</Td>
                <Td right>{money(v.igst, false)}</Td>
              </Tr>
            ))}
            <Tr className="bg-neutral-50 font-semibold">
              <Td>Eligible ITC (registered suppliers)</Td>
              <Td />
              <Td right>{purchases.data!.eligible.count}</Td>
              <Td right>{money(purchases.data!.eligible.taxable, false)}</Td>
              <Td right>{money(purchases.data!.eligible.cgst, false)}</Td>
              <Td right>{money(purchases.data!.eligible.sgst, false)}</Td>
              <Td right>{money(purchases.data!.eligible.igst, false)}</Td>
            </Tr>
            {n(purchases.data!.ineligibleTax) ? (
              <Tr>
                <Td className="text-xs text-amber-800">Not claimable: tax on invoices from unregistered suppliers</Td>
                <Td />
                <Td />
                <Td />
                <Td right className="text-xs text-amber-800">{money(purchases.data!.ineligibleTax, false)}</Td>
                <Td />
                <Td />
              </Tr>
            ) : null}
            <Tr>
              <Td className="text-xs text-neutral-500">Less: ITC reversed on debit notes</Td>
              <Td />
              <Td />
              <Td />
              <Td right className="text-xs" >−{money(purchases.data!.debitNoteTax, false)}</Td>
              <Td />
              <Td />
            </Tr>
          </Table>
        )}
        <p className="mt-3 text-xs text-neutral-500">Figures are computed from posted document snapshots (the rate applied at posting), ready for GSTR-1 / GSTR-3B preparation. Filing itself is done on the GST portal.</p>
      </Card>
    </div>
  );
}

function LicencesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const blank = { licenceType: 'FORM_20', licenceNumber: '', issuingAuthority: '', issueDate: '', expiryDate: '', branchId: '' };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const licences = useQuery({ queryKey: ['licences'], queryFn: () => api<Licence[]>('/compliance/licences'), retry: false });
  const branches = useQuery({ queryKey: ['branches-min'], queryFn: () => api<Array<{ id: string; name: string }>>('/organizations/branches') });
  const save = useMutation({
    meta: { success: 'Licence saved' },
    mutationFn: () =>
      api(editing ? `/compliance/licences/${editing}` : '/compliance/licences', {
        method: editing ? 'PATCH' : 'POST',
        body: {
          licenceType: form.licenceType,
          licenceNumber: form.licenceNumber.trim(),
          issuingAuthority: form.issuingAuthority.trim() || null,
          issueDate: form.issueDate || null,
          expiryDate: form.expiryDate,
          branchId: form.branchId || null,
        },
      }),
    onSuccess: () => {
      setNotice(editing ? 'Licence updated.' : 'Licence added — expiry alerts are now tracked.');
      setForm(blank);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['licences'] });
      void queryClient.invalidateQueries({ queryKey: ['licence-alerts'] });
    },
  });
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {canManage ? (
        <Card title={editing ? 'Edit licence' : 'Add licence'}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={form.licenceType} onChange={set('licenceType')}>
                {LICENCE_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Licence number *"><Input value={form.licenceNumber} onChange={set('licenceNumber')} placeholder="KA-BLR-20-123456" /></Field>
            <Field label="Issuing authority"><Input value={form.issuingAuthority} onChange={set('issuingAuthority')} placeholder="Drugs Control Dept." /></Field>
            <Field label="Issue date"><Input type="date" value={form.issueDate} max={todayIso()} onChange={set('issueDate')} /></Field>
            <Field label="Expiry date *"><Input type="date" value={form.expiryDate} onChange={set('expiryDate')} /></Field>
            <Field label="Premises (branch)">
              <Select value={form.branchId} onChange={set('branchId')}>
                <option value="">Organization-wide</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          {save.error ? <div className="mt-3"><ErrorBanner>{save.error instanceof ApiClientError ? save.error.message : 'Failed to save licence'}</ErrorBanner></div> : null}
          <div className="mt-3 flex gap-2">
            <Button disabled={form.licenceNumber.trim().length < 2 || !form.expiryDate || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : editing ? 'Save licence' : 'Add licence'}</Button>
            {editing ? <Button variant="secondary" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</Button> : null}
          </div>
        </Card>
      ) : null}
      <Card title="Licences">
        {licences.isLoading ? (
          <SkeletonRows rows={3} cols={5} />
        ) : (licences.data?.length ?? 0) === 0 ? (
          <EmptyState title="No licences tracked" hint="Add drug licences (Form 20/21), FSSAI and GST so their numbers print on invoices and expiries raise alerts." />
        ) : (
          <Table head={<tr><Th>Licence</Th><Th>Number</Th><Th>Premises</Th><Th>Valid</Th><Th>Status</Th><Th right /></tr>}>
            {licences.data?.map((l) => (
              <Tr key={l.id}>
                <Td className="text-sm font-medium">{LICENCE_TYPES.find(([v]) => v === l.licenceType)?.[1] ?? l.licenceType}</Td>
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
                        setForm({
                          licenceType: l.licenceType,
                          licenceNumber: l.licenceNumber,
                          issuingAuthority: l.issuingAuthority ?? '',
                          issueDate: l.issueDate ? l.issueDate.slice(0, 10) : '',
                          expiryDate: new Date(new Date(l.expiryDate).getTime() + 330 * 60_000).toISOString().slice(0, 10),
                          branchId: l.branchId ?? '',
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Edit
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

function IntegrationsTab() {
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api<Array<{ provider: string; status: string }>>('/compliance/integrations'), retry: false });
  return (
    <Card title="Government & messaging integrations">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          ['GST_EINVOICE', 'GST e-invoice (IRP)'],
          ['EWAY_BILL', 'E-way bill'],
          ['WHATSAPP', 'WhatsApp invoices'],
          ['SMS', 'SMS'],
          ['EMAIL_SMTP', 'Email (SMTP)'],
          ['PAYMENT_GATEWAY', 'Payment gateway'],
        ].map(([p, label]) => {
          const status = integrations.data?.find((c) => c.provider === p)?.status ?? 'NOT_CONFIGURED';
          return (
            <div key={p} className="flex items-center justify-between rounded-xl border border-neutral-200 px-3 py-2.5">
              <span className="text-sm text-neutral-700">{label}</span>
              <Badge tone={status === 'CONNECTED' ? 'green' : status === 'ERROR' ? 'red' : 'neutral'}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-neutral-500">Status is honest by construction: nothing shows connected until a provider adapter is configured and passes a live connectivity test.</p>
    </Card>
  );
}

export default function CompliancePage() {
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const [tab, setTab] = useState<'h1' | 'gst' | 'licences' | 'integrations'>('h1');
  const alerts = useQuery({ queryKey: ['licence-alerts'], queryFn: () => api<Array<{ bucket: string }>>('/compliance/licence-alerts'), retry: false });
  const urgent = (alerts.data ?? []).filter((a) => a.bucket === 'EXPIRED' || a.bucket === 'DAYS_30').length;
  const upcoming = (alerts.data ?? []).filter((a) => a.bucket === 'DAYS_60').length;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Compliance" subtitle="Statutory registers, GST return preparation and licence tracking — built from posted documents." />
      {urgent ? <ErrorBanner>{urgent} licence{urgent === 1 ? '' : 's'} expired or expiring within 30 days — renew to keep trading legally.</ErrorBanner> : null}
      {upcoming ? (
        <div className="mc-anim-fade-up rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {upcoming} licence{upcoming === 1 ? '' : 's'} expiring within 60 days — start the renewal application now.
        </div>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'h1', label: 'Schedule H1 register' },
          { id: 'gst', label: 'GST returns' },
          { id: 'licences', label: 'Licences', count: alerts.data?.length },
          { id: 'integrations', label: 'Integrations' },
        ]}
      />
      {tab === 'h1' ? <H1Tab canExport={can('reports.export')} /> : null}
      {tab === 'gst' ? <GstTab canExport={can('reports.export')} /> : null}
      {tab === 'licences' ? <LicencesTab canManage={can('compliance.manage')} /> : null}
      {tab === 'integrations' ? <IntegrationsTab /> : null}
    </div>
  );
}
