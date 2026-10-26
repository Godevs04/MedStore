'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { customerCreateSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Spinner, Table, SuccessBanner, ErrorBanner } from '@/components/ui';

interface CustomerRow {
  id: string;
  name: string;
  category: string | null;
  phone: string | null;
  gstin: string | null;
  creditDays: number;
  creditLimit: string;
  isWholesale: boolean;
  status: string;
}

type CustomerForm = z.input<typeof customerCreateSchema>;

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () =>
      api<{ items: CustomerRow[]; pageInfo: { totalItems: number } }>(
        `/partners/customers?page=1&pageSize=50${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CustomerForm>({
    resolver: zodResolver(customerCreateSchema),
    defaultValues: { name: '', creditDays: 0, creditLimit: '0.00', openingBalance: '0.00', isWholesale: false },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['customers'] });

  const create = useMutation({
    mutationFn: (data: CustomerForm) => api<CustomerRow>('/partners/customers', { method: 'POST', body: data }),
    onSuccess: (c) => {
      reset();
      setShowCreate(false);
      invalidate();
      setNotice(`Customer ${c.name} created.`);
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create customer'),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Customers</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search name / phone / GSTIN…"
            className="w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button onClick={() => setShowCreate((s) => !s)}>New customer</Button>
        </div>
      </div>

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {showCreate ? (
        <Card title="New customer">
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" onSubmit={handleSubmit((d) => create.mutate(d))}>
            <Field label="Name" error={errors.name?.message}>
              <Input {...register('name')} />
            </Field>
            <Field label="Category">
              <Input placeholder="Hospital / Walk-in / Retailer" {...register('category')} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} />
            </Field>
            <Field label="GSTIN" error={errors.gstin?.message}>
              <Input {...register('gstin')} />
            </Field>
            <Field label="Credit days">
              <Input type="number" {...register('creditDays', { valueAsNumber: true })} />
            </Field>
            <Field label="Credit limit (₹)">
              <Input placeholder="0.00" {...register('creditLimit')} />
            </Field>
            <Field label="Wholesale customer">
              <input type="checkbox" className="mt-2" {...register('isWholesale')} />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-4">
              <Button type="submit" disabled={isSubmitting || create.isPending}>
                {create.isPending ? 'Creating…' : 'Create customer'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={`Customers (${customers.data?.pageInfo.totalItems ?? 0})`}>
        {customers.isLoading ? (
          <Spinner />
        ) : customers.error ? (
          <ErrorState
            message={
              customers.error instanceof ApiClientError && customers.error.status === 403
                ? 'You do not have permission to view customers.'
                : 'Failed to load customers.'
            }
            retry={() => void customers.refetch()}
          />
        ) : (customers.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No customers yet" hint="Walk-in customers can be billed without an account once POS ships." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Credit</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            }
          >
            {customers.data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-neutral-50">
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-800">{c.name}</div>
                  {c.category ? <div className="text-xs text-neutral-500">{c.category}</div> : null}
                </td>
                <td className="px-3 py-2 text-sm">{c.phone ?? '—'}</td>
                <td className="px-3 py-2 text-sm">
                  {c.creditDays}d · ₹{c.creditLimit}
                </td>
                <td className="px-3 py-2">
                  {c.isWholesale ? <Badge tone="blue">Wholesale</Badge> : <Badge>Retail</Badge>}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={c.status === 'ACTIVE' ? 'green' : 'neutral'}>{c.status}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
