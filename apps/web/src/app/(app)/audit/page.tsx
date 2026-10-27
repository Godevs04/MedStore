'use client';

import { Icon } from '@/components/icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { DateRangePicker, Pagination, SearchInput, datePresets, useDebouncedValue, type DateRange, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, Stat, Table, cn } from '@/components/ui';

interface AuditRow {
  id: string;
  event: string;
  actorUserId: string | null;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
interface FilterOptions {
  events: string[];
  entityTypes: string[];
  actors: Array<{ userId: string; email: string | null }>;
}

type Category = 'security' | 'danger' | 'create' | 'change' | 'export' | 'other';
const CATEGORY_TONE: Record<Category, 'red' | 'amber' | 'green' | 'blue' | 'neutral'> = {
  security: 'blue',
  danger: 'red',
  create: 'green',
  change: 'amber',
  export: 'neutral',
  other: 'neutral',
};
const CATEGORY_LABEL: Record<Category, string> = {
  security: 'Sign-in & access',
  danger: 'Failures & removals',
  create: 'Created',
  change: 'Changed',
  export: 'Exports',
  other: 'Other',
};

function categoryOf(event: string): Category {
  if (/FAIL|DENIED|LOCKED|DELETED|REVOKED|VOID|CANCEL|SUSPEND|REMOVED/.test(event)) return 'danger';
  if (/LOGIN|LOGOUT|PASSWORD|SESSION|MFA|INVIT|VERIF|TOKEN/.test(event)) return 'security';
  if (/EXPORT|DOWNLOAD|PRINT/.test(event)) return 'export';
  if (/CREATED|ADDED|REGISTERED|ISSUED|FINALI[SZ]ED|RECEIVED|POSTED/.test(event)) return 'create';
  if (/UPDATED|CHANGED|ASSIGNED|ADJUST|TRANSFER|SET|RENAMED|ACTIVATED/.test(event)) return 'change';
  return 'other';
}

const ACRONYMS = new Set(['GST', 'GSTIN', 'GSTR', 'PAN', 'MFA', 'API', 'CSV', 'UPI', 'POS', 'PO', 'GRN', 'FY', 'IP']);
function eventLabel(event: string): string {
  return event
    .split('_')
    .map((w, i) => (ACRONYMS.has(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}
const entityLabel = (t: string) => t.replace(/([a-z])([A-Z])/g, '$1 $2');

function browserOf(ua: string | null): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'API client' : 'Other';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function AuditPage() {
  const can = useCan();
  const presets = useMemo(() => datePresets(), []);
  const [range, setRange] = useState<DateRange>(presets.find((p) => p.id === '30d')?.range ?? { from: '', to: '' });
  const [event, setEvent] = useState('');
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const debounced = useDebouncedValue(search.trim(), 300);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (event) p.set('event', event);
    if (actor) p.set('actorUserId', actor);
    if (entityType) p.set('entityType', entityType);
    if (debounced) p.set('search', debounced);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    return p;
  }, [event, actor, entityType, debounced, range]);
  const rangeInvalid = Boolean(range.from && range.to && range.from > range.to);

  useEffect(() => setPage(1), [params]);

  const filters = useQuery({ queryKey: ['audit-filters'], queryFn: () => api<FilterOptions>('/audit/filters') });
  const audit = useQuery({
    queryKey: ['audit', params.toString(), page],
    queryFn: () => api<{ items: AuditRow[]; pageInfo: PageInfo }>(`/audit?${params.toString()}&page=${page}&pageSize=25`),
    enabled: !rangeInvalid,
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => audit.data?.items ?? [], [audit.data]);
  const summary = useMemo(() => {
    const counts: Record<Category, number> = { security: 0, danger: 0, create: 0, change: 0, export: 0, other: 0 };
    for (const r of items) counts[categoryOf(r.event)] += 1;
    return { counts, actors: new Set(items.map((r) => r.actorUserId ?? 'system')).size };
  }, [items]);
  const activeFilters = [event, actor, entityType, debounced].filter(Boolean).length;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(`/audit/export?${params.toString()}`, `audit-log-${range.from || 'all'}-${range.to || 'today'}.csv`);
      toast.success('Audit log exported', 'The CSV has been downloaded and the export itself was logged');
    } catch (e) {
      toast.error('Export failed', e instanceof ApiClientError ? e.message : 'Try again');
    } finally {
      setExporting(false);
    }
  };
  const reset = () => {
    setEvent('');
    setActor('');
    setEntityType('');
    setSearch('');
  };

  if (audit.error && !audit.data) {
    const forbidden = audit.error instanceof ApiClientError && audit.error.status === 403;
    return <ErrorState message={forbidden ? 'You do not have permission to view the audit log (requires audit.read).' : 'Failed to load the audit log.'} retry={() => void audit.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every sensitive action in this organisation — kept for statutory and DPDP Act accountability."
        actions={
          can('reports.export') ? (
            <Button variant="secondary" disabled={exporting || rangeInvalid || !audit.data?.pageInfo.totalItems} onClick={() => void exportCsv()}>
              <Icon name={exporting ? 'loading' : 'download'} size={14} className={exporting ? 'animate-spin' : undefined} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Events in range" value={(audit.data?.pageInfo.totalItems ?? 0).toLocaleString('en-IN')} tone="blue" />
        <Stat label="Sign-in & access (this page)" value={summary.counts.security} delay={60} />
        <Stat label="Failures & removals (this page)" value={summary.counts.danger} tone={summary.counts.danger ? 'amber' : 'green'} delay={120} />
        <Stat label="Distinct actors (this page)" value={summary.actors} delay={180} />
      </div>

      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} />
            <SearchInput value={search} onChange={setSearch} placeholder="Search event, email, record id…" className="min-w-[220px] flex-1" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
              <option value="">All events</option>
              {(filters.data?.events ?? []).map((ev) => (
                <option key={ev} value={ev}>{eventLabel(ev)}</option>
              ))}
            </Select>
            <Select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor">
              <option value="">All people</option>
              {(filters.data?.actors ?? []).map((a) => (
                <option key={a.userId} value={a.userId}>{a.email ?? a.userId.slice(0, 8)}</option>
              ))}
            </Select>
            <Select value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Record type">
              <option value="">All record types</option>
              {(filters.data?.entityTypes ?? []).map((t) => (
                <option key={t} value={t}>{entityLabel(t)}</option>
              ))}
            </Select>
          </div>
          {activeFilters ? (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span>{activeFilters} filter{activeFilters === 1 ? '' : 's'} applied</span>
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={reset}>Clear</button>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        {rangeInvalid ? (
          <EmptyState title="Check the dates" hint="The start date must be on or before the end date." />
        ) : audit.isLoading ? (
          <SkeletonRows rows={8} cols={4} />
        ) : items.length === 0 ? (
          <EmptyState title="No matching events" hint={activeFilters ? 'Try clearing a filter or widening the date range.' : 'Nothing has been recorded in this period.'} />
        ) : (
          <div className={cn('transition-opacity', audit.isFetching && 'opacity-60')}>
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Record</th>
                  <th className="px-3 py-2">From</th>
                </tr>
              }
            >
              {items.map((row) => {
                const cat = categoryOf(row.event);
                return (
                  <tr key={row.id} className="cursor-pointer transition-colors hover:bg-brand-50/40" onClick={() => setSelected(row)}>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-neutral-500">{fmtWhen(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={CATEGORY_TONE[cat]} dot>{eventLabel(row.event)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-700">{row.actorEmail ?? <span className="text-neutral-400">system</span>}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {row.entityType ? (
                        <>
                          {entityLabel(row.entityType)} <span className="font-mono text-neutral-400">{row.entityId?.slice(0, 8) ?? ''}</span>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{row.ipAddress ?? '—'}</td>
                  </tr>
                );
              })}
            </Table>
            <div className="mt-3">
              <Pagination info={audit.data?.pageInfo} onChange={setPage} label="events" />
            </div>
          </div>
        )}
      </Card>

      <Drawer open={selected !== null} onClose={() => setSelected(null)} title={selected ? eventLabel(selected.event) : ''}>
        {selected ? <AuditDetail row={selected} onFilterEntity={(t, id) => { setEntityType(t); setSearch(id); setSelected(null); }} /> : null}
      </Drawer>
    </div>
  );
}

function AuditDetail({ row, onFilterEntity }: { row: AuditRow; onFilterEntity: (type: string, id: string) => void }) {
  const cat = categoryOf(row.event);
  const details = row.details && typeof row.details === 'object' ? (row.details as Record<string, unknown>) : null;
  const copy = (text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Could not copy', 'Your browser blocked clipboard access'));
  };
  const facts: Array<[string, React.ReactNode]> = [
    ['When', fmtWhen(row.createdAt)],
    ['Category', <Badge key="c" tone={CATEGORY_TONE[cat]}>{CATEGORY_LABEL[cat]}</Badge>],
    ['Event code', <span key="e" className="font-mono text-xs">{row.event}</span>],
    ['By', row.actorEmail ?? 'system'],
    ['Record', row.entityType ? `${entityLabel(row.entityType)}${row.entityId ? ` · ${row.entityId}` : ''}` : '—'],
    ['IP address', row.ipAddress ?? '—'],
    ['Device', browserOf(row.userAgent)],
  ];
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
            <dt className="shrink-0 text-neutral-500">{k}</dt>
            <dd className="break-all text-right text-neutral-800">{v}</dd>
          </div>
        ))}
      </dl>
      {row.userAgent ? <p className="break-all rounded-lg bg-neutral-50 px-3 py-2 font-mono text-[11px] text-neutral-500">{row.userAgent}</p> : null}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Details</p>
          {details ? <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => copy(JSON.stringify(details, null, 2))}>Copy JSON</button> : null}
        </div>
        {details && Object.keys(details).length ? (
          <pre className="max-h-80 overflow-auto rounded-xl bg-neutral-900 p-3 text-[11px] leading-relaxed text-emerald-200">{JSON.stringify(details, null, 2)}</pre>
        ) : (
          <p className="text-sm text-neutral-500">No additional details were recorded.</p>
        )}
        <p className="mt-2 text-[11px] text-neutral-400">Details are redacted at write time — passwords, tokens and patient health data are never stored.</p>
      </div>
      {row.entityType && row.entityId ? (
        <Button variant="secondary" className="w-full" onClick={() => onFilterEntity(row.entityType as string, row.entityId as string)}>
          Show all events for this record
        </Button>
      ) : null}
    </div>
  );
}
