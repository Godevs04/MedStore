'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import { Combobox, ExpiryPill, useDebouncedValue, type ComboItem } from '@/components/kit';
import { Badge, money } from '@/components/ui';

export function useCan() {
  const membership = useCurrentMembership();
  return (p: string) => Boolean(membership && (membership.isOwner || membership.permissions.includes(p)));
}

export interface WarehouseOption {
  id: string;
  name: string;
  label: string;
  branchId: string;
  isDefault?: boolean;
}

export function useWarehouses() {
  const res = useQuery({
    queryKey: ['warehouse-options'],
    queryFn: async () => {
      const branches = await api<Array<{ id: string; name: string; warehouses: Array<{ id: string; name: string; isDefault?: boolean }> }>>('/organizations/branches');
      const multi = branches.length > 1;
      return branches.flatMap((b) =>
        b.warehouses.map((w): WarehouseOption => ({ id: w.id, name: w.name, label: multi ? `${b.name} · ${w.name}` : w.name, branchId: b.id, isDefault: w.isDefault })),
      );
    },
    staleTime: 60_000,
  });
  const list = res.data ?? [];
  return { ...res, list, nameOf: (id: string | null | undefined) => list.find((w) => w.id === id)?.label ?? '—' };
}

export function daysUntil(date: string): number {
  const d = new Date(date);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - today.getTime()) / 86_400_000);
}

export const qtyFmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Downloads rows already on screen as CSV (Excel-friendly BOM, formula-injection safe). */
export function saveCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const text = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}\r\n`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  DAMAGE: 'Damaged',
  BREAKAGE: 'Breakage',
  EXPIRY_WRITEOFF: 'Expiry write-off',
  THEFT_LOSS: 'Theft / loss',
  COUNT_CORRECTION: 'Count correction',
  DATA_ENTRY_CORRECTION: 'Data-entry correction',
  TEMPERATURE_EXCURSION: 'Cold-chain excursion',
  CONTAMINATION: 'Contamination',
  OTHER: 'Other',
};

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_STOCK: 'Opening stock',
  PURCHASE_RECEIPT: 'Purchase receipt',
  SALE: 'Sale',
  SALES_RETURN_IN: 'Sales return',
  PURCHASE_RETURN_OUT: 'Purchase return',
  EXPIRY_RETURN_OUT: 'Expiry return',
  DAMAGE_OUT: 'Damage out',
  ADJUSTMENT_IN: 'Adjustment in',
  ADJUSTMENT_OUT: 'Adjustment out',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  COUNT_VARIANCE_IN: 'Count gain',
  COUNT_VARIANCE_OUT: 'Count loss',
  RECALL_OUT: 'Recall out',
  QUARANTINE_IN: 'Quarantine in',
  QUARANTINE_RELEASE: 'Quarantine release',
  SALE_CANCELLED_IN: 'Sale cancelled',
};

export const BATCH_STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral' | 'blue'> = {
  SALEABLE: 'green',
  QUARANTINED: 'amber',
  RECALLED: 'red',
  DAMAGED: 'red',
  EXPIRED_BLOCKED: 'neutral',
};

export const BATCH_STATUS_LABEL: Record<string, string> = {
  SALEABLE: 'Saleable',
  QUARANTINED: 'Quarantined',
  RECALLED: 'Recalled',
  DAMAGED: 'Damaged',
  EXPIRED_BLOCKED: 'Blocked',
};

export interface ProductHit {
  id: string;
  name: string;
  sku: string;
  genericName: string | null;
  strength?: string | null;
  mrp: string | null;
  rackLocation?: string | null;
}

/** Server-searched product picker. Remount with a new `key` to clear it. */
export function ProductSearch({
  value,
  onPick,
  invalid,
  disabled,
  placeholder = 'Search product by name, generic or SKU…',
}: {
  value: string | null;
  onPick: (p: ProductHit | null) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q.trim(), 250);
  const res = useQuery({
    queryKey: ['stock-product-search', dq],
    queryFn: () => api<{ items: ProductHit[] }>(`/catalog/products?page=1&pageSize=20&status=ACTIVE${dq ? `&search=${encodeURIComponent(dq)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const items: ComboItem[] = (res.data?.items ?? []).map((p) => ({
    id: p.id,
    label: p.name,
    sublabel: [p.sku, p.genericName, p.mrp ? `MRP ${money(p.mrp)}` : null].filter(Boolean).join(' · '),
  }));
  return (
    <Combobox
      items={items}
      value={value}
      invalid={invalid}
      disabled={disabled}
      loading={res.isFetching && !res.data}
      onSearch={setQ}
      placeholder={placeholder}
      emptyText="No active products match"
      onChange={(id) => onPick(res.data?.items.find((x) => x.id === id) ?? null)}
    />
  );
}

export interface BatchOption {
  id: string;
  productId: string;
  batchNumber: string;
  expiryDate: string;
  status: string;
  mrp: string;
  purchaseRate: string;
  warehouseId: string;
  product: { id: string; name: string; sku: string };
  balances: Array<{ quantity: string; warehouseId: string }>;
}

/** Batches of a product in a warehouse with their on-hand quantity there. */
export function useBatchOptions(warehouseId: string, productId: string) {
  const res = useQuery({
    queryKey: ['stock-batch-options', warehouseId, productId],
    queryFn: () => api<{ items: BatchOption[] }>(`/inventory/batches?page=1&pageSize=100&warehouseId=${warehouseId}&productId=${productId}`),
    enabled: Boolean(warehouseId && productId),
  });
  const options = (res.data?.items ?? []).map((b) => ({
    ...b,
    onHand: b.balances.filter((x) => x.warehouseId === warehouseId).reduce((s, x) => s + Number(x.quantity), 0),
    days: daysUntil(b.expiryDate),
  }));
  return { ...res, options };
}

export type BatchChoice = ReturnType<typeof useBatchOptions>['options'][number];

export function batchItem(b: BatchChoice, opts: { allowExpired?: boolean; allowBlocked?: boolean; requireStock?: boolean } = {}): ComboItem {
  const expired = b.days < 0;
  const blocked = b.status !== 'SALEABLE';
  const empty = b.onHand <= 0;
  return {
    id: b.id,
    label: `${b.batchNumber} · ${qtyFmt(b.onHand)} on hand`,
    sublabel: `Exp ${new Date(b.expiryDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} · MRP ${money(b.mrp)} · cost ${money(b.purchaseRate)}`,
    disabled: (expired && !opts.allowExpired) || (blocked && !opts.allowBlocked) || (empty && Boolean(opts.requireStock)),
    badge: blocked ? <Badge tone={BATCH_STATUS_TONE[b.status] ?? 'neutral'}>{BATCH_STATUS_LABEL[b.status] ?? b.status}</Badge> : <ExpiryPill days={b.days} />,
  };
}
