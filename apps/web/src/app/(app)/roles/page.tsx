'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Button, Card, ErrorState, Field, Input, Spinner, Table, ErrorBanner, PageHeader } from '@/components/ui';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  key: string | null;
  permissions: Array<{ permission: { key: string; description: string | null } }>;
  _count: { memberships: number };
}

interface PermissionDef {
  key: string;
  description: string;
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState({ name: '', description: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const roles = useQuery({
    queryKey: ['roles-detail'],
    queryFn: () => api<RoleRow[]>('/organizations/roles'),
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ['permission-catalog'],
    queryFn: () => api<PermissionDef[]>('/organizations/permissions'),
    retry: false,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['roles-detail'] });

  const createRole = useMutation({
    meta: { success: 'Role created' },
    mutationFn: () =>
      api<RoleRow>('/organizations/roles', {
        method: 'POST',
        body: { name: newRole.name.trim(), description: newRole.description.trim() || null, permissionKeys: Array.from(selected) },
      }),
    onSuccess: () => {
      setNewRole({ name: '', description: '' });
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create role'),
  });

  const deleteRole = useMutation({
    meta: { success: 'Role deleted' },
    mutationFn: (roleId: string) => api(`/organizations/roles/${roleId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to delete role'),
  });

  if (roles.isLoading || catalog.isLoading) return <Spinner />;
  if (roles.error) {
    const message =
      roles.error instanceof ApiClientError && roles.error.status === 403
        ? 'You do not have permission to view roles.'
        : 'Failed to load roles.';
    return <ErrorState message={message} retry={() => void roles.refetch()} />;
  }
  if (catalog.error) return <ErrorState message="Failed to load permission catalog." retry={() => void catalog.refetch()} />;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Roles & permissions" subtitle="System and custom roles; every permission is enforced on the server." />
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      <Card title="Roles">
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Members</th>
              <th className="px-3 py-2">Permissions</th>
              <th className="px-3 py-2"></th>
            </tr>
          }
        >
          {roles.data?.map((r) => (
            <tr key={r.id} className="align-top hover:bg-neutral-50">
              <td className="px-3 py-2">
                <div className="font-medium text-neutral-800">{r.name}</div>
                {r.description ? <div className="text-xs text-neutral-500">{r.description}</div> : null}
              </td>
              <td className="px-3 py-2">
                <Badge tone={r.isSystem ? 'blue' : 'neutral'}>{r.isSystem ? 'System' : 'Custom'}</Badge>
              </td>
              <td className="px-3 py-2 text-sm">{r._count.memberships}</td>
              <td className="max-w-md px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {r.permissions.length === 0 ? (
                    <span className="text-xs text-neutral-400">No permissions</span>
                  ) : (
                    r.permissions.map((rp) => (
                      <span key={rp.permission.key} className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
                        {rp.permission.key}
                      </span>
                    ))
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                {!r.isSystem ? (
                  <Button variant="danger" onClick={() => deleteRole.mutate(r.id)}>
                    Delete
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Create custom role">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            createRole.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role name">
              <Input value={newRole.name} onChange={(e) => setNewRole((s) => ({ ...s, name: e.target.value }))} required minLength={2} />
            </Field>
            <Field label="Description (optional)">
              <Input value={newRole.description} onChange={(e) => setNewRole((s) => ({ ...s, description: e.target.value }))} />
            </Field>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-600">Permissions (role grants only what is explicitly assigned)</p>
            <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-neutral-200 p-2 sm:grid-cols-2">
              {catalog.data?.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-neutral-50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has(p.key)}
                    onChange={() => toggle(p.key)}
                  />
                  <span>
                    <span className="font-mono text-[11px] text-neutral-800">{p.key}</span>
                    <span className="block text-neutral-500">{p.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={createRole.isPending || newRole.name.trim().length < 2}>
            {createRole.isPending ? 'Creating…' : 'Create role'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
