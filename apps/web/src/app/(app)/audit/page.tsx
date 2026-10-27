'use client';

import { useQuery } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import { Badge, Card, ErrorState, Spinner, Table, PageHeader } from '@/components/ui';

interface AuditRow {
  id: string;
  event: string;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const audit = useQuery({
    queryKey: ['audit', 1],
    queryFn: () => api<{ items: AuditRow[] }>('/audit?page=1&pageSize=50'),
    retry: false,
  });

  if (audit.isLoading) return <Spinner />;
  if (audit.error) {
    const message =
      audit.error instanceof ApiClientError && audit.error.status === 403
        ? 'You do not have permission to view the audit log (requires audit.read).'
        : 'Failed to load audit log.';
    return <ErrorState message={message} retry={() => void audit.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Audit log" subtitle="Append-only record of every sensitive action in this organization." />
      <Card title={`Recent events (${audit.data?.items.length ?? 0})`}>
        {audit.data?.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">No audit events yet.</p>
        ) : (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Entity</th>
              </tr>
            }
          >
            {audit.data?.items.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-neutral-500">
                  {new Date(row.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={row.event.includes('FAILURE') ? 'red' : row.event.includes('SUCCESS') ? 'green' : 'neutral'}>
                    {row.event}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-600">{row.actorEmail ?? 'system'}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {row.entityType ? `${row.entityType} · ${row.entityId?.slice(0, 8) ?? ''}` : '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
