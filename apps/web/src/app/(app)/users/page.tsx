'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, ErrorState, Field, Input, Select, Spinner, Table } from '@/components/ui';

interface Member {
  id: string;
  user: { id: string; email: string; fullName: string; status: string; lastLoginAt: string | null };
  role: { id: string; name: string } | null;
  status: string;
  isOwner: boolean;
  branchAssignments: Array<{ branch: { id: string; name: string } }>;
}

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  roleId: z.string().uuid(),
});
type InviteForm = z.infer<typeof inviteSchema>;

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['members'],
    queryFn: () => api<{ items: Member[] }>('/organizations/members?page=1&pageSize=100'),
    retry: false,
  });
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<Array<{ id: string; name: string; isSystem: boolean }>>('/organizations/roles'),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', fullName: '', roleId: '' },
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['members'] });

  const invite = useMutation({
    mutationFn: (data: InviteForm) =>
      api<{ invitationEmailQueued: boolean; invitationToken?: string }>('/organizations/members/invite', {
        method: 'POST',
        body: { ...data, branchIds: [] },
      }),
    onSuccess: (result) => {
      reset();
      setShowInvite(false);
      invalidate();
      // Console email transport: surface the token so onboarding can proceed (dev only).
      if (result.invitationToken) {
        setActionError(null);
        window.prompt(
          'Invitation created. Console email transport is active — share this acceptance token:',
          result.invitationToken,
        );
      }
    },
    onError: (e) => setActionError(e instanceof ApiClientError ? e.message : 'Failed to invite user'),
  });

  const setRole = useMutation({
    mutationFn: (vars: { membershipId: string; roleId: string | null }) =>
      api(`/organizations/members/${vars.membershipId}/role`, { method: 'PATCH', body: { roleId: vars.roleId } }),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiClientError ? e.message : 'Failed to update role'),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { membershipId: string; status: 'ACTIVE' | 'SUSPENDED' }) =>
      api(`/organizations/members/${vars.membershipId}/status`, { method: 'PATCH', body: { status: vars.status } }),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof ApiClientError ? e.message : 'Failed to update member'),
  });

  if (members.isLoading || roles.isLoading) return <Spinner />;
  if (members.error) {
    const message =
      members.error instanceof ApiClientError && members.error.status === 403
        ? 'You do not have permission to view users.'
        : 'Failed to load users.';
    return <ErrorState message={message} retry={() => void members.refetch()} />;
  }
  if (roles.error) return <ErrorState message="Failed to load roles." retry={() => void roles.refetch()} />;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Users</h1>
        <Button onClick={() => setShowInvite((s) => !s)}>Invite user</Button>
      </div>

      {actionError ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p> : null}

      {showInvite ? (
        <Card title="Invite a user">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            onSubmit={handleSubmit((d) =>
              invite.mutate({
                ...d,
                roleId: d.roleId || roles.data?.[0]?.id || '',
              }),
            )}
          >
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" {...register('email')} />
            </Field>
            <Field label="Full name" error={errors.fullName?.message}>
              <Input {...register('fullName')} />
            </Field>
            <Field label="Role">
              <Select {...register('roleId')}>
                <option value="">Select a role…</option>
                {roles.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" disabled={isSubmitting || invite.isPending}>
                {invite.isPending ? 'Inviting…' : 'Send invitation'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={`Members (${members.data?.items.length ?? 0})`}>
        <Table
          head={
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          }
        >
          {members.data?.items.map((m) => (
            <tr key={m.id} className="hover:bg-neutral-50">
              <td className="px-3 py-2">
                <div className="font-medium text-neutral-800">{m.user.fullName}</div>
                <div className="text-xs text-neutral-500">{m.user.email}</div>
              </td>
              <td className="px-3 py-2">
                {m.isOwner ? (
                  <Badge tone="green">Owner</Badge>
                ) : (
                  <Select
                    className="w-40"
                    value={m.role?.id ?? ''}
                    onChange={(e) => setRole.mutate({ membershipId: m.id, roleId: e.target.value || null })}
                    aria-label={`Role for ${m.user.fullName}`}
                  >
                    <option value="">No role</option>
                    {roles.data?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                )}
              </td>
              <td className="px-3 py-2">
                <Badge tone={m.status === 'ACTIVE' ? 'green' : m.status === 'SUSPENDED' ? 'red' : 'amber'}>
                  {m.status}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-neutral-500">
                {m.user.lastLoginAt ? new Date(m.user.lastLoginAt).toLocaleString() : 'Never'}
              </td>
              <td className="px-3 py-2">
                {m.isOwner ? (
                  <span className="text-xs text-neutral-400">—</span>
                ) : m.status === 'SUSPENDED' ? (
                  <Button variant="secondary" onClick={() => setStatus.mutate({ membershipId: m.id, status: 'ACTIVE' })}>
                    Reactivate
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => setStatus.mutate({ membershipId: m.id, status: 'SUSPENDED' })}>
                    Suspend
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
