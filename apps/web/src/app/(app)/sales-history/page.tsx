'use client';

import { Icon } from '@/components/icons';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { toast } from '@/lib/toast';
import {
  AnimatedNumber,
  DateRangePicker,
  FilterChips,
  KpiGrid,
  Pagination,
  SearchInput,
  SortableTh,
  TableToolbar,
  useDebouncedValue,
  type DateRange,
  type PageInfo,
  type SortState,
} from '@/components/kit';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, Stat, StatusBadge, Table, Tabs, Td, Th, Tr, fmtDate, money, statusTone } from '@/components/ui';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: string;
  paidAmount: string;
  creditAmount: string;
  returnedAmount: string;
  status: string;
  customer: { name: string; phone: string | null } | null;
  walkInName: string | null;
  lines: Array<{ productName: string; quantity: string }>;
  payments: Array<{ method: string; amount: string }>;
}

interface ReturnRow {
  id: string;
  returnNumber: string;
  invoiceId: string;
  reason: string;
  refundTotal: string;
  creditAdjusted: string;
  refundMethod: string | null;
  createdAt: string;
  invoice: { invoiceNumber: string; customer: { name: string } | null; walkInName: string | null };
  lines: Array<{ quantity: string; restock: boolean }>;
}

interface Summary {
  invoices: number;
  cancelled: number;
  gross: string;
  creditOutstanding: string;
  returned: string;
  discount: string;
  averageBill: string;
}

type SortField = 'invoiceDate' | 'invoiceNumber' | 'total' | 'creditAmount';
type Status = 'POSTED' | 'PARTIALLY_RETURNED' | 'RETURNED' | 'CANCELLED';

const STATUS_LABEL: Record<string, string> = { POSTED: 'Posted', PARTIALLY_RETURNED: 'Part returned', RETURNED: 'Returned', CANCELLED: 'Cancelled' };
const PAGE_SIZE = 25;

export default function SalesHistoryPage() {
  const router = useRouter();
  const membership = useCurrentMembership();
  const can = (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
  const canReturns = can('returns.read');
  const canExport = can('reports.export');
  const [tab, setTab] = useState<'invoices' | 'returns'>('invoices');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [status, setStatus] = useState<Status | ''>('');
  const [method, setMethod] = useState('');
  const [creditOnly, setCreditOnly] = useState<'credit' | ''>('');
  const [sort, setSort] = useState<SortState<SortField>>({ field: 'invoiceDate', direction: 'desc' });
  const [page, setPage] = useState(1);

  const [rSearch, setRSearch] = useState('');
  const debouncedRSearch = useDebouncedValue(rSearch.trim(), 300);
  const [rRange, setRRange] = useState<DateRange>({ from: '', to: '' });
  const [rPage, setRPage] = useState(1);

  const rangeValid = !range.from || !range.to || range.from <= range.to;
  const filters = new URLSearchParams();
  if (debouncedSearch) filters.set('search', debouncedSearch);
  if (rangeValid && range.from) filters.set('from', range.from);
  if (rangeValid && range.to) filters.set('to', range.to);
  if (status) filters.set('status', status);
  if (method) filters.set('paymentMethod', method);
  if (creditOnly) filters.set('hasCredit', 'true');
  const listQs = new URLSearchParams(filters);
  listQs.set('page', String(page));
  listQs.set('pageSize', String(PAGE_SIZE));
  listQs.set('sortBy', sort.field);
  listQs.set('sortDirection', sort.direction);

  const invoices = useQuery({
    queryKey: ['sales-history', listQs.toString()],
    queryFn: () => api<{ items: InvoiceRow[]; pageInfo: PageInfo }>(`/sales/invoices?${listQs.toString()}`),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ['sales-history', 'summary', filters.toString()],
    queryFn: () => api<Summary>(`/sales/invoices/summary?${filters.toString()}`),
    placeholderData: (prev) => prev,
  });

  const rFilters = new URLSearchParams();
  if (debouncedRSearch) rFilters.set('search', debouncedRSearch);
  const rRangeValid = !rRange.from || !rRange.to || rRange.from <= rRange.to;
  if (rRangeValid && rRange.from) rFilters.set('from', rRange.from);
  if (rRangeValid && rRange.to) rFilters.set('to', rRange.to);
  const returns = useQuery({
    queryKey: ['sales-returns', rFilters.toString(), rPage],
    queryFn: () => api<{ items: ReturnRow[]; pageInfo: PageInfo }>(`/sales/returns?page=${rPage}&pageSize=${PAGE_SIZE}&${rFilters.toString()}`),
    enabled: canReturns,
    placeholderData: (prev) => prev,
    retry: false,
  });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const exportCsv = async (path: string, name: string) => {
    try {
      await downloadCsv(path, name);
      toast.success('Export ready', 'The CSV file has been downloaded.');
    } catch (e) {
      toast.error('Export failed', e instanceof ApiClientError ? e.message : 'Please try again.');
    }
  };

  const items = invoices.data?.items ?? [];
  const s = summary.data;
  const anyFilter = Boolean(debouncedSearch || range.from || range.to || status || method || creditOnly);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales & returns"
        subtitle="Every POS invoice with its tender split, credit and return status. Open one to print, collect a balance, return or cancel."
        actions={
          <Link href="/pos">
            <Button><Icon name="pos" size={15} /> New sale</Button>
          </Link>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'invoices', label: 'Invoices', count: invoices.data?.pageInfo.totalItems },
          ...(canReturns ? [{ id: 'returns' as const, label: 'Returns', count: returns.data?.pageInfo.totalItems }] : []),
        ]}
      />

      {tab === 'invoices' ? (
        <>
          <KpiGrid bare cols={4}>
            <Stat label="Invoices" value={s ? <AnimatedNumber value={s.invoices} /> : '…'} hint={s?.cancelled ? `${s.cancelled} cancelled (excluded)` : anyFilter ? 'matching filters' : 'all time'} />
            <Stat label="Gross sales" value={s ? <AnimatedNumber value={Number(s.gross)} format={(n) => money(n)} /> : '…'} hint={s ? `Avg bill ${money(s.averageBill)}` : undefined} />
            <Stat label="Credit open" value={s ? money(s.creditOutstanding) : '…'} hint="still to collect" tone={s && Number(s.creditOutstanding) > 0 ? 'amber' : 'neutral'} />
            <Stat label="Returned" value={s ? money(s.returned) : '…'} hint={s && Number(s.discount) ? `Discounts ${money(s.discount)}` : 'credit notes'} tone="neutral" />
          </KpiGrid>

          <div className="space-y-2">
            <TableToolbar
              actions={
                canExport ? (
                  <Button variant="secondary" onClick={() => void exportCsv(`/sales/invoices/export?${filters.toString()}`, 'sales-invoices.csv')}>
                    <Icon name="download" size={14} /> Export CSV
                  </Button>
                ) : null
              }
            >
                <SearchInput className="w-full sm:w-64" value={search} onChange={resetPage(setSearch)} placeholder="Invoice no., customer or mobile…" />
                <Select className="w-full sm:w-40" value={method} onChange={(e) => resetPage(setMethod)(e.target.value)} aria-label="Payment method">
                  <option value="">Any tender</option>
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                  <option value="BANK">Bank</option>
                  <option value="CREDIT">Credit</option>
                </Select>
                <FilterChips allLabel={null} value={creditOnly} onChange={resetPage(setCreditOnly)} options={[{ id: 'credit', label: 'Credit due', tone: 'amber' }]} />
            </TableToolbar>
              <DateRangePicker value={range} onChange={resetPage(setRange)} />
              <FilterChips
                value={status}
                onChange={resetPage(setStatus)}
                allLabel="All statuses"
                options={(['POSTED', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED'] as const).map((id) => ({ id, label: STATUS_LABEL[id]!, tone: statusTone(id) }))}
              />
          </div>

          <Card>
            {invoices.isLoading ? (
              <SkeletonRows rows={6} cols={6} />
            ) : invoices.error ? (
              <ErrorState
                message={invoices.error instanceof ApiClientError && invoices.error.status === 403 ? 'You do not have permission to view sales.' : 'Failed to load invoices.'}
                retry={() => void invoices.refetch()}
              />
            ) : items.length === 0 ? (
              <EmptyState
                title={anyFilter ? 'No invoices match these filters' : 'No invoices yet'}
                hint={anyFilter ? 'Try a wider date range or clear the filters.' : 'Posted POS invoices appear here with payment split and status.'}
                action={!anyFilter ? <Link href="/pos"><Button>Start billing</Button></Link> : undefined}
              />
            ) : (
              <>
                <Table
                  head={
                    <tr>
                      <SortableTh label="Invoice" field="invoiceNumber" sort={sort} onSort={resetPage(setSort)} />
                      <SortableTh label="Date" field="invoiceDate" sort={sort} onSort={resetPage(setSort)} />
                      <Th>Customer</Th>
                      <Th>Items</Th>
                      <Th>Tender</Th>
                      <Th>Status</Th>
                      <SortableTh label="Credit" field="creditAmount" sort={sort} onSort={resetPage(setSort)} right />
                      <SortableTh label="Total" field="total" sort={sort} onSort={resetPage(setSort)} right />
                    </tr>
                  }
                >
                  {items.map((i) => (
                    <Tr key={i.id} onClick={() => router.push(`/sales-history/${i.id}`)} className={i.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                      <Td className="font-mono text-xs font-semibold text-teal-ink">{i.invoiceNumber}</Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(i.invoiceDate)}</Td>
                      <Td className="text-sm">
                        <div>{i.customer?.name ?? i.walkInName ?? 'Walk-in'}</div>
                        {i.customer?.phone ? <div className="text-2xs text-faint">{i.customer.phone}</div> : null}
                      </Td>
                      <Td className="max-w-[200px] truncate text-xs text-neutral-600">{i.lines.map((l) => `${l.productName} ×${Number(l.quantity)}`).join(', ')}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {i.payments.map((p, idx) => (
                            <Badge key={idx} tone={p.method === 'CREDIT' ? 'amber' : 'neutral'}>
                              {p.method} {money(p.amount)}
                            </Badge>
                          ))}
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={i.status} label={STATUS_LABEL[i.status]} />
                      </Td>
                      <Td right className={Number(i.creditAmount) > 0 ? 'font-medium text-warning' : 'text-faint'}>
                        {Number(i.creditAmount) > 0 ? money(i.creditAmount) : '—'}
                      </Td>
                      <Td right className={i.status === 'CANCELLED' ? 'font-semibold line-through' : 'font-semibold'}>{money(i.total)}</Td>
                    </Tr>
                  ))}
                </Table>
                <Pagination info={invoices.data?.pageInfo} onChange={setPage} label="invoices" />
              </>
            )}
          </Card>
        </>
      ) : (
        <>
          <TableToolbar
            actions={
              canExport ? (
                <Button variant="secondary" onClick={() => void exportCsv(`/sales/returns/export?${rFilters.toString()}`, 'sales-returns.csv')}>
                  <Icon name="download" size={14} /> Export CSV
                </Button>
              ) : null
            }
          >
              <SearchInput
                className="w-full sm:w-64"
                value={rSearch}
                onChange={(v) => {
                  setRSearch(v);
                  setRPage(1);
                }}
                placeholder="Return no., invoice, customer, reason…"
              />
              <DateRangePicker
                value={rRange}
                onChange={(r) => {
                  setRRange(r);
                  setRPage(1);
                }}
              />
          </TableToolbar>
          <Card title="Sales returns (credit notes)">
            {returns.isLoading ? (
              <SkeletonRows rows={4} cols={6} />
            ) : returns.error ? (
              <ErrorState message="Failed to load returns." retry={() => void returns.refetch()} />
            ) : (returns.data?.items.length ?? 0) === 0 ? (
              <EmptyState title={rFilters.toString() ? 'No returns match' : 'No returns yet'} hint="Open an invoice and choose Return items to issue a credit note." />
            ) : (
              <>
                <Table head={<tr><Th>Return</Th><Th>Against</Th><Th>Reason</Th><Th>Settlement</Th><Th>Restocked</Th><Th right>Value</Th></tr>}>
                  {returns.data?.items.map((r) => {
                    const refunded = Number(r.refundTotal) - Number(r.creditAdjusted);
                    return (
                      <Tr key={r.id} onClick={() => router.push(`/sales-history/${r.invoiceId}`)}>
                        <Td>
                          <div className="font-mono text-xs font-semibold text-ink">{r.returnNumber}</div>
                          <div className="text-xs text-muted">{fmtDate(r.createdAt)}</div>
                        </Td>
                        <Td>
                          <div className="font-mono text-xs text-teal-ink">{r.invoice.invoiceNumber}</div>
                          <div className="text-xs text-muted">{r.invoice.customer?.name ?? r.invoice.walkInName ?? 'Walk-in'}</div>
                        </Td>
                        <Td className="max-w-[200px] truncate text-xs text-neutral-600">{r.reason}</Td>
                        <Td className="text-xs">
                          {Number(r.creditAdjusted) > 0 ? <div>Credit adjusted {money(r.creditAdjusted)}</div> : null}
                          {refunded > 0 ? <div>Refund {r.refundMethod ?? 'CASH'} {money(refunded)}</div> : null}
                        </Td>
                        <Td>
                          <Badge tone={r.lines.some((l) => l.restock) ? 'green' : 'neutral'}>{r.lines.some((l) => l.restock) ? 'Yes' : 'Damaged / no'}</Badge>
                        </Td>
                        <Td right className="font-semibold">{money(r.refundTotal)}</Td>
                      </Tr>
                    );
                  })}
                </Table>
                <Pagination info={returns.data?.pageInfo} onChange={setRPage} label="returns" />
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
