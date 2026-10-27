'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { DOSAGE_FORMS, PRESCRIPTION_CLASSES } from '@medicore/shared-types';
import { priceLadderIssues, productCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { qtyFmt, useCan } from '@/lib/stock';
import {
  ConfirmDialog,
  FilterChips,
  FormSection,
  KpiGrid,
  MoneyInput,
  Pagination,
  QtyInput,
  SearchInput,
  SortableTh,
  useDebouncedValue,
  useFieldErrors,
  type PageInfo,
  type SortState,
} from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Th, Textarea, Tr, cn, money } from '@/components/ui';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  brand: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  categoryId: string | null;
  manufacturerId: string | null;
  mrp: string | null;
  sellingPrice: string | null;
  purchasePrice: string | null;
  tradePrice: string | null;
  status: string;
  prescriptionClass: string | null;
  storageInstructions: string | null;
  requiresRefrigeration: boolean;
  rackLocation: string | null;
  reorderLevel: number | null;
  maxStockLevel: number | null;
  minOrderQuantity: number | null;
  category?: { id: string; name: string } | null;
  manufacturer?: { id: string; name: string } | null;
  barcodes: Array<{ barcode: string }>;
  hsnCode: string | null;
  taxResolved: boolean;
  gstPercent: string | null;
  onHand?: number;
}

interface StockSummary {
  products: { total: number; active: number; inactive: number; inStock: number; outOfStock: number; belowReorder: number };
  value: { cost: string; mrp: string; potentialMargin: string };
}

type SortField = 'name' | 'sku' | 'mrp' | 'sellingPrice' | 'createdAt';

const CLASS_LABEL: Record<string, string> = {
  OTC: 'OTC',
  PRESCRIPTION_ONLY: 'Rx (Sch. H)',
  SCHEDULE_H1: 'Schedule H1',
  SCHEDULE_X: 'Schedule X',
  NARCOTIC: 'NDPS',
};
const CLASS_HINT: Record<string, string> = {
  OTC: 'Sold without prescription.',
  PRESCRIPTION_ONLY: 'Schedule H — sell only against a prescription.',
  SCHEDULE_H1: 'Schedule H1 — prescription details are recorded in the H1 register (kept 3 years).',
  SCHEDULE_X: 'Schedule X — retain a copy of the prescription; separate stock register.',
  NARCOTIC: 'NDPS Act — narcotic/psychotropic, strict register and licence required.',
};

const num = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
function marginPct(selling: string | null | undefined, purchase: string | null | undefined): number | null {
  const s = num(selling);
  const p = num(purchase);
  if (s === null || p === null || s <= 0) return null;
  return ((s - p) / s) * 100;
}

// ── Product form ─────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  sku: string;
  genericName: string;
  brand: string;
  categoryId: string;
  manufacturerId: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  hsnCode: string;
  mrp: string;
  purchasePrice: string;
  sellingPrice: string;
  tradePrice: string;
  prescriptionClass: string;
  storageInstructions: string;
  requiresRefrigeration: boolean;
  rackLocation: string;
  reorderLevel: string;
  maxStockLevel: string;
  minOrderQuantity: string;
  barcodes: string;
}

const blankForm = (barcode = ''): FormState => ({
  name: '',
  sku: '',
  genericName: '',
  brand: '',
  categoryId: '',
  manufacturerId: '',
  dosageForm: '',
  strength: '',
  packSize: '',
  hsnCode: '',
  mrp: '',
  purchasePrice: '',
  sellingPrice: '',
  tradePrice: '',
  prescriptionClass: '',
  storageInstructions: '',
  requiresRefrigeration: false,
  rackLocation: '',
  reorderLevel: '',
  maxStockLevel: '',
  minOrderQuantity: '',
  barcodes: barcode,
});

const formOf = (p: ProductRow): FormState => ({
  name: p.name,
  sku: p.sku,
  genericName: p.genericName ?? '',
  brand: p.brand ?? '',
  categoryId: p.categoryId ?? '',
  manufacturerId: p.manufacturerId ?? '',
  dosageForm: p.dosageForm ?? '',
  strength: p.strength ?? '',
  packSize: p.packSize ?? '',
  hsnCode: p.hsnCode ?? '',
  mrp: p.mrp ? Number(p.mrp).toFixed(2) : '',
  purchasePrice: p.purchasePrice ? Number(p.purchasePrice).toFixed(2) : '',
  sellingPrice: p.sellingPrice ? Number(p.sellingPrice).toFixed(2) : '',
  tradePrice: p.tradePrice ? Number(p.tradePrice).toFixed(2) : '',
  prescriptionClass: p.prescriptionClass ?? '',
  storageInstructions: p.storageInstructions ?? '',
  requiresRefrigeration: p.requiresRefrigeration,
  rackLocation: p.rackLocation ?? '',
  reorderLevel: p.reorderLevel?.toString() ?? '',
  maxStockLevel: p.maxStockLevel?.toString() ?? '',
  minOrderQuantity: p.minOrderQuantity?.toString() ?? '',
  barcodes: p.barcodes.map((b) => b.barcode).join(', '),
});

function buildBody(f: FormState, mode: 'create' | 'update') {
  const empty = mode === 'create' ? undefined : null;
  const str = (v: string) => (v.trim() ? v.trim() : empty);
  const int = (v: string) => (v.trim() ? Number(v) : empty);
  return {
    name: f.name.trim(),
    sku: f.sku.trim(),
    genericName: str(f.genericName),
    brand: str(f.brand),
    categoryId: str(f.categoryId),
    manufacturerId: str(f.manufacturerId),
    dosageForm: str(f.dosageForm),
    strength: str(f.strength),
    packSize: str(f.packSize),
    hsnCode: str(f.hsnCode),
    mrp: str(f.mrp),
    purchasePrice: str(f.purchasePrice),
    sellingPrice: str(f.sellingPrice),
    tradePrice: str(f.tradePrice),
    prescriptionClass: str(f.prescriptionClass),
    storageInstructions: str(f.storageInstructions),
    requiresRefrigeration: f.requiresRefrigeration,
    rackLocation: str(f.rackLocation),
    reorderLevel: int(f.reorderLevel),
    maxStockLevel: int(f.maxStockLevel),
    minOrderQuantity: int(f.minOrderQuantity),
    barcodes: f.barcodes
      .split(/[,\s]+/)
      .map((b) => b.trim())
      .filter(Boolean),
  };
}

function useTaxonomy() {
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: string; name: string }>>('/catalog/categories'), staleTime: 60_000 });
  const manufacturers = useQuery({ queryKey: ['manufacturers'], queryFn: () => api<Array<{ id: string; name: string }>>('/catalog/manufacturers'), staleTime: 60_000 });
  return { categories: categories.data ?? [], manufacturers: manufacturers.data ?? [] };
}

function ProductForm({
  initial,
  mode,
  productId,
  taxResolved,
  onDone,
  onCancel,
}: {
  initial: FormState;
  mode: 'create' | 'update';
  productId?: string;
  taxResolved?: boolean;
  onDone: (p: ProductRow) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(initial);
  const { errors, clear, validate, setServerErrors } = useFieldErrors();
  const { categories, manufacturers } = useTaxonomy();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    clear(k);
  };

  const dupKey = useDebouncedValue(mode === 'create' ? `${f.name.trim()}|${f.strength.trim()}` : '', 400);
  const dupes = useQuery({
    queryKey: ['product-dupes', dupKey],
    queryFn: () => {
      const [name, strength] = dupKey.split('|');
      return api<Array<{ matches: Array<{ id: string; name: string; strength: string | null }> }>>('/catalog/products/duplicates-check', {
        method: 'POST',
        body: [{ name, strength: strength || null }],
      });
    },
    enabled: dupKey.split('|')[0]!.length >= 3,
  });
  const dupMatches = dupes.data?.[0]?.matches ?? [];

  const margin = marginPct(f.sellingPrice, f.purchasePrice);
  const discount = num(f.mrp) && num(f.sellingPrice) !== null ? ((num(f.mrp)! - num(f.sellingPrice)!) / num(f.mrp)!) * 100 : null;

  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (body: Record<string, unknown>) =>
      mode === 'create'
        ? api<ProductRow>('/catalog/products', { method: 'POST', body })
        : api<ProductRow>(`/catalog/products/${productId}`, { method: 'PUT', body }),
    onSuccess: (p) => {
      toast.success(mode === 'create' ? 'Product created' : 'Product updated', `${p.name} (${p.sku})`);
      onDone(p);
    },
    onError: (e) => {
      if (e instanceof ApiClientError && setServerErrors(e.details)) toast.error('Please fix the highlighted fields', e.message);
      else toast.error(mode === 'create' ? 'Could not create product' : 'Could not save product', e instanceof ApiClientError ? e.message : undefined);
    },
  });

  const submit = () => {
    const body = buildBody(f, mode);
    const extra: Record<string, string> = {};
    for (const i of priceLadderIssues({ mrp: body.mrp, sellingPrice: body.sellingPrice, purchasePrice: body.purchasePrice, tradePrice: body.tradePrice })) {
      extra[i.field] ??= i.message;
    }
    if (body.reorderLevel && body.maxStockLevel && body.maxStockLevel < body.reorderLevel) extra.maxStockLevel = 'Max stock must be at least the reorder level';
    if (body.sellingPrice && !body.mrp) extra.mrp = 'Enter the MRP printed on the pack (Legal Metrology rules)';
    if (new Set(body.barcodes).size !== body.barcodes.length) extra.barcodes = 'Duplicate barcode in the list';
    const parsed = validate(productCreateSchema, mode === 'create' ? body : { ...body, status: undefined }, extra);
    if (!parsed) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate(body);
  };

  return (
    <div className="space-y-4">
      {mode === 'update' && taxResolved === false ? (
        <p className="mc-anim-fade-in rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-200">
          No active GST rate matches HSN {f.hsnCode || '(blank)'} — POS will refuse to bill this product until you fix the HSN or add a rate in Configuration.
        </p>
      ) : null}
      <FormSection title="Identity">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Product name" required error={errors.name} className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Dolo 650 Tablet" autoFocus={mode === 'create'} />
          </Field>
          {dupMatches.length > 0 ? (
            <p className="mc-anim-fade-in -mt-1 text-[11px] font-medium text-amber-700 sm:col-span-2">
              <Icon name="warning" size={13} /> Similar product exists: {dupMatches.map((m) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`).join(', ')}. Check before creating a duplicate.
            </p>
          ) : null}
          <Field label="SKU" required error={errors.sku} hint="Letters, digits, dot, dash or underscore">
            <Input value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder="DOLO-650" className="font-mono" />
          </Field>
          <Field label="Generic / salt" error={errors.genericName} hint="Used to suggest substitutes at POS">
            <Input value={f.genericName} onChange={(e) => set('genericName', e.target.value)} placeholder="Paracetamol" />
          </Field>
          <Field label="Brand" error={errors.brand}>
            <Input value={f.brand} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field label="Manufacturer" error={errors.manufacturerId}>
            <Select value={f.manufacturerId} onChange={(e) => set('manufacturerId', e.target.value)}>
              <option value="">—</option>
              {manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" error={errors.categoryId}>
            <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dosage form" error={errors.dosageForm}>
            <Select value={f.dosageForm} onChange={(e) => set('dosageForm', e.target.value)}>
              <option value="">—</option>
              {DOSAGE_FORMS.map((d) => (
                <option key={d} value={d}>
                  {d.charAt(0) + d.slice(1).toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Strength" error={errors.strength}>
              <Input value={f.strength} onChange={(e) => set('strength', e.target.value)} placeholder="650mg" />
            </Field>
            <Field label="Pack size" error={errors.packSize}>
              <Input value={f.packSize} onChange={(e) => set('packSize', e.target.value)} placeholder="15 tabs" />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title="GST & pricing" hint="Prices are per sale unit. MRP ≥ selling ≥ purchase price.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="HSN code" error={errors.hsnCode} hint="Medicines: 3003 / 3004">
            <Input value={f.hsnCode} onChange={(e) => set('hsnCode', e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="3004" className="font-mono" />
          </Field>
          <Field label="MRP" error={errors.mrp}>
            <MoneyInput value={f.mrp} onChange={(v) => set('mrp', v)} invalid={Boolean(errors.mrp)} />
          </Field>
          <Field label="Selling price" error={errors.sellingPrice} hint={discount !== null && discount > 0 ? `${discount.toFixed(1)}% below MRP` : undefined}>
            <MoneyInput value={f.sellingPrice} onChange={(v) => set('sellingPrice', v)} invalid={Boolean(errors.sellingPrice)} />
          </Field>
          <Field label="Purchase price" error={errors.purchasePrice}>
            <MoneyInput value={f.purchasePrice} onChange={(v) => set('purchasePrice', v)} invalid={Boolean(errors.purchasePrice)} />
          </Field>
          <Field label="Trade price (PTR)" error={errors.tradePrice} hint="Price to retailer, for wholesale">
            <MoneyInput value={f.tradePrice} onChange={(v) => set('tradePrice', v)} invalid={Boolean(errors.tradePrice)} />
          </Field>
          <div className="col-span-1 flex items-end sm:col-span-3">
            {margin !== null ? (
              <div className="mc-anim-fade-in w-full rounded-lg bg-white px-3 py-2 ring-1 ring-neutral-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">Gross margin on selling price</span>
                  <span className={cn('font-semibold tabular-nums', margin < 0 ? 'text-red-600' : margin < 10 ? 'text-amber-700' : 'text-emerald-700')}>{margin.toFixed(1)}%</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </FormSection>

      <FormSection title="Regulatory & storage">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Schedule / class" error={errors.prescriptionClass} hint={f.prescriptionClass ? CLASS_HINT[f.prescriptionClass] : 'Drugs & Cosmetics Rules schedule'}>
            <Select value={f.prescriptionClass} onChange={(e) => set('prescriptionClass', e.target.value)}>
              <option value="">—</option>
              {PRESCRIPTION_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {CLASS_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rack location" error={errors.rackLocation} hint="Printed on count sheets and picking lists">
            <Input value={f.rackLocation} onChange={(e) => set('rackLocation', e.target.value.toUpperCase())} placeholder="A-03" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
            <input type="checkbox" checked={f.requiresRefrigeration} onChange={(e) => set('requiresRefrigeration', e.target.checked)} className="h-4 w-4 rounded border-neutral-300 text-brand-600" />
            Cold chain — store at 2–8 °C
          </label>
          <Field label="Storage instructions" error={errors.storageInstructions} className="sm:col-span-2">
            <Textarea rows={2} value={f.storageInstructions} onChange={(e) => set('storageInstructions', e.target.value)} placeholder="Store below 25 °C, protect from light" />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Stock levels & barcodes">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Reorder level" error={errors.reorderLevel} hint="Shows in reorder suggestions">
            <QtyInput value={f.reorderLevel} onChange={(v) => set('reorderLevel', v)} invalid={Boolean(errors.reorderLevel)} />
          </Field>
          <Field label="Max stock" error={errors.maxStockLevel}>
            <QtyInput value={f.maxStockLevel} onChange={(v) => set('maxStockLevel', v)} invalid={Boolean(errors.maxStockLevel)} />
          </Field>
          <Field label="Min order qty" error={errors.minOrderQuantity}>
            <QtyInput value={f.minOrderQuantity} onChange={(v) => set('minOrderQuantity', v)} invalid={Boolean(errors.minOrderQuantity)} />
          </Field>
          <Field label="Barcodes" error={errors.barcodes ?? errors['barcodes.0']} hint="Up to 10, separated by commas" className="col-span-3">
            <Input value={f.barcodes} onChange={(e) => set('barcodes', e.target.value)} placeholder="8901234567890" className="font-mono" />
          </Field>
        </div>
      </FormSection>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : mode === 'create' ? 'Create product' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

const FIELD_LABEL: Record<string, string> = {
  mrp: 'MRP',
  sellingPrice: 'Selling price',
  purchasePrice: 'Purchase price',
  tradePrice: 'Trade price',
  hsnCode: 'HSN',
  prescriptionClass: 'Schedule',
  reorderLevel: 'Reorder level',
  maxStockLevel: 'Max stock',
  minOrderQuantity: 'Min order qty',
  rackLocation: 'Rack',
  requiresRefrigeration: 'Cold chain',
  genericName: 'Generic',
  categoryId: 'Category',
  manufacturerId: 'Manufacturer',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v as string | number);
}

function ProductHistory({ productId }: { productId: string }) {
  const history = useQuery({
    queryKey: ['product-history', productId],
    queryFn: () =>
      api<{ items: Array<{ id: string; changeType: string; createdAt: string; actorName: string | null; details: { changes?: Record<string, { from: unknown; to: unknown }>; fields?: string[] } | null }> }>(
        `/catalog/products/${productId}/history`,
      ),
  });
  if (history.isLoading) return <SkeletonRows rows={4} cols={3} />;
  if (history.error) return <ErrorState message="Could not load history" retry={() => void history.refetch()} />;
  const items = history.data?.items ?? [];
  if (items.length === 0) return <EmptyState title="No changes recorded" />;
  const tone = (t: string) => (t === 'CREATED' ? 'green' : t === 'DEACTIVATED' ? 'red' : t === 'REACTIVATED' ? 'blue' : 'neutral');
  return (
    <ol className="relative space-y-3 border-l border-neutral-200 pl-4">
      {items.map((h, i) => (
        <li key={h.id} className="mc-anim-fade-up relative" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={tone(h.changeType)}>{h.changeType.charAt(0) + h.changeType.slice(1).toLowerCase()}</Badge>
            <span className="text-neutral-500">{new Date(h.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span className="text-neutral-400">by {h.actorName ?? 'system'}</span>
          </div>
          {h.details?.changes && Object.keys(h.details.changes).length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {Object.entries(h.details.changes).map(([k, c]) => (
                <li key={k} className="text-neutral-600">
                  <span className="font-medium text-neutral-800">{FIELD_LABEL[k] ?? k}</span>: <span className="text-neutral-400 line-through">{show(c.from)}</span> → <span className="font-medium">{show(c.to)}</span>
                </li>
              ))}
            </ul>
          ) : h.details?.fields?.length ? (
            <p className="mt-1 text-xs text-neutral-500">Fields: {h.details.fields.map((k) => FIELD_LABEL[k] ?? k).join(', ')}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ProductDrawer({ product, onClose, onSaved }: { product: ProductRow; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'details' | 'history'>('details');
  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-3xl"
      title={product.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{product.sku}</span>
          <Badge tone={product.status === 'ACTIVE' ? 'green' : 'neutral'}>{product.status.toLowerCase()}</Badge>
          {product.onHand !== undefined ? <span>{qtyFmt(product.onHand)} saleable on hand</span> : null}
        </span>
      }
    >
      <Tabs
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'details' ? (
        <ProductForm initial={formOf(product)} mode="update" productId={product.id} taxResolved={product.taxResolved} onDone={onSaved} onCancel={onClose} />
      ) : (
        <ProductHistory productId={product.id} />
      )}
    </Drawer>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function ProductsInner() {
  const qc = useQueryClient();
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState('');
  const dSearch = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | 'DRAFT' | ''>('ACTIVE');
  const [klass, setKlass] = useState<string>('');
  const [categoryId, setCategoryId] = useState('');
  const [sort, setSort] = useState<SortState<SortField>>({ field: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [scan, setScan] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState<ProductRow | null>(null);
  const { categories } = useTaxonomy();

  useEffect(() => setPage(1), [dSearch, status, klass, categoryId, sort]);

  const qs = new URLSearchParams({ page: String(page), pageSize: '25', withStock: 'true', sortBy: sort.field, sortDirection: sort.direction });
  if (dSearch) qs.set('search', dSearch);
  if (status) qs.set('status', status);
  if (klass) qs.set('prescriptionClass', klass);
  if (categoryId) qs.set('categoryId', categoryId);
  const products = useQuery({
    queryKey: ['products', qs.toString()],
    queryFn: () => api<{ items: ProductRow[]; pageInfo: PageInfo }>(`/catalog/products?${qs.toString()}`),
    placeholderData: (prev) => prev,
  });
  const summary = useQuery({ queryKey: ['stock-summary'], queryFn: () => api<StockSummary>('/inventory/stock-summary'), enabled: can('inventory.read') });

  const focusId = params.get('focus');
  const openById = useCallback(async (id: string) => {
    try {
      const res = await api<{ items: ProductRow[] }>(`/catalog/products?page=1&pageSize=1&withStock=true&ids=${id}`);
      if (res.items[0]) setEditing(res.items[0]);
      else toast.error('Product not found');
    } catch {
      toast.error('Product not found');
    }
  }, []);
  useEffect(() => {
    if (focusId) void openById(focusId);
  }, [focusId, openById]);

  const closeEditor = () => {
    setEditing(null);
    if (focusId) router.replace('/products');
  };

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['stock-summary'] });
    void qc.invalidateQueries({ queryKey: ['product-history'] });
  };

  const deactivate = useMutation({
    meta: { silent: true },
    mutationFn: (p: ProductRow) => api(`/catalog/products/${p.id}/deactivate`, { method: 'PUT' }),
    onSuccess: (_, p) => {
      toast.success('Product deactivated', `${p.name} is hidden from POS and purchasing.`);
      setConfirmDeactivate(null);
      refresh();
    },
  });
  const reactivate = useMutation({
    meta: { silent: true },
    mutationFn: (p: ProductRow) => api(`/catalog/products/${p.id}/reactivate`, { method: 'PUT' }),
    onSuccess: (_, p) => {
      toast.success('Product reactivated', p.name);
      refresh();
    },
  });

  const lookup = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (code: string) => api<ProductRow | null>(`/catalog/products/barcode/${encodeURIComponent(code)}`),
    onSuccess: (p, code) => {
      setScan('');
      if (p) {
        void openById(p.id);
        toast.info('Product found', `${p.name} (${p.sku})`);
      } else if (can('products.create')) {
        setCreating(code);
        toast.info('New barcode', 'No active product has this barcode — create it now.');
      } else {
        toast.warning('No product with this barcode', code);
      }
    },
    onError: () => toast.error('Barcode lookup failed'),
  });

  const s = summary.data;
  const items = products.data?.items ?? [];
  const filtered = Boolean(dSearch || klass || categoryId || status !== 'ACTIVE');

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Product catalog"
        subtitle="Medicines and SKUs with schedule, HSN-based GST, pricing ladder and live stock."
        actions={
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = scan.trim();
                if (code.length < 4) {
                  toast.warning('Scan or type a barcode (at least 4 characters)');
                  return;
                }
                lookup.mutate(code);
              }}
              className="relative"
            >
              <Icon name="barcode" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <Input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Scan barcode…" className="w-44 pl-8 font-mono" aria-label="Scan barcode" />
            </form>
            {can('products.create') ? <Button onClick={() => setCreating('')}><Icon name="plus" size={15} strokeWidth={2.25} /> New product</Button> : null}
          </>
        }
      />

      {s ? (
        <KpiGrid cols={4}>
          <Stat label="Active products" value={s.products.active.toLocaleString('en-IN')} hint={`${s.products.inactive} inactive`} tone="blue" />
          <Stat
            label="Out of stock"
            value={s.products.outOfStock.toLocaleString('en-IN')}
            hint={`${s.products.inStock} in stock`}
            tone={s.products.outOfStock > 0 ? 'amber' : 'green'}
            delay={60}
          />
          <Stat
            label="Below reorder level"
            value={s.products.belowReorder.toLocaleString('en-IN')}
            hint="Open reorder suggestions →"
            tone={s.products.belowReorder > 0 ? 'red' : 'green'}
            href="/purchasing"
            delay={120}
          />
          <Stat label="Stock value (cost)" value={money(s.value.cost)} hint={`MRP value ${money(s.value.mrp)} · margin ${money(s.value.potentialMargin)}`} tone="green" delay={180} />
        </KpiGrid>
      ) : null}

      <Card
        title={`Products (${products.data?.pageInfo.totalItems ?? 0})`}
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Name, generic, brand or SKU…" className="w-72" />}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <FilterChips
            options={[
              { id: 'ACTIVE', label: 'Active', tone: 'green' },
              { id: 'INACTIVE', label: 'Inactive', tone: 'neutral' },
              { id: 'DRAFT', label: 'Draft', tone: 'amber' },
            ]}
            value={status}
            onChange={setStatus}
          />
          <span className="h-4 w-px bg-neutral-200" />
          <FilterChips
            options={PRESCRIPTION_CLASSES.map((c) => ({ id: c, label: CLASS_LABEL[c] ?? c, tone: c === 'OTC' ? ('green' as const) : ('amber' as const) }))}
            value={klass}
            onChange={setKlass}
            allLabel="Any schedule"
          />
          {categories.length > 0 ? (
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-44" aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        {products.isLoading ? (
          <SkeletonRows rows={6} cols={7} />
        ) : products.error ? (
          <ErrorState
            message={products.error instanceof ApiClientError && products.error.status === 403 ? 'You do not have permission to view the catalog.' : 'Failed to load products.'}
            retry={() => void products.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={filtered ? 'No products match these filters' : 'No products yet'}
            hint={filtered ? 'Clear the search or filters to see more.' : 'Create your first product, or bulk-load your catalogue from Import.'}
            action={!filtered && can('products.create') ? <Button onClick={() => setCreating('')}><Icon name="plus" size={15} strokeWidth={2.25} /> New product</Button> : undefined}
          />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <SortableTh label="Product" field="name" sort={sort} onSort={setSort} />
                  <SortableTh label="SKU" field="sku" sort={sort} onSort={setSort} />
                  <Th>Schedule</Th>
                  <Th>GST</Th>
                  <SortableTh label="MRP" field="mrp" sort={sort} onSort={setSort} right />
                  <SortableTh label="Selling" field="sellingPrice" sort={sort} onSort={setSort} right />
                  <Th right>Margin</Th>
                  <Th right>On hand</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              }
            >
              {items.map((p) => {
                const m = marginPct(p.sellingPrice, p.purchasePrice);
                const low = p.status === 'ACTIVE' && (p.reorderLevel ?? 0) > 0 && (p.onHand ?? 0) <= (p.reorderLevel ?? 0);
                return (
                  <Tr key={p.id} className="mc-anim-fade-in" onClick={() => setEditing(p)}>
                    <Td>
                      <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                        {p.name}
                        {p.requiresRefrigeration ? (
                          <span title="Cold chain 2–8 °C" className="text-sky-600">
                            <Icon name="cold" size={13} label="Cold chain" />
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {[p.genericName, p.strength, p.dosageForm?.toLowerCase(), p.rackLocation ? `Rack ${p.rackLocation}` : null].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </Td>
                    <Td className="font-mono text-xs">{p.sku}</Td>
                    <Td>{p.prescriptionClass ? <Badge tone={p.prescriptionClass === 'OTC' ? 'green' : p.prescriptionClass === 'PRESCRIPTION_ONLY' ? 'blue' : 'amber'}>{CLASS_LABEL[p.prescriptionClass]}</Badge> : <span className="text-neutral-400">—</span>}</Td>
                    <Td>
                      {p.taxResolved ? (
                        <span className="text-xs text-neutral-600">
                          {Number(p.gstPercent)}% <span className="font-mono text-neutral-400">· {p.hsnCode}</span>
                        </span>
                      ) : (
                        <Badge tone="red" dot>
                          No rate{p.hsnCode ? ` · ${p.hsnCode}` : ''}
                        </Badge>
                      )}
                    </Td>
                    <Td right>{p.mrp ? money(p.mrp) : '—'}</Td>
                    <Td right>{p.sellingPrice ? money(p.sellingPrice) : '—'}</Td>
                    <Td right className={cn('text-xs', m === null ? 'text-neutral-400' : m < 0 ? 'font-semibold text-red-600' : m < 10 ? 'text-amber-700' : 'text-emerald-700')}>
                      {m === null ? '—' : `${m.toFixed(1)}%`}
                    </Td>
                    <Td right>
                      <span className={cn('font-medium', (p.onHand ?? 0) <= 0 ? 'text-neutral-400' : low ? 'text-red-600' : 'text-neutral-800')}>{qtyFmt(p.onHand ?? 0)}</span>
                      {low ? <div className="text-[10px] text-red-600">≤ reorder {p.reorderLevel}</div> : null}
                    </Td>
                    <Td>
                      <Badge tone={p.status === 'ACTIVE' ? 'green' : p.status === 'DRAFT' ? 'amber' : 'neutral'}>{p.status.toLowerCase()}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <span onClick={(e) => e.stopPropagation()} className="inline-flex gap-1">
                        {p.status === 'ACTIVE' && can('products.deactivate') ? (
                          <Button variant="ghost" onClick={() => setConfirmDeactivate(p)}>
                            Deactivate
                          </Button>
                        ) : p.status !== 'ACTIVE' && can('products.deactivate') ? (
                          <Button variant="secondary" disabled={reactivate.isPending} onClick={() => reactivate.mutate(p)}>
                            Reactivate
                          </Button>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </Table>
            <Pagination info={products.data?.pageInfo} onChange={setPage} label="products" />
          </>
        )}
      </Card>

      {creating !== null ? (
        <Drawer open onClose={() => setCreating(null)} title="New product" subtitle="Fields marked * are required. GST is resolved from the HSN code." width="max-w-3xl">
          <ProductForm
            initial={blankForm(creating)}
            mode="create"
            onDone={() => {
              setCreating(null);
              refresh();
            }}
            onCancel={() => setCreating(null)}
          />
        </Drawer>
      ) : null}
      {editing ? (
        <ProductDrawer
          key={editing.id}
          product={editing}
          onClose={closeEditor}
          onSaved={() => {
            closeEditor();
            refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmDeactivate)}
        tone="danger"
        title={`Deactivate ${confirmDeactivate?.name ?? ''}?`}
        message={
          <>
            It will be hidden from POS, purchasing and reorder suggestions. Existing stock and history stay; you can reactivate it any time.
            {confirmDeactivate?.onHand ? <span className="mt-1 block font-medium text-amber-700">{qtyFmt(confirmDeactivate.onHand)} units are still on hand.</span> : null}
          </>
        }
        confirmLabel="Deactivate"
        busy={deactivate.isPending}
        onConfirm={() => confirmDeactivate && deactivate.mutate(confirmDeactivate)}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={6} cols={6} />}>
      <ProductsInner />
    </Suspense>
  );
}

