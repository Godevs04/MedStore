'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@medicore/validation';
import { API_URL } from '@/lib/api';
import { Button, Card, Field, Input } from '@/components/ui';

const schema = z.object({
  token: z.string().min(10),
  fullName: z.string().min(2).max(120),
  password: passwordSchema,
});
type Form = z.infer<typeof schema>;

export default function AcceptInvitationPage() {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { token: '', fullName: '', password: '' },
  });

  const onSubmit = handleSubmit(async (d) => {
    setError(null);
    const res = await fetch(`${API_URL}/api/v1/auth/invitations/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? 'Invitation acceptance failed');
      return;
    }
    setDone(true);
    setTimeout(() => router.replace('/login'), 2200);
  });

  return (
    <div className="mc-auth-backdrop flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="mc-anim-fade-up text-center">
          <div className="mc-anim-float mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-lg shadow-brand-600/30">
            M
          </div>
          <h1 className="mt-2 text-lg font-bold tracking-tight text-neutral-800">Join your team</h1>
          <p className="text-sm text-neutral-500">Accept your MediCore invitation</p>
        </div>
        <Card className="mc-anim-fade-up" delay={100}>
          {done ? (
            <div className="space-y-2 py-2 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg">🎉</div>
              <p className="text-sm font-medium text-neutral-700">You&apos;re in!</p>
              <p className="text-xs text-neutral-500">Sign in with your new password. Redirecting…</p>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={onSubmit}>
              <Field label="Invitation token" error={errors.token?.message}>
                <Input placeholder="Paste the token from the invite email" {...register('token')} />
              </Field>
              <Field label="Your name" error={errors.fullName?.message}>
                <Input {...register('fullName')} />
              </Field>
              <Field label="Choose a password" error={errors.password?.message}>
                <Input type="password" autoComplete="new-password" {...register('password')} />
              </Field>
              {error ? (
                <p className="mc-anim-scale-in rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Accepting…' : 'Accept invitation'}
              </Button>
              <p className="text-center text-xs text-neutral-500">
                Already active?{' '}
                <Link className="font-medium text-brand-700 hover:underline" href="/login">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
