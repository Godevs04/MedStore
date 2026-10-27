'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentMembership, useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { Badge, Button, Select, cn } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: string;
  /** Plan module key; the item shows a lock when the plan excludes it. */
  module?: string;
}

export interface SubscriptionSummary {
  suspended: boolean;
  subscription: {
    status: string;
    planKey: string;
    planName: string;
    planDescription: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string;
    endsAt: string;
    daysLeft: number;
    lapsed: boolean;
    modules: string[];
  } | null;
  usage: Record<'branches' | 'users' | 'warehouses' | 'invoicesThisMonth', { used: number; limit: number | null }>;
  plans: Array<{ key: string; name: string; description: string | null; limits: Record<string, unknown> }>;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  { section: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: '◧' }] },
  {
    section: 'Sell',
    items: [
      { href: '/pos', label: 'POS billing', icon: '⌁', permission: 'sales.create', module: 'pos' },
      { href: '/sales-history', label: 'Sales & returns', icon: '🧾', permission: 'sales.read' },
      { href: '/customers', label: 'Customers', icon: '☺', permission: 'customers.read' },
    ],
  },
  {
    section: 'Buy',
    items: [
      { href: '/purchasing', label: 'Purchasing', icon: '⇣', permission: 'purchases.read', module: 'purchases' },
      { href: '/vendors', label: 'Vendors', icon: '⇄', permission: 'vendors.read' },
    ],
  },
  {
    section: 'Stock',
    items: [
      { href: '/products', label: 'Products', icon: '✚', permission: 'products.read' },
      { href: '/batches', label: 'Batch inventory', icon: '▦', permission: 'inventory.read' },
      { href: '/expiry', label: 'Expiry dashboard', icon: '◔', permission: 'inventory.read' },
      { href: '/ledger', label: 'Stock ledger', icon: '≡', permission: 'inventory.read' },
      { href: '/adjustments', label: 'Adjustments', icon: '±', permission: 'inventory.adjust' },
      { href: '/transfers', label: 'Transfers', icon: '⇆', permission: 'inventory.transfer' },
      { href: '/counts', label: 'Stock counts', icon: '✓', permission: 'inventory.count' },
    ],
  },
  {
    section: 'Finance & compliance',
    items: [
      { href: '/accounting', label: 'Accounting', icon: '∑', permission: 'accounting.read', module: 'accounting' },
      { href: '/compliance', label: 'Compliance', icon: '⚖', permission: 'compliance.read' },
      { href: '/reports', label: 'Reports', icon: '▤', permission: 'reports.read' },
    ],
  },
  {
    section: 'Admin',
    items: [
      { href: '/configuration', label: 'Configuration', icon: '⌗', permission: 'tax.read' },
      { href: '/import', label: 'Import', icon: '⇪', permission: 'products.import' },
      { href: '/users', label: 'Users', icon: '◉', permission: 'users.read' },
      { href: '/roles', label: 'Roles', icon: '⛨', permission: 'roles.read' },
      { href: '/branches', label: 'Branches', icon: '⌂', permission: 'branches.read' },
      { href: '/settings', label: 'Settings', icon: '⚙', permission: 'organization.read' },
      { href: '/billing', label: 'Plan & billing', icon: '◈', permission: 'organization.read' },
      { href: '/audit', label: 'Audit log', icon: '☰', permission: 'audit.read' },
    ],
  },
  { section: 'Platform', items: [{ href: '/platform', label: 'Platform console', icon: '⬢', permission: 'platform' }] },
];

function SubscriptionBanner({ data }: { data: SubscriptionSummary | undefined }) {
  if (!data) return null;
  const sub = data.subscription;
  let tone = '';
  let text = '';
  if (data.suspended) {
    tone = 'border-red-200 bg-red-50 text-red-800';
    text = 'This workspace is suspended by the platform administrator. Contact MediCore support to restore access.';
  } else if (sub?.lapsed) {
    tone = 'border-red-200 bg-red-50 text-red-800';
    text = `Your ${sub.planName} subscription has ended. Records stay readable, but billing and postings are paused until renewal.`;
  } else if (sub && sub.status === 'TRIALING' && sub.daysLeft <= 14) {
    tone = sub.daysLeft <= 3 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-100 bg-brand-50/70 text-brand-900';
    text = `Free trial · ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left. Choose a plan to keep your pharmacy running without interruption.`;
  } else if (sub && sub.daysLeft <= 7) {
    tone = 'border-amber-200 bg-amber-50 text-amber-900';
    text = `Your ${sub.planName} plan renews in ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'}.`;
  }
  if (!text) return null;
  return (
    <div className={cn('no-print mc-anim-fade-in flex items-center justify-between gap-3 border-b px-5 py-2 text-xs', tone)}>
      <span>{text}</span>
      <Link href="/billing" className="shrink-0 font-semibold underline-offset-2 hover:underline">
        View plans →
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, tenant, setTenant, refetch } = useSession();
  const membership = useCurrentMembership();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // Server remains authoritative — nav visibility only mirrors granted permissions.
  const subscription = useQuery({
    queryKey: ['subscription', tenant?.organizationId],
    queryFn: () => api<SubscriptionSummary>('/organizations/subscription'),
    enabled: Boolean(tenant?.organizationId),
    refetchInterval: 5 * 60_000,
  });
  const modules = subscription.data?.subscription?.modules;
  const locked = (module?: string) => Boolean(module && modules && !modules.includes('*') && !modules.includes(module));

  const canSee = (permission?: string) => {
    if (!permission) return true;
    if (permission === 'platform') return Boolean(user?.isPlatformSuperadmin);
    if (!membership) return false;
    return membership.isOwner || membership.permissions.includes(permission);
  };
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
  let navIndex = 0;

  const switchOrg = (organizationId: string) => {
    const m = user?.memberships.find((x) => x.organizationId === organizationId);
    setTenant({ organizationId, branchId: m?.branches[0]?.id ?? null });
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    refetch();
    router.replace('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          'no-print relative flex flex-col border-r border-neutral-200/80 bg-white transition-[width] duration-300 ease-out',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="mc-anim-scale-in flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-md shadow-brand-600/30">
            M
          </div>
          {!collapsed && (
            <div className="mc-anim-fade-in min-w-0">
              <div className="truncate text-sm font-bold tracking-tight">
                <span className="mc-gradient-text">MediCore</span>
              </div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
                Pharmacy ERP
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
          {NAV.map((group) => ({ ...group, items: group.items.filter((item) => canSee(item.permission)) }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.section} className="pt-2 first:pt-0">
                {!collapsed && group.section !== 'Overview' ? (
                  <div className="mc-anim-fade-in px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                    {group.section}
                  </div>
                ) : null}
                {group.items.map((item) => {
            const active = isActive(item.href);
            const i = navIndex++;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'mc-anim-slide-in group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                  'transition-all duration-200 ease-out',
                  active
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-neutral-600 hover:bg-neutral-100/80 hover:text-neutral-900',
                )}
                style={{ animationDelay: `${i * 25}ms` }}
              >
                {/* Active indicator bar */}
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 transition-all duration-300',
                    active ? 'opacity-100 scale-100' : 'opacity-0 scale-0',
                  )}
                />
                <span
                  className={cn(
                    'w-4 text-center text-[13px] transition-transform duration-200',
                    !active && 'group-hover:scale-110',
                  )}
                  aria-hidden
                >
                  {item.icon}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && locked(item.module) ? (
                  <span className="ml-auto rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-500" title="Not included in your plan">
                    Upgrade
                  </span>
                ) : null}
              </Link>
            );
                })}
              </div>
            ))}
        </nav>

        {/* Org footer */}
        {membership ? (
          <div className="border-t border-neutral-100 px-3 py-3">
            {!collapsed ? (
              <div className="mc-anim-fade-in">
                <div className="truncate text-xs font-semibold text-neutral-700">
                  {membership.organizationName}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone={membership.isOwner ? 'green' : 'blue'} dot>
                    {membership.roleName}
                  </Badge>
                  {subscription.data?.subscription ? (
                    <Link href="/billing">
                      <Badge tone={subscription.data.subscription.lapsed ? 'red' : 'neutral'}>{subscription.data.subscription.planName}</Badge>
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex justify-center">
                <Badge tone={membership.isOwner ? 'green' : 'blue'}>{membership.roleName[0]}</Badge>
              </div>
            )}
          </div>
        ) : null}

        {/* Collapse toggle */}
        <button
          className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-[10px] text-neutral-500 shadow-sm transition-all duration-200 hover:scale-110 hover:border-brand-300 hover:text-brand-600"
          onClick={() => setCollapsed((c) => !c)}
          aria-label="Toggle sidebar"
        >
          {collapsed ? '›' : '‹'}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-shell className="no-print mc-anim-fade-in flex items-center gap-3 border-b border-neutral-200/80 bg-white/90 px-5 py-2.5 backdrop-blur">
          <div className="flex flex-1 items-center gap-2">
            <Select
              aria-label="Organization"
              className="w-56"
              value={tenant?.organizationId ?? ''}
              onChange={(e) => switchOrg(e.target.value)}
            >
              {user?.memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationName}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Branch"
              className="w-44"
              value={tenant?.branchId ?? ''}
              onChange={(e) =>
                tenant && setTenant({ organizationId: tenant.organizationId, branchId: e.target.value || null })
              }
            >
              <option value="">All branches</option>
              {membership?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1 pl-1 pr-3 shadow-sm">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[10px] font-bold text-white">
                {user?.fullName.slice(0, 1).toUpperCase()}
              </span>
              <span className="text-xs font-medium text-neutral-700">{user?.fullName}</span>
            </div>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>
        <SubscriptionBanner data={subscription.data} />
        <main key={pathname} className="mc-anim-fade-up min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(45,212,191,0.04),transparent_60%)] p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
