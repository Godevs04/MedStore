'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  Drawer,
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
} from '@/components/ui';

interface VendorRow {
  id: string;
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  city: string | null;
  stateCode: string | null;
  pinCode: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  creditDays: number;
  creditLimit: string;
  openingBalance: string;
  status: string;
}

interface Ledger {
  rows: Array<{ date: string; type: string; doc: string; credit: string; debit: string; balance: string }>;
  outstanding: string;
  openInvoices: Array<{ id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; total: string; paid: string; outstanding: string; daysOverdue: number }>;
}

const FIELDS = ['legalName', 'tradeName', 'gstin', 'pan', 'contactName', 'phone', 'email', 'addressLine1', 'city', 'stateCode', 'pinCode', 'creditDays', 'creditLimit', 'openingBalance', 'status'] as const;
type FormState = Record<(typeof FIELDS)[number], string>;
const EMPTY: FormState = {
  legalName: '',
  tradeName: '',
  gstin: '',
  pan: '',
  contactName: '',
  phone: '',
  email: '',
  addressLine1: '',
  city: '',
  stateCode: '',
  pinCode: '',
  creditDays: '30',
  creditLimit: '0.00',
  openingBalance: '0.00',
  status: 'ACTIVE',
};

function toBody(f: FormState, includeOpening: boolean) {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    legalName: f.legalName.trim(),
    tradeName: opt(f.tradeName),
    gstin: f.gstin.trim() ? f.gstin.trim().toUpperCase() : null,
    pan: f.pan.trim() ? f.pan.trim().toUpperCase() : null,
    gstRegistrationType: f.gstin.trim() ? 'REGULAR' : 'UNREGISTERED',
    contactName: opt(f.contactName),
    phone: opt(f.phone),
    email: opt(f.email),
    addressLine1: opt(f.addressLine1),
    city: opt(f.city),
    stateCode: opt(f.stateCode),
    pinCode: opt(f.pinCode),
    creditDays: Number(f.creditDays) || 0,
    creditLimit: Number(f.creditLimit || 0).toFixed(2),
    ...(includeOpening ? { openingBalance: Number(f.openingBalance || 0).toFixed(2) } : {}),
    status: f.status,
  };
}

function VendorFields({ form, setForm, isNew }: { form: FormState; setForm: (f: FormState) => void; isNew: boolean }) {
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Legal name *"><Input value={form.legalName} onChange={set('legalName')} /></Field>
      <Field label="Trade name"><Input value={form.tradeName} onChange={set('tradeName')} /></Field>
      <Field label="GSTIN"><Input value={form.gstin} onChange={set('gstin')} placeholder="27ABCDE1234F1Z5" /></Field>
      <Field label="State code (GST)"><Input value={form.stateCode} onChange={set('stateCode')} placeholder="27" /></Field>
      <Field label="PAN"><Input value={form.pan} onChange={set('pan')} /></Field>
      <Field label="Contact person"><Input value={form.contactName} onChange={set('contactName')} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
      <Field label="Email"><Input value={form.email} onChange={set('email')} /></Field>
      <Field label="Address"><Input value={form.addressLine1} onChange={set('addressLine1')} /></Field>
      <Field label="City / PIN">
        <div className="flex gap-2">
          <Input value={form.city} onChange={set('city')} />
          <Input className="w-24" value={form.pinCode} onChange={set('pinCode')} placeholder="PIN" />
        </div>
      </Field>
      <Field label="Credit days"><Input inputMode="numeric" value={form.creditDays} onChange={set('creditDays')} /></Field>
      <Field label="Credit limit (₹)"><Input inputMode="decimal" value={form.creditLimit} onChange={set('creditLimit')} /></Field>
      {isNew ? <Field label="Opening balance (₹ we owe)"><Input inputMode="decimal" value={form.openingBalance} onChange={set('openingBalance')} /></Field> : null}
      {!isNew ? (
        <Field label="Status">
          <Select value={form.status} onChange={set('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="BLOCKED">Blocked</option>
          </Select>
        </Field>
      ) : null}
    </div>
  );
}

function VendorDrawer({ vendor, onClose, onSaved }: { vendor: VendorRow; onClose: () => void; onSaved: (msg: string) => void }) {
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const canLedger = can('purchases.read');
  const [tab, setTab] = useState<'ledger' | 'open' | 'profile'>(canLedger ? 'ledger' : 'profile');
  const [form, setForm] = useState<FormState>(Object.fromEntries(FIELDS.map((k) => [k, vendor[k] === null || vendor[k] === undefined ? '' : String(vendor[k])])) as FormState);
  const ledger = useQuery({ queryKey: ['vendor-ledger', vendor.id], queryFn: () => api<Ledger>(`/purchasing/vendors/${vendor.id}/ledger`), enabled: canLedger });
  const save = useMutation({
    meta: { success: 'Vendor updated' },
    mutationFn: () => api(`/partners/vendors/${vendor.id}`, { method: 'PUT', body: toBody(form, false) }),
    onSuccess: () => onSaved(`${form.legalName} updated.`),
  });
  const overdue = (ledger.data?.openInvoices ?? []).filter((i) => i.daysOverdue > 0).reduce((s, i) => s + Number(i.outstanding), 0);

  return (
    <Drawer open onClose={onClose} width="max-w-3xl" title={vendor.legalName} subtitle={[vendor.gstin && `GSTIN ${vendor.gstin}`, vendor.phone, vendor.city].filter(Boolean).join(' · ') || 'Vendor'}>
      {canLedger ? (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Payable" value={ledger.data ? money(ledger.data.outstanding) : '…'} tone={Number(ledger.data?.outstanding ?? 0) > 0 ? 'amber' : 'green'} />
          <Stat label="Overdue" value={ledger.data ? money(overdue) : '…'} tone={overdue > 0 ? 'red' : 'green'} />
          <Stat label="Terms" value={`${vendor.creditDays} days`} hint={Number(vendor.creditLimit) > 0 ? `limit ${money(vendor.creditLimit)}` : 'no limit'} />
        </div>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(canLedger ? [{ id: 'ledger' as const, label: 'Ledger' }, { id: 'open' as const, label: 'Open invoices', count: ledger.data?.openInvoices.length }] : []),
          ...(can('vendors.manage') ? [{ id: 'profile' as const, label: 'Edit profile' }] : []),
        ]}
      />
      {tab === 'ledger' ? (
        ledger.isLoading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : ledger.error ? (
          <ErrorState message="Failed to load ledger." retry={() => void ledger.refetch()} />
        ) : (
          <Table head={<tr><Th>Date</Th><Th>Particulars</Th><Th>Doc</Th><Th right>Dr (paid)</Th><Th right>Cr (billed)</Th><Th right>Balance</Th></tr>}>
            {ledger.data?.rows.map((r, i) => (
              <Tr key={i}>
                <Td className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(r.date)}</Td>
                <Td className="text-xs">{r.type}</Td>
                <Td className="font-mono text-xs">{r.doc}</Td>
                <Td right className="text-xs">{Number(r.debit) ? money(r.debit, false) : ''}</Td>
                <Td right className="text-xs">{Number(r.credit) ? money(r.credit, false) : ''}</Td>
                <Td right className="text-xs font-semibold">{money(r.balance, false)}</Td>
              </Tr>
            ))}
          </Table>
        )
      ) : null}
      {tab === 'open' ? (
        (ledger.data?.openInvoices.length ?? 0) === 0 ? (
          <EmptyState title="Nothing outstanding" hint="All supplier invoices are settled." />
        ) : (
          <>
            <Table head={<tr><Th>Invoice</Th><Th>Due</Th><Th right>Total</Th><Th right>Paid</Th><Th right>Outstanding</Th></tr>}>
              {ledger.data?.openInvoices.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-xs font-medium">{i.invoiceNumber}</Td>
                  <Td className="text-xs">{fmtDate(i.dueDate)} {i.daysOverdue > 0 ? <Badge tone="red">{i.daysOverdue}d overdue</Badge> : <Badge tone="green">current</Badge>}</Td>
                  <Td right className="text-xs">{money(i.total)}</Td>
                  <Td right className="text-xs">{money(i.paid)}</Td>
                  <Td right className="font-medium">{money(i.outstanding)}</Td>
                </Tr>
              ))}
            </Table>
            {can('purchases.pay') ? (
              <Link href="/purchasing" className="inline-block">
                <Button>Pay from Purchasing → Payments</Button>
              </Link>
            ) : null}
          </>
        )
      ) : null}
      {tab === 'profile' ? (
        <div className="space-y-3">
          <VendorFields form={form} setForm={setForm} isNew={false} />
          {save.error ? <ErrorBanner>{save.error instanceof ApiClientError ? save.error.message : 'Failed to save'}</ErrorBanner> : null}
          <Button disabled={form.legalName.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>
      ) : null}
    </Drawer>
  );
}

export default function VendorsPage() {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const canManage = Boolean(membership && (membership.isOwner || membership.permissions.includes('vendors.manage')));
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<VendorRow | null>(null);

  const vendors = useQuery({
    queryKey: ['vendors', search],
    queryFn: () => api<{ items: VendorRow[]; pageInfo: { totalItems: number } }>(`/partners/vendors?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    retry: false,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vendors'] });
    void queryClient.invalidateQueries({ queryKey: ['vendor-options'] });
  };
  const create = useMutation({
    meta: { success: 'Vendor created' },
    mutationFn: () => api<VendorRow>('/partners/vendors', { method: 'POST', body: toBody(form, true) }),
    onSuccess: (v) => {
      setForm(EMPTY);
      setShowCreate(false);
      invalidate();
      setNotice(`Vendor ${v.legalName} created.`);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Vendors"
        subtitle="Distributors and manufacturers you buy from. Click a vendor for their ledger and open invoices."
        actions={
          <>
            <Input placeholder="Search name / GSTIN…" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
            {canManage ? <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : '+ New vendor'}</Button> : null}
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {showCreate ? (
        <Card title="New vendor">
          <VendorFields form={form} setForm={setForm} isNew />
          {create.error ? <div className="mt-3"><ErrorBanner>{create.error instanceof ApiClientError ? create.error.message : 'Failed to create vendor'}</ErrorBanner></div> : null}
          <div className="mt-3 flex gap-2">
            <Button disabled={form.legalName.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create vendor'}</Button>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <Card title={`Vendors (${vendors.data?.pageInfo.totalItems ?? 0})`}>
        {vendors.isLoading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : vendors.error ? (
          <ErrorState
            message={vendors.error instanceof ApiClientError && vendors.error.status === 403 ? 'You do not have permission to view vendors.' : 'Failed to load vendors.'}
            retry={() => void vendors.refetch()}
          />
        ) : (vendors.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No vendors yet" hint="Add the distributors you purchase from." />
        ) : (
          <Table head={<tr><Th>Vendor</Th><Th>GSTIN · State</Th><Th>Contact</Th><Th>Terms</Th><Th>Status</Th></tr>}>
            {vendors.data?.items.map((v) => (
              <Tr key={v.id} onClick={() => setOpen(v)}>
                <Td>
                  <div className="font-medium text-neutral-800">{v.legalName}</div>
                  {v.tradeName ? <div className="text-xs text-neutral-500">{v.tradeName}</div> : null}
                </Td>
                <Td className="font-mono text-xs">{v.gstin ?? 'Unregistered'}{v.stateCode ? ` · ${v.stateCode}` : ''}</Td>
                <Td className="text-sm">{[v.contactName, v.phone].filter(Boolean).join(' · ') || '—'}</Td>
                <Td className="text-sm">{v.creditDays}d{Number(v.creditLimit) > 0 ? ` · ${money(v.creditLimit)}` : ''}</Td>
                <Td><Badge tone={v.status === 'ACTIVE' ? 'green' : v.status === 'BLOCKED' ? 'red' : 'neutral'}>{v.status}</Badge></Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
      {open ? (
        <VendorDrawer
          vendor={open}
          onClose={() => setOpen(null)}
          onSaved={(msg) => {
            setOpen(null);
            setNotice(msg);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
