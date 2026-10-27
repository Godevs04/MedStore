'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { prescriptionSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Combobox, ConfirmDialog, Kbd, MoneyInput, QtyInput, useDebouncedValue, useFieldErrors, type ComboItem } from '@/components/kit';
import { Badge, Button, Card, Field, Input, Select, cn, fmtDate, money } from '@/components/ui';
import { HeldBillsDrawer, QuickAddCustomer, SubstitutesPanel, type CustomerOption, type HeldBill, type Substitute } from './parts';

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  genericName: string | null;
  strength: string | null;
  sellingPrice: string | null;
  mrp: string | null;
  prescriptionClass: string | null;
  rackLocation?: string | null;
  requiresRefrigeration?: boolean;
  onHand?: number;
  taxResolved?: boolean;
  gstPercent?: string | null;
}

interface BatchRow {
  id: string;
  batchNumber: string;
  expiryDate: string;
  status: string;
  mrp: string;
  balances: Array<{ quantity: string }>;
}

interface CartLine {
  key: string;
  productId: string;
  name: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  mrp: string | null;
  discount: string;
  batchId: string;
  prescriptionClass: string | null;
  gstPercent: string | null;
}

interface Prescription {
  patientName: string;
  patientPhone: string;
  prescriberName: string;
  prescriberRegNo: string;
  prescriberAddress: string;
}

const EMPTY_RX: Prescription = { patientName: '', patientPhone: '', prescriberName: '', prescriberRegNo: '', prescriberAddress: '' };
const H1 = new Set(['SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC']);
const RATE = /^\d{1,12}(\.\d{1,2})?$/;
const toPaise = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const rupees = (paise: number) => (paise / 100).toFixed(2);
const linePaise = (l: CartLine) => Math.max(0, Math.round(toPaise(l.unitPrice) * (Number(l.quantity) || 0)) - toPaise(l.discount));
const WAREHOUSE_KEY = 'medicore.pos.warehouse';

function productLine(p: { id: string; name: string; strength: string | null; sku: string; sellingPrice: string | null; mrp: string | null; prescriptionClass: string | null; taxResolved?: boolean; gstPercent?: string | null }): CartLine {
  return {
    key: `${p.id}-${Date.now()}`,
    productId: p.id,
    name: [p.name, p.strength].filter(Boolean).join(' '),
    sku: p.sku,
    quantity: '1',
    unitPrice: Number(p.sellingPrice ?? p.mrp ?? 0).toFixed(2),
    mrp: p.mrp,
    discount: '',
    batchId: '',
    prescriptionClass: p.prescriptionClass,
    gstPercent: p.taxResolved === false ? null : (p.gstPercent ?? '—'),
  };
}

/**
 * POS billing (spec §11): keyboard-first search with live stock, FEFO batch
 * visibility, generic substitutes, held bills, split tender against the
 * whole-rupee rounded total, idempotent posting and H1 prescription capture.
 */
export default function PosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 200);
  const [highlight, setHighlight] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const debouncedCustomer = useDebouncedValue(customerQuery.trim(), 250);
  const [quickAdd, setQuickAdd] = useState(false);
  const [walkInName, setWalkInName] = useState('');
  const [cashTendered, setCashTendered] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [cardRef, setCardRef] = useState('');
  const [prescription, setPrescription] = useState<Prescription>(EMPTY_RX);
  const [substitutesFor, setSubstitutesFor] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [heldOpen, setHeldOpen] = useState(false);
  const rxErrors = useFieldErrors();
  const idempotencyRef = useRef<string | null>(null);
  const customerId = customer?.id ?? '';

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const branches = await api<Array<{ id: string; name: string; warehouses: Array<{ id: string; name: string }> }>>('/organizations/branches');
      return branches.flatMap((b) => b.warehouses.map((w) => ({ ...w, label: `${b.name} · ${w.name}` })));
    },
  });
  useEffect(() => {
    if (warehouseId || !warehouses.data?.length) return;
    const saved = window.localStorage.getItem(WAREHOUSE_KEY);
    setWarehouseId(warehouses.data.find((w) => w.id === saved)?.id ?? warehouses.data[0]!.id);
  }, [warehouses.data, warehouseId]);

  const products = useQuery({
    queryKey: ['pos-products', debouncedSearch, warehouseId],
    queryFn: () =>
      api<{ items: ProductOption[] }>(
        `/catalog/products?page=1&pageSize=12&status=ACTIVE&search=${encodeURIComponent(debouncedSearch)}${warehouseId ? `&stockWarehouseId=${warehouseId}` : ''}`,
      ),
    enabled: debouncedSearch.length > 0,
  });
  const customers = useQuery({
    queryKey: ['pos-customers', debouncedCustomer],
    queryFn: () => api<{ items: CustomerOption[] }>(`/partners/customers?page=1&pageSize=20&status=ACTIVE${debouncedCustomer ? `&search=${encodeURIComponent(debouncedCustomer)}` : ''}`),
  });
  const heldCount = useQuery({ queryKey: ['held-bills'], queryFn: () => api<HeldBill[]>('/sales/held-bills') });
  const outstanding = useQuery({
    queryKey: ['customer-outstanding', customerId],
    queryFn: () => api<{ outstanding: string; availableCredit: string | null }>(`/sales/customers/${customerId}/outstanding`),
    enabled: Boolean(customerId),
  });

  const productIds = useMemo(() => [...new Set(cart.map((l) => l.productId))], [cart]);
  const batchQueries = useQueries({
    queries: productIds.map((pid) => ({
      queryKey: ['pos-batches', warehouseId, pid],
      queryFn: () => api<{ items: BatchRow[] }>(`/inventory/batches?page=1&pageSize=50&warehouseId=${warehouseId}&productId=${pid}`),
      enabled: Boolean(warehouseId),
    })),
  });
  const batchesByProduct = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const m = new Map<string, Array<BatchRow & { onHand: number; sellable: boolean }>>();
    productIds.forEach((pid, i) => {
      const rows = (batchQueries[i]?.data?.items ?? []).map((b) => {
        const onHand = b.balances.reduce((s, x) => s + Number(x.quantity), 0);
        return { ...b, onHand, sellable: b.status === 'SALEABLE' && b.expiryDate.slice(0, 10) >= today && onHand > 0 };
      });
      m.set(pid, rows);
    });
    return m;
  }, [productIds, batchQueries]);

  const grossPaise = cart.reduce((s, l) => s + linePaise(l), 0);
  const totalPaise = Math.floor((grossPaise + 50) / 100) * 100;
  const roundOffPaise = totalPaise - grossPaise;
  const upiPaise = toPaise(upiAmount);
  const cardPaise = toPaise(cardAmount);
  const tenderedPaise = toPaise(cashTendered);
  const nonCashPaise = upiPaise + cardPaise;
  const cashAppliedPaise = Math.max(0, Math.min(tenderedPaise, totalPaise - nonCashPaise));
  const changePaise = Math.max(0, tenderedPaise - cashAppliedPaise);
  const creditPaise = Math.max(0, totalPaise - nonCashPaise - cashAppliedPaise);
  const overpaidNonCash = nonCashPaise > totalPaise;
  const needsRx = cart.some((l) => l.prescriptionClass && H1.has(l.prescriptionClass));
  const availableCredit = outstanding.data?.availableCredit != null ? toPaise(outstanding.data.availableCredit) : null;
  const creditBlocked = creditPaise > 0 && (!customerId || (availableCredit !== null && creditPaise > availableCredit));
  const itemCount = cart.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  const lineIssues = (l: CartLine): string | null => {
    const rows = batchesByProduct.get(l.productId);
    const qty = Number(l.quantity) || 0;
    if (qty <= 0) return 'Quantity must be at least 1';
    if (!RATE.test(l.unitPrice) || toPaise(l.unitPrice) <= 0) return 'Enter a rate like 45 or 45.50';
    if (l.discount && !RATE.test(l.discount)) return 'Discount must be an amount like 5 or 5.50';
    if (l.mrp && toPaise(l.unitPrice) > toPaise(l.mrp)) return `Rate is above MRP ₹${Number(l.mrp).toFixed(2)} (DPCO para 26)`;
    if (toPaise(l.discount) > Math.round(toPaise(l.unitPrice) * qty)) return 'Discount exceeds line amount';
    if (!l.gstPercent) return 'No GST rate configured for this HSN';
    if (!rows) return null;
    const pool = l.batchId ? rows.filter((b) => b.id === l.batchId) : rows.filter((b) => b.sellable);
    const avail = pool.reduce((s, b) => s + (b.sellable ? b.onHand : 0), 0);
    if (avail < qty) return avail === 0 ? 'No saleable stock' : `Only ${avail} saleable`;
    return null;
  };
  const anyIssue = cart.some((l) => lineIssues(l) !== null);

  const addToCart = useCallback((p: ProductOption) => {
    if (p.onHand === 0) toast.warning(`${p.name} is out of stock here`, 'Check substitutes on the cart line, or pick another warehouse.');
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.id && !l.batchId);
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [...c, productLine(p)];
    });
    setSearch('');
    setHighlight(0);
    searchRef.current?.focus();
  }, []);

  const lookupBarcode = async (code: string) => {
    try {
      const p = await api<ProductOption | null>(`/catalog/products/barcode/${encodeURIComponent(code)}`);
      if (!p) return false;
      addToCart(p);
      return true;
    } catch {
      return false;
    }
  };

  const updateLine = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const swapToSubstitute = (key: string, s: Substitute) => {
    setCart((c) => c.map((l) => (l.key === key ? { ...productLine({ ...s, gstPercent: l.gstPercent }), quantity: l.quantity, key: l.key } : l)));
    setSubstitutesFor(null);
    toast.success('Substitute added', `${s.name}${s.strength ? ` ${s.strength}` : ''} replaces the out-of-stock item.`);
  };

  const resetSale = () => {
    setCart([]);
    setCashTendered('');
    setUpiAmount('');
    setUpiRef('');
    setCardAmount('');
    setCardRef('');
    setCustomer(null);
    setWalkInName('');
    setPrescription(EMPTY_RX);
    rxErrors.clear();
    setSubstitutesFor(null);
    idempotencyRef.current = null;
  };

  const hold = useMutation({
    mutationFn: (label: string) =>
      api<HeldBill>('/sales/held-bills', {
        method: 'POST',
        body: { label, customerId: customer?.id ?? null, itemCount: Math.max(1, Math.round(itemCount)), total: rupees(totalPaise), payload: { cart, customer, walkInName, prescription } },
      }),
    meta: { success: 'Bill on hold' },
    onSuccess: () => {
      resetSale();
      setHoldOpen(false);
      setHoldLabel('');
      void queryClient.invalidateQueries({ queryKey: ['held-bills'] });
      searchRef.current?.focus();
    },
  });
  const discardHeld = useMutation({
    mutationFn: (id: string) => api(`/sales/held-bills/${id}`, { method: 'DELETE' }),
    meta: { silent: true },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['held-bills'] }),
  });
  const resume = (bill: HeldBill) => {
    if (cart.length > 0) {
      toast.warning('Finish the current bill first', 'Hold or clear the cart before resuming another bill.');
      return;
    }
    const p = bill.payload as { cart?: CartLine[]; customer?: CustomerOption | null; walkInName?: string; prescription?: Prescription };
    setCart((p.cart ?? []).map((l) => ({ ...l, key: `${l.productId}-${Math.random().toString(36).slice(2, 8)}` })));
    setCustomer(p.customer ?? null);
    setWalkInName(p.walkInName ?? '');
    setPrescription({ ...EMPTY_RX, ...(p.prescription ?? {}) });
    discardHeld.mutate(bill.id);
    setHeldOpen(false);
    toast.info('Bill resumed', `${bill.label} · ${money(bill.total)}`);
  };

  const invoice = useMutation({
    meta: { silent: true },
    mutationFn: (rx: Prescription | null) => {
      idempotencyRef.current ??= `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const payments: Array<{ method: 'CASH' | 'UPI' | 'CARD' | 'CREDIT'; amount: string; reference?: string | null }> = [];
      if (cashAppliedPaise > 0) payments.push({ method: 'CASH', amount: rupees(cashAppliedPaise) });
      if (upiPaise > 0) payments.push({ method: 'UPI', amount: rupees(upiPaise), reference: upiRef.trim() || null });
      if (cardPaise > 0) payments.push({ method: 'CARD', amount: rupees(cardPaise), reference: cardRef.trim() || null });
      if (creditPaise > 0) payments.push({ method: 'CREDIT', amount: rupees(creditPaise) });
      return api<{ invoice: { id: string; invoiceNumber: string }; idempotentReplay: boolean }>('/sales/invoices', {
        method: 'POST',
        body: {
          customerId: customerId || null,
          walkInName: customerId ? null : walkInName.trim() || null,
          warehouseId,
          lines: cart.map((l) => ({
            productId: l.productId,
            quantity: String(Number(l.quantity)),
            unitPrice: Number(l.unitPrice).toFixed(2),
            ...(toPaise(l.discount) > 0 ? { discountAmount: rupees(toPaise(l.discount)) } : {}),
            explicitBatchId: l.batchId || null,
          })),
          payments,
          idempotencyKey: idempotencyRef.current,
          prescription: rx,
        },
      });
    },
    onSuccess: (result) => {
      const change = changePaise;
      resetSale();
      toast.success(`Invoice ${result.invoice.invoiceNumber} posted`, change > 0 ? `Give change ${money(rupees(change))}` : undefined);
      void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['pos-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      router.push(`/sales-history/${result.invoice.id}?posted=1${change > 0 ? `&change=${rupees(change)}` : ''}${result.idempotentReplay ? '&replay=1' : ''}`);
    },
    onError: (e) => {
      if (e instanceof ApiClientError) {
        const rxDetails = e.details?.filter((d) => d.field?.startsWith('prescription.')).map((d) => ({ ...d, field: d.field!.slice('prescription.'.length) }));
        if (rxDetails?.length) rxErrors.setServerErrors(rxDetails);
      }
    },
  });

  const canCharge = cart.length > 0 && Boolean(warehouseId) && !anyIssue && !creditBlocked && !overpaidNonCash && !invoice.isPending;

  const charge = () => {
    if (!canCharge) return;
    let rx: Prescription | null = null;
    if (needsRx) {
      const parsed = rxErrors.validate(prescriptionSchema, {
        ...prescription,
        patientPhone: prescription.patientPhone.trim() || null,
        prescriberRegNo: prescription.prescriberRegNo.trim() || null,
      });
      if (!parsed) {
        toast.error('Complete the prescription', 'Schedule H1 items need patient and prescriber details for the register.');
        return;
      }
      rx = parsed as Prescription;
    }
    invoice.mutate(rx);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0) setHoldOpen(true);
      } else if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        charge();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const results = products.data?.items ?? [];
  const customerItems: ComboItem[] = useMemo(() => {
    const list = customers.data?.items ?? [];
    const merged = customer && !list.some((c) => c.id === customer.id) ? [customer, ...list] : list;
    return merged.map((c) => ({ id: c.id, label: c.name, sublabel: [c.phone, Number(c.creditLimit) > 0 ? `Credit limit ${money(c.creditLimit)}` : null].filter(Boolean).join(' · ') }));
  }, [customers.data, customer]);
  const setRx = (k: keyof Prescription) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setPrescription((s) => ({ ...s, [k]: e.target.value }));
    rxErrors.clear(k);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="mc-anim-fade-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">POS billing</h1>
          <p className="flex flex-wrap items-center gap-1 text-xs text-neutral-500">
            <Kbd>F2</Kbd> search · <Kbd><Icon name="arrowUp" size={10} strokeWidth={2.25} /><Icon name="arrowDown" size={10} strokeWidth={2.25} /></Kbd> <Kbd>Enter</Kbd> add · <Kbd>F8</Kbd> hold · <Kbd>F9</Kbd> charge · scan a barcode anytime
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setHeldOpen(true)}>
            <Icon name="pause" size={15} /> Held bills
            {heldCount.data?.length ? <span className="mc-anim-pop rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{heldCount.data.length}</span> : null}
          </Button>
          <span className="text-xs text-neutral-500">Billing from</span>
          <Select
            className="w-64"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              window.localStorage.setItem(WAREHOUSE_KEY, e.target.value);
            }}
            aria-label="Warehouse"
          >
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <Card className="relative z-30">
            <div className="relative">
              <Input
                ref={searchRef}
                autoFocus
                className="py-2.5 pl-9 text-base"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                  } else if (e.key === 'Escape') {
                    setSearch('');
                  } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    const code = search.trim();
                    if (/^\d{6,}$/.test(code)) {
                      if (await lookupBarcode(code)) return;
                      if (!results.length) toast.warning('Barcode not found', `No product has barcode ${code}.`);
                    }
                    const pick = results[highlight];
                    if (pick) addToCart(pick);
                  }
                }}
                placeholder="Search by name, generic, SKU — or scan barcode"
                aria-label="Search product"
              />
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              {search.trim() ? (
                <div className="mc-anim-scale-in absolute inset-x-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-xl">
                  {products.isLoading || search.trim() !== debouncedSearch ? (
                    <div className="space-y-1 p-1">
                      {[0, 1, 2].map((i) => <div key={i} className="mc-skeleton h-11 rounded-lg" style={{ animationDelay: `${i * 70}ms` }} />)}
                    </div>
                  ) : results.length === 0 ? (
                    <p className="px-3 py-3 text-center text-xs text-neutral-400">No matching active products</p>
                  ) : (
                    results.map((p, i) => (
                      <button
                        key={p.id}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => addToCart(p)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                          i === highlight ? 'bg-brand-50' : 'hover:bg-neutral-50',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium text-neutral-800">{[p.name, p.strength].filter(Boolean).join(' ')}</span>
                            {p.prescriptionClass && p.prescriptionClass !== 'OTC' ? <Badge tone="amber">{p.prescriptionClass.replace('_', ' ')}</Badge> : null}
                            {p.requiresRefrigeration ? <Badge tone="blue"><Icon name="cold" size={11} /> Cold chain</Badge> : null}
                            {p.taxResolved === false ? <Badge tone="red">No GST rate</Badge> : null}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            <span className="font-mono">{p.sku}</span>
                            {p.genericName ? ` · ${p.genericName}` : ''}
                            {p.rackLocation ? ` · Rack ${p.rackLocation}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-semibold tabular-nums text-brand-700">{money(p.sellingPrice ?? p.mrp)}</span>
                          {p.onHand !== undefined ? (
                            <span className={cn('block text-[11px] font-medium tabular-nums', p.onHand > 0 ? 'text-emerald-700' : 'text-red-600')}>
                              {p.onHand > 0 ? `${p.onHand.toLocaleString('en-IN')} in stock` : 'Out of stock'}
                            </span>
                          ) : p.mrp ? (
                            <span className="block text-[11px] text-neutral-400">MRP {money(p.mrp)}</span>
                          ) : null}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </Card>

          <Card
            title={`Cart · ${cart.length} ${cart.length === 1 ? 'line' : 'lines'}`}
            actions={
              cart.length ? (
                <div className="flex gap-1">
                  <Button variant="ghost" onClick={() => setHoldOpen(true)}><Icon name="pause" size={15} /> Hold</Button>
                  <Button variant="ghost" onClick={resetSale}>Clear</Button>
                </div>
              ) : null
            }
          >
            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <span className="mc-anim-float flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><Icon name="pos" size={24} /></span>
                <p className="text-sm text-neutral-500">Search or scan to start a bill. Batches are picked first-expiry-first-out automatically.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-12 gap-2 px-2 text-[11px] font-medium uppercase tracking-wider text-neutral-400 md:grid">
                  <span className="col-span-4">Item · batch</span>
                  <span className="col-span-2 text-right">Qty</span>
                  <span className="col-span-2 text-right">Rate</span>
                  <span className="col-span-2 text-right">Disc ₹</span>
                  <span className="col-span-2 text-right">Amount</span>
                </div>
                {cart.map((l) => {
                  const rows = batchesByProduct.get(l.productId) ?? [];
                  const fefo = rows.find((b) => b.sellable);
                  const issue = lineIssues(l);
                  const stockIssue = issue === 'No saleable stock' || issue?.startsWith('Only ');
                  return (
                    <div key={l.key} className={cn('mc-anim-fade-up rounded-xl border px-3 py-2.5 transition-colors', issue ? 'border-red-200 bg-red-50/40' : 'border-neutral-200 bg-neutral-50/40')}>
                      <div className="grid grid-cols-12 items-start gap-2">
                        <div className="col-span-12 min-w-0 md:col-span-4">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-neutral-800">{l.name}</span>
                            {l.prescriptionClass && l.prescriptionClass !== 'OTC' ? <Badge tone="amber">{l.prescriptionClass.replace('_', ' ')}</Badge> : null}
                          </div>
                          <Select className="mt-1 py-1 text-xs" value={l.batchId} onChange={(e) => updateLine(l.key, { batchId: e.target.value })} aria-label="Batch">
                            <option value="">
                              Auto FEFO{fefo ? ` · ${fefo.batchNumber} · exp ${fmtDate(fefo.expiryDate)} · ${fefo.onHand} left` : ''}
                            </option>
                            {rows.map((b) => (
                              <option key={b.id} value={b.id} disabled={!b.sellable}>
                                {b.batchNumber} · exp {fmtDate(b.expiryDate)} · {b.onHand} on hand{!b.sellable ? ` · ${b.onHand === 0 ? 'empty' : b.status === 'SALEABLE' ? 'expired' : b.status.toLowerCase()}` : ''}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <div className="flex items-center justify-end gap-1">
                            <button className="h-7 w-7 rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-brand-300" onClick={() => updateLine(l.key, { quantity: String(Math.max(1, (Number(l.quantity) || 1) - 1)) })} aria-label="Decrease">−</button>
                            <QtyInput className="w-14 px-1.5 text-center" value={l.quantity} onChange={(v) => updateLine(l.key, { quantity: v })} aria-label="Quantity" invalid={!(Number(l.quantity) > 0)} />
                            <button className="h-7 w-7 rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-brand-300" onClick={() => updateLine(l.key, { quantity: String((Number(l.quantity) || 0) + 1) })} aria-label="Increase">+</button>
                          </div>
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <MoneyInput value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: v })} aria-label="Unit price" className="[&_input]:text-right" invalid={Boolean(l.mrp && toPaise(l.unitPrice) > toPaise(l.mrp))} />
                          {l.mrp ? <p className="mt-0.5 text-right text-[10px] text-neutral-400">MRP {money(l.mrp)}</p> : null}
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <MoneyInput value={l.discount} onChange={(v) => updateLine(l.key, { discount: v })} aria-label="Line discount" className="[&_input]:text-right" />
                        </div>
                        <div className="col-span-3 flex items-center justify-end gap-1 md:col-span-2">
                          <span className="text-sm font-semibold tabular-nums text-neutral-900">{money(rupees(linePaise(l)))}</span>
                          <Button variant="ghost" className="px-2" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} aria-label="Remove line"><Icon name="close" size={14} /></Button>
                        </div>
                      </div>
                      {issue ? (
                        <p className="mc-anim-shake mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-red-600">
                          <Icon name="warning" size={13} /> {issue}
                          {stockIssue && warehouseId ? (
                            <button className="rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50" onClick={() => setSubstitutesFor(substitutesFor === l.key ? null : l.key)}>
                              Show substitutes
                            </button>
                          ) : null}
                        </p>
                      ) : null}
                      {substitutesFor === l.key ? (
                        <SubstitutesPanel productId={l.productId} warehouseId={warehouseId} onPick={(s) => swapToSubstitute(l.key, s)} onClose={() => setSubstitutesFor(null)} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {needsRx ? (
            <Card title="Schedule H1 prescription (Drugs Rules 65(3)(h) register)" className="border-amber-200">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Patient name" required error={rxErrors.errors.patientName}>
                  <Input value={prescription.patientName} onChange={setRx('patientName')} />
                </Field>
                <Field label="Patient mobile" error={rxErrors.errors.patientPhone} hint="Optional · 10-digit Indian mobile">
                  <Input inputMode="tel" value={prescription.patientPhone} onChange={setRx('patientPhone')} />
                </Field>
                <Field label="Prescriber name" required error={rxErrors.errors.prescriberName}>
                  <Input value={prescription.prescriberName} onChange={setRx('prescriberName')} placeholder="Dr." />
                </Field>
                <Field label="Prescriber reg. no." error={rxErrors.errors.prescriberRegNo} hint="State medical council registration">
                  <Input value={prescription.prescriberRegNo} onChange={setRx('prescriberRegNo')} placeholder="MMC 2010/12345" />
                </Field>
                <Field label="Prescriber address" required error={rxErrors.errors.prescriberAddress} className="sm:col-span-2">
                  <Input value={prescription.prescriberAddress} onChange={setRx('prescriberAddress')} />
                </Field>
              </div>
              <p className="mt-2 text-xs text-amber-700">These details are written to the statutory H1 register with the invoice and batch.</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <Card title="Customer">
            <div className="space-y-2">
              <Combobox
                items={customerItems}
                value={customer?.id ?? null}
                onChange={(id) => setCustomer(id ? ((customers.data?.items ?? []).find((c) => c.id === id) ?? (customer?.id === id ? customer : null)) : null)}
                onSearch={setCustomerQuery}
                loading={customers.isFetching}
                placeholder="Walk-in — search name or mobile"
                emptyText="No customer found"
                footer={
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-brand-700 hover:bg-brand-50" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuickAdd(true)}>
                    <Icon name="plus" size={14} strokeWidth={2.25} /> Add new customer{customerQuery.trim() ? ` “${customerQuery.trim()}”` : ''}
                  </button>
                }
              />
              {customer ? (
                outstanding.data ? (
                  <div className="mc-anim-fade-in flex justify-between rounded-lg bg-neutral-50 px-3 py-1.5 text-xs">
                    <span className="text-neutral-500">Outstanding {money(outstanding.data.outstanding)}</span>
                    <span className="font-medium text-neutral-700">
                      {outstanding.data.availableCredit != null ? `Credit available ${money(outstanding.data.availableCredit)}` : 'No credit limit set'}
                    </span>
                  </div>
                ) : null
              ) : (
                <Input placeholder="Walk-in name (optional)" value={walkInName} maxLength={120} onChange={(e) => setWalkInName(e.target.value)} />
              )}
            </div>
          </Card>

          <Card title="Payment">
            <div className="space-y-3">
              <dl className="space-y-1 rounded-xl bg-gradient-to-b from-neutral-50 to-white px-3 py-2.5 text-sm ring-1 ring-neutral-100">
                <div className="flex justify-between text-neutral-500"><dt>Items (incl. GST)</dt><dd className="tabular-nums">{money(rupees(grossPaise))}</dd></div>
                <div className="flex justify-between text-neutral-500"><dt>Round off</dt><dd className="tabular-nums">{roundOffPaise >= 0 ? '+' : '−'}{money(rupees(Math.abs(roundOffPaise)))}</dd></div>
                <div className="flex items-baseline justify-between border-t border-neutral-100 pt-1.5">
                  <dt className="font-medium text-neutral-700">Total due</dt>
                  <dd key={totalPaise} className="mc-anim-pop text-2xl font-bold tabular-nums tracking-tight text-neutral-900">{money(rupees(totalPaise))}</dd>
                </div>
              </dl>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Cash tendered">
                  <MoneyInput value={cashTendered} onChange={setCashTendered} aria-label="Cash tendered" />
                </Field>
                <div className="flex items-end">
                  <Button variant="secondary" className="w-full" disabled={totalPaise === 0} onClick={() => setCashTendered(rupees(Math.max(0, totalPaise - nonCashPaise)))}>
                    Exact cash
                  </Button>
                </div>
                <Field label="UPI">
                  <MoneyInput value={upiAmount} onChange={setUpiAmount} aria-label="UPI amount" />
                </Field>
                <Field label="UPI ref" hint="12-digit UTR / RRN">
                  <Input value={upiRef} maxLength={22} onChange={(e) => setUpiRef(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))} placeholder="Optional" />
                </Field>
                <Field label="Card">
                  <MoneyInput value={cardAmount} onChange={setCardAmount} aria-label="Card amount" />
                </Field>
                <Field label="Card ref">
                  <Input value={cardRef} maxLength={40} onChange={(e) => setCardRef(e.target.value)} placeholder="Approval / last 4" />
                </Field>
              </div>

              {changePaise > 0 ? (
                <div className="mc-anim-scale-in flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <span className="text-sm font-medium text-emerald-800">Change due</span>
                  <span className="text-lg font-bold tabular-nums text-emerald-700">{money(rupees(changePaise))}</span>
                </div>
              ) : null}
              {creditPaise > 0 && cart.length > 0 ? (
                <div className={cn('mc-anim-fade-up rounded-xl border px-3 py-2 text-xs', creditBlocked ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                  On credit: <span className="font-semibold">{money(rupees(creditPaise))}</span>
                  {!customerId ? ' — select a registered customer to bill on credit.' : creditBlocked ? ' — exceeds available credit.' : ''}
                </div>
              ) : null}
              {overpaidNonCash ? <p className="mc-anim-shake text-xs font-medium text-red-600">UPI + card exceed the total due.</p> : null}

              <Button className="w-full py-3 text-base" disabled={!canCharge} onClick={charge}>
                {invoice.isPending ? 'Posting…' : `Charge ${money(rupees(totalPaise))}`}
              </Button>
              <p className="text-center text-[11px] text-neutral-400">Posting is idempotent — retrying after a network error never double-bills.</p>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={holdOpen}
        title="Hold this bill?"
        message={`${cart.length} line${cart.length === 1 ? '' : 's'} · ${money(rupees(totalPaise))}. Stock is not deducted until you resume and charge.`}
        confirmLabel="Hold bill"
        busy={hold.isPending}
        onCancel={() => setHoldOpen(false)}
        onConfirm={() => hold.mutate(holdLabel.trim() || customer?.name || walkInName.trim() || `Bill ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`)}
      >
        <Field label="Label" hint="Customer name or token number — defaults to the customer or time">
          <Input autoFocus value={holdLabel} maxLength={60} onChange={(e) => setHoldLabel(e.target.value)} placeholder={customer?.name ?? (walkInName || 'e.g. Token 14')} />
        </Field>
      </ConfirmDialog>
      <HeldBillsDrawer open={heldOpen} onClose={() => setHeldOpen(false)} onResume={resume} />
      <QuickAddCustomer
        open={quickAdd}
        initialName={customerQuery.trim()}
        onClose={() => setQuickAdd(false)}
        onCreated={(c) => {
          setCustomer(c);
          void queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
        }}
      />
    </div>
  );
}
