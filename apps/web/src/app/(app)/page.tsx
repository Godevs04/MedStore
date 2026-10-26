'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { Badge, Card, ErrorState, SkeletonRows, Spinner } from '@/components/ui';

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

const MODULE_ROADMAP = [
  { label: 'Purchasing', phase: 'Phase 4' },
  { label: 'POS billing', phase: 'Phase 5' },
  { label: 'Accounting', phase: 'Phase 7' },
  { label: 'GST & compliance registers', phase: 'Phase 8' },
];

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

  if (checklist.isLoading || org.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="mc-skeleton h-8 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="mc-skeleton h-28 rounded-xl" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <SkeletonRows rows={4} />
        </div>
      </div>
    );
  }
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
  const doneCount = checklist.data?.steps.filter((s) => s.complete).length ?? 0;
  const totalSteps = checklist.data?.steps.length ?? 1;
  const progressPct = Math.round((doneCount / totalSteps) * 100);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="mc-anim-fade-up">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">{org.data?.name}</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          {membership?.organizationName} ·{' '}
          {sub ? (
            <span>
              {sub.planName} plan ·{' '}
              <Badge tone={sub.status === 'TRIALING' ? 'amber' : 'green'} dot>
                {sub.status}
              </Badge>
            </span>
          ) : (
            'No subscription'
          )}
        </p>
      </div>

      {/* Stat cards */}
      <div className="mc-stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card delay={0}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">Plan</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
                {sub?.planName ?? '—'}
              </p>
              {sub?.trialEndsAt ? (
                <p className="mt-1 text-xs text-neutral-500">
                  Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
                </p>
              ) : null}
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-lg ring-1 ring-brand-100">
              ◈
            </div>
          </div>
        </Card>

        <Card delay={80}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">GST registration</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
                {org.data?.gstRegistrationStatus}
              </p>
              <p className="mt-1 font-mono text-xs text-neutral-500">{org.data?.gstin ?? 'GSTIN not set'}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-lg ring-1 ring-sky-100">
              ⛨
            </div>
          </div>
        </Card>

        <Card delay={160}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">Setup progress</p>
              <p className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
                {doneCount}/{totalSteps}
              </p>
              <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-700 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-lg ring-1 ring-amber-100">
              ◔
            </div>
          </div>
        </Card>
      </div>

      {/* Setup checklist */}
      {checklist.data && !checklist.data.setupCompletedAt ? (
        <Card title="Setup checklist" delay={220}>
          <div className="mc-stagger space-y-2.5">
            {checklist.data.steps.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50/50 px-3 py-2 transition-all duration-200 hover:border-brand-200 hover:bg-brand-50/40"
              >
                <span className="text-sm text-neutral-700">{s.label}</span>
                <Badge tone={s.complete ? 'green' : 'amber'} dot>
                  {s.complete ? 'Done' : 'Pending'}
                </Badge>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-neutral-500">
            The organization cannot post real transactions until essential setup is complete. Configure
            business details under{' '}
            <Link className="font-medium text-brand-700 hover:underline" href="/settings">
              Settings
            </Link>{' '}
            and add a warehouse under{' '}
            <Link className="font-medium text-brand-700 hover:underline" href="/branches">
              Branches
            </Link>
            .
          </p>
        </Card>
      ) : null}

      {/* Roadmap */}
      <Card title="Platform roadmap" delay={280}>
        <div className="mc-stagger grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {MODULE_ROADMAP.map((m) => (
            <div
              key={m.label}
              className="group rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-3 py-3 transition-all duration-200 hover:border-brand-300 hover:bg-brand-50/50"
            >
              <p className="text-sm font-medium text-neutral-700 transition-colors group-hover:text-brand-700">
                {m.label}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">{m.phase}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          The foundation you are using — organizations, branches, users, roles, master data and the
          batch-level inventory engine — is live and enforced server-side.
        </p>
      </Card>
    </div>
  );
}
