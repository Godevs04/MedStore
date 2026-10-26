'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { loginRequestSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { API_URL, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Input } from '@/components/ui';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const { refetch: refetchSession } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginRequestSchema>>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
      setFormError(body?.error?.message ?? 'Sign-in failed');
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
          <p className="text-sm text-neutral-500">Pharmacy ERP platform</p>
        </div>
        <Card title="Sign in">
          <form className="space-y-3" onSubmit={onSubmit}>
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register('email')} />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <Input type="password" autoComplete="current-password" {...register('password')} />
            </Field>
            {formError ? <p className="text-xs text-red-600">{formError}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-center text-xs text-neutral-500">
              No account?{' '}
              <Link className="text-brand-700 hover:underline" href="/register">
                Create an organization
              </Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
