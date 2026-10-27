'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { markSignedOut, useCurrentMembership, useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Icon } from './icons';
import { Kbd } from './kit';
import { NAV, type NavItem } from './nav';
import { Breadcrumbs, CommandPalette, NotificationBell, ProfileMenu } from './shell-parts';
import { Badge, Select, cn } from './ui';

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
      <Link href="/billing" className="group inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline">
        View plans
        <Icon name="arrowRight" size={13} className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const resend = async () => {
    setState('sending');
    try {
      await api('/auth/email/verify/resend', { method: 'POST' });
      setState('sent');
      toast.success('Verification email sent', `Open the link we sent to ${email}.`);
    } catch (e) {
      setState('idle');
      toast.error('Couldn’t send the email', e instanceof Error ? e.message : 'Please try again.');
    }
  };
  return (
    <div className="no-print mc-anim-fade-in flex items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-5 py-2 text-xs text-sky-900">
      <span className="inline-flex items-center gap-2">
        <Icon name="mail" size={14} className="text-sky-600" />
        <span>
          Please verify <strong>{email}</strong> so password resets and invoices reach you.
        </span>
      </span>
      <button type="button" disabled={state !== 'idle'} onClick={() => void resend()} className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline disabled:opacity-60">
        {state === 'sent' ? (
          <>
            Link sent <Icon name="check" size={13} strokeWidth={2.5} />
          </>
        ) : state === 'sending' ? (
          'Sending…'
        ) : (
          'Send verification link'
        )}
      </button>
    </div>
  );
}

const COLLAPSED_KEY = 'medicore.sidebar.collapsed';

function SidebarNav({
  groups,
  collapsed,
  isActive,
  locked,
  onNavigate,
}: {
  groups: Array<{ section: string; items: NavItem[] }>;
  collapsed: boolean;
  isActive: (href: string) => boolean;
  locked: (module?: string) => boolean;
  onNavigate?: () => void;
}) {
  let navIndex = 0;
  return (
    <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
      {groups.map((group) => (
        <div key={group.section} className="pt-2 first:pt-0">
          {!collapsed && group.section !== 'Overview' ? (
            <div className="mc-anim-fade-in px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{group.section}</div>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(item.href);
            const i = navIndex++;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'mc-anim-slide-in group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                  'transition-all duration-200 ease-out',
                  active ? 'bg-brand-50 font-semibold text-brand-700' : 'text-neutral-600 hover:bg-neutral-100/80 hover:text-neutral-900',
                )}
                style={{ animationDelay: `${i * 25}ms` }}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-brand-400 to-brand-600 transition-all duration-300',
                    active ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
                  )}
                />
                <Icon
                  name={item.icon}
                  size={17}
                  strokeWidth={active ? 2.1 : 1.75}
                  className={cn('transition-all duration-200', active ? 'text-brand-600' : 'text-neutral-400 group-hover:scale-110 group-hover:text-brand-600', collapsed && 'mx-auto')}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && locked(item.module) ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-500" title="Not included in your plan">
                    <Icon name="lock" size={9} strokeWidth={2.5} />
                    Upgrade
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-4">
      <div className="mc-anim-scale-in flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30">
        <Icon name="products" size={17} strokeWidth={2} />
      </div>
      {!collapsed && (
        <div className="mc-anim-fade-in min-w-0">
          <div className="truncate text-sm font-bold tracking-tight">
            <span className="mc-gradient-text">MediCore</span>
          </div>
          <div className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">Pharmacy ERP</div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, tenant, setTenant } = useSession();
  const membership = useCurrentMembership();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === '1');
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      window.localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      return !c;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Server remains authoritative — nav visibility only mirrors granted permissions.
  const subscription = useQuery({
    queryKey: ['subscription', tenant?.organizationId],
    queryFn: () => api<SubscriptionSummary>('/organizations/subscription'),
    enabled: Boolean(tenant?.organizationId),
    refetchInterval: 5 * 60_000,
  });
  const modules = subscription.data?.subscription?.modules;
  const locked = (module?: string) => Boolean(module && modules && !modules.includes('*') && !modules.includes(module));

  const canSee = useCallback(
    (permission?: string) => {
      if (!permission) return true;
      if (permission === 'platform') return Boolean(user?.isPlatformSuperadmin);
      if (!membership) return false;
      return membership.isOwner || membership.permissions.includes(permission);
    },
    [user, membership],
  );
  const groups = useMemo(
    () => NAV.map((group) => ({ ...group, items: group.items.filter((item) => canSee(item.permission)) })).filter((group) => group.items.length > 0),
    [canSee],
  );
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  const switchOrg = (organizationId: string) => {
    const m = user?.memberships.find((x) => x.organizationId === organizationId);
    setTenant({ organizationId, branchId: m?.branches[0]?.id ?? null });
    toast.info('Workspace switched', m?.organizationName);
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    markSignedOut();
    // Full navigation drops every cached query and in-memory record from the signed-out session.
    window.location.replace('/login');
  };

  const orgFooter = membership ? (
    <div className="border-t border-neutral-100 px-3 py-3">
      {!collapsed ? (
        <div className="mc-anim-fade-in">
          <div className="truncate text-xs font-semibold text-neutral-700">{membership.organizationName}</div>
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
  ) : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          'no-print relative hidden flex-col border-r border-neutral-200/80 bg-white transition-[width] duration-300 ease-out md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Brand collapsed={collapsed} />
        <SidebarNav groups={groups} collapsed={collapsed} isActive={isActive} locked={locked} />
        {orgFooter}
        <button
          className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white text-[10px] text-neutral-500 shadow-sm transition-all duration-200 hover:scale-110 hover:border-brand-300 hover:text-brand-600"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={13} strokeWidth={2.25} />
        </button>
      </aside>

      {mobileOpen ? (
        <div className="no-print fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button aria-label="Close menu" className="mc-anim-fade-in absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
          <aside className="mc-anim-slide-in relative flex h-full w-72 flex-col bg-white shadow-2xl">
            <Brand collapsed={false} />
            <SidebarNav groups={groups} collapsed={false} isActive={isActive} locked={locked} onNavigate={() => setMobileOpen(false)} />
            {orgFooter}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-shell className="no-print mc-anim-fade-in relative z-30 flex items-center gap-3 border-b border-neutral-200/80 bg-white/90 px-3 py-2.5 backdrop-blur sm:px-5">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size={17} />
          </button>
          <Breadcrumbs pathname={pathname} />
          <div className="flex flex-1 items-center justify-end gap-2 lg:justify-start lg:pl-3">
            <Select aria-label="Organization" className="hidden w-48 sm:block" value={tenant?.organizationId ?? ''} onChange={(e) => switchOrg(e.target.value)}>
              {user?.memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationName}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Branch"
              className="hidden w-40 sm:block"
              value={tenant?.branchId ?? ''}
              onChange={(e) => tenant && setTenant({ organizationId: tenant.organizationId, branchId: e.target.value || null })}
            >
              <option value="">All branches</option>
              {membership?.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-8 items-center gap-2 rounded-full border border-neutral-200 bg-white pl-3 pr-1.5 text-xs text-neutral-500 shadow-sm transition-all hover:border-brand-300 hover:text-brand-700"
              aria-label="Search (Ctrl or Cmd + K)"
            >
              <Icon name="search" size={14} />
              <span className="hidden lg:inline">Search…</span>
              <span className="hidden items-center gap-0.5 sm:flex">
                <Kbd>
                  <Icon name="command" size={10} strokeWidth={2.25} />
                </Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            {tenant?.organizationId && canSee('reports.read') ? <NotificationBell organizationId={tenant.organizationId} /> : null}
            {user ? <ProfileMenu fullName={user.fullName} email={user.email} roleName={membership?.roleName} onLogout={logout} /> : null}
          </div>
        </header>
        {user && !user.emailVerified ? <VerifyEmailBanner email={user.email} /> : null}
        <SubscriptionBanner data={subscription.data} />
        <main key={pathname} className="mc-anim-fade-in min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(45,212,191,0.04),transparent_60%)] p-3 sm:p-5">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navItems={flatItems} />
    </div>
  );
}
