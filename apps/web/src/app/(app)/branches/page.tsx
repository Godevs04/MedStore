'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { INDIAN_STATE_CODES, billingCounterCreateSchema, branchCreateSchema, gstinIssues, warehouseCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { ConfirmDialog, KpiGrid, Meter, useFieldErrors } from '@/components/kit';
import { Badge, Button, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Stat, cn, Alert } from '@/components/ui';

interface Counter {
  id: string;
  name: string;
  isActive: boolean;
}
interface BranchRow {
  id: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  city: string | null;
  stateCode: string | null;
  pinCode: string | null;
  phone: string | null;
  gstin: string | null;
  isDefault: boolean;
  isActive: boolean;
  isBillingEnabled: boolean;
  warehouses: Array<{ id: string; name: string; code: string | null; isDefault: boolean }>;
  billingCounters: Counter[];
  _count?: { assignments: number };
}
interface Org {
  pan: string | null;
  gstin: string | null;
  stateCode: string | null;
}
interface Usage {
  usage: { branches: { used: number; limit: number | null }; warehouses: { used: number; limit: number | null } };
}

const stateName = (code: string | null) => INDIAN_STATE_CODES.find((s) => s.code === code)?.name ?? code ?? '—';
const nul = (v: string) => (v.trim() === '' ? null : v.trim());

function BranchDrawer({ branch, org, onClose, onDone }: { branch: BranchRow | 'new'; org: Org | undefined; onClose: () => void; onDone: () => void }) {
  const editing = branch === 'new' ? null : branch;
  const [form, setForm] = useState({
    name: editing?.name ?? '',
    code: editing?.code ?? '',
    addressLine1: editing?.addressLine1 ?? '',
    city: editing?.city ?? '',
    stateCode: editing?.stateCode ?? org?.stateCode ?? '',
    pinCode: editing?.pinCode ?? '',
    phone: editing?.phone ?? '',
    gstin: editing?.gstin ?? '',
    isBillingEnabled: editing?.isBillingEnabled ?? true,
  });
  const { errors, validate, clear, setServerErrors } = useFieldErrors();
  const set = (k: keyof typeof form, v: string | boolean) => {
    clear(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const otherState = Boolean(org?.stateCode && form.stateCode && form.stateCode !== org.stateCode);
  const save = useMutation({
    meta: { success: editing ? 'Branch updated' : 'Branch created' },
    mutationFn: (body: unknown) => api(editing ? `/organizations/branches/${editing.id}` : '/organizations/branches', { method: editing ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setServerErrors(e.details ?? (e.code === 'DUPLICATE_ENTITY' ? [{ field: 'code', message: e.message }] : undefined));
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const data = {
      name: form.name.trim(),
      code: nul(form.code)?.toUpperCase() ?? null,
      addressLine1: nul(form.addressLine1),
      city: nul(form.city),
      stateCode: nul(form.stateCode),
      pinCode: nul(form.pinCode),
      phone: nul(form.phone),
      gstin: nul(form.gstin)?.toUpperCase() ?? null,
      isBillingEnabled: form.isBillingEnabled,
    };
    const extra: Record<string, string> = {};
    for (const issue of gstinIssues({ gstin: data.gstin, stateCode: data.stateCode, pan: org?.pan })) extra[issue.field === 'pan' ? 'gstin' : issue.field] = issue.message;
    if (data.gstin && !data.stateCode) extra.stateCode = 'Pick the state this GSTIN is registered in';
    const body = validate(branchCreateSchema, data, extra);
    if (!body) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    if (editing && (Object.keys(data) as Array<keyof typeof data>).every((k) => data[k] === (editing[k] ?? null))) {
      toast.info('No changes to save');
      onClose();
      return;
    }
    save.mutate(body);
  };
  return (
    <Drawer open onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New branch'} subtitle="A shop or depot that bills and holds stock" width="max-w-xl">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Branch name" required error={errors.name} className="sm:col-span-2">
            <Input value={form.name} autoFocus maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="e.g. FC Road outlet" />
          </Field>
          <Field label="Code" error={errors.code} hint="Short, unique">
            <Input value={form.code} maxLength={20} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="FCR" />
          </Field>
        </div>
        <Field label="Address" error={errors.addressLine1}>
          <Input value={form.addressLine1} maxLength={200} onChange={(e) => set('addressLine1', e.target.value)} placeholder="Shop no., building, street" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="City" error={errors.city}>
            <Input value={form.city} maxLength={100} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State" error={errors.stateCode}>
            <Select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
              <option value="">Select…</option>
              {INDIAN_STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="PIN code" error={errors.pinCode}>
            <Input value={form.pinCode} inputMode="numeric" maxLength={6} onChange={(e) => set('pinCode', e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone}>
            <Input value={form.phone} inputMode="tel" maxLength={14} onChange={(e) => set('phone', e.target.value)} placeholder="9822012345" />
          </Field>
          <Field label="Branch GSTIN" error={errors.gstin} hint={otherState ? 'Required by law for a branch in another state' : 'Leave blank to bill under the organisation GSTIN'}>
            <Input value={form.gstin} maxLength={15} className="font-mono uppercase" onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder={org?.pan ? `${form.stateCode || '27'}${org.pan}1Z?` : '27AAAAA0000A1Z5'} />
          </Field>
        </div>
        {otherState && !form.gstin ? (
          <Alert tone="warning">
            This branch is in {stateName(form.stateCode)} but your organisation is registered in {stateName(org?.stateCode ?? null)}. Under the CGST Act each state needs a separate registration before you bill from here.
          </Alert>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" className="accent-brand-600" checked={form.isBillingEnabled} onChange={(e) => set('isBillingEnabled', e.target.checked)} />
          Billing enabled (POS can sell from this branch)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create branch'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function InlineAdd({ placeholder, schema, onSubmit, busy, withDefault }: { placeholder: string; schema: typeof billingCounterCreateSchema | typeof warehouseCreateSchema; onSubmit: (v: { name: string; isDefault?: boolean }) => void; busy: boolean; withDefault?: boolean }) {
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const { errors, validate, clear } = useFieldErrors();
  return (
    <form
      className="mt-2 flex flex-wrap items-start gap-2"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const v = validate(schema, { name: name.trim(), ...(withDefault ? { isDefault } : {}) });
        if (v) {
          onSubmit({ name: name.trim(), ...(withDefault ? { isDefault } : {}) });
          setName('');
          setIsDefault(false);
        }
      }}
    >
      <div className="min-w-40 flex-1">
        <Input value={name} maxLength={60} onChange={(e) => { clear('name'); setName(e.target.value); }} placeholder={placeholder} className="text-xs" aria-invalid={Boolean(errors.name)} />
        {errors.name ? <p className="mt-0.5 text-2xs text-danger">{errors.name}</p> : null}
      </div>
      {withDefault ? (
        <label className="flex items-center gap-1 pt-2 text-2xs text-neutral-600">
          <input type="checkbox" className="accent-brand-600" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> default
        </label>
      ) : null}
      <Button type="submit" variant="secondary" className="text-xs" disabled={busy}>Add</Button>
    </form>
  );
}

function BranchCard({ b, canManage, onEdit, onAction }: { b: BranchRow; canManage: boolean; onEdit: () => void; onAction: (a: 'default' | 'deactivate' | 'activate') => void }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['branches'] });
  const addCounter = useMutation({
    meta: { success: 'Counter added' },
    mutationFn: (name: string) => api(`/organizations/branches/${b.id}/counters`, { method: 'POST', body: { name } }),
    onSuccess: invalidate,
  });
  const updateCounter = useMutation({
    meta: { success: 'Counter updated' },
    mutationFn: (v: { id: string; name?: string; isActive?: boolean }) => api(`/organizations/counters/${v.id}`, { method: 'PATCH', body: { name: v.name, isActive: v.isActive } }),
    onSuccess: () => {
      setRenaming(null);
      invalidate();
    },
  });
  const addWarehouse = useMutation({
    meta: { success: 'Warehouse added' },
    mutationFn: (v: { name: string; isDefault?: boolean }) => api(`/organizations/branches/${b.id}/warehouses`, { method: 'POST', body: v }),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
  });
  const address = [b.addressLine1, b.city, b.stateCode ? stateName(b.stateCode) : null, b.pinCode].filter(Boolean).join(', ');
  return (
    <li className={cn('px-4 py-4', !b.isActive && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-[550] text-ink">{b.name}</h3>
            {b.code ? <Badge>{b.code}</Badge> : null}
            {b.isDefault ? <Badge tone="blue">Default</Badge> : null}
            {b.isBillingEnabled ? <Badge tone="green">Billing</Badge> : <Badge tone="neutral">No billing</Badge>}
            {!b.isActive ? <Badge tone="red">Inactive</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            <Icon name="branches" size={12} className="mr-1 text-faint" />
            {address || 'No address yet'}
            {b.phone ? (
              <>
                {' · '}
                <Icon name="phone" size={12} className="mr-1 text-faint" />
                {b.phone}
              </>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            GSTIN: {b.gstin ? <span className="font-mono text-neutral-700">{b.gstin}</span> : <span className="text-faint">uses organisation GSTIN</span>}
            {' · '}
            {b._count?.assignments ?? 0} staff assigned
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-1">
            <Button variant="secondary" className="text-xs" onClick={onEdit}>Edit</Button>
            {!b.isDefault && b.isActive ? <Button variant="ghost" className="text-xs" onClick={() => onAction('default')}>Make default</Button> : null}
            {b.isActive ? (
              !b.isDefault ? <Button variant="ghost" className="text-xs text-danger" onClick={() => onAction('deactivate')}>Deactivate</Button> : null
            ) : (
              <Button variant="ghost" className="text-xs" onClick={() => onAction('activate')}>Reactivate</Button>
            )}
          </div>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Warehouses ({b.warehouses.length})</p>
          <ul className="space-y-1">
            {b.warehouses.map((w) => (
              <li key={w.id} className="flex items-center justify-between rounded-lg bg-subtle px-2.5 py-1.5 text-sm">
                <span>{w.name}{w.code ? <span className="ml-1 font-mono text-[10px] text-faint">{w.code}</span> : null}</span>
                {w.isDefault ? <Badge tone="blue">Default</Badge> : null}
              </li>
            ))}
            {b.warehouses.length === 0 ? <li className="text-xs text-warning">No warehouse — stock cannot be received here yet.</li> : null}
          </ul>
          {canManage && b.isActive ? <InlineAdd placeholder="New warehouse, e.g. Back store" schema={warehouseCreateSchema} busy={addWarehouse.isPending} onSubmit={(v) => addWarehouse.mutate(v)} withDefault /> : null}
        </section>
        <section>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">Billing counters ({b.billingCounters.filter((c) => c.isActive).length} active)</p>
          <ul className="space-y-1">
            {b.billingCounters.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-subtle px-2.5 py-1.5 text-sm">
                {renaming?.id === c.id ? (
                  <form
                    className="flex flex-1 gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renaming.name.trim().length >= 2) updateCounter.mutate({ id: c.id, name: renaming.name.trim() });
                      else toast.error('Counter name needs at least 2 characters');
                    }}
                  >
                    <Input value={renaming.name} autoFocus maxLength={60} className="text-xs" onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} />
                    <Button type="submit" variant="secondary" className="text-xs" disabled={updateCounter.isPending}>Save</Button>
                    <Button type="button" variant="ghost" className="text-xs" onClick={() => setRenaming(null)}><Icon name="close" size={14} /></Button>
                  </form>
                ) : (
                  <>
                    <span className={cn('inline-flex items-center gap-1.5', !c.isActive && 'text-faint line-through')}>
                      <Icon name="pos" size={14} className="text-faint" />
                      {c.name}
                    </span>
                    {canManage ? (
                      <span className="flex gap-1">
                        <Button variant="ghost" className="text-2xs" onClick={() => setRenaming({ id: c.id, name: c.name })}>Rename</Button>
                        <Button variant="ghost" className="text-2xs" disabled={updateCounter.isPending} onClick={() => updateCounter.mutate({ id: c.id, isActive: !c.isActive })}>{c.isActive ? 'Disable' : 'Enable'}</Button>
                      </span>
                    ) : null}
                  </>
                )}
              </li>
            ))}
            {b.billingCounters.length === 0 ? <li className="text-xs text-faint">No counters — POS bills under the branch.</li> : null}
          </ul>
          {canManage && b.isActive ? <InlineAdd placeholder="New counter, e.g. Counter 2" schema={billingCounterCreateSchema} busy={addCounter.isPending} onSubmit={(v) => addCounter.mutate(v.name)} /> : null}
        </section>
      </div>
    </li>
  );
}

export default function BranchesPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can('branches.manage');
  const [editing, setEditing] = useState<BranchRow | 'new' | null>(null);
  const [action, setAction] = useState<{ branch: BranchRow; kind: 'default' | 'deactivate' | 'activate' } | null>(null);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<BranchRow[]>('/organizations/branches') });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api<Org>('/organizations') });
  const usage = useQuery({ queryKey: ['subscription'], queryFn: () => api<Usage>('/organizations/subscription') });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['branches'] });
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
  };
  const update = useMutation({
    meta: { silent: true },
    mutationFn: (v: { branch: BranchRow; kind: 'default' | 'deactivate' | 'activate' }) =>
      api(`/organizations/branches/${v.branch.id}`, { method: 'PATCH', body: v.kind === 'default' ? { isDefault: true } : { isActive: v.kind === 'activate' } }),
    onSuccess: (_r, v) => {
      toast.success(v.kind === 'default' ? `${v.branch.name} is now the default branch` : v.kind === 'activate' ? `${v.branch.name} reactivated` : `${v.branch.name} deactivated`);
      invalidate();
    },
    onSettled: () => setAction(null),
  });

  if (branches.isLoading) return <SkeletonRows rows={4} cols={3} />;
  if (branches.error) {
    const forbidden = branches.error instanceof ApiClientError && branches.error.status === 403;
    return <ErrorState message={forbidden ? 'You do not have permission to view branches.' : 'Failed to load branches.'} retry={() => void branches.refetch()} />;
  }
  const list = branches.data ?? [];
  const u = usage.data?.usage;
  const atLimit = Boolean(u && u.branches.limit !== null && u.branches.limit >= 0 && u.branches.used >= u.branches.limit);
  const allowance = (label: string, m: { used: number; limit: number | null } | undefined) => {
    const capped = !!m && m.limit !== null && m.limit >= 0;
    return (
      <Stat
        label={label}
        value={m ? (capped ? `${m.used} / ${m.limit}` : m.used) : '…'}
        hint={m && !capped ? 'Unlimited' : undefined}
        footer={m && capped ? <Meter value={m.limit ? (m.used / m.limit) * 100 : 100} tone={m.used >= (m.limit ?? 0) ? 'red' : 'green'} /> : undefined}
      />
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches & warehouses"
        subtitle="Locations, their stock rooms and POS counters."
        actions={canManage ? <Button disabled={atLimit} title={atLimit ? 'Branch limit reached — upgrade your plan' : undefined} onClick={() => setEditing('new')}><Icon name="plus" size={15} strokeWidth={2.25} /> Branch</Button> : null}
      />
      <KpiGrid bare cols={4}>
        <Stat label="Active branches" value={list.filter((b) => b.isActive).length} hint={`${list.length} in total`} />
        {allowance('Branch allowance', u?.branches)}
        {allowance('Warehouse allowance', u?.warehouses)}
        <Stat label="Billing counters" value={list.reduce((s, b) => s + b.billingCounters.filter((c) => c.isActive).length, 0)} hint="Active tills" />
      </KpiGrid>
      {list.length === 0 ? (
        <EmptyState title="No branches" hint="Add your first shop to start billing." />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {list.map((b) => (
            <BranchCard key={b.id} b={b} canManage={canManage} onEdit={() => setEditing(b)} onAction={(kind) => (kind === 'activate' ? update.mutate({ branch: b, kind }) : setAction({ branch: b, kind }))} />
          ))}
        </ul>
      )}
      {editing ? <BranchDrawer branch={editing} org={org.data} onClose={() => setEditing(null)} onDone={invalidate} /> : null}
      <ConfirmDialog
        open={action !== null}
        title={action?.kind === 'default' ? `Make ${action.branch.name} the default?` : `Deactivate ${action?.branch.name ?? ''}?`}
        message={
          action?.kind === 'default'
            ? 'New sessions open in the default branch. Only one branch can be the default.'
            : 'Staff can no longer bill or move stock here. Its history, stock and documents are kept and you can reactivate it later.'
        }
        confirmLabel={action?.kind === 'default' ? 'Make default' : 'Deactivate'}
        tone={action?.kind === 'default' ? 'primary' : 'danger'}
        busy={update.isPending}
        onCancel={() => setAction(null)}
        onConfirm={() => action && update.mutate(action)}
      />
    </div>
  );
}
