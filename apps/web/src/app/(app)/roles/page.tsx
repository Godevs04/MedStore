'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { roleCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { ConfirmDialog, KpiGrid, SearchInput, useFieldErrors } from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Stat, Table, Tabs, Td, Th, Tr, cn } from '@/components/ui';

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
interface Template {
  key: string;
  permissions: string[];
}

const MODULE_LABELS: Record<string, string> = {
  organization: 'Organisation',
  branches: 'Branches',
  users: 'Users',
  roles: 'Roles',
  audit: 'Audit',
  subscription: 'Subscription',
  products: 'Products',
  vendors: 'Vendors',
  customers: 'Customers',
  categories: 'Categories',
  tax: 'GST',
  inventory: 'Inventory',
  batches: 'Batches',
  purchases: 'Purchasing',
  sales: 'Sales & POS',
  returns: 'Returns',
  prescriptions: 'Prescriptions',
  accounting: 'Accounting',
  reports: 'Reports',
  compliance: 'Compliance',
  integrations: 'Integrations',
  platform: 'Platform',
};
const moduleOf = (key: string) => key.split('.')[0] ?? key;
const moduleLabel = (m: string) => MODULE_LABELS[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
const templateLabel = (k: string) => k.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function groupPermissions(catalog: PermissionDef[]) {
  const groups = new Map<string, PermissionDef[]>();
  for (const p of catalog) groups.set(moduleOf(p.key), [...(groups.get(moduleOf(p.key)) ?? []), p]);
  return [...groups.entries()];
}

type EditorMode = { kind: 'create'; from?: string[]; name?: string } | { kind: 'edit'; role: RoleRow } | { kind: 'view'; role: RoleRow };

function RoleEditor({ mode, catalog, templates, roles, onClose, onDone }: { mode: EditorMode; catalog: PermissionDef[]; templates: Template[]; roles: RoleRow[]; onClose: () => void; onDone: () => void }) {
  const role = mode.kind === 'create' ? null : mode.role;
  const readOnly = mode.kind === 'view';
  const [name, setName] = useState(mode.kind === 'create' ? (mode.name ?? '') : (role?.name ?? ''));
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(mode.kind === 'create' ? (mode.from ?? []) : (role?.permissions.map((p) => p.permission.key) ?? [])));
  const [filter, setFilter] = useState('');
  const { errors, validate, clear, setServerErrors } = useFieldErrors();
  const groups = useMemo(() => groupPermissions(catalog), [catalog]);
  const q = filter.trim().toLowerCase();

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: { name: string; description?: string | null; permissionKeys: string[] }) =>
      mode.kind === 'edit'
        ? api(`/organizations/roles/${mode.role.id}/permissions`, { method: 'PATCH', body: { permissionKeys: body.permissionKeys } })
        : api('/organizations/roles', { method: 'POST', body }),
    onSuccess: (_r, body) => {
      toast.success(mode.kind === 'edit' ? 'Permissions updated' : 'Role created', `${body.name} · ${body.permissionKeys.length} permissions`);
      onDone();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setServerErrors(e.details ?? (e.code === 'DUPLICATE_ENTITY' ? [{ field: 'name', message: e.message }] : undefined));
    },
  });

  const toggle = (key: string) => {
    clear('permissionKeys');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleGroup = (keys: string[], on: boolean) => {
    clear('permissionKeys');
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };
  const submit = () => {
    const duplicate = mode.kind === 'create' && roles.some((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    const body = validate(roleCreateSchema, { name: name.trim(), description: description.trim() || null, permissionKeys: [...selected] }, duplicate ? { name: `A role called "${name.trim()}" already exists` } : {});
    if (!body) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate(body);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={mode.kind === 'create' ? 'New custom role' : readOnly ? `${role!.name} (system role)` : `Edit ${role!.name}`}
      subtitle={readOnly ? 'System roles are read-only — clone one to customise it' : 'A role grants only the permissions ticked here'}
      width="max-w-3xl"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Role name" required error={errors.name} hint={mode.kind === 'edit' ? 'Names are fixed once created' : undefined}>
          <Input value={name} maxLength={80} disabled={mode.kind !== 'create'} onChange={(e) => { clear('name'); setName(e.target.value); }} placeholder="e.g. Counter staff" />
        </Field>
        <Field label="Description" error={errors.description}>
          <Input value={description} maxLength={300} disabled={mode.kind !== 'create'} onChange={(e) => setDescription(e.target.value)} placeholder="What this role is for" />
        </Field>
      </div>
      {mode.kind === 'create' && templates.length ? (
        <Field label="Start from" hint="Copies the permission set; you can adjust it below">
          <Select
            value=""
            onChange={(e) => {
              const source = e.target.value;
              const t = templates.find((x) => `t:${x.key}` === source);
              const r = roles.find((x) => `r:${x.id}` === source);
              const keys = t?.permissions ?? r?.permissions.map((p) => p.permission.key);
              if (keys) {
                setSelected(new Set(keys));
                clear('permissionKeys');
                toast.info('Permissions copied', `${keys.length} permissions from ${t ? templateLabel(t.key) : r!.name}`);
              }
            }}
          >
            <option value="">Choose a template or existing role…</option>
            <optgroup label="Templates">
              {templates.map((t) => (
                <option key={t.key} value={`t:${t.key}`}>{templateLabel(t.key)} ({t.permissions.length})</option>
              ))}
            </optgroup>
            {roles.some((r) => !r.isSystem) ? (
              <optgroup label="Your custom roles">
                {roles.filter((r) => !r.isSystem).map((r) => (
                  <option key={r.id} value={`r:${r.id}`}>{r.name} ({r.permissions.length})</option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </Field>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('text-sm', errors.permissionKeys ? 'font-medium text-red-600' : 'text-neutral-600')}>
          {errors.permissionKeys ?? `${selected.size} of ${catalog.length} permissions selected`}
        </p>
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter permissions" className="w-52" />
      </div>
      <div className="space-y-3">
        {groups.map(([module, perms]) => {
          const visible = perms.filter((p) => !q || p.key.includes(q) || p.description.toLowerCase().includes(q));
          if (!visible.length) return null;
          const keys = perms.map((p) => p.key);
          const on = keys.filter((k) => selected.has(k)).length;
          return (
            <section key={module} className="mc-anim-fade-up rounded-xl border border-neutral-200">
              <header className="flex items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/70 px-3 py-2">
                <span className="text-sm font-semibold text-neutral-800">{moduleLabel(module)}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={on === keys.length ? 'green' : on ? 'blue' : 'neutral'}>{on}/{keys.length}</Badge>
                  {!readOnly ? (
                    <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => toggleGroup(keys, on !== keys.length)}>
                      {on === keys.length ? 'Clear all' : 'Select all'}
                    </button>
                  ) : null}
                </span>
              </header>
              <div className="grid grid-cols-1 gap-0.5 p-2 sm:grid-cols-2">
                {visible.map((p) => (
                  <label key={p.key} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors', readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-neutral-50', selected.has(p.key) && 'bg-brand-50/50')}>
                    <input type="checkbox" className="mt-0.5 accent-brand-600" checked={selected.has(p.key)} disabled={readOnly} onChange={() => toggle(p.key)} />
                    <span>
                      <span className="text-neutral-800">{p.description}</span>
                      <span className="block font-mono text-[10px] text-neutral-400">{p.key}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-100 bg-white pt-3">
        <Button variant="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly ? <Button disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : mode.kind === 'edit' ? 'Save permissions' : 'Create role'}</Button> : null}
      </div>
    </Drawer>
  );
}

function Matrix({ roles, catalog }: { roles: RoleRow[]; catalog: PermissionDef[] }) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => groupPermissions(catalog), [catalog]);
  const grants = useMemo(() => new Map(roles.map((r) => [r.id, new Set(r.permissions.map((p) => p.permission.key))])), [roles]);
  const q = filter.trim().toLowerCase();
  return (
    <Card title="Permission matrix" actions={<SearchInput value={filter} onChange={setFilter} placeholder="Filter permissions" className="w-52" />}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-neutral-200 text-left text-neutral-500">
              <th className="py-2 pr-3 font-medium">Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="px-2 py-2 text-center font-medium">
                  <span className="block max-w-24 truncate" title={r.name}>{r.name}</span>
                  <span className="text-[10px] font-normal text-neutral-400">{r.permissions.length}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([module, perms]) => {
              const visible = perms.filter((p) => !q || p.key.includes(q) || p.description.toLowerCase().includes(q));
              if (!visible.length) return null;
              return [
                <tr key={module} className="bg-neutral-50">
                  <td colSpan={roles.length + 1} className="py-1.5 pl-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{moduleLabel(module)}</td>
                </tr>,
                ...visible.map((p) => (
                  <tr key={p.key} className="border-b border-neutral-100 hover:bg-brand-50/30">
                    <td className="py-1.5 pr-3 text-neutral-700" title={p.key}>{p.description}</td>
                    {roles.map((r) => (
                      <td key={r.id} className="px-2 text-center">
                        {grants.get(r.id)?.has(p.key) ? <Icon name="check" size={14} strokeWidth={2.5} className="text-emerald-600" label="granted" /> : <span className="text-neutral-200" aria-label="not granted">·</span>}
                      </td>
                    ))}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function RolesPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can('roles.manage');
  const [tab, setTab] = useState<'roles' | 'matrix'>('roles');
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const roles = useQuery({ queryKey: ['roles-detail'], queryFn: () => api<RoleRow[]>('/organizations/roles') });
  const catalog = useQuery({ queryKey: ['permission-catalog'], queryFn: () => api<PermissionDef[]>('/organizations/permissions') });
  const templates = useQuery({ queryKey: ['role-templates'], queryFn: () => api<Template[]>('/organizations/roles/templates') });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['roles-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['roles'] });
  };
  const remove = useMutation({
    meta: { success: 'Role deleted' },
    mutationFn: (id: string) => api(`/organizations/roles/${id}`, { method: 'DELETE' }),
    onSettled: () => setDeleting(null),
    onSuccess: invalidate,
  });

  if (roles.isLoading || catalog.isLoading) return <SkeletonRows rows={6} cols={4} />;
  if (roles.error || catalog.error) {
    const forbidden = roles.error instanceof ApiClientError && roles.error.status === 403;
    return <ErrorState message={forbidden ? 'You do not have permission to view roles.' : 'Failed to load roles.'} retry={() => { void roles.refetch(); void catalog.refetch(); }} />;
  }
  const perms = catalog.data ?? [];
  // The owner role holds every permission implicitly; it has no explicit grants.
  const list = (roles.data ?? []).map((r) =>
    r.key === 'ORGANIZATION_OWNER' ? { ...r, permissions: perms.map((p) => ({ permission: { key: p.key, description: p.description } })) } : r,
  );
  const custom = list.filter((r) => !r.isSystem);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Roles & permissions"
        subtitle="Every permission is enforced on the server. A role grants only what is explicitly ticked."
        actions={canManage ? <Button onClick={() => setEditor({ kind: 'create' })}><Icon name="plus" size={15} strokeWidth={2.25} /> Custom role</Button> : null}
      />
      <KpiGrid cols={4}>
        <Stat label="Roles" value={list.length} hint={`${custom.length} custom`} tone="blue" />
        <Stat label="People with a role" value={list.reduce((s, r) => s + r._count.memberships, 0)} delay={60} />
        <Stat label="Permissions available" value={perms.length} hint={`${groupPermissions(perms).length} modules`} delay={120} />
        <Stat label="Unused custom roles" value={custom.filter((r) => r._count.memberships === 0).length} hint="Safe to delete" tone="amber" delay={180} />
      </KpiGrid>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'roles', label: 'Roles', count: list.length }, { id: 'matrix', label: 'Matrix' }]} />

      {tab === 'roles' ? (
        list.length === 0 ? (
          <EmptyState title="No roles" />
        ) : (
          <Card>
            <Table head={<tr><Th>Role</Th><Th>Type</Th><Th right>Members</Th><Th>Coverage</Th><Th /></tr>}>
              {list.map((r) => {
                const modules = new Set(r.permissions.map((p) => moduleOf(p.permission.key)));
                return (
                  <Tr key={r.id}>
                    <Td>
                      <button type="button" className="text-left" onClick={() => setEditor(r.isSystem || !canManage ? { kind: 'view', role: r } : { kind: 'edit', role: r })}>
                        <span className="block text-sm font-medium text-neutral-800 hover:text-brand-700">{r.name}</span>
                        {r.description ? <span className="block text-xs text-neutral-500">{r.description}</span> : null}
                      </button>
                    </Td>
                    <Td><Badge tone={r.isSystem ? 'blue' : 'neutral'}>{r.isSystem ? 'System' : 'Custom'}</Badge></Td>
                    <Td right className="text-sm">{r._count.memberships}</Td>
                    <Td>
                      <div className="flex max-w-md flex-wrap gap-1">
                        {[...modules].slice(0, 6).map((m) => <span key={m} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">{moduleLabel(m)}</span>)}
                        {modules.size > 6 ? <span className="text-[10px] text-neutral-400">+{modules.size - 6} more</span> : null}
                        <span className="text-[10px] text-neutral-400">· {r.permissions.length} permissions</span>
                      </div>
                    </Td>
                    <Td right>
                      <span className="flex justify-end gap-1">
                        {canManage ? <Button variant="ghost" className="text-xs" onClick={() => setEditor({ kind: 'create', from: r.permissions.map((p) => p.permission.key), name: `${r.name} (copy)` })}>Clone</Button> : null}
                        {canManage && !r.isSystem ? (
                          <>
                            <Button variant="ghost" className="text-xs" onClick={() => setEditor({ kind: 'edit', role: r })}>Edit</Button>
                            <Button variant="ghost" className="text-xs text-red-600" disabled={r._count.memberships > 0} title={r._count.memberships ? 'Move its members to another role first' : undefined} onClick={() => setDeleting(r)}>Delete</Button>
                          </>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </Card>
        )
      ) : (
        <Matrix roles={list} catalog={perms} />
      )}

      {editor ? <RoleEditor mode={editor} catalog={perms} templates={templates.data ?? []} roles={list} onClose={() => setEditor(null)} onDone={invalidate} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        message="This custom role is not assigned to anyone. Deleting it cannot be undone."
        confirmLabel="Delete role"
        tone="danger"
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}
