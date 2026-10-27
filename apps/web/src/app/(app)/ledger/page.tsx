'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MOVEMENT_TYPES } from '@medicore/shared-types';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { toast } from '@/lib/toast';
import { MOVEMENT_LABELS, qtyFmt, useCan, useWarehouses } from '@/lib/stock';
import { DateRangePicker, FilterChips, Pagination, SearchInput, useDebouncedValue, type DateRange, type PageInfo } from '@/components/kit';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, SkeletonRows, Table, Td, Th, Tr, cn } from '@/components/ui';

interface LedgerRow {
  id: string;
  movementType: string;
  quantity: string;
  reason: string | null;
  sourceDocument: string | null;
  sourceDocumentId: string | null;
  warehouseId: string;
  createdAt: string;
  actorName: string | null;
  batch: { id: string; batchNumber: string; expiryDate: string; product: { id: string; name: string; sku: string } };
}

interface Reconcile {
  checked: number;
  consistent: boolean;
  mismatches: Array<{ batchId: string; warehouseId: string; balance: number; ledger: number }>;
}

const DOC_LABEL: Record<string, string> = {
  SALES_INVOICE: 'Sales invoice',
  SALES_RETURN: 'Sales return',
  GOODS_RECEIPT: 'Goods receipt',
  PURCHASE_RETURN: 'Debit note',
  STOCK_TRANSFER: 'Transfer',
  STOCK_COUNT: 'Stock count',
  STOCK_ADJUSTMENT: 'Adjustment',
  OPENING_STOCK: 'Opening stock',
};

function docLink(row: LedgerRow): { href: string; label: string } | null {
  const doc = row.sourceDocument;
  if (!doc) return null;
  const label = doc.startsWith('GRN:') ? doc.slice(4) : (DOC_LABEL[doc] ?? doc);
  if (doc === 'SALES_INVOICE' && row.sourceDocumentId) return { href: `/sales-history/${row.sourceDocumentId}`, label };
  if (doc === 'SALES_RETURN') return { href: '/sales-history', label };
  if (doc === 'GOODS_RECEIPT' || doc.startsWith('GRN:')) return { href: '/purchasing', label };
  if (doc === 'PURCHASE_RETURN') return { href: '/purchasing', label };
  if (doc === 'STOCK_TRANSFER' && row.sourceDocumentId) return { href: `/transfers?focus=${row.sourceDocumentId}`, label };
  if (doc === 'STOCK_COUNT') return { href: '/counts', label };
  if (doc === 'STOCK_ADJUSTMENT') return { href: '/adjustments', label };
  return { href: `/batches?focus=${row.batch.id}`, label };
}

export default function LedgerPage() {
  const can = useCan();
  const warehouses = useWarehouses();
  const [search, setSearch] = useState('');
  const dSearch = useDebouncedValue(search.trim(), 300);
  const [warehouseId, setWarehouseId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT' | ''>('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [reconcile, setReconcile] = useState<Reconcile | null>(null);

  useEffect(() => setPage(1), [dSearch, warehouseId, movementType, direction, range]);

  const filters = new URLSearchParams();
  if (dSearch) filters.set('search', dSearch);
  if (warehouseId) filters.set('warehouseId', warehouseId);
  if (movementType) filters.set('movementType', movementType);
  if (direction) filters.set('direction', direction);
  const rangeOk = !range.from || !range.to || range.from <= range.to;
  if (range.from && rangeOk) filters.set('from', range.from);
  if (range.to && rangeOk) filters.set('to', range.to);

  const ledger = useQuery({
    queryKey: ['ledger', filters.toString(), page],
    queryFn: () => api<{ items: LedgerRow[]; pageInfo: PageInfo }>(`/inventory/ledger?page=${page}&pageSize=50&${filters.toString()}`),
    placeholderData: (prev) => prev,
  });

  const runReconcile = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: () => api<Reconcile>(`/inventory/reconcile${warehouseId ? `?warehouseId=${warehouseId}` : ''}`),
    onSuccess: (r) => {
      setReconcile(r);
      if (r.consistent) toast.success('Ledger reconciled', `${r.checked.toLocaleString('en-IN')} balances match their movements.`);
      else toast.error('Mismatches found', `${r.mismatches.length} balance(s) differ from the ledger.`);
    },
    onError: () => toast.error('Reconciliation failed'),
  });

  const exportCsv = async () => {
    try {
      await downloadCsv(`/inventory/ledger/export?${filters.toString()}`, 'stock-ledger.csv');
      toast.success('Export ready', 'Up to 10,000 movements matching the filters.');
    } catch (e) {
      toast.error('Export failed', e instanceof ApiClientError ? e.message : undefined);
    }
  };

  const items = ledger.data?.items ?? [];
  const pageIn = items.reduce((s, r) => s + Math.max(0, Number(r.quantity)), 0);
  const pageOut = items.reduce((s, r) => s + Math.min(0, Number(r.quantity)), 0);
  const filtered = filters.toString().length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Stock ledger"
        subtitle="Every stock movement — append-only, never edited, traceable to its source document and user."
        actions={
          <>
            <Button variant="secondary" onClick={() => runReconcile.mutate()} disabled={runReconcile.isPending}>
              {runReconcile.isPending ? 'Checking…' : '⟲ Reconcile'}
            </Button>
            {can('reports.export') ? (
              <Button variant="secondary" onClick={() => void exportCsv()}>
                <Icon name="download" size={14} /> Export CSV
              </Button>
            ) : null}
          </>
        }
      />

      {reconcile ? (
        <div className={cn('mc-anim-fade-up rounded-xl px-4 py-3 text-sm ring-1', reconcile.consistent ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200')}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              <Icon name={reconcile.consistent ? 'checkCircle' : 'warning'} size={14} className="mr-1" />
              {reconcile.consistent ? 'Balances and ledger agree' : `${reconcile.mismatches.length} balance(s) differ from the ledger`} — {reconcile.checked.toLocaleString('en-IN')} batch balances checked
              {warehouseId ? ` in ${warehouses.nameOf(warehouseId)}` : ''}.
            </span>
            <Button variant="ghost" onClick={() => setReconcile(null)} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </Button>
          </div>
          {!reconcile.consistent ? (
            <ul className="mt-2 space-y-0.5 text-xs">
              {reconcile.mismatches.slice(0, 10).map((m) => (
                <li key={`${m.batchId}-${m.warehouseId}`}>
                  <Link href={`/batches?focus=${m.batchId}`} className="underline">
                    Batch {m.batchId.slice(0, 8)}
                  </Link>{' '}
                  in {warehouses.nameOf(m.warehouseId)}: balance {qtyFmt(m.balance)} vs ledger {qtyFmt(m.ledger)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Card title={`Movements (${(ledger.data?.pageInfo.totalItems ?? 0).toLocaleString('en-IN')})`} actions={<SearchInput value={search} onChange={setSearch} placeholder="Batch, product or SKU…" className="w-64" />}>
        <div className="mb-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <FilterChips
              options={[
                { id: 'IN', label: 'In', icon: 'arrowUp', tone: 'green' },
                { id: 'OUT', label: 'Out', icon: 'arrowDown', tone: 'red' },
              ]}
              value={direction}
              onChange={setDirection}
            />
            <Select value={movementType} onChange={(e) => setMovementType(e.target.value)} className="w-48" aria-label="Movement type">
              <option value="">All movement types</option>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t] ?? t}
                </option>
              ))}
            </Select>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="w-48" aria-label="Warehouse">
              <option value="">All warehouses</option>
              {warehouses.list.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </Select>
            {filtered ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setWarehouseId('');
                  setMovementType('');
                  setDirection('');
                  setRange({ from: '', to: '' });
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        {ledger.isLoading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : ledger.error ? (
          <ErrorState
            message={ledger.error instanceof ApiClientError && ledger.error.status === 403 ? 'You do not have permission to view the stock ledger.' : 'Failed to load ledger.'}
            retry={() => void ledger.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState title={filtered ? 'No movements match these filters' : 'No stock movements yet'} />
        ) : (
          <>
            <p className="mb-2 text-xs text-neutral-500">
              This page: <span className="font-medium text-emerald-700">+{qtyFmt(pageIn)}</span> in · <span className="font-medium text-red-600">{qtyFmt(pageOut)}</span> out
            </p>
            <Table
              head={
                <tr>
                  <Th>When</Th>
                  <Th>Product / batch</Th>
                  <Th>Movement</Th>
                  <Th right>Qty</Th>
                  <Th>Warehouse</Th>
                  <Th>Document</Th>
                  <Th>By</Th>
                </tr>
              }
            >
              {items.map((row) => {
                const qty = Number(row.quantity);
                const link = docLink(row);
                return (
                  <Tr key={row.id}>
                    <Td className="whitespace-nowrap text-xs text-neutral-500">{new Date(row.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Td>
                    <Td>
                      <Link href={`/batches?focus=${row.batch.id}`} className="font-medium text-neutral-800 hover:text-brand-700">
                        {row.batch.product.name}
                      </Link>
                      <div className="font-mono text-xs text-neutral-500">{row.batch.batchNumber}</div>
                    </Td>
                    <Td>
                      <Badge tone={qty >= 0 ? 'green' : 'amber'}>{MOVEMENT_LABELS[row.movementType] ?? row.movementType}</Badge>
                      {row.reason ? <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-neutral-500" title={row.reason}>{row.reason}</div> : null}
                    </Td>
                    <Td right className={cn('font-semibold', qty >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                      {qty > 0 ? '+' : ''}
                      {qtyFmt(qty)}
                    </Td>
                    <Td className="text-xs text-neutral-600">{warehouses.nameOf(row.warehouseId)}</Td>
                    <Td className="text-xs">
                      {link ? (
                        <Link href={link.href} className="font-medium text-brand-700 hover:underline">
                          {link.label} <Icon name="external" size={12} />
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-xs text-neutral-500">{row.actorName ?? '—'}</Td>
                  </Tr>
                );
              })}
            </Table>
            <Pagination info={ledger.data?.pageInfo} onChange={setPage} label="movements" />
          </>
        )}
      </Card>
    </div>
  );
}
