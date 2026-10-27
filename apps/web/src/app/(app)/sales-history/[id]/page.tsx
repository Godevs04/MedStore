'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { customerReceiptSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { toast } from '@/lib/toast';
import { amountInWords } from '@/lib/words';
import { ConfirmDialog, MoneyInput, QtyInput, useFieldErrors } from '@/components/kit';
import { Badge, Button, Drawer, ErrorState, Field, Input, Select, SkeletonRows, cn, fmtDate, money } from '@/components/ui';

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  walkInName: string | null;
  subtotal: string;
  discountAmount: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  cessAmount: string;
  roundOff: string;
  total: string;
  paidAmount: string;
  creditAmount: string;
  returnedAmount: string;
  customer: { id: string; name: string; phone: string | null; gstin: string | null; stateCode: string | null; addressLine1: string | null; city: string | null } | null;
  lines: Array<{
    id: string;
    productName: string;
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxableValue: string;
    cgstAmount: string;
    sgstAmount: string;
    igstAmount: string;
    cessAmount: string;
    taxRatePercent: string;
    hsnCode: string | null;
    lineTotal: string;
    returnedQty: string;
    product: { sku: string; hsnCode: string | null; prescriptionClass: string | null };
    batchAllocations: Array<{ quantity: string; batch: { batchNumber: string; expiryDate: string } }>;
  }>;
  payments: Array<{ id: string; method: string; amount: string; reference: string | null; createdAt: string }>;
  returns: Array<{ id: string; returnNumber: string; reason: string; refundTotal: string; creditAdjusted: string; refundMethod: string | null; createdAt: string }>;
  prescriptions: Array<{
    id: string;
    patientName: string;
    patientPhone: string | null;
    prescriberName: string;
    prescriberRegNo: string | null;
    prescriberAddress: string;
    drugName: string;
    quantity: string;
  }>;
  seller: {
    name: string;
    legalEntityName: string | null;
    gstin: string | null;
    stateCode: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    pinCode: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    licences: Array<{ licenceType: string; licenceNumber: string }>;
  } | null;
  warehouse: { name: string; branch: { name: string } } | null;
}

const n = (v: string | number) => Number(v);
const qty = (v: string) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = { POSTED: 'green', PARTIALLY_RETURNED: 'amber', RETURNED: 'red', CANCELLED: 'neutral' };

function printAs(mode: 'a4' | 'thermal') {
  const style = document.createElement('style');
  style.id = 'mc-print-page';
  style.textContent = mode === 'thermal' ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 10mm; }';
  document.head.appendChild(style);
  if (mode === 'thermal') document.body.classList.add('print-thermal');
  const cleanup = () => {
    document.body.classList.remove('print-thermal');
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

function ReturnDrawer({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const returnable = invoice.lines.map((l) => ({ line: l, max: n(l.quantity) - n(l.returnedQty) })).filter((r) => r.max > 0);
  const [rows, setRows] = useState<Record<string, { qty: string; restock: boolean }>>(
    Object.fromEntries(returnable.map((r) => [r.line.id, { qty: '', restock: true }])),
  );
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);
  const reasonError = reasonTouched && reason.trim().length < 3 ? 'Give a reason of at least 3 characters' : undefined;
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK'>('CASH');
  const selected = returnable.filter((r) => n(rows[r.line.id]?.qty || 0) > 0);
  const invalid = selected.some((r) => n(rows[r.line.id]!.qty) > r.max);
  const estimate = selected.reduce((s, r) => s + (n(r.line.lineTotal) / n(r.line.quantity)) * n(rows[r.line.id]!.qty), 0);
  const openCredit = n(invoice.creditAmount);

  const submit = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<{ returnNumber: string; refundTotal: string }>('/sales/returns', {
        method: 'POST',
        body: {
          invoiceId: invoice.id,
          reason: reason.trim(),
          refundMethod,
          lines: selected.map((r) => ({ invoiceLineId: r.line.id, quantity: String(n(rows[r.line.id]!.qty)), restock: rows[r.line.id]!.restock })),
        },
      }),
    onSuccess: (r) => {
      toast.success(`Credit note ${r.returnNumber} issued`, `${money(r.refundTotal)} credited${openCredit > 0 ? ' — open credit settled first' : ''}.`);
      onDone();
    },
  });

  return (
    <Drawer open onClose={onClose} title="Return items" subtitle={`Against ${invoice.invoiceNumber} · issues a credit note and reverses GST`}>
      <div className="space-y-2">
        {returnable.map(({ line, max }) => {
          const r = rows[line.id]!;
          const over = n(r.qty || 0) > max;
          return (
            <div key={line.id} className={cn('rounded-xl border px-3 py-2.5', over ? 'border-red-200 bg-red-50/40' : 'border-neutral-200')}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-800">{line.productName}</p>
                  <p className="text-xs text-neutral-500">
                    Sold {qty(line.quantity)} · returned {qty(line.returnedQty)} · {money(n(line.lineTotal) / n(line.quantity))} each
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <QtyInput
                    className="w-20 text-right"
                    decimals={3}
                    placeholder={`≤ ${max}`}
                    value={r.qty}
                    invalid={over}
                    onChange={(v) => setRows((s) => ({ ...s, [line.id]: { ...r, qty: v } }))}
                    aria-label={`Return quantity for ${line.productName}`}
                  />
                  <Button variant="ghost" className="px-2 text-xs" onClick={() => setRows((s) => ({ ...s, [line.id]: { ...r, qty: String(max) } }))}>
                    All
                  </Button>
                </div>
              </div>
              <label className="mt-1.5 flex items-center gap-2 text-xs text-neutral-600">
                <input type="checkbox" className="accent-brand-600" checked={r.restock} onChange={(e) => setRows((s) => ({ ...s, [line.id]: { ...r, restock: e.target.checked } }))} />
                Restock to saleable inventory (uncheck for damaged / expired goods)
              </label>
              {over ? <p className="mc-anim-shake mt-1 text-xs font-medium text-red-600">Only {qty(String(max))} can be returned.</p> : null}
            </div>
          );
        })}
      </div>
      <Field label="Reason" required error={reasonError}>
        <Input value={reason} maxLength={500} onBlur={() => setReasonTouched(true)} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong strength dispensed" />
      </Field>
      <Field label="Refund via">
        <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as typeof refundMethod)}>
          <option value="CASH">Cash</option>
          <option value="UPI">UPI</option>
          <option value="CARD">Card reversal</option>
          <option value="BANK">Bank transfer</option>
        </Select>
      </Field>
      <div className="rounded-xl bg-neutral-50 px-3 py-2.5 text-sm ring-1 ring-neutral-100">
        <div className="flex justify-between">
          <span className="text-neutral-500">Estimated credit note</span>
          <span className="font-semibold tabular-nums">{money(estimate)}</span>
        </div>
        {openCredit > 0 ? (
          <p className="mt-1 text-xs text-neutral-500">
            {money(Math.min(openCredit, estimate))} will first settle this invoice&apos;s open credit; the rest is refunded via {refundMethod.toLowerCase()}.
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          disabled={selected.length === 0 || invalid || submit.isPending}
          onClick={() => {
            setReasonTouched(true);
            if (reason.trim().length >= 3) submit.mutate();
          }}
        >
          {submit.isPending ? 'Posting…' : 'Issue credit note'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Drawer>
  );
}

function ReceiveBalanceDrawer({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ amount: n(invoice.creditAmount).toFixed(2), method: 'CASH' as 'CASH' | 'UPI' | 'CARD' | 'BANK', reference: '' });
  const fe = useFieldErrors();
  const receive = useMutation({
    meta: { silent: true },
    mutationFn: (body: { customerId: string; amount: string; method: string; reference: string | null }) =>
      api<{ amount: string; applied: Array<{ invoiceNumber: string; amount: string }> }>('/sales/receipts', { method: 'POST', body }),
    onSuccess: (r) => {
      toast.success(`Received ${money(r.amount)}`, `Applied to ${r.applied.map((a) => a.invoiceNumber).join(', ')}.`);
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiClientError) fe.setServerErrors(err.details);
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const extra: Record<string, string> = {};
    if ((form.method === 'UPI' || form.method === 'BANK') && form.reference.trim() && !/^[A-Z0-9]{12,22}$/i.test(form.reference.trim())) {
      extra.reference = 'UTR must be 12–22 letters or digits';
    }
    const data = fe.validate(customerReceiptSchema, { customerId: invoice.customer!.id, amount: form.amount, method: form.method, reference: form.reference.trim() || null }, extra);
    if (data) receive.mutate({ ...data, reference: data.reference ?? null });
  };
  return (
    <Drawer open onClose={onClose} title="Receive balance" subtitle={`${invoice.customer?.name} · ${money(invoice.creditAmount)} due on ${invoice.invoiceNumber}`} width="max-w-md">
      <form className="space-y-3" onSubmit={submit} noValidate>
        <Field label="Amount" required error={fe.errors.amount} hint="Receipts settle the customer's oldest open invoices first.">
          <MoneyInput value={form.amount} onChange={(v) => { setForm((f) => ({ ...f, amount: v })); fe.clear('amount'); }} invalid={Boolean(fe.errors.amount)} />
        </Field>
        <Field label="Received via" required>
          <Select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as typeof f.method }))}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="BANK">Bank transfer (NEFT/IMPS)</option>
          </Select>
        </Field>
        {form.method !== 'CASH' ? (
          <Field label={form.method === 'CARD' ? 'Approval code' : 'UTR / reference'} error={fe.errors.reference}>
            <Input value={form.reference} maxLength={40} onChange={(e) => { setForm((f) => ({ ...f, reference: e.target.value })); fe.clear('reference'); }} />
          </Field>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={receive.isPending}>{receive.isPending ? 'Recording…' : `Record ${money(form.amount || 0)}`}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const canReturn = can('returns.create');
  const [returning, setReturning] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceDetail>(`/sales/invoices/${id}`), retry: false });
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
    void queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const cancel = useMutation({
    mutationFn: (reason: string) => api<InvoiceDetail>(`/sales/invoices/${id}/cancel`, { method: 'POST', body: { reason } }),
    meta: { success: 'Invoice cancelled — stock restored and journal reversed' },
    onSuccess: () => {
      setCancelling(false);
      refreshAll();
    },
  });

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="mc-skeleton h-8 w-64" />
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <SkeletonRows rows={8} cols={6} />
        </div>
      </div>
    );
  }
  if (q.error || !q.data) {
    return <ErrorState message={q.error instanceof ApiClientError && q.error.status === 404 ? 'Invoice not found.' : 'Failed to load invoice.'} retry={() => void q.refetch()} />;
  }
  const inv = q.data;
  const s = inv.seller;
  const interState = n(inv.igstAmount) > 0;
  const fullyReturned = inv.lines.every((l) => n(l.returnedQty) >= n(l.quantity));
  const cancelled = inv.status === 'CANCELLED';
  const canCancel = can('sales.void') && inv.status === 'POSTED' && inv.returns.length === 0;
  const canReceive = can('sales.receipts') && !cancelled && Boolean(inv.customer) && n(inv.creditAmount) > 0;
  const timeline = [
    ...inv.payments.map((p) => ({
      key: p.id,
      at: p.createdAt,
      label: p.method === 'CREDIT' ? 'On credit' : new Date(p.createdAt).getTime() - new Date(inv.invoiceDate).getTime() > 60_000 ? `Received · ${p.method}` : `Paid · ${p.method}`,
      amount: p.amount,
      tone: p.method === 'CREDIT' ? 'amber' : 'green',
      note: p.reference && !p.reference.startsWith('Receipt against') ? p.reference : null,
    })),
    ...inv.returns.map((r) => ({ key: r.id, at: r.createdAt, label: `Credit note ${r.returnNumber}`, amount: `-${r.refundTotal}`, tone: 'red', note: r.reason })),
    ...(inv.cancelledAt ? [{ key: 'cancel', at: inv.cancelledAt, label: 'Cancelled', amount: `-${inv.total}`, tone: 'neutral', note: inv.cancelReason }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const hsnSummary = Object.values(
    inv.lines.reduce<Record<string, { hsn: string; rate: string; taxable: number; cgst: number; sgst: number; igst: number; cess: number }>>((acc, l) => {
      const hsn = l.hsnCode ?? l.product.hsnCode ?? '—';
      const k = `${hsn}|${l.taxRatePercent}`;
      const r = (acc[k] ??= { hsn, rate: l.taxRatePercent, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 });
      r.taxable += n(l.taxableValue);
      r.cgst += n(l.cgstAmount);
      r.sgst += n(l.sgstAmount);
      r.igst += n(l.igstAmount);
      r.cess += n(l.cessAmount);
      return acc;
    }, {}),
  );
  const address = [s?.addressLine1, s?.addressLine2, s?.city, s?.pinCode].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print mc-anim-fade-up flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/sales-history" className="text-sm text-neutral-500 hover:text-brand-700">
            <span className="inline-flex items-center gap-1"><Icon name="arrowLeft" size={14} /> Sales</span>
          </Link>
          <h1 className="font-mono text-lg font-semibold tracking-tight">{inv.invoiceNumber}</h1>
          <Badge tone={STATUS_TONE[inv.status] ?? 'neutral'}>{inv.status.replace('_', ' ').toLowerCase()}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => printAs('a4')}>
            <Icon name="print" size={15} /> Print A4
          </Button>
          <Button variant="secondary" onClick={() => printAs('thermal')}>
            <Icon name="print" size={15} /> Thermal 80mm
          </Button>
          {canReceive ? (
            <Button variant="secondary" onClick={() => setReceiving(true)}>
              <Icon name="rupee" size={15} /> Receive balance
            </Button>
          ) : null}
          {canReturn && !fullyReturned && !cancelled ? (
            <Button variant="secondary" onClick={() => setReturning(true)}>
              <Icon name="undo" size={15} /> Return items
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setCancelling(true)}>
              <Icon name="ban" size={15} /> Cancel invoice
            </Button>
          ) : null}
          <Link href="/pos">
            <Button><Icon name="pos" size={15} /> New sale</Button>
          </Link>
        </div>
      </div>

      <div className="no-print space-y-2">
        {params.get('replay') ? (
          <div className="mc-anim-fade-in rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800">
            This sale was already posted — showing the original invoice (no duplicate created).
          </div>
        ) : null}
        {params.get('change') && !cancelled ? (
          <div className="mc-anim-pop flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <span className="text-sm font-medium text-emerald-800">Give change</span>
            <span className="text-2xl font-bold tabular-nums text-emerald-700">{money(params.get('change'))}</span>
          </div>
        ) : null}
        {cancelled ? (
          <div className="mc-anim-fade-in rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-2.5 text-sm text-neutral-700">
            <span className="font-semibold">Cancelled</span>
            {inv.cancelledAt ? ` on ${fmtDate(inv.cancelledAt)}` : ''}
            {inv.cancelReason ? ` — ${inv.cancelReason}` : ''}. Stock was returned to the original batches and the sale journal reversed.
          </div>
        ) : null}
      </div>

      <article className="print-area mc-anim-fade-up relative overflow-hidden rounded-xl border border-neutral-200 bg-white p-6 text-[13px] leading-snug text-neutral-800 shadow-sm">
        {cancelled ? (
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 select-none rounded-lg border-4 border-red-300 px-6 py-2 text-5xl font-black uppercase tracking-widest text-red-300/70">
            Cancelled
          </span>
        ) : null}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-neutral-900">{s?.legalEntityName || s?.name}</h2>
            {address ? <p className="text-neutral-600">{address}</p> : null}
            <p className="text-neutral-600">
              {[s?.contactPhone && `Ph ${s.contactPhone}`, s?.contactEmail].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 font-mono text-xs">
              GSTIN {s?.gstin ?? 'Unregistered'} {s?.stateCode ? `· State ${s.stateCode}` : ''}
            </p>
            {s?.licences.length ? (
              <p className="font-mono text-[11px] text-neutral-500">{s.licences.map((l) => `${l.licenceType.replace(/_/g, ' ')}: ${l.licenceNumber}`).join(' · ')}</p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-base font-bold uppercase tracking-widest text-brand-700">{s?.gstin ? 'Tax invoice' : 'Bill of supply'}</p>
            <p className="font-mono font-semibold">{inv.invoiceNumber}</p>
            <p className="text-neutral-600">{new Date(inv.invoiceDate).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}</p>
            {inv.warehouse ? <p className="thermal-hide text-xs text-neutral-500">{inv.warehouse.branch.name}</p> : null}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 border-b border-neutral-200 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Billed to</p>
            <p className="font-medium">{inv.customer?.name ?? inv.walkInName ?? 'Walk-in customer'}</p>
            {inv.customer?.addressLine1 ? <p className="text-neutral-600">{[inv.customer.addressLine1, inv.customer.city].filter(Boolean).join(', ')}</p> : null}
            {inv.customer?.phone ? <p className="text-neutral-600">Ph {inv.customer.phone}</p> : null}
            {inv.customer?.gstin ? <p className="font-mono text-xs">GSTIN {inv.customer.gstin}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Place of supply</p>
            <p>{inv.customer?.stateCode ?? s?.stateCode ?? '—'}</p>
            <p className="text-xs text-neutral-500">{interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</p>
          </div>
        </section>

        <table className="mt-3 w-full text-left text-[12px]">
          <thead className="border-b border-neutral-300 text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="thermal-hide py-1.5 pr-2">HSN</th>
              <th className="thermal-hide py-1.5 pr-2">Batch · Exp</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              <th className="py-1.5 pr-2 text-right">Rate</th>
              <th className="thermal-hide py-1.5 pr-2 text-right">Disc</th>
              <th className="thermal-hide py-1.5 pr-2 text-right">Taxable</th>
              <th className="thermal-hide py-1.5 pr-2 text-right">GST</th>
              <th className="py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {inv.lines.map((l, i) => (
              <tr key={l.id} className="align-top">
                <td className="py-1.5 pr-2 text-neutral-400">{i + 1}</td>
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{l.productName}</span>
                  {l.product.prescriptionClass && l.product.prescriptionClass !== 'OTC' ? (
                    <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">{l.product.prescriptionClass === 'SCHEDULE_H1' ? 'H1' : 'Rx'}</span>
                  ) : null}
                  {n(l.returnedQty) > 0 ? <span className="ml-1 text-[10px] text-red-600">returned {qty(l.returnedQty)}</span> : null}
                </td>
                <td className="thermal-hide py-1.5 pr-2 font-mono text-[11px]">{l.hsnCode ?? l.product.hsnCode ?? '—'}</td>
                <td className="thermal-hide py-1.5 pr-2 text-[11px] text-neutral-600">
                  {l.batchAllocations.map((a, j) => (
                    <div key={j}>
                      {a.batch.batchNumber} · {new Date(a.batch.expiryDate).toLocaleDateString('en-IN', { month: '2-digit', year: '2-digit' })}
                      {l.batchAllocations.length > 1 ? ` (${qty(a.quantity)})` : ''}
                    </div>
                  ))}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{qty(l.quantity)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.unitPrice, false)}</td>
                <td className="thermal-hide py-1.5 pr-2 text-right tabular-nums">{n(l.discountAmount) > 0 ? money(l.discountAmount, false) : '—'}</td>
                <td className="thermal-hide py-1.5 pr-2 text-right tabular-nums">{money(l.taxableValue, false)}</td>
                <td className="thermal-hide py-1.5 pr-2 text-right tabular-nums">{n(l.taxRatePercent)}%</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{money(l.lineTotal, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-4 grid gap-4 border-t border-neutral-200 pt-3 sm:grid-cols-2">
          <div className="thermal-hide">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">HSN-wise tax summary</p>
            <table className="w-full text-[11px]">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-0.5 text-left font-medium">HSN</th>
                  <th className="py-0.5 text-right font-medium">Rate</th>
                  <th className="py-0.5 text-right font-medium">Taxable</th>
                  {interState ? <th className="py-0.5 text-right font-medium">IGST</th> : (
                    <>
                      <th className="py-0.5 text-right font-medium">CGST</th>
                      <th className="py-0.5 text-right font-medium">SGST</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {hsnSummary.map((h) => (
                  <tr key={`${h.hsn}-${h.rate}`} className="tabular-nums">
                    <td className="py-0.5 font-mono">{h.hsn}</td>
                    <td className="py-0.5 text-right">{n(h.rate)}%</td>
                    <td className="py-0.5 text-right">{money(h.taxable, false)}</td>
                    {interState ? <td className="py-0.5 text-right">{money(h.igst, false)}</td> : (
                      <>
                        <td className="py-0.5 text-right">{money(h.cgst, false)}</td>
                        <td className="py-0.5 text-right">{money(h.sgst, false)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="space-y-0.5 tabular-nums">
            {n(inv.discountAmount) > 0 ? (
              <div className="flex justify-between text-neutral-600"><dt>Discount</dt><dd>−{money(inv.discountAmount)}</dd></div>
            ) : null}
            <div className="flex justify-between text-neutral-600"><dt>Taxable value</dt><dd>{money(inv.taxableValue)}</dd></div>
            {interState ? (
              <div className="flex justify-between text-neutral-600"><dt>IGST</dt><dd>{money(inv.igstAmount)}</dd></div>
            ) : (
              <>
                <div className="flex justify-between text-neutral-600"><dt>CGST</dt><dd>{money(inv.cgstAmount)}</dd></div>
                <div className="flex justify-between text-neutral-600"><dt>SGST</dt><dd>{money(inv.sgstAmount)}</dd></div>
              </>
            )}
            {n(inv.cessAmount) > 0 ? <div className="flex justify-between text-neutral-600"><dt>Cess</dt><dd>{money(inv.cessAmount)}</dd></div> : null}
            <div className="flex justify-between text-neutral-600"><dt>Round off</dt><dd>{money(inv.roundOff)}</dd></div>
            <div className="flex justify-between border-t border-neutral-300 pt-1 text-base font-bold text-neutral-900"><dt>Total</dt><dd>{money(inv.total)}</dd></div>
            <p className="pt-0.5 text-right text-[11px] italic text-neutral-500">{amountInWords(inv.total)}</p>
          </dl>
        </section>

        <section className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-neutral-200 pt-2 text-[12px]">
          <span className="text-neutral-500">Paid:</span>
          {inv.payments.map((p) => (
            <span key={p.id}>
              {p.method} {money(p.amount)}
              {p.reference ? <span className="text-neutral-400"> ({p.reference})</span> : null}
            </span>
          ))}
          {n(inv.creditAmount) > 0 ? <span className="font-medium text-amber-700">Balance due {money(inv.creditAmount)}</span> : null}
        </section>

        {inv.prescriptions.length ? (
          <section className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-[12px]">
            <p className="font-semibold text-amber-800">Schedule H1 — prescription record</p>
            <p>
              Patient: {inv.prescriptions[0]!.patientName}
              {inv.prescriptions[0]!.patientPhone ? ` (${inv.prescriptions[0]!.patientPhone})` : ''} · Prescriber: {inv.prescriptions[0]!.prescriberName}
              {inv.prescriptions[0]!.prescriberRegNo ? `, Reg. ${inv.prescriptions[0]!.prescriberRegNo}` : ''}, {inv.prescriptions[0]!.prescriberAddress}
            </p>
            <ul className="mt-1 list-inside list-disc text-neutral-700">
              {inv.prescriptions.map((p) => (
                <li key={p.id}>
                  {p.drugName} × {qty(p.quantity)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {inv.returns.length ? (
          <section className="mt-3 border-t border-neutral-200 pt-2 text-[12px]">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Credit notes</p>
            {inv.returns.map((r) => (
              <div key={r.id} className="flex justify-between">
                <span>
                  <span className="font-mono">{r.returnNumber}</span> · {fmtDate(r.createdAt)} · {r.reason}
                </span>
                <span className="tabular-nums">−{money(r.refundTotal)}</span>
              </div>
            ))}
          </section>
        ) : null}

        <footer className="mt-6 flex items-end justify-between border-t border-neutral-200 pt-3 text-[11px] text-neutral-500">
          <p>Computer-generated invoice. Prices inclusive of GST. Medicines sold on valid prescription where required.</p>
          <p className="thermal-hide text-right">
            For {s?.legalEntityName || s?.name}
            <br />
            <span className="mt-6 inline-block border-t border-neutral-300 pt-0.5">Registered pharmacist</span>
          </p>
        </footer>
      </article>

      {timeline.length ? (
        <section className="no-print mc-anim-fade-up rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">Payment timeline</h2>
          <ol className="relative space-y-3 border-l border-neutral-200 pl-5">
            {timeline.map((t) => (
              <li key={t.key} className="mc-anim-fade-up relative">
                <span
                  className={cn(
                    'absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-white',
                    t.tone === 'green' ? 'bg-emerald-500' : t.tone === 'amber' ? 'bg-amber-500' : t.tone === 'red' ? 'bg-red-500' : 'bg-neutral-400',
                  )}
                />
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-neutral-800">{t.label}</span>
                  <span className="tabular-nums text-neutral-900">{t.amount.startsWith('-') ? `−${money(t.amount.slice(1))}` : money(t.amount)}</span>
                </div>
                <p className="text-xs text-neutral-500">
                  {new Date(t.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {t.note ? ` · ${t.note}` : ''}
                </p>
              </li>
            ))}
          </ol>
          {n(inv.creditAmount) > 0 && !cancelled ? <p className="mt-3 text-xs font-medium text-amber-700">Balance due {money(inv.creditAmount)}</p> : null}
        </section>
      ) : null}

      {returning ? (
        <ReturnDrawer
          invoice={inv}
          onClose={() => setReturning(false)}
          onDone={() => {
            setReturning(false);
            refreshAll();
          }}
        />
      ) : null}
      {receiving ? (
        <ReceiveBalanceDrawer
          invoice={inv}
          onClose={() => setReceiving(false)}
          onDone={() => {
            setReceiving(false);
            refreshAll();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={cancelling}
        tone="danger"
        title={`Cancel ${inv.invoiceNumber}?`}
        message={`Use this only for a bill raised in error this month. ${money(inv.total)} of stock goes back to its batches and the accounting entry is reversed. For goods returned by the customer, use Return items instead.`}
        confirmLabel="Cancel invoice"
        busy={cancel.isPending}
        reason={{ label: 'Reason for cancellation', minLength: 5, placeholder: 'e.g. Billed to the wrong patient' }}
        onCancel={() => setCancelling(false)}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
    </div>
  );
}

export default function InvoicePage() {
  return (
    <Suspense fallback={null}>
      <InvoiceView />
    </Suspense>
  );
}
