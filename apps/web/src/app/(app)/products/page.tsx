'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { productCreateSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Input, Select, Spinner, Table, SuccessBanner, ErrorBanner, money } from '@/components/ui';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  mrp: string | null;
  sellingPrice: string | null;
  status: string;
  prescriptionClass: string | null;
  category?: { name: string } | null;
  barcodes: Array<{ barcode: string }>;
  hsnCode: string | null;
  purchasePrice: string | null;
  reorderLevel: number | null;
  taxResolved: boolean;
  gstPercent: string | null;
}

function EditProductDrawer({ product, onClose, onSaved }: { product: ProductRow; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState({
    name: product.name,
    hsnCode: product.hsnCode ?? '',
    mrp: product.mrp ?? '',
    sellingPrice: product.sellingPrice ?? '',
    purchasePrice: product.purchasePrice ?? '',
    prescriptionClass: product.prescriptionClass ?? '',
    reorderLevel: product.reorderLevel?.toString() ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    meta: { success: 'Product updated' },
    mutationFn: () =>
      api(`/catalog/products/${product.id}`, {
        method: 'PUT',
        body: {
          name: form.name.trim(),
          hsnCode: form.hsnCode.trim() || null,
          ...(form.mrp ? { mrp: form.mrp } : {}),
          ...(form.sellingPrice ? { sellingPrice: form.sellingPrice } : {}),
          ...(form.purchasePrice ? { purchasePrice: form.purchasePrice } : {}),
          ...(form.prescriptionClass ? { prescriptionClass: form.prescriptionClass } : {}),
          reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : null,
        },
      }),
    onSuccess: () => onSaved(`${form.name} updated.`),
  });
  return (
    <Drawer open onClose={onClose} title={`Edit ${product.name}`} subtitle={<span className="font-mono">{product.sku}</span>}>
      {!product.taxResolved ? (
        <ErrorBanner>No active GST rate resolves for this product — POS will refuse to bill it until the HSN matches a configured rate.</ErrorBanner>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Product name"><Input value={form.name} onChange={set('name')} /></Field>
        </div>
        <Field label="HSN code"><Input value={form.hsnCode} onChange={set('hsnCode')} placeholder="3004" /></Field>
        <Field label="Prescription class">
          <Select value={form.prescriptionClass} onChange={set('prescriptionClass')}>
            <option value="">—</option>
            {['OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="MRP (₹)"><Input value={form.mrp} onChange={set('mrp')} inputMode="decimal" /></Field>
        <Field label="Selling price (₹)"><Input value={form.sellingPrice} onChange={set('sellingPrice')} inputMode="decimal" /></Field>
        <Field label="Purchase price (₹)"><Input value={form.purchasePrice} onChange={set('purchasePrice')} inputMode="decimal" /></Field>
        <Field label="Reorder level"><Input value={form.reorderLevel} onChange={set('reorderLevel')} inputMode="numeric" /></Field>
      </div>
      {save.error ? <ErrorBanner>{save.error instanceof ApiClientError ? save.error.message : 'Failed to save'}</ErrorBanner> : null}
      <div className="flex gap-2">
        <Button disabled={save.isPending || !form.name.trim()} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Drawer>
  );
}

type ProductForm = z.input<typeof productCreateSchema>;

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [editing, setEditing] = useState<ProductRow | null>(null);

  const products = useQuery({
    queryKey: ['products', search],
    queryFn: () =>
      api<{ items: ProductRow[]; pageInfo: { totalItems: number } }>(
        `/catalog/products?page=1&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    retry: false,
  });

  // Empty optional fields must be omitted, not sent as "" (which would fail
  // server-side decimal/enum validation) — strip them before Zod validates.
  const stripEmpty = (values: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductForm>({
    resolver: async (values, context, options) => {
      const resolver = zodResolver(productCreateSchema) as unknown as (
        v: unknown,
        c: unknown,
        o: unknown,
      ) => Promise<unknown>;
      return (await resolver(stripEmpty(values as Record<string, unknown>), context, options)) as never;
    },
    defaultValues: { name: '', sku: '', status: 'ACTIVE', barcodes: [] },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['products'] });

  const create = useMutation({
    meta: { success: 'Product created' },
    mutationFn: (data: ProductForm) =>
      api<ProductRow>('/catalog/products', { method: 'POST', body: data }),
    onSuccess: (p) => {
      reset();
      setShowCreate(false);
      invalidate();
      setNotice(`Product ${p.sku} created.`);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create product'),
  });

  const deactivate = useMutation({
    meta: { success: 'Product deactivated' },
    mutationFn: (id: string) => api(`/catalog/products/${id}/deactivate`, { method: 'PUT' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to deactivate'),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="mc-anim-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Product catalog</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Medicines and SKUs with barcodes, pricing and resolved GST rates.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name / generic / SKU…"
            className="w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={() => setShowCreate((s) => !s)}>New product</Button>
        </div>
      </div>

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {showCreate ? (
        <Card title="New product">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-4"
            onSubmit={handleSubmit((d) => {
              create.mutate({
                ...(stripEmpty(d as Record<string, unknown>) as ProductForm),
                barcodes: barcode.trim() ? [barcode.trim()] : [],
              });
            })}
          >
            <Field label="Product name" error={errors.name?.message}>
              <Input {...register('name')} />
            </Field>
            <Field label="SKU" error={errors.sku?.message}>
              <Input {...register('sku')} />
            </Field>
            <Field label="Generic / salt name">
              <Input {...register('genericName')} />
            </Field>
            <Field label="Brand">
              <Input {...register('brand')} />
            </Field>
            <Field label="Dosage form">
              <Select {...register('dosageForm')}>
                <option value="">—</option>
                {['TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'DROPS', 'OINTMENT', 'CREAM', 'GEL', 'OTHER'].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </Select>
            </Field>
            <Field label="Strength">
              <Input placeholder="500mg" {...register('strength')} />
            </Field>
            <Field label="Pack size">
              <Input placeholder="10x10" {...register('packSize')} />
            </Field>
            <Field label="HSN code">
              <Input placeholder="3004" {...register('hsnCode')} />
            </Field>
            <Field label="MRP (₹)" error={errors.mrp?.message}>
              <Input placeholder="30.00" {...register('mrp')} />
            </Field>
            <Field label="Purchase price (₹)">
              <Input placeholder="20.00" {...register('purchasePrice')} />
            </Field>
            <Field label="Selling price (₹)">
              <Input placeholder="28.00" {...register('sellingPrice')} />
            </Field>
            <Field label="Prescription class">
              <Select {...register('prescriptionClass')}>
                <option value="">—</option>
                {['OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Barcode (optional)">
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-4">
              <Button type="submit" disabled={isSubmitting || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create product'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={`Products (${products.data?.pageInfo.totalItems ?? 0})`}>
        {products.isLoading ? (
          <Spinner />
        ) : products.error ? (
          <ErrorState
            message={
              products.error instanceof ApiClientError && products.error.status === 403
                ? 'You do not have permission to view the catalog.'
                : 'Failed to load products.'
            }
            retry={() => void products.refetch()}
          />
        ) : (products.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No products yet"
            hint="Create your first product or import a catalog from CSV in Phase 2's import tooling."
          />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">GST</th>
                <th className="px-3 py-2">MRP</th>
                <th className="px-3 py-2">Selling</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            }
          >
            {products.data?.items.map((p) => (
              <tr key={p.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-800">{p.name}</div>
                  <div className="text-xs text-neutral-500">
                    {[p.genericName, p.strength, p.dosageForm].filter(Boolean).join(' · ') || '—'}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2">
                  {p.prescriptionClass ? (
                    <Badge tone={p.prescriptionClass === 'OTC' ? 'green' : 'amber'}>{p.prescriptionClass}</Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">
                  {p.taxResolved ? (
                    <span className="text-xs text-neutral-600">
                      {p.gstPercent}% <span className="font-mono text-neutral-400">· {p.hsnCode}</span>
                    </span>
                  ) : (
                    <button onClick={() => setEditing(p)} title="No active GST rate — sales are blocked until fixed">
                      <Badge tone="red" dot>No rate{p.hsnCode ? ` · ${p.hsnCode}` : ''}</Badge>
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-sm tabular-nums">{p.mrp ? money(p.mrp) : '—'}</td>
                <td className="px-3 py-2 text-sm tabular-nums">{p.sellingPrice ? money(p.sellingPrice) : '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>{p.status}</Badge>
                </td>
                <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                  <Button variant="ghost" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  {p.status === 'ACTIVE' ? (
                    <Button variant="secondary" onClick={() => deactivate.mutate(p.id)}>
                      Deactivate
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing ? (
        <EditProductDrawer
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setNotice(msg);
            invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
