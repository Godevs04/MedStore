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
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-brand-700">MediCore</h1>
          <p className="text-sm text-neutral-500">Create your organization</p>
        </div>
        <Card title="Register">
          <form className="space-y-3" onSubmit={onSubmit}>
            <Field label="Your name" error={errors.fullName?.message}>
              <Input {...register('fullName')} />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register('email')} />
            </Field>
            <Field
              label="Password"
              error={errors.password?.message}
            >
              <Input type="password" autoComplete="new-password" {...register('password')} />
            </Field>
            <Field label="Organization name" error={errors.organizationName?.message}>
              <Input {...register('organizationName')} />
            </Field>
            {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create organization'}
            </Button>
            <p className="text-center text-xs text-neutral-500">
              Already have an account?{' '}
              <Link className="text-brand-700 hover:underline" href="/login">
                Sign in
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
