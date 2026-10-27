'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
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

// ── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string;
  legalName: string;
  status: string;
  stateCode: string | null;
  creditDays: number;
}
interface Product {
  id: string;
  name: string;
  sku: string;
  purchasePrice: string | null;
  mrp: string | null;
  taxResolved?: boolean;
  gstPercent?: string | null;
}
interface POLine {
  id: string;
  productId: string;
  quantity: string;
  receivedQty: string;
  unitPrice: string;
  product: { name: string; sku: string; mrp: string | null };
}
interface PORow {
  id: string;
  poNumber: string;
  status: string;
  vendorId: string;
  expectedDate: string | null;
  createdAt: string;
  vendor: { legalName: string };
  lines: POLine[];
  receipts: Array<{ id: string; grnNumber: string }>;
}
interface GRNRow {
  id: string;
  grnNumber: string;
  vendorId: string;
  receivedDate: string;
  vendor: { legalName: string };
  po: { poNumber: string } | null;
  invoices: Array<{ id: string; invoiceNumber: string }>;
  lines: Array<{ id: string; productId: string; batchNumber: string; expiryDate: string; quantity: string; freeQuantity: string; purchaseRate: string; mrp: string; product: { name: string; sku: string } }>;
}
interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  vendorId: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  status: string;
  vendor: { legalName: string };
  grn: { grnNumber: string } | null;
  lines: Array<{ productId: string; quantity: string; product: { name: string } }>;
}
interface PaymentRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  method: string;
  reference: string | null;
  vendor: { legalName: string };
  allocations: Array<{ amount: string; invoice: { invoiceNumber: string } }>;
}
interface ReturnRow {
  id: string;
  returnNumber: string;
  reason: string;
  total: string;
  taxAmount: string;
  createdAt: string;
  vendor: { legalName: string };
  lines: Array<{ quantity: string; batch: { batchNumber: string; product: { name: string } } }>;
}
interface VendorLedger {
  outstanding: string;
  openInvoices: Array<{ id: string; invoiceNumber: string; invoiceDate: string; dueDate: string; total: string; paid: string; outstanding: string; daysOverdue: number }>;
}

type Tab = 'orders' | 'receipts' | 'invoices' | 'payments' | 'returns';

const PO_TONE: Record<string, 'neutral' | 'blue' | 'amber' | 'green' | 'red'> = {
  DRAFT: 'neutral',
  SENT: 'blue',
  CONFIRMED: 'blue',
  PARTIALLY_RECEIVED: 'amber',
  RECEIVED: 'green',
  CANCELLED: 'red',
};
const INV_TONE: Record<string, 'neutral' | 'blue' | 'amber' | 'green' | 'red'> = { PENDING: 'neutral', POSTED: 'blue', PARTIALLY_PAID: 'amber', PAID: 'green', CANCELLED: 'red' };
const errMsg = (e: unknown, fallback: string) => {
  if (e instanceof ApiClientError) return e.details?.length ? `${e.message}: ${e.details.map((d) => d.message).join('; ')}` : e.message;
  return fallback;
};
const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const QTY = /^\d+(\.\d{1,3})?$/;
const RATE = /^\d+(\.\d{1,4})?$/;

// ── Shared data hooks ────────────────────────────────────────────────────────

function useMasters() {
  const vendors = useQuery({ queryKey: ['vendor-options'], queryFn: () => api<{ items: Vendor[] }>('/partners/vendors?page=1&pageSize=200') });
  const products = useQuery({ queryKey: ['purchase-products'], queryFn: () => api<{ items: Product[] }>('/catalog/products?page=1&pageSize=200&status=ACTIVE') });
  const warehouses = useQuery({
    queryKey: ['warehouses-labelled'],
    queryFn: async () => {
      const branches = await api<Array<{ name: string; warehouses: Array<{ id: string; name: string }> }>>('/organizations/branches');
      return branches.flatMap((b) => b.warehouses.map((w) => ({ id: w.id, label: `${b.name} · ${w.name}` })));
    },
  });
  return {
    vendors: (vendors.data?.items ?? []).filter((v) => v.status === 'ACTIVE'),
    products: products.data?.items ?? [],
    warehouses: warehouses.data ?? [],
  };
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['purchase-orders', 'goods-receipts', 'purchase-invoices', 'supplier-payments', 'purchase-returns', 'vendor-ledger', 'batches', 'batch-options', 'dashboard']) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

// ── Purchase order ───────────────────────────────────────────────────────────

function NewPOCard({ onDone }: { onDone: (msg: string) => void }) {
  const { vendors, products } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; unitPrice: string }>>([]);
  const [pick, setPick] = useState('');
  const total = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0);
  const valid = vendorId && lines.length > 0 && lines.every((l) => QTY.test(l.quantity) && num(l.quantity) > 0 && RATE.test(l.unitPrice) && num(l.unitPrice) > 0);

  const create = useMutation({
    meta: { success: 'Purchase order created' },
    mutationFn: () => api<{ poNumber: string }>('/purchasing/purchase-orders', { method: 'POST', body: { vendorId, expectedDate: expectedDate || null, lines } }),
    onSuccess: (po) => {
      setLines([]);
      setVendorId('');
      setExpectedDate('');
      invalidate();
      onDone(`Purchase order ${po.poNumber} created as draft — send it to the vendor next.`);
    },
  });

  return (
    <Card title="New purchase order">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Vendor">
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Expected delivery">
          <Input type="date" min={todayIso()} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
        <Field label="Add product">
          <Select
            value={pick}
            onChange={(e) => {
              const p = products.find((x) => x.id === e.target.value);
              if (p && !lines.some((l) => l.productId === p.id)) setLines((s) => [...s, { productId: p.id, quantity: '', unitPrice: p.purchasePrice ? num(p.purchasePrice).toFixed(2) : '' }]);
              setPick('');
            }}
          >
            <option value="">Select product…</option>
            {products.filter((p) => !lines.some((l) => l.productId === p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end justify-end text-sm text-neutral-500">
          {lines.length ? <span>Estimated <span className="font-semibold text-neutral-900">{money(total)}</span> + GST</span> : null}
        </div>
      </div>
      {lines.length ? (
        <div className="mt-3 space-y-2">
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === l.productId);
            return (
              <div key={l.productId} className="mc-anim-fade-up flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
                <span className="flex-1 text-sm">
                  <span className="font-medium">{p?.name}</span> <span className="font-mono text-xs text-neutral-400">{p?.sku}</span>
                </span>
                <Input className="w-24 text-right" placeholder="Qty" inputMode="decimal" value={l.quantity} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <Input className="w-28 text-right" placeholder="Rate ₹" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                <span className="w-24 text-right text-sm tabular-nums">{money(num(l.quantity) * num(l.unitPrice))}</span>
                <Button variant="ghost" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>✕</Button>
              </div>
            );
          })}
        </div>
      ) : null}
      {create.error ? <div className="mt-3"><ErrorBanner>{errMsg(create.error, 'Failed to create PO')}</ErrorBanner></div> : null}
      <div className="mt-3">
        <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create PO (draft)'}</Button>
      </div>
    </Card>
  );
}

// ── Goods receipt drawer ─────────────────────────────────────────────────────

interface BatchDraft {
  key: string;
  productId: string;
  poLineId: string | null;
  batchNumber: string;
  expiryDate: string;
  manufacturingDate: string;
  quantity: string;
  freeQuantity: string;
  purchaseRate: string;
  mrp: string;
}

function GrnDrawer({ po, onClose, onDone }: { po: PORow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const { vendors, products, warehouses } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState(po?.vendorId ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const blank = (productId: string, poLineId: string | null, rate: string, mrp: string, qty = ''): BatchDraft => ({
    key: `${productId}-${Math.random().toString(36).slice(2, 8)}`,
    productId,
    poLineId,
    batchNumber: '',
    expiryDate: '',
    manufacturingDate: '',
    quantity: qty,
    freeQuantity: '',
    purchaseRate: rate,
    mrp,
  });
  const [rows, setRows] = useState<BatchDraft[]>(() =>
    po
      ? po.lines
          .filter((l) => num(l.quantity) > num(l.receivedQty))
          .map((l) => blank(l.productId, l.id, num(l.unitPrice).toFixed(2), l.product.mrp ? num(l.product.mrp).toFixed(2) : '', String(num(l.quantity) - num(l.receivedQty))))
      : [],
  );
  const [pick, setPick] = useState('');
  const wh = warehouseId || warehouses[0]?.id || '';
  const today = todayIso();
  const update = (key: string, patch: Partial<BatchDraft>) => setRows((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remainingFor = (poLineId: string | null) => {
    if (!po || !poLineId) return null;
    const l = po.lines.find((x) => x.id === poLineId)!;
    return num(l.quantity) - num(l.receivedQty);
  };
  const receivingFor = (poLineId: string | null) => rows.filter((r) => r.poLineId === poLineId).reduce((s, r) => s + num(r.quantity), 0);
  const rowIssue = (r: BatchDraft): string | null => {
    if (!r.batchNumber.trim()) return 'Batch number required';
    if (!r.expiryDate) return 'Expiry required';
    if (r.expiryDate <= today) return 'Batch is already expired';
    if (!QTY.test(r.quantity) || num(r.quantity) <= 0) return 'Quantity required';
    if (r.freeQuantity && !QTY.test(r.freeQuantity)) return 'Invalid free quantity';
    if (!RATE.test(r.purchaseRate) || !RATE.test(r.mrp) || num(r.mrp) <= 0) return 'Rate and MRP required';
    if (num(r.purchaseRate) > num(r.mrp)) return 'Purchase rate above MRP';
    const rem = remainingFor(r.poLineId);
    if (rem !== null && receivingFor(r.poLineId) > rem) return `Exceeds open PO quantity (${rem})`;
    return null;
  };
  const issues = rows.map(rowIssue);
  const valid = vendorId && wh && rows.length > 0 && issues.every((x) => x === null);
  const value = rows.reduce((s, r) => s + num(r.quantity) * num(r.purchaseRate), 0);

  const submit = useMutation({
    meta: { success: 'Goods received' },
    mutationFn: () =>
      api<{ grnNumber: string }>('/purchasing/goods-receipts', {
        method: 'POST',
        body: {
          vendorId,
          poId: po?.id ?? null,
          warehouseId: wh,
          notes: notes.trim() || null,
          lines: rows.map((r) => ({
            productId: r.productId,
            poLineId: r.poLineId,
            batchNumber: r.batchNumber.trim(),
            expiryDate: r.expiryDate,
            manufacturingDate: r.manufacturingDate || null,
            quantity: r.quantity,
            ...(r.freeQuantity ? { freeQuantity: r.freeQuantity } : {}),
            purchaseRate: r.purchaseRate,
            mrp: r.mrp,
          })),
        },
      }),
    onSuccess: (g) => {
      invalidate();
      onDone(`Goods receipt ${g.grnNumber} posted — stock is now available in batch inventory.`);
    },
  });

  const grouped = useMemo(() => {
    const order: string[] = [];
    for (const r of rows) {
      const k = `${r.productId}|${r.poLineId ?? ''}`;
      if (!order.includes(k)) order.push(k);
    }
    return order.map((k) => ({ k, items: rows.filter((r) => `${r.productId}|${r.poLineId ?? ''}` === k) }));
  }, [rows]);

  return (
    <Drawer open onClose={onClose} width="max-w-5xl" title={po ? `Receive goods · ${po.poNumber}` : 'Receive goods (direct)'} subtitle="Capture each batch with expiry and MRP. Split a line into several batches if the supplier shipped more than one.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <Select value={vendorId} disabled={Boolean(po)} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Receive into">
          <Select value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery challan no., remarks" />
        </Field>
      </div>

      {!po ? (
        <Field label="Add product">
          <Select
            value={pick}
            onChange={(e) => {
              const p = products.find((x) => x.id === e.target.value);
              if (p) setRows((s) => [...s, blank(p.id, null, p.purchasePrice ? num(p.purchasePrice).toFixed(2) : '', p.mrp ? num(p.mrp).toFixed(2) : '')]);
              setPick('');
            }}
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>
            ))}
          </Select>
        </Field>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={po ? 'Everything on this PO has been received' : 'Add products to receive'} />
      ) : (
        <div className="space-y-3">
          {grouped.map(({ k, items }) => {
            const first = items[0]!;
            const p = products.find((x) => x.id === first.productId);
            const poLine = po?.lines.find((l) => l.id === first.poLineId);
            const rem = remainingFor(first.poLineId);
            const receiving = receivingFor(first.poLineId);
            return (
              <div key={k} className="rounded-xl border border-neutral-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/70 px-3 py-2">
                  <span className="text-sm font-medium">
                    {poLine?.product.name ?? p?.name} <span className="font-mono text-xs text-neutral-400">{poLine?.product.sku ?? p?.sku}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-neutral-500">
                    {rem !== null ? (
                      <span className={cn(receiving < rem && 'text-amber-700', receiving > rem && 'font-semibold text-red-600')}>
                        Ordered {num(poLine!.quantity)} · received {num(poLine!.receivedQty)} · receiving {receiving} of {rem} open
                        {receiving < rem ? ' (partial)' : ''}
                      </span>
                    ) : null}
                    <Button variant="ghost" className="py-1 text-xs" onClick={() => setRows((s) => [...s, blank(first.productId, first.poLineId, first.purchaseRate, first.mrp)])}>
                      + Batch
                    </Button>
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  {items.map((r) => {
                    const issue = rowIssue(r);
                    return (
                      <div key={r.key}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-8">
                          <Input className="sm:col-span-2" placeholder="Batch no." value={r.batchNumber} onChange={(e) => update(r.key, { batchNumber: e.target.value.toUpperCase() })} aria-label="Batch number" />
                          <Input type="date" title="Expiry" min={today} value={r.expiryDate} onChange={(e) => update(r.key, { expiryDate: e.target.value })} aria-label="Expiry date" />
                          <Input type="date" title="Mfg date (optional)" max={today} value={r.manufacturingDate} onChange={(e) => update(r.key, { manufacturingDate: e.target.value })} aria-label="Manufacturing date" />
                          <Input className="text-right" placeholder="Qty" inputMode="decimal" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} aria-label="Quantity" />
                          <Input className="text-right" placeholder="Free" inputMode="decimal" value={r.freeQuantity} onChange={(e) => update(r.key, { freeQuantity: e.target.value })} aria-label="Free quantity" />
                          <Input className="text-right" placeholder="Rate ₹" inputMode="decimal" value={r.purchaseRate} onChange={(e) => update(r.key, { purchaseRate: e.target.value })} aria-label="Purchase rate" />
                          <div className="flex gap-1">
                            <Input className="text-right" placeholder="MRP ₹" inputMode="decimal" value={r.mrp} onChange={(e) => update(r.key, { mrp: e.target.value })} aria-label="MRP" />
                            <Button variant="ghost" className="px-2" onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))} aria-label="Remove batch">✕</Button>
                          </div>
                        </div>
                        {issue && (r.batchNumber || r.expiryDate || r.quantity) ? <p className="mt-1 text-xs font-medium text-red-600">⚠ {issue}</p> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2.5 text-sm ring-1 ring-neutral-100">
        <span className="text-neutral-500">Receipt value at purchase rate (excl. GST)</span>
        <span className="font-semibold tabular-nums">{money(value)}</span>
      </div>
      {submit.error ? <ErrorBanner>{errMsg(submit.error, 'Failed to post receipt')}</ErrorBanner> : null}
      <div className="flex gap-2">
        <Button disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Posting…' : 'Post goods receipt'}</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Drawer>
  );
}

// ── Supplier invoice drawer ──────────────────────────────────────────────────

function InvoiceDrawer({ grn, onClose, onDone }: { grn: GRNRow | null; onClose: () => void; onDone: (msg: string) => void }) {
  const { vendors, products } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState(grn?.vendorId ?? '');
  const [grnId, setGrnId] = useState(grn?.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const fromGrn = (g: GRNRow) => {
    const by = new Map<string, { productId: string; quantity: number; freeQty: number; value: number }>();
    for (const l of g.lines) {
      const r = by.get(l.productId) ?? { productId: l.productId, quantity: 0, freeQty: 0, value: 0 };
      r.quantity += num(l.quantity);
      r.freeQty += num(l.freeQuantity);
      r.value += num(l.quantity) * num(l.purchaseRate);
      by.set(l.productId, r);
    }
    return [...by.values()].map((r) => ({ productId: r.productId, quantity: String(r.quantity), freeQty: r.freeQty ? String(r.freeQty) : '', unitCost: (r.value / r.quantity).toFixed(2) }));
  };
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; freeQty: string; unitCost: string }>>(grn ? fromGrn(grn) : []);
  const [pick, setPick] = useState('');
  const grns = useQuery({
    queryKey: ['goods-receipts', 'uninvoiced', vendorId],
    queryFn: () => api<{ items: GRNRow[] }>(`/purchasing/goods-receipts?page=1&pageSize=100&uninvoiced=true&vendorId=${vendorId}`),
    enabled: Boolean(vendorId),
  });
  const selectedGrn = grn ?? grns.data?.items.find((g) => g.id === grnId) ?? null;
  const receivedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of selectedGrn?.lines ?? []) m.set(l.productId, (m.get(l.productId) ?? 0) + num(l.quantity));
    return m;
  }, [selectedGrn]);
  const subtotal = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const gstEstimate = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost) * (num(products.find((p) => p.id === l.productId)?.gstPercent) / 100), 0);
  const mismatch = selectedGrn
    ? [...new Set([...receivedBy.keys(), ...lines.map((l) => l.productId)])].filter((pid) => (receivedBy.get(pid) ?? 0) !== lines.filter((l) => l.productId === pid).reduce((s, l) => s + num(l.quantity), 0))
    : [];
  const noRate = lines.filter((l) => products.find((p) => p.id === l.productId)?.taxResolved === false);
  const valid =
    vendorId && invoiceNumber.trim() && invoiceDate && invoiceDate <= todayIso() && lines.length > 0 &&
    lines.every((l) => QTY.test(l.quantity) && num(l.quantity) > 0 && RATE.test(l.unitCost) && (!l.freeQty || QTY.test(l.freeQty))) &&
    mismatch.length === 0 && noRate.length === 0;

  const submit = useMutation({
    meta: { success: 'Supplier invoice posted' },
    mutationFn: () =>
      api<{ invoiceNumber: string; total: string }>('/purchasing/invoices', {
        method: 'POST',
        body: {
          vendorId,
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          dueDate: dueDate || null,
          grnId: selectedGrn?.id ?? null,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(l.freeQty ? { freeQty: l.freeQty } : {}), unitCost: l.unitCost })),
        },
      }),
    onSuccess: (inv) => {
      invalidate();
      onDone(`Supplier invoice ${inv.invoiceNumber} posted for ${money(inv.total)} — inventory, input GST and payable booked.`);
    },
  });

  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title="Post supplier invoice" subtitle="Three-way match: billed quantities must equal what was received on the linked GRN. Costs are entered exclusive of GST.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <Select value={vendorId} disabled={Boolean(grn)} onChange={(e) => { setVendorId(e.target.value); setGrnId(''); setLines([]); }}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Against goods receipt">
          <Select
            value={selectedGrn?.id ?? ''}
            disabled={Boolean(grn) || !vendorId}
            onChange={(e) => {
              setGrnId(e.target.value);
              const g = grns.data?.items.find((x) => x.id === e.target.value);
              setLines(g ? fromGrn(g) : []);
            }}
          >
            <option value="">No GRN (direct bill)</option>
            {(grn ? [grn] : grns.data?.items ?? []).map((g) => (
              <option key={g.id} value={g.id}>{g.grnNumber} · {fmtDate(g.receivedDate)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier invoice no.">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="As printed on the bill" />
        </Field>
        <Field label="Invoice date">
          <Input type="date" max={todayIso()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Due date (blank = vendor credit days)">
          <Input type="date" min={invoiceDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {!selectedGrn ? (
          <Field label="Add product">
            <Select
              value={pick}
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value);
                if (p) setLines((s) => [...s, { productId: p.id, quantity: '', freeQty: '', unitCost: p.purchasePrice ? num(p.purchasePrice).toFixed(2) : '' }]);
                setPick('');
              }}
            >
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {lines.length ? (
        <Table head={<tr><Th>Product</Th>{selectedGrn ? <Th right>Received</Th> : null}<Th right>Billed qty</Th><Th right>Free</Th><Th right>Unit cost ₹</Th><Th right>Amount</Th><Th /></tr>}>
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === l.productId);
            const bad = mismatch.includes(l.productId);
            return (
              <Tr key={`${l.productId}-${i}`} className={bad ? 'bg-red-50/50' : undefined}>
                <Td>
                  <div className="text-sm font-medium">{p?.name ?? selectedGrn?.lines.find((x) => x.productId === l.productId)?.product.name}</div>
                  {p?.taxResolved === false ? <Badge tone="red">No GST rate</Badge> : p?.gstPercent ? <span className="text-xs text-neutral-500">GST {p.gstPercent}%</span> : null}
                </Td>
                {selectedGrn ? <Td right className="text-xs text-neutral-500">{receivedBy.get(l.productId) ?? 0}</Td> : null}
                <Td right><Input className="w-20 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></Td>
                <Td right><Input className="w-16 text-right" inputMode="decimal" value={l.freeQty} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, freeQty: e.target.value } : x)))} /></Td>
                <Td right><Input className="w-24 text-right" inputMode="decimal" value={l.unitCost} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} /></Td>
                <Td right>{money(num(l.quantity) * num(l.unitCost))}</Td>
                <Td right>{!selectedGrn ? <Button variant="ghost" className="px-2" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>✕</Button> : null}</Td>
              </Tr>
            );
          })}
        </Table>
      ) : (
        <EmptyState title="No lines yet" hint={vendorId ? 'Pick a goods receipt to prefill, or add products for a direct bill.' : 'Select the vendor first.'} />
      )}

      {mismatch.length ? <ErrorBanner>Billed quantities must match the goods receipt for every product.</ErrorBanner> : null}
      {noRate.length ? <ErrorBanner>Configure a GST rate for every product before posting (Configuration → Tax rates).</ErrorBanner> : null}
      <dl className="space-y-1 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm ring-1 ring-neutral-100">
        <div className="flex justify-between text-neutral-500"><dt>Taxable value</dt><dd className="tabular-nums">{money(subtotal)}</dd></div>
        <div className="flex justify-between text-neutral-500"><dt>Input GST (estimate)</dt><dd className="tabular-nums">{money(gstEstimate)}</dd></div>
        <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Invoice total (estimate)</dt><dd className="tabular-nums">{money(subtotal + gstEstimate)}</dd></div>
      </dl>
      {submit.error ? <ErrorBanner>{errMsg(submit.error, 'Failed to post invoice')}</ErrorBanner> : null}
      <div className="flex gap-2">
        <Button disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Posting…' : 'Post invoice'}</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Drawer>
  );
}

// ── Payments ─────────────────────────────────────────────────────────────────

function PaymentForm({ onDone }: { onDone: (msg: string) => void }) {
  const { vendors } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [method, setMethod] = useState<'BANK' | 'UPI' | 'CASH'>('BANK');
  const [reference, setReference] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const ledger = useQuery({
    queryKey: ['vendor-ledger', vendorId],
    queryFn: () => api<VendorLedger>(`/purchasing/vendors/${vendorId}/ledger`),
    enabled: Boolean(vendorId),
  });
  const open = ledger.data?.openInvoices ?? [];
  const entries = open.filter((i) => num(alloc[i.id]) > 0);
  const total = entries.reduce((s, i) => s + num(alloc[i.id]), 0);
  const over = open.some((i) => num(alloc[i.id]) > num(i.outstanding));
  const pay = useMutation({
    meta: { success: 'Payment recorded' },
    mutationFn: () =>
      api<{ paymentNumber: string }>('/purchasing/payments', {
        method: 'POST',
        body: {
          vendorId,
          amount: total.toFixed(2),
          method,
          reference: reference.trim() || null,
          allocations: entries.map((i) => ({ invoiceId: i.id, amount: num(alloc[i.id]).toFixed(2) })),
        },
      }),
    onSuccess: (p) => {
      setAlloc({});
      setReference('');
      invalidate();
      onDone(`Payment ${p.paymentNumber} of ${money(total)} recorded.`);
    },
  });

  return (
    <Card title="Pay supplier">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Vendor">
          <Select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setAlloc({}); }}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="BANK">Bank transfer / NEFT</option>
            <option value="UPI">UPI</option>
            <option value="CASH">Cash</option>
          </Select>
        </Field>
        <Field label="Reference">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
        </Field>
      </div>
      {vendorId ? (
        ledger.isLoading ? (
          <div className="mt-3"><SkeletonRows rows={3} cols={5} /></div>
        ) : open.length === 0 ? (
          <p className="mt-4 text-center text-sm text-neutral-500">No open invoices for this vendor. 🎉</p>
        ) : (
          <div className="mt-3">
            <Table head={<tr><Th>Invoice</Th><Th>Due</Th><Th right>Total</Th><Th right>Outstanding</Th><Th right>Pay now</Th></tr>}>
              {open.map((i) => (
                <Tr key={i.id}>
                  <Td className="font-mono text-xs font-medium">{i.invoiceNumber}</Td>
                  <Td className="text-xs">
                    {fmtDate(i.dueDate)} {i.daysOverdue > 0 ? <Badge tone="red">{i.daysOverdue}d overdue</Badge> : null}
                  </Td>
                  <Td right className="text-xs">{money(i.total)}</Td>
                  <Td right className="font-medium">{money(i.outstanding)}</Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1">
                      <Input className={cn('w-28 text-right', num(alloc[i.id]) > num(i.outstanding) && 'border-red-400')} inputMode="decimal" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
                      <Button variant="ghost" className="px-2 text-xs" onClick={() => setAlloc((s) => ({ ...s, [i.id]: i.outstanding }))}>Full</Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-sm text-neutral-500">
                Paying <span className="font-semibold text-neutral-900">{money(total)}</span> across {entries.length} invoice{entries.length === 1 ? '' : 's'} · vendor outstanding {money(ledger.data?.outstanding)}
              </span>
              <Button disabled={entries.length === 0 || over || pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? 'Recording…' : `Record payment ${money(total)}`}</Button>
            </div>
          </div>
        )
      ) : null}
      {over ? <div className="mt-2"><ErrorBanner>An allocation exceeds the invoice outstanding.</ErrorBanner></div> : null}
      {pay.error ? <div className="mt-2"><ErrorBanner>{errMsg(pay.error, 'Payment failed')}</ErrorBanner></div> : null}
    </Card>
  );
}

// ── Purchase return (debit note) ─────────────────────────────────────────────

function ReturnForm({ onDone }: { onDone: (msg: string) => void }) {
  const { vendors, products } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [productId, setProductId] = useState('');
  const [lines, setLines] = useState<Array<{ batchId: string; label: string; onHand: number; quantity: string; rate: string }>>([]);
  const invoices = useQuery({
    queryKey: ['purchase-invoices', 'vendor', vendorId],
    queryFn: () => api<{ items: InvoiceRow[] }>(`/purchasing/invoices?page=1&pageSize=100&vendorId=${vendorId}`),
    enabled: Boolean(vendorId),
  });
  const invoice = invoices.data?.items.find((i) => i.id === invoiceId);
  const productChoices = invoice ? products.filter((p) => invoice.lines.some((l) => l.productId === p.id)) : products;
  const batches = useQuery({
    queryKey: ['batches', 'return', productId],
    queryFn: () => api<{ items: Array<{ id: string; batchNumber: string; expiryDate: string; status: string; purchaseRate: string; balances: Array<{ quantity: string }> }> }>(`/inventory/batches?page=1&pageSize=100&productId=${productId}`),
    enabled: Boolean(productId),
  });
  const valid = vendorId && reason.trim().length >= 3 && lines.length > 0 && lines.every((l) => QTY.test(l.quantity) && num(l.quantity) > 0 && num(l.quantity) <= l.onHand && RATE.test(l.rate));
  const value = lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0);
  const submit = useMutation({
    meta: { success: 'Debit note posted' },
    mutationFn: () =>
      api<{ returnNumber: string; total: string }>('/purchasing/purchase-returns', {
        method: 'POST',
        body: { vendorId, invoiceId: invoiceId || null, reason: reason.trim(), lines: lines.map((l) => ({ batchId: l.batchId, quantity: l.quantity, rate: l.rate })) },
      }),
    onSuccess: (r) => {
      setLines([]);
      setReason('');
      setInvoiceId('');
      setProductId('');
      invalidate();
      onDone(`Debit note ${r.returnNumber} posted for ${money(r.total)} — stock removed, payable and input GST reduced.`);
    },
  });

  return (
    <Card title="Return to supplier (debit note)">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Vendor">
          <Select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setInvoiceId(''); setLines([]); }}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Against invoice (recommended)">
          <Select value={invoiceId} disabled={!vendorId} onChange={(e) => { setInvoiceId(e.target.value); setLines([]); setProductId(''); }}>
            <option value="">— none —</option>
            {invoices.data?.items.map((i) => (
              <option key={i.id} value={i.id}>{i.invoiceNumber} · {fmtDate(i.invoiceDate)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Product">
          <Select value={productId} disabled={!vendorId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select product…</option>
            {productChoices.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Batch">
          <Select
            value=""
            disabled={!productId}
            onChange={(e) => {
              const b = batches.data?.items.find((x) => x.id === e.target.value);
              if (!b || lines.some((l) => l.batchId === b.id)) return;
              const onHand = b.balances.reduce((s, x) => s + num(x.quantity), 0);
              const p = products.find((x) => x.id === productId);
              setLines((s) => [...s, { batchId: b.id, label: `${p?.name} · ${b.batchNumber} · exp ${fmtDate(b.expiryDate)}`, onHand, quantity: '', rate: num(b.purchaseRate).toFixed(2) }]);
            }}
          >
            <option value="">Select batch…</option>
            {batches.data?.items.map((b) => {
              const onHand = b.balances.reduce((s, x) => s + num(x.quantity), 0);
              return (
                <option key={b.id} value={b.id} disabled={onHand <= 0}>
                  {b.batchNumber} · exp {fmtDate(b.expiryDate)} · {onHand} on hand {b.status !== 'SALEABLE' ? `· ${b.status.toLowerCase()}` : ''}
                </option>
              );
            })}
          </Select>
        </Field>
      </div>
      {lines.length ? (
        <div className="mt-3 space-y-2">
          {lines.map((l, i) => (
            <div key={l.batchId} className="mc-anim-fade-up flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
              <span className="flex-1 text-sm">{l.label} <span className="text-xs text-neutral-400">({l.onHand} on hand)</span></span>
              <Input className={cn('w-20 text-right', num(l.quantity) > l.onHand && 'border-red-400')} placeholder="Qty" inputMode="decimal" value={l.quantity} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <Input className="w-24 text-right" placeholder="Rate ₹" inputMode="decimal" value={l.rate} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
              <span className="w-24 text-right text-sm tabular-nums">{money(num(l.quantity) * num(l.rate))}</span>
              <Button variant="ghost" onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <Field label="Reason *">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Near expiry / damaged in transit / recall" />
          </Field>
        </div>
        <div className="flex items-end justify-end text-sm text-neutral-500">Value {money(value)} + GST</div>
      </div>
      {submit.error ? <div className="mt-2"><ErrorBanner>{errMsg(submit.error, 'Return failed')}</ErrorBanner></div> : null}
      <div className="mt-3">
        <Button disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Posting…' : 'Post debit note'}</Button>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PurchasingPage() {
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const invalidate = useInvalidateAll();
  const [tab, setTab] = useState<Tab>('orders');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grnFor, setGrnFor] = useState<PORow | null | 'direct'>(null);
  const [billFor, setBillFor] = useState<GRNRow | null | 'direct'>(null);
  const done = (msg: string) => {
    setNotice(msg);
    setError(null);
    setGrnFor(null);
    setBillFor(null);
  };

  const pos = useQuery({ queryKey: ['purchase-orders'], queryFn: () => api<{ items: PORow[]; pageInfo: { totalItems: number } }>('/purchasing/purchase-orders?page=1&pageSize=100'), retry: false });
  const grns = useQuery({ queryKey: ['goods-receipts'], queryFn: () => api<{ items: GRNRow[]; pageInfo: { totalItems: number } }>('/purchasing/goods-receipts?page=1&pageSize=100'), retry: false });
  const invoices = useQuery({ queryKey: ['purchase-invoices'], queryFn: () => api<{ items: InvoiceRow[]; pageInfo: { totalItems: number } }>('/purchasing/invoices?page=1&pageSize=100'), retry: false });
  const payments = useQuery({ queryKey: ['supplier-payments'], queryFn: () => api<{ items: PaymentRow[]; pageInfo: { totalItems: number } }>('/purchasing/payments?page=1&pageSize=100'), enabled: tab === 'payments', retry: false });
  const returns = useQuery({ queryKey: ['purchase-returns'], queryFn: () => api<{ items: ReturnRow[]; pageInfo: { totalItems: number } }>('/purchasing/purchase-returns?page=1&pageSize=100'), enabled: tab === 'returns', retry: false });

  const poAction = useMutation({
    meta: { success: 'Purchase order updated' },
    mutationFn: (v: { poId: string; action: 'send' | 'confirm' | 'cancel' }) => api(`/purchasing/purchase-orders/${v.poId}/action`, { method: 'POST', body: { action: v.action } }),
    onSuccess: (_d, v) => {
      invalidate();
      setNotice(v.action === 'send' ? 'PO marked as sent to vendor.' : v.action === 'confirm' ? 'PO confirmed by vendor — ready to receive.' : 'PO cancelled.');
    },
    onError: (e) => setError(errMsg(e, 'Action failed')),
  });

  const awaitingBill = (grns.data?.items ?? []).filter((g) => g.invoices.length === 0).length;
  const openPayable = (invoices.data?.items ?? []).reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paidAmount)), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Purchasing"
        subtitle={
          <>
            PO → goods receipt (batch + expiry) → supplier invoice (three-way match) → payment. Open payables <span className="font-medium text-neutral-800">{money(openPayable)}</span>
            {awaitingBill ? <> · <span className="font-medium text-amber-700">{awaitingBill} receipt{awaitingBill === 1 ? '' : 's'} awaiting bill</span></> : null}
          </>
        }
        actions={
          <>
            {can('purchases.receive') ? <Button variant="secondary" onClick={() => setGrnFor('direct')}>⇣ Receive without PO</Button> : null}
            {can('purchases.receive') ? <Button onClick={() => setBillFor('direct')}>+ Supplier invoice</Button> : null}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => { setTab(t); setError(null); }}
        tabs={[
          { id: 'orders', label: 'Purchase orders', count: pos.data?.pageInfo.totalItems },
          { id: 'receipts', label: 'Goods receipts', count: grns.data?.pageInfo.totalItems },
          { id: 'invoices', label: 'Supplier invoices', count: invoices.data?.pageInfo.totalItems },
          { id: 'payments', label: 'Payments' },
          { id: 'returns', label: 'Debit notes' },
        ]}
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {tab === 'orders' ? (
        <>
          {can('purchases.create') ? <NewPOCard onDone={done} /> : null}
          <Card title="Purchase orders">
            {pos.isLoading ? (
              <SkeletonRows rows={4} cols={5} />
            ) : (pos.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No purchase orders" hint="Create a PO, send it to the vendor, then receive goods against it." />
            ) : (
              <Table head={<tr><Th>PO</Th><Th>Vendor</Th><Th>Progress</Th><Th>Status</Th><Th right>Actions</Th></tr>}>
                {pos.data?.items.map((p) => {
                  const ordered = p.lines.reduce((s, l) => s + num(l.quantity), 0);
                  const received = p.lines.reduce((s, l) => s + num(l.receivedQty), 0);
                  const pct = ordered ? Math.round((received / ordered) * 100) : 0;
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <div className="font-mono text-xs font-semibold">{p.poNumber}</div>
                        <div className="text-xs text-neutral-500">{fmtDate(p.createdAt)}{p.expectedDate ? ` · due ${fmtDate(p.expectedDate)}` : ''}</div>
                      </Td>
                      <Td className="text-sm">{p.vendor.legalName}</Td>
                      <Td>
                        <div className="text-xs text-neutral-600">{p.lines.map((l) => `${l.product.name} ${num(l.receivedQty)}/${num(l.quantity)}`).join(' · ')}</div>
                        <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                        </div>
                      </Td>
                      <Td><Badge tone={PO_TONE[p.status] ?? 'neutral'} dot>{p.status.replace('_', ' ').toLowerCase()}</Badge></Td>
                      <Td right>
                        <div className="flex justify-end gap-1.5">
                          {p.status === 'DRAFT' && can('purchases.approve') ? <Button variant="secondary" onClick={() => poAction.mutate({ poId: p.id, action: 'send' })}>Send</Button> : null}
                          {p.status === 'SENT' && can('purchases.approve') ? <Button variant="secondary" onClick={() => poAction.mutate({ poId: p.id, action: 'confirm' })}>Confirm</Button> : null}
                          {['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(p.status) && can('purchases.receive') ? <Button onClick={() => setGrnFor(p)}>Receive</Button> : null}
                          {['DRAFT', 'SENT', 'CONFIRMED'].includes(p.status) && can('purchases.approve') ? <Button variant="ghost" onClick={() => poAction.mutate({ poId: p.id, action: 'cancel' })}>Cancel</Button> : null}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'receipts' ? (
        <Card title="Goods receipts">
          {grns.isLoading ? (
            <SkeletonRows rows={4} cols={5} />
          ) : (grns.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No goods received yet" hint="Receive against a confirmed PO or directly from a vendor." />
          ) : (
            <Table head={<tr><Th>GRN</Th><Th>Vendor</Th><Th>Batches</Th><Th>Billing</Th><Th right /></tr>}>
              {grns.data?.items.map((g) => (
                <Tr key={g.id}>
                  <Td>
                    <div className="font-mono text-xs font-semibold">{g.grnNumber}</div>
                    <div className="text-xs text-neutral-500">{fmtDate(g.receivedDate)}{g.po ? ` · ${g.po.poNumber}` : ' · direct'}</div>
                  </Td>
                  <Td className="text-sm">{g.vendor.legalName}</Td>
                  <Td className="text-xs text-neutral-600">
                    {g.lines.map((l) => (
                      <div key={l.id}>
                        {l.product.name} · <span className="font-mono">{l.batchNumber}</span> · exp {fmtDate(l.expiryDate)} · {num(l.quantity)}{num(l.freeQuantity) ? ` + ${num(l.freeQuantity)} free` : ''}
                      </div>
                    ))}
                  </Td>
                  <Td>{g.invoices.length ? <Badge tone="green">Billed · {g.invoices[0]!.invoiceNumber}</Badge> : <Badge tone="amber" dot>Awaiting bill</Badge>}</Td>
                  <Td right>{!g.invoices.length && can('purchases.receive') ? <Button variant="secondary" onClick={() => setBillFor(g)}>Post bill</Button> : null}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      ) : null}

      {tab === 'invoices' ? (
        <Card title="Supplier invoices">
          {invoices.isLoading ? (
            <SkeletonRows rows={4} cols={6} />
          ) : (invoices.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No supplier invoices" hint="Posted invoices book inventory, input GST credit and the payable." />
          ) : (
            <Table head={<tr><Th>Invoice</Th><Th>Vendor</Th><Th>GRN</Th><Th right>Taxable</Th><Th right>GST</Th><Th right>Total</Th><Th right>Outstanding</Th><Th>Status</Th></tr>}>
              {invoices.data?.items.map((i) => {
                const out = num(i.total) - num(i.paidAmount);
                const overdue = out > 0 && new Date(i.dueDate).getTime() < Date.now();
                return (
                  <Tr key={i.id}>
                    <Td>
                      <div className="font-mono text-xs font-semibold">{i.invoiceNumber}</div>
                      <div className={cn('text-xs', overdue ? 'font-medium text-red-600' : 'text-neutral-500')}>{fmtDate(i.invoiceDate)} · due {fmtDate(i.dueDate)}</div>
                    </Td>
                    <Td className="text-sm">{i.vendor.legalName}</Td>
                    <Td className="font-mono text-xs">{i.grn?.grnNumber ?? '—'}</Td>
                    <Td right className="text-xs">{money(i.subtotal)}</Td>
                    <Td right className="text-xs">{money(i.taxAmount)}</Td>
                    <Td right className="font-semibold">{money(i.total)}</Td>
                    <Td right className={out > 0 ? 'font-medium text-amber-700' : 'text-neutral-400'}>{out > 0 ? money(out) : '—'}</Td>
                    <Td><Badge tone={INV_TONE[i.status] ?? 'neutral'} dot>{i.status.replace('_', ' ').toLowerCase()}</Badge></Td>
                  </Tr>
                );
              })}
            </Table>
          )}
        </Card>
      ) : null}

      {tab === 'payments' ? (
        <>
          {can('purchases.pay') ? <PaymentForm onDone={done} /> : null}
          <Card title="Payment history">
            {payments.isLoading ? (
              <SkeletonRows rows={3} cols={5} />
            ) : (payments.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No supplier payments yet" />
            ) : (
              <Table head={<tr><Th>Payment</Th><Th>Vendor</Th><Th>Method</Th><Th>Applied to</Th><Th right>Amount</Th></tr>}>
                {payments.data?.items.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <div className="font-mono text-xs font-semibold">{p.paymentNumber}</div>
                      <div className="text-xs text-neutral-500">{fmtDate(p.paymentDate)}</div>
                    </Td>
                    <Td className="text-sm">{p.vendor.legalName}</Td>
                    <Td className="text-xs">{p.method}{p.reference ? ` · ${p.reference}` : ''}</Td>
                    <Td className="text-xs text-neutral-600">{p.allocations.map((a) => `${a.invoice.invoiceNumber} ${money(a.amount)}`).join(', ')}</Td>
                    <Td right className="font-semibold">{money(p.amount)}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'returns' ? (
        <>
          {can('purchases.pay') ? <ReturnForm onDone={done} /> : null}
          <Card title="Debit notes">
            {returns.isLoading ? (
              <SkeletonRows rows={3} cols={5} />
            ) : (returns.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No purchase returns yet" hint="Return near-expiry, damaged or recalled stock to the supplier." />
            ) : (
              <Table head={<tr><Th>Debit note</Th><Th>Vendor</Th><Th>Items</Th><Th>Reason</Th><Th right>GST</Th><Th right>Total</Th></tr>}>
                {returns.data?.items.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <div className="font-mono text-xs font-semibold">{r.returnNumber}</div>
                      <div className="text-xs text-neutral-500">{fmtDate(r.createdAt)}</div>
                    </Td>
                    <Td className="text-sm">{r.vendor.legalName}</Td>
                    <Td className="text-xs text-neutral-600">{r.lines.map((l) => `${l.batch.product.name} (${l.batch.batchNumber}) ×${num(l.quantity)}`).join(', ')}</Td>
                    <Td className="max-w-[180px] truncate text-xs">{r.reason}</Td>
                    <Td right className="text-xs">{money(r.taxAmount)}</Td>
                    <Td right className="font-semibold">{money(r.total)}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {grnFor ? <GrnDrawer po={grnFor === 'direct' ? null : grnFor} onClose={() => setGrnFor(null)} onDone={done} /> : null}
      {billFor ? <InvoiceDrawer grn={billFor === 'direct' ? null : billFor} onClose={() => setBillFor(null)} onDone={done} /> : null}
    </div>
  );
}
