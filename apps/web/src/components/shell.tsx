'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { markSignedOut, useCurrentMembership, useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Icon, type IconName } from './icons';
import { Kbd } from './kit';
import { Logo } from './logo';
import { NAV, type NavItem } from './nav';
import { Breadcrumbs, CommandPalette, NotificationBell, ProfileMenu } from './shell-parts';
import { IconButton, Select, cn } from './ui';

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

function ShellNotice({ tone, icon, children, action }: { tone: 'info' | 'warning' | 'danger'; icon: IconName; children: React.ReactNode; action?: React.ReactNode }) {
  const tones = {
    info: 'bg-mint/60 text-brand-deep [&_svg:first-child]:text-teal-ink',
    warning: 'bg-warning/10 text-ink [&_svg:first-child]:text-warning',
    danger: 'bg-danger/10 text-ink [&_svg:first-child]:text-danger',
  };
  return (
    <div className={cn('no-print mc-anim-fade-in flex h-8 items-center justify-between gap-3 border-b border-line px-4 text-xs sm:px-6 lg:px-8', tones[tone])} role="status">
      <span className="flex min-w-0 items-center gap-2">
        <Icon name={icon} size={14} />
        <span className="min-w-0 truncate">{children}</span>
      </span>
      {action}
    </div>
  );
}

function SubscriptionBanner({ data }: { data: SubscriptionSummary | undefined }) {
  if (!data) return null;
  const sub = data.subscription;
  let tone: 'info' | 'warning' | 'danger' = 'info';
  let text: React.ReactNode = '';
  if (data.suspended) {
    tone = 'danger';
    text = 'This workspace is suspended by the platform administrator. Contact MediCore support to restore access.';
  } else if (sub?.lapsed) {
    tone = 'danger';
    text = `Your ${sub.planName} subscription has ended. Records stay readable, but billing and postings are paused until renewal.`;
  } else if (sub && sub.status === 'TRIALING' && sub.daysLeft <= 14) {
    tone = sub.daysLeft <= 3 ? 'warning' : 'info';
    text = (
      <>
        <span className="font-medium">Free trial · {sub.daysLeft} day{sub.daysLeft === 1 ? '' : 's'} left</span>
        <span className="hidden text-muted md:inline"> — choose a plan to keep billing without interruption.</span>
      </>
    );
  } else if (sub && sub.daysLeft <= 7) {
    tone = 'warning';
    text = `Your ${sub.planName} plan renews in ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'}.`;
  }
  if (!text) return null;
  return (
    <ShellNotice
      tone={tone}
      icon={tone === 'danger' ? 'danger' : 'billing'}
      action={
        <Link href="/billing" className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline">
          View plans
          <Icon name="arrowRight" size={12} />
        </Link>
      }
    >
      {text}
    </ShellNotice>
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
    <ShellNotice
      tone="info"
      icon="mail"
      action={
        <button type="button" disabled={state !== 'idle'} onClick={() => void resend()} className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline disabled:opacity-60">
          {state === 'sent' ? (
            <>
              Link sent <Icon name="check" size={12} strokeWidth={2.5} />
            </>
          ) : state === 'sending' ? (
            'Sending…'
          ) : (
            'Send verification link'
          )}
        </button>
      }
    >
      Please verify <strong>{email}</strong> so password resets and invoices reach you.
    </ShellNotice>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'M';
}

const COLLAPSED_KEY = 'medicore.sidebar.collapsed';
const CLOSED_GROUPS_KEY = 'medicore.sidebar.closedGroups';

function useClosedGroups() {
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(CLOSED_GROUPS_KEY) ?? '[]');
      if (Array.isArray(parsed)) setClosed(parsed.filter((x): x is string => typeof x === 'string'));
    } catch {
      /* ignore corrupt preference */
    }
  }, []);
  const toggle = (section: string) =>
    setClosed((c) => {
      const next = c.includes(section) ? c.filter((s) => s !== section) : [...c, section];
      window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  return { closed, toggle };
}

function SidebarNav({
  groups,
  collapsed,
  isActive,
  locked,
  onNavigate,
  label = 'Main',
}: {
  label?: string;
  groups: Array<{ section: string; items: NavItem[] }>;
  collapsed: boolean;
  isActive: (href: string) => boolean;
  locked: (module?: string) => boolean;
  onNavigate?: () => void;
}) {
  const { closed, toggle } = useClosedGroups();
  const navRef = useRef<HTMLElement>(null);
  const activeHref = groups.flatMap((g) => g.items).find((i) => isActive(i.href))?.href;
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeHref]);
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (label: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  return (
    <nav ref={navRef} aria-label={label} className={cn('min-h-0 flex-1 overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
      {groups.map((group) => {
        const hasActive = group.items.some((i) => isActive(i.href));
        const titled = group.section !== 'Overview';
        const open = collapsed || !titled || hasActive || !closed.includes(group.section);
        const listId = `nav-${group.section.replace(/\W+/g, '-').toLowerCase()}`;
        return (
          <div key={group.section} className={cn(titled && 'mt-4', collapsed && titled && 'mt-2 border-t border-line pt-2')}>
            {!collapsed && titled ? (
              <button
                type="button"
                onClick={() => toggle(group.section)}
                aria-expanded={open}
                aria-controls={listId}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-2xs font-medium text-faint transition-colors hover:text-muted"
              >
                {group.section}
                <Icon name="chevronDown" size={12} className={cn('transition-transform duration-150', !open && '-rotate-90')} />
              </button>
            ) : null}
            <div id={listId} className="mc-collapse" data-open={open}>
              <ul className="space-y-px">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        onMouseEnter={showTip(item.label)}
                        onMouseLeave={() => setTip(null)}
                        onFocus={showTip(item.label)}
                        onBlur={() => setTip(null)}
                        className={cn(
                          'group relative flex h-8 items-center gap-2.5 rounded-md text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/50',
                          collapsed ? 'justify-center px-0' : 'px-2',
                          active ? 'bg-brand-50 font-medium text-brand-deep' : 'text-neutral-600 hover:bg-subtle hover:text-ink',
                        )}
                      >
                        {active ? <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r bg-accent" aria-hidden /> : null}
                        <Icon name={item.icon} size={16} strokeWidth={active ? 2 : 1.75} className={active ? 'text-teal-ink' : 'text-quiet group-hover:text-muted'} />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {!collapsed && locked(item.module) ? (
                          <span className="ml-auto inline-flex items-center gap-1 rounded bg-subtle px-1.5 py-px text-[10px] font-medium text-muted" title="Not included in your plan">
                            <Icon name="lock" size={9} strokeWidth={2.5} />
                            Upgrade
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        );
      })}
      {collapsed && tip ? (
        <div role="tooltip" className="mc-anim-fade-in pointer-events-none fixed z-dialog -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-white shadow-pop" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      ) : null}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className={cn('flex h-14 shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')} aria-label="MediCore home">
      <Logo collapsed={collapsed} />
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, tenant, setTenant } = useSession();
  const membership = useCurrentMembership();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    drawerRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const opener = menuButtonRef.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.querySelector<HTMLElement>('button')?.focus();
    };
  }, [mobileOpen]);
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

  const sidebarFooter = (inDrawer: boolean) =>
    membership ? (
      <div className={cn('border-t border-line', collapsed && !inDrawer ? 'px-2 py-2' : 'px-3 py-2.5')}>
        {!collapsed || inDrawer ? (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-mint text-2xs font-semibold text-brand-deep">
              {initials(membership.organizationName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-ink">{membership.organizationName}</div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1 text-2xs text-muted">
                <span className="truncate">{membership.roleName}</span>
                {subscription.data?.subscription ? (
                  <>
                    <span aria-hidden>·</span>
                    <Link href="/billing" className={cn('shrink-0 hover:text-teal-ink hover:underline', subscription.data.subscription.lapsed && 'text-danger')}>
                      {subscription.data.subscription.planName}
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
            {!inDrawer ? <IconButton icon="chevronLeft" label="Collapse sidebar" size="sm" onClick={toggleCollapsed} /> : null}
          </div>
        ) : (
          <IconButton icon="chevronRight" label="Expand sidebar" size="sm" className="mx-auto flex" onClick={toggleCollapsed} />
        )}
      </div>
    ) : null;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside
        className={cn(
          'no-print relative hidden flex-col border-r border-line bg-surface transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-[60px]' : 'w-60',
        )}
      >
        <Brand collapsed={collapsed} />
        <div className="h-3 shrink-0" />
        <SidebarNav groups={groups} collapsed={collapsed} isActive={isActive} locked={locked} />
        {sidebarFooter(false)}
      </aside>

      {mobileOpen ? (
        <div className="no-print fixed inset-0 z-drawer md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div aria-hidden className="mc-anim-fade-in absolute inset-0 bg-neutral-950/30" onClick={() => setMobileOpen(false)} />
          <aside ref={drawerRef} className="mc-anim-slide-in relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-overlay">
            <div className="relative">
              <Brand collapsed={false} />
              <IconButton icon="close" label="Close menu" size="sm" data-autofocus className="absolute right-3 top-3" onClick={() => setMobileOpen(false)} />
            </div>
            <div className="h-3 shrink-0" />
            <SidebarNav label="Menu" groups={groups} collapsed={false} isActive={isActive} locked={locked} onNavigate={() => setMobileOpen(false)} />
            {sidebarFooter(true)}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-shell className="no-print relative z-header flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 sm:gap-3 sm:px-6 lg:px-8">
          <div ref={menuButtonRef} className="md:hidden">
            <IconButton icon="menu" label="Open menu" variant="secondary" size="sm" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} />
          </div>
          <Breadcrumbs pathname={pathname} />
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center divide-x divide-line sm:flex">
              <Select
                aria-label="Organization"
                className="h-control-sm w-auto min-w-[8rem] max-w-[15rem] rounded-none border-0 bg-transparent px-2 text-xs font-medium hover:text-teal-ink focus:ring-0"
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
                className="h-control-sm w-auto min-w-[7.5rem] max-w-[12rem] rounded-none border-0 bg-transparent px-2 text-xs font-medium text-muted hover:text-teal-ink focus:ring-0"
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
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-control-sm items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-xs text-faint transition-colors hover:border-neutral-300 hover:text-ink lg:w-56"
              aria-label="Search (Ctrl or Cmd + K)"
            >
              <Icon name="search" size={14} />
              <span className="hidden flex-1 text-left lg:inline">Search…</span>
              <span className="hidden items-center gap-0.5 lg:flex">
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
        <main key={pathname} className="mc-anim-fade-in min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
          <div className="mx-auto w-full max-w-[1320px]">{children}</div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navItems={flatItems} />
    </div>
  );
}
