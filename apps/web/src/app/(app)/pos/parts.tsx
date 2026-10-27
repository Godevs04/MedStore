'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { indianPhoneSchema } from '@medicore/validation';
import { api, ApiClientError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useFieldErrors } from '@/components/kit';
import { Badge, Button, Drawer, EmptyState, Field, Input, Spinner, cn, money } from '@/components/ui';

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string;
}

const quickCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the customer name').max(200),
  phone: indianPhoneSchema,
});

/** Minimal customer creation from the counter: name + mobile number. */
export function QuickAddCustomer({ open, initialName, onClose, onCreated }: { open: boolean; initialName: string; onClose: () => void; onCreated: (c: CustomerOption) => void }) {
  const [form, setForm] = useState({ name: initialName, phone: '' });
  const fe = useFieldErrors();
  const [seed, setSeed] = useState(initialName);
  if (open && seed !== initialName) {
    setSeed(initialName);
    setForm({ name: initialName, phone: '' });
  }
  const create = useMutation({
    mutationFn: (body: { name: string; phone: string }) => api<CustomerOption>('/partners/customers', { method: 'POST', body }),
    meta: { success: 'Customer added', silentError: true },
    onSuccess: (c) => {
      onCreated(c);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiClientError && fe.setServerErrors(err.details)) return;
      toast.error('Customer not added', err instanceof ApiClientError ? err.message : 'Please try again.');
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = fe.validate(quickCustomerSchema, form);
    if (data) create.mutate(data);
  };
  return (
    <Drawer open={open} onClose={onClose} title="Quick-add customer" subtitle="Add full address, GSTIN and credit terms later from Customers." width="max-w-md">
      <form className="space-y-3" onSubmit={submit} noValidate>
        <Field label="Name" required error={fe.errors.name}>
          <Input autoFocus value={form.name} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); fe.clear('name'); }} />
        </Field>
        <Field label="Mobile number" required error={fe.errors.phone} hint="10-digit Indian mobile, e.g. 98220 12345">
          <Input inputMode="tel" value={form.phone} onChange={(e) => { setForm((f) => ({ ...f, phone: e.target.value })); fe.clear('phone'); }} placeholder="98220 12345" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Add customer'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

export interface HeldBill {
  id: string;
  label: string;
  itemCount: number;
  total: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export function HeldBillsDrawer({ open, onClose, onResume }: { open: boolean; onClose: () => void; onResume: (bill: HeldBill) => void }) {
  const qc = useQueryClient();
  const bills = useQuery({ queryKey: ['held-bills'], queryFn: () => api<HeldBill[]>('/sales/held-bills'), enabled: open });
  const discard = useMutation({
    mutationFn: (id: string) => api(`/sales/held-bills/${id}`, { method: 'DELETE' }),
    meta: { success: 'Held bill discarded' },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['held-bills'] }),
  });
  return (
    <Drawer open={open} onClose={onClose} title="Bills on hold" subtitle="Resume a parked bill — stock is only deducted when you charge." width="max-w-md">
      {bills.isLoading ? (
        <Spinner label="Loading held bills" />
      ) : !bills.data?.length ? (
        <EmptyState title="No bills on hold" hint="Use “Hold bill” (F8) to park a cart and serve the next customer." />
      ) : (
        <ul className="mc-stagger space-y-2">
          {bills.data.map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-xl border border-neutral-200 p-3 transition-colors hover:border-brand-200">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Icon name="pause" size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.label}</p>
                <p className="text-xs text-neutral-500">
                  {b.itemCount} item{b.itemCount === 1 ? '' : 's'} · {money(b.total)} · {new Date(b.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" disabled={discard.isPending} onClick={() => discard.mutate(b.id)}>Discard</Button>
              <Button onClick={() => onResume(b)}>Resume</Button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

interface Substitute {
  id: string;
  name: string;
  sku: string;
  strength: string | null;
  dosageForm: string | null;
  mrp: string | null;
  sellingPrice: string | null;
  prescriptionClass: string | null;
  manufacturer: string | null;
  onHand: number;
  sameStrength: boolean;
}

/** Same-generic alternatives for an item that is out of stock (or cheaper). */
export function SubstitutesPanel({ productId, warehouseId, onPick, onClose }: { productId: string; warehouseId: string; onPick: (s: Substitute) => void; onClose: () => void }) {
  const subs = useQuery({
    queryKey: ['substitutes', productId, warehouseId],
    queryFn: () => api<{ generic: string | null; strength?: string | null; items: Substitute[] }>(`/catalog/products/${productId}/substitutes?warehouseId=${warehouseId}`),
  });
  return (
    <div className="mc-anim-drop mt-2 rounded-xl border border-brand-200 bg-white p-2 shadow-lg">
      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-xs font-semibold text-neutral-700">
          Substitutes{subs.data?.generic ? ` · ${subs.data.generic}` : ''}
        </p>
        <button className="text-xs text-neutral-400 hover:text-neutral-700" onClick={onClose} aria-label="Close substitutes"><Icon name="close" size={14} /></button>
      </div>
      {subs.isLoading ? (
        <p className="px-1 py-2 text-xs text-neutral-500">Finding alternatives…</p>
      ) : !subs.data?.generic ? (
        <p className="px-1 py-2 text-xs text-neutral-500">Add a generic name to this product to see substitutes.</p>
      ) : subs.data.items.length === 0 ? (
        <p className="px-1 py-2 text-xs text-neutral-500">No other products with this generic.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {subs.data.items.map((s) => (
            <li key={s.id}>
              <button
                disabled={s.onHand <= 0}
                onClick={() => onPick(s)}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors', s.onHand > 0 ? 'hover:bg-brand-50' : 'cursor-not-allowed opacity-50')}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="truncate font-medium text-neutral-800">{[s.name, s.strength].filter(Boolean).join(' ')}</span>
                    {!s.sameStrength ? <Badge tone="amber">Different strength</Badge> : null}
                  </span>
                  <span className="block truncate text-neutral-500">{[s.manufacturer, s.dosageForm].filter(Boolean).join(' · ') || s.sku}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums text-brand-700">{money(s.sellingPrice ?? s.mrp)}</span>
                  <span className={cn('block tabular-nums', s.onHand > 0 ? 'text-emerald-700' : 'text-red-600')}>{s.onHand > 0 ? `${s.onHand} in stock` : 'Out of stock'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type { Substitute };
