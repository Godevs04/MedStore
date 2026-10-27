'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { INDIAN_STATE_CODES, emailSchema, gstinSchema, indianPhoneSchema, organizationSetupSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { Button, Card, ErrorState, Field, Input, Select, Spinner, SuccessBanner, ErrorBanner, PageHeader } from '@/components/ui';

// Optional inputs submit '' when left blank; treat that as "not provided".
const blank = z.literal('');
const settingsFormSchema = organizationSetupSchema.extend({
  legalEntityName: z.string().trim().max(160).or(blank).nullish(),
  gstin: gstinSchema.or(blank).nullish(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must look like ABCDE1234F').or(blank).nullish(),
  addressLine2: z.string().trim().max(200).or(blank).nullish(),
  contactPhone: indianPhoneSchema.or(blank).nullish(),
  contactEmail: emailSchema.or(blank).nullish(),
});
type OrgForm = z.input<typeof settingsFormSchema>;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const org = useQuery({
    queryKey: ['org-profile'],
    queryFn: () =>
      api<{
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
      }>('/organizations'),
    retry: false,
  });

  const form = useForm<OrgForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      businessName: '',
      legalEntityName: null,
      gstRegistrationStatus: 'REGULAR',
      gstin: null,
      pan: null,
      addressLine1: '',
      addressLine2: null,
      city: '',
      stateCode: '',
      pinCode: '',
      contactPhone: '',
      contactEmail: '',
      financialYearStartMonth: 4,
    },
  });

  useEffect(() => {
    if (org.data) {
      form.reset({
        businessName: org.data.name,
        legalEntityName: org.data.legalEntityName,
        gstRegistrationStatus: (org.data.gstRegistrationStatus as OrgForm['gstRegistrationStatus']) ?? 'REGULAR',
        gstin: org.data.gstin,
        pan: org.data.pan,
        addressLine1: org.data.addressLine1 ?? '',
        addressLine2: org.data.addressLine2,
        city: org.data.city ?? '',
        stateCode: org.data.stateCode ?? '',
        pinCode: org.data.pinCode ?? undefined,
        contactPhone: org.data.contactPhone ?? '',
        contactEmail: org.data.contactEmail ?? undefined,
        financialYearStartMonth: 4,
      });
    }
  }, [org.data, form]);

  const save = useMutation({
    meta: { success: 'Settings saved' },
    mutationFn: (data: OrgForm) =>
      api('/organizations', {
        method: 'PATCH',
        body: {
          name: data.businessName,
          legalEntityName: data.legalEntityName || null,
          gstRegistrationStatus: data.gstRegistrationStatus,
          gstin: data.gstin || null,
          pan: data.pan || null,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2 || null,
          city: data.city,
          stateCode: data.stateCode,
          pinCode: data.pinCode,
          contactPhone: data.contactPhone || null,
          contactEmail: data.contactEmail || null,
          financialYearStartMonth: data.financialYearStartMonth,
        },
      }),
    onSuccess: () => {
      setMessage('Business profile saved.');
      void queryClient.invalidateQueries({ queryKey: ['org-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
      void refetchSession();
    },
    onError: (e) => setError(e instanceof ApiClientError ? e.message : 'Failed to save settings'),
  });

  if (org.isLoading) return <Spinner />;
  if (org.error) {
    const msg =
      org.error instanceof ApiClientError && org.error.status === 403
        ? 'You do not have permission to view organization settings.'
        : 'Failed to load settings.';
    return <ErrorState message={msg} retry={() => void org.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Organization settings" subtitle="Business profile, GST identity and financial year." />
      {message ? <SuccessBanner>{message}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      <Card title="Business profile">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={form.handleSubmit(
            (d) => {
              setMessage(null);
              setError(null);
              save.mutate(d);
            },
            () => toast.error('Check the highlighted fields', 'Some details are missing or invalid.'),
          )}>
          <Field label="Business name" error={form.formState.errors.businessName?.message}>
            <Input {...form.register('businessName')} />
          </Field>
          <Field label="Legal entity name">
            <Input {...form.register('legalEntityName')} />
          </Field>
          <Field label="GST registration" error={form.formState.errors.gstRegistrationStatus?.message}>
            <Select {...form.register('gstRegistrationStatus')}>
              <option value="REGULAR">Regular</option>
              <option value="COMPOSITION">Composition</option>
              <option value="UNREGISTERED">Unregistered</option>
              <option value="CONSUMER">Consumer</option>
            </Select>
          </Field>
          <Field label="GSTIN" error={form.formState.errors.gstin?.message}>
            <Input placeholder="15-character GSTIN" {...form.register('gstin')} />
          </Field>
          <Field label="PAN" error={form.formState.errors.pan?.message}>
            <Input {...form.register('pan')} />
          </Field>
          <Field label="Financial year starts (month)" error={form.formState.errors.financialYearStartMonth?.message}>
            <Select {...form.register('financialYearStartMonth', { valueAsNumber: true })}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(2026, i, 1).toLocaleString('en-IN', { month: 'long' })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Address line 1" error={form.formState.errors.addressLine1?.message}>
            <Input {...form.register('addressLine1')} />
          </Field>
          <Field label="Address line 2">
            <Input {...form.register('addressLine2')} />
          </Field>
          <Field label="City" error={form.formState.errors.city?.message}>
            <Input {...form.register('city')} />
          </Field>
          <Field label="State (GST)" error={form.formState.errors.stateCode?.message}>
            <Select {...form.register('stateCode')}>
              <option value="">Select state…</option>
              {INDIAN_STATE_CODES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PIN code" error={form.formState.errors.pinCode?.message}>
            <Input {...form.register('pinCode')} />
          </Field>
          <Field label="Contact phone" error={form.formState.errors.contactPhone?.message}>
            <Input {...form.register('contactPhone')} />
          </Field>
          <Field label="Contact email" error={form.formState.errors.contactEmail?.message}>
            <Input type="email" {...form.register('contactEmail')} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-neutral-500">
          GSTIN is format-checked only (spec §6): MediCore does not verify registration status against
          government systems.
        </p>
      </Card>
    </div>
  );
}
