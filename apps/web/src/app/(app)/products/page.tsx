'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { productCreateSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select, Spinner, Table } from '@/components/ui';

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
}

type ProductForm = z.input<typeof productCreateSchema>;

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');

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
    mutationFn: (id: string) => api(`/catalog/products/${id}/deactivate`, { method: 'PUT' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to deactivate'),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Product catalog</h1>
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

      {notice ? <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{notice}</p> : null}
      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

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
                <td className="px-3 py-2 text-sm">{p.mrp ?? '—'}</td>
                <td className="px-3 py-2 text-sm">{p.sellingPrice ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={p.status === 'ACTIVE' ? 'green' : 'neutral'}>{p.status}</Badge>
                </td>
                <td className="px-3 py-2 text-right">
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
    </div>
  );
}
