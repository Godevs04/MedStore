'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePasswordRequestSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Icon, type IconName } from './icons';
import { Kbd, useDebouncedValue, useFieldErrors } from './kit';
import { findNav, type NavItem } from './nav';
import { Badge, Button, Drawer, EmptyState, Field, Input, Spinner, cn, fmtDate } from './ui';

// ── Command palette ──────────────────────────────────────────────────────────

interface SearchHit {
  type: 'product' | 'customer' | 'vendor' | 'salesInvoice' | 'purchaseInvoice' | 'batch';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

const HIT_META: Record<SearchHit['type'], { label: string; icon: IconName }> = {
  product: { label: 'Products', icon: 'products' },
  customer: { label: 'Customers', icon: 'customers' },
  vendor: { label: 'Vendors', icon: 'vendors' },
  salesInvoice: { label: 'Sales invoices', icon: 'sales' },
  purchaseInvoice: { label: 'Purchase invoices', icon: 'purchasing' },
  batch: { label: 'Batches', icon: 'batches' },
};

const RECENT_KEY = 'medicore.palette.recent';

function readRecent(): Array<{ title: string; href: string }> {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Array<{ title: string; href: string }>).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecent(entry: { title: string; href: string }) {
  const next = [entry, ...readRecent().filter((r) => r.href !== entry.href)].slice(0, 5);
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

interface PaletteRow {
  key: string;
  group: string;
  icon: IconName;
  title: string;
  subtitle?: string | null;
  href: string;
}

export function CommandPalette({ open, onClose, navItems }: { open: boolean; onClose: () => void; navItems: NavItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(query.trim(), 220);
  const recent = useMemo(() => (open ? readRecent() : []), [open]);

  const search = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => api<{ items: SearchHit[] }>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => {
      clearTimeout(t);
      setTimeout(() => {
        if (opener && opener !== document.body && document.contains(opener) && !document.activeElement?.closest('[role=dialog]')) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, [open]);

  const rows = useMemo<PaletteRow[]>(() => {
    const q = query.trim().toLowerCase();
    const pages = navItems
      .filter((i) => !q || `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(q))
      .slice(0, q ? 6 : 8)
      .map((i) => ({ key: `nav:${i.href}`, group: 'Go to', icon: i.icon, title: i.label, href: i.href }));
    const recents = q ? [] : recent.map((r) => ({ key: `recent:${r.href}`, group: 'Recent', icon: 'recent' as const, title: r.title, href: r.href }));
    const hits =
      debounced.length >= 2
        ? (search.data?.items ?? []).map((h) => ({
            key: `${h.type}:${h.id}`,
            group: HIT_META[h.type].label,
            icon: HIT_META[h.type].icon,
            title: h.title,
            subtitle: h.subtitle,
            href: h.href,
          }))
        : [];
    return [...recents, ...pages, ...hits];
  }, [query, navItems, recent, debounced, search.data]);

  const safeActive = Math.min(active, Math.max(0, rows.length - 1));

  const choose = (row: PaletteRow) => {
    pushRecent({ title: row.title, href: row.href });
    onClose();
    setQuery('');
    router.push(row.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((safeActive + 1) % Math.max(1, rows.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((safeActive - 1 + rows.length) % Math.max(1, rows.length));
    } else if (e.key === 'Enter' && rows[safeActive]) {
      e.preventDefault();
      choose(rows[safeActive]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeActive]);

  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-dialog flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button aria-label="Close" className="mc-anim-fade-in absolute inset-0 bg-neutral-950/30" onClick={onClose} />
      <div className="mc-anim-scale-in relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-overlay">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages, medicines, customers, invoices, batches…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-quiet"
            aria-label="Search"
          />
          {search.isFetching ? <Spinner /> : <Kbd>Esc</Kbd>}
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted">
              {debounced.length >= 2 && !search.isFetching ? `No matches for “${debounced}”.` : 'Type at least 2 characters to search records.'}
            </div>
          ) : (
            rows.map((row, i) => {
              const header = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              return (
                <div key={row.key}>
                  {header ? <div className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted">{header}</div> : null}
                  <button
                    data-index={i}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(row)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                      i === safeActive ? 'bg-mint text-ink' : 'text-neutral-700',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                        i === safeActive ? 'bg-surface text-teal-ink ring-1 ring-brand-100' : 'bg-subtle text-muted',
                      )}
                    >
                      <Icon name={row.icon} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{row.title}</span>
                      {row.subtitle ? <span className="block truncate text-xs text-muted">{row.subtitle}</span> : null}
                    </span>
                    {i === safeActive ? (
                      <Kbd>
                        <Icon name="enter" size={11} strokeWidth={2.25} />
                      </Kbd>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-line bg-subtle/60 px-4 py-2 text-2xs text-muted">
          <span className="flex items-center gap-1">
            <Kbd>
              <Icon name="arrowUp" size={10} strokeWidth={2.25} />
            </Kbd>
            <Kbd>
              <Icon name="arrowDown" size={10} strokeWidth={2.25} />
            </Kbd>{' '}
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <Icon name="enter" size={10} strokeWidth={2.25} />
            </Kbd>{' '}
            open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>
              <Icon name="command" size={10} strokeWidth={2.25} />
            </Kbd>
            <Kbd>K</Kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const NOTIFICATION_TONE: Record<string, { icon: IconName; tone: string }> = {
  LOW_STOCK: { icon: 'arrowDown', tone: 'bg-warning/10 text-warning' },
  NEAR_EXPIRY: { icon: 'expiry', tone: 'bg-danger/10 text-danger' },
  LICENCE_EXPIRY: { icon: 'compliance', tone: 'bg-info/10 text-info' },
};

function notificationHref(n: AppNotification): string {
  if (n.entityType === 'Product' && n.entityId) return `/products?focus=${n.entityId}`;
  if (n.entityType === 'InventoryBatch') return '/expiry';
  if (n.entityType === 'PharmacyLicence') return '/compliance';
  return '/reports';
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : fmtDate(iso);
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

export function NotificationBell({ organizationId }: { organizationId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  const list = useQuery({
    queryKey: ['notifications', organizationId],
    queryFn: () => api<{ items: AppNotification[]; pageInfo: { totalItems: number } }>('/reports/notifications?pageSize=15'),
    refetchInterval: 2 * 60_000,
  });
  const unread = (list.data?.items ?? []).filter((n) => !n.readAt).length;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications', organizationId] });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/reports/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
    meta: { silent: true },
  });
  const markAll = useMutation({
    mutationFn: () => api<{ updated: number }>('/reports/notifications/read-all', { method: 'POST' }),
    onSuccess: (r) => {
      invalidate();
      toast.success('All caught up', r.updated ? `${r.updated} notification${r.updated === 1 ? '' : 's'} marked as read.` : 'Nothing unread.');
    },
    meta: { silent: true },
  });
  const generate = useMutation({
    mutationFn: () => api<{ generated: number; scanned: number }>('/reports/notifications/generate', { method: 'POST' }),
    onSuccess: (r) => {
      invalidate();
      if (r.generated) toast.info('Alerts refreshed', `${r.generated} new alert${r.generated === 1 ? '' : 's'} for stock, expiry and licences.`);
      else toast.success('Alerts refreshed', 'No new low-stock, expiry or licence alerts.');
    },
    meta: { silent: true },
  });

  const open_ = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    router.push(notificationHref(n));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-control-sm w-8 items-center justify-center rounded-md text-neutral-600 transition-colors hover:bg-subtle hover:text-ink"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon name="bell" size={16} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white ring-2 ring-surface">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mc-anim-drop absolute right-0 top-10 z-dropdown w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="text-sm font-medium text-ink">Notifications</div>
            <div className="flex gap-1">
              <button className="rounded px-1.5 py-0.5 text-2xs font-medium text-teal-ink hover:bg-mint disabled:opacity-50" disabled={generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? 'Scanning…' : 'Refresh alerts'}
              </button>
              <button className="rounded px-1.5 py-0.5 text-2xs font-medium text-muted hover:bg-subtle disabled:opacity-50" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
                Mark all read
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isLoading ? (
              <div className="p-6">
                <Spinner label="Loading" />
              </div>
            ) : (list.data?.items.length ?? 0) === 0 ? (
              <div className="p-3">
                <EmptyState title="You're all caught up" hint="Low-stock, near-expiry and licence alerts appear here." />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {list.data!.items.map((n) => {
                  const tone = NOTIFICATION_TONE[n.type] ?? { icon: 'info' as const, tone: 'bg-mint text-teal-ink' };
                  return (
                    <li key={n.id}>
                      <button onClick={() => open_(n)} className={cn('flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-subtle', !n.readAt && 'bg-mint/40')}>
                        <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', tone.tone)}>
                          <Icon name={tone.icon} size={13} strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn('truncate text-xs', n.readAt ? 'text-neutral-700' : 'font-semibold text-ink')}>{n.title}</span>
                            {!n.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : null}
                          </span>
                          <span className="line-clamp-2 block text-2xs text-muted">{n.body}</span>
                          <span className="block text-[10px] text-faint num">{timeAgo(n.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Profile menu ─────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
}

function ChangePasswordDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const fe = useFieldErrors();
  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api('/auth/password/change', { method: 'POST', body }),
    meta: { success: 'Password changed', silentError: true },
    onSuccess: () => {
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      fe.clear();
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError && fe.setServerErrors(err.details)) return;
      const msg = err instanceof ApiClientError ? err.message : 'Could not change password';
      fe.setErrors({ currentPassword: msg });
      toast.error('Password not changed', msg);
    },
  });
  const strength = useMemo(() => {
    const v = form.newPassword;
    let s = 0;
    if (v.length >= 10) s++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 14) s++;
    return s;
  }, [form.newPassword]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const extra: Record<string, string> = form.confirm !== form.newPassword ? { confirm: 'Passwords do not match' } : {};
    const data = fe.validate(changePasswordRequestSchema, { currentPassword: form.currentPassword, newPassword: form.newPassword }, extra);
    if (data) change.mutate(data);
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    fe.clear(k);
  };

  return (
    <Drawer open={open} onClose={onClose} title="Change password" subtitle="Other signed-in devices stay signed in until you revoke them." width="max-w-md">
      <form className="space-y-3" onSubmit={submit} noValidate>
        <Field label="Current password" required error={fe.errors.currentPassword}>
          <Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} />
        </Field>
        <Field label="New password" required error={fe.errors.newPassword} hint="At least 10 characters with upper case, lower case and a digit.">
          <Input type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} />
        </Field>
        <div className="flex gap-1" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300',
                i < strength ? (strength <= 1 ? 'bg-danger' : strength === 2 ? 'bg-warning' : 'bg-success') : 'bg-neutral-200',
              )}
            />
          ))}
        </div>
        <Field label="Confirm new password" required error={fe.errors.confirm}>
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={change.isPending}>
            {change.isPending ? 'Saving…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function SessionsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['auth-sessions'], queryFn: () => api<SessionRow[]>('/auth/sessions'), enabled: open });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }),
    meta: { success: 'Session signed out' },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth-sessions'] }),
  });
  const currentId = sessions.data?.[0]?.id;
  return (
    <Drawer open={open} onClose={onClose} title="Active sessions" subtitle="Sign out devices you don't recognise." width="max-w-md">
      {sessions.isLoading ? (
        <Spinner label="Loading sessions" />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-subtle text-muted">
                <Icon name="sessions" size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {describeAgent(s.userAgent)}
                  {s.id === currentId ? <Badge tone="green" dot>Most recent</Badge> : null}
                </div>
                <div className="text-xs text-muted">
                  {s.ipAddress ?? 'Unknown IP'} · active {timeAgo(s.lastSeenAt)} · signed in {fmtDate(s.createdAt)}
                </div>
              </div>
              {s.id !== currentId ? (
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                  Sign out
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function ProfileMenu({ fullName, email, roleName, onLogout }: { fullName: string; email: string; roleName?: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<'password' | 'sessions' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const item = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-neutral-700 transition-colors hover:bg-subtle hover:text-ink';
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-control-sm items-center gap-2 rounded-md pl-1 pr-1.5 transition-colors hover:bg-subtle"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-deep">{initials}</span>
        <span className="hidden max-w-32 truncate text-xs font-medium text-neutral-700 lg:block">{fullName}</span>
        <Icon name="chevronDown" size={13} className={cn('text-faint transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mc-anim-drop absolute right-0 top-10 z-dropdown w-64 rounded-lg border border-line bg-surface p-1 shadow-pop">
          <div className="border-b border-line px-2.5 pb-2 pt-1.5">
            <div className="truncate text-sm font-semibold text-ink">{fullName}</div>
            <div className="truncate text-xs text-muted">{email}</div>
            {roleName ? <div className="mt-1.5"><Badge tone="neutral">{roleName}</Badge></div> : null}
          </div>
          <div className="pt-1">
            <button className={item} onClick={() => { setPanel('password'); setOpen(false); }}>
              <Icon name="key" size={15} className="text-faint" /> Change password
            </button>
            <button className={item} onClick={() => { setPanel('sessions'); setOpen(false); }}>
              <Icon name="sessions" size={15} className="text-faint" /> Active sessions
            </button>
            <Link href="/settings" className={item} onClick={() => setOpen(false)}>
              <Icon name="settings" size={15} className="text-faint" /> Workspace settings
            </Link>
            <button className={cn(item, 'text-danger hover:bg-danger/10 hover:text-danger')} onClick={onLogout}>
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>
        </div>
      ) : null}
      <ChangePasswordDrawer open={panel === 'password'} onClose={() => setPanel(null)} />
      <SessionsDrawer open={panel === 'sessions'} onClose={() => setPanel(null)} />
    </div>
  );
}

// ── Breadcrumbs ──────────────────────────────────────────────────────────────

export function Breadcrumbs({ pathname }: { pathname: string }) {
  const found = findNav(pathname);
  if (!found) return null;
  const isDetail = pathname !== found.item.href;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted md:flex">
      <span className="hidden truncate lg:inline">{found.section}</span>
      <Icon name="chevronRight" size={12} className="hidden shrink-0 text-quiet lg:block" />
      {isDetail ? (
        <>
          <Link href={found.item.href} className="inline-flex items-center gap-1.5 truncate hover:text-teal-ink">
            <Icon name={found.item.icon} size={13} />
            {found.item.label}
          </Link>
          <Icon name="chevronRight" size={12} className="text-quiet" />
          <span className="truncate font-medium text-ink">Details</span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1.5 truncate font-medium text-ink">
          <Icon name={found.item.icon} size={14} className="text-teal-ink" />
          {found.item.label}
        </span>
      )}
    </nav>
  );
}
