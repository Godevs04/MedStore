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
  /** Permission required to see the link (checked server-side too). */
  permission?: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/products', label: 'Products' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/customers', label: 'Customers' },
  { href: '/import', label: 'Import' },
  { href: '/users', label: 'Users', permission: 'users.read' },
  { href: '/roles', label: 'Roles', permission: 'roles.read' },
  { href: '/branches', label: 'Branches', permission: 'branches.read' },
  { href: '/settings', label: 'Settings', permission: 'organization.read' },
  { href: '/audit', label: 'Audit log', permission: 'audit.read' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, tenant, setTenant, refetch } = useSession();
  const membership = useCurrentMembership();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // Owner sees everything; others rely on server enforcement for actions.
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
    <div className="flex h-screen">
      <aside
        className={cn(
          'flex flex-col border-r border-neutral-200 bg-white transition-all',
          collapsed ? 'w-14' : 'w-56',
        )}
      >
        <div className="flex items-center justify-between px-3 py-3">
          {!collapsed && <span className="text-sm font-bold text-brand-700">MediCore</span>}
          <button
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
            onClick={() => setCollapsed((c) => !c)}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.filter((item) => canSee(item.permission)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'block rounded-md px-2.5 py-1.5 text-sm',
                pathname === item.href
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-neutral-600 hover:bg-neutral-100',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {membership ? (
          <div className="border-t border-neutral-100 px-3 py-2 text-xs text-neutral-500">
            {!collapsed && (
              <>
                <div className="truncate font-medium text-neutral-700">{membership.organizationName}</div>
                <div className="mt-0.5 flex items-center gap-1">
                  <Badge tone={membership.isOwner ? 'green' : 'blue'}>{membership.roleName}</Badge>
                </div>
              </>
            )}
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2">
          <div className="flex flex-1 items-center gap-2">
            <Select
              aria-label="Organization"
              className="w-52"
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
            <span className="text-neutral-600">{user?.fullName}</span>
            <Button variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-neutral-50 p-4">{children}</main>
      </div>
    </div>
  );
}
