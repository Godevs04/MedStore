'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
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
  fmtDate,
} from '@/components/ui';

interface Overview {
  tenants: number;
  newThisMonth: number;
  users: number;
  invoicesThisMonth: number;
  suspended: number;
  byStatus: Array<{ status: string; count: number }>;
  byPlan: Array<{ plan: string; count: number }>;
}
interface TenantRow {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  setupCompletedAt: string | null;
  memberships: number;
  branches: number;
  invoices: number;
  suspended: boolean;
  subscription: { status: string; planKey: string; plan: string; currentPeriodEnd: string; lapsed: boolean; daysLeft: number; endsAt: string } | null;
}
interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  limits: Record<string, unknown>;
}

const STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELLED', 'EXPIRED'] as const;
const MODULES = ['catalog', 'inventory', 'pos', 'purchases', 'returns', 'wholesale', 'accounting'] as const;
const NUMERIC_LIMITS: Array<[string, string]> = [
  ['monthlyInvoiceLimit', 'Invoices / month'],
  ['maxUsers', 'Users'],
  ['maxBranches', 'Branches'],
  ['maxWarehouses', 'Warehouses'],
  ['storageMb', 'Storage (MB)'],
  ['reportRetentionDays', 'Report retention (days)'],
];

function statusBadge(t: TenantRow) {
  if (t.suspended) return <Badge tone="red" dot>Suspended</Badge>;
  if (!t.subscription) return <Badge>No plan</Badge>;
  if (t.subscription.lapsed) return <Badge tone="red">Ended</Badge>;
  const tone = t.subscription.status === 'ACTIVE' ? 'green' : t.subscription.status === 'TRIALING' ? 'blue' : 'amber';
  return <Badge tone={tone} dot>{t.subscription.status.toLowerCase()} · {t.subscription.daysLeft}d</Badge>;
}

function TenantDrawer({ tenant, plans, onClose }: { tenant: TenantRow; plans: Plan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [planKey, setPlanKey] = useState(tenant.subscription?.planKey ?? 'STARTER');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('ACTIVE');
  const [periodDays, setPeriodDays] = useState('30');
  const [notes, setNotes] = useState('');
  const days = Number(periodDays);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= 1095;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform'] });
  };
  const assign = useMutation({
    meta: { success: 'Subscription updated' },
    mutationFn: () => api(`/platform/tenants/${tenant.id}/subscription`, { method: 'POST', body: { planKey, status, periodDays: days, notes: notes.trim() || null } }),
    onSuccess: refresh,
  });
  const suspend = useMutation({
    meta: { success: tenant.suspended ? 'Tenant reactivated' : 'Tenant suspended — sessions revoked' },
    mutationFn: () => api(`/platform/tenants/${tenant.id}/status`, { method: 'POST', body: { suspended: !tenant.suspended } }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  return (
    <Drawer open onClose={onClose} title={tenant.name} subtitle={`${tenant.slug} · joined ${fmtDate(tenant.createdAt)}`}>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Users" value={tenant.memberships} />
        <Stat label="Branches" value={tenant.branches} />
        <Stat label="Invoices" value={tenant.invoices.toLocaleString('en-IN')} />
      </div>
      <Card title="Subscription">
        <p className="mb-3 text-sm text-neutral-600">
          Current: <strong>{tenant.subscription?.plan ?? 'None'}</strong>
          {tenant.subscription ? ` · ${tenant.subscription.status.toLowerCase()} · ends ${fmtDate(tenant.subscription.endsAt)}` : ''}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Plan">
            <Select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
              {plans.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <Field label="Period (days)" error={periodDays && !daysValid ? '1 – 1095 days' : undefined}>
            <Input inputMode="numeric" value={periodDays} onChange={(e) => setPeriodDays(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes (invoice / payment reference)">
            <Input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Paid via NEFT UTR 1234 — annual" />
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button disabled={!daysValid || assign.isPending} onClick={() => assign.mutate()}>{assign.isPending ? 'Saving…' : 'Apply subscription'}</Button>
          <Button variant="ghost" onClick={() => { setStatus('ACTIVE'); setPeriodDays('365'); }}>Annual</Button>
          <Button variant="ghost" onClick={() => { setStatus('ACTIVE'); setPeriodDays('30'); }}>Monthly</Button>
        </div>
      </Card>
      <Card title={tenant.suspended ? 'Reactivate tenant' : 'Suspend tenant'}>
        <p className="mb-3 text-sm text-neutral-600">
          {tenant.suspended
            ? 'Members will be able to sign in and use the workspace again.'
            : 'Suspension revokes every active session and blocks all access except the subscription screen. Records are retained.'}
        </p>
        <Button
          variant={tenant.suspended ? 'primary' : 'danger'}
          disabled={suspend.isPending}
          onClick={() => {
            if (tenant.suspended || window.confirm(`Suspend ${tenant.name}? All members will be signed out.`)) suspend.mutate();
          }}
        >
          {tenant.suspended ? 'Reactivate' : 'Suspend tenant'}
        </Button>
      </Card>
    </Drawer>
  );
}

function PlanEditor({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const [limits, setLimits] = useState<Record<string, unknown>>(plan.limits);
  const mods = Array.isArray(limits.modules) ? (limits.modules as string[]) : [];
  const all = mods.includes('*');
  const invalid = NUMERIC_LIMITS.some(([k]) => typeof limits[k] !== 'number' || !Number.isInteger(limits[k]) || (limits[k] as number) < -1);
  const save = useMutation({
    meta: { success: `${plan.name} limits saved` },
    mutationFn: () => api('/platform/plans/limits', { method: 'POST', body: { planKey: plan.key, limits } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['platform', 'plans'] }),
  });
  const toggle = (m: string) => setLimits((l) => ({ ...l, modules: mods.includes(m) ? mods.filter((x) => x !== m) : [...mods.filter((x) => x !== '*'), m] }));
  return (
    <Card title={plan.name} actions={<Badge>{plan.key}</Badge>}>
      <div className="grid grid-cols-2 gap-3">
        {NUMERIC_LIMITS.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input
              inputMode="numeric"
              value={String(limits[k] ?? '')}
              onChange={(e) => {
                const v = e.target.value.trim();
                setLimits((l) => ({ ...l, [k]: v === '' || v === '-' ? v : Number(v) }));
              }}
            />
          </Field>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">Use -1 for unlimited.</p>
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-neutral-600">Modules</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${all ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-neutral-200 text-neutral-500'}`}
            onClick={() => setLimits((l) => ({ ...l, modules: all ? [] : ['*'] }))}
          >
            All modules
          </button>
          {MODULES.map((m) => (
            <button
              key={m}
              disabled={all}
              className={`rounded-full border px-2.5 py-1 text-xs capitalize transition-colors disabled:opacity-40 ${mods.includes(m) ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-neutral-200 text-neutral-500'}`}
              onClick={() => toggle(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={Boolean(limits.apiAccess)} onChange={(e) => setLimits((l) => ({ ...l, apiAccess: e.target.checked }))} />
        API access
      </label>
      <div className="mt-3">
        <Button disabled={invalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save limits'}</Button>
        {invalid ? <span className="ml-2 text-xs text-red-600">Every limit must be a whole number (−1 = unlimited).</span> : null}
      </div>
    </Card>
  );
}

export default function PlatformPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<'tenants' | 'plans'>('tenants');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TenantRow | null>(null);
  const allowed = Boolean(user?.isPlatformSuperadmin);
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api<Overview>('/platform/overview'), enabled: allowed });
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', search],
    queryFn: () => api<{ items: TenantRow[]; pageInfo: { totalItems: number } }>(`/platform/tenants?page=1&pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    enabled: allowed,
  });
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api<Plan[]>('/platform/plans'), enabled: allowed });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState title="Platform console" hint="This area is restricted to MediCore platform administrators." />
      </div>
    );
  }
  const o = overview.data;
  const selectedFresh = selected ? (tenants.data?.items.find((t) => t.id === selected.id) ?? selected) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Platform console" subtitle="Tenants, subscriptions and plan limits across MediCore. Tenant business records are never shown here." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Tenants" value={o?.tenants ?? '…'} hint={o ? `+${o.newThisMonth} this month` : undefined} tone="blue" />
        <Stat label="Users" value={o?.users ?? '…'} delay={50} />
        <Stat label="Invoices this month" value={o ? o.invoicesThisMonth.toLocaleString('en-IN') : '…'} tone="green" delay={100} />
        <Stat label="Paying" value={o?.byStatus.find((s) => s.status === 'ACTIVE')?.count ?? 0} hint={`${o?.byStatus.find((s) => s.status === 'TRIALING')?.count ?? 0} on trial`} delay={150} />
        <Stat label="Suspended" value={o?.suspended ?? '…'} tone={o?.suspended ? 'red' : 'neutral'} delay={200} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'tenants', label: 'Tenants', count: tenants.data?.pageInfo.totalItems }, { id: 'plans', label: 'Plans & limits' }]} />

      {tab === 'tenants' ? (
        <Card title="Tenants" actions={<Input className="w-64" placeholder="Search organization…" value={search} onChange={(e) => setSearch(e.target.value)} />}>
          {tenants.isLoading ? (
            <SkeletonRows rows={6} cols={6} />
          ) : tenants.error ? (
            <ErrorState message="Failed to load tenants." retry={() => void tenants.refetch()} />
          ) : (tenants.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No tenants match" />
          ) : (
            <Table head={<tr><Th>Organization</Th><Th>Plan</Th><Th>Status</Th><Th right>Users</Th><Th right>Branches</Th><Th right>Invoices</Th><Th>Joined</Th></tr>}>
              {tenants.data?.items.map((t) => (
                <Tr key={t.id} onClick={() => setSelected(t)}>
                  <Td className="text-sm font-medium text-brand-800">
                    {t.name}
                    {!t.setupCompletedAt ? <span className="ml-1.5 text-[10px] text-amber-600">setup pending</span> : null}
                  </Td>
                  <Td className="text-sm">{t.subscription?.plan ?? '—'}</Td>
                  <Td>{statusBadge(t)}</Td>
                  <Td right>{t.memberships}</Td>
                  <Td right>{t.branches}</Td>
                  <Td right>{t.invoices.toLocaleString('en-IN')}</Td>
                  <Td className="text-xs text-neutral-500">{fmtDate(t.createdAt)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {plans.isLoading ? <SkeletonRows rows={6} cols={2} /> : plans.data?.map((p) => <PlanEditor key={p.key} plan={p} />)}
        </div>
      )}

      {selectedFresh && plans.data ? <TenantDrawer tenant={selectedFresh} plans={plans.data} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
