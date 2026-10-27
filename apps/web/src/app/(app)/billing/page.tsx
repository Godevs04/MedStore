'use client';

import { Icon, type IconName } from '@/components/icons';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { SubscriptionSummary } from '@/components/shell';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonRows, Stat, cn, fmtDate, StatusBadge, MetricGroup } from '@/components/ui';

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

interface SubscriptionEvent {
  id: string;
  eventType: string;
  fromPlan: string | null;
  toPlan: string | null;
  notes: string | null;
  createdAt: string;
}
const EVENT_META: Record<string, { label: string; tone: string; icon: IconName }> = {
  PLAN_CHANGED: { label: 'Plan changed', tone: 'bg-primary', icon: 'transfers' },
  PERIOD_UPDATED: { label: 'Period renewed', tone: 'bg-success', icon: 'refresh' },
  TRIAL_STARTED: { label: 'Trial started', tone: 'bg-info', icon: 'star' },
  STATUS_CHANGED: { label: 'Status changed', tone: 'bg-warning', icon: 'info' },
};
const eventMeta = (type: string) =>
  EVENT_META[type] ?? { label: type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), tone: 'bg-neutral-400', icon: 'circle' as IconName };

const fmtLimit = (v: unknown, unit = '') => (typeof v === 'number' ? (v < 0 ? 'Unlimited' : `${v.toLocaleString('en-IN')}${unit}`) : '—');
const fmtCount = (v: unknown, one: string, many: string) => `${fmtLimit(v)} ${v === 1 ? one : many}`;
const PLAN_ORDER = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'];
const planRank = (key: string) => {
  const i = PLAN_ORDER.indexOf(key);
  return i === -1 ? PLAN_ORDER.length : i;
};
const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment due',
  GRACE: 'Grace period',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-neutral-600">{label}</span>
        <span className="num font-medium">
          {used.toLocaleString('en-IN')}
          <span className="text-faint"> / {limit === null ? '∞' : limit.toLocaleString('en-IN')}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-accent')}
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
  const events = useQuery({
    queryKey: ['subscription-events', tenant?.organizationId],
    queryFn: () => api<SubscriptionEvent[]>('/organizations/subscription/events'),
    enabled: Boolean(tenant?.organizationId),
  });

  if (!tenant?.organizationId) {
    return (
      <div className="max-w-6xl">
        <EmptyState title="No workspace selected" hint="Plan and billing details belong to a pharmacy workspace. You are not a member of any organization yet." />
      </div>
    );
  }
  if (q.isLoading) return <div className="max-w-6xl"><SkeletonRows rows={6} cols={3} /></div>;
  if (q.error || !q.data) return <div className="max-w-6xl"><ErrorState message="Failed to load your subscription." retry={() => void q.refetch()} /></div>;
  const { subscription: sub, usage, plans, suspended } = q.data;
  const eventList = events.data ?? [];

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Plan & billing" subtitle="Your MediCore subscription, what it includes and how much of it you are using." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          {sub ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-medium uppercase tracking-wide text-muted">Current plan</span>
                <StatusBadge status={suspended ? 'SUSPENDED' : sub.lapsed ? 'EXPIRED' : sub.status} tone={suspended ? 'red' : STATUS_TONE[sub.status]} label={suspended ? 'Suspended' : sub.lapsed ? 'Ended' : STATUS_LABEL[sub.status]} />
              </div>
              <div>
                <p className="text-metric font-[550] text-ink">{sub.planName}</p>
                {sub.planDescription ? <p className="mt-0.5 text-sm text-muted">{sub.planDescription}</p> : null}
              </div>
              <div className="rounded-lg bg-subtle px-3 py-2.5 text-[13px]">
                {sub.lapsed ? (
                  <span className="text-danger">Ended on {fmtDate(sub.endsAt)} — workspace is read-only.</span>
                ) : (
                  <span>
                    {sub.status === 'TRIALING' ? 'Trial ends' : 'Renews'} on <strong>{fmtDate(sub.endsAt)}</strong>
                    <span className="text-muted"> · {sub.daysLeft} day{sub.daysLeft === 1 ? '' : 's'} left</span>
                  </span>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-faint">Included modules</p>
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
            <p className="text-sm text-muted">No subscription is attached to this organization.</p>
          )}
        </Card>

        <Card title="Usage this period" className="lg:col-span-2">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Meter label="Invoices this month" used={usage.invoicesThisMonth.used} limit={usage.invoicesThisMonth.limit} />
            <Meter label="Users" used={usage.users.used} limit={usage.users.limit} />
            <Meter label="Branches" used={usage.branches.used} limit={usage.branches.limit} />
            <Meter label="Warehouses" used={usage.warehouses.used} limit={usage.warehouses.limit} />
          </div>
          <p className="mt-4 text-xs text-muted">
            Limits are enforced on the server: when a limit is reached, new invoices, users, branches or warehouses are blocked with a clear message until you upgrade.
          </p>
        </Card>
      </div>

      <MetricGroup bare>
        <Stat label="Plan" value={sub?.planName ?? '—'} />
        <Stat label="Invoices left this month" value={usage.invoicesThisMonth.limit === null ? 'Unlimited' : Math.max(0, usage.invoicesThisMonth.limit - usage.invoicesThisMonth.used).toLocaleString('en-IN')} />
        <Stat label="Seats available" value={usage.users.limit === null ? 'Unlimited' : Math.max(0, usage.users.limit - usage.users.used)} />
        <Stat label="Days remaining" value={sub ? sub.daysLeft : '—'} tone={sub && sub.daysLeft <= 7 ? 'amber' : 'green'} />
      </MetricGroup>

      <Card title="Compare plans">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[...plans].sort((a, b) => planRank(a.key) - planRank(b.key)).map((p) => {
            const current = p.key === sub?.planKey;
            const mods = Array.isArray(p.limits.modules) ? (p.limits.modules as string[]) : [];
            return (
              <div
                key={p.key}
                className={cn(
                  'flex flex-col rounded-xl border p-4',
                  current ? 'border-accent bg-mint/40 ring-1 ring-accent' : 'border-line bg-surface',
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold tracking-tight">{p.name}</p>
                  {current ? <Badge tone="blue">Current</Badge> : null}
                </div>
                {p.description ? <p className="mt-1 text-xs text-muted">{p.description}</p> : null}
                <ul className="mt-3 space-y-1.5 text-xs text-neutral-700">
                  <li><Icon name="check" size={13} strokeWidth={2.5} /> {fmtCount(p.limits.monthlyInvoiceLimit, 'invoice', 'invoices')} / month</li>
                  <li><Icon name="check" size={13} strokeWidth={2.5} /> {fmtCount(p.limits.maxUsers, 'user', 'users')}</li>
                  <li><Icon name="check" size={13} strokeWidth={2.5} /> {fmtCount(p.limits.maxBranches, 'branch', 'branches')} · {fmtCount(p.limits.maxWarehouses, 'warehouse', 'warehouses')}</li>
                  <li><Icon name="check" size={13} strokeWidth={2.5} /> {mods.includes('*') ? 'All modules' : mods.map((m) => MODULE_LABELS[m] ?? m).join(', ')}</li>
                  <li>{p.limits.apiAccess ? <><Icon name="check" size={13} strokeWidth={2.5} /> API access</> : <span className="text-faint"><Icon name="close" size={13} /> No API access</span>}</li>
                </ul>
                <div className="mt-auto pt-4">
                  {current ? (
                    <span className="block text-center text-xs font-medium text-teal-ink">You are on this plan</span>
                  ) : SUPPORT_EMAIL ? (
                    <a
                      className="flex h-control-sm items-center justify-center rounded-md border border-line px-3 text-xs font-semibold text-teal-ink transition-colors hover:bg-mint"
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
        <p className="mt-4 text-xs text-muted">
          Online payment is not connected yet. Plan changes and renewals are activated by your MediCore platform administrator, and every change is recorded in the audit log.
        </p>
      </Card>

      <Card title="Subscription history" actions={eventList.length ? <span className="text-xs text-muted">{eventList.length} event{eventList.length === 1 ? '' : 's'}</span> : undefined}>
        {events.isLoading ? (
          <SkeletonRows rows={3} cols={2} />
        ) : events.error ? (
          <ErrorState message="Failed to load subscription history." retry={() => void events.refetch()} />
        ) : eventList.length === 0 ? (
          <EmptyState title="No changes yet" hint="Plan upgrades, renewals and status changes made by your platform administrator will appear here." />
        ) : (
          <ol className="relative ml-3 space-y-4 border-l border-line pl-5">
            {eventList.map((e) => {
              const m = eventMeta(e.eventType);
              return (
                <li key={e.id} className="mc-anim-fade-in relative">
                  <span className={cn('absolute -left-[31px] top-0.5 grid h-5 w-5 place-items-center rounded-full text-white ring-4 ring-white', m.tone)}>
                    <Icon name={m.icon} size={11} strokeWidth={2.5} />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {m.label}
                      {e.fromPlan && e.toPlan && e.fromPlan !== e.toPlan ? (
                        <span className="font-normal text-neutral-600"> · {e.fromPlan} → <strong className="text-ink">{e.toPlan}</strong></span>
                      ) : e.toPlan ? (
                        <span className="font-normal text-neutral-600"> · {e.toPlan}</span>
                      ) : null}
                    </p>
                    <time className="text-xs num text-muted" dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                  {e.notes ? <p className="mt-0.5 text-xs text-muted">{e.notes}</p> : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
