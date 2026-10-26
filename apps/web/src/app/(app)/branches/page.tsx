'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { branchCreateSchema, warehouseCreateSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, ErrorState, Field, Input, Spinner, Table } from '@/components/ui';

interface BranchRow {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  stateCode: string | null;
  isDefault: boolean;
  isActive: boolean;
  isBillingEnabled: boolean;
  warehouses: Array<{ id: string; name: string; code: string | null; isDefault: boolean }>;
}

type BranchForm = z.infer<typeof branchCreateSchema>;
type WarehouseForm = z.infer<typeof warehouseCreateSchema>;

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [warehouseFor, setWarehouseFor] = useState<string | null>(null);

  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: () => api<BranchRow[]>('/organizations/branches'),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BranchForm>({ resolver: zodResolver(branchCreateSchema), defaultValues: { name: '', isBillingEnabled: true } });

  const whForm = useForm<WarehouseForm>({ resolver: zodResolver(warehouseCreateSchema), defaultValues: { name: '', isDefault: false } });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['branches'] });

  const createBranch = useMutation({
    mutationFn: (data: BranchForm) => api<BranchRow>('/organizations/branches', { method: 'POST', body: data }),
    onSuccess: () => {
      reset();
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create branch'),
  });

  const createWarehouse = useMutation({
    mutationFn: (vars: { branchId: string; data: WarehouseForm }) =>
      api(`/organizations/branches/${vars.branchId}/warehouses`, { method: 'POST', body: vars.data }),
    onSuccess: () => {
      whForm.reset();
      setWarehouseFor(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create warehouse'),
  });

  if (branches.isLoading) return <Spinner />;
  if (branches.error) {
    const message =
      branches.error instanceof ApiClientError && branches.error.status === 403
        ? 'You do not have permission to view branches.'
        : 'Failed to load branches.';
    return <ErrorState message={message} retry={() => void branches.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-lg font-semibold">Branches & warehouses</h1>
      {error ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      <Card title={`Branches (${branches.data?.length ?? 0})`}>
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2">Warehouses</th>
              <th className="px-3 py-2"></th>
            </tr>
          }
        >
          {branches.data?.map((b) => (
            <tr key={b.id} className="align-top hover:bg-neutral-50">
              <td className="px-3 py-2">
                <div className="font-medium text-neutral-800">{b.name}</div>
                {b.code ? <div className="font-mono text-xs text-neutral-500">{b.code}</div> : null}
              </td>
              <td className="px-3 py-2 text-sm text-neutral-600">
                {b.city ?? '—'}
                {b.stateCode ? `, ${b.stateCode}` : ''}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {b.isDefault ? <Badge tone="blue">Default</Badge> : null}
                  {b.isBillingEnabled ? <Badge tone="green">Billing</Badge> : null}
                  {!b.isActive ? <Badge tone="red">Inactive</Badge> : null}
                </div>
              </td>
              <td className="px-3 py-2">
                {b.warehouses.length === 0 ? (
                  <span className="text-xs text-neutral-400">None</span>
                ) : (
                  <div className="space-y-0.5 text-sm">
                    {b.warehouses.map((w) => (
                      <div key={w.id}>
                        {w.name}
                        {w.isDefault ? <span className="ml-1 text-xs text-brand-700">(default)</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <Button variant="secondary" onClick={() => setWarehouseFor(b.id === warehouseFor ? null : b.id)}>
                  + Warehouse
                </Button>
              </td>
            </tr>
          ))}
        </Table>
        {warehouseFor ? (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-3">
            <Field label="Warehouse name" error={whForm.formState.errors.name?.message}>
              <Input {...whForm.register('name')} />
            </Field>
            <Field label="Code (optional)">
              <Input {...whForm.register('code')} />
            </Field>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                disabled={createWarehouse.isPending}
                onClick={whForm.handleSubmit((data) => createWarehouse.mutate({ branchId: warehouseFor, data }))}
              >
                Add warehouse
              </Button>
              <Button type="button" variant="secondary" onClick={() => setWarehouseFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card title="Add branch">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" onSubmit={handleSubmit((d) => createBranch.mutate(d))}>
          <Field label="Branch name" error={errors.name?.message}>
            <Input {...register('name')} />
          </Field>
          <Field label="Code (optional)" error={errors.code?.message}>
            <Input {...register('code')} />
          </Field>
          <Field label="City" error={errors.city?.message}>
            <Input {...register('city')} />
          </Field>
          <Field label="State code (GST)" error={errors.stateCode?.message}>
            <Input placeholder="e.g. 27" {...register('stateCode')} />
          </Field>
          <Field label="PIN code" error={errors.pinCode?.message}>
            <Input {...register('pinCode')} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={isSubmitting || createBranch.isPending}>
              {createBranch.isPending ? 'Creating…' : 'Create branch'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
