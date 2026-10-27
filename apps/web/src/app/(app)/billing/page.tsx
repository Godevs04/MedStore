'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { SubscriptionSummary } from '@/components/shell';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Stat, cn, fmtDate } from '@/components/ui';

const MODULE_LABELS: Record<string, string> = {
  catalog: 'Product catalog',
  inventory: 'Batch inventory',
  pos: 'POS billing',
  purchases: 'Purchasing',
  returns: 'Returns & credit notes',
  wholesale: 'Wholesale',
  accounting: 'Accounting',
};
const STATUS_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'neutral'> = {
  TRIALING: 'blue',
  ACTIVE: 'green',
  PAST_DUE: 'amber',
  GRACE: 'amber',
  CANCELLED: 'red',
  EXPIRED: 'red',
};
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

const fmtLimit = (v: unknown, unit = '') => (typeof v === 'number' ? (v < 0 ? 'Unlimited' : `${v.toLocaleString('en-IN')}${unit}`) : '—');

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-neutral-600">{label}</span>
        <span className="tabular-nums font-medium">
          {used.toLocaleString('en-IN')}
          <span className="text-neutral-400"> / {limit === null ? '∞' : limit.toLocaleString('en-IN')}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn('h-full rounded-full transition-all duration-700', pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-500')}
          style={{ width: `${limit === null ? 4 : Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { tenant } = useSession();
  const q = useQuery({
    queryKey: ['subscription', tenant?.organizationId],
    queryFn: () => api<SubscriptionSummary>('/organizations/subscription'),
    enabled: Boolean(tenant?.organizationId),
  });

  if (!tenant?.organizationId) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState title="No workspace selected" hint="Plan and billing details belong to a pharmacy workspace. You are not a member of any organization yet." />
      </div>
    );
  }
  if (q.isLoading) return <div className="mx-auto max-w-6xl"><SkeletonRows rows={6} cols={3} /></div>;
  if (q.error || !q.data) return <div className="mx-auto max-w-6xl"><ErrorState message="Failed to load your subscription." retry={() => void q.refetch()} /></div>;
  const { subscription: sub, usage, plans, suspended } = q.data;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Plan & billing" subtitle="Your MediCore subscription, what it includes and how much of it you are using." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          {sub ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Current plan</span>
                <Badge tone={suspended ? 'red' : STATUS_TONE[sub.status] ?? 'neutral'} dot>
                  {suspended ? 'Suspended' : sub.lapsed ? 'Ended' : sub.status.replace('_', ' ').toLowerCase()}
                </Badge>
              </div>
              <div>
                <p className="mc-gradient-text text-2xl font-bold tracking-tight">{sub.planName}</p>
                {sub.planDescription ? <p className="mt-0.5 text-sm text-neutral-500">{sub.planDescription}</p> : null}
              </div>
              <div className="rounded-xl bg-neutral-50 px-3 py-2.5 text-sm">
                {sub.lapsed ? (
                  <span className="text-red-700">Ended on {fmtDate(sub.endsAt)} — workspace is read-only.</span>
                ) : (
                  <span>
                    {sub.status === 'TRIALING' ? 'Trial ends' : 'Renews'} on <strong>{fmtDate(sub.endsAt)}</strong>
                    <span className="text-neutral-500"> · {sub.daysLeft} day{sub.daysLeft === 1 ? '' : 's'} left</span>
                  </span>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">Included modules</p>
                <div className="flex flex-wrap gap-1.5">
                  {sub.modules.includes('*') ? (
                    <Badge tone="green">All modules</Badge>
                  ) : (
                    sub.modules.map((m) => <Badge key={m} tone="green">{MODULE_LABELS[m] ?? m}</Badge>)
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-500">No subscription is attached to this organization.</p>
          )}
        </Card>

        <Card title="Usage this period" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Meter label="Invoices this month" used={usage.invoicesThisMonth.used} limit={usage.invoicesThisMonth.limit} />
            <Meter label="Users" used={usage.users.used} limit={usage.users.limit} />
            <Meter label="Branches" used={usage.branches.used} limit={usage.branches.limit} />
            <Meter label="Warehouses" used={usage.warehouses.used} limit={usage.warehouses.limit} />
          </div>
          <p className="mt-4 text-xs text-neutral-500">
            Limits are enforced on the server: when a limit is reached, new invoices, users, branches or warehouses are blocked with a clear message until you upgrade.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Plan" value={sub?.planName ?? '—'} tone="blue" />
        <Stat label="Invoices left this month" value={usage.invoicesThisMonth.limit === null ? 'Unlimited' : Math.max(0, usage.invoicesThisMonth.limit - usage.invoicesThisMonth.used).toLocaleString('en-IN')} delay={60} />
        <Stat label="Seats available" value={usage.users.limit === null ? 'Unlimited' : Math.max(0, usage.users.limit - usage.users.used)} delay={120} />
        <Stat label="Days remaining" value={sub ? sub.daysLeft : '—'} tone={sub && sub.daysLeft <= 7 ? 'amber' : 'green'} delay={180} />
      </div>

      <Card title="Compare plans">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {plans.map((p, i) => {
            const current = p.key === sub?.planKey;
            const mods = Array.isArray(p.limits.modules) ? (p.limits.modules as string[]) : [];
            return (
              <div
                key={p.key}
                className={cn(
                  'mc-anim-fade-up flex flex-col rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md',
                  current ? 'border-brand-400 bg-brand-50/40 ring-2 ring-brand-200' : 'border-neutral-200 bg-white',
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold tracking-tight">{p.name}</p>
                  {current ? <Badge tone="blue">Current</Badge> : null}
                </div>
                {p.description ? <p className="mt-1 text-xs text-neutral-500">{p.description}</p> : null}
                <ul className="mt-3 space-y-1.5 text-xs text-neutral-700">
                  <li>✓ {fmtLimit(p.limits.monthlyInvoiceLimit)} invoices / month</li>
                  <li>✓ {fmtLimit(p.limits.maxUsers)} users</li>
                  <li>✓ {fmtLimit(p.limits.maxBranches)} branches · {fmtLimit(p.limits.maxWarehouses)} warehouses</li>
                  <li>✓ {mods.includes('*') ? 'All modules' : mods.map((m) => MODULE_LABELS[m] ?? m).join(', ')}</li>
                  <li>{p.limits.apiAccess ? '✓ API access' : '— No API access'}</li>
                </ul>
                <div className="mt-auto pt-4">
                  {current ? (
                    <span className="block text-center text-xs font-medium text-brand-700">You are on this plan</span>
                  ) : SUPPORT_EMAIL ? (
                    <a
                      className="block rounded-lg border border-brand-200 px-3 py-1.5 text-center text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                      href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Switch to ${p.name}`)}`}
                    >
                      Request {p.name}
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-neutral-500">
          Online payment is not connected yet. Plan changes and renewals are activated by your MediCore platform administrator, and every change is recorded in the audit log.
        </p>
      </Card>
    </div>
  );
}
