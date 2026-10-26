'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { Badge, Card, ErrorState, Spinner } from '@/components/ui';

interface Checklist {
  steps: Array<{ key: string; label: string; complete: boolean }>;
  allComplete: boolean;
  setupCompletedAt: string | null;
}

interface OrgProfile {
  id: string;
  name: string;
  gstRegistrationStatus: string;
  gstin: string | null;
  stateCode: string | null;
  subscription: { status: string; planName: string; trialEndsAt: string | null } | null;
}

export default function DashboardPage() {
  const membership = useCurrentMembership();
  const checklist = useQuery({
    queryKey: ['setup-checklist'],
    queryFn: () => api<Checklist>('/organizations/setup-checklist'),
    retry: false,
  });
  const org = useQuery({
    queryKey: ['org-profile'],
    queryFn: () => api<OrgProfile>('/organizations'),
    retry: false,
  });

  if (checklist.isLoading || org.isLoading) return <Spinner />;
  if (checklist.error) {
    const message =
      checklist.error instanceof ApiClientError && checklist.error.status === 403
        ? 'You do not have permission to view organization data.'
        : 'Failed to load dashboard data.';
    return <ErrorState message={message} retry={() => void checklist.refetch()} />;
  }
  if (org.error) {
    return <ErrorState message="Failed to load organization profile." retry={() => void org.refetch()} />;
  }

  const sub = org.data?.subscription;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{org.data?.name}</h1>
        <p className="text-sm text-neutral-500">
          {membership?.organizationName} · {sub ? `${sub.planName} plan (${sub.status})` : 'No subscription'}
        </p>
      </div>

      {checklist.data && !checklist.data.setupCompletedAt ? (
        <Card
          title="Setup checklist"
          actions={
            checklist.data.allComplete ? (
              <span className="text-xs text-green-700">Ready to complete setup</span>
            ) : undefined
          }
        >
          <ul className="space-y-1.5">
            {checklist.data.steps.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <Badge tone={s.complete ? 'green' : 'amber'}>{s.complete ? 'Done' : 'Pending'}</Badge>
                {s.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500">
            The organization cannot post real transactions until essential setup is complete. Configure
            business details under <Link className="text-brand-700 hover:underline" href="/settings">Settings</Link>{' '}
            and add a warehouse under <Link className="text-brand-700 hover:underline" href="/branches">Branches</Link>.
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card title="Subscription">
          {sub ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-neutral-500">Plan</dt><dd>{sub.planName}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-500">Status</dt><dd><Badge tone={sub.status === 'TRIALING' ? 'amber' : 'green'}>{sub.status}</Badge></dd></div>
              {sub.trialEndsAt ? (
                <div className="flex justify-between"><dt className="text-neutral-500">Trial ends</dt><dd>{new Date(sub.trialEndsAt).toLocaleDateString()}</dd></div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-neutral-500">No subscription configured.</p>
          )}
        </Card>

        <Card title="Business identity">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-neutral-500">GST registration</dt><dd>{org.data?.gstRegistrationStatus}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">GSTIN</dt><dd className="font-mono">{org.data?.gstin ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-neutral-500">State</dt><dd>{org.data?.stateCode ?? '—'}</dd></div>
          </dl>
        </Card>
      </div>

      <Card title="Coming in later phases">
        <p className="text-sm text-neutral-600">
          Product catalog, batch inventory, purchasing, POS billing, accounting and compliance registers
          are implemented in Phases 2–10. The foundation you are using (organizations, branches, users,
          roles, audit) is live and enforced server-side.
        </p>
      </Card>
    </div>
  );
}
