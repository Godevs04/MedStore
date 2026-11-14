'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { forgotPasswordRequestSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { AuthShell, AuthStatus, authLinkClass, useQueryParam } from '@/components/auth';
import { Icon } from '@/components/icons';
import { Button, Field, Input, Alert } from '@/components/ui';

type Form = z.infer<typeof forgotPasswordRequestSchema>;
const COOLDOWN_SECONDS = 60;

export default function ForgotPasswordPage() {
  const prefill = useQueryParam('email');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(forgotPasswordRequestSchema), defaultValues: { email: '' } });

  useEffect(() => {
    if (prefill.value) setValue('email', prefill.value);
  }, [prefill.value, setValue]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (email: string) => {
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email: email.trim().toLowerCase() } });
    } catch (e) {
      toast.error('Couldn’t send the reset link', e instanceof ApiClientError ? e.message : 'Please try again.');
      return false;
    }
    setSentTo(email.trim().toLowerCase());
    setCooldown(COOLDOWN_SECONDS);
    return true;
  };

  const onSubmit = handleSubmit(async (d) => {
    if (await send(d.email)) toast.success('Check your inbox', 'If an account exists, a reset link is on its way.');
  });

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We’ll email you a single-use link that’s valid for one hour."
      footer={
        <Link className={authLinkClass} href="/login">
          <span className="inline-flex items-center gap-1">
            <Icon name="arrowLeft" size={13} /> Back to sign in
          </span>
        </Link>
      }
    >
      {sentTo ? (
        <AuthStatus tone="blue" icon="mail" title="Check your inbox">
          <p>
            If an account exists for <span className="font-medium text-neutral-700">{sentTo}</span>, a reset link is on its way. It expires in one hour and works once.
          </p>
          <p>Didn’t get it? Check spam, or make sure you used the email you sign in with.</p>
          {process.env.NODE_ENV !== 'production' ? (
            <Alert tone="warning">Development: email uses the console transport — the reset link is printed in the API log, not delivered.</Alert>
          ) : null}
          <div className="flex justify-center gap-2 pt-1">
            <Button variant="secondary" disabled={cooldown > 0} onClick={() => void send(getValues('email')).then((ok) => ok && toast.info('Reset link sent again'))}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
            </Button>
            <Button variant="ghost" onClick={() => setSentTo(null)}>
              Use another email
            </Button>
          </div>
        </AuthStatus>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field label="Email" error={errors.email?.message}>
            <Input type="email" inputMode="email" autoComplete="email" autoFocus placeholder="you@pharmacy.in" {...register('email')} />
          </Field>
          <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
          <p className="text-center text-2xs leading-relaxed text-faint">
            For your security we never say whether an email is registered.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
