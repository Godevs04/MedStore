'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCurrentMembership, useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { Badge, Button, Select, cn } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '◧' },
  { href: '/products', label: 'Products', icon: '✚' },
  { href: '/vendors', label: 'Vendors', icon: '⇄' },
  { href: '/customers', label: 'Customers', icon: '☺' },
  { href: '/batches', label: 'Batch inventory', icon: '▦' },
  { href: '/expiry', label: 'Expiry dashboard', icon: '◔' },
  { href: '/ledger', label: 'Stock ledger', icon: '≡' },
  { href: '/import', label: 'Import', icon: '⇪' },
  { href: '/users', label: 'Users', icon: '◉', permission: 'users.read' },
  { href: '/roles', label: 'Roles', icon: '⛨', permission: 'roles.read' },
  { href: '/branches', label: 'Branches', icon: '⌂', permission: 'branches.read' },
  { href: '/settings', label: 'Settings', icon: '⚙', permission: 'organization.read' },
  { href: '/audit', label: 'Audit log', icon: '☰', permission: 'audit.read' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, tenant, setTenant, refetch } = useSession();
  const membership = useCurrentMembership();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // Server remains authoritative — nav visibility is cosmetic only.
  const canSee = (permission?: string) => {
    if (!permission) return true;
    return Boolean(membership);
  };

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
          'relative flex flex-col border-r border-neutral-200/80 bg-white transition-[width] duration-300 ease-out',
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
          {NAV.filter((item) => canSee(item.permission)).map((item, i) => {
            const active = pathname === item.href;
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
                style={{ animationDelay: `${i * 35}ms` }}
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
              </Link>
            );
          })}
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
        <header className="mc-anim-fade-in flex items-center gap-3 border-b border-neutral-200/80 bg-white/90 px-5 py-2.5 backdrop-blur">
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
        <main key={pathname} className="mc-anim-fade-up min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(45,212,191,0.04),transparent_60%)] p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
