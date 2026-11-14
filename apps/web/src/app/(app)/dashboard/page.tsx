'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership, useSession } from '@/lib/session';
import { useState } from 'react';
import { BarChart, compactInr, Donut, FilterChips } from '@/components/kit';
import { Button, Card, EmptyState, ErrorState, MetricGroup, PageHeader, SkeletonRows, Stat, StatusBadge, Table, Td, Th, Tr, cn, fmtDate, money } from '@/components/ui';

interface Checklist {
  steps: Array<{ key: string; label: string; complete: boolean; required?: boolean }>;
  allComplete: boolean;
  setupCompletedAt: string | null;
}

interface OrgProfile {
  id: string;
  name: string;
  gstRegistrationStatus: string;
  gstin: string | null;
  stateCode: string | null;
  subscription: { status: string; planName: string; trialEndsAt: string | null } | null;
}

interface Dashboard {
  today: { invoices: number; revenue: string; returns?: string };
  month: { invoices: number; revenue: string; returns?: string };
  licences?: Array<{ id: string; type: string; number: string; expiryDate: string; daysLeft: number }>;
  receivables: string;
  payables: string;
  stockValue: string;
  alerts: { expiring30: number; expiredOnHand: number; lowStock: number; openPurchaseOrders: number; receiptsAwaitingInvoice: number };
  recentInvoices: Array<{ id: string; invoiceNumber: string; total: string; status: string; invoiceDate: string; party: string }>;
}

interface Trend {
  days: Array<{ date: string; invoices: number; revenue: string }>;
  topProducts: Array<{ productId: string; product: string; quantity: number; revenue: string }>;
}

interface PaymentMix {
  total: string;
  methods: Array<{ method: string; amount: string; count: number; share: number }>;
}

interface ExpiryValue {
  buckets: Array<{ key: string; label: string; batches: number; quantity: number; costValue: string; mrpValue: string }>;
  totalCost: string;
  totalMrp: string;
}

interface Aging {
  receivables: { buckets: Record<string, string>; total: string };
  payables: { buckets: Record<string, string>; total: string };
}

const AGING_LABELS: Record<string, string> = { CURRENT: 'Not due', D1_30: '1–30 d', D31_60: '31–60 d', D61_90: '61–90 d', D90_PLUS: '90+ d' };
const METHOD_LABELS: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK: 'Bank', CREDIT: 'Credit' };

const MODULES = [
  { href: '/pos', label: 'POS billing', desc: 'Scan, FEFO batches, split tenders, GST invoice', icon: 'pos' as const, permission: 'sales.create' },
  { href: '/purchasing', label: 'Purchasing', desc: 'PO → GRN → supplier invoice → payment', icon: 'purchasing' as const, permission: 'purchases.read' },
  { href: '/batches', label: 'Batch inventory', desc: 'Batch, expiry, recall and stock ledger', icon: 'batches' as const, permission: 'inventory.read' },
  { href: '/accounting', label: 'Accounting', desc: 'Journals, trial balance, P&L, balance sheet', icon: 'accounting' as const, permission: 'accounting.read' },
  { href: '/compliance', label: 'Compliance', desc: 'Schedule H1 register, GST summaries, licences', icon: 'compliance' as const, permission: 'compliance.read' },
  { href: '/reports', label: 'Reports', desc: 'Sales, valuation, aging — CSV export', icon: 'reports' as const, permission: 'reports.read' },
];

const STEP_LINKS: Record<string, string> = {
  business_profile: '/settings',
  gst: '/settings',
  branch: '/branches',
  warehouse: '/branches',
  users: '/users',
  tax_rates: '/configuration',
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const membership = useCurrentMembership();
  const { user, tenant } = useSession();
  const hasTenant = Boolean(tenant?.organizationId);
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const checklist = useQuery({ queryKey: ['setup-checklist'], queryFn: () => api<Checklist>('/organizations/setup-checklist'), retry: false, enabled: hasTenant });
  const org = useQuery({ queryKey: ['org-profile'], queryFn: () => api<OrgProfile>('/organizations'), retry: false, enabled: hasTenant });
  const kpis = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/reports/dashboard'), retry: false, refetchInterval: 60_000, enabled: hasTenant });
  const [trendDays, setTrendDays] = useState<'7' | '14' | '30'>('14');
  const trend = useQuery({ queryKey: ['dashboard', 'trend', trendDays], queryFn: () => api<Trend>(`/reports/dashboard/trend?days=${trendDays}`), enabled: hasTenant });
  const canReports = can('reports.read');
  const monthFrom = `${new Date().toISOString().slice(0, 8)}01`;
  const mix = useQuery({ queryKey: ['dashboard', 'payment-mix', monthFrom], queryFn: () => api<PaymentMix>(`/reports/payment-mix?from=${monthFrom}`), enabled: hasTenant && canReports });
  const expiry = useQuery({ queryKey: ['dashboard', 'expiry-value'], queryFn: () => api<ExpiryValue>('/reports/expiry-value'), enabled: hasTenant && canReports });
  const aging = useQuery({ queryKey: ['dashboard', 'aging'], queryFn: () => api<Aging>('/reports/aging'), enabled: hasTenant && canReports });
  const completeSetup = useMutation({
    meta: { success: 'Setup complete — you can start billing' },
    mutationFn: () => api<{ setupCompleted: boolean }>('/organizations/setup-complete', { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] }),
  });

  if (!hasTenant) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <EmptyState
          title={`Welcome${user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}`}
          hint={
            user?.isPlatformSuperadmin
              ? 'You are signed in as a platform administrator without a pharmacy workspace. Manage tenants, plans and subscriptions from the platform console.'
              : 'You are not a member of any pharmacy workspace yet. Ask an owner to invite you, or create a new organization.'
          }
          action={
            user?.isPlatformSuperadmin ? (
              <Link href="/platform"><Button>Open platform console</Button></Link>
            ) : (
              <Link href="/register"><Button variant="secondary">Create an organization</Button></Link>
            )
          }
        />
      </div>
    );
  }
  if (checklist.isLoading || org.isLoading) {
    return (
      <div className="space-y-6">
        <div className="mc-skeleton h-8 w-72" />
        <div className="mc-skeleton h-[104px] rounded-xl" />
        <SkeletonRows rows={4} />
      </div>
    );
  }
  if (checklist.error) {
    const message =
      checklist.error instanceof ApiClientError && checklist.error.status === 403
        ? 'You do not have permission to view organization data.'
        : 'Failed to load dashboard data.';
    return <ErrorState message={message} retry={() => void checklist.refetch()} />;
  }
  if (org.error) return <ErrorState message="Failed to load organization profile." retry={() => void org.refetch()} />;

  const sub = org.data?.subscription;
  const trendValues = (trend.data?.days ?? []).map((d) => Number(d.revenue));
  const trendTotal = trendValues.reduce((a, b) => a + b, 0);
  const topMax = Math.max(1, ...(trend.data?.topProducts ?? []).map((p) => Number(p.revenue)));
  const expiryMax = Math.max(1, ...(expiry.data?.buckets ?? []).map((b) => Number(b.costValue)));
  const doneCount = checklist.data?.steps.filter((s) => s.complete).length ?? 0;
  const totalSteps = checklist.data?.steps.length ?? 1;
  const progressPct = Math.round((doneCount / totalSteps) * 100);
  const k = kpis.data;
  const overdue = (b?: { buckets: Record<string, string>; total: string }) => (b ? Number(b.total) - Number(b.buckets.CURRENT ?? 0) : 0);
  const overdueReceivable = overdue(aging.data?.receivables);
  const overduePayable = overdue(aging.data?.payables);
  const setupLeft = checklist.data && !checklist.data.setupCompletedAt ? totalSteps - doneCount : 0;
  const alerts: Array<{ n: number; display?: string; label: string; href: string; tone: 'red' | 'amber' | 'blue'; always?: boolean }> = k
    ? [
        ...(k.licences ?? []).map((l) => ({
          n: Math.abs(l.daysLeft),
          label: `${l.daysLeft < 0 ? 'days since licence expired —' : 'days left on licence'} ${l.type.replace('_', ' ')} ${l.number} (${fmtDate(l.expiryDate)})`,
          href: '/compliance',
          tone: l.daysLeft <= 30 ? ('red' as const) : ('amber' as const),
          always: true,
        })),
        { n: k.alerts.expiredOnHand, label: 'expired batches still on hand', href: '/expiry', tone: 'red' as const },
        { n: k.alerts.expiring30, label: 'batches expiring within 30 days', href: '/expiry', tone: 'amber' as const },
        { n: k.alerts.lowStock, label: 'products at or below reorder level', href: '/batches', tone: 'amber' as const },
        { n: k.alerts.receiptsAwaitingInvoice, label: 'goods receipts awaiting supplier invoice', href: '/purchasing', tone: 'blue' as const },
        { n: k.alerts.openPurchaseOrders, label: 'open purchase orders', href: '/purchasing', tone: 'blue' as const },
        { n: overdueReceivable, display: money(overdueReceivable), label: 'customer dues past due date', href: '/customers', tone: 'amber' as const },
        { n: overduePayable, display: money(overduePayable), label: 'supplier dues past due date', href: '/vendors', tone: 'amber' as const },
        { n: setupLeft, label: `setup step${setupLeft === 1 ? '' : 's'} still to complete`, href: '/settings', tone: 'amber' as const },
      ].filter((a) => ('always' in a && a.always) || a.n > 0)
    : [];

  const linkCls = 'inline-flex items-center gap-0.5 text-xs font-medium text-teal-ink hover:underline';

  const rangeChips = (
    <FilterChips
      allLabel={null}
      value={trendDays}
      onChange={(v) => v && setTrendDays(v)}
      options={[
        { id: '7', label: '7 days' },
        { id: '14', label: '14 days' },
        { id: '30', label: '30 days' },
      ]}
    />
  );

  return (
    <div className="space-y-10">
      <PageHeader
        title={org.data?.name ?? 'Dashboard'}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs">{org.data?.gstin ?? 'GSTIN not set'}</span>
            <span aria-hidden>·</span>
            {sub ? (
              <>
                {sub.planName} plan
                <StatusBadge status={sub.status} label={({ TRIALING: 'Trial', ACTIVE: 'Active', PAST_DUE: 'Payment due', GRACE: 'Grace period', CANCELLED: 'Cancelled', EXPIRED: 'Expired' } as Record<string, string>)[sub.status]} />
              </>
            ) : (
              'No subscription'
            )}
            {checklist.data && !checklist.data.setupCompletedAt ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-warning">Setup {doneCount}/{totalSteps}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            {rangeChips}
            {can('sales.create') ? (
              <Link href="/pos">
                <Button>
                  <Icon name="pos" size={15} /> New sale
                </Button>
              </Link>
            ) : null}
          </>
        }
      />

      <section aria-labelledby="overview-heading" className="space-y-6">
        <h2 id="overview-heading" className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">
          Business overview
        </h2>
        {kpis.error ? (
          <ErrorState message="Live KPIs could not be loaded." retry={() => void kpis.refetch()} />
        ) : kpis.isLoading ? (
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="mc-skeleton h-40 rounded-lg lg:col-span-4" />
            <div className="mc-skeleton h-40 rounded-lg lg:col-span-8" />
          </div>
        ) : k ? (
          <>
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="flex flex-col lg:col-span-4">
                <Stat
                  variant="featured"
                  label="Today's sales"
                  value={money(k.today.revenue)}
                  hint={`${k.today.invoices} invoice${k.today.invoices === 1 ? '' : 's'}${Number(k.today.returns) ? ` · ${money(k.today.returns)} returns` : ''}`}
                  href="/sales-history"
                  spark={trendValues.filter((v) => v > 0).length >= 2 ? trendValues : undefined}
                />
                {trend.data ? (
                  <dl className="mt-auto grid grid-cols-2 gap-4 border-t border-line pt-4 text-xs">
                    <div>
                      <dt className="text-muted">Last {trendDays} days</dt>
                      <dd className="num mt-0.5 text-[15px] font-medium text-ink">{money(trendTotal)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Daily average</dt>
                      <dd className="num mt-0.5 text-[15px] font-medium text-ink">{money(trendTotal / Number(trendDays))}</dd>
                    </div>
                  </dl>
                ) : null}
              </div>
              <div className="min-w-0 lg:col-span-8 lg:border-l lg:border-line lg:pl-8">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="text-section font-[550] text-ink">Sales trend</h3>
                  <span className="text-xs text-muted">Daily net sales · last {trendDays} days</span>
                </div>
                {trend.isLoading ? (
                  <div className="mc-skeleton h-[200px] rounded-lg" />
                ) : trend.error ? (
                  <ErrorState message="Trend unavailable." retry={() => void trend.refetch()} />
                ) : (
                  <BarChart
                    height={200}
                    format={compactInr}
                    detailFormat={money}
                    emptyLabel={`No sales in the last ${trendDays} days.`}
                    sparseLabel={(n, total) => `Sales recorded on ${n} of ${total} days.`}
                    data={(trend.data?.days ?? []).map((d) => ({
                      label: new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                      value: Number(d.revenue),
                      hint: `${fmtDate(d.date)} · ${d.invoices} invoice${d.invoices === 1 ? '' : 's'}`,
                    }))}
                  />
                )}
              </div>
            </div>
            <MetricGroup bare>
              <Stat icon="sales" label="This month" value={money(k.month.revenue)} hint={`${k.month.invoices} invoices${Number(k.month.returns) ? ` · net of ${money(k.month.returns)} returns` : ''}`} href="/reports" />
              <Stat icon="batches" label="Stock valuation" value={money(k.stockValue)} hint="at purchase cost" href="/batches" />
              <Stat icon="customers" label="Receivables" value={money(k.receivables)} hint="customer credit" tone={Number(k.receivables) > 0 ? 'amber' : 'neutral'} href="/customers" />
              <Stat icon="vendors" label="Payables" value={money(k.payables)} hint="supplier dues" tone={Number(k.payables) > 0 ? 'amber' : 'neutral'} href="/vendors" />
            </MetricGroup>
          </>
        ) : null}
      </section>

      <div className="grid gap-10 lg:grid-cols-12">
        <Card variant="section" title="Top sellers" description="Best-selling products this month" className="lg:col-span-7">
          {trend.isLoading ? (
            <SkeletonRows rows={5} cols={3} />
          ) : !trend.data?.topProducts.length ? (
            <p className="py-6 text-[13px] text-muted">No sales this month yet.</p>
          ) : (
            <ol className="divide-y divide-line">
              {trend.data.topProducts.map((p, i) => (
                <li key={p.productId} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5">
                  <span className="num text-xs text-faint">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">{p.product}</p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
                      <div className="mc-anim-grow-x h-full origin-left rounded-full bg-accent/70" style={{ width: `${(Number(p.revenue) / topMax) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="num text-[13px] font-medium text-ink">{money(p.revenue)}</p>
                    <p className="num text-2xs text-muted">{p.quantity.toLocaleString('en-IN')} units</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card variant="section" title="Needs attention" className="lg:col-span-5">
          {kpis.isLoading ? (
            <SkeletonRows rows={3} cols={2} />
          ) : alerts.length === 0 ? (
            <p className="flex items-center gap-2 py-3 text-[13px] text-muted">
              <Icon name="checkCircle" size={15} className="shrink-0 text-success" />
              All clear — no expiry, stock, purchasing or payment alerts.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((a) => (
                <li key={a.label}>
                  <Link href={a.href} className="group flex items-center gap-3 py-2.5">
                    <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', a.tone === 'red' ? 'bg-danger' : a.tone === 'amber' ? 'bg-warning' : 'bg-info')} />
                    <span className="num min-w-7 shrink-0 text-right text-[15px] font-medium text-ink">{a.display ?? a.n}</span>
                    <span className="flex-1 text-[13px] text-muted group-hover:text-ink">{a.label}</span>
                    <Icon name="chevronRight" size={14} className="text-faint group-hover:text-teal-ink" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {checklist.data && !checklist.data.setupCompletedAt && can('organization.settings.manage') ? (
        <Card
          variant="section"
          title="Setup checklist"
          description="Real transactions are blocked until essential setup is complete."
          actions={
            <div className="flex items-center gap-2">
              <div
                className="h-1.5 w-32 overflow-hidden rounded-full bg-subtle"
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={0}
                aria-valuemax={totalSteps}
                aria-valuenow={doneCount}
              >
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="num text-xs text-muted">
                {doneCount} of {totalSteps}
              </span>
            </div>
          }
        >
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {checklist.data.steps.map((s) => (
              <li key={s.key} className="border-b border-line">
                <Link href={STEP_LINKS[s.key] ?? '/settings'} className="group flex items-center gap-2.5 py-2.5 text-[13px]">
                  <Icon name={s.complete ? 'checkCircle' : 'circle'} size={16} className={s.complete ? 'text-success' : 'text-neutral-300'} />
                  <span className={cn('flex-1', s.complete ? 'text-muted line-through decoration-neutral-300' : 'text-ink group-hover:text-teal-ink')}>{s.label}</span>
                  {!s.complete ? <span className={cn('text-2xs font-medium', s.required === false ? 'text-faint' : 'text-warning')}>{s.required === false ? 'Recommended' : 'Required'}</span> : null}
                  <Icon name="chevronRight" size={14} className="text-faint group-hover:text-teal-ink" />
                </Link>
              </li>
            ))}
          </ul>
          {checklist.data.allComplete ? (
            <div className="mt-4 flex justify-end">
              <Button disabled={completeSetup.isPending} onClick={() => completeSetup.mutate()}>
                {completeSetup.isPending ? 'Completing…' : 'Complete setup'}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-12">
        <Card variant="section" title="Recent invoices" className="lg:col-span-7" actions={<Link href="/sales-history" className={linkCls}>View all <Icon name="arrowRight" size={12} /></Link>}>
          {kpis.isLoading ? (
            <SkeletonRows rows={4} cols={4} />
          ) : !k || k.recentInvoices.length === 0 ? (
            <p className="py-6 text-[13px] text-muted">No sales yet. Your first POS invoice will appear here.</p>
          ) : (
            <Table head={<tr><Th>Invoice</Th><Th>Customer</Th><Th>Date</Th><Th>Status</Th><Th right>Total</Th></tr>}>
              {k.recentInvoices.map((inv) => (
                <Tr key={inv.id} onClick={() => router.push(`/sales-history/${inv.id}`)}>
                  <Td className="font-mono text-xs font-medium text-teal-ink">{inv.invoiceNumber}</Td>
                  <Td>{inv.party}</Td>
                  <Td className="text-muted">{fmtDate(inv.invoiceDate)}</Td>
                  <Td><StatusBadge status={inv.status} /></Td>
                  <Td right className="font-medium">{money(inv.total)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
        {canReports ? (
          <Card variant="section" title="Payment mix" description="Collected this month by tender" className="lg:col-span-5">
            {mix.isLoading ? (
              <div className="mc-skeleton h-32 rounded-lg" />
            ) : mix.error ? (
              <ErrorState message="Payment mix unavailable." retry={() => void mix.refetch()} />
            ) : (
              <Donut
                format={compactInr}
                centerLabel="collected"
                data={(mix.data?.methods ?? []).map((m) => ({ label: METHOD_LABELS[m.method] ?? m.method, value: Number(m.amount) }))}
              />
            )}
          </Card>
        ) : null}
      </div>

      {canReports ? (
        <div className="grid gap-10 lg:grid-cols-2">
          <Card variant="section" title="Expiry value at risk" actions={<Link href="/expiry" className={linkCls}>Expiry <Icon name="arrowRight" size={12} /></Link>}>
            {expiry.isLoading ? (
              <SkeletonRows rows={5} cols={2} />
            ) : expiry.error ? (
              <ErrorState message="Expiry values unavailable." retry={() => void expiry.refetch()} />
            ) : (
              <ul className="divide-y divide-line">
                {(expiry.data?.buckets ?? []).map((b) => (
                  <li key={b.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[13px]">
                        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', b.key === 'EXPIRED' ? 'bg-danger' : b.key === 'D0_30' ? 'bg-warning' : 'bg-neutral-300')} />
                        <span className="text-ink">{b.label}</span>
                        <span className="text-xs text-muted">{b.batches} batch{b.batches === 1 ? '' : 'es'}</span>
                      </p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <div className={cn('mc-anim-grow-x h-full origin-left rounded-full', b.key === 'EXPIRED' ? 'bg-danger/70' : b.key === 'D0_30' ? 'bg-warning/70' : 'bg-accent/50')} style={{ width: `${(Number(b.costValue) / expiryMax) * 100}%` }} />
                      </div>
                    </div>
                    <span className="num text-[13px] font-medium text-ink">{money(b.costValue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card variant="section" title="Receivable aging" actions={<Link href="/reports" className={linkCls}>Reports <Icon name="arrowRight" size={12} /></Link>}>
            {aging.isLoading ? (
              <SkeletonRows rows={5} cols={2} />
            ) : aging.error ? (
              <ErrorState message="Aging unavailable." retry={() => void aging.refetch()} />
            ) : Number(aging.data?.receivables.total ?? 0) === 0 ? (
              <p className="py-6 text-[13px] text-muted">No customer credit outstanding.</p>
            ) : (
              <>
                <BarChart
                  height={150}
                  tone="amber"
                  format={compactInr}
                  detailFormat={money}
                  data={Object.entries(aging.data!.receivables.buckets).map(([key, v]) => ({ label: AGING_LABELS[key] ?? key, value: Number(v) }))}
                />
                <p className="num mt-2 text-xs text-muted">Total outstanding {money(aging.data!.receivables.total)}</p>
              </>
            )}
          </Card>
        </div>
      ) : null}

      <Card variant="section" title="Quick links">
        <ul className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((m) => can(m.permission)).map((m) => (
            <li key={m.href} className="border-b border-line">
              <Link href={m.href} className="group flex items-center gap-3 py-2.5">
                <Icon name={m.icon} size={16} className="text-faint transition-colors group-hover:text-teal-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink group-hover:text-teal-ink">{m.label}</span>
                  <span className="block truncate text-xs text-muted">{m.desc}</span>
                </span>
                <Icon name="chevronRight" size={14} className="text-faint transition-colors group-hover:text-teal-ink" />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
