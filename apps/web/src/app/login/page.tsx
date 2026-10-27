'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { loginRequestSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { AuthShell, PasswordInput, authLinkClass, safeNext, useQueryParam } from '@/components/auth';
import { Button, Field, Input } from '@/components/ui';

type Form = z.infer<typeof loginRequestSchema>;

function loginErrorMessage(e: unknown): string {
  if (!(e instanceof ApiClientError)) return 'Sign-in failed. Please try again.';
  switch (e.code) {
    case 'INVALID_CREDENTIALS':
      return 'That email and password don’t match. Check for typos or reset your password.';
    case 'ACCOUNT_LOCKED':
      return e.message || 'Too many failed attempts — your account is locked for a few minutes.';
    case 'RATE_LIMITED':
      return 'Too many sign-in attempts from this device. Wait a minute and try again.';
    default:
      return e.message;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading, refetch: refetchSession } = useSession();
  const next = useQueryParam('next');
  const reset = useQueryParam('reset');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(loginRequestSchema), defaultValues: { email: '', password: '' } });

  useEffect(() => {
    if (!isLoading && user && next.ready) router.replace(safeNext(next.value));
  }, [isLoading, user, next, router]);

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { ...data, email: data.email.trim().toLowerCase() } });
    } catch (e) {
      const message = loginErrorMessage(e);
      setFormError(message);
      toast.error('Sign-in failed', message);
      return;
    }
    toast.success('Signed in', 'Welcome back to MediCore');
    refetchSession();
    router.replace(safeNext(next.value));
  });

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your pharmacy workspace"
      footer={
        <>
          New to MediCore?{' '}
          <Link className={authLinkClass} href="/register">
            Start a free 14-day trial
          </Link>
        </>
      }
    >
      {reset.value === '1' ? (
        <p className="mc-anim-fade-in mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Password updated. Sign in with your new password — other devices were signed out.
        </p>
      ) : null}
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" autoFocus placeholder="you@pharmacy.in" {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <PasswordInput autoComplete="current-password" placeholder="••••••••••" {...register('password')} />
        </Field>
        <div className="-mt-2 text-right">
          <Link className={`text-xs ${authLinkClass}`} href="/forgot-password">
            Forgot password?
          </Link>
        </div>
        {formError ? (
          <p role="alert" className="mc-anim-shake rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
            {formError}
          </p>
        ) : null}
        <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-[11px] text-neutral-400">
          Got an invitation?{' '}
          <Link className={authLinkClass} href="/accept-invitation">
            Accept it here
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
