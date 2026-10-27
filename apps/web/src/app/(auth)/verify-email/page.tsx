'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiClientError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { AuthShell, AuthStatus, authLinkClass, useQueryParam } from '@/components/auth';
import { Button } from '@/components/ui';

type State = 'verifying' | 'verified' | 'invalid' | 'missing';

export default function VerifyEmailPage() {
  const { user, isLoading: sessionLoading, refetch } = useSession();
  const token = useQueryParam('token');
  const [state, setState] = useState<State>('verifying');
  const [resending, setResending] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!token.ready || attempted.current) return;
    attempted.current = true;
    if (!token.value) {
      setState('missing');
      return;
    }
    api('/auth/email/verify', { method: 'POST', body: { token: token.value } })
      .then(() => {
        setState('verified');
        toast.success('Email verified', 'Thanks — your address is confirmed.');
        refetch();
      })
      .catch((e: unknown) => {
        setState('invalid');
        if (!(e instanceof ApiClientError) || e.code !== 'VALIDATION_ERROR') toast.error('Couldn’t verify your email', e instanceof Error ? e.message : '');
      });
  }, [token, refetch]);

  const resend = async () => {
    setResending(true);
    try {
      await api('/auth/email/verify/resend', { method: 'POST' });
      toast.success('New link sent', user ? `Check ${user.email}.` : 'Check your inbox.');
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'STATE_TRANSITION_INVALID') {
        setState('verified');
        toast.info('Already verified', 'Your email address is already confirmed.');
        refetch();
      } else {
        toast.error('Couldn’t send a new link', e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      setResending(false);
    }
  };

  const continueHref = user ? '/' : '/login';

  return (
    <AuthShell title="Email verification" subtitle="Confirming the address on your MediCore account">
      {state === 'verifying' ? (
        <AuthStatus tone="blue" icon="loading" title="Verifying your email">
          <div className="mx-auto h-1.5 w-32 overflow-hidden rounded-full bg-neutral-100">
            <div className="mc-progress-stripes h-full w-full bg-brand-400" />
          </div>
        </AuthStatus>
      ) : state === 'verified' ? (
        <AuthStatus tone="green" icon="verified" title="Your email is verified">
          <p>Password resets, invitations and invoice copies will reach you here.</p>
          <Link href={continueHref} className="mt-1 inline-block rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700">
            {user ? 'Go to dashboard' : 'Sign in'}
          </Link>
        </AuthStatus>
      ) : (
        <AuthStatus tone="red" icon="danger" title={state === 'missing' ? 'No verification link found' : 'This link has expired or was already used'}>
          <p>{state === 'missing' ? 'Open the link from your verification email, or request a new one.' : 'Verification links last 24 hours and work once.'}</p>
          {sessionLoading ? null : user ? (
            <Button variant="secondary" disabled={resending} onClick={() => void resend()}>
              {resending ? 'Sending…' : 'Send a new link'}
            </Button>
          ) : (
            <p>
              <Link className={authLinkClass} href="/login?next=%2F">
                Sign in
              </Link>{' '}
              to request a new link.
            </p>
          )}
        </AuthStatus>
      )}
    </AuthShell>
  );
}
