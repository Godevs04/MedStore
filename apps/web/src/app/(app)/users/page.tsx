'use client';

import { Icon } from '@/components/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { memberInviteSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { ConfirmDialog, FilterChips, KpiGrid, Meter, Pagination, SearchInput, useDebouncedValue, useFieldErrors, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Stat, Table, Td, Th, Tr, cn } from '@/components/ui';

interface Member {
  id: string;
  user: { id: string; email: string; fullName: string; status: string; lastLoginAt: string | null };
  role: { id: string; name: string } | null;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  isOwner: boolean;
  invitedAt: string;
  branchAssignments: Array<{ branch: { id: string; name: string } }>;
}
interface Role {
  id: string;
  name: string;
  isSystem: boolean;
}
interface Branch {
  id: string;
  name: string;
  isActive: boolean;
}
type Status = Member['status'];

const STATUS_TONE: Record<Status, 'green' | 'amber' | 'red'> = { ACTIVE: 'green', INVITED: 'amber', SUSPENDED: 'red' };
const STATUS_LABEL: Record<Status, string> = { ACTIVE: 'Active', INVITED: 'Invited', SUSPENDED: 'Suspended' };

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function since(iso: string | null) {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  const days = Math.round(mins / 1440);
  return days < 31 ? `${days} d ago` : new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function BranchPicker({ branches, value, onChange }: { branches: Branch[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (branches.length === 0) return <p className="text-xs text-neutral-500">No branches yet.</p>;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2 text-[11px]">
        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onChange(branches.map((b) => b.id))}>Select all</button>
        <button type="button" className="text-neutral-500 hover:underline" onClick={() => onChange([])}>Clear</button>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {branches.map((b) => (
          <label key={b.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors', value.includes(b.id) ? 'border-brand-300 bg-brand-50/60' : 'border-neutral-200 hover:bg-neutral-50')}>
            <input type="checkbox" className="accent-brand-600" checked={value.includes(b.id)} onChange={() => toggle(b.id)} />
            <span className="truncate">{b.name}</span>
            {!b.isActive ? <Badge tone="neutral">inactive</Badge> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

function InviteDrawer({ roles, branches, onClose, onDone }: { roles: Role[]; branches: Branch[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ email: '', fullName: '', roleId: '', branchIds: [] as string[] });
  const { errors, validate, clear, setServerErrors } = useFieldErrors();
  const invite = useMutation({
    meta: { silent: true },
    mutationFn: (body: unknown) => api<{ invitationEmailQueued: boolean }>('/organizations/members/invite', { method: 'POST', body }),
    onSuccess: () => {
      toast.success('Invitation sent', `${form.email} has 7 days to accept.`);
      onDone();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setServerErrors(e.details ?? (e.code === 'DUPLICATE_ENTITY' ? [{ field: 'email', message: e.message }] : undefined));
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = validate(memberInviteSchema, { ...form, roleId: form.roleId || null }, form.roleId ? {} : { roleId: 'Pick a role so they can sign in with the right access' });
    if (body) invite.mutate(body);
  };
  return (
    <Drawer open onClose={onClose} title="Invite a team member" subtitle="They receive a single-use link valid for 7 days" width="max-w-lg">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Full name" required error={errors.fullName}>
          <Input value={form.fullName} autoFocus maxLength={120} onChange={(e) => { clear('fullName'); setForm((f) => ({ ...f, fullName: e.target.value })); }} placeholder="e.g. Priya Sharma" />
        </Field>
        <Field label="Email" required error={errors.email}>
          <Input type="email" value={form.email} onChange={(e) => { clear('email'); setForm((f) => ({ ...f, email: e.target.value })); }} placeholder="priya@pharmacy.in" />
        </Field>
        <Field label="Role" required error={errors.roleId} hint="Controls what they can see and do">
          <Select value={form.roleId} onChange={(e) => { clear('roleId'); setForm((f) => ({ ...f, roleId: e.target.value })); }}>
            <option value="">Select a role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.isSystem ? '' : ' (custom)'}</option>
            ))}
          </Select>
        </Field>
        <Field label="Branches" error={errors.branchIds} hint="Where they can bill and handle stock">
          <BranchPicker branches={branches} value={form.branchIds} onChange={(ids) => setForm((f) => ({ ...f, branchIds: ids }))} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={invite.isPending}>{invite.isPending ? 'Sending…' : 'Send invitation'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function BranchesDrawer({ member, branches, onClose, onDone }: { member: Member; branches: Branch[]; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState(member.branchAssignments.map((a) => a.branch.id));
  const save = useMutation({
    meta: { success: 'Branch access updated' },
    mutationFn: () => api(`/organizations/members/${member.id}/branches`, { method: 'PATCH', body: { branchIds: ids } }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Drawer open onClose={onClose} title={`Branches · ${member.user.fullName}`} subtitle={member.isOwner ? 'Owners can always access every branch' : 'Pick where this person can work'} width="max-w-lg">
      <BranchPicker branches={branches} value={ids} onChange={setIds} />
      {ids.length === 0 && !member.isOwner ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">With no branch assigned they can sign in but cannot bill or move stock.</p> : null}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save access'}</Button>
      </div>
    </Drawer>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can('users.manage');
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<'' | Status>('');
  const [roleId, setRoleId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [branchFor, setBranchFor] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'suspend' | 'revoke'; member: Member } | null>(null);

  const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (debounced) qs.set('search', debounced);
  if (status) qs.set('status', status);
  if (roleId) qs.set('roleId', roleId);
  if (branchId) qs.set('branchId', branchId);
  const members = useQuery({
    queryKey: ['members', qs.toString()],
    queryFn: () => api<{ items: Member[]; counts: Record<Status, number>; pageInfo: PageInfo }>(`/organizations/members?${qs.toString()}`),
    placeholderData: keepPreviousData,
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Role[]>('/organizations/roles') });
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/organizations/branches'), enabled: can('branches.read') });
  const subscription = useQuery({ queryKey: ['subscription'], queryFn: () => api<{ usage: { users: { used: number; limit: number | null } } }>('/organizations/subscription') });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['members'] });
  const setRole = useMutation({
    meta: { success: 'Role updated' },
    mutationFn: (v: { membershipId: string; roleId: string | null }) => api(`/organizations/members/${v.membershipId}/role`, { method: 'PATCH', body: { roleId: v.roleId } }),
    onSuccess: invalidate,
  });
  const setMemberStatus = useMutation({
    meta: { silent: true },
    mutationFn: (v: { member: Member; status: 'ACTIVE' | 'SUSPENDED' }) => api(`/organizations/members/${v.member.id}/status`, { method: 'PATCH', body: { status: v.status } }),
    onSuccess: (_r, v) => {
      if (v.status === 'SUSPENDED') toast.success(`${v.member.user.fullName} suspended`, 'Their sessions were signed out.');
      else toast.success(`${v.member.user.fullName} reactivated`);
      setConfirm(null);
      invalidate();
    },
    onError: () => setConfirm(null),
  });
  const resend = useMutation({
    meta: { silent: true },
    mutationFn: (m: Member) => api(`/organizations/members/${m.id}/invite/resend`, { method: 'POST' }),
    onSuccess: (_r, m) => {
      toast.success('Invitation resent', `A fresh link went to ${m.user.email}; the old one no longer works.`);
      invalidate();
    },
  });
  const revoke = useMutation({
    meta: { silent: true },
    mutationFn: (m: Member) => api(`/organizations/members/${m.id}/invite`, { method: 'DELETE' }),
    onSuccess: (_r, m) => {
      toast.success('Invitation revoked', m.user.email);
      setConfirm(null);
      invalidate();
    },
    onError: () => setConfirm(null),
  });

  if (members.error && !members.data) {
    const forbidden = members.error instanceof ApiClientError && members.error.status === 403;
    return <ErrorState message={forbidden ? 'You do not have permission to view users.' : 'Failed to load users.'} retry={() => void members.refetch()} />;
  }
  const counts = members.data?.counts ?? { ACTIVE: 0, INVITED: 0, SUSPENDED: 0 };
  const seats = subscription.data?.usage.users;
  const branchList = branches.data ?? [];
  const resetPage = () => setPage(1);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Users"
        subtitle="Invite staff, assign roles and branches, and control access."
        actions={canManage ? <Button onClick={() => setInviting(true)}><Icon name="plus" size={15} strokeWidth={2.25} /> Invite user</Button> : null}
      />
      <KpiGrid cols={4}>
        <Stat label="Active" value={counts.ACTIVE} tone="green" />
        <Stat label="Pending invites" value={counts.INVITED} hint="Links expire after 7 days" tone="amber" delay={60} />
        <Stat label="Suspended" value={counts.SUSPENDED} tone="red" delay={120} />
        <Card delay={180}>
          <p className="text-xs font-medium text-neutral-500">Seats on your plan</p>
          {seats ? (
            <Meter value={seats.limit && seats.limit > 0 ? (seats.used / seats.limit) * 100 : 0} tone={seats.limit && seats.used >= seats.limit ? 'red' : 'green'} label={seats.limit && seats.limit > 0 ? `${seats.used} of ${seats.limit} used` : `${seats.used} used · unlimited`} />
          ) : (
            <p className="mt-2 text-sm text-neutral-400">…</p>
          )}
        </Card>
      </KpiGrid>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={(v) => { setSearch(v); resetPage(); }} placeholder="Name or email" className="w-56" />
          <FilterChips
            options={[
              { id: 'ACTIVE', label: 'Active', count: counts.ACTIVE, tone: 'green' },
              { id: 'INVITED', label: 'Invited', count: counts.INVITED, tone: 'amber' },
              { id: 'SUSPENDED', label: 'Suspended', count: counts.SUSPENDED, tone: 'red' },
            ]}
            value={status}
            onChange={(v) => { setStatus(v); resetPage(); }}
          />
          <Select value={roleId} onChange={(e) => { setRoleId(e.target.value); resetPage(); }} className="w-44" aria-label="Role">
            <option value="">All roles</option>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
          {branchList.length > 1 ? (
            <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); resetPage(); }} className="w-44" aria-label="Branch">
              <option value="">All branches</option>
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          ) : null}
        </div>
      </Card>

      <Card title={`Members (${members.data?.pageInfo.totalItems ?? 0})`}>
        {members.isLoading ? (
          <SkeletonRows rows={5} cols={5} />
        ) : (members.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No one matches" hint={debounced || status || roleId || branchId ? 'Clear the filters to see everyone.' : 'Invite your pharmacists and counter staff.'} />
        ) : (
          <div className={cn('transition-opacity', members.isFetching && 'opacity-60')}>
            <Table head={<tr><Th>User</Th><Th>Role</Th><Th>Branches</Th><Th>Status</Th><Th>Last sign-in</Th><Th /></tr>}>
              {members.data!.items.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold', m.isOwner ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700')}>{initials(m.user.fullName || m.user.email)}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-neutral-800">{m.user.fullName || '—'}</div>
                        <div className="truncate text-xs text-neutral-500">{m.user.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {m.isOwner ? (
                      <Badge tone="green">Owner</Badge>
                    ) : canManage ? (
                      <Select className="w-40 text-xs" value={m.role?.id ?? ''} disabled={setRole.isPending} onChange={(e) => setRole.mutate({ membershipId: m.id, roleId: e.target.value || null })} aria-label={`Role for ${m.user.fullName}`}>
                        <option value="">No role</option>
                        {(roles.data ?? []).map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-sm">{m.role?.name ?? 'No role'}</span>
                    )}
                  </Td>
                  <Td>
                    {m.isOwner ? (
                      <span className="text-xs text-neutral-400">All branches</span>
                    ) : (
                      <button type="button" disabled={!canManage || !branchList.length} onClick={() => setBranchFor(m)} className="flex max-w-56 flex-wrap gap-1 text-left disabled:cursor-default">
                        {m.branchAssignments.length ? m.branchAssignments.map((a) => <Badge key={a.branch.id}>{a.branch.name}</Badge>) : <span className="text-xs text-amber-700">{canManage ? '+ Assign branch' : 'None'}</span>}
                      </button>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[m.status]} dot>{STATUS_LABEL[m.status]}</Badge>
                    {m.status === 'INVITED' ? <span className="block text-[10px] text-neutral-400">sent {since(m.invitedAt)}</span> : null}
                  </Td>
                  <Td className="text-xs text-neutral-500" >{since(m.user.lastLoginAt)}</Td>
                  <Td right>
                    {canManage && !m.isOwner ? (
                      <span className="flex justify-end gap-1">
                        {m.status === 'INVITED' ? (
                          <>
                            <Button variant="ghost" className="text-xs" disabled={resend.isPending} onClick={() => resend.mutate(m)}>Resend</Button>
                            <Button variant="ghost" className="text-xs text-red-600" onClick={() => setConfirm({ kind: 'revoke', member: m })}>Revoke</Button>
                          </>
                        ) : m.status === 'SUSPENDED' ? (
                          <Button variant="secondary" className="text-xs" disabled={setMemberStatus.isPending} onClick={() => setMemberStatus.mutate({ member: m, status: 'ACTIVE' })}>Reactivate</Button>
                        ) : (
                          <Button variant="ghost" className="text-xs text-red-600" onClick={() => setConfirm({ kind: 'suspend', member: m })}>Suspend</Button>
                        )}
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </Table>
            <Pagination info={members.data?.pageInfo} onChange={setPage} label="members" />
          </div>
        )}
      </Card>

      {inviting ? <InviteDrawer roles={roles.data ?? []} branches={branchList} onClose={() => setInviting(false)} onDone={invalidate} /> : null}
      {branchFor ? <BranchesDrawer member={branchFor} branches={branchList} onClose={() => setBranchFor(null)} onDone={invalidate} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'revoke' ? `Revoke invitation for ${confirm.member.user.email}?` : `Suspend ${confirm?.member.user.fullName ?? ''}?`}
        message={confirm?.kind === 'revoke' ? 'The invitation link stops working immediately. You can invite them again later.' : 'They are signed out everywhere and cannot sign in to this workspace. Their history and audit trail stay intact.'}
        confirmLabel={confirm?.kind === 'revoke' ? 'Revoke' : 'Suspend'}
        tone="danger"
        busy={setMemberStatus.isPending || revoke.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'revoke') revoke.mutate(confirm.member);
          else setMemberStatus.mutate({ member: confirm.member, status: 'SUSPENDED' });
        }}
      />
    </div>
  );
}
