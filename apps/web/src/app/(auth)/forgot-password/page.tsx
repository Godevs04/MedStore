'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { API_URL } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

const schema = z.object({ email: z.string().email() });
type Form = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (d) => {
    setError(null);
    const res = await fetch(`${API_URL}/api/v1/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? 'Request failed');
      return;
    }
    setSent(true);
  });

  return (
    <div className="mc-auth-backdrop flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="mc-anim-fade-up text-center">
          <div className="mc-anim-float mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-lg shadow-brand-600/30">
            M
          </div>
          <h1 className="mt-2 text-lg font-bold tracking-tight text-neutral-800">Reset your password</h1>
        </div>
        <Card className="mc-anim-fade-up" delay={100}>
          {sent ? (
            <div className="space-y-3 py-2 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg">✉️</div>
              <p className="text-sm font-medium text-neutral-700">Check your inbox</p>
              <p className="text-xs leading-relaxed text-neutral-500">
                If an account exists for that email, a single-use reset link is on its way. The link expires
                in one hour.
              </p>
              <Link className="inline-block text-xs font-medium text-brand-700 hover:underline" href="/login">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <Field label="Email" error={errors.email?.message}>
                <Input type="email" autoComplete="email" {...register('email')} />
              </Field>
              {error ? <p className="text-xs text-red-600">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </Button>
              <p className="text-center text-xs text-neutral-500">
                <Link className="font-medium text-brand-700 hover:underline" href="/login">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </Card>
        <p className="text-center text-[10px] text-neutral-400">
          Development note: the console email transport logs the reset token server-side; no SMTP delivery yet.
        </p>
      </div>
    </div>
  );
}
