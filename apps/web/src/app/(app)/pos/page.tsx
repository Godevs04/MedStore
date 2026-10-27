'use client';

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, ErrorBanner, Field, Input, Select, cn, fmtDate, money } from '@/components/ui';

interface ProductOption {
  id: string;
  name: string;
  sku: string;
  genericName: string | null;
  strength: string | null;
  sellingPrice: string | null;
  mrp: string | null;
  prescriptionClass: string | null;
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

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string;
}

const H1 = new Set(['SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC']);
const toPaise = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const rupees = (paise: number) => (paise / 100).toFixed(2);
const linePaise = (l: CartLine) => Math.max(0, Math.round(toPaise(l.unitPrice) * (Number(l.quantity) || 0)) - toPaise(l.discount));
const WAREHOUSE_KEY = 'medicore.pos.warehouse';

/**
 * POS billing (spec §11): keyboard-first search, FEFO batch visibility,
 * line discounts, split tender (cash / UPI / card / credit) against the
 * whole-rupee rounded total, idempotent posting, H1 prescription capture.
 */
export default function PosPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [cashTendered, setCashTendered] = useState('');
  const [upiAmount, setUpiAmount] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [cardRef, setCardRef] = useState('');
  const [prescription, setPrescription] = useState({ patientName: '', prescriberName: '', prescriberAddress: '' });
  const [error, setError] = useState<string | null>(null);
  const idempotencyRef = useRef<string | null>(null);

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
    queryKey: ['pos-products', search],
    queryFn: () => api<{ items: ProductOption[] }>(`/catalog/products?page=1&pageSize=12&status=ACTIVE&search=${encodeURIComponent(search)}`),
    enabled: search.trim().length > 0,
  });
  const customers = useQuery({
    queryKey: ['pos-customers'],
    queryFn: () => api<{ items: CustomerOption[] }>('/partners/customers?page=1&pageSize=200'),
  });
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
  const rxComplete = !needsRx || (prescription.patientName.trim() && prescription.prescriberName.trim() && prescription.prescriberAddress.trim().length >= 3);
  const availableCredit = outstanding.data?.availableCredit != null ? toPaise(outstanding.data.availableCredit) : null;
  const creditBlocked = creditPaise > 0 && (!customerId || (availableCredit !== null && creditPaise > availableCredit));

  const lineIssues = (l: CartLine): string | null => {
    const rows = batchesByProduct.get(l.productId);
    const qty = Number(l.quantity) || 0;
    if (qty <= 0) return 'Quantity must be positive';
    if (l.mrp && toPaise(l.unitPrice) > toPaise(l.mrp)) return `Price above MRP ₹${l.mrp}`;
    if (toPaise(l.discount) > Math.round(toPaise(l.unitPrice) * qty)) return 'Discount exceeds line amount';
    if (!l.gstPercent) return 'No GST rate configured';
    if (!rows) return null;
    const pool = l.batchId ? rows.filter((b) => b.id === l.batchId) : rows.filter((b) => b.sellable);
    const avail = pool.reduce((s, b) => s + (b.sellable ? b.onHand : 0), 0);
    if (avail < qty) return avail === 0 ? 'No saleable stock' : `Only ${avail} saleable`;
    return null;
  };
  const anyIssue = cart.some((l) => lineIssues(l) !== null);

  const addToCart = useCallback((p: ProductOption) => {
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.id && !l.batchId);
      if (existing) return c.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l));
      return [
        ...c,
        {
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
        },
      ];
    });
    setSearch('');
    setHighlight(0);
    setError(null);
    searchRef.current?.focus();
  }, []);

  const lookupBarcode = async (code: string) => {
    try {
      const p = await api<ProductOption>(`/catalog/products/barcode/${encodeURIComponent(code)}`);
      addToCart(p);
      return true;
    } catch {
      return false;
    }
  };

  const updateLine = (key: string, patch: Partial<CartLine>) => setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const resetSale = () => {
    setCart([]);
    setCashTendered('');
    setUpiAmount('');
    setUpiRef('');
    setCardAmount('');
    setCardRef('');
    setCustomerId('');
    setWalkInName('');
    setPrescription({ patientName: '', prescriberName: '', prescriberAddress: '' });
    setError(null);
    idempotencyRef.current = null;
  };

  const invoice = useMutation({
    meta: { silent: true },
    mutationFn: () => {
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
          prescription: needsRx ? prescription : null,
        },
      });
    },
    onSuccess: (result) => {
      const change = changePaise;
      resetSale();
      void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['pos-batches'] });
      router.push(`/sales-history/${result.invoice.id}?posted=1${change > 0 ? `&change=${rupees(change)}` : ''}${result.idempotentReplay ? '&replay=1' : ''}`);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Sale failed — your cart is kept; retrying is safe.'),
  });

  const canCharge = cart.length > 0 && warehouseId && !anyIssue && !creditBlocked && !overpaidNonCash && rxComplete && !invoice.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (canCharge) invoice.mutate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCharge, invoice]);

  const results = products.data?.items ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="mc-anim-fade-up flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">POS billing</h1>
          <p className="text-xs text-neutral-500">
            <kbd className="rounded border border-neutral-200 bg-white px-1 font-mono">F2</kbd> search ·{' '}
            <kbd className="rounded border border-neutral-200 bg-white px-1 font-mono">↑↓ Enter</kbd> add ·{' '}
            <kbd className="rounded border border-neutral-200 bg-white px-1 font-mono">F9</kbd> charge · scan a barcode anytime
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Billing from</span>
          <Select
            className="w-64"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              window.localStorage.setItem(WAREHOUSE_KEY, e.target.value);
            }}
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
                    if (/^\d{6,}$/.test(code) && (await lookupBarcode(code))) return;
                    const pick = results[highlight];
                    if (pick) addToCart(pick);
                  }
                }}
                placeholder="Search by name, generic, SKU — or scan barcode"
                aria-label="Search product"
              />
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">⌕</span>
              {search.trim() ? (
                <div className="mc-anim-scale-in absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-xl">
                  {products.isLoading ? (
                    <p className="px-3 py-3 text-xs text-neutral-400">Searching…</p>
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
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-neutral-800">{[p.name, p.strength].filter(Boolean).join(' ')}</span>
                            {p.prescriptionClass && p.prescriptionClass !== 'OTC' ? <Badge tone="amber">{p.prescriptionClass.replace('_', ' ')}</Badge> : null}
                            {p.taxResolved === false ? <Badge tone="red">No GST rate</Badge> : null}
                          </span>
                          <span className="block truncate text-xs text-neutral-500">
                            <span className="font-mono">{p.sku}</span>
                            {p.genericName ? ` · ${p.genericName}` : ''}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums text-brand-700">{money(p.sellingPrice ?? p.mrp)}</span>
                          {p.mrp ? <span className="block text-[11px] text-neutral-400">MRP {money(p.mrp)}</span> : null}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </Card>

          <Card title={`Cart · ${cart.length} ${cart.length === 1 ? 'line' : 'lines'}`} actions={cart.length ? <Button variant="ghost" onClick={resetSale}>Clear</Button> : null}>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <span className="mc-anim-float flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-700 ring-1 ring-brand-100">⌁</span>
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
                            <Input className="w-14 px-1.5 text-center" inputMode="numeric" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value.replace(/[^\d]/g, '') })} aria-label="Quantity" />
                            <button className="h-7 w-7 rounded-md border border-neutral-200 bg-white text-neutral-600 hover:border-brand-300" onClick={() => updateLine(l.key, { quantity: String((Number(l.quantity) || 0) + 1) })} aria-label="Increase">+</button>
                          </div>
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <Input className="text-right" inputMode="decimal" value={l.unitPrice} onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })} aria-label="Unit price" />
                          {l.mrp ? <p className="mt-0.5 text-right text-[10px] text-neutral-400">MRP {money(l.mrp)}</p> : null}
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <Input className="text-right" inputMode="decimal" placeholder="0.00" value={l.discount} onChange={(e) => updateLine(l.key, { discount: e.target.value })} aria-label="Line discount" />
                        </div>
                        <div className="col-span-3 flex items-center justify-end gap-1 md:col-span-2">
                          <span className="text-sm font-semibold tabular-nums text-neutral-900">{money(rupees(linePaise(l)))}</span>
                          <Button variant="ghost" className="px-2" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} aria-label="Remove line">✕</Button>
                        </div>
                      </div>
                      {issue ? <p className="mt-1 text-xs font-medium text-red-600">⚠ {issue}</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {needsRx ? (
            <Card title="Schedule H1 prescription (Drugs Rules 65(3)(h) register)" className="border-amber-200">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Patient name *">
                  <Input value={prescription.patientName} onChange={(e) => setPrescription((s) => ({ ...s, patientName: e.target.value }))} />
                </Field>
                <Field label="Prescriber name *">
                  <Input value={prescription.prescriberName} onChange={(e) => setPrescription((s) => ({ ...s, prescriberName: e.target.value }))} />
                </Field>
                <Field label="Prescriber address *">
                  <Input value={prescription.prescriberAddress} onChange={(e) => setPrescription((s) => ({ ...s, prescriberAddress: e.target.value }))} />
                </Field>
              </div>
              <p className="mt-2 text-xs text-amber-700">These details are written to the statutory H1 register with the invoice and batch.</p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <Card title="Customer">
            <div className="space-y-2">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer">
                <option value="">Walk-in customer</option>
                {customers.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </Select>
              {customerId ? (
                outstanding.data ? (
                  <div className="flex justify-between rounded-lg bg-neutral-50 px-3 py-1.5 text-xs">
                    <span className="text-neutral-500">Outstanding {money(outstanding.data.outstanding)}</span>
                    <span className="font-medium text-neutral-700">
                      {outstanding.data.availableCredit != null ? `Credit available ${money(outstanding.data.availableCredit)}` : 'No credit limit set'}
                    </span>
                  </div>
                ) : null
              ) : (
                <Input placeholder="Walk-in name (optional)" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} />
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
                  <dd className="text-2xl font-bold tabular-nums tracking-tight text-neutral-900">{money(rupees(totalPaise))}</dd>
                </div>
              </dl>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Cash tendered">
                  <Input inputMode="decimal" value={cashTendered} onChange={(e) => setCashTendered(e.target.value)} placeholder="0.00" />
                </Field>
                <div className="flex items-end">
                  <Button variant="secondary" className="w-full" disabled={totalPaise === 0} onClick={() => setCashTendered(rupees(Math.max(0, totalPaise - nonCashPaise)))}>
                    Exact cash
                  </Button>
                </div>
                <Field label="UPI">
                  <Input inputMode="decimal" value={upiAmount} onChange={(e) => setUpiAmount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="UPI ref">
                  <Input value={upiRef} onChange={(e) => setUpiRef(e.target.value)} placeholder="UTR (optional)" />
                </Field>
                <Field label="Card">
                  <Input inputMode="decimal" value={cardAmount} onChange={(e) => setCardAmount(e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Card ref">
                  <Input value={cardRef} onChange={(e) => setCardRef(e.target.value)} placeholder="Approval / last 4" />
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
              {overpaidNonCash ? <ErrorBanner>UPI + card exceed the total due.</ErrorBanner> : null}
              {needsRx && !rxComplete ? <ErrorBanner>Complete the Schedule H1 prescription details.</ErrorBanner> : null}
              {error ? <ErrorBanner>{error}</ErrorBanner> : null}

              <Button className="w-full py-3 text-base" disabled={!canCharge} onClick={() => invoice.mutate()}>
                {invoice.isPending ? 'Posting…' : `Charge ${money(rupees(totalPaise))}`}
              </Button>
              <p className="text-center text-[11px] text-neutral-400">Posting is idempotent — retrying after a network error never double-bills.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
