'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, SkeletonRows, Table, Tabs, Td, Th, Tr, fmtDate, money } from '@/components/ui';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: string;
  paidAmount: string;
  creditAmount: string;
  returnedAmount: string;
  status: string;
  customer: { name: string } | null;
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

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  POSTED: 'green',
  PARTIALLY_RETURNED: 'amber',
  RETURNED: 'red',
  CANCELLED: 'neutral',
};

export default function SalesHistoryPage() {
  const router = useRouter();
  const membership = useCurrentMembership();
  const canReturns = Boolean(membership && (membership.isOwner || membership.permissions.includes('returns.read')));
  const [tab, setTab] = useState<'invoices' | 'returns'>('invoices');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');

  const qs = new URLSearchParams({ page: '1', pageSize: '100' });
  if (search) qs.set('search', search);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (status) qs.set('status', status);

  const invoices = useQuery({
    queryKey: ['sales-history', qs.toString()],
    queryFn: () => api<{ items: InvoiceRow[]; pageInfo: { totalItems: number } }>(`/sales/invoices?${qs.toString()}`),
    retry: false,
  });
  const returns = useQuery({
    queryKey: ['sales-returns'],
    queryFn: () => api<{ items: ReturnRow[]; pageInfo: { totalItems: number } }>('/sales/returns?page=1&pageSize=100'),
    enabled: canReturns,
    retry: false,
  });

  const items = invoices.data?.items ?? [];
  const pageTotal = items.reduce((s, i) => s + Number(i.total), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Sales & returns"
        subtitle="Every POS invoice with its tender split, credit and return status. Open one to print or process a return."
        actions={
          <Link href="/pos">
            <Button>⌁ New sale</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'invoices', label: 'Invoices', count: invoices.data?.pageInfo.totalItems },
            ...(canReturns ? [{ id: 'returns' as const, label: 'Returns', count: returns.data?.pageInfo.totalItems }] : []),
          ]}
        />
        {tab === 'invoices' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-56" placeholder="Invoice no. or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              <option value="POSTED">Posted</option>
              <option value="PARTIALLY_RETURNED">Partially returned</option>
              <option value="RETURNED">Returned</option>
            </Select>
          </div>
        ) : null}
      </div>

      {tab === 'invoices' ? (
        <Card
          title={`${items.length} invoices`}
          actions={items.length ? <span className="text-xs text-neutral-500">Shown total <span className="font-semibold text-neutral-800">{money(pageTotal)}</span></span> : null}
        >
          {invoices.isLoading ? (
            <SkeletonRows rows={6} cols={6} />
          ) : invoices.error ? (
            <ErrorState
              message={invoices.error instanceof ApiClientError && invoices.error.status === 403 ? 'You do not have permission to view sales.' : 'Failed to load invoices.'}
              retry={() => void invoices.refetch()}
            />
          ) : items.length === 0 ? (
            <EmptyState title="No invoices match" hint="Posted POS invoices appear here with payment split and status." />
          ) : (
            <Table head={<tr><Th>Invoice</Th><Th>Customer</Th><Th>Items</Th><Th>Tender</Th><Th>Status</Th><Th right>Total</Th></tr>}>
              {items.map((i) => (
                <Tr key={i.id} onClick={() => router.push(`/sales-history/${i.id}`)}>
                  <Td>
                    <div className="font-mono text-xs font-semibold text-brand-700">{i.invoiceNumber}</div>
                    <div className="text-xs text-neutral-500">{fmtDate(i.invoiceDate)}</div>
                  </Td>
                  <Td className="text-sm">{i.customer?.name ?? i.walkInName ?? 'Walk-in'}</Td>
                  <Td className="max-w-[220px] truncate text-xs text-neutral-600">
                    {i.lines.map((l) => `${l.productName} ×${Number(l.quantity)}`).join(', ')}
                  </Td>
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
                    <Badge tone={STATUS_TONE[i.status] ?? 'neutral'}>{i.status.replace('_', ' ').toLowerCase()}</Badge>
                  </Td>
                  <Td right className="font-semibold">{money(i.total)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>
      ) : (
        <Card title="Sales returns (credit notes)">
          {returns.isLoading ? (
            <SkeletonRows rows={4} cols={6} />
          ) : returns.error ? (
            <ErrorState message="Failed to load returns." retry={() => void returns.refetch()} />
          ) : (returns.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="No returns yet" hint="Open an invoice and choose Return items to issue a credit note." />
          ) : (
            <Table head={<tr><Th>Return</Th><Th>Against</Th><Th>Reason</Th><Th>Settlement</Th><Th>Restocked</Th><Th right>Value</Th></tr>}>
              {returns.data?.items.map((r) => {
                const refunded = Number(r.refundTotal) - Number(r.creditAdjusted);
                return (
                  <Tr key={r.id} onClick={() => router.push(`/sales-history/${r.invoiceId}`)}>
                    <Td>
                      <div className="font-mono text-xs font-semibold text-neutral-800">{r.returnNumber}</div>
                      <div className="text-xs text-neutral-500">{fmtDate(r.createdAt)}</div>
                    </Td>
                    <Td>
                      <div className="font-mono text-xs text-brand-700">{r.invoice.invoiceNumber}</div>
                      <div className="text-xs text-neutral-500">{r.invoice.customer?.name ?? r.invoice.walkInName ?? 'Walk-in'}</div>
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
          )}
        </Card>
      )}
    </div>
  );
}
