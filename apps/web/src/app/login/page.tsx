'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { loginRequestSchema } from '@medicore/validation';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { API_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Input } from '@/components/ui';
import Link from 'next/link';

function AuthAside() {
  return (
    <div className="mc-auth-backdrop relative hidden flex-1 flex-col justify-between overflow-hidden p-12 lg:flex">
      <div className="mc-anim-fade-up">
        <div className="flex items-center gap-3">
          <div className="mc-anim-float flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-lg shadow-brand-600/30">
            M
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight">
              <span className="mc-gradient-text">MediCore</span>
            </div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-400">
              Pharmacy ERP Platform
            </div>
          </div>
        </div>
      </div>
      <div className="mc-anim-fade-up space-y-6" style={{ animationDelay: '120ms' }}>
        <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight text-neutral-800">
          Batch-level inventory.
          <br />
          <span className="mc-gradient-text">GST-ready billing.</span>
          <br />
          Compliance built in.
        </h2>
        <ul className="space-y-3 text-sm text-neutral-600">
          {[
            'FEFO allocation with expired-stock blocking (Drugs Rules 65(17))',
            'Versioned tax configuration — never hardcoded rates',
            'Server-enforced tenant isolation and audit trails',
          ].map((line, i) => (
            <li
              key={line}
              className="mc-anim-fade-up flex items-start gap-2.5"
              style={{ animationDelay: `${250 + i * 90}ms` }}
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-brand-400 to-brand-600" />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-neutral-400">
        Built for Indian pharmacies — INR, GSTIN, Schedule H1 registers, Asia/Kolkata.
      </p>
    </div>
  );
}

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
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setFormError(body?.error?.message ?? 'Sign-in failed');
      return;
    }
    // Reload the session context before navigating so RequireAuth sees the user.
    await refetchSession();
    router.replace('/');
  });

  return (
    <div className="flex min-h-screen">
      <AuthAside />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5">
          <div className="mc-anim-fade-up text-center lg:hidden">
            <div className="mc-anim-float mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-lg shadow-brand-600/30">
              M
            </div>
            <h1 className="mt-2 text-lg font-bold">
              <span className="mc-gradient-text">MediCore</span>
            </h1>
          </div>
          <Card className="p-1">
            <div className="px-5 pb-5 pt-4">
              <h2 className="text-base font-semibold tracking-tight text-neutral-800">Welcome back</h2>
              <p className="mt-0.5 text-xs text-neutral-500">Sign in to your pharmacy workspace</p>
              <form className="mt-5 space-y-4" onSubmit={onSubmit}>
                <Field label="Email" error={errors.email?.message}>
                  <Input type="email" autoComplete="email" placeholder="you@pharmacy.in" {...register('email')} />
                </Field>
                <Field label="Password" error={errors.password?.message}>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••••"
                    {...register('password')}
                  />
                </Field>
                {formError ? (
                  <p className="mc-anim-scale-in rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                    {formError}
                  </p>
                ) : null}
                <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </Button>
                <p className="text-center text-xs text-neutral-500">
                  No account?{' '}
                  <Link className="font-medium text-brand-700 transition-colors hover:text-brand-500 hover:underline" href="/register">
                    Create an organization
                  </Link>
                </p>
              </form>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
