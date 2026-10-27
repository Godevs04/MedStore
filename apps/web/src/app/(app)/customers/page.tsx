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
}

interface Statement {
  customer: { id: string; name: string; creditLimit: string; creditDays: number };
  rows: Array<{ date: string; type: string; doc: string; invoiceId: string | null; debit: string; credit: string; balance: string }>;
  outstanding: string;
  totals: { invoiced: string; invoices: number };
}

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
  creditLimit: '0.00',
  openingBalance: '0.00',
  isWholesale: false,
};

function toBody(f: FormState, includeOpening: boolean) {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name: f.name.trim(),
    category: opt(f.category),
    phone: opt(f.phone),
    email: opt(f.email),
    gstin: f.gstin.trim() ? f.gstin.trim().toUpperCase() : null,
    addressLine1: opt(f.addressLine1),
    city: opt(f.city),
    stateCode: opt(f.stateCode),
    pinCode: opt(f.pinCode),
    creditDays: Number(f.creditDays) || 0,
    creditLimit: Number(f.creditLimit || 0).toFixed(2),
    ...(includeOpening ? { openingBalance: Number(f.openingBalance || 0).toFixed(2) } : {}),
    isWholesale: f.isWholesale,
  };
}

function CustomerFields({ form, setForm, showOpening }: { form: FormState; setForm: (f: FormState) => void; showOpening: boolean }) {
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Name *"><Input value={form.name} onChange={set('name')} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={set('phone')} placeholder="98XXXXXXXX" /></Field>
      <Field label="Email"><Input value={form.email} onChange={set('email')} /></Field>
      <Field label="Category"><Input value={form.category} onChange={set('category')} placeholder="Hospital / Clinic / Retail" /></Field>
      <Field label="GSTIN (B2B)"><Input value={form.gstin} onChange={set('gstin')} placeholder="29ABCDE1234F1Z5" /></Field>
      <Field label="State code"><Input value={form.stateCode} onChange={set('stateCode')} placeholder="29" /></Field>
      <Field label="Address"><Input value={form.addressLine1} onChange={set('addressLine1')} /></Field>
      <Field label="City / PIN">
        <div className="flex gap-2">
          <Input value={form.city} onChange={set('city')} />
          <Input className="w-24" value={form.pinCode} onChange={set('pinCode')} placeholder="PIN" />
        </div>
      </Field>
      <Field label="Credit days"><Input inputMode="numeric" value={form.creditDays} onChange={set('creditDays')} /></Field>
      <Field label="Credit limit (₹, 0 = none)"><Input inputMode="decimal" value={form.creditLimit} onChange={set('creditLimit')} /></Field>
      {showOpening ? <Field label="Opening balance (₹ owed to us)"><Input inputMode="decimal" value={form.openingBalance} onChange={set('openingBalance')} /></Field> : null}
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
        <input type="checkbox" className="accent-brand-600" checked={form.isWholesale} onChange={(e) => setForm({ ...form, isWholesale: e.target.checked })} />
        Wholesale customer
      </label>
    </div>
  );
}

function CustomerDrawer({ customer, onClose, onChanged }: { customer: CustomerRow; onClose: () => void; onChanged: (msg: string) => void }) {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const [tab, setTab] = useState<'statement' | 'invoices' | 'receive' | 'profile'>('statement');
  const [form, setForm] = useState<FormState>({
    ...EMPTY,
    ...Object.fromEntries(Object.entries(customer).map(([k, v]) => [k, v === null ? '' : typeof v === 'number' ? String(v) : v])),
  } as FormState);
  const [receipt, setReceipt] = useState({ amount: '', method: 'CASH', reference: '' });

  const statement = useQuery({ queryKey: ['customer-statement', customer.id], queryFn: () => api<Statement>(`/sales/customers/${customer.id}/statement`) });
  const invoices = useQuery({
    queryKey: ['customer-invoices', customer.id],
    queryFn: () => api<{ items: Array<{ id: string; invoiceNumber: string; invoiceDate: string; total: string; creditAmount: string; status: string }> }>(`/sales/invoices?page=1&pageSize=100&customerId=${customer.id}`),
    enabled: tab === 'invoices',
  });
  const save = useMutation({
    meta: { success: 'Customer updated' },
    mutationFn: () => api(`/partners/customers/${customer.id}`, { method: 'PUT', body: toBody(form, false) }),
    onSuccess: () => onChanged(`${form.name} updated.`),
  });
  const receive = useMutation({
    meta: { success: 'Payment received' },
    mutationFn: () =>
      api<{ applied: string; receiptNumber?: string }>('/sales/receipts', {
        method: 'POST',
        body: { customerId: customer.id, amount: Number(receipt.amount).toFixed(2), method: receipt.method, reference: receipt.reference.trim() || null },
      }),
    onSuccess: () => {
      setReceipt({ amount: '', method: 'CASH', reference: '' });
      void queryClient.invalidateQueries({ queryKey: ['customer-statement', customer.id] });
      void queryClient.invalidateQueries({ queryKey: ['customer-invoices', customer.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setTab('statement');
    },
  });
  const outstanding = Number(statement.data?.outstanding ?? 0);

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={customer.name}
      subtitle={[customer.phone, customer.gstin && `GSTIN ${customer.gstin}`, customer.category].filter(Boolean).join(' · ') || 'Customer'}
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Outstanding" value={statement.data ? money(statement.data.outstanding) : '…'} tone={outstanding > 0 ? 'amber' : 'green'} />
        <Stat label="Credit limit" value={Number(customer.creditLimit) > 0 ? money(customer.creditLimit) : 'No limit'} hint={`${customer.creditDays} days`} />
        <Stat label="Lifetime billed" value={statement.data ? money(statement.data.totals.invoiced) : '…'} hint={statement.data ? `${statement.data.totals.invoices} invoices` : undefined} tone="blue" />
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'statement', label: 'Statement' },
          { id: 'invoices', label: 'Invoices' },
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
                <Td className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(r.date)}</Td>
                <Td className="text-xs">{r.type}</Td>
                <Td className="font-mono text-xs">
                  {r.invoiceId ? <Link className="text-brand-700 hover:underline" href={`/sales-history/${r.invoiceId}`}>{r.doc}</Link> : r.doc}
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
        ) : (invoices.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <Table head={<tr><Th>Invoice</Th><Th>Date</Th><Th>Status</Th><Th right>Total</Th><Th right>Due</Th></tr>}>
            {invoices.data?.items.map((i) => (
              <Tr key={i.id}>
                <Td><Link className="font-mono text-xs font-medium text-brand-700 hover:underline" href={`/sales-history/${i.id}`}>{i.invoiceNumber}</Link></Td>
                <Td className="text-xs text-neutral-500">{fmtDate(i.invoiceDate)}</Td>
                <Td><Badge tone={i.status === 'POSTED' ? 'green' : i.status === 'RETURNED' ? 'red' : 'amber'}>{i.status.replace('_', ' ').toLowerCase()}</Badge></Td>
                <Td right>{money(i.total)}</Td>
                <Td right className={Number(i.creditAmount) > 0 ? 'font-medium text-amber-700' : 'text-neutral-400'}>{Number(i.creditAmount) > 0 ? money(i.creditAmount) : '—'}</Td>
              </Tr>
            ))}
          </Table>
        )
      ) : null}

      {tab === 'receive' ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Receipts settle the oldest open credit invoices first and post Dr Cash/Bank, Cr Receivables.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Amount (₹)">
              <Input inputMode="decimal" value={receipt.amount} onChange={(e) => setReceipt((s) => ({ ...s, amount: e.target.value }))} placeholder={outstanding > 0 ? outstanding.toFixed(2) : '0.00'} />
            </Field>
            <Field label="Method">
              <Select value={receipt.method} onChange={(e) => setReceipt((s) => ({ ...s, method: e.target.value }))}>
                <option value="CASH">Cash</option>
                <option value="UPI">UPI</option>
                <option value="CARD">Card</option>
                <option value="BANK">Bank transfer</option>
              </Select>
            </Field>
            <Field label="Reference">
              <Input value={receipt.reference} onChange={(e) => setReceipt((s) => ({ ...s, reference: e.target.value }))} placeholder="UTR / cheque no." />
            </Field>
          </div>
          {Number(receipt.amount) > outstanding ? <ErrorBanner>Amount exceeds the outstanding balance of {money(outstanding)}.</ErrorBanner> : null}
          {receive.error ? <ErrorBanner>{receive.error instanceof ApiClientError ? receive.error.message : 'Failed to record receipt'}</ErrorBanner> : null}
          <div className="flex gap-2">
            <Button disabled={!(Number(receipt.amount) > 0) || Number(receipt.amount) > outstanding || receive.isPending} onClick={() => receive.mutate()}>
              {receive.isPending ? 'Recording…' : 'Record receipt'}
            </Button>
            {outstanding > 0 ? <Button variant="secondary" onClick={() => setReceipt((s) => ({ ...s, amount: outstanding.toFixed(2) }))}>Full balance</Button> : null}
          </div>
        </div>
      ) : null}

      {tab === 'profile' ? (
        <div className="space-y-3">
          <CustomerFields form={form} setForm={setForm} showOpening={false} />
          {save.error ? <ErrorBanner>{save.error instanceof ApiClientError ? save.error.message : 'Failed to save'}</ErrorBanner> : null}
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
        </div>
      ) : null}
    </Drawer>
  );
}

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const canManage = Boolean(membership && (membership.isOwner || membership.permissions.includes('customers.manage')));
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<CustomerRow | null>(null);

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => api<{ items: CustomerRow[]; pageInfo: { totalItems: number } }>(`/partners/customers?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    retry: false,
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
  };
  const create = useMutation({
    meta: { success: 'Customer created' },
    mutationFn: () => api<CustomerRow>('/partners/customers', { method: 'POST', body: toBody(form, true) }),
    onSuccess: (c) => {
      setForm(EMPTY);
      setShowCreate(false);
      invalidate();
      setNotice(`Customer ${c.name} created.`);
    },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Customers"
        subtitle="Credit accounts, statements and collections. Click a customer for their ledger."
        actions={
          <>
            <Input placeholder="Search name / phone / GSTIN…" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
            {canManage ? <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : '+ New customer'}</Button> : null}
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}

      {showCreate ? (
        <Card title="New customer">
          <CustomerFields form={form} setForm={setForm} showOpening />
          {create.error ? <div className="mt-3"><ErrorBanner>{create.error instanceof ApiClientError ? create.error.message : 'Failed to create customer'}</ErrorBanner></div> : null}
          <div className="mt-3 flex gap-2">
            <Button disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create customer'}</Button>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </Card>
      ) : null}

      <Card title={`Customers (${customers.data?.pageInfo.totalItems ?? 0})`}>
        {customers.isLoading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : customers.error ? (
          <ErrorState
            message={customers.error instanceof ApiClientError && customers.error.status === 403 ? 'You do not have permission to view customers.' : 'Failed to load customers.'}
            retry={() => void customers.refetch()}
          />
        ) : (customers.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No customers yet" hint="Walk-ins can be billed without an account; create customers for credit sales and B2B invoices." />
        ) : (
          <Table head={<tr><Th>Customer</Th><Th>Contact</Th><Th>GSTIN</Th><Th>Credit terms</Th><Th>Type</Th><Th>Status</Th></tr>}>
            {customers.data?.items.map((c) => (
              <Tr key={c.id} onClick={() => setOpen(c)}>
                <Td>
                  <div className="font-medium text-neutral-800">{c.name}</div>
                  {c.category ? <div className="text-xs text-neutral-500">{c.category}</div> : null}
                </Td>
                <Td className="text-sm">{c.phone ?? '—'}</Td>
                <Td className="font-mono text-xs">{c.gstin ?? '—'}</Td>
                <Td className="text-sm">{Number(c.creditLimit) > 0 ? `${money(c.creditLimit)} · ${c.creditDays}d` : <span className="text-neutral-400">No limit · {c.creditDays}d</span>}</Td>
                <Td>{c.isWholesale ? <Badge tone="blue">Wholesale</Badge> : <Badge>Retail</Badge>}</Td>
                <Td><Badge tone={c.status === 'ACTIVE' ? 'green' : 'neutral'}>{c.status}</Badge></Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      {open ? (
        <CustomerDrawer
          customer={open}
          onClose={() => setOpen(null)}
          onChanged={(msg) => {
            setOpen(null);
            setNotice(msg);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
