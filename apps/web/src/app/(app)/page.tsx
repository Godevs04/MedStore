'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership, useSession } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorBanner, ErrorState, SkeletonRows, Stat, Table, Td, Th, Tr, cn, fmtDate, money } from '@/components/ui';

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

const MODULES = [
  { href: '/pos', label: 'POS billing', desc: 'Scan, FEFO batches, split tenders, GST invoice', icon: '⌁', permission: 'sales.create' },
  { href: '/purchasing', label: 'Purchasing', desc: 'PO → GRN → supplier invoice → payment', icon: '⇣', permission: 'purchases.read' },
  { href: '/batches', label: 'Batch inventory', desc: 'Batch, expiry, recall and stock ledger', icon: '▦', permission: 'inventory.read' },
  { href: '/accounting', label: 'Accounting', desc: 'Journals, trial balance, P&L, balance sheet', icon: '∑', permission: 'accounting.read' },
  { href: '/compliance', label: 'Compliance', desc: 'Schedule H1 register, GST summaries, licences', icon: '⚖', permission: 'compliance.read' },
  { href: '/reports', label: 'Reports', desc: 'Sales, valuation, aging — CSV export', icon: '▤', permission: 'reports.read' },
];

const STEP_LINKS: Record<string, string> = {
  business_profile: '/settings',
  gst: '/settings',
  branch: '/branches',
  warehouse: '/branches',
  users: '/users',
  tax_rates: '/configuration',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  POSTED: 'green',
  PARTIALLY_RETURNED: 'amber',
  RETURNED: 'red',
  CANCELLED: 'neutral',
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
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="mc-skeleton h-8 w-72" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="mc-skeleton h-24 rounded-xl" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <SkeletonRows rows={4} />
        </div>
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
  const doneCount = checklist.data?.steps.filter((s) => s.complete).length ?? 0;
  const totalSteps = checklist.data?.steps.length ?? 1;
  const progressPct = Math.round((doneCount / totalSteps) * 100);
  const k = kpis.data;
  const alerts = k
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
      ].filter((a) => ('always' in a && a.always) || a.n > 0)
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="mc-anim-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">{org.data?.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-neutral-500">
            <span className="font-mono text-xs">{org.data?.gstin ?? 'GSTIN not set'}</span>
            <span>·</span>
            {sub ? (
              <>
                {sub.planName} plan
                <Badge tone={sub.status === 'TRIALING' ? 'amber' : 'green'} dot>
                  {sub.status}
                </Badge>
              </>
            ) : (
              'No subscription'
            )}
          </p>
        </div>
        {can('sales.create') ? (
          <Link href="/pos">
            <Button>⌁ New sale</Button>
          </Link>
        ) : null}
      </div>

      {kpis.error ? null : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Today's sales" value={k ? money(k.today.revenue) : '…'} hint={k ? `${k.today.invoices} invoices${Number(k.today.returns) ? ` · net of ${money(k.today.returns)} returns` : ''}` : undefined} tone="blue" delay={0} href="/sales-history" />
          <Stat label="This month" value={k ? money(k.month.revenue) : '…'} hint={k ? `${k.month.invoices} invoices${Number(k.month.returns) ? ` · net of ${money(k.month.returns)} returns` : ''}` : undefined} tone="green" delay={60} href="/reports" />
          <Stat label="Stock value" value={k ? money(k.stockValue) : '…'} hint="at purchase cost" tone="neutral" delay={120} href="/batches" />
          <Stat label="Receivables" value={k ? money(k.receivables) : '…'} hint="customer credit" tone="amber" delay={180} href="/customers" />
          <Stat label="Payables" value={k ? money(k.payables) : '…'} hint="supplier dues" tone="red" delay={240} href="/vendors" />
        </div>
      )}

      {checklist.data && !checklist.data.setupCompletedAt ? (
        <Card
          title="Setup checklist"
          delay={120}
          actions={
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-700" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-xs tabular-nums text-neutral-500">
                {doneCount}/{totalSteps}
              </span>
            </div>
          }
        >
          <div className="mc-stagger grid gap-2 sm:grid-cols-2">
            {checklist.data.steps.map((s) => (
              <Link
                key={s.key}
                href={STEP_LINKS[s.key] ?? '/settings'}
                className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50/50 px-3 py-2 transition-all duration-200 hover:border-brand-200 hover:bg-brand-50/40"
              >
                <span className="text-sm text-neutral-700">{s.label}</span>
                <Badge tone={s.complete ? 'green' : s.required === false ? 'blue' : 'amber'} dot>
                  {s.complete ? 'Done' : s.required === false ? 'Recommended' : 'Pending'}
                </Badge>
              </Link>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs leading-relaxed text-neutral-500">
              Real transactions are blocked until essential setup is complete. Configure business details under{' '}
              <Link className="font-medium text-brand-700 hover:underline" href="/settings">
                Settings
              </Link>
              , tax rates under{' '}
              <Link className="font-medium text-brand-700 hover:underline" href="/configuration">
                Configuration
              </Link>{' '}
              and a warehouse under{' '}
              <Link className="font-medium text-brand-700 hover:underline" href="/branches">
                Branches
              </Link>
              .
            </p>
            {checklist.data.allComplete ? (
              <Button disabled={completeSetup.isPending} onClick={() => completeSetup.mutate()}>
                {completeSetup.isPending ? 'Completing…' : 'Complete setup'}
              </Button>
            ) : null}
          </div>
          {completeSetup.error ? (
            <div className="mt-2">
              <ErrorBanner>{completeSetup.error instanceof ApiClientError ? completeSetup.error.message : 'Failed to complete setup'}</ErrorBanner>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Recent invoices" className="lg:col-span-3" delay={180} actions={<Link href="/sales-history" className="text-xs font-medium text-brand-700 hover:underline">View all →</Link>}>
          {kpis.isLoading ? (
            <SkeletonRows rows={4} cols={4} />
          ) : !k || k.recentInvoices.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">No sales yet — your first POS invoice will appear here.</p>
          ) : (
            <Table head={<tr><Th>Invoice</Th><Th>Customer</Th><Th>Date</Th><Th>Status</Th><Th right>Total</Th></tr>}>
              {k.recentInvoices.map((inv) => (
                <Tr key={inv.id} onClick={() => router.push(`/sales-history/${inv.id}`)}>
                  <Td className="font-mono text-xs font-medium text-brand-700">{inv.invoiceNumber}</Td>
                  <Td>{inv.party}</Td>
                  <Td className="text-neutral-500">{fmtDate(inv.invoiceDate)}</Td>
                  <Td><Badge tone={STATUS_TONE[inv.status] ?? 'neutral'}>{inv.status.replace('_', ' ').toLowerCase()}</Badge></Td>
                  <Td right className="font-medium">{money(inv.total)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Needs attention" className="lg:col-span-2" delay={240}>
          {kpis.isLoading ? (
            <SkeletonRows rows={3} cols={2} />
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-lg text-emerald-600 ring-1 ring-emerald-100">✓</span>
              <p className="text-sm text-neutral-600">All clear — no expiry, stock or purchasing alerts.</p>
            </div>
          ) : (
            <ul className="mc-stagger space-y-2">
              {alerts.map((a) => (
                <li key={a.label}>
                  <Link href={a.href} className="flex items-center gap-3 rounded-lg border border-neutral-100 px-3 py-2 transition-all duration-200 hover:border-brand-200 hover:bg-brand-50/40">
                    <span
                      className={cn(
                        'flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-sm font-semibold tabular-nums',
                        a.tone === 'red' ? 'bg-red-50 text-red-700' : a.tone === 'amber' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-700',
                      )}
                    >
                      {a.n}
                    </span>
                    <span className="text-sm text-neutral-700">{a.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Modules" delay={300}>
        <div className="mc-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.filter((m) => can(m.permission)).map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="group flex items-start gap-3 rounded-xl border border-neutral-200/80 bg-gradient-to-br from-white to-neutral-50/60 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-base text-brand-700 ring-1 ring-brand-100 transition-transform group-hover:scale-110">{m.icon}</span>
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800 group-hover:text-brand-700">
                  {m.label}
                  <Badge tone="green" dot>Live</Badge>
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500">{m.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
