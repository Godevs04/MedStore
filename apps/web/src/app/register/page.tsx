'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { registerOrganizationRequestSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { API_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Input } from '@/components/ui';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const { refetch: refetchSession } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof registerOrganizationRequestSchema>>({
    resolver: zodResolver(registerOrganizationRequestSchema),
    defaultValues: { email: '', password: '', fullName: '', organizationName: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    const res = await fetch(`${API_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setFormError(body?.error?.message ?? 'Registration failed');
      return;
    }
    // Reload the session context before navigating so RequireAuth sees the user.
    await refetchSession();
    router.replace('/');
  });

  return (
    <div className="mc-auth-backdrop flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5">
        <div className="mc-anim-fade-up text-center">
          <div className="mc-anim-float mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-xl font-bold text-white shadow-xl shadow-brand-600/30">
            M
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-tight">
            <span className="mc-gradient-text">Create your pharmacy workspace</span>
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Free 14-day trial · full features · no card required
          </p>
        </div>
        <Card className="mc-stagger">
          <form className="grid grid-cols-1 gap-4 p-1 sm:grid-cols-2" onSubmit={onSubmit}>
            <div className="sm:col-span-2">
              <Field label="Organization name" error={errors.organizationName?.message}>
                <Input placeholder="e.g. City Care Pharmacy" {...register('organizationName')} />
              </Field>
            </div>
            <Field label="Your name" error={errors.fullName?.message}>
              <Input placeholder="Full name" {...register('fullName')} />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" autoComplete="email" placeholder="you@pharmacy.in" {...register('email')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Password" error={errors.password?.message}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Min 10 chars, mixed case + digit"
                  {...register('password')}
                />
              </Field>
            </div>
            {formError ? (
              <div className="sm:col-span-2">
                <p className="mc-anim-scale-in rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {formError}
                </p>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
                {isSubmitting ? 'Creating organization…' : 'Create organization'}
              </Button>
              <p className="mt-3 text-center text-xs text-neutral-500">
                Already have an account?{' '}
                <Link className="font-medium text-brand-700 transition-colors hover:text-brand-500 hover:underline" href="/login">
                  Sign in
                </Link>
              </p>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
