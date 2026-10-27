'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  GSTIN_REQUIRED_FOR,
  INDIAN_STATE_CODES,
  financialYearOf,
  gstinIssues,
  isValidGstinChecksum,
  organizationSettingsSchema,
  organizationUpdateSchema,
  panFromGstin,
} from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { ConfirmDialog, FormSection, useFieldErrors } from '@/components/kit';
import { Button, Card, ErrorState, Field, Input, PageHeader, Select, SkeletonRows, Textarea, cn, todayIso, Alert } from '@/components/ui';

interface OrgProfile {
  name: string;
  legalEntityName: string | null;
  gstRegistrationStatus: string;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateCode: string | null;
  pinCode: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  financialYearStartMonth: number;
  settings: Record<string, unknown>;
}

const REGISTRATIONS = [
  { id: 'REGULAR', label: 'Regular', hint: 'Charges GST, claims ITC, files GSTR-1 & 3B' },
  { id: 'COMPOSITION', label: 'Composition', hint: 'Turnover ≤ ₹1.5 cr, bill of supply, CMP-08' },
  { id: 'UNREGISTERED', label: 'Unregistered', hint: 'Below the threshold — no GST on bills' },
  { id: 'CONSUMER', label: 'Consumer', hint: 'Not a business taxpayer' },
] as const;
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleString('en-IN', { month: 'long' }));

type Form = {
  name: string;
  legalEntityName: string;
  contactPhone: string;
  contactEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateCode: string;
  pinCode: string;
  gstRegistrationStatus: string;
  gstin: string;
  pan: string;
  financialYearStartMonth: number;
  receiptFooter: string;
  invoiceTerms: string;
  printLicenceOnInvoice: boolean;
  defaultPrintFormat: 'A4' | 'THERMAL_80';
  upiId: string;
  lowStockAlertDays: string;
  expiryAlertDays: string;
};

const PROFILE_KEYS = ['name', 'legalEntityName', 'contactPhone', 'contactEmail', 'addressLine1', 'addressLine2', 'city', 'stateCode', 'pinCode', 'gstRegistrationStatus', 'gstin', 'pan', 'financialYearStartMonth'] as const;
const SETTINGS_KEYS = ['receiptFooter', 'invoiceTerms', 'printLicenceOnInvoice', 'defaultPrintFormat', 'upiId', 'lowStockAlertDays', 'expiryAlertDays'] as const;

function toForm(o: OrgProfile): Form {
  const s = o.settings ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown, d: number) => String(typeof v === 'number' ? v : d);
  return {
    name: o.name,
    legalEntityName: o.legalEntityName ?? '',
    contactPhone: o.contactPhone ?? '',
    contactEmail: o.contactEmail ?? '',
    addressLine1: o.addressLine1 ?? '',
    addressLine2: o.addressLine2 ?? '',
    city: o.city ?? '',
    stateCode: o.stateCode ?? '',
    pinCode: o.pinCode ?? '',
    gstRegistrationStatus: o.gstRegistrationStatus || 'UNREGISTERED',
    gstin: o.gstin ?? '',
    pan: o.pan ?? '',
    financialYearStartMonth: o.financialYearStartMonth || 4,
    receiptFooter: str(s.receiptFooter),
    invoiceTerms: str(s.invoiceTerms),
    printLicenceOnInvoice: s.printLicenceOnInvoice !== false,
    defaultPrintFormat: s.defaultPrintFormat === 'THERMAL_80' ? 'THERMAL_80' : 'A4',
    upiId: str(s.upiId),
    lowStockAlertDays: num(s.lowStockAlertDays, 30),
    expiryAlertDays: num(s.expiryAlertDays, 90),
  };
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const canEdit = can('organization.settings.manage');
  const { refetch: refetchSession } = useSession();
  const org = useQuery({ queryKey: ['org-profile'], queryFn: () => api<OrgProfile>('/organizations') });
  const [form, setForm] = useState<Form | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const { errors, setErrors, clear, setServerErrors } = useFieldErrors();
  const initial = useMemo(() => (org.data ? toForm(org.data) : null), [org.data]);

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const dirtyKeys = useMemo(() => (form && initial ? (Object.keys(form) as Array<keyof Form>).filter((k) => form[k] !== initial[k]) : []), [form, initial]);
  const dirty = dirtyKeys.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!anchor || e.defaultPrevented || e.metaKey || e.ctrlKey || anchor.getAttribute('target') === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href === '/settings') return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(href);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: async (v: { profile: Record<string, unknown> | null; settings: Record<string, unknown> | null }) => {
      if (v.profile) await api('/organizations', { method: 'PATCH', body: v.profile });
      if (v.settings) await api('/organizations/settings', { method: 'PATCH', body: v.settings });
    },
    onSuccess: () => {
      toast.success('Settings saved', `${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'} applied`);
      void queryClient.invalidateQueries({ queryKey: ['org-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
      void refetchSession();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && setServerErrors(e.details)) toast.error('Please fix the highlighted fields', e.message);
      else toast.error('Settings not saved', e instanceof ApiClientError ? e.message : 'Try again');
    },
  });

  if (org.isLoading || !form) {
    if (org.error) {
      const forbidden = org.error instanceof ApiClientError && org.error.status === 403;
      return <ErrorState message={forbidden ? 'You do not have permission to view organisation settings.' : 'Failed to load settings.'} retry={() => void org.refetch()} />;
    }
    return <SkeletonRows rows={8} cols={2} />;
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    clear(k);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };
  const gstinRequired = (GSTIN_REQUIRED_FOR as readonly string[]).includes(form.gstRegistrationStatus);
  const gstinUpper = form.gstin.trim().toUpperCase();
  const derivedPan = gstinUpper.length === 15 ? panFromGstin(gstinUpper) : null;
  const derivedState = gstinUpper.length >= 2 ? INDIAN_STATE_CODES.find((s) => s.code === gstinUpper.slice(0, 2)) : undefined;
  const fy = financialYearOf(todayIso(), form.financialYearStartMonth);

  const submit = () => {
    const blank = (v: string) => (v.trim() === '' ? null : v.trim());
    const profile = {
      name: form.name.trim(),
      legalEntityName: blank(form.legalEntityName),
      contactPhone: blank(form.contactPhone),
      contactEmail: blank(form.contactEmail),
      addressLine1: blank(form.addressLine1),
      addressLine2: blank(form.addressLine2),
      city: blank(form.city),
      stateCode: blank(form.stateCode),
      pinCode: blank(form.pinCode),
      gstRegistrationStatus: form.gstRegistrationStatus,
      gstin: blank(gstinUpper),
      pan: blank(form.pan.toUpperCase()),
      financialYearStartMonth: form.financialYearStartMonth,
    };
    const settings = {
      receiptFooter: form.receiptFooter.trim() || null,
      invoiceTerms: form.invoiceTerms.trim() || null,
      printLicenceOnInvoice: form.printLicenceOnInvoice,
      defaultPrintFormat: form.defaultPrintFormat,
      upiId: blank(form.upiId),
      lowStockAlertDays: Number(form.lowStockAlertDays),
      expiryAlertDays: Number(form.expiryAlertDays),
    };
    const next: Record<string, string> = {};
    const p = organizationUpdateSchema.safeParse(profile);
    const s = organizationSettingsSchema.safeParse(settings);
    for (const issue of [...(p.success ? [] : p.error.issues), ...(s.success ? [] : s.error.issues)]) {
      const key = String(issue.path[0] ?? 'form');
      if (!(key in next)) next[key] = issue.message;
    }
    if (!profile.addressLine1) next.addressLine1 = 'Address appears on every invoice';
    if (!profile.city) next.city = 'Enter the city';
    if (!profile.stateCode) next.stateCode = 'Select the state — it decides CGST/SGST vs IGST';
    if (!profile.pinCode) next.pinCode = 'Enter the 6-digit PIN code';
    if (gstinRequired && !profile.gstin) next.gstin = 'GSTIN is required for regular and composition taxpayers';
    if (profile.gstin && !next.gstin && !isValidGstinChecksum(profile.gstin)) next.gstin = 'GSTIN check digit does not match — re-check the number';
    for (const issue of gstinIssues({ gstin: profile.gstin, stateCode: profile.stateCode, pan: profile.pan })) if (!next[issue.field]) next[issue.field] = issue.message;
    if (Object.keys(next).length) {
      setErrors(next);
      toast.error('Please fix the highlighted fields', `${Object.keys(next).length} issue${Object.keys(next).length === 1 ? '' : 's'} found`);
      return;
    }
    const profileDirty = dirtyKeys.some((k) => (PROFILE_KEYS as readonly string[]).includes(k));
    const settingsDirty = dirtyKeys.some((k) => (SETTINGS_KEYS as readonly string[]).includes(k));
    save.mutate({ profile: profileDirty ? profile : null, settings: settingsDirty ? settings : null });
  };

  return (
    <div className="max-w-4xl space-y-6 pb-20">
      <PageHeader title="Organisation settings" subtitle="Business identity, GST registration, financial year and invoice printing." />
      <fieldset disabled={!canEdit || save.isPending} className="space-y-4">
        <Card>
          <div className="space-y-4">
            <FormSection title="Identity" hint="Shown on invoices, reports and e-mails">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Trade name" required error={errors.name}>
                  <Input value={form.name} maxLength={160} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Legal entity name" error={errors.legalEntityName} hint="As on the GST certificate, if different">
                  <Input value={form.legalEntityName} maxLength={160} onChange={(e) => set('legalEntityName', e.target.value)} />
                </Field>
                <Field label="Contact phone" error={errors.contactPhone}>
                  <Input value={form.contactPhone} inputMode="tel" maxLength={14} onChange={(e) => set('contactPhone', e.target.value)} placeholder="9822012345" />
                </Field>
                <Field label="Contact email" error={errors.contactEmail}>
                  <Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="accounts@pharmacy.in" />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Registered address" hint="Place of supply for GST is derived from this state">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Address line 1" required error={errors.addressLine1} className="sm:col-span-2">
                  <Input value={form.addressLine1} maxLength={200} onChange={(e) => set('addressLine1', e.target.value)} placeholder="Shop no., building, street" />
                </Field>
                <Field label="Address line 2" error={errors.addressLine2} className="sm:col-span-2">
                  <Input value={form.addressLine2} maxLength={200} onChange={(e) => set('addressLine2', e.target.value)} placeholder="Area, landmark" />
                </Field>
                <Field label="City" required error={errors.city}>
                  <Input value={form.city} maxLength={100} onChange={(e) => set('city', e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="State" required error={errors.stateCode}>
                    <Select value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)}>
                      <option value="">Select…</option>
                      {INDIAN_STATE_CODES.map((s) => (
                        <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="PIN code" required error={errors.pinCode}>
                    <Input value={form.pinCode} inputMode="numeric" maxLength={6} onChange={(e) => set('pinCode', e.target.value.replace(/\D/g, ''))} />
                  </Field>
                </div>
              </div>
            </FormSection>

            <FormSection title="GST registration" hint="MediCore checks the GSTIN format, check digit, state and PAN — not live registration status">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {REGISTRATIONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={form.gstRegistrationStatus === r.id}
                    onClick={() => {
                      clear('gstin');
                      set('gstRegistrationStatus', r.id);
                    }}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left transition-colors',
                      form.gstRegistrationStatus === r.id ? 'border-accent bg-mint/60 ring-1 ring-accent' : 'border-line bg-surface hover:border-neutral-300 hover:bg-subtle/50',
                    )}
                  >
                    <span className="block text-sm font-semibold text-ink">{r.label}</span>
                    <span className="block text-2xs leading-snug text-muted">{r.hint}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="GSTIN"
                  required={gstinRequired}
                  error={errors.gstin}
                  hint={derivedState ? `Registered in ${derivedState.name}${form.stateCode && form.stateCode !== derivedState.code ? ' — does not match the address state' : ''}` : '15 characters, e.g. 27AAPFU0939F1ZV'}
                >
                  <Input value={form.gstin} maxLength={15} className="font-mono uppercase" onChange={(e) => set('gstin', e.target.value.toUpperCase())} />
                </Field>
                <Field label="PAN" error={errors.pan} hint={derivedPan && form.pan.toUpperCase() !== derivedPan ? `GSTIN implies ${derivedPan}` : 'Characters 3–12 of your GSTIN'}>
                  <div className="flex gap-2">
                    <Input value={form.pan} maxLength={10} className="font-mono uppercase" onChange={(e) => set('pan', e.target.value.toUpperCase())} />
                    {derivedPan && form.pan.toUpperCase() !== derivedPan ? (
                      <Button type="button" variant="secondary" className="shrink-0 text-xs" onClick={() => set('pan', derivedPan)}>Use {derivedPan}</Button>
                    ) : null}
                  </div>
                </Field>
              </div>
            </FormSection>

            <FormSection title="Financial year" hint="Indian statutory books run April–March (Income Tax Act s.3)">
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                <Field label="Year starts in" error={errors.financialYearStartMonth}>
                  <Select value={String(form.financialYearStartMonth)} onChange={(e) => set('financialYearStartMonth', Number(e.target.value))}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{m}{i === 3 ? ' (standard)' : ''}</option>
                    ))}
                  </Select>
                </Field>
                <p className="rounded-md bg-subtle px-3 py-2 text-xs text-neutral-600">
                  Current year: <span className="font-semibold text-ink">{fy.label}</span> · {new Date(fy.from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} – {new Date(fy.to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
              {form.financialYearStartMonth !== 4 ? (
                <Alert tone="warning">A non-April year changes invoice numbering series and report periods. GST returns are still filed for April–March.</Alert>
              ) : null}
            </FormSection>

            <FormSection title="Invoice & print" hint="Applies to every new bill">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Default print format" error={errors.defaultPrintFormat}>
                  <Select value={form.defaultPrintFormat} onChange={(e) => set('defaultPrintFormat', e.target.value as Form['defaultPrintFormat'])}>
                    <option value="A4">A4 tax invoice</option>
                    <option value="THERMAL_80">80 mm thermal receipt</option>
                  </Select>
                </Field>
                <Field label="UPI ID for QR payments" error={errors.upiId} hint="Printed as a scan-to-pay QR">
                  <Input value={form.upiId} onChange={(e) => set('upiId', e.target.value)} placeholder="pharmacy@okhdfc" />
                </Field>
                <Field label="Receipt footer" error={errors.receiptFooter} hint={`${form.receiptFooter.length}/500`} className="sm:col-span-2">
                  <Textarea rows={2} maxLength={500} value={form.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="Thank you! Get well soon." />
                </Field>
                <Field label="Terms & conditions" error={errors.invoiceTerms} hint={`${form.invoiceTerms.length}/1000`} className="sm:col-span-2">
                  <Textarea rows={3} maxLength={1000} value={form.invoiceTerms} onChange={(e) => set('invoiceTerms', e.target.value)} placeholder="Medicines once sold are not returnable except as required by law. Subject to Pune jurisdiction." />
                </Field>
                <Field label="Low-stock look-ahead (days)" error={errors.lowStockAlertDays}>
                  <Input type="number" min={1} max={365} value={form.lowStockAlertDays} onChange={(e) => set('lowStockAlertDays', e.target.value)} />
                </Field>
                <Field label="Near-expiry alert (days)" error={errors.expiryAlertDays}>
                  <Input type="number" min={1} max={730} value={form.expiryAlertDays} onChange={(e) => set('expiryAlertDays', e.target.value)} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input type="checkbox" className="accent-brand-600" checked={form.printLicenceOnInvoice} onChange={(e) => set('printLicenceOnInvoice', e.target.checked)} />
                Print drug licence numbers on invoices (Drugs &amp; Cosmetics Rules, r.65)
              </label>
            </FormSection>
          </div>
        </Card>
      </fieldset>

      {canEdit ? (
        <div inert={!dirty} aria-hidden={!dirty} className={cn('fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 py-3 shadow-overlay transition-transform duration-200', dirty ? 'translate-y-0' : 'translate-y-full')}>
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <p className="text-sm text-neutral-600">
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning" />
              {dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={save.isPending} onClick={() => { if (initial) setForm(initial); setErrors({}); }}>Discard</Button>
              <Button disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={leaveTo !== null}
        title="Leave without saving?"
        message={`You have ${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? '' : 's'} on this page.`}
        confirmLabel="Leave page"
        tone="danger"
        onCancel={() => setLeaveTo(null)}
        onConfirm={() => {
          const href = leaveTo;
          setLeaveTo(null);
          if (initial) setForm(initial);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}
