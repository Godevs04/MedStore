'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@medicore/validation';
import { api, ApiClientError, storeTenant } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { AuthShell, AuthStatus, PasswordChecklist, PasswordInput, authLinkClass, useQueryParam } from '@/components/auth';
import { Button, Field, Input, Badge } from '@/components/ui';

interface Invitation {
  email: string;
  fullName: string;
  organizationName: string;
  roleName: string;
  expiresAt: string;
  accountExists: boolean;
}

const newAccountSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(120, 'Keep it under 120 characters'),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords don’t match' });
const existingAccountSchema = z.object({ fullName: z.string(), password: z.string().min(1, 'Enter your current MediCore password'), confirm: z.string() });
type Form = z.infer<typeof newAccountSchema>;

function extractToken(input: string): string {
  const trimmed = input.trim();
  try {
    return new URL(trimmed).searchParams.get('token') ?? trimmed;
  } catch {
    return trimmed;
  }
}

const fmtExpiry = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function TokenEntry({ onToken }: { onToken: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const token = extractToken(value);
        if (token.length < 32 || token.length > 128) {
          setError('Paste the full invitation link from your email');
          return;
        }
        onToken(token);
      }}
    >
      <Field label="Invitation link" error={error ?? undefined} hint="Open the invitation email and paste the link here">
        <Input autoFocus spellCheck={false} value={value} onChange={(e) => { setError(null); setValue(e.target.value); }} placeholder="https://…/accept-invitation?token=…" />
      </Field>
      <Button type="submit" className="w-full py-2">Continue</Button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  const router = useRouter();
  const { refetch: refetchSession } = useSession();
  const tokenParam = useQueryParam('token');
  const [token, setToken] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'invalid' | 'ready'>('idle');

  useEffect(() => {
    if (tokenParam.value) setToken(tokenParam.value);
  }, [tokenParam.value]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLookup('loading');
    api<Invitation>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then((inv) => {
        if (cancelled) return;
        setInvitation(inv);
        setLookup('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLookup('invalid');
        if (!(e instanceof ApiClientError) || e.code !== 'VALIDATION_ERROR') toast.error('Couldn’t check the invitation', e instanceof Error ? e.message : '');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const existing = invitation?.accountExists ?? false;
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(existing ? existingAccountSchema : newAccountSchema), defaultValues: { fullName: '', password: '', confirm: '' } });
  const password = watch('password');

  useEffect(() => {
    if (invitation) reset({ fullName: invitation.fullName, password: '', confirm: '' });
  }, [invitation, reset]);

  const onSubmit = handleSubmit(async (d) => {
    if (!token || !invitation) return;
    let joined: { organizationId: string };
    try {
      joined = await api<{ organizationId: string }>('/auth/invitations/accept', {
        method: 'POST',
        body: { token, password: d.password, fullName: existing ? invitation.fullName || 'Member' : d.fullName },
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'INVALID_CREDENTIALS') {
        setError('password', { message: 'That’s not your current password' });
        toast.error('Wrong password', 'Use the password you already sign in to MediCore with.');
      } else if (e instanceof ApiClientError && e.code === 'VALIDATION_ERROR' && /invalid|expired/i.test(e.message)) {
        setLookup('invalid');
        toast.error('Invitation expired', 'Ask your administrator to resend it.');
      } else {
        toast.error('Couldn’t accept the invitation', e instanceof ApiClientError ? e.message : 'Please try again.');
      }
      return;
    }
    try {
      await api('/auth/login', { method: 'POST', body: { email: invitation.email, password: d.password } });
      storeTenant({ organizationId: joined.organizationId, branchId: null });
      toast.success(`Welcome to ${invitation.organizationName}`, `You’ve joined as ${invitation.roleName}.`);
      refetchSession();
      router.replace('/');
    } catch {
      toast.success('Invitation accepted', 'Sign in to continue.');
      router.replace('/login');
    }
  });

  return (
    <AuthShell
      title={invitation ? `Join ${invitation.organizationName}` : 'Accept your invitation'}
      subtitle={invitation ? `You’ve been invited as ${invitation.roleName}` : 'Join your team’s pharmacy workspace on MediCore'}
      footer={
        <>
          Already a member?{' '}
          <Link className={authLinkClass} href="/login">
            Sign in
          </Link>
        </>
      }
    >
      {!tokenParam.ready || lookup === 'loading' ? (
        <div className="space-y-3" aria-busy="true" aria-label="Checking invitation">
          <div className="mc-skeleton h-4 w-2/3" />
          <div className="mc-skeleton h-9 w-full" />
          <div className="mc-skeleton h-9 w-full" />
        </div>
      ) : lookup === 'invalid' ? (
        <AuthStatus tone="red" icon="danger" title="This invitation is no longer valid">
          <p>It may have expired (invitations last 7 days), been revoked, or already been accepted.</p>
          <p>Ask your pharmacy administrator to resend it from Users → Resend invite.</p>
          <div className="flex justify-center gap-3 pt-1">
            <button type="button" className={authLinkClass} onClick={() => { setToken(null); setInvitation(null); setLookup('idle'); }}>
              Try another link
            </button>
            <Link className={authLinkClass} href="/login">Sign in</Link>
          </div>
        </AuthStatus>
      ) : !token || !invitation ? (
        <TokenEntry onToken={setToken} />
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="rounded-lg border border-line bg-subtle px-3 py-2.5 text-xs text-neutral-600">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-ink">{invitation.email}</span>
              <Badge tone="blue">{invitation.roleName}</Badge>
            </div>
            <p className="mt-0.5 text-2xs text-muted">Invitation valid until {fmtExpiry(invitation.expiresAt)}</p>
          </div>
          {existing ? (
            <>
              <p className="text-xs text-neutral-600">You already have a MediCore account. Confirm with your current password to add this workspace — your password won’t change.</p>
              <Field label="Current password" error={errors.password?.message}>
                <PasswordInput autoComplete="current-password" autoFocus {...register('password')} />
              </Field>
              <div className="-mt-2 text-right">
                <Link className={`text-xs ${authLinkClass}`} href={`/forgot-password?email=${encodeURIComponent(invitation.email)}`}>
                  Forgot password?
                </Link>
              </div>
            </>
          ) : (
            <>
              <Field label="Your name" error={errors.fullName?.message}>
                <Input autoComplete="name" {...register('fullName')} />
              </Field>
              <Field label="Create a password" error={errors.password?.message}>
                <PasswordInput autoComplete="new-password" autoFocus {...register('password')} />
                <PasswordChecklist value={password ?? ''} />
              </Field>
              <Field label="Confirm password" error={errors.confirm?.message}>
                <PasswordInput autoComplete="new-password" {...register('confirm')} />
              </Field>
            </>
          )}
          <Button type="submit" className="w-full py-2" disabled={isSubmitting}>
            {isSubmitting ? 'Joining…' : `Join ${invitation.organizationName}`}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
