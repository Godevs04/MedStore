'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { categoryCreateSchema, manufacturerCreateSchema, taxRateVersionCreateSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { ConfirmDialog, FilterChips, KpiGrid, SearchInput, useFieldErrors } from '@/components/kit';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  Tr,
  cn,
  fmtDate,
  todayIso,
} from '@/components/ui';

interface Category {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  _count?: { products: number };
}
interface Manufacturer {
  id: string;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  _count?: { products: number };
}
interface TaxRate {
  id: string;
  hsnCode: string;
  description: string;
  cgstPercent: string | null;
  sgstPercent: string | null;
  igstPercent: string | null;
  cessPercent: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

type Tab = 'tax' | 'categories' | 'manufacturers';
const SLABS = [0, 5, 12, 18, 28, 40];
const blank = (v: string) => (v.trim() === '' ? null : v.trim());
const pct = (v: string | null) => (v === null ? '—' : `${Number(v)}%`);

function rateState(t: TaxRate, today: string): 'ACTIVE' | 'SCHEDULED' | 'ENDED' {
  if (t.effectiveTo && t.effectiveTo.slice(0, 10) < today) return 'ENDED';
  if (t.effectiveFrom.slice(0, 10) > today) return 'SCHEDULED';
  return 'ACTIVE';
}

// ── Tax rates ────────────────────────────────────────────────────────────────

function TaxRateForm({ onDone }: { onDone: () => void }) {
  const empty = { hsnCode: '', description: '', cgstPercent: '', sgstPercent: '', igstPercent: '', cessPercent: '', effectiveFrom: todayIso(), effectiveTo: '' };
  const [form, setForm] = useState(empty);
  const { errors, validate, clear, setServerErrors } = useFieldErrors();
  const set = (k: keyof typeof empty, v: string) => {
    clear(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const applySlab = (rate: number) => {
    const half = (rate / 2).toFixed(2);
    setForm((f) => ({ ...f, cgstPercent: half, sgstPercent: half, igstPercent: rate.toFixed(2), description: f.description || `GST ${rate}% slab` }));
    clear();
  };
  const onCgst = (v: string) => {
    clear('cgstPercent');
    clear('sgstPercent');
    clear('igstPercent');
    const n = Number(v);
    setForm((f) => ({ ...f, cgstPercent: v, ...(v !== '' && Number.isFinite(n) ? { sgstPercent: v, igstPercent: (n * 2).toFixed(2) } : {}) }));
  };
  const create = useMutation({
    meta: { success: 'GST rate version added' },
    mutationFn: (body: unknown) => api('/catalog/tax-rates', { method: 'POST', body }),
    onSuccess: () => {
      setForm(empty);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setServerErrors(e.details);
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = validate(taxRateVersionCreateSchema, {
      hsnCode: form.hsnCode.trim(),
      description: form.description.trim(),
      cgstPercent: blank(form.cgstPercent),
      sgstPercent: blank(form.sgstPercent),
      igstPercent: blank(form.igstPercent),
      cessPercent: blank(form.cessPercent),
      effectiveFrom: form.effectiveFrom,
      effectiveTo: blank(form.effectiveTo),
    });
    if (!body) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    create.mutate(body);
  };
  return (
    <Card title="New GST rate version" actions={<span className="text-[11px] text-neutral-400">Effective-dated · history is never overwritten</span>}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-neutral-500">Quick slab:</span>
          {SLABS.map((s) => (
            <button key={s} type="button" onClick={() => applySlab(s)} className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-medium text-neutral-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95">
              {s}%
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="HSN code" required error={errors.hsnCode} hint="4, 6 or 8 digits">
            <Input value={form.hsnCode} inputMode="numeric" maxLength={8} onChange={(e) => set('hsnCode', e.target.value.replace(/\D/g, ''))} placeholder="3004" />
          </Field>
          <Field label="Description" required error={errors.description} className="md:col-span-3">
            <Input value={form.description} maxLength={200} onChange={(e) => set('description', e.target.value)} placeholder="Medicaments — 5% slab" />
          </Field>
          <Field label="CGST %" error={errors.cgstPercent} hint="SGST and IGST follow">
            <Input value={form.cgstPercent} inputMode="decimal" onChange={(e) => onCgst(e.target.value)} placeholder="2.50" />
          </Field>
          <Field label="SGST / UTGST %" error={errors.sgstPercent}>
            <Input value={form.sgstPercent} inputMode="decimal" onChange={(e) => set('sgstPercent', e.target.value)} placeholder="2.50" />
          </Field>
          <Field label="IGST %" error={errors.igstPercent} hint="Inter-state = CGST + SGST">
            <Input value={form.igstPercent} inputMode="decimal" onChange={(e) => set('igstPercent', e.target.value)} placeholder="5.00" />
          </Field>
          <Field label="Cess %" error={errors.cessPercent}>
            <Input value={form.cessPercent} inputMode="decimal" onChange={(e) => set('cessPercent', e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Effective from" required error={errors.effectiveFrom}>
            <Input type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          </Field>
          <Field label="Effective to" error={errors.effectiveTo} hint="Leave blank if open-ended">
            <Input type="date" value={form.effectiveTo} min={form.effectiveFrom} onChange={(e) => set('effectiveTo', e.target.value)} />
          </Field>
          <div className="flex items-end md:col-span-2">
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add version'}</Button>
          </div>
        </div>
        <p className="text-[11px] text-neutral-400">Rates must come from the official CBIC schedules. Invoices snapshot the version in force on the document date.</p>
      </form>
    </Card>
  );
}

function TaxTab({ rates, canManage, refresh }: { rates: TaxRate[]; canManage: boolean; refresh: () => void }) {
  const today = todayIso();
  const [search, setSearch] = useState('');
  const [state, setState] = useState<'' | 'ACTIVE' | 'SCHEDULED' | 'ENDED'>('');
  const [ending, setEnding] = useState<TaxRate | null>(null);
  const [endDate, setEndDate] = useState(today);
  const loadStandard = useMutation({
    meta: { silent: true },
    mutationFn: () => api<{ created: number; skipped: number; effectiveFrom: string }>('/catalog/tax-rates/load-standard', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.created) toast.success(`Loaded ${r.created} standard GST rates`, `Effective ${fmtDate(r.effectiveFrom)}${r.skipped ? ` · ${r.skipped} existing HSNs untouched` : ''}`);
      else toast.info('Nothing to load', 'Every standard HSN is already configured.');
      refresh();
    },
  });
  const end = useMutation({
    meta: { success: 'Rate version ended' },
    mutationFn: (v: { id: string; effectiveTo: string }) => api(`/catalog/tax-rates/${v.id}/end`, { method: 'PATCH', body: { effectiveTo: v.effectiveTo } }),
    onSuccess: () => {
      setEnding(null);
      refresh();
    },
  });
  const q = search.trim().toLowerCase();
  const counts = { ACTIVE: 0, SCHEDULED: 0, ENDED: 0 };
  for (const r of rates) counts[rateState(r, today)]++;
  const rows = rates.filter((r) => (!state || rateState(r, today) === state) && (!q || r.hsnCode.includes(q) || r.description.toLowerCase().includes(q)));
  const endBeforeStart = ending ? endDate < ending.effectiveFrom.slice(0, 10) : false;

  return (
    <>
      {canManage ? (
        <section className="mc-anim-fade-up flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200/70 bg-gradient-to-r from-brand-50 to-white px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-neutral-800">Standard pharmacy GST rates</p>
            <p className="text-xs text-neutral-500">Chapter 30 medicines, dressings, diagnostics and devices (GST Council, effective 22 Sep 2025). Existing HSN codes are never overwritten.</p>
          </div>
          <Button disabled={loadStandard.isPending} onClick={() => loadStandard.mutate()}>{loadStandard.isPending ? 'Loading…' : 'Load standard rates'}</Button>
        </section>
      ) : null}
      {canManage ? <TaxRateForm onDone={refresh} /> : null}
      <Card
        title={`Rate versions (${rows.length})`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              options={[
                { id: 'ACTIVE', label: 'Active', count: counts.ACTIVE, tone: 'green' },
                { id: 'SCHEDULED', label: 'Scheduled', count: counts.SCHEDULED },
                { id: 'ENDED', label: 'Ended', count: counts.ENDED, tone: 'neutral' },
              ]}
              value={state}
              onChange={setState}
            />
            <SearchInput value={search} onChange={setSearch} placeholder="HSN or description" className="w-48" />
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={rates.length ? 'No versions match' : 'No GST rates yet'} hint={rates.length ? 'Clear the filters to see every version.' : 'Load the standard rates or add a version per HSN — sales need a rate in force.'} />
        ) : (
          <Table head={<tr><Th>HSN</Th><Th>Description</Th><Th right>CGST</Th><Th right>SGST</Th><Th right>IGST</Th><Th right>Cess</Th><Th>Effective</Th><Th>Status</Th><Th /></tr>}>
            {rows.map((t) => {
              const s = rateState(t, today);
              return (
                <Tr key={t.id}>
                  <Td className="font-mono text-xs">{t.hsnCode}</Td>
                  <Td className="text-sm">{t.description}</Td>
                  <Td right className="text-sm">{pct(t.cgstPercent)}</Td>
                  <Td right className="text-sm">{pct(t.sgstPercent)}</Td>
                  <Td right className="text-sm font-medium">{pct(t.igstPercent)}</Td>
                  <Td right className="text-sm">{pct(t.cessPercent)}</Td>
                  <Td className="text-xs text-neutral-500">{fmtDate(t.effectiveFrom)}{t.effectiveTo ? ` → ${fmtDate(t.effectiveTo)}` : ' →'}</Td>
                  <Td><Badge tone={s === 'ACTIVE' ? 'green' : s === 'SCHEDULED' ? 'blue' : 'neutral'} dot={s !== 'ENDED'}>{s === 'ACTIVE' ? 'Active' : s === 'SCHEDULED' ? 'Scheduled' : 'Ended'}</Badge></Td>
                  <Td right>
                    {canManage && !t.effectiveTo ? (
                      <Button variant="ghost" className="text-xs" onClick={() => { setEndDate(today); setEnding(t); }}>End…</Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>
      <ConfirmDialog
        open={ending !== null}
        title={`End HSN ${ending?.hsnCode ?? ''} rate`}
        message="The version stays in history. Add a new version afterwards to apply the revised rate."
        confirmLabel="End version"
        tone="danger"
        busy={end.isPending}
        onCancel={() => setEnding(null)}
        onConfirm={() => {
          if (ending && !endBeforeStart) end.mutate({ id: ending.id, effectiveTo: endDate });
        }}
      >
        <Field label="Last day this rate applies" required error={endBeforeStart ? 'Cannot end before the start date' : undefined}>
          <Input type="date" value={endDate} min={ending?.effectiveFrom.slice(0, 10)} onChange={(e) => setEndDate(e.target.value || today)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

// ── Categories ───────────────────────────────────────────────────────────────

function CategoryDrawer({ category, categories, onClose, onDone }: { category: Category | 'new'; categories: Category[]; onClose: () => void; onDone: () => void }) {
  const editing = category === 'new' ? null : category;
  const [form, setForm] = useState({ name: editing?.name ?? '', parentId: editing?.parentId ?? '', description: editing?.description ?? '' });
  const { errors, validate, clear, setServerErrors } = useFieldErrors();
  const descendants = useMemo(() => {
    if (!editing) return new Set<string>();
    const out = new Set<string>([editing.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; }
    }
    return out;
  }, [categories, editing]);
  const save = useMutation({
    meta: { success: editing ? 'Category updated' : 'Category added' },
    mutationFn: (body: unknown) => api(editing ? `/catalog/categories/${editing.id}` : '/catalog/categories', { method: editing ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setServerErrors(e.details ?? (e.code === 'DUPLICATE_ENTITY' ? [{ field: 'name', message: e.message }] : undefined));
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = validate(categoryCreateSchema, { name: form.name.trim(), parentId: form.parentId || null, description: blank(form.description) });
    if (body) save.mutate(body);
  };
  return (
    <Drawer open onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New category'} subtitle="Group products for filters and reports" width="max-w-md">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Name" required error={errors.name}>
          <Input value={form.name} maxLength={120} autoFocus onChange={(e) => { clear('name'); setForm((f) => ({ ...f, name: e.target.value })); }} placeholder="e.g. Antibiotics" />
        </Field>
        <Field label="Parent category" error={errors.parentId} hint="Leave as top level, or nest under another category">
          <Select value={form.parentId} onChange={(e) => { clear('parentId'); setForm((f) => ({ ...f, parentId: e.target.value })); }}>
            <option value="">— Top level —</option>
            {categories.filter((c) => !descendants.has(c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Description" error={errors.description}>
          <Textarea rows={3} maxLength={500} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add category'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function CategoryNode({ c, childrenOf, depth, canManage, onEdit, onDelete }: { c: Category; childrenOf: Map<string | null, Category[]>; depth: number; canManage: boolean; onEdit: (c: Category) => void; onDelete: (c: Category) => void }) {
  const [open, setOpen] = useState(true);
  const kids = childrenOf.get(c.id) ?? [];
  return (
    <li>
      <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-neutral-50" style={{ paddingLeft: `${depth * 20 + 8}px` }}>
        <button type="button" onClick={() => setOpen((o) => !o)} className={cn('h-5 w-5 rounded flex items-center justify-center text-neutral-400 transition-transform duration-200 hover:bg-neutral-100', !kids.length && 'invisible', open && 'rotate-90')} aria-label={open ? 'Collapse' : 'Expand'}>
          <Icon name="chevronRight" size={14} />
        </button>
        <span className="text-sm font-medium text-neutral-800">{c.name}</span>
        <Badge tone={c._count?.products ? 'blue' : 'neutral'}>{c._count?.products ?? 0} products</Badge>
        {c.description ? <span className="truncate text-xs text-neutral-400">{c.description}</span> : null}
        {canManage ? (
          <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button variant="ghost" className="text-xs" onClick={() => onEdit(c)}>Edit</Button>
            <Button variant="ghost" className="text-xs text-red-600" onClick={() => onDelete(c)}>Delete</Button>
          </span>
        ) : null}
      </div>
      {open && kids.length ? (
        <ul>
          {kids.map((k) => (
            <CategoryNode key={k.id} c={k} childrenOf={childrenOf} depth={depth + 1} canManage={canManage} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CategoriesTab({ categories, canManage, refresh }: { categories: Category[]; canManage: boolean; refresh: () => void }) {
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [search, setSearch] = useState('');
  const remove = useMutation({
    meta: { success: 'Category deleted' },
    mutationFn: (id: string) => api(`/catalog/categories/${id}`, { method: 'DELETE' }),
    onSettled: () => setDeleting(null),
    onSuccess: refresh,
  });
  const q = search.trim().toLowerCase();
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    for (const c of categories) map.set(c.parentId, [...(map.get(c.parentId) ?? []), c]);
    return map;
  }, [categories]);
  const matches = categories.filter((c) => c.name.toLowerCase().includes(q));
  return (
    <>
      <Card
        title={`Category tree (${categories.length})`}
        actions={
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Find a category" className="w-48" />
            {canManage ? <Button onClick={() => setEditing('new')}><Icon name="plus" size={15} strokeWidth={2.25} /> Category</Button> : null}
          </div>
        }
      >
        {categories.length === 0 ? (
          <EmptyState title="No categories" hint="Group products such as Antibiotics → Penicillins for filters and reports." />
        ) : q ? (
          matches.length ? (
            <ul className="space-y-0.5">
              {matches.map((c) => (
                <CategoryNode key={c.id} c={c} childrenOf={new Map()} depth={0} canManage={canManage} onEdit={setEditing} onDelete={setDeleting} />
              ))}
            </ul>
          ) : (
            <EmptyState title="No category matches" />
          )
        ) : (
          <ul className="mc-stagger space-y-0.5">
            {(childrenOf.get(null) ?? []).map((c) => (
              <CategoryNode key={c.id} c={c} childrenOf={childrenOf} depth={0} canManage={canManage} onEdit={setEditing} onDelete={setDeleting} />
            ))}
          </ul>
        )}
      </Card>
      {editing ? <CategoryDrawer category={editing} categories={categories} onClose={() => setEditing(null)} onDone={refresh} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        message="Only empty categories without sub-categories can be deleted."
        confirmLabel="Delete"
        tone="danger"
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

// ── Manufacturers ────────────────────────────────────────────────────────────

function ManufacturerDrawer({ manufacturer, onClose, onDone }: { manufacturer: Manufacturer | 'new'; onClose: () => void; onDone: () => void }) {
  const editing = manufacturer === 'new' ? null : manufacturer;
  const [form, setForm] = useState({ name: editing?.name ?? '', contactEmail: editing?.contactEmail ?? '', contactPhone: editing?.contactPhone ?? '', notes: editing?.notes ?? '' });
  const { errors, validate, clear, setServerErrors } = useFieldErrors();
  const set = (k: keyof typeof form, v: string) => {
    clear(k);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const save = useMutation({
    meta: { success: editing ? 'Manufacturer updated' : 'Manufacturer added' },
    mutationFn: (body: unknown) => api(editing ? `/catalog/manufacturers/${editing.id}` : '/catalog/manufacturers', { method: editing ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiClientError) setServerErrors(e.details ?? (e.code === 'DUPLICATE_ENTITY' ? [{ field: 'name', message: e.message }] : undefined));
    },
  });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const body = validate(manufacturerCreateSchema, { name: form.name.trim(), contactEmail: blank(form.contactEmail), contactPhone: blank(form.contactPhone), notes: blank(form.notes) });
    if (body) save.mutate(body);
  };
  return (
    <Drawer open onClose={onClose} title={editing ? `Edit ${editing.name}` : 'New manufacturer'} subtitle="Makers and marketers — used for recalls and reports" width="max-w-md">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Name" required error={errors.name}>
          <Input value={form.name} maxLength={160} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="e.g. Cipla Ltd" />
        </Field>
        <Field label="Contact email" error={errors.contactEmail}>
          <Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="pv@manufacturer.in" />
        </Field>
        <Field label="Contact phone" error={errors.contactPhone} hint="10-digit Indian mobile or landline with STD code">
          <Input value={form.contactPhone} inputMode="tel" maxLength={14} onChange={(e) => set('contactPhone', e.target.value)} placeholder="9822012345" />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <Textarea rows={3} maxLength={500} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Pharmacovigilance contact, distributor…" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add manufacturer'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function ManufacturersTab({ manufacturers, canManage, refresh }: { manufacturers: Manufacturer[]; canManage: boolean; refresh: () => void }) {
  const [editing, setEditing] = useState<Manufacturer | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Manufacturer | null>(null);
  const [search, setSearch] = useState('');
  const remove = useMutation({
    meta: { success: 'Manufacturer deleted' },
    mutationFn: (id: string) => api(`/catalog/manufacturers/${id}`, { method: 'DELETE' }),
    onSettled: () => setDeleting(null),
    onSuccess: refresh,
  });
  const q = search.trim().toLowerCase();
  const rows = manufacturers.filter((m) => !q || m.name.toLowerCase().includes(q) || (m.contactEmail ?? '').toLowerCase().includes(q));
  return (
    <>
      <Card
        title={`Manufacturers (${rows.length})`}
        actions={
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Name or email" className="w-48" />
            {canManage ? <Button onClick={() => setEditing('new')}><Icon name="plus" size={15} strokeWidth={2.25} /> Manufacturer</Button> : null}
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={q ? 'No manufacturer matches' : 'No manufacturers'} hint="Track makers of your products for recalls and reporting." />
        ) : (
          <Table head={<tr><Th>Name</Th><Th>Contact</Th><Th right>Products</Th><Th>Notes</Th><Th /></tr>}>
            {rows.map((m) => (
              <Tr key={m.id}>
                <Td className="text-sm font-medium">{m.name}</Td>
                <Td className="text-xs text-neutral-600">
                  {m.contactEmail ?? '—'}
                  {m.contactPhone ? <span className="block text-neutral-400">{m.contactPhone}</span> : null}
                </Td>
                <Td right><Badge tone={m._count?.products ? 'blue' : 'neutral'}>{m._count?.products ?? 0}</Badge></Td>
                <Td className="max-w-xs truncate text-xs text-neutral-500">{m.notes ?? '—'}</Td>
                <Td right>
                  {canManage ? (
                    <span className="flex justify-end gap-1">
                      <Button variant="ghost" className="text-xs" onClick={() => setEditing(m)}>Edit</Button>
                      <Button variant="ghost" className="text-xs text-red-600" disabled={Boolean(m._count?.products)} title={m._count?.products ? 'Reassign its products first' : undefined} onClick={() => setDeleting(m)}>Delete</Button>
                    </span>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
      {editing ? <ManufacturerDrawer manufacturer={editing} onClose={() => setEditing(null)} onDone={refresh} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ''}?`}
        message="This removes the manufacturer from the master list."
        confirmLabel="Delete"
        tone="danger"
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}

export default function ConfigurationPage() {
  const queryClient = useQueryClient();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('tax');
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/catalog/categories') });
  const manufacturers = useQuery({ queryKey: ['manufacturers'], queryFn: () => api<Manufacturer[]>('/catalog/manufacturers') });
  const taxRates = useQuery({ queryKey: ['tax-rates'], queryFn: () => api<TaxRate[]>('/catalog/tax-rates') });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    void queryClient.invalidateQueries({ queryKey: ['manufacturers'] });
    void queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
  };
  const today = todayIso();
  const active = (taxRates.data ?? []).filter((t) => rateState(t, today) === 'ACTIVE');
  const current = tab === 'tax' ? taxRates : tab === 'categories' ? categories : manufacturers;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Catalog configuration" subtitle="GST rate versions, product categories and manufacturers." />
      <KpiGrid cols={4}>
        <Stat label="Active GST rates" value={active.length} hint={`${new Set(active.map((t) => t.hsnCode)).size} HSN codes covered`} tone="green" />
        <Stat label="Scheduled changes" value={(taxRates.data ?? []).filter((t) => rateState(t, today) === 'SCHEDULED').length} hint="Future-dated versions" tone="blue" delay={60} />
        <Stat label="Categories" value={categories.data?.length ?? '…'} hint={`${(categories.data ?? []).filter((c) => !c.parentId).length} top level`} delay={120} />
        <Stat label="Manufacturers" value={manufacturers.data?.length ?? '…'} delay={180} />
      </KpiGrid>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'tax', label: 'GST rates', count: taxRates.data?.length },
          { id: 'categories', label: 'Categories', count: categories.data?.length },
          { id: 'manufacturers', label: 'Manufacturers', count: manufacturers.data?.length },
        ]}
      />
      {current.isLoading ? (
        <SkeletonRows rows={5} cols={5} />
      ) : current.error ? (
        <ErrorState message="Failed to load configuration." retry={() => void current.refetch()} />
      ) : tab === 'tax' ? (
        <TaxTab rates={taxRates.data ?? []} canManage={can('tax.manage')} refresh={refresh} />
      ) : tab === 'categories' ? (
        <CategoriesTab categories={categories.data ?? []} canManage={can('categories.manage')} refresh={refresh} />
      ) : (
        <ManufacturersTab manufacturers={manufacturers.data ?? []} canManage={can('categories.manage')} refresh={refresh} />
      )}
    </div>
  );
}
