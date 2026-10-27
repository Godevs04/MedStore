'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { batchDateIssues, daysUntil } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { toast } from '@/lib/toast';
import {
  Combobox,
  ConfirmDialog,
  FilterChips,
  KpiGrid,
  MoneyInput,
  Pagination,
  QtyInput,
  SearchInput,
  useDebouncedValue,
  type ComboItem,
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
  Th,
  Tr,
  cn,
  fmtDate,
  money,
  todayIso, Alert, StatusBadge } from '@/components/ui';

// ── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string;
  legalName: string;
  status: string;
  stateCode: string | null;
  creditDays: number;
  drugLicenceNumber?: string | null;
  drugLicenceExpiry?: string | null;
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
interface Summary {
  draftOrders: number;
  openOrders: number;
  awaitingBill: number;
  payable: string;
  overdue: string;
  dueThisWeek: string;
  monthPurchases: string;
  monthInputGst: string;
  monthInvoices: number;
}
interface Suggestion {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  onOrder: number;
  reorderLevel: number;
  suggestedQty: number;
  avgDailySales: number;
  daysOfCover: number | null;
  lastRate: string | null;
  vendorId: string | null;
  vendorName: string | null;
  estimatedCost: string | null;
}
type Paged<T> = { items: T[]; pageInfo: PageInfo };
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
const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const PAGE_SIZE = 20;
/** GST Rule 46: supplier invoice numbers are up to 16 characters of letters, digits, "-" and "/". */
const GST_INVOICE_NO = /^[A-Za-z0-9/-]{1,16}$/;
const UTR = /^[A-Z0-9]{12,22}$/;
const CHEQUE = /^\d{6}$/;
const SHORT_EXPIRY_DAYS = 180;

// ── Shared data hooks ────────────────────────────────────────────────────────

function useCan() {
  const membership = useCurrentMembership();
  return (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
}

function useMasters() {
  const vendors = useQuery({ queryKey: ['vendor-options'], queryFn: () => api<{ items: Vendor[] }>('/partners/vendors?page=1&pageSize=100&status=ACTIVE') });
  const warehouses = useQuery({
    queryKey: ['warehouses-labelled'],
    queryFn: async () => {
      const branches = await api<Array<{ name: string; warehouses: Array<{ id: string; name: string }> }>>('/organizations/branches');
      return branches.flatMap((b) => b.warehouses.map((w) => ({ id: w.id, label: `${b.name} · ${w.name}` })));
    },
  });
  return { vendors: vendors.data?.items ?? [], warehouses: warehouses.data ?? [] };
}

/** Latest rate paid to a vendor per product, for price hints. */
function useLastRates(vendorId: string) {
  const can = useCan();
  const q = useQuery({
    queryKey: ['vendor-products', vendorId, 'rates'],
    queryFn: () => api<Array<{ productId: string; lastRate: string; lastPurchased: string }>>(`/partners/vendors/${vendorId}/products?limit=50`),
    enabled: Boolean(vendorId) && can('vendors.read') && can('purchases.read'),
  });
  return useMemo(() => new Map((q.data ?? []).map((r) => [r.productId, r])), [q.data]);
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['purchase-orders', 'goods-receipts', 'purchase-invoices', 'supplier-payments', 'purchase-returns', 'vendor-ledger', 'purchasing-summary', 'reorder', 'vendors', 'batches', 'batch-options', 'dashboard']) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

function ProductPicker({ onPick, exclude = [], disabled }: { onPick: (p: Product) => void; exclude?: string[]; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [nonce, setNonce] = useState(0);
  const dq = useDebouncedValue(q.trim(), 250);
  const res = useQuery({
    queryKey: ['purchase-product-search', dq],
    queryFn: () => api<{ items: Product[] }>(`/catalog/products?page=1&pageSize=20&status=ACTIVE${dq ? `&search=${encodeURIComponent(dq)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const items: ComboItem[] = (res.data?.items ?? []).map((p) => ({
    id: p.id,
    label: p.name,
    sublabel: [p.sku, p.mrp ? `MRP ${money(p.mrp)}` : null, p.gstPercent ? `GST ${num(p.gstPercent)}%` : null].filter(Boolean).join(' · '),
    disabled: exclude.includes(p.id),
    badge: p.taxResolved === false ? <Badge tone="red">No GST rate</Badge> : exclude.includes(p.id) ? <Badge>added</Badge> : undefined,
  }));
  return (
    <Combobox
      key={nonce}
      items={items}
      value={null}
      disabled={disabled}
      loading={res.isFetching && !res.data}
      onSearch={setQ}
      placeholder="Search product by name or SKU…"
      emptyText="No active products match"
      onChange={(id) => {
        const p = res.data?.items.find((x) => x.id === id);
        if (p) onPick(p);
        setQ('');
        setNonce((n) => n + 1);
      }}
    />
  );
}

function VendorLicenceNote({ vendor }: { vendor: Vendor | undefined }) {
  if (!vendor) return null;
  if (!vendor.drugLicenceNumber) {
    return <p className="mc-anim-fade-in text-2xs font-medium text-warning"><Icon name="warning" size={13} /> No drug licence on file for this supplier — record Form 20B/21B in Vendors.</p>;
  }
  const days = vendor.drugLicenceExpiry ? daysUntil(vendor.drugLicenceExpiry.slice(0, 10)) : null;
  if (days !== null && days < 0) return <p className="text-2xs font-medium text-danger"><Icon name="danger" size={13} /> Supplier drug licence expired {Math.abs(days)} days ago.</p>;
  if (days !== null && days <= 30) return <p className="text-2xs font-medium text-warning">Supplier drug licence expires in {days} days.</p>;
  return <p className="text-2xs text-success"><Icon name="check" size={13} strokeWidth={2.5} /> DL {vendor.drugLicenceNumber}</p>;
}

function VendorSelect({ vendors, value, onChange, disabled, error }: { vendors: Vendor[]; value: string; onChange: (id: string) => void; disabled?: boolean; error?: string }) {
  return (
    <Field label="Vendor" required error={error} hint={<VendorLicenceNote vendor={vendors.find((v) => v.id === value)} />}>
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(error && 'border-danger')}>
        <option value="">Select vendor…</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.legalName}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function RateHint({ last, current }: { last: { lastRate: string; lastPurchased: string } | undefined; current: string }) {
  if (!last) return null;
  const diff = num(current) - num(last.lastRate);
  return (
    <span className={cn('text-[10px] num', diff > 0.004 ? 'text-danger' : diff < -0.004 ? 'text-success' : 'text-faint')}>
      last {money(last.lastRate)} · {fmtDate(last.lastPurchased)}
    </span>
  );
}

// ── Reorder suggestions ──────────────────────────────────────────────────────

function ReorderPanel({ vendors }: { vendors: Vendor[] }) {
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [picked, setPicked] = useState<Record<string, { qty: string; rate: string }>>({});
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({
    queryKey: ['reorder', vendorId],
    queryFn: () => api<{ items: Suggestion[] }>(`/purchasing/reorder-suggestions${vendorId ? `?vendorId=${vendorId}` : ''}`),
  });
  const items = q.data?.items ?? [];
  const visible = showAll ? items : items.slice(0, 8);
  const chosen = items.filter((i) => i.productId in picked);
  const chosenVendors = [...new Set(chosen.map((i) => i.vendorId).filter(Boolean))] as string[];
  const targetVendor = vendorId || (chosenVendors.length === 1 ? chosenVendors[0]! : '');
  const total = chosen.reduce((s, i) => s + num(picked[i.productId]!.qty) * num(picked[i.productId]!.rate), 0);

  const create = useMutation({
    meta: { silent: true },
    mutationFn: (body: { vendorId: string; lines: Array<{ productId: string; quantity: string; unitPrice: string }> }) =>
      api<{ poNumber: string }>('/purchasing/purchase-orders', { method: 'POST', body: { ...body, expectedDate: null } }),
    onSuccess: (po) => {
      toast.success(`Draft ${po.poNumber} created`, 'Review it below and send it to the vendor.');
      setPicked({});
      invalidate();
    },
  });
  const toggle = (s: Suggestion) =>
    setPicked((p) => {
      const next = { ...p };
      if (s.productId in next) delete next[s.productId];
      else next[s.productId] = { qty: String(s.suggestedQty), rate: s.lastRate ? num(s.lastRate).toFixed(2) : '' };
      return next;
    });
  const submit = () => {
    if (!targetVendor) {
      toast.warning('Pick one vendor', 'The selected items were last bought from different suppliers — filter by vendor first.');
      return;
    }
    const bad = chosen.find((i) => !(num(picked[i.productId]!.qty) > 0) || !(num(picked[i.productId]!.rate) > 0));
    if (bad) {
      toast.warning(`Enter quantity and rate for ${bad.name}`);
      return;
    }
    create.mutate({
      vendorId: targetVendor,
      lines: chosen.map((i) => ({ productId: i.productId, quantity: String(num(picked[i.productId]!.qty)), unitPrice: num(picked[i.productId]!.rate).toFixed(2) })),
    });
  };

  return (
    <Card
      title={`Reorder suggestions${q.data ? ` (${items.length})` : ''}`}
      actions={
        <div className="w-56 shrink-0">
          <Select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPicked({}); }} aria-label="Filter suggestions by vendor">
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.legalName}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      {q.isLoading ? (
        <SkeletonRows rows={3} cols={6} />
      ) : q.error ? (
        <ErrorState message="Could not load reorder suggestions." retry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Stock levels look healthy" hint="Products appear here when saleable stock falls to their reorder level. Set reorder levels on Products." />
      ) : (
        <div className="space-y-3">
          <Table head={<tr><Th /><Th>Product</Th><Th right>On hand</Th><Th right>Cover</Th><Th>Last vendor</Th><Th right>Order qty</Th><Th right>Rate ₹</Th></tr>}>
            {visible.map((s) => {
              const on = s.productId in picked;
              return (
                <Tr key={s.productId} className={cn(on && 'bg-mint/60')}>
                  <Td>
                    <input type="checkbox" className="accent-brand-600" checked={on} onChange={() => toggle(s)} aria-label={`Select ${s.name}`} />
                  </Td>
                  <Td>
                    <div className="font-medium text-ink">{s.name}</div>
                    <div className="text-2xs text-muted">
                      <span className="font-mono">{s.sku}</span> · reorder at {s.reorderLevel}
                      {s.onOrder > 0 ? <span className="text-teal-ink"> · {s.onOrder} on order</span> : null}
                    </div>
                  </Td>
                  <Td right className={cn(s.onHand === 0 ? 'font-semibold text-danger' : 'text-warning')}>{s.onHand.toLocaleString('en-IN')}</Td>
                  <Td right className="text-xs">
                    {s.daysOfCover === null ? <span className="text-faint">no sales</span> : <span className={cn(s.daysOfCover <= 7 && 'font-semibold text-danger')}>{s.daysOfCover}d</span>}
                    <div className="text-[10px] text-faint">{s.avgDailySales}/day</div>
                  </Td>
                  <Td className="text-xs">{s.vendorName ?? <span className="text-faint">—</span>}</Td>
                  <Td right>
                    {on ? (
                      <QtyInput className="ml-auto w-20 text-right" value={picked[s.productId]!.qty} onChange={(v) => setPicked((p) => ({ ...p, [s.productId]: { ...p[s.productId]!, qty: v } }))} aria-label={`Quantity for ${s.name}`} />
                    ) : (
                      <span className="font-medium">{s.suggestedQty}</span>
                    )}
                  </Td>
                  <Td right>
                    {on ? (
                      <MoneyInput className="ml-auto w-24" value={picked[s.productId]!.rate} invalid={!(num(picked[s.productId]!.rate) > 0)} onChange={(v) => setPicked((p) => ({ ...p, [s.productId]: { ...p[s.productId]!, rate: v } }))} aria-label={`Rate for ${s.name}`} />
                    ) : (
                      <span className="text-xs text-neutral-600">{s.lastRate ? money(s.lastRate) : '—'}</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {items.length > 8 ? (
              <Button variant="ghost" className="text-xs" onClick={() => setShowAll((s) => !s)}>
                {showAll ? 'Show fewer' : `Show all ${items.length}`}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {chosen.length ? (
                <span className="text-sm text-muted">
                  {chosen.length} item{chosen.length === 1 ? '' : 's'} · <span className="font-semibold text-ink">{money(total)}</span> + GST
                  {targetVendor ? ` · ${vendors.find((v) => v.id === targetVendor)?.legalName ?? ''}` : ''}
                </span>
              ) : null}
              <Button disabled={chosen.length === 0 || create.isPending} onClick={submit}>
                {create.isPending ? 'Creating…' : 'Create draft PO'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Purchase order ───────────────────────────────────────────────────────────

type PODraftLine = { productId: string; name: string; sku: string; quantity: string; unitPrice: string; mrp: string | null };

function NewPOCard() {
  const { vendors } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [lines, setLines] = useState<PODraftLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const rates = useLastRates(vendorId);
  const total = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0);

  const create = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<{ poNumber: string }>('/purchasing/purchase-orders', {
        method: 'POST',
        body: { vendorId, expectedDate: expectedDate || null, lines: lines.map((l) => ({ productId: l.productId, quantity: String(num(l.quantity)), unitPrice: num(l.unitPrice).toFixed(2) })) },
      }),
    onSuccess: (po) => {
      toast.success(`Purchase order ${po.poNumber} created`, 'Saved as draft — send it to the vendor next.');
      setLines([]);
      setVendorId('');
      setExpectedDate('');
      invalidate();
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!vendorId) e.vendorId = 'Select the vendor';
    if (expectedDate && expectedDate < todayIso()) e.expectedDate = 'Expected delivery cannot be in the past';
    if (lines.length === 0) e._lines = 'Add at least one product';
    for (const l of lines) {
      if (!(num(l.quantity) > 0)) e[`${l.productId}.quantity`] = 'Enter a quantity';
      if (!(num(l.unitPrice) > 0)) e[`${l.productId}.unitPrice`] = 'Enter a rate';
      else if (l.mrp && num(l.unitPrice) > num(l.mrp)) e[`${l.productId}.unitPrice`] = `Above MRP ${money(l.mrp)}`;
    }
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    create.mutate();
  };

  return (
    <Card title="New purchase order">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <VendorSelect vendors={vendors} value={vendorId} onChange={(v) => { setVendorId(v); setErrors((e) => ({ ...e, vendorId: '' })); }} error={errors.vendorId || undefined} />
        <Field label="Expected delivery" error={errors.expectedDate || undefined}>
          <Input type="date" min={todayIso()} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </Field>
        <Field label="Add product" error={errors._lines || undefined}>
          <ProductPicker
            exclude={lines.map((l) => l.productId)}
            onPick={(p) => {
              const last = rates.get(p.id);
              setLines((s) => [...s, { productId: p.id, name: p.name, sku: p.sku, quantity: '', unitPrice: last ? num(last.lastRate).toFixed(2) : p.purchasePrice ? num(p.purchasePrice).toFixed(2) : '', mrp: p.mrp }]);
              setErrors((e) => ({ ...e, _lines: '' }));
            }}
          />
        </Field>
      </div>
      {lines.length ? (
        <div className="mt-3 space-y-2">
          {lines.map((l, i) => {
            const qErr = errors[`${l.productId}.quantity`];
            const rErr = errors[`${l.productId}.unitPrice`];
            return (
              <div key={l.productId} className="mc-anim-fade-in flex flex-wrap items-start gap-2 rounded-lg border border-line bg-subtle/60 px-3 py-2">
                <span className="min-w-[10rem] flex-1 pt-2 text-sm">
                  <span className="font-medium">{l.name}</span> <span className="font-mono text-xs text-faint">{l.sku}</span>
                  {l.mrp ? <span className="ml-1 text-xs text-faint">MRP {money(l.mrp)}</span> : null}
                </span>
                <div className="w-24">
                  <QtyInput className="text-right" decimals={3} placeholder="Qty" value={l.quantity} invalid={Boolean(qErr)} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} aria-label={`Quantity of ${l.name}`} />
                  {qErr ? <p className="mt-0.5 text-[10px] text-danger">{qErr}</p> : null}
                </div>
                <div className="w-32">
                  <MoneyInput value={l.unitPrice} invalid={Boolean(rErr)} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, unitPrice: v } : x)))} aria-label={`Rate of ${l.name}`} />
                  {rErr ? <p className="mt-0.5 text-[10px] text-danger">{rErr}</p> : <RateHint last={rates.get(l.productId)} current={l.unitPrice} />}
                </div>
                <span className="w-24 pt-2 text-right text-sm num">{money(num(l.quantity) * num(l.unitPrice))}</span>
                <Button variant="ghost" onClick={() => setLines((s) => s.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}>
                  <Icon name="close" size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{lines.length ? <>Estimated <span className="font-semibold text-ink">{money(total)}</span> + GST</> : null}</span>
        <Button disabled={create.isPending} onClick={submit}>
          {create.isPending ? 'Creating…' : 'Create PO (draft)'}
        </Button>
      </div>
    </Card>
  );
}

// ── Goods receipt drawer ─────────────────────────────────────────────────────

interface BatchDraft {
  key: string;
  productId: string;
  name: string;
  sku: string;
  poLineId: string | null;
  batchNumber: string;
  expiryDate: string;
  manufacturingDate: string;
  quantity: string;
  freeQuantity: string;
  purchaseRate: string;
  mrp: string;
}
type RowCheck = { errors: Partial<Record<keyof BatchDraft, string>>; warning: string | null };

function GrnDrawer({ po, onClose, onDone }: { po: PORow | null; onClose: () => void; onDone: () => void }) {
  const { vendors, warehouses } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState(po?.vendorId ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const rates = useLastRates(vendorId);
  const blank = (productId: string, name: string, sku: string, poLineId: string | null, rate: string, mrp: string, qty = ''): BatchDraft => ({
    key: `${productId}-${Math.random().toString(36).slice(2, 8)}`,
    productId,
    name,
    sku,
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
          .map((l) => blank(l.productId, l.product.name, l.product.sku, l.id, num(l.unitPrice).toFixed(2), l.product.mrp ? num(l.product.mrp).toFixed(2) : '', String(num(l.quantity) - num(l.receivedQty))))
      : [],
  );
  const wh = warehouseId || warehouses[0]?.id || '';
  const today = todayIso();
  const update = (key: string, patch: Partial<BatchDraft>) => setRows((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remainingFor = (poLineId: string | null) => {
    if (!po || !poLineId) return null;
    const l = po.lines.find((x) => x.id === poLineId)!;
    return num(l.quantity) - num(l.receivedQty);
  };
  const receivingFor = (poLineId: string | null) => rows.filter((r) => r.poLineId === poLineId).reduce((s, r) => s + num(r.quantity), 0);
  const check = (r: BatchDraft): RowCheck => {
    const errors: RowCheck['errors'] = {};
    if (!r.batchNumber.trim()) errors.batchNumber = 'Batch number required';
    else if (!/^[A-Z0-9][A-Z0-9/\-.]{0,63}$/.test(r.batchNumber.trim())) errors.batchNumber = 'Letters, digits, "/", "-" or "." only';
    if (!r.expiryDate) errors.expiryDate = 'Expiry required';
    for (const issue of batchDateIssues({ expiryDate: r.expiryDate || null, manufacturingDate: r.manufacturingDate || null, requireFutureExpiry: true })) {
      errors[issue.field as keyof BatchDraft] ??= issue.message;
    }
    if (!(num(r.quantity) > 0)) errors.quantity = 'Quantity required';
    if (!(num(r.mrp) > 0)) errors.mrp = 'MRP required';
    if (!(num(r.purchaseRate) > 0)) errors.purchaseRate = 'Rate required';
    else if (num(r.mrp) > 0 && num(r.purchaseRate) > num(r.mrp)) errors.purchaseRate = 'Rate is above MRP';
    const rem = remainingFor(r.poLineId);
    if (rem !== null && receivingFor(r.poLineId) > rem) errors.quantity = `Exceeds open PO qty (${rem})`;
    const days = r.expiryDate && r.expiryDate > today ? daysUntil(r.expiryDate) : null;
    const warning = days !== null && days < SHORT_EXPIRY_DAYS ? `Short expiry: only ${days} days left. Many distributors accept returns only with > 6 months shelf life.` : null;
    return { errors, warning };
  };
  const checks = new Map(rows.map((r) => [r.key, check(r)]));
  const hasErrors = [...checks.values()].some((c) => Object.keys(c.errors).length > 0);
  const value = rows.reduce((s, r) => s + num(r.quantity) * num(r.purchaseRate), 0);

  const submit = useMutation({
    meta: { silent: true },
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
            quantity: String(num(r.quantity)),
            ...(r.freeQuantity ? { freeQuantity: String(num(r.freeQuantity)) } : {}),
            purchaseRate: num(r.purchaseRate).toFixed(2),
            mrp: num(r.mrp).toFixed(2),
          })),
        },
      }),
    onSuccess: (g) => {
      toast.success(`Goods receipt ${g.grnNumber} posted`, 'Stock is now available in batch inventory.');
      invalidate();
      onDone();
    },
  });
  const post = () => {
    setTried(true);
    if (!vendorId) { toast.error('Select the vendor'); return; }
    if (!wh) { toast.error('Select the warehouse to receive into'); return; }
    if (rows.length === 0) { toast.error('Add at least one product'); return; }
    if (hasErrors) { toast.error('Please fix the highlighted batches'); return; }
    submit.mutate();
  };

  const grouped = useMemo(() => {
    const order: string[] = [];
    for (const r of rows) {
      const k = `${r.productId}|${r.poLineId ?? ''}`;
      if (!order.includes(k)) order.push(k);
    }
    return order.map((k) => ({ k, items: rows.filter((r) => `${r.productId}|${r.poLineId ?? ''}` === k) }));
  }, [rows]);

  const cell = (r: BatchDraft, f: keyof BatchDraft) => {
    const c = checks.get(r.key)!;
    return Boolean(c.errors[f]) && (tried || Boolean(r[f]));
  };

  return (
    <Drawer open onClose={onClose} width="max-w-5xl" title={po ? `Receive goods · ${po.poNumber}` : 'Receive goods (direct)'} subtitle="Capture each batch with expiry and MRP. Split a line into several batches if the supplier shipped more than one.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <VendorSelect vendors={vendors} value={vendorId} disabled={Boolean(po)} onChange={setVendorId} error={tried && !vendorId ? 'Select the vendor' : undefined} />
        <Field label="Receive into" required>
          <Select value={wh} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <Input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery challan no., e-way bill, remarks" />
        </Field>
      </div>

      {!po ? (
        <Field label="Add product">
          <ProductPicker
            onPick={(p) => {
              const last = rates.get(p.id);
              setRows((s) => [...s, blank(p.id, p.name, p.sku, null, last ? num(last.lastRate).toFixed(2) : p.purchasePrice ? num(p.purchasePrice).toFixed(2) : '', p.mrp ? num(p.mrp).toFixed(2) : '')]);
            }}
          />
        </Field>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={po ? 'Everything on this PO has been received' : 'Add products to receive'} />
      ) : (
        <div className="space-y-3">
          <div className="hidden grid-cols-8 gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-faint sm:grid">
            <span className="col-span-2">Batch no.</span>
            <span>Expiry</span>
            <span>Mfg date</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Free</span>
            <span className="text-right">Rate ₹</span>
            <span className="text-right">MRP ₹</span>
          </div>
          {grouped.map(({ k, items }) => {
            const first = items[0]!;
            const poLine = po?.lines.find((l) => l.id === first.poLineId);
            const rem = remainingFor(first.poLineId);
            const receiving = receivingFor(first.poLineId);
            return (
              <div key={k} className="mc-anim-fade-in rounded-lg border border-line">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg border-b border-line bg-subtle/70 px-3 py-2">
                  <span className="text-sm font-medium">
                    {first.name} <span className="font-mono text-xs text-faint">{first.sku}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {rem !== null ? (
                      <span className={cn(receiving < rem && 'text-warning', receiving > rem && 'font-semibold text-danger')}>
                        Ordered {num(poLine!.quantity)} · received {num(poLine!.receivedQty)} · receiving {receiving} of {rem} open
                        {receiving < rem ? ' (partial)' : ''}
                      </span>
                    ) : null}
                    <RateHint last={rates.get(first.productId)} current={first.purchaseRate} />
                    <Button variant="ghost" className="py-1 text-xs" onClick={() => setRows((s) => [...s, blank(first.productId, first.name, first.sku, first.poLineId, first.purchaseRate, first.mrp)])}>
                      <Icon name="plus" size={14} strokeWidth={2.25} /> Batch
                    </Button>
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  {items.map((r) => {
                    const c = checks.get(r.key)!;
                    const shown = Object.entries(c.errors).filter(([f]) => tried || Boolean(r[f as keyof BatchDraft]));
                    return (
                      <div key={r.key}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-8">
                          <Input className={cn('font-mono uppercase sm:col-span-2', cell(r, 'batchNumber') && 'border-danger')} placeholder="Batch no." maxLength={64} value={r.batchNumber} onChange={(e) => update(r.key, { batchNumber: e.target.value.toUpperCase() })} aria-label="Batch number" />
                          <Input type="date" className={cn(cell(r, 'expiryDate') && 'border-danger')} min={today} value={r.expiryDate} onChange={(e) => update(r.key, { expiryDate: e.target.value })} aria-label="Expiry date" />
                          <Input type="date" className={cn(cell(r, 'manufacturingDate') && 'border-danger')} max={today} value={r.manufacturingDate} onChange={(e) => update(r.key, { manufacturingDate: e.target.value })} aria-label="Manufacturing date (optional)" />
                          <QtyInput className="text-right" decimals={3} placeholder="Qty" value={r.quantity} invalid={cell(r, 'quantity')} onChange={(v) => update(r.key, { quantity: v })} aria-label="Quantity" />
                          <QtyInput className="text-right" decimals={3} placeholder="Free" value={r.freeQuantity} onChange={(v) => update(r.key, { freeQuantity: v })} aria-label="Free quantity" />
                          <MoneyInput value={r.purchaseRate} invalid={cell(r, 'purchaseRate')} onChange={(v) => update(r.key, { purchaseRate: v })} aria-label="Purchase rate" />
                          <div className="flex gap-1">
                            <MoneyInput className="flex-1" value={r.mrp} invalid={cell(r, 'mrp')} onChange={(v) => update(r.key, { mrp: v })} aria-label="MRP" />
                            <Button variant="ghost" className="px-2" onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))} aria-label="Remove batch">
                              <Icon name="close" size={14} />
                            </Button>
                          </div>
                        </div>
                        {shown.length ? <p className="mt-1 text-xs font-medium text-danger"><Icon name="warning" size={13} /> {shown.map(([, m]) => m).join(' · ')}</p> : null}
                        {c.warning ? <p className="mt-1 text-xs text-warning"><Icon name="pending" size={13} /> {c.warning}</p> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2.5 text-[13px]">
        <span className="text-muted">Receipt value at purchase rate (excl. GST)</span>
        <span className="font-semibold num">{money(value)}</span>
      </div>
      <div className="flex gap-2">
        <Button disabled={submit.isPending} onClick={post}>
          {submit.isPending ? 'Posting…' : 'Post goods receipt'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Drawer>
  );
}

// ── Supplier invoice drawer ──────────────────────────────────────────────────

type BillLine = { productId: string; name: string; gstPercent: string | null; taxResolved?: boolean; quantity: string; freeQty: string; unitCost: string };

function InvoiceDrawer({ grn, onClose, onDone }: { grn: GRNRow | null; onClose: () => void; onDone: () => void }) {
  const { vendors } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState(grn?.vendorId ?? '');
  const [grnId, setGrnId] = useState(grn?.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [tried, setTried] = useState(false);
  const rates = useLastRates(vendorId);
  const fromGrn = (g: GRNRow): BillLine[] => {
    const by = new Map<string, { productId: string; name: string; quantity: number; freeQty: number; value: number }>();
    for (const l of g.lines) {
      const r = by.get(l.productId) ?? { productId: l.productId, name: l.product.name, quantity: 0, freeQty: 0, value: 0 };
      r.quantity += num(l.quantity);
      r.freeQty += num(l.freeQuantity);
      r.value += num(l.quantity) * num(l.purchaseRate);
      by.set(l.productId, r);
    }
    return [...by.values()].map((r) => ({ productId: r.productId, name: r.name, gstPercent: null, quantity: String(r.quantity), freeQty: r.freeQty ? String(r.freeQty) : '', unitCost: (r.value / r.quantity).toFixed(2) }));
  };
  const [lines, setLines] = useState<BillLine[]>(grn ? fromGrn(grn) : []);
  const grns = useQuery({
    queryKey: ['goods-receipts', 'uninvoiced', vendorId],
    queryFn: () => api<Paged<GRNRow>>(`/purchasing/goods-receipts?page=1&pageSize=50&uninvoiced=true&vendorId=${vendorId}`),
    enabled: Boolean(vendorId),
  });
  const ids = lines.map((l) => l.productId).sort().join(',');
  const taxInfo = useQuery({
    queryKey: ['purchase-product-tax', ids],
    queryFn: async () => {
      const res = await api<{ items: Product[] }>(`/catalog/products?page=1&pageSize=100&ids=${ids}`);
      return new Map(res.items.map((p) => [p.id, p]));
    },
    enabled: lines.some((l) => l.gstPercent === null && l.taxResolved === undefined),
  });
  const gstOf = (l: BillLine) => l.gstPercent ?? taxInfo.data?.get(l.productId)?.gstPercent ?? null;
  const resolvedOf = (l: BillLine) => l.taxResolved ?? taxInfo.data?.get(l.productId)?.taxResolved;
  const selectedGrn = grn ?? grns.data?.items.find((g) => g.id === grnId) ?? null;
  const receivedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of selectedGrn?.lines ?? []) m.set(l.productId, (m.get(l.productId) ?? 0) + num(l.quantity));
    return m;
  }, [selectedGrn]);
  const dn = useDebouncedValue(invoiceNumber.trim(), 400);
  const dup = useQuery({
    queryKey: ['purchase-dup', vendorId, dn],
    queryFn: () => api<{ duplicate: boolean; invoice: { invoiceNumber: string; invoiceDate: string; total: string } | null }>(`/purchasing/invoices/check-duplicate?vendorId=${vendorId}&invoiceNumber=${encodeURIComponent(dn)}`),
    enabled: Boolean(vendorId && dn),
  });

  const subtotal = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0);
  const gstEstimate = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost) * (num(gstOf(l)) / 100), 0);
  const mismatch = selectedGrn
    ? [...new Set([...receivedBy.keys(), ...lines.map((l) => l.productId)])].filter((pid) => (receivedBy.get(pid) ?? 0) !== lines.filter((l) => l.productId === pid).reduce((s, l) => s + num(l.quantity), 0))
    : [];
  const noRate = lines.filter((l) => resolvedOf(l) === false);

  const errors: Record<string, string> = {};
  if (!vendorId) errors.vendorId = 'Select the vendor';
  if (!invoiceNumber.trim()) errors.invoiceNumber = 'Enter the number printed on the bill';
  else if (!GST_INVOICE_NO.test(invoiceNumber.trim())) errors.invoiceNumber = 'GST invoice numbers are up to 16 letters, digits, "-" or "/"';
  else if (dup.data?.duplicate && dn === invoiceNumber.trim()) errors.invoiceNumber = `Already posted on ${fmtDate(dup.data.invoice!.invoiceDate)} for ${money(dup.data.invoice!.total)}`;
  if (!invoiceDate) errors.invoiceDate = 'Invoice date required';
  else if (invoiceDate > todayIso()) errors.invoiceDate = 'Invoice date cannot be in the future';
  if (dueDate && invoiceDate && dueDate < invoiceDate) errors.dueDate = 'Due date cannot be before the invoice date';
  for (const l of lines) {
    if (!(num(l.quantity) > 0)) errors[`${l.productId}.quantity`] = 'Qty?';
    if (!(num(l.unitCost) > 0)) errors[`${l.productId}.unitCost`] = 'Cost?';
  }
  const blocking = Object.keys(errors).length > 0 || lines.length === 0 || mismatch.length > 0 || noRate.length > 0;
  const showErr = (k: string) => (tried || (k === 'invoiceNumber' && invoiceNumber.trim()) ? errors[k] : undefined);

  const submit = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<{ invoiceNumber: string; total: string }>('/purchasing/invoices', {
        method: 'POST',
        body: {
          vendorId,
          invoiceNumber: invoiceNumber.trim(),
          invoiceDate,
          dueDate: dueDate || null,
          grnId: selectedGrn?.id ?? null,
          lines: lines.map((l) => ({ productId: l.productId, quantity: String(num(l.quantity)), ...(l.freeQty ? { freeQty: String(num(l.freeQty)) } : {}), unitCost: num(l.unitCost).toFixed(2) })),
        },
      }),
    onSuccess: (inv) => {
      toast.success(`Supplier invoice ${inv.invoiceNumber} posted`, `${money(inv.total)} — inventory, input GST and payable booked.`);
      invalidate();
      onDone();
    },
  });
  const post = () => {
    setTried(true);
    if (lines.length === 0) { toast.error('Add at least one line'); return; }
    if (mismatch.length) { toast.error('Billed quantities must match the goods receipt'); return; }
    if (noRate.length) { toast.error('Configure a GST rate for every product first', 'Configuration → Tax rates'); return; }
    if (blocking) { toast.error('Please fix the highlighted fields'); return; }
    submit.mutate();
  };

  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title="Post supplier invoice" subtitle="Three-way match: billed quantities must equal what was received on the linked GRN. Costs are entered exclusive of GST.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <VendorSelect vendors={vendors} value={vendorId} disabled={Boolean(grn)} onChange={(v) => { setVendorId(v); setGrnId(''); setLines([]); }} error={tried ? errors.vendorId : undefined} />
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
              <option key={g.id} value={g.id}>
                {g.grnNumber} · {fmtDate(g.receivedDate)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier invoice no." required error={showErr('invoiceNumber')} hint={dup.isFetching ? 'Checking for duplicates…' : dup.data && !dup.data.duplicate && dn ? <><Icon name="check" size={12} strokeWidth={2.5} className="text-success" /> Not posted before</> : undefined}>
          <Input value={invoiceNumber} maxLength={16} className="font-mono uppercase" onChange={(e) => setInvoiceNumber(e.target.value.toUpperCase())} placeholder="As printed on the bill" />
        </Field>
        <Field label="Invoice date" required error={tried ? errors.invoiceDate : undefined}>
          <Input type="date" max={todayIso()} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </Field>
        <Field label="Due date" error={errors.dueDate} hint="Blank = vendor credit days">
          <Input type="date" min={invoiceDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        {!selectedGrn ? (
          <Field label="Add product">
            <ProductPicker
              disabled={!vendorId}
              exclude={lines.map((l) => l.productId)}
              onPick={(p) => {
                const last = rates.get(p.id);
                setLines((s) => [...s, { productId: p.id, name: p.name, gstPercent: p.gstPercent ?? null, taxResolved: p.taxResolved, quantity: '', freeQty: '', unitCost: last ? num(last.lastRate).toFixed(2) : p.purchasePrice ? num(p.purchasePrice).toFixed(2) : '' }]);
              }}
            />
          </Field>
        ) : null}
      </div>

      {lines.length ? (
        <Table head={<tr><Th>Product</Th>{selectedGrn ? <Th right>Received</Th> : null}<Th right>Billed qty</Th><Th right>Free</Th><Th right>Unit cost</Th><Th right>Amount</Th><Th /></tr>}>
          {lines.map((l, i) => {
            const bad = mismatch.includes(l.productId);
            const gst = gstOf(l);
            return (
              <Tr key={`${l.productId}-${i}`} className={bad ? 'bg-danger/[0.04]' : undefined}>
                <Td>
                  <div className="text-sm font-medium">{l.name}</div>
                  {resolvedOf(l) === false ? <Badge tone="red">No GST rate</Badge> : gst ? <span className="text-xs text-muted">GST {num(gst)}%</span> : null}
                  {bad ? <div className="text-2xs font-medium text-danger">Received {receivedBy.get(l.productId) ?? 0}</div> : null}
                </Td>
                {selectedGrn ? <Td right className="text-xs text-muted">{receivedBy.get(l.productId) ?? 0}</Td> : null}
                <Td right>
                  <QtyInput className="ml-auto w-20 text-right" decimals={3} value={l.quantity} invalid={Boolean(tried && errors[`${l.productId}.quantity`]) || bad} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} aria-label={`Billed quantity of ${l.name}`} />
                </Td>
                <Td right>
                  <QtyInput className="ml-auto w-16 text-right" decimals={3} value={l.freeQty} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, freeQty: v } : x)))} aria-label={`Free quantity of ${l.name}`} />
                </Td>
                <Td right>
                  <MoneyInput className="ml-auto w-28" value={l.unitCost} invalid={Boolean(tried && errors[`${l.productId}.unitCost`])} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, unitCost: v } : x)))} aria-label={`Unit cost of ${l.name}`} />
                  <RateHint last={rates.get(l.productId)} current={l.unitCost} />
                </Td>
                <Td right>{money(num(l.quantity) * num(l.unitCost))}</Td>
                <Td right>
                  {!selectedGrn ? (
                    <Button variant="ghost" className="px-2" onClick={() => setLines((s) => s.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`}>
                      <Icon name="close" size={14} />
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            );
          })}
        </Table>
      ) : (
        <EmptyState title="No lines yet" hint={vendorId ? 'Pick a goods receipt to prefill, or add products for a direct bill.' : 'Select the vendor first.'} />
      )}

      {mismatch.length ? <p className="text-sm font-medium text-danger">Billed quantities must match the goods receipt for every product.</p> : null}
      {noRate.length ? <p className="text-sm font-medium text-danger">Configure a GST rate for every product before posting (Configuration → Tax rates).</p> : null}
      <dl className="space-y-1 rounded-lg bg-subtle px-3 py-2.5 text-[13px]">
        <div className="flex justify-between text-muted"><dt>Taxable value</dt><dd className="num">{money(subtotal)}</dd></div>
        <div className="flex justify-between text-muted"><dt>Input GST (estimate)</dt><dd className="num">{money(gstEstimate)}</dd></div>
        <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>Invoice total (estimate)</dt><dd className="num">{money(subtotal + gstEstimate)}</dd></div>
      </dl>
      <div className="flex gap-2">
        <Button disabled={submit.isPending} onClick={post}>
          {submit.isPending ? 'Posting…' : 'Post invoice'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Drawer>
  );
}

// ── Payments ─────────────────────────────────────────────────────────────────

function PaymentForm() {
  const { vendors } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [method, setMethod] = useState<'BANK' | 'UPI' | 'CASH'>('BANK');
  const [reference, setReference] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ledger = useQuery({
    queryKey: ['vendor-ledger', vendorId],
    queryFn: () => api<VendorLedger>(`/purchasing/vendors/${vendorId}/ledger`),
    enabled: Boolean(vendorId),
  });
  const open = ledger.data?.openInvoices ?? [];
  const entries = open.filter((i) => num(alloc[i.id]) > 0);
  const total = entries.reduce((s, i) => s + num(alloc[i.id]), 0);
  const vendor = vendors.find((v) => v.id === vendorId);
  const pay = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<{ paymentNumber: string }>('/purchasing/payments', {
        method: 'POST',
        body: {
          vendorId,
          amount: total.toFixed(2),
          method,
          reference: reference.trim().toUpperCase() || null,
          allocations: entries.map((i) => ({ invoiceId: i.id, amount: num(alloc[i.id]).toFixed(2) })),
        },
      }),
    onSuccess: (p) => {
      toast.success(`Payment ${p.paymentNumber} recorded`, `${money(total)} to ${vendor?.legalName ?? 'vendor'}`);
      setAlloc({});
      setReference('');
      setErrors({});
      invalidate();
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!vendorId) e.vendorId = 'Select the vendor';
    if (entries.length === 0) e._alloc = 'Enter an amount against at least one invoice';
    for (const i of open) if (num(alloc[i.id]) > num(i.outstanding) + 0.001) e[i.id] = `Max ${money(i.outstanding)}`;
    const ref = reference.trim().toUpperCase();
    if (method === 'UPI' && !UTR.test(ref)) e.reference = 'UPI transaction ID must be 12–22 letters or digits';
    if (method === 'BANK' && !(UTR.test(ref) || CHEQUE.test(ref))) e.reference = 'Enter a 12–22 character UTR or a 6-digit cheque number';
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error(e._alloc ?? 'Please fix the highlighted fields');
      return;
    }
    pay.mutate();
  };

  return (
    <Card title="Pay supplier">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <VendorSelect vendors={vendors} value={vendorId} onChange={(v) => { setVendorId(v); setAlloc({}); setErrors({}); }} error={errors.vendorId} />
        <Field
          label="Method"
          required
          hint={method === 'CASH' && total > 10000 ? <span className="text-warning"><Icon name="warning" size={13} /> Cash above ₹10,000 a day to one supplier is not deductible as an expense (Income Tax s.40A(3)).</span> : undefined}
        >
          <Select value={method} onChange={(e) => { setMethod(e.target.value as typeof method); setErrors((x) => ({ ...x, reference: '' })); }}>
            <option value="BANK">Bank (NEFT / RTGS / IMPS / cheque)</option>
            <option value="UPI">UPI</option>
            <option value="CASH">Cash</option>
          </Select>
        </Field>
        <Field label={method === 'UPI' ? 'UPI transaction ID' : method === 'BANK' ? 'UTR / cheque no.' : 'Reference (optional)'} required={method !== 'CASH'} error={errors.reference || undefined}>
          <Input value={reference} maxLength={22} className="font-mono uppercase" onChange={(e) => { setReference(e.target.value); setErrors((x) => ({ ...x, reference: '' })); }} />
        </Field>
      </div>
      {vendorId ? (
        ledger.isLoading ? (
          <div className="mt-3">
            <SkeletonRows rows={3} cols={5} />
          </div>
        ) : ledger.error ? (
          <div className="mt-3">
            <ErrorState message="Could not load open invoices." retry={() => void ledger.refetch()} />
          </div>
        ) : open.length === 0 ? (
          <p className="mt-4 text-center text-sm text-muted"><Icon name="celebrate" size={15} className="mr-1 text-teal-ink" /> No open invoices for this vendor.</p>
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
                      <MoneyInput className="w-28" value={alloc[i.id] ?? ''} invalid={Boolean(errors[i.id]) || num(alloc[i.id]) > num(i.outstanding)} onChange={(v) => { setAlloc((s) => ({ ...s, [i.id]: v })); setErrors((x) => ({ ...x, [i.id]: '' })); }} aria-label={`Amount for ${i.invoiceNumber}`} />
                      <Button variant="ghost" className="px-2 text-xs" onClick={() => setAlloc((s) => ({ ...s, [i.id]: num(i.outstanding).toFixed(2) }))}>
                        Full
                      </Button>
                    </div>
                    {errors[i.id] ? <p className="text-2xs text-danger">{errors[i.id]}</p> : null}
                  </Td>
                </Tr>
              ))}
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">
                Paying <span className="font-semibold text-ink">{money(total)}</span> across {entries.length} invoice{entries.length === 1 ? '' : 's'} · vendor outstanding {money(ledger.data?.outstanding)}
              </span>
              <Button disabled={pay.isPending} onClick={submit}>
                {pay.isPending ? 'Recording…' : `Record payment ${money(total)}`}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </Card>
  );
}

// ── Purchase return (debit note) ─────────────────────────────────────────────

function ReturnForm() {
  const { vendors } = useMasters();
  const invalidate = useInvalidateAll();
  const [vendorId, setVendorId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<Array<{ batchId: string; label: string; onHand: number; quantity: string; rate: string }>>([]);
  const [tried, setTried] = useState(false);
  const invoices = useQuery({
    queryKey: ['purchase-invoices', 'vendor', vendorId],
    queryFn: () => api<Paged<InvoiceRow>>(`/purchasing/invoices?page=1&pageSize=100&vendorId=${vendorId}&status=POSTED,PARTIALLY_PAID,PAID`),
    enabled: Boolean(vendorId),
  });
  const invoice = invoices.data?.items.find((i) => i.id === invoiceId);
  const invoiceProducts = invoice ? [...new Map(invoice.lines.map((l) => [l.productId, { id: l.productId, name: l.product.name }])).values()] : [];
  const batches = useQuery({
    queryKey: ['batches', 'return', product?.id],
    queryFn: () => api<{ items: Array<{ id: string; batchNumber: string; expiryDate: string; status: string; purchaseRate: string; balances: Array<{ quantity: string }> }> }>(`/inventory/batches?page=1&pageSize=100&productId=${product!.id}`),
    enabled: Boolean(product),
  });
  const value = lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0);
  const lineErr = (l: (typeof lines)[number]) => (!(num(l.quantity) > 0) ? 'Enter a quantity' : num(l.quantity) > l.onHand ? `Only ${l.onHand} on hand` : !(num(l.rate) > 0) ? 'Enter a rate' : null);
  const reasonErr = reason.trim().length < 3 ? 'Give a reason (at least 3 characters)' : undefined;
  const submit = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<{ returnNumber: string; total: string }>('/purchasing/purchase-returns', {
        method: 'POST',
        body: { vendorId, invoiceId: invoiceId || null, reason: reason.trim(), lines: lines.map((l) => ({ batchId: l.batchId, quantity: String(num(l.quantity)), rate: num(l.rate).toFixed(2) })) },
      }),
    onSuccess: (r) => {
      toast.success(`Debit note ${r.returnNumber} posted`, `${money(r.total)} — stock removed, payable and input GST reduced.`);
      setLines([]);
      setReason('');
      setInvoiceId('');
      setProduct(null);
      setTried(false);
      invalidate();
    },
  });
  const post = () => {
    setTried(true);
    if (!vendorId) { toast.error('Select the vendor'); return; }
    if (lines.length === 0) { toast.error('Add at least one batch to return'); return; }
    if (reasonErr || lines.some(lineErr)) { toast.error('Please fix the highlighted fields'); return; }
    submit.mutate();
  };
  const addBatch = (id: string) => {
    const b = batches.data?.items.find((x) => x.id === id);
    if (!b || !product || lines.some((l) => l.batchId === b.id)) return;
    const onHand = b.balances.reduce((s, x) => s + num(x.quantity), 0);
    setLines((s) => [...s, { batchId: b.id, label: `${product.name} · ${b.batchNumber} · exp ${fmtDate(b.expiryDate)}`, onHand, quantity: '', rate: num(b.purchaseRate).toFixed(2) }]);
  };

  return (
    <Card title="Return to supplier (debit note)">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <VendorSelect vendors={vendors} value={vendorId} onChange={(v) => { setVendorId(v); setInvoiceId(''); setLines([]); }} error={tried && !vendorId ? 'Select the vendor' : undefined} />
        <Field label="Against invoice" hint="Recommended — caps returns at billed quantities">
          <Select value={invoiceId} disabled={!vendorId} onChange={(e) => { setInvoiceId(e.target.value); setLines([]); setProduct(null); }}>
            <option value="">— none —</option>
            {invoices.data?.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} · {fmtDate(i.invoiceDate)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Product">
          {invoice ? (
            <Select value={product?.id ?? ''} onChange={(e) => setProduct(invoiceProducts.find((p) => p.id === e.target.value) ?? null)}>
              <option value="">Select product…</option>
              {invoiceProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : (
            <ProductPicker disabled={!vendorId} onPick={(p) => setProduct({ id: p.id, name: p.name })} />
          )}
        </Field>
        <Field label="Batch" hint={product ? product.name : undefined}>
          <Select value="" disabled={!product} onChange={(e) => addBatch(e.target.value)}>
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
          {lines.map((l, i) => {
            const err = tried || l.quantity ? lineErr(l) : null;
            return (
              <div key={l.batchId} className="mc-anim-fade-in rounded-lg border border-line bg-subtle/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[12rem] flex-1 text-sm">
                    {l.label} <span className="text-xs text-faint">({l.onHand} on hand)</span>
                  </span>
                  <QtyInput className="w-20 text-right" decimals={3} placeholder="Qty" value={l.quantity} invalid={Boolean(err)} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, quantity: v } : x)))} aria-label="Return quantity" />
                  <MoneyInput className="w-28" value={l.rate} onChange={(v) => setLines((s) => s.map((x, j) => (j === i ? { ...x, rate: v } : x)))} aria-label="Return rate" />
                  <span className="w-24 text-right text-sm num">{money(num(l.quantity) * num(l.rate))}</span>
                  <Button variant="ghost" onClick={() => setLines((s) => s.filter((_, j) => j !== i))} aria-label="Remove line">
                    <Icon name="close" size={14} />
                  </Button>
                </div>
                {err ? <p className="mt-1 text-2xs font-medium text-danger">{err}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <Field label="Reason" required error={tried || reason ? reasonErr : undefined}>
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Near expiry / damaged in transit / recall / short-dated supply" />
          </Field>
        </div>
        <div className="flex items-end justify-end text-sm text-muted">Value {money(value)} + GST</div>
      </div>
      <div className="mt-3">
        <Button disabled={submit.isPending} onClick={post}>
          {submit.isPending ? 'Posting…' : 'Post debit note'}
        </Button>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

const STATUS_CHIPS: Partial<Record<Tab, Array<{ id: string; label: string; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }>>> = {
  orders: [
    { id: 'DRAFT', label: 'Draft', tone: 'neutral' },
    { id: 'SENT,CONFIRMED,PARTIALLY_RECEIVED', label: 'Open', tone: 'blue' },
    { id: 'RECEIVED', label: 'Received', tone: 'green' },
    { id: 'CANCELLED', label: 'Cancelled', tone: 'red' },
  ],
  receipts: [{ id: 'uninvoiced', label: 'Awaiting bill', tone: 'amber' }],
  invoices: [
    { id: 'PENDING,POSTED,PARTIALLY_PAID', label: 'Unpaid', tone: 'amber' },
    { id: 'PARTIALLY_PAID', label: 'Part paid', tone: 'amber' },
    { id: 'PAID', label: 'Paid', tone: 'green' },
    { id: 'CANCELLED', label: 'Cancelled', tone: 'red' },
  ],
};
const ENDPOINT: Record<Tab, string> = {
  orders: '/purchasing/purchase-orders',
  receipts: '/purchasing/goods-receipts',
  invoices: '/purchasing/invoices',
  payments: '/purchasing/payments',
  returns: '/purchasing/purchase-returns',
};
const QUERY_KEY: Record<Tab, string> = {
  orders: 'purchase-orders',
  receipts: 'goods-receipts',
  invoices: 'purchase-invoices',
  payments: 'supplier-payments',
  returns: 'purchase-returns',
};

function useList<T>(tab: Tab, active: Tab, params: { page: number; vendorId: string; search: string; status: string; id?: string }) {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: String(PAGE_SIZE) });
  if (params.id) qs.set('id', params.id);
  if (params.vendorId) qs.set('vendorId', params.vendorId);
  if (params.search) qs.set('search', params.search);
  if (params.status === 'uninvoiced') qs.set('uninvoiced', 'true');
  else if (params.status) qs.set('status', params.status);
  return useQuery({
    queryKey: [QUERY_KEY[tab], qs.toString()],
    queryFn: () => api<Paged<T>>(`${ENDPOINT[tab]}?${qs.toString()}`),
    enabled: tab === active,
    placeholderData: (prev) => prev,
    retry: false,
  });
}

function ListBody<T>({ q, empty, filtered, children }: { q: ReturnType<typeof useList<T>>; empty: { title: string; hint?: string }; filtered: boolean; children: (items: T[]) => React.ReactNode }) {
  if (q.isLoading) return <SkeletonRows rows={4} cols={5} />;
  if (q.error) {
    return <ErrorState message={q.error instanceof ApiClientError && q.error.status === 403 ? 'You do not have permission to view this list.' : 'Failed to load.'} retry={() => void q.refetch()} />;
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return filtered ? <EmptyState title="Nothing matches these filters" hint="Clear the vendor, status or search filters." /> : <EmptyState title={empty.title} hint={empty.hint} />;
  return <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>{children(items)}</div>;
}

function PurchasingInner() {
  const can = useCan();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [focusId, setFocusId] = useState<string | null>(null);
  const invalidate = useInvalidateAll();
  const { vendors } = useMasters();
  const [tab, setTab] = useState<Tab>('orders');
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && (['orders', 'receipts', 'invoices', 'payments', 'returns'] as string[]).includes(t)) setTab(t as Tab);
    const f = searchParams.get('focus');
    if (f && /^[0-9a-f-]{36}$/i.test(f)) {
      setTab('invoices');
      setFocusId(f);
    }
  }, [searchParams]);
  const clearFocus = () => {
    setFocusId(null);
    router.replace('/purchasing?tab=invoices');
  };
  const [vendorId, setVendorId] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<Partial<Record<Tab, string>>>({});
  const [page, setPage] = useState<Record<Tab, number>>({ orders: 1, receipts: 1, invoices: 1, payments: 1, returns: 1 });
  const [grnFor, setGrnFor] = useState<PORow | null | 'direct'>(null);
  const [billFor, setBillFor] = useState<GRNRow | null | 'direct'>(null);
  const [cancelPo, setCancelPo] = useState<PORow | null>(null);
  const resetPages = () => setPage({ orders: 1, receipts: 1, invoices: 1, payments: 1, returns: 1 });
  const params = (t: Tab) => ({ page: page[t], vendorId, search: debounced, status: status[t] ?? '' });
  const filtered = Boolean(vendorId || debounced || status[tab]);

  const summary = useQuery({ queryKey: ['purchasing-summary'], queryFn: () => api<Summary>('/purchasing/summary'), enabled: can('purchases.read') });
  const pos = useList<PORow>('orders', tab, params('orders'));
  const grns = useList<GRNRow>('receipts', tab, params('receipts'));
  const invoices = useList<InvoiceRow>('invoices', tab, { ...params('invoices'), id: focusId ?? undefined });
  const payments = useList<PaymentRow>('payments', tab, params('payments'));
  const returns = useList<ReturnRow>('returns', tab, params('returns'));

  const poAction = useMutation({
    meta: { silent: true },
    mutationFn: (v: { poId: string; action: 'send' | 'confirm' | 'cancel'; poNumber: string }) => api(`/purchasing/purchase-orders/${v.poId}/action`, { method: 'POST', body: { action: v.action } }),
    onSuccess: (_d, v) => {
      invalidate();
      setCancelPo(null);
      if (v.action === 'send') toast.success(`${v.poNumber} marked as sent`, 'Confirm it once the vendor accepts.');
      else if (v.action === 'confirm') toast.success(`${v.poNumber} confirmed`, 'Ready to receive goods.');
      else toast.info(`${v.poNumber} cancelled`);
    },
  });
  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchasing"
        subtitle="PO → goods receipt (batch + expiry) → supplier invoice (three-way match) → payment."
        actions={
          <>
            {can('purchases.receive') ? (
              <Button variant="secondary" onClick={() => setGrnFor('direct')}>
                <Icon name="purchasing" size={15} /> Receive without PO
              </Button>
            ) : null}
            {can('purchases.receive') ? <Button onClick={() => setBillFor('direct')}><Icon name="plus" size={15} strokeWidth={2.25} /> Supplier invoice</Button> : null}
          </>
        }
      />

      {can('purchases.read') ? (
        <KpiGrid bare cols={4}>
          <Stat label="Open orders" value={s ? s.openOrders : '…'} hint={s ? `${s.draftOrders} draft` : undefined} />
          <Stat label="Awaiting bill" value={s ? s.awaitingBill : '…'} hint="goods received, not invoiced" tone={s && s.awaitingBill > 0 ? 'amber' : 'green'} />
          <Stat
            label="Payables"
            value={s ? money(s.payable) : '…'}
            hint={s ? (Number(s.overdue) > 0 ? <span className="font-medium text-danger">{money(s.overdue)} overdue</span> : `${money(s.dueThisWeek)} due in 7 days`) : undefined}
            tone={s && Number(s.overdue) > 0 ? 'red' : s && Number(s.payable) > 0 ? 'amber' : 'neutral'}
          />
          <Stat label="Purchases this month" value={s ? money(s.monthPurchases) : '…'} hint={s ? `${s.monthInvoices} bills · ITC ${money(s.monthInputGst)}` : undefined} />
        </KpiGrid>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'orders', label: 'Purchase orders', count: pos.data?.pageInfo.totalItems },
          { id: 'receipts', label: 'Goods receipts', count: grns.data?.pageInfo.totalItems },
          { id: 'invoices', label: 'Supplier invoices', count: invoices.data?.pageInfo.totalItems },
          { id: 'payments', label: 'Payments', count: payments.data?.pageInfo.totalItems },
          { id: 'returns', label: 'Debit notes', count: returns.data?.pageInfo.totalItems },
        ]}
      />

      {tab === 'orders' && can('purchases.create') ? (
        <>
          <ReorderPanel vendors={vendors} />
          <NewPOCard />
        </>
      ) : null}
      {tab === 'payments' && can('purchases.pay') ? <PaymentForm /> : null}
      {tab === 'returns' && can('purchases.pay') ? <ReturnForm /> : null}

      <Card
        title={{ orders: 'Purchase orders', receipts: 'Goods receipts', invoices: 'Supplier invoices', payments: 'Payment history', returns: 'Debit notes' }[tab]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={vendorId} onChange={(e) => { setVendorId(e.target.value); resetPages(); }} className="w-full sm:w-52" aria-label="Filter by vendor">
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.legalName}
                </option>
              ))}
            </Select>
            <SearchInput value={search} onChange={(v) => { setSearch(v); resetPages(); }} placeholder="Document no. / UTR…" className="w-full sm:w-52" />
          </div>
        }
      >
        {tab === 'invoices' && focusId ? (
          <Alert
            className="mb-3"
            action={
              <Button variant="ghost" size="sm" onClick={clearFocus}>
                Show all invoices
              </Button>
            }
          >
            Showing the linked supplier invoice only.
          </Alert>
        ) : null}
        {STATUS_CHIPS[tab] ? (
          <div className="mb-3">
            <FilterChips<string>
              value={status[tab] ?? ''}
              onChange={(v) => {
                setStatus((st) => ({ ...st, [tab]: v }));
                setPage((p) => ({ ...p, [tab]: 1 }));
              }}
              options={STATUS_CHIPS[tab]!}
            />
          </div>
        ) : null}

        {tab === 'orders' ? (
          <ListBody q={pos} filtered={filtered} empty={{ title: 'No purchase orders', hint: 'Create a PO, send it to the vendor, then receive goods against it.' }}>
            {(items) => (
              <Table head={<tr><Th>PO</Th><Th>Vendor</Th><Th>Progress</Th><Th right>Value</Th><Th>Status</Th><Th right>Actions</Th></tr>}>
                {items.map((p) => {
                  const ordered = p.lines.reduce((sum, l) => sum + num(l.quantity), 0);
                  const received = p.lines.reduce((sum, l) => sum + num(l.receivedQty), 0);
                  const pct = ordered ? Math.round((received / ordered) * 100) : 0;
                  const value = p.lines.reduce((sum, l) => sum + num(l.quantity) * num(l.unitPrice), 0);
                  const late = p.expectedDate && ['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(p.status) && p.expectedDate.slice(0, 10) < todayIso();
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <div className="font-mono text-xs font-semibold">{p.poNumber}</div>
                        <div className={cn('text-xs', late ? 'font-medium text-danger' : 'text-muted')}>
                          {fmtDate(p.createdAt)}
                          {p.expectedDate ? ` · due ${fmtDate(p.expectedDate)}` : ''}
                          {late ? ' · late' : ''}
                        </div>
                      </Td>
                      <Td className="text-sm">{p.vendor.legalName}</Td>
                      <Td>
                        <div className="max-w-xs truncate text-xs text-neutral-600" title={p.lines.map((l) => `${l.product.name} ${num(l.receivedQty)}/${num(l.quantity)}`).join(' · ')}>
                          {p.lines.map((l) => `${l.product.name} ${num(l.receivedQty)}/${num(l.quantity)}`).join(' · ')}
                        </div>
                        <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
                        </div>
                      </Td>
                      <Td right className="text-sm">{money(value)}</Td>
                      <Td>
                        <StatusBadge status={p.status} tone={PO_TONE[p.status]} />
                      </Td>
                      <Td right>
                        <div className="flex justify-end gap-1.5">
                          {p.status === 'DRAFT' && can('purchases.approve') ? (
                            <Button variant="secondary" disabled={poAction.isPending} onClick={() => poAction.mutate({ poId: p.id, action: 'send', poNumber: p.poNumber })}>
                              Send
                            </Button>
                          ) : null}
                          {p.status === 'SENT' && can('purchases.approve') ? (
                            <Button variant="secondary" disabled={poAction.isPending} onClick={() => poAction.mutate({ poId: p.id, action: 'confirm', poNumber: p.poNumber })}>
                              Confirm
                            </Button>
                          ) : null}
                          {['SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(p.status) && can('purchases.receive') ? <Button variant="secondary" size="sm" onClick={() => setGrnFor(p)}>Receive</Button> : null}
                          {['DRAFT', 'SENT', 'CONFIRMED'].includes(p.status) && can('purchases.approve') ? (
                            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setCancelPo(p)}>
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </ListBody>
        ) : null}

        {tab === 'receipts' ? (
          <ListBody q={grns} filtered={filtered} empty={{ title: 'No goods received yet', hint: 'Receive against a confirmed PO or directly from a vendor.' }}>
            {(items) => (
              <Table head={<tr><Th>GRN</Th><Th>Vendor</Th><Th>Batches</Th><Th>Billing</Th><Th right /></tr>}>
                {items.map((g) => (
                  <Tr key={g.id}>
                    <Td>
                      <div className="font-mono text-xs font-semibold">{g.grnNumber}</div>
                      <div className="text-xs text-muted">
                        {fmtDate(g.receivedDate)}
                        {g.po ? ` · ${g.po.poNumber}` : ' · direct'}
                      </div>
                    </Td>
                    <Td className="text-sm">{g.vendor.legalName}</Td>
                    <Td className="text-xs text-neutral-600">
                      {g.lines.map((l) => {
                        const days = daysUntil(l.expiryDate.slice(0, 10));
                        return (
                          <div key={l.id}>
                            {l.product.name} · <span className="font-mono">{l.batchNumber}</span> · <span className={cn(days < SHORT_EXPIRY_DAYS && 'font-medium text-warning')}>exp {fmtDate(l.expiryDate)}</span> · {num(l.quantity)}
                            {num(l.freeQuantity) ? ` + ${num(l.freeQuantity)} free` : ''}
                          </div>
                        );
                      })}
                    </Td>
                    <Td>
                      {g.invoices.length ? (
                        <Badge tone="green">Billed · {g.invoices[0]!.invoiceNumber}</Badge>
                      ) : (
                        <Badge tone="amber" dot>
                          Awaiting bill
                        </Badge>
                      )}
                    </Td>
                    <Td right>
                      {!g.invoices.length && can('purchases.receive') ? (
                        <Button variant="secondary" onClick={() => setBillFor(g)}>
                          Post bill
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </Table>
            )}
          </ListBody>
        ) : null}

        {tab === 'invoices' ? (
          <ListBody q={invoices} filtered={filtered} empty={{ title: 'No supplier invoices', hint: 'Posted invoices book inventory, input GST credit and the payable.' }}>
            {(items) => (
              <Table head={<tr><Th>Invoice</Th><Th>Vendor</Th><Th>GRN</Th><Th right>Taxable</Th><Th right>GST</Th><Th right>Total</Th><Th right>Outstanding</Th><Th>Status</Th></tr>}>
                {items.map((i) => {
                  const out = num(i.total) - num(i.paidAmount);
                  const overdue = out > 0 && new Date(i.dueDate).getTime() < Date.now();
                  return (
                    <Tr key={i.id}>
                      <Td>
                        <div className="font-mono text-xs font-semibold">{i.invoiceNumber}</div>
                        <div className={cn('text-xs', overdue ? 'font-medium text-danger' : 'text-muted')}>
                          {fmtDate(i.invoiceDate)} · due {fmtDate(i.dueDate)}
                        </div>
                      </Td>
                      <Td className="text-sm">{i.vendor.legalName}</Td>
                      <Td className="font-mono text-xs">{i.grn?.grnNumber ?? '—'}</Td>
                      <Td right className="text-xs">{money(i.subtotal)}</Td>
                      <Td right className="text-xs">{money(i.taxAmount)}</Td>
                      <Td right className="font-semibold">{money(i.total)}</Td>
                      <Td right className={out > 0 ? 'font-medium text-warning' : 'text-faint'}>{out > 0 ? money(out) : '—'}</Td>
                      <Td>
                        <StatusBadge status={i.status} tone={INV_TONE[i.status]} />
                      </Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </ListBody>
        ) : null}

        {tab === 'payments' ? (
          <ListBody q={payments} filtered={filtered} empty={{ title: 'No supplier payments yet' }}>
            {(items) => (
              <Table head={<tr><Th>Payment</Th><Th>Vendor</Th><Th>Method</Th><Th>Applied to</Th><Th right>Amount</Th></tr>}>
                {items.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <div className="font-mono text-xs font-semibold">{p.paymentNumber}</div>
                      <div className="text-xs text-muted">{fmtDate(p.paymentDate)}</div>
                    </Td>
                    <Td className="text-sm">{p.vendor.legalName}</Td>
                    <Td className="text-xs">
                      {p.method}
                      {p.reference ? <span className="font-mono"> · {p.reference}</span> : ''}
                    </Td>
                    <Td className="text-xs text-neutral-600">{p.allocations.map((a) => `${a.invoice.invoiceNumber} ${money(a.amount)}`).join(', ')}</Td>
                    <Td right className="font-semibold">{money(p.amount)}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </ListBody>
        ) : null}

        {tab === 'returns' ? (
          <ListBody q={returns} filtered={filtered} empty={{ title: 'No purchase returns yet', hint: 'Return near-expiry, damaged or recalled stock to the supplier.' }}>
            {(items) => (
              <Table head={<tr><Th>Debit note</Th><Th>Vendor</Th><Th>Items</Th><Th>Reason</Th><Th right>GST</Th><Th right>Total</Th></tr>}>
                {items.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <div className="font-mono text-xs font-semibold">{r.returnNumber}</div>
                      <div className="text-xs text-muted">{fmtDate(r.createdAt)}</div>
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
          </ListBody>
        ) : null}

        <Pagination
          info={{ orders: pos, receipts: grns, invoices, payments, returns }[tab].data?.pageInfo}
          onChange={(n) => setPage((p) => ({ ...p, [tab]: n }))}
          label={{ orders: 'orders', receipts: 'receipts', invoices: 'invoices', payments: 'payments', returns: 'debit notes' }[tab]}
        />
      </Card>

      {grnFor ? <GrnDrawer po={grnFor === 'direct' ? null : grnFor} onClose={() => setGrnFor(null)} onDone={() => setGrnFor(null)} /> : null}
      {billFor ? <InvoiceDrawer grn={billFor === 'direct' ? null : billFor} onClose={() => setBillFor(null)} onDone={() => setBillFor(null)} /> : null}
      <ConfirmDialog
        open={Boolean(cancelPo)}
        tone="danger"
        title={`Cancel ${cancelPo?.poNumber ?? ''}?`}
        message={cancelPo ? `The order to ${cancelPo.vendor.legalName} will be closed and can no longer be received against. Inform the vendor if it was already sent.` : undefined}
        confirmLabel="Cancel PO"
        busy={poAction.isPending}
        onCancel={() => setCancelPo(null)}
        onConfirm={() => cancelPo && poAction.mutate({ poId: cancelPo.id, action: 'cancel', poNumber: cancelPo.poNumber })}
      />
    </div>
  );
}

export default function PurchasingPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} cols={5} />}>
      <PurchasingInner />
    </Suspense>
  );
}
