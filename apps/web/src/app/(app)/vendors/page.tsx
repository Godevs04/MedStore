'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { vendorCreateSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select, Spinner, Table, SuccessBanner, ErrorBanner } from '@/components/ui';

interface VendorRow {
  id: string;
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  stateCode: string | null;
  phone: string | null;
  creditDays: number;
  creditLimit: string;
  status: string;
}

type VendorForm = z.input<typeof vendorCreateSchema>;

export default function VendorsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const vendors = useQuery({
    queryKey: ['vendors', search],
    queryFn: () =>
      api<{ items: VendorRow[]; pageInfo: { totalItems: number } }>(
        `/partners/vendors?page=1&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<VendorForm>({
    resolver: zodResolver(vendorCreateSchema),
    defaultValues: { legalName: '', gstRegistrationType: 'REGULAR', creditDays: 30, creditLimit: '0.00', openingBalance: '0.00' },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['vendors'] });

  const create = useMutation({
    mutationFn: (data: VendorForm) => api<VendorRow>('/partners/vendors', { method: 'POST', body: data }),
    onSuccess: (v) => {
      reset();
      setShowCreate(false);
      invalidate();
      setNotice(`Vendor ${v.legalName} created.`);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create vendor'),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vendors</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name / GSTIN…"
            className="w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={() => setShowCreate((s) => !s)}>New vendor</Button>
        </div>
      </div>

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {showCreate ? (
        <Card title="New vendor">
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" onSubmit={handleSubmit((d) => create.mutate(d))}>
            <Field label="Legal name" error={errors.legalName?.message}>
              <Input {...register('legalName')} />
            </Field>
            <Field label="Trade name">
              <Input {...register('tradeName')} />
            </Field>
            <Field label="GSTIN" error={errors.gstin?.message}>
              <Input placeholder="27ABCDE1234F1Z5" {...register('gstin')} />
            </Field>
            <Field label="State code (GST)" error={errors.stateCode?.message}>
              <Input placeholder="27" {...register('stateCode')} />
            </Field>
            <Field label="City">
              <Input {...register('city')} />
            </Field>
            <Field label="PIN code" error={errors.pinCode?.message}>
              <Input {...register('pinCode')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} />
            </Field>
            <Field label="Credit days">
              <Input type="number" {...register('creditDays', { valueAsNumber: true })} />
            </Field>
            <Field label="Credit limit (₹)">
              <Input placeholder="100000.00" {...register('creditLimit')} />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-4">
              <Button type="submit" disabled={isSubmitting || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create vendor'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={`Vendors (${vendors.data?.pageInfo.totalItems ?? 0})`}>
        {vendors.isLoading ? (
          <Spinner />
        ) : vendors.error ? (
          <ErrorState
            message={
              vendors.error instanceof ApiClientError && vendors.error.status === 403
                ? 'You do not have permission to view vendors.'
                : 'Failed to load vendors.'
            }
            retry={() => void vendors.refetch()}
          />
        ) : (vendors.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No vendors yet" hint="Add the distributors you purchase from." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">GSTIN</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Credit</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            }
          >
            {vendors.data?.items.map((v) => (
              <tr key={v.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-800">{v.legalName}</div>
                  {v.tradeName ? <div className="text-xs text-neutral-500">{v.tradeName}</div> : null}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{v.gstin ?? '—'}</td>
                <td className="px-3 py-2 text-sm">{v.phone ?? '—'}</td>
                <td className="px-3 py-2 text-sm">
                  {v.creditDays}d · ₹{v.creditLimit}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={v.status === 'ACTIVE' ? 'green' : 'neutral'}>{v.status}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
