'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { daysUntil, issuesToRecord, stateName, vendorCreateSchema, vendorIssues } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { toast } from '@/lib/toast';
import {
  ExpiryPill,
  FilterChips,
  FormSection,
  GstinInput,
  KpiGrid,
  Meter,
  MoneyInput,
  Pagination,
  QtyInput,
  SearchInput,
  StateSelect,
  useDebouncedValue,
  useFieldErrors,
  type PageInfo,
} from '@/components/kit';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
  fmtDate,
  money, Alert, StatusBadge } from '@/components/ui';

interface VendorRow {
  id: string;
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  pan: string | null;
  gstRegistrationType: string;
  addressLine1: string | null;
  addressLine2: string | null;
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
  drugLicenceNumber: string | null;
  drugLicenceExpiry: string | null;
  bankAccount: string | null;
  ifsc: string | null;
  notes: string | null;
  payable?: string;
  overdue?: string;
  openInvoices?: number;
}

interface Ledger {
  rows: Array<{ date: string; type: string; doc: string; credit: string; debit: string; balance: string }>;
  outstanding: string;
  openInvoices: Array<{ id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; total: string; paid: string; outstanding: string; daysOverdue: number }>;
}

interface SuppliedProduct {
  productId: string;
  name: string;
  sku: string;
  mrp: string | null;
  quantity: string;
  freeQty: string;
  spend: string;
  invoices: number;
  lastRate: string;
  lastPurchased: string;
}

type Status = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
type RegType = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';
type FormState = {
  legalName: string;
  tradeName: string;
  gstRegistrationType: RegType;
  gstin: string;
  pan: string;
  stateCode: string;
  contactName: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  pinCode: string;
  drugLicenceNumber: string;
  drugLicenceExpiry: string;
  bankAccount: string;
  ifsc: string;
  creditDays: string;
  creditLimit: string;
  openingBalance: string;
  status: Status;
  notes: string;
};

const EMPTY: FormState = {
  legalName: '',
  tradeName: '',
  gstRegistrationType: 'REGULAR',
  gstin: '',
  pan: '',
  stateCode: '',
  contactName: '',
  phone: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  pinCode: '',
  drugLicenceNumber: '',
  drugLicenceExpiry: '',
  bankAccount: '',
  ifsc: '',
  creditDays: '30',
  creditLimit: '',
  openingBalance: '',
  status: 'ACTIVE',
  notes: '',
};

const PAGE_SIZE = 25;
const maskAccount = (a: string) => (a.length > 4 ? `••••${a.slice(-4)}` : a);

function fromRow(v: VendorRow): FormState {
  const s = (x: string | null) => x ?? '';
  return {
    legalName: v.legalName,
    tradeName: s(v.tradeName),
    gstRegistrationType: (['REGULAR', 'COMPOSITION', 'UNREGISTERED'].includes(v.gstRegistrationType) ? v.gstRegistrationType : 'REGULAR') as RegType,
    gstin: s(v.gstin),
    pan: s(v.pan),
    stateCode: s(v.stateCode),
    contactName: s(v.contactName),
    phone: s(v.phone),
    email: s(v.email),
    addressLine1: s(v.addressLine1),
    addressLine2: s(v.addressLine2),
    city: s(v.city),
    pinCode: s(v.pinCode),
    drugLicenceNumber: s(v.drugLicenceNumber),
    drugLicenceExpiry: v.drugLicenceExpiry ? v.drugLicenceExpiry.slice(0, 10) : '',
    bankAccount: s(v.bankAccount),
    ifsc: s(v.ifsc),
    creditDays: String(v.creditDays),
    creditLimit: Number(v.creditLimit) > 0 ? Number(v.creditLimit).toFixed(2) : '',
    openingBalance: '',
    status: (v.status as Status) ?? 'ACTIVE',
    notes: s(v.notes),
  };
}

function toBody(f: FormState, isNew: boolean) {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  const up = (v: string) => (v.trim() ? v.trim().toUpperCase() : null);
  return {
    legalName: f.legalName.trim(),
    tradeName: opt(f.tradeName),
    gstRegistrationType: f.gstRegistrationType,
    gstin: f.gstRegistrationType === 'UNREGISTERED' ? null : up(f.gstin),
    pan: up(f.pan),
    stateCode: opt(f.stateCode),
    contactName: opt(f.contactName),
    phone: opt(f.phone.replace(/\s+/g, '')),
    email: opt(f.email),
    addressLine1: opt(f.addressLine1),
    addressLine2: opt(f.addressLine2),
    city: opt(f.city),
    pinCode: opt(f.pinCode),
    drugLicenceNumber: up(f.drugLicenceNumber),
    drugLicenceExpiry: opt(f.drugLicenceExpiry),
    bankAccount: opt(f.bankAccount.replace(/\s+/g, '')),
    ifsc: up(f.ifsc),
    creditDays: Number(f.creditDays || 0),
    creditLimit: Number(f.creditLimit || 0).toFixed(2),
    ...(isNew ? { openingBalance: Number(f.openingBalance || 0).toFixed(2) } : { status: f.status }),
    notes: opt(f.notes),
  };
}

function useVendorForm(initial: FormState, isNew: boolean) {
  const [form, setForm] = useState<FormState>(initial);
  const fe = useFieldErrors();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    fe.clear(k);
  };
  const onDerived = useCallback((d: { stateCode: string; pan: string }) => {
    setForm((f) => ({ ...f, stateCode: f.stateCode || d.stateCode, pan: f.pan || d.pan }));
  }, []);
  const validate = () => {
    const body = toBody(form, isNew);
    const extra = issuesToRecord(vendorIssues(body, { requireGstin: true }));
    if (body.gstin && !body.stateCode) extra.stateCode = 'Select the state of the GST registration';
    if (body.drugLicenceNumber && !body.drugLicenceExpiry) extra.drugLicenceExpiry = 'Enter the licence validity date';
    if (Number(form.creditDays || 0) > 365) extra.creditDays = 'Credit days cannot exceed 365';
    return fe.validate(vendorCreateSchema, body, extra) ? body : null;
  };
  return { form, set, fe, onDerived, validate };
}

function VendorFields({ ctl, isNew }: { ctl: ReturnType<typeof useVendorForm>; isNew: boolean }) {
  const { form, set, fe, onDerived } = ctl;
  const e = fe.errors;
  const licenceDays = form.drugLicenceExpiry ? daysUntil(form.drugLicenceExpiry) : null;
  return (
    <div className="space-y-3">
      <FormSection title="Business">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Legal name" required error={e.legalName} hint="As on the GST certificate">
            <Input value={form.legalName} maxLength={200} onChange={(ev) => set('legalName', ev.target.value)} autoFocus={isNew} />
          </Field>
          <Field label="Trade name" error={e.tradeName}>
            <Input value={form.tradeName} maxLength={200} onChange={(ev) => set('tradeName', ev.target.value)} />
          </Field>
          <Field label="Contact person" error={e.contactName}>
            <Input value={form.contactName} maxLength={120} onChange={(ev) => set('contactName', ev.target.value)} />
          </Field>
          <Field label="Mobile" error={e.phone}>
            <Input value={form.phone} inputMode="tel" maxLength={14} onChange={(ev) => set('phone', ev.target.value.replace(/[^\d+\s]/g, ''))} placeholder="98XXXXXXXX" />
          </Field>
          <Field label="Email" error={e.email} className="sm:col-span-2">
            <Input value={form.email} type="email" maxLength={160} onChange={(ev) => set('email', ev.target.value)} placeholder="orders@distributor.in" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="GST registration" hint="Input tax credit is claimable only on invoices from registered suppliers.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Registration type" error={e.gstRegistrationType}>
            <Select value={form.gstRegistrationType} onChange={(ev) => set('gstRegistrationType', ev.target.value as RegType)}>
              <option value="REGULAR">Regular</option>
              <option value="COMPOSITION">Composition (no ITC)</option>
              <option value="UNREGISTERED">Unregistered</option>
            </Select>
          </Field>
          {form.gstRegistrationType !== 'UNREGISTERED' ? (
            <Field label="GSTIN" required error={e.gstin}>
              <GstinInput value={form.gstin} onChange={(v) => set('gstin', v)} onDerived={onDerived} invalid={Boolean(e.gstin)} />
            </Field>
          ) : (
            <div />
          )}
          <Field label="PAN" error={e.pan} hint={form.gstin.length === 15 ? 'Must match characters 3–12 of the GSTIN' : undefined}>
            <Input
              value={form.pan}
              maxLength={10}
              className="font-mono uppercase tracking-wider"
              onChange={(ev) => set('pan', ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
              placeholder="ABCDE1234F"
            />
          </Field>
          <Field label="State" error={e.stateCode}>
            <StateSelect value={form.stateCode} onChange={(v) => set('stateCode', v)} invalid={Boolean(e.stateCode)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Drug licence" hint="Form 20B / 21B wholesale licence. Purchases from unlicensed suppliers are not permitted under the Drugs & Cosmetics Rules.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Licence number" error={e.drugLicenceNumber}>
            <Input
              value={form.drugLicenceNumber}
              maxLength={60}
              className="font-mono uppercase"
              onChange={(ev) => set('drugLicenceNumber', ev.target.value.toUpperCase())}
              placeholder="MH-PUN-20B-123456"
            />
          </Field>
          <Field label="Valid until" error={e.drugLicenceExpiry} hint={licenceDays !== null ? <ExpiryPill days={licenceDays} /> : undefined}>
            <Input type="date" value={form.drugLicenceExpiry} onChange={(ev) => set('drugLicenceExpiry', ev.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Address">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Address line 1" error={e.addressLine1}>
            <Input value={form.addressLine1} maxLength={200} onChange={(ev) => set('addressLine1', ev.target.value)} />
          </Field>
          <Field label="Address line 2" error={e.addressLine2}>
            <Input value={form.addressLine2} maxLength={200} onChange={(ev) => set('addressLine2', ev.target.value)} />
          </Field>
          <Field label="City" error={e.city}>
            <Input value={form.city} maxLength={100} onChange={(ev) => set('city', ev.target.value)} />
          </Field>
          <Field label="PIN code" error={e.pinCode}>
            <QtyInput value={form.pinCode} onChange={(v) => set('pinCode', v.slice(0, 6))} placeholder="411001" aria-label="PIN code" invalid={Boolean(e.pinCode)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Bank and credit" hint="Bank details are used for NEFT/RTGS payments to this supplier.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Account number" error={e.bankAccount}>
            <QtyInput value={form.bankAccount} onChange={(v) => set('bankAccount', v.slice(0, 18))} aria-label="Bank account number" invalid={Boolean(e.bankAccount)} />
          </Field>
          <Field label="IFSC" error={e.ifsc}>
            <Input
              value={form.ifsc}
              maxLength={11}
              className="font-mono uppercase tracking-wider"
              onChange={(ev) => set('ifsc', ev.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
              placeholder="HDFC0001234"
            />
          </Field>
          <Field label="Credit days" error={e.creditDays}>
            <QtyInput value={form.creditDays} onChange={(v) => set('creditDays', v.slice(0, 3))} invalid={Boolean(e.creditDays)} aria-label="Credit days" />
          </Field>
          <Field label="Credit limit" error={e.creditLimit}>
            <MoneyInput value={form.creditLimit} onChange={(v) => set('creditLimit', v)} invalid={Boolean(e.creditLimit)} aria-label="Credit limit" />
          </Field>
          {isNew ? (
            <Field label="Opening balance" error={e.openingBalance} hint="Amount you already owe this supplier">
              <MoneyInput value={form.openingBalance} onChange={(v) => set('openingBalance', v)} invalid={Boolean(e.openingBalance)} aria-label="Opening balance" />
            </Field>
          ) : (
            <Field label="Status" error={e.status}>
              <Select value={form.status} onChange={(ev) => set('status', ev.target.value as Status)}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="BLOCKED">Blocked (no new purchases)</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notes" error={e.notes}>
          <Textarea rows={2} maxLength={1000} value={form.notes} onChange={(ev) => set('notes', ev.target.value)} />
        </Field>
      </FormSection>
    </div>
  );
}

function CreateVendorDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (v: VendorRow) => void }) {
  const ctl = useVendorForm(EMPTY, true);
  const create = useMutation({
    meta: { silent: true },
    mutationFn: (body: ReturnType<typeof toBody>) => api<VendorRow>('/partners/vendors', { method: 'POST', body }),
    onSuccess: (v) => {
      toast.success(`Vendor ${v.legalName} created`, v.drugLicenceNumber ? undefined : 'Add the drug licence before the first purchase.');
      onCreated(v);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) ctl.fe.setServerErrors(err.details);
    },
  });
  return (
    <Drawer open onClose={onClose} title="New vendor" subtitle="Distributor, stockist or manufacturer you buy from" width="max-w-2xl">
      <form
        noValidate
        className="space-y-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          const body = ctl.validate();
          if (body) create.mutate(body);
          else toast.error('Please fix the highlighted fields');
        }}
      >
        <VendorFields ctl={ctl} isNew />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create vendor'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function PayPanel({ vendor, invoices, onDone }: { vendor: VendorRow; invoices: Ledger['openInvoices']; onDone: () => void }) {
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<'BANK' | 'UPI' | 'CASH'>('BANK');
  const [reference, setReference] = useState('');
  const fe = useFieldErrors();
  const total = Object.values(alloc).reduce((s, v) => s + Number(v || 0), 0);
  const pay = useMutation({
    meta: { silent: true },
    mutationFn: (body: { vendorId: string; amount: string; method: string; reference: string | null; allocations: Array<{ invoiceId: string; amount: string }> }) =>
      api<{ paymentNumber: string; amount: string }>('/purchasing/payments', { method: 'POST', body }),
    onSuccess: (p) => {
      toast.success(`Payment ${p.paymentNumber} recorded`, `${money(p.amount)} to ${vendor.legalName}`);
      setAlloc({});
      setReference('');
      onDone();
    },
  });
  const toggle = (id: string, outstanding: string) =>
    setAlloc((a) => {
      const next = { ...a };
      if (id in next) delete next[id];
      else next[id] = Number(outstanding).toFixed(2);
      return next;
    });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const errs: Record<string, string> = {};
    const entries = Object.entries(alloc).filter(([, v]) => Number(v) > 0);
    if (entries.length === 0) errs._form = 'Tick at least one invoice to pay';
    for (const [id, v] of entries) {
      const inv = invoices.find((i) => i.id === id)!;
      if (Number(v) > Number(inv.outstanding) + 0.001) errs[id] = `Max ${money(inv.outstanding)}`;
    }
    const ref = reference.trim().toUpperCase();
    if (method !== 'CASH' && !ref) errs.reference = method === 'UPI' ? 'Enter the UPI transaction ID' : 'Enter the UTR or cheque number';
    else if (ref && method === 'UPI' && !/^[A-Z0-9]{12,22}$/.test(ref)) errs.reference = 'UPI reference must be 12–22 letters or digits';
    else if (ref && method === 'BANK' && !/^([A-Z0-9]{12,22}|\d{6})$/.test(ref)) errs.reference = 'Enter a 12–22 character UTR or a 6-digit cheque number';
    fe.setErrors(errs);
    if (Object.keys(errs).length) {
      if (errs._form) toast.warning(errs._form);
      return;
    }
    pay.mutate({
      vendorId: vendor.id,
      amount: total.toFixed(2),
      method,
      reference: ref || null,
      allocations: entries.map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount).toFixed(2) })),
    });
  };
  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {invoices.map((i) => {
          const on = i.id in alloc;
          return (
            <li key={i.id} className={cn('flex flex-wrap items-center gap-3 px-3 py-2 transition-colors', on && 'bg-mint/50')}>
              <input type="checkbox" className="accent-brand-600" checked={on} onChange={() => toggle(i.id, i.outstanding)} aria-label={`Pay ${i.invoiceNumber}`} />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs font-medium">{i.invoiceNumber}</p>
                <p className="text-2xs text-muted">
                  Due {fmtDate(i.dueDate)} {i.daysOverdue > 0 ? <span className="font-medium text-danger">· {i.daysOverdue}d overdue</span> : null}
                </p>
              </div>
              <span className="text-sm num text-neutral-600">{money(i.outstanding)}</span>
              {on ? (
                <div className="w-32">
                  <MoneyInput value={alloc[i.id]!} onChange={(v) => { setAlloc((a) => ({ ...a, [i.id]: v })); fe.clear(i.id); }} invalid={Boolean(fe.errors[i.id])} aria-label={`Amount for ${i.invoiceNumber}`} />
                  {fe.errors[i.id] ? <p className="mt-0.5 text-2xs text-danger">{fe.errors[i.id]}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid via" required>
          <Select value={method} onChange={(ev) => { setMethod(ev.target.value as typeof method); fe.clear('reference'); }}>
            <option value="BANK">Bank (NEFT / RTGS / cheque)</option>
            <option value="UPI">UPI</option>
            <option value="CASH">Cash</option>
          </Select>
        </Field>
        <Field label={method === 'CASH' ? 'Reference (optional)' : method === 'UPI' ? 'UPI transaction ID' : 'UTR / cheque no.'} required={method !== 'CASH'} error={fe.errors.reference}>
          <Input value={reference} maxLength={22} className="font-mono uppercase" onChange={(ev) => { setReference(ev.target.value); fe.clear('reference'); }} />
        </Field>
      </div>
      {vendor.bankAccount && method === 'BANK' ? (
        <p className="text-xs text-muted">
          Pay to A/c {maskAccount(vendor.bankAccount)} · IFSC <span className="font-mono">{vendor.ifsc}</span>
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2.5">
        <span className="text-sm text-neutral-600">{Object.keys(alloc).length} invoice(s) selected</span>
        <Button type="submit" disabled={pay.isPending || total <= 0}>
          {pay.isPending ? 'Recording…' : `Pay ${money(total)}`}
        </Button>
      </div>
    </form>
  );
}

function VendorDrawer({ vendor, onClose, onSaved }: { vendor: VendorRow; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const canLedger = can('purchases.read');
  const [tab, setTab] = useState<'ledger' | 'open' | 'products' | 'profile'>(canLedger ? 'ledger' : 'profile');
  const ctl = useVendorForm(fromRow(vendor), false);
  const ledger = useQuery({ queryKey: ['vendor-ledger', vendor.id], queryFn: () => api<Ledger>(`/purchasing/vendors/${vendor.id}/ledger`), enabled: canLedger });
  const products = useQuery({
    queryKey: ['vendor-products', vendor.id],
    queryFn: () => api<SuppliedProduct[]>(`/partners/vendors/${vendor.id}/products?limit=25`),
    enabled: canLedger && tab === 'products',
  });
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: ReturnType<typeof toBody>) => api(`/partners/vendors/${vendor.id}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success(`${ctl.form.legalName} updated`);
      onSaved();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) ctl.fe.setServerErrors(err.details);
    },
  });
  const overdue = (ledger.data?.openInvoices ?? []).filter((i) => i.daysOverdue > 0).reduce((s, i) => s + Number(i.outstanding), 0);
  const licenceDays = vendor.drugLicenceExpiry ? daysUntil(vendor.drugLicenceExpiry.slice(0, 10)) : null;

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={vendor.legalName}
      subtitle={[vendor.gstin && `GSTIN ${vendor.gstin}`, vendor.phone, vendor.city].filter(Boolean).join(' · ') || 'Vendor'}
    >
      {!vendor.drugLicenceNumber ? (
        <Alert tone="warning">No drug licence on file. Record the supplier&apos;s Form 20B/21B licence before purchasing.</Alert>
      ) : licenceDays !== null && licenceDays < 0 ? (
        <Alert tone="danger">
          Drug licence {vendor.drugLicenceNumber} expired {Math.abs(licenceDays)} days ago. Do not purchase until it is renewed.
        </Alert>
      ) : null}
      {canLedger ? (
        <KpiGrid cols={3}>
          <Stat label="Payable" value={ledger.data ? money(ledger.data.outstanding) : '…'} tone={Number(ledger.data?.outstanding ?? 0) > 0 ? 'amber' : 'green'} />
          <Stat variant="alert" label="Overdue" value={ledger.data ? money(overdue) : '…'} tone={overdue > 0 ? 'red' : 'neutral'} />
          <Stat
            label="Terms"
            value={`${vendor.creditDays} days`}
            hint={vendor.drugLicenceNumber ? <span className="font-mono">DL {vendor.drugLicenceNumber}</span> : Number(vendor.creditLimit) > 0 ? `limit ${money(vendor.creditLimit)}` : 'no limit'}
          />
        </KpiGrid>
      ) : null}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(canLedger
            ? [
                { id: 'ledger' as const, label: 'Ledger' },
                { id: 'open' as const, label: can('purchases.pay') ? 'Open invoices · Pay' : 'Open invoices', count: ledger.data?.openInvoices.length },
                { id: 'products' as const, label: 'Supplies' },
              ]
            : []),
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
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.date)}</Td>
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
        ledger.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : (ledger.data?.openInvoices.length ?? 0) === 0 ? (
          <EmptyState title="Nothing outstanding" hint="All supplier invoices are settled." />
        ) : can('purchases.pay') ? (
          <PayPanel
            vendor={vendor}
            invoices={ledger.data!.openInvoices}
            onDone={() => {
              void queryClient.invalidateQueries({ queryKey: ['vendor-ledger', vendor.id] });
              void queryClient.invalidateQueries({ queryKey: ['vendors'] });
              void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
              setTab('ledger');
            }}
          />
        ) : (
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
        )
      ) : null}
      {tab === 'products' ? (
        products.isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : products.error ? (
          <ErrorState message="Failed to load supplied products." retry={() => void products.refetch()} />
        ) : (products.data?.length ?? 0) === 0 ? (
          <EmptyState title="No purchases yet" hint="Products appear here after the first purchase invoice from this vendor." />
        ) : (
          <Table head={<tr><Th>Product</Th><Th right>Qty (+free)</Th><Th right>Last rate</Th><Th right>Margin vs MRP</Th><Th right>Spend</Th><Th>Last bought</Th></tr>}>
            {products.data?.map((p) => {
              const margin = p.mrp && Number(p.mrp) > 0 ? ((Number(p.mrp) - Number(p.lastRate)) / Number(p.mrp)) * 100 : null;
              return (
                <Tr key={p.productId}>
                  <Td>
                    <div className="font-medium text-ink">{p.name}</div>
                    <div className="font-mono text-2xs text-muted">{p.sku}</div>
                  </Td>
                  <Td right className="text-xs">
                    {Number(p.quantity).toLocaleString('en-IN')}
                    {Number(p.freeQty) > 0 ? <span className="text-success"> +{Number(p.freeQty).toLocaleString('en-IN')}</span> : null}
                  </Td>
                  <Td right className="text-xs">{money(p.lastRate)}</Td>
                  <Td right className="w-28">
                    {margin !== null ? <Meter value={margin} tone={margin < 10 ? 'red' : margin < 20 ? 'amber' : 'green'} label={`${margin.toFixed(1)}%`} /> : <span className="text-xs text-faint">—</span>}
                  </Td>
                  <Td right className="font-medium">{money(p.spend)}</Td>
                  <Td className="text-xs text-muted">{fmtDate(p.lastPurchased)}</Td>
                </Tr>
              );
            })}
          </Table>
        )
      ) : null}
      {tab === 'profile' ? (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            const body = ctl.validate();
            if (body) save.mutate(body);
            else toast.error('Please fix the highlighted fields');
          }}
        >
          <VendorFields ctl={ctl} isNew={false} />
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      ) : null}
    </Drawer>
  );
}

function VendorsView() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const canManage = can('vendors.manage');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<Status | ''>('');
  const [stateCode, setStateCode] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<VendorRow | null>(null);
  const focusId = params.get('focus');

  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), withBalances: 'true' });
  if (debounced) qs.set('search', debounced);
  if (status) qs.set('status', status);
  if (stateCode) qs.set('stateCode', stateCode);
  const vendors = useQuery({
    queryKey: ['vendors', qs.toString()],
    queryFn: () => api<{ items: VendorRow[]; pageInfo: PageInfo }>(`/partners/vendors?${qs.toString()}`),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const aging = useQuery({
    queryKey: ['dashboard', 'aging'],
    queryFn: () => api<{ payables: { buckets: Record<string, string>; total: string } }>('/reports/aging'),
    enabled: can('reports.read'),
  });
  const focused = useQuery({
    queryKey: ['vendor', focusId],
    queryFn: () => api<VendorRow>(`/partners/vendors/${focusId}`),
    enabled: Boolean(focusId),
    retry: false,
  });
  const drawerVendor = open ?? (focusId && focused.data ? focused.data : null);
  const closeDrawer = () => {
    setOpen(null);
    if (focusId) router.replace('/vendors');
  };
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vendors'] });
    void queryClient.invalidateQueries({ queryKey: ['vendor-options'] });
  };
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const items = vendors.data?.items ?? [];
  const licenceAlerts = items.filter((v) => !v.drugLicenceNumber || (v.drugLicenceExpiry && daysUntil(v.drugLicenceExpiry.slice(0, 10)) <= 30)).length;
  const payablesOverdue = aging.data ? Number(aging.data.payables.total) - Number(aging.data.payables.buckets.CURRENT ?? 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        subtitle="Distributors and manufacturers you buy from. Click a vendor for their ledger, payments and supplied products."
        actions={canManage ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> New vendor</Button> : null}
      />

      <KpiGrid bare cols={4}>
        <Stat label="Vendors" value={vendors.data ? vendors.data.pageInfo.totalItems.toLocaleString('en-IN') : '…'} hint={status || stateCode || debounced ? 'matching filters' : 'all suppliers'} />
        <Stat variant="alert" label="Licence alerts" value={vendors.data ? licenceAlerts : '…'} tone={licenceAlerts > 0 ? 'red' : 'neutral'} hint="missing or expiring ≤ 30 d (this page)" />
        {aging.data ? (
          <>
            <Stat label="Payables" value={money(aging.data.payables.total)} tone={Number(aging.data.payables.total) > 0 ? 'amber' : 'neutral'} hint="all suppliers" />
            <Stat variant="alert" label="Overdue payables" value={money(payablesOverdue)} tone={payablesOverdue > 0 ? 'red' : 'neutral'} hint="past due date" />
          </>
        ) : null}
      </KpiGrid>

      <Card title="Suppliers" actions={<SearchInput value={search} onChange={resetPage(setSearch)} placeholder="Name, GSTIN, phone, contact…" className="w-full sm:w-64" />}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <FilterChips<Status>
            value={status}
            onChange={resetPage(setStatus)}
            options={[
              { id: 'ACTIVE', label: 'Active', tone: 'green' },
              { id: 'INACTIVE', label: 'Inactive', tone: 'neutral' },
              { id: 'BLOCKED', label: 'Blocked', tone: 'red' },
            ]}
          />
          <div className="w-56">
            <StateSelect value={stateCode} onChange={resetPage(setStateCode)} />
          </div>
        </div>
        {vendors.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : vendors.error ? (
          <ErrorState
            message={vendors.error instanceof ApiClientError && vendors.error.status === 403 ? 'You do not have permission to view vendors.' : 'Failed to load vendors.'}
            retry={() => void vendors.refetch()}
          />
        ) : items.length === 0 ? (
          debounced || status || stateCode ? (
            <EmptyState title="No vendors match" hint="Try a different search or clear the filters." />
          ) : (
            <EmptyState title="No vendors yet" hint="Add the distributors you purchase from." action={canManage ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> New vendor</Button> : undefined} />
          )
        ) : (
          <>
            <div className={cn('transition-opacity', vendors.isFetching && 'opacity-60')}>
              <Table head={<tr><Th>Vendor</Th><Th>GSTIN · State</Th><Th>Drug licence</Th><Th right>Payable</Th><Th>Terms</Th><Th>Status</Th></tr>}>
                {items.map((v) => {
                  const payable = Number(v.payable ?? 0);
                  const overdue = Number(v.overdue ?? 0);
                  const dl = v.drugLicenceExpiry ? daysUntil(v.drugLicenceExpiry.slice(0, 10)) : null;
                  return (
                    <Tr key={v.id} onClick={() => setOpen(v)}>
                      <Td>
                        <div className="font-medium text-ink">{v.legalName}</div>
                        <div className="text-xs text-muted">{[v.tradeName, v.contactName, v.phone].filter(Boolean).join(' · ') || '—'}</div>
                      </Td>
                      <Td className="font-mono text-xs">
                        {v.gstin ?? <span className="font-sans text-faint">Unregistered</span>}
                        {v.stateCode ? <div className="font-sans text-muted">{stateName(v.stateCode) ?? v.stateCode}</div> : null}
                      </Td>
                      <Td>
                        {v.drugLicenceNumber ? (
                          <div className="space-y-0.5">
                            <div className="font-mono text-2xs">{v.drugLicenceNumber}</div>
                            {dl !== null ? <ExpiryPill days={dl} /> : null}
                          </div>
                        ) : (
                          <Badge tone="amber">Missing</Badge>
                        )}
                      </Td>
                      <Td right>
                        <span className={payable > 0 ? 'font-semibold text-warning' : 'text-faint'}>{payable > 0 ? money(payable) : '—'}</span>
                        {overdue > 0 ? <div className="text-2xs font-medium text-danger">{money(overdue)} overdue</div> : null}
                      </Td>
                      <Td className="text-sm">
                        {v.creditDays}d{Number(v.creditLimit) > 0 ? ` · ${money(v.creditLimit)}` : ''}
                      </Td>
                      <Td><StatusBadge status={v.status} /></Td>
                    </Tr>
                  );
                })}
              </Table>
            </div>
            <Pagination info={vendors.data?.pageInfo} onChange={setPage} label="vendors" />
          </>
        )}
      </Card>

      {creating ? (
        <CreateVendorDrawer
          onClose={() => setCreating(false)}
          onCreated={(v) => {
            setCreating(false);
            invalidate();
            setOpen(v);
          }}
        />
      ) : null}
      {drawerVendor ? (
        <VendorDrawer
          key={drawerVendor.id}
          vendor={drawerVendor}
          onClose={closeDrawer}
          onSaved={() => {
            closeDrawer();
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

export default function VendorsPage() {
  return (
    <Suspense fallback={null}>
      <VendorsView />
    </Suspense>
  );
}
