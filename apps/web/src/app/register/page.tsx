'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { registerOrganizationRequestSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { AuthShell, PasswordChecklist, PasswordInput, authLinkClass } from '@/components/auth';
import { Button, Field, Input, Alert } from '@/components/ui';

const schema = registerOrganizationRequestSchema.extend({
  organizationName: z.string().trim().min(2, 'Enter your pharmacy’s name').max(160, 'Keep it under 160 characters'),
  fullName: z.string().trim().min(2, 'Enter your full name').max(120, 'Keep it under 120 characters'),
  acceptTerms: z.boolean().refine((v) => v, 'Please accept the terms to continue'),
});
type Form = z.input<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { refetch: refetchSession } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', fullName: '', organizationName: '', acceptTerms: false },
  });
  const password = watch('password');

  const onSubmit = handleSubmit(async ({ acceptTerms: _accepted, ...data }) => {
    setFormError(null);
    try {
      await api('/auth/register', { method: 'POST', body: { ...data, email: data.email.trim().toLowerCase() } });
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.code === 'DUPLICATE_ENTITY' || e.status === 409) {
          setError('email', { message: 'An account with this email already exists — sign in instead' });
          toast.error('Email already registered', 'Sign in, or use “Forgot password” to recover access.');
          return;
        }
        for (const d of e.details ?? []) {
          if (d.field && d.field in schema.shape) setError(d.field as keyof Form, { message: d.message });
        }
      }
      const message = e instanceof ApiClientError ? e.message : 'Registration failed. Please try again.';
      setFormError(message);
      toast.error('Couldn’t create your workspace', message);
      return;
    }
    toast.success('Workspace created', 'Your 14-day trial has started — let’s set up your pharmacy.');
    refetchSession();
    router.replace('/');
  });

  return (
    <AuthShell
      wide
      title="Create your pharmacy workspace"
      subtitle="Free 14-day trial · all features · no card required"
      footer={
        <>
          Already have an account?{' '}
          <Link className={authLinkClass} href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
        <Field label="Pharmacy / business name" required error={errors.organizationName?.message} className="sm:col-span-2">
          <Input autoFocus autoComplete="organization" placeholder="e.g. City Care Pharmacy" {...register('organizationName')} />
        </Field>
        <Field label="Your name" required error={errors.fullName?.message} className="sm:col-span-2">
          <Input autoComplete="name" placeholder="Full name" {...register('fullName')} />
        </Field>
        <Field label="Work email" required error={errors.email?.message} className="sm:col-span-2">
          <Input type="email" inputMode="email" autoComplete="email" placeholder="you@pharmacy.in" {...register('email')} />
        </Field>
        <Field label="Password" required error={errors.password?.message} className="sm:col-span-2">
          <PasswordInput autoComplete="new-password" placeholder="Create a strong password" {...register('password')} />
          <PasswordChecklist value={password ?? ''} />
        </Field>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-2 text-xs text-neutral-600">
            <input type="checkbox" className="mt-0.5 accent-brand-600" {...register('acceptTerms', { onChange: () => clearErrors('acceptTerms') })} />
            <span>
              I agree to the Terms of Service and consent to MediCore processing my business data as described in the Privacy Notice (Digital Personal Data Protection Act, 2023).
            </span>
          </label>
          {errors.acceptTerms?.message ? <p className="mt-1 text-2xs text-danger">{errors.acceptTerms.message}</p> : null}
        </div>
        {formError ? (
          <Alert tone="danger" className="sm:col-span-2">{formError}</Alert>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
            {isSubmitting ? 'Creating your workspace…' : 'Create workspace'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
