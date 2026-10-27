'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { amountInWords } from '@/lib/words';
import { Badge, Button, Drawer, ErrorBanner, ErrorState, Field, Input, Select, SkeletonRows, SuccessBanner, cn, fmtDate, money } from '@/components/ui';

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
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
  prescriptions: Array<{ id: string; patientName: string; prescriberName: string; prescriberAddress: string; drugName: string; quantity: string }>;
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

function ReturnDrawer({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: (msg: string) => void }) {
  const returnable = invoice.lines.map((l) => ({ line: l, max: n(l.quantity) - n(l.returnedQty) })).filter((r) => r.max > 0);
  const [rows, setRows] = useState<Record<string, { qty: string; restock: boolean }>>(
    Object.fromEntries(returnable.map((r) => [r.line.id, { qty: '', restock: true }])),
  );
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK'>('CASH');
  const selected = returnable.filter((r) => n(rows[r.line.id]?.qty || 0) > 0);
  const invalid = selected.some((r) => n(rows[r.line.id]!.qty) > r.max);
  const estimate = selected.reduce((s, r) => s + (n(r.line.lineTotal) / n(r.line.quantity)) * n(rows[r.line.id]!.qty), 0);
  const openCredit = n(invoice.creditAmount);

  const submit = useMutation({
    meta: { success: 'Credit note issued' },
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
    onSuccess: (r) => onDone(`Credit note ${r.returnNumber} issued for ${money(r.refundTotal)}.`),
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
                  <Input
                    className="w-20 text-right"
                    inputMode="numeric"
                    placeholder={`≤ ${max}`}
                    value={r.qty}
                    onChange={(e) => setRows((s) => ({ ...s, [line.id]: { ...r, qty: e.target.value.replace(/[^\d.]/g, '') } }))}
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
              {over ? <p className="mt-1 text-xs font-medium text-red-600">Only {max} can be returned.</p> : null}
            </div>
          );
        })}
      </div>
      <Field label="Reason *">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong strength dispensed" />
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
      {submit.error ? <ErrorBanner>{submit.error instanceof ApiClientError ? submit.error.message : 'Return failed'}</ErrorBanner> : null}
      <div className="flex gap-2">
        <Button disabled={selected.length === 0 || invalid || reason.trim().length < 3 || submit.isPending} onClick={() => submit.mutate()}>
          {submit.isPending ? 'Posting…' : 'Issue credit note'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Drawer>
  );
}

function InvoiceView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const canReturn = Boolean(membership && (membership.isOwner || membership.permissions.includes('returns.create')));
  const [returning, setReturning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api<InvoiceDetail>(`/sales/invoices/${id}`), retry: false });

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
            ← Sales
          </Link>
          <h1 className="font-mono text-lg font-semibold tracking-tight">{inv.invoiceNumber}</h1>
          <Badge tone={STATUS_TONE[inv.status] ?? 'neutral'}>{inv.status.replace('_', ' ').toLowerCase()}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => printAs('a4')}>
            ⎙ Print A4
          </Button>
          <Button variant="secondary" onClick={() => printAs('thermal')}>
            ⎙ Thermal 80mm
          </Button>
          {canReturn && !fullyReturned ? (
            <Button variant="secondary" onClick={() => setReturning(true)}>
              ↩ Return items
            </Button>
          ) : null}
          <Link href="/pos">
            <Button>⌁ New sale</Button>
          </Link>
        </div>
      </div>

      <div className="no-print space-y-2">
        {params.get('posted') ? (
          <SuccessBanner>
            {params.get('replay') ? 'This sale was already posted — showing the original invoice (no duplicate created).' : `Invoice ${inv.invoiceNumber} posted.`}
            {params.get('change') ? ` Give change ${money(params.get('change'))}.` : ''}
          </SuccessBanner>
        ) : null}
        {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      </div>

      <article className="print-area mc-anim-fade-up rounded-xl border border-neutral-200 bg-white p-6 text-[13px] leading-snug text-neutral-800 shadow-sm">
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
              Patient: {inv.prescriptions[0]!.patientName} · Prescriber: {inv.prescriptions[0]!.prescriberName}, {inv.prescriptions[0]!.prescriberAddress}
            </p>
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

      {returning ? (
        <ReturnDrawer
          invoice={inv}
          onClose={() => setReturning(false)}
          onDone={(msg) => {
            setReturning(false);
            setNotice(msg);
            void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
            void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
            void queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
          }}
        />
      ) : null}
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
