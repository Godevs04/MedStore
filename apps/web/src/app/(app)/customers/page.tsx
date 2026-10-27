'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { customerCreateSchema, customerReceiptSchema, gstinIssues, issuesToRecord, stateName } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { toast } from '@/lib/toast';
import {
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
  money, StatusBadge } from '@/components/ui';

interface CustomerRow {
  id: string;
  name: string;
  category: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  addressLine1: string | null;
  city: string | null;
  stateCode: string | null;
  pinCode: string | null;
  creditDays: number;
  creditLimit: string;
  openingBalance: string;
  isWholesale: boolean;
  status: string;
  notes: string | null;
  outstanding?: string;
  overdue?: string;
  oldestDueDays?: number;
}

interface Statement {
  customer: { id: string; name: string; creditLimit: string; creditDays: number };
  rows: Array<{ date: string; type: string; doc: string; invoiceId: string | null; debit: string; credit: string; balance: string }>;
  outstanding: string;
  totals: { invoiced: string; invoices: number };
}

interface TopProduct {
  productId: string;
  name: string;
  quantity: string;
  value: string;
  bills: number;
  lastBought: string;
}

type Status = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
type FormState = {
  name: string;
  category: string;
  phone: string;
  email: string;
  gstin: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  pinCode: string;
  creditDays: string;
  creditLimit: string;
  openingBalance: string;
  isWholesale: boolean;
  status: Status;
  notes: string;
};

const EMPTY: FormState = {
  name: '',
  category: '',
  phone: '',
  email: '',
  gstin: '',
  addressLine1: '',
  city: '',
  stateCode: '',
  pinCode: '',
  creditDays: '0',
  creditLimit: '',
  openingBalance: '',
  isWholesale: false,
  status: 'ACTIVE',
  notes: '',
};

const PAGE_SIZE = 25;

function fromRow(c: CustomerRow): FormState {
  return {
    name: c.name,
    category: c.category ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    gstin: c.gstin ?? '',
    addressLine1: c.addressLine1 ?? '',
    city: c.city ?? '',
    stateCode: c.stateCode ?? '',
    pinCode: c.pinCode ?? '',
    creditDays: String(c.creditDays),
    creditLimit: Number(c.creditLimit) > 0 ? Number(c.creditLimit).toFixed(2) : '',
    openingBalance: '',
    isWholesale: c.isWholesale,
    status: (c.status as Status) ?? 'ACTIVE',
    notes: c.notes ?? '',
  };
}

function toBody(f: FormState, isNew: boolean) {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name: f.name.trim(),
    category: opt(f.category),
    phone: opt(f.phone.replace(/\s+/g, '')),
    email: opt(f.email),
    gstin: f.gstin.trim() ? f.gstin.trim().toUpperCase() : null,
    addressLine1: opt(f.addressLine1),
    city: opt(f.city),
    stateCode: opt(f.stateCode),
    pinCode: opt(f.pinCode),
    creditDays: Number(f.creditDays || 0),
    creditLimit: Number(f.creditLimit || 0).toFixed(2),
    ...(isNew ? { openingBalance: Number(f.openingBalance || 0).toFixed(2) } : { status: f.status }),
    isWholesale: f.isWholesale,
    notes: opt(f.notes),
  };
}

/** Grouped customer form with per-field errors; returns a validated body or null. */
function useCustomerForm(initial: FormState, isNew: boolean) {
  const [form, setForm] = useState<FormState>(initial);
  const fe = useFieldErrors();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    fe.clear(k);
  };
  const onDerived = useCallback(
    (d: { stateCode: string }) => {
      setForm((f) => (f.stateCode ? f : { ...f, stateCode: d.stateCode }));
    },
    [],
  );
  const validate = () => {
    const body = toBody(form, isNew);
    const extra = issuesToRecord(gstinIssues({ gstin: body.gstin, stateCode: body.stateCode }));
    if (body.gstin && !body.stateCode) extra.stateCode = 'Select the state for a GST-registered customer';
    if (Number(form.creditDays || 0) > 365) extra.creditDays = 'Credit days cannot exceed 365';
    return fe.validate(customerCreateSchema, body, extra) ? body : null;
  };
  return { form, set, setForm, fe, onDerived, validate };
}

function CustomerFields({ ctl, isNew }: { ctl: ReturnType<typeof useCustomerForm>; isNew: boolean }) {
  const { form, set, fe, onDerived } = ctl;
  const e = fe.errors;
  return (
    <div className="space-y-3">
      <FormSection title="Identity">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" required error={e.name}>
            <Input value={form.name} maxLength={200} onChange={(ev) => set('name', ev.target.value)} placeholder="e.g. Sunrise Clinic" autoFocus={isNew} />
          </Field>
          <Field label="Category" error={e.category}>
            <Input value={form.category} maxLength={80} onChange={(ev) => set('category', ev.target.value)} placeholder="Hospital / Clinic / Retail" list="customer-categories" />
          </Field>
          <Field label="Mobile" error={e.phone} hint="10-digit Indian mobile, used for bill SMS and search">
            <Input value={form.phone} inputMode="tel" maxLength={14} onChange={(ev) => set('phone', ev.target.value.replace(/[^\d+\s]/g, ''))} placeholder="98XXXXXXXX" />
          </Field>
          <Field label="Email" error={e.email}>
            <Input value={form.email} type="email" maxLength={160} onChange={(ev) => set('email', ev.target.value)} placeholder="accounts@clinic.in" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" className="accent-brand-600" checked={form.isWholesale} onChange={(ev) => set('isWholesale', ev.target.checked)} />
          Wholesale / B2B customer <span className="text-xs text-muted">(gets a tax invoice with their GSTIN)</span>
        </label>
      </FormSection>

      <FormSection title="GST and address" hint="The GSTIN fills in the state automatically. Place of supply decides CGST + SGST or IGST.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="GSTIN" error={e.gstin}>
            <GstinInput value={form.gstin} onChange={(v) => set('gstin', v)} onDerived={onDerived} invalid={Boolean(e.gstin)} />
          </Field>
          <Field label="State" error={e.stateCode}>
            <StateSelect value={form.stateCode} onChange={(v) => set('stateCode', v)} invalid={Boolean(e.stateCode)} />
          </Field>
          <Field label="Address" error={e.addressLine1} className="sm:col-span-2">
            <Input value={form.addressLine1} maxLength={200} onChange={(ev) => set('addressLine1', ev.target.value)} />
          </Field>
          <Field label="City" error={e.city}>
            <Input value={form.city} maxLength={100} onChange={(ev) => set('city', ev.target.value)} />
          </Field>
          <Field label="PIN code" error={e.pinCode}>
            <QtyInput value={form.pinCode} onChange={(v) => set('pinCode', v.slice(0, 6))} placeholder="411001" aria-label="PIN code" invalid={Boolean(e.pinCode)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Credit" hint="Credit limit is enforced at billing; 0 means no limit.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Credit days" error={e.creditDays}>
            <QtyInput value={form.creditDays} onChange={(v) => set('creditDays', v.slice(0, 3))} invalid={Boolean(e.creditDays)} aria-label="Credit days" />
          </Field>
          <Field label="Credit limit" error={e.creditLimit}>
            <MoneyInput value={form.creditLimit} onChange={(v) => set('creditLimit', v)} invalid={Boolean(e.creditLimit)} aria-label="Credit limit" />
          </Field>
          {isNew ? (
            <Field label="Opening balance" error={e.openingBalance} hint="Amount they already owe you">
              <MoneyInput value={form.openingBalance} onChange={(v) => set('openingBalance', v)} invalid={Boolean(e.openingBalance)} aria-label="Opening balance" />
            </Field>
          ) : (
            <Field label="Status" error={e.status}>
              <Select value={form.status} onChange={(ev) => set('status', ev.target.value as Status)}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="BLOCKED">Blocked (no credit sales)</option>
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notes" error={e.notes}>
          <Textarea rows={2} maxLength={1000} value={form.notes} onChange={(ev) => set('notes', ev.target.value)} placeholder="Doctor, delivery instructions…" />
        </Field>
      </FormSection>
      <datalist id="customer-categories">
        {['Retail', 'Hospital', 'Clinic', 'Nursing home', 'Pharmacy', 'Doctor', 'Corporate'].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

function CreateCustomerDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (c: CustomerRow) => void }) {
  const ctl = useCustomerForm(EMPTY, true);
  const create = useMutation({
    meta: { silent: true },
    mutationFn: (body: ReturnType<typeof toBody>) => api<CustomerRow>('/partners/customers', { method: 'POST', body }),
    onSuccess: (c) => {
      toast.success(`Customer ${c.name} created`, c.gstin ? `B2B · ${stateName(c.stateCode) ?? c.stateCode}` : undefined);
      onCreated(c);
    },
    onError: (err) => {
      if (err instanceof ApiClientError) ctl.fe.setServerErrors(err.details);
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = ctl.validate();
    if (body) create.mutate(body);
    else toast.error('Please fix the highlighted fields');
  };
  return (
    <Drawer open onClose={onClose} title="New customer" subtitle="Credit accounts, B2B buyers and regular patients" width="max-w-2xl">
      <form onSubmit={submit} noValidate className="space-y-3">
        <CustomerFields ctl={ctl} isNew />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create customer'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function ReceivePanel({ customer, outstanding, onDone }: { customer: CustomerRow; outstanding: number; onDone: () => void }) {
  const [receipt, setReceipt] = useState({ amount: '', method: 'CASH' as 'CASH' | 'UPI' | 'CARD' | 'BANK', reference: '' });
  const fe = useFieldErrors();
  const receive = useMutation({
    meta: { silent: true },
    mutationFn: (body: { customerId: string; amount: string; method: string; reference: string | null }) =>
      api<{ amount: string; applied: Array<{ invoiceNumber: string; amount: string }> }>('/sales/receipts', { method: 'POST', body }),
    onSuccess: (r) => {
      toast.success(`Received ${money(r.amount)} from ${customer.name}`, r.applied.length ? `Settled ${r.applied.map((a) => a.invoiceNumber).join(', ')}` : undefined);
      setReceipt({ amount: '', method: 'CASH', reference: '' });
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) fe.setServerErrors(err.details);
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const extra: Record<string, string> = {};
    if (Number(receipt.amount) > outstanding + 0.001) extra.amount = `Cannot exceed the outstanding ${money(outstanding)}`;
    const ref = receipt.reference.trim();
    if (ref && (receipt.method === 'UPI' || receipt.method === 'BANK') && !/^[A-Z0-9]{12,22}$/i.test(ref)) extra.reference = 'UTR must be 12–22 letters or digits';
    const data = fe.validate(customerReceiptSchema, { customerId: customer.id, amount: receipt.amount, method: receipt.method, reference: ref || null }, extra);
    if (data) receive.mutate({ ...data, reference: data.reference ?? null });
  };
  if (outstanding <= 0) return <EmptyState title="Nothing to collect" hint={`${customer.name} has no outstanding balance.`} />;
  return (
    <form className="space-y-3" onSubmit={submit} noValidate>
      <p className="text-sm text-neutral-600">Receipts settle the oldest open credit invoices first and post Dr Cash/Bank, Cr Receivables.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount" required error={fe.errors.amount}>
          <MoneyInput value={receipt.amount} onChange={(v) => { setReceipt((s) => ({ ...s, amount: v })); fe.clear('amount'); }} placeholder={outstanding.toFixed(2)} invalid={Boolean(fe.errors.amount)} />
        </Field>
        <Field label="Method" required>
          <Select value={receipt.method} onChange={(ev) => setReceipt((s) => ({ ...s, method: ev.target.value as typeof s.method }))}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="BANK">Bank transfer (NEFT/IMPS)</option>
          </Select>
        </Field>
        <Field label={receipt.method === 'CASH' ? 'Reference (optional)' : receipt.method === 'CARD' ? 'Approval code' : 'UTR'} error={fe.errors.reference}>
          <Input value={receipt.reference} maxLength={40} onChange={(ev) => { setReceipt((s) => ({ ...s, reference: ev.target.value })); fe.clear('reference'); }} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={receive.isPending}>
          {receive.isPending ? 'Recording…' : 'Record receipt'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setReceipt((s) => ({ ...s, amount: outstanding.toFixed(2) }))}>
          Full balance {money(outstanding)}
        </Button>
      </div>
    </form>
  );
}

function CustomerDrawer({ customer, onClose, onChanged }: { customer: CustomerRow; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const [tab, setTab] = useState<'statement' | 'invoices' | 'products' | 'receive' | 'profile'>('statement');
  const ctl = useCustomerForm(fromRow(customer), false);

  const statement = useQuery({ queryKey: ['customer-statement', customer.id], queryFn: () => api<Statement>(`/sales/customers/${customer.id}/statement`) });
  const invoices = useQuery({
    queryKey: ['customer-invoices', customer.id],
    queryFn: () =>
      api<{ items: Array<{ id: string; invoiceNumber: string; invoiceDate: string; total: string; creditAmount: string; status: string }> }>(
        `/sales/invoices?page=1&pageSize=50&customerId=${customer.id}`,
      ),
    enabled: tab === 'invoices',
  });
  const products = useQuery({
    queryKey: ['customer-products', customer.id],
    queryFn: () => api<TopProduct[]>(`/partners/customers/${customer.id}/top-products?limit=15`),
    enabled: tab === 'products',
  });
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: ReturnType<typeof toBody>) => api(`/partners/customers/${customer.id}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success(`${ctl.form.name} updated`);
      onChanged();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) ctl.fe.setServerErrors(err.details);
    },
  });
  const outstanding = Number(statement.data?.outstanding ?? customer.outstanding ?? 0);
  const limit = Number(customer.creditLimit);
  const maxProduct = Math.max(1, ...(products.data ?? []).map((p) => Number(p.value)));

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={customer.name}
      subtitle={[customer.phone, customer.gstin && `GSTIN ${customer.gstin}`, customer.category, customer.isWholesale ? 'Wholesale' : null].filter(Boolean).join(' · ') || 'Customer'}
    >
      <KpiGrid cols={3}>
        <Stat
          label="Outstanding"
          value={statement.data ? money(statement.data.outstanding) : '…'}
          tone={outstanding > 0 ? 'amber' : 'green'}
          footer={limit > 0 ? <Meter value={(outstanding / limit) * 100} tone={outstanding > limit ? 'red' : outstanding > limit * 0.8 ? 'amber' : 'green'} label={`${Math.round((outstanding / limit) * 100)}% of ${money(limit)} limit`} /> : undefined}
        />
        <Stat label="Credit terms" value={`${customer.creditDays} days`} hint={limit > 0 ? `limit ${money(limit)}` : 'no limit'} />
        <Stat label="Lifetime billed" value={statement.data ? money(statement.data.totals.invoiced) : '…'} hint={statement.data ? `${statement.data.totals.invoices} invoices` : undefined} />
      </KpiGrid>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'statement', label: 'Statement' },
          { id: 'invoices', label: 'Invoices' },
          ...(can('sales.read') ? [{ id: 'products' as const, label: 'Buys most' }] : []),
          ...(can('sales.receipts') ? [{ id: 'receive' as const, label: 'Receive payment' }] : []),
          ...(can('customers.manage') ? [{ id: 'profile' as const, label: 'Edit profile' }] : []),
        ]}
      />

      {tab === 'statement' ? (
        statement.isLoading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : statement.error ? (
          <ErrorState message="Failed to load statement." retry={() => void statement.refetch()} />
        ) : (
          <Table head={<tr><Th>Date</Th><Th>Particulars</Th><Th>Doc</Th><Th right>Debit</Th><Th right>Credit</Th><Th right>Balance</Th></tr>}>
            {statement.data?.rows.map((r, i) => (
              <Tr key={i}>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.date)}</Td>
                <Td className="text-xs">{r.type}</Td>
                <Td className="font-mono text-xs">
                  {r.invoiceId ? <Link className="text-teal-ink hover:underline" href={`/sales-history/${r.invoiceId}`}>{r.doc}</Link> : r.doc}
                </Td>
                <Td right className="text-xs">{Number(r.debit) ? money(r.debit, false) : ''}</Td>
                <Td right className="text-xs">{Number(r.credit) ? money(r.credit, false) : ''}</Td>
                <Td right className="text-xs font-semibold">{money(r.balance, false)}</Td>
              </Tr>
            ))}
          </Table>
        )
      ) : null}

      {tab === 'invoices' ? (
        invoices.isLoading ? (
          <SkeletonRows rows={4} cols={4} />
        ) : invoices.error ? (
          <ErrorState message="Failed to load invoices." retry={() => void invoices.refetch()} />
        ) : (invoices.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <Table head={<tr><Th>Invoice</Th><Th>Date</Th><Th>Status</Th><Th right>Total</Th><Th right>Due</Th></tr>}>
            {invoices.data?.items.map((i) => (
              <Tr key={i.id}>
                <Td><Link className="font-mono text-xs font-medium text-teal-ink hover:underline" href={`/sales-history/${i.id}`}>{i.invoiceNumber}</Link></Td>
                <Td className="text-xs text-muted">{fmtDate(i.invoiceDate)}</Td>
                <Td><Badge tone={i.status === 'POSTED' ? 'green' : i.status === 'CANCELLED' ? 'neutral' : i.status === 'RETURNED' ? 'red' : 'amber'}>{i.status.replace('_', ' ').toLowerCase()}</Badge></Td>
                <Td right>{money(i.total)}</Td>
                <Td right className={Number(i.creditAmount) > 0 ? 'font-medium text-warning' : 'text-faint'}>{Number(i.creditAmount) > 0 ? money(i.creditAmount) : '—'}</Td>
              </Tr>
            ))}
          </Table>
        )
      ) : null}

      {tab === 'products' ? (
        products.isLoading ? (
          <SkeletonRows rows={4} cols={3} />
        ) : products.error ? (
          <ErrorState message="Failed to load products." retry={() => void products.refetch()} />
        ) : (products.data?.length ?? 0) === 0 ? (
          <EmptyState title="No purchases yet" hint="Products appear here once this customer is billed." />
        ) : (
          <ul className="divide-y divide-line">
            {products.data?.map((p) => (
              <li key={p.productId} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-ink">{p.name}</span>
                  <span className="num font-semibold">{money(p.value)}</span>
                </div>
                <p className="mb-1 text-2xs text-muted">
                  {Number(p.quantity).toLocaleString('en-IN')} units · {p.bills} bill{p.bills === 1 ? '' : 's'} · last {fmtDate(p.lastBought)}
                </p>
                <Meter value={(Number(p.value) / maxProduct) * 100} />
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'receive' ? (
        <ReceivePanel
          customer={customer}
          outstanding={outstanding}
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: ['customer-statement', customer.id] });
            void queryClient.invalidateQueries({ queryKey: ['customer-invoices', customer.id] });
            void queryClient.invalidateQueries({ queryKey: ['customers'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
            setTab('statement');
          }}
        />
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
          <CustomerFields ctl={ctl} isNew={false} />
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      ) : null}
    </Drawer>
  );
}

function CustomersView() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const canManage = can('customers.manage');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<Status | ''>('');
  const [kind, setKind] = useState<'retail' | 'wholesale' | ''>('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const focusId = params.get('focus');

  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), withBalances: 'true' });
  if (debounced) qs.set('search', debounced);
  if (status) qs.set('status', status);
  if (kind) qs.set('isWholesale', kind === 'wholesale' ? 'true' : 'false');
  const customers = useQuery({
    queryKey: ['customers', qs.toString()],
    queryFn: () => api<{ items: CustomerRow[]; pageInfo: PageInfo }>(`/partners/customers?${qs.toString()}`),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const wholesale = useQuery({
    queryKey: ['customers', 'wholesale-count'],
    queryFn: () => api<{ pageInfo: PageInfo }>('/partners/customers?page=1&pageSize=1&isWholesale=true'),
  });
  const aging = useQuery({
    queryKey: ['dashboard', 'aging'],
    queryFn: () => api<{ receivables: { buckets: Record<string, string>; total: string } }>('/reports/aging'),
    enabled: can('reports.read'),
  });
  const focused = useQuery({
    queryKey: ['customer', focusId],
    queryFn: () => api<CustomerRow>(`/partners/customers/${focusId}`),
    enabled: Boolean(focusId),
    retry: false,
  });
  const drawerCustomer = open ?? (focusId && focused.data ? focused.data : null);
  const closeDrawer = () => {
    setOpen(null);
    if (focusId) router.replace('/customers');
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
  };
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const overdueTotal = Number(aging.data?.receivables.total ?? 0) - Number(aging.data?.receivables.buckets.CURRENT ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        subtitle="Credit accounts, statements and collections. Click a customer for their ledger."
        actions={canManage ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> New customer</Button> : null}
      />

      <KpiGrid bare cols={4}>
        <Stat label="Customers" value={customers.data ? customers.data.pageInfo.totalItems.toLocaleString('en-IN') : '…'} hint={status || kind || debounced ? 'matching filters' : 'all accounts'} />
        <Stat label="Wholesale / B2B" value={wholesale.data ? wholesale.data.pageInfo.totalItems.toLocaleString('en-IN') : '…'} />
        {aging.data ? (
          <>
            <Stat label="Receivables" value={money(aging.data.receivables.total)} tone={Number(aging.data.receivables.total) > 0 ? 'amber' : 'neutral'} hint="all customers" />
            <Stat variant="alert" label="Overdue" value={money(overdueTotal)} tone={overdueTotal > 0 ? 'red' : 'neutral'} hint="past credit days" />
          </>
        ) : null}
      </KpiGrid>

      <Card
        title="Accounts"
        actions={<SearchInput value={search} onChange={resetPage(setSearch)} placeholder="Name, phone, GSTIN, category…" className="w-full sm:w-64" />}
      >
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
          <span className="h-4 w-px bg-neutral-200" />
          <FilterChips<'retail' | 'wholesale'>
            value={kind}
            onChange={resetPage(setKind)}
            allLabel="Any type"
            options={[
              { id: 'retail', label: 'Retail' },
              { id: 'wholesale', label: 'Wholesale' },
            ]}
          />
        </div>
        {customers.isLoading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : customers.error ? (
          <ErrorState
            message={customers.error instanceof ApiClientError && customers.error.status === 403 ? 'You do not have permission to view customers.' : 'Failed to load customers.'}
            retry={() => void customers.refetch()}
          />
        ) : (customers.data?.items.length ?? 0) === 0 ? (
          debounced || status || kind ? (
            <EmptyState title="No customers match" hint="Try a different search or clear the filters." />
          ) : (
            <EmptyState
              title="No customers yet"
              hint="Walk-ins can be billed without an account; create customers for credit sales and B2B invoices."
              action={canManage ? <Button onClick={() => setCreating(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> New customer</Button> : undefined}
            />
          )
        ) : (
          <>
            <div className={cn('transition-opacity', customers.isFetching && 'opacity-60')}>
              <Table head={<tr><Th>Customer</Th><Th>Contact</Th><Th>GSTIN · State</Th><Th right>Outstanding</Th><Th>Credit use</Th><Th>Status</Th></tr>}>
                {customers.data?.items.map((c) => {
                  const due = Number(c.outstanding ?? 0);
                  const limit = Number(c.creditLimit);
                  return (
                    <Tr key={c.id} onClick={() => setOpen(c)}>
                      <Td>
                        <div className="flex items-center gap-1.5 font-medium text-ink">
                          {c.name}
                          {c.isWholesale ? <Badge tone="blue">B2B</Badge> : null}
                        </div>
                        {c.category ? <div className="text-xs text-muted">{c.category}</div> : null}
                      </Td>
                      <Td className="text-sm">{c.phone ?? '—'}</Td>
                      <Td className="font-mono text-xs">
                        {c.gstin ?? <span className="font-sans text-faint">Unregistered</span>}
                        {c.stateCode ? <span className="ml-1 font-sans text-muted">· {stateName(c.stateCode) ?? c.stateCode}</span> : null}
                      </Td>
                      <Td right>
                        <span className={due > 0 ? 'font-semibold text-warning' : 'text-faint'}>{due > 0 ? money(due) : '—'}</span>
                        {(c.oldestDueDays ?? 0) > 0 ? <div className="text-2xs font-medium text-danger">{c.oldestDueDays}d overdue</div> : null}
                      </Td>
                      <Td className="w-40">
                        {limit > 0 ? (
                          <Meter value={(due / limit) * 100} tone={due > limit ? 'red' : due > limit * 0.8 ? 'amber' : 'green'} label={`${money(limit)} · ${c.creditDays}d`} />
                        ) : (
                          <span className="text-xs text-faint">No limit · {c.creditDays}d</span>
                        )}
                      </Td>
                      <Td><StatusBadge status={c.status} /></Td>
                    </Tr>
                  );
                })}
              </Table>
            </div>
            <Pagination info={customers.data?.pageInfo} onChange={setPage} label="customers" />
          </>
        )}
      </Card>

      {creating ? (
        <CreateCustomerDrawer
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            invalidate();
            setOpen(c);
          }}
        />
      ) : null}
      {drawerCustomer ? (
        <CustomerDrawer
          key={drawerCustomer.id}
          customer={drawerCustomer}
          onClose={closeDrawer}
          onChanged={() => {
            closeDrawer();
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersView />
    </Suspense>
  );
}
