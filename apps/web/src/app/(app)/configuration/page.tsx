'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Spinner,
  SuccessBanner,
  Table,
  Tr,
  fmtDate,
  todayIso,
} from '@/components/ui';

interface Category {
  id: string;
  name: string;
  description: string | null;
  _count?: { products: number };
}

interface Manufacturer {
  id: string;
  name: string;
  contactEmail: string | null;
  notes: string | null;
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

export default function TaxonomyPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'categories' | 'manufacturers' | 'tax'>('tax');
  const [catForm, setCatForm] = useState({ name: '', description: '' });
  const [mfrForm, setMfrForm] = useState({ name: '', contactEmail: '', notes: '' });
  const [taxForm, setTaxForm] = useState({
    hsnCode: '',
    description: '',
    cgstPercent: '',
    sgstPercent: '',
    igstPercent: '',
    cessPercent: '',
    effectiveFrom: '',
  });
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    void queryClient.invalidateQueries({ queryKey: ['manufacturers'] });
    void queryClient.invalidateQueries({ queryKey: ['tax-rates'] });
  };

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/catalog/categories'),
    retry: false,
  });
  const manufacturers = useQuery({
    queryKey: ['manufacturers'],
    queryFn: () => api<Manufacturer[]>('/catalog/manufacturers'),
    retry: false,
  });
  const taxRates = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => api<TaxRate[]>('/catalog/tax-rates'),
    retry: false,
  });

  const createCategory = useMutation({
    meta: { success: 'Category added' },
    mutationFn: () =>
      api('/catalog/categories', {
        method: 'POST',
        body: { name: catForm.name.trim(), description: catForm.description.trim() || null },
      }),
    onSuccess: () => {
      setCatForm({ name: '', description: '' });
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create category'),
  });

  const createManufacturer = useMutation({
    meta: { success: 'Manufacturer added' },
    mutationFn: () =>
      api('/catalog/manufacturers', {
        method: 'POST',
        body: {
          name: mfrForm.name.trim(),
          contactEmail: mfrForm.contactEmail.trim() || null,
          notes: mfrForm.notes.trim() || null,
        },
      }),
    onSuccess: () => {
      setMfrForm({ name: '', contactEmail: '', notes: '' });
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create manufacturer'),
  });

  const createTaxRate = useMutation({
    meta: { success: 'GST rate version added' },
    mutationFn: () =>
      api('/catalog/tax-rates', {
        method: 'POST',
        body: {
          hsnCode: taxForm.hsnCode.trim(),
          description: taxForm.description.trim(),
          cgstPercent: taxForm.cgstPercent.trim() || null,
          sgstPercent: taxForm.sgstPercent.trim() || null,
          igstPercent: taxForm.igstPercent.trim() || null,
          cessPercent: taxForm.cessPercent.trim() || null,
          effectiveFrom: taxForm.effectiveFrom,
        },
      }),
    onSuccess: () => {
      setTaxForm({ hsnCode: '', description: '', cgstPercent: '', sgstPercent: '', igstPercent: '', cessPercent: '', effectiveFrom: '' });
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to create tax rate version'),
  });

  const [notice, setNotice] = useState<string | null>(null);
  const loadStandard = useMutation({
    meta: { success: 'Standard GST rates loaded' },
    mutationFn: () => api<{ created: number; skipped: number; effectiveFrom: string }>('/catalog/tax-rates/load-standard', { method: 'POST' }),
    onSuccess: (r) => {
      setError(null);
      setNotice(
        r.created > 0
          ? `Loaded ${r.created} standard GST rate versions effective ${r.effectiveFrom}${r.skipped ? ` (${r.skipped} HSN codes already configured were left untouched)` : ''}.`
          : 'All standard HSN codes are already configured — nothing changed.',
      );
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to load standard rates'),
  });
  const endVersion = useMutation({
    meta: { success: 'Rate version ended' },
    mutationFn: (v: { id: string; effectiveTo: string }) => api(`/catalog/tax-rates/${v.id}/end`, { method: 'PATCH', body: { effectiveTo: v.effectiveTo } }),
    onSuccess: () => {
      setError(null);
      setNotice('Version closed. Add a new version for the HSN to apply the revised rate.');
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to close version'),
  });
  const now = Date.now();

  const TABS = [
    { key: 'tax', label: 'Tax rate versions' },
    { key: 'categories', label: 'Categories' },
    { key: 'manufacturers', label: 'Manufacturers' },
  ] as const;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="mc-anim-fade-up flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Catalog configuration</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Categories, manufacturers and effective-dated GST rate versions.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`rounded-md px-3 py-1.5 text-sm transition-all duration-200 ${
                tab === t.key ? 'bg-brand-50 font-medium text-brand-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}

      {tab === 'tax' ? (
        <>
          <section className="mc-anim-fade-up flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200/70 bg-gradient-to-r from-brand-50 to-white px-4 py-3 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-neutral-800">Standard pharmacy GST rates</p>
              <p className="text-xs text-neutral-500">
                Chapter 30 medicines, dressings, diagnostics and devices at 5% (effective 22 Sep 2025, per the compliance notes). Existing HSN
                codes are never overwritten. Sales are blocked for products without a resolvable rate.
              </p>
            </div>
            <Button disabled={loadStandard.isPending} onClick={() => loadStandard.mutate()}>
              {loadStandard.isPending ? 'Loading…' : 'Load standard GST rates'}
            </Button>
          </section>
          <Card title="New tax rate version (effective-dated — never hardcode)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="HSN code">
                <Input value={taxForm.hsnCode} onChange={(e) => setTaxForm((s) => ({ ...s, hsnCode: e.target.value }))} placeholder="3004" />
              </Field>
              <Field label="Description">
                <Input value={taxForm.description} onChange={(e) => setTaxForm((s) => ({ ...s, description: e.target.value }))} placeholder="Medicaments — 5% slab" />
              </Field>
              <Field label="CGST %">
                <Input value={taxForm.cgstPercent} onChange={(e) => setTaxForm((s) => ({ ...s, cgstPercent: e.target.value }))} placeholder="2.50" />
              </Field>
              <Field label="SGST %">
                <Input value={taxForm.sgstPercent} onChange={(e) => setTaxForm((s) => ({ ...s, sgstPercent: e.target.value }))} placeholder="2.50" />
              </Field>
              <Field label="IGST %">
                <Input value={taxForm.igstPercent} onChange={(e) => setTaxForm((s) => ({ ...s, igstPercent: e.target.value }))} placeholder="5.00 (inter-state)" />
              </Field>
              <Field label="Cess % (optional)">
                <Input value={taxForm.cessPercent} onChange={(e) => setTaxForm((s) => ({ ...s, cessPercent: e.target.value }))} />
              </Field>
              <Field label="Effective from">
                <Input type="date" value={taxForm.effectiveFrom} onChange={(e) => setTaxForm((s) => ({ ...s, effectiveFrom: e.target.value }))} />
              </Field>
              <div className="flex items-end">
                <Button disabled={createTaxRate.isPending || !taxForm.hsnCode || !taxForm.description || !taxForm.effectiveFrom} onClick={() => createTaxRate.mutate()}>
                  {createTaxRate.isPending ? 'Saving…' : 'Add version'}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Rate master values must come from official CBIC schedules (see docs/compliance/gst-requirements.md).
              Transactions snapshot the version applied at posting time.
            </p>
          </Card>

          <Card title={`Tax rate versions (${taxRates.data?.length ?? 0})`}>
            {taxRates.isLoading ? (
              <Spinner />
            ) : (taxRates.data?.length ?? 0) === 0 ? (
              <EmptyState title="No tax versions" hint="Add effective-dated rates per HSN — history is preserved, never overwritten." />
            ) : (
              <Table
                head={
                  <tr>
                    <th className="px-3 py-2">HSN</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">CGST</th>
                    <th className="px-3 py-2">SGST</th>
                    <th className="px-3 py-2">IGST</th>
                    <th className="px-3 py-2">Cess</th>
                    <th className="px-3 py-2">Effective</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                }
              >
                {taxRates.data?.map((t) => {
                  const ended = t.effectiveTo !== null && new Date(t.effectiveTo).getTime() < now;
                  const future = new Date(t.effectiveFrom).getTime() > now;
                  return (
                  <Tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-xs">{t.hsnCode}</td>
                    <td className="px-3 py-2 text-sm">{t.description}</td>
                    <td className="px-3 py-2 text-sm">{t.cgstPercent ? `${t.cgstPercent}%` : '—'}</td>
                    <td className="px-3 py-2 text-sm">{t.sgstPercent ? `${t.sgstPercent}%` : '—'}</td>
                    <td className="px-3 py-2 text-sm">{t.igstPercent ? `${t.igstPercent}%` : '—'}</td>
                    <td className="px-3 py-2 text-sm">{t.cessPercent ? `${t.cessPercent}%` : '—'}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      from {fmtDate(t.effectiveFrom)}
                      {t.effectiveTo ? ` to ${fmtDate(t.effectiveTo)}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ended ? 'neutral' : future ? 'blue' : 'green'} dot={!ended}>
                        {ended ? 'Ended' : future ? 'Scheduled' : 'Active'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!t.effectiveTo ? (
                        <Button
                          variant="ghost"
                          disabled={endVersion.isPending}
                          onClick={() => {
                            const effectiveTo = window.prompt(`Close HSN ${t.hsnCode} version on (YYYY-MM-DD):`, todayIso());
                            if (effectiveTo) endVersion.mutate({ id: t.id, effectiveTo });
                          }}
                        >
                          End
                        </Button>
                      ) : null}
                    </td>
                  </Tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <Card title="New category">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Name">
                <Input value={catForm.name} onChange={(e) => setCatForm((s) => ({ ...s, name: e.target.value }))} />
              </Field>
              <Field label="Description">
                <Input value={catForm.description} onChange={(e) => setCatForm((s) => ({ ...s, description: e.target.value }))} />
              </Field>
              <div className="flex items-end">
                <Button disabled={createCategory.isPending || catForm.name.trim().length === 0} onClick={() => createCategory.mutate()}>
                  {createCategory.isPending ? 'Saving…' : 'Create'}
                </Button>
              </div>
            </div>
          </Card>
          <Card title={`Categories (${categories.data?.length ?? 0})`}>
            {categories.isLoading ? (
              <Spinner />
            ) : (categories.data?.length ?? 0) === 0 ? (
              <EmptyState title="No categories" hint="Group products for reporting and filtering." />
            ) : (
              <Table
                head={
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Products</th>
                  </tr>
                }
              >
                {categories.data?.map((c) => (
                  <Tr key={c.id}>
                    <td className="px-3 py-2 text-sm font-medium">{c.name}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{c.description ?? '—'}</td>
                    <td className="px-3 py-2"><Badge>{c._count?.products ?? 0}</Badge></td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'manufacturers' ? (
        <>
          <Card title="New manufacturer">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Field label="Name">
                <Input value={mfrForm.name} onChange={(e) => setMfrForm((s) => ({ ...s, name: e.target.value }))} />
              </Field>
              <Field label="Contact email">
                <Input type="email" value={mfrForm.contactEmail} onChange={(e) => setMfrForm((s) => ({ ...s, contactEmail: e.target.value }))} />
              </Field>
              <Field label="Notes">
                <Input value={mfrForm.notes} onChange={(e) => setMfrForm((s) => ({ ...s, notes: e.target.value }))} />
              </Field>
              <div className="flex items-end">
                <Button disabled={createManufacturer.isPending || mfrForm.name.trim().length === 0} onClick={() => createManufacturer.mutate()}>
                  {createManufacturer.isPending ? 'Saving…' : 'Create'}
                </Button>
              </div>
            </div>
          </Card>
          <Card title={`Manufacturers (${manufacturers.data?.length ?? 0})`}>
            {manufacturers.isLoading ? (
              <Spinner />
            ) : (manufacturers.data?.length ?? 0) === 0 ? (
              <EmptyState title="No manufacturers" hint="Track the makers of your products for recalls and reporting." />
            ) : (
              <Table
                head={
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Contact</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                }
              >
                {manufacturers.data?.map((m) => (
                  <Tr key={m.id}>
                    <td className="px-3 py-2 text-sm font-medium">{m.name}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{m.contactEmail ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{m.notes ?? '—'}</td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
