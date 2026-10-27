'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { AuthShell, AuthStatus, PasswordChecklist, PasswordInput, authLinkClass, useQueryParam } from '@/components/auth';
import { Icon } from '@/components/icons';
import { Button, Field, Input, Alert } from '@/components/ui';

const schema = z
  .object({
    token: z.string().trim().min(32, 'Paste the full link or code from the email').max(600, 'That doesn’t look like a reset link — paste it again'),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match' });
type Form = z.infer<typeof schema>;

/** Accepts either the raw token or the full emailed link. */
function extractToken(input: string): string {
  const trimmed = input.trim();
  try {
    return new URL(trimmed).searchParams.get('token') ?? trimmed;
  } catch {
    return trimmed;
  }
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const tokenParam = useQueryParam('token');
  const [expired, setExpired] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { token: '', password: '', confirm: '' } });
  const password = watch('password');
  const fromLink = Boolean(tokenParam.value);

  useEffect(() => {
    if (tokenParam.value) setValue('token', tokenParam.value);
  }, [tokenParam.value, setValue]);

  const onSubmit = handleSubmit(async (d) => {
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token: extractToken(d.token), password: d.password } });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'VALIDATION_ERROR' && /invalid|expired/i.test(e.message)) {
        setExpired(true);
        toast.error('Reset link expired', 'Request a new link to continue.');
        return;
      }
      toast.error('Password not updated', e instanceof ApiClientError ? e.message : 'Please try again.');
      return;
    }
    toast.success('Password updated', 'Sign in with your new password.');
    router.replace('/login?reset=1');
  });

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a password you haven’t used for MediCore before. Every signed-in device will be signed out."
      footer={
        <Link className={authLinkClass} href="/login">
          <span className="inline-flex items-center gap-1">
            <Icon name="arrowLeft" size={13} /> Back to sign in
          </span>
        </Link>
      }
    >
      {!tokenParam.ready ? (
        <div className="space-y-3" aria-busy="true">
          <div className="mc-skeleton h-9 w-full" />
          <div className="mc-skeleton h-9 w-full" />
        </div>
      ) : expired ? (
        <AuthStatus tone="red" icon="danger" title="This reset link has expired or was already used">
          <p>Reset links work once and last one hour. Request a fresh one — it only takes a moment.</p>
          <Link className={`inline-block pt-1 ${authLinkClass}`} href="/forgot-password">
            Send me a new link
          </Link>
        </AuthStatus>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {fromLink ? (
            <Alert tone="info">Reset link detected — just choose your new password.</Alert>
          ) : (
            <Field label="Reset link or code" error={errors.token?.message} hint="Paste the link from the reset email">
              <Input autoComplete="off" spellCheck={false} {...register('token')} />
            </Field>
          )}
          <Field label="New password" error={errors.password?.message}>
            <PasswordInput autoComplete="new-password" autoFocus={fromLink} {...register('password')} />
            <PasswordChecklist value={password ?? ''} />
          </Field>
          <Field label="Confirm new password" error={errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...register('confirm')} />
          </Field>
          <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
            {isSubmitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
