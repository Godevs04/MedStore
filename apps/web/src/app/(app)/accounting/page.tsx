'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import { useCurrentMembership } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorBanner,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  SuccessBanner,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
  fmtDate,
  money,
  todayIso,
} from '@/components/ui';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  systemKey: string | null;
}
interface TBRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  net: string;
}
interface Pnl {
  income: Array<{ accountId: string; code: string; name: string; amount: string }>;
  expenses: Array<{ accountId: string; code: string; name: string; amount: string }>;
  netSales: string;
  grossProfit: string;
  totalIncome: string;
  totalExpenses: string;
  netProfit: string;
}
interface BalanceSheet {
  assets: Array<{ accountId: string; code: string; name: string; amount: string }>;
  liabilities: Array<{ accountId: string; code: string; name: string; amount: string }>;
  equity: Array<{ accountId: string; code: string; name: string; amount: string }>;
  retainedEarnings: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  balanced: boolean;
}
interface JournalRow {
  id: string;
  entryNumber: string;
  entryDate: string;
  memo: string;
  sourceType: string | null;
  reversedById: string | null;
  lines: Array<{ account: { code: string; name: string }; debit: string; credit: string }>;
}
interface Ledger {
  account: { id: string; code: string; name: string; type: string };
  opening: string;
  closing: string;
  rows: Array<{ entryId: string; entryNumber: string; date: string; memo: string; sourceType: string | null; reversed: boolean; debit: string; credit: string; balance: string }>;
}

type Tab = 'pnl' | 'tb' | 'bs' | 'journals' | 'expenses';
const n = (v: string | number | undefined | null) => Number(v ?? 0);
const errMsg = (e: unknown, fb: string) => (e instanceof ApiClientError ? e.message : fb);
const fyStart = () => {
  const t = todayIso();
  const y = Number(t.slice(0, 4));
  return Number(t.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
};
const SOURCE_LABEL: Record<string, string> = {
  SALES_INVOICE: 'Sale',
  SALES_RETURN: 'Sales return',
  CUSTOMER_RECEIPT: 'Receipt',
  PURCHASE_INVOICE: 'Purchase',
  SUPPLIER_PAYMENT: 'Supplier payment',
  PURCHASE_RETURN: 'Debit note',
  EXPENSE: 'Expense',
  MANUAL: 'Manual',
  JOURNAL_REVERSAL: 'Reversal',
  OPENING_STOCK: 'Opening stock',
  STOCK_ADJUSTMENT: 'Adjustment',
  STOCK_COUNT: 'Stock count',
};

function LedgerDrawer({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const q = useQuery({ queryKey: ['gl', accountId, qs.toString()], queryFn: () => api<Ledger>(`/accounting/accounts/${accountId}/ledger?${qs.toString()}`) });
  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={q.data ? `${q.data.account.code} · ${q.data.account.name}` : 'General ledger'} subtitle={q.data ? `${q.data.account.type.toLowerCase()} account · running balance on its natural side` : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span className="text-xs text-neutral-400">to</span>
        <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <Button variant="ghost" className="text-xs" onClick={() => { setFrom(fyStart()); setTo(todayIso()); }}>This FY</Button>
        <Button variant="ghost" className="text-xs" onClick={() => { setFrom(''); setTo(''); }}>All time</Button>
      </div>
      {q.isLoading ? (
        <SkeletonRows rows={6} cols={5} />
      ) : q.error ? (
        <ErrorState message="Failed to load ledger." retry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Opening" value={money(q.data!.opening)} />
            <Stat label="Closing" value={money(q.data!.closing)} tone="blue" />
          </div>
          {q.data!.rows.length === 0 ? (
            <EmptyState title="No postings in this period" />
          ) : (
            <Table head={<tr><Th>Date</Th><Th>Entry</Th><Th>Narration</Th><Th right>Debit</Th><Th right>Credit</Th><Th right>Balance</Th></tr>}>
              {q.data!.rows.map((r, i) => (
                <Tr key={`${r.entryId}-${i}`}>
                  <Td className="whitespace-nowrap text-xs text-neutral-500">{fmtDate(r.date)}</Td>
                  <Td className="font-mono text-xs">
                    {r.entryNumber}
                    {r.reversed ? <span className="ml-1 text-[10px] text-red-600">reversed</span> : null}
                  </Td>
                  <Td className="max-w-[260px] text-xs">
                    <span className="block truncate">{r.memo}</span>
                    {r.sourceType ? <span className="text-[10px] text-neutral-400">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</span> : null}
                  </Td>
                  <Td right className="text-xs">{n(r.debit) ? money(r.debit, false) : ''}</Td>
                  <Td right className="text-xs">{n(r.credit) ? money(r.credit, false) : ''}</Td>
                  <Td right className="text-xs font-semibold">{money(r.balance, false)}</Td>
                </Tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Drawer>
  );
}

function ManualJournal({ accounts, onDone }: { accounts: Account[]; onDone: (msg: string) => void }) {
  const blank = () => ({ accountId: '', debit: '', credit: '' });
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([blank(), blank()]);
  const dr = lines.reduce((s, l) => s + Math.round(n(l.debit) * 100), 0);
  const cr = lines.reduce((s, l) => s + Math.round(n(l.credit) * 100), 0);
  const filled = lines.filter((l) => l.accountId && (n(l.debit) > 0 || n(l.credit) > 0));
  const valid = memo.trim().length >= 3 && filled.length >= 2 && dr === cr && dr > 0 && filled.every((l) => !(n(l.debit) > 0 && n(l.credit) > 0));
  const post = useMutation({
    meta: { success: 'Journal posted' },
    mutationFn: () =>
      api<{ entryNumber: string }>('/accounting/journals', {
        method: 'POST',
        body: {
          date,
          memo: memo.trim(),
          lines: filled.map((l) => ({ accountId: l.accountId, ...(n(l.debit) > 0 ? { debit: n(l.debit).toFixed(2) } : {}), ...(n(l.credit) > 0 ? { credit: n(l.credit).toFixed(2) } : {}) })),
        },
      }),
    onSuccess: (e) => {
      setMemo('');
      setLines([blank(), blank()]);
      onDone(`Journal ${e.entryNumber} posted.`);
    },
  });
  return (
    <Card title="Manual journal voucher">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Date"><Input type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="sm:col-span-3"><Field label="Narration *"><Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Owner capital introduced into bank" /></Field></div>
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_7rem_2.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_2.5rem]">
            <Select className="min-w-0" value={l.accountId} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))}>
              <option value="">Account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </Select>
            <Input className="text-right" placeholder="Debit" inputMode="decimal" value={l.debit} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)))} />
            <Input className="text-right" placeholder="Credit" inputMode="decimal" value={l.credit} onChange={(e) => setLines((s) => s.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)))} />
            <Button variant="ghost" className="px-2" disabled={lines.length <= 2} onClick={() => setLines((s) => s.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => setLines((s) => [...s, blank()])}>+ Line</Button>
        <span className={cn('text-sm tabular-nums', dr === cr ? 'text-emerald-700' : 'text-red-600')}>
          Dr {money(dr / 100)} · Cr {money(cr / 100)} {dr === cr ? '✓ balanced' : `· difference ${money(Math.abs(dr - cr) / 100)}`}
        </span>
      </div>
      {post.error ? <div className="mt-2"><ErrorBanner>{errMsg(post.error, 'Failed to post journal')}</ErrorBanner></div> : null}
      <div className="mt-3"><Button disabled={!valid || post.isPending} onClick={() => post.mutate()}>{post.isPending ? 'Posting…' : 'Post journal'}</Button></div>
    </Card>
  );
}

export default function AccountingPage() {
  const queryClient = useQueryClient();
  const membership = useCurrentMembership();
  const canPost = Boolean(membership && (membership.isOwner || membership.permissions.includes('accounting.post')));
  const [tab, setTab] = useState<Tab>('pnl');
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const [asOf, setAsOf] = useState(todayIso());
  const [sourceType, setSourceType] = useState('');
  const [glAccount, setGlAccount] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expense, setExpense] = useState({ category: '', payee: '', amount: '', method: 'CASH' as 'CASH' | 'BANK' | 'UPI', expenseDate: todayIso(), notes: '' });
  const [lockMonth, setLockMonth] = useState(todayIso().slice(0, 7));

  const pnl = useQuery({ queryKey: ['pnl', from, to], queryFn: () => api<Pnl>(`/accounting/profit-and-loss?from=${from}&to=${to}`), retry: false });
  const tb = useQuery({ queryKey: ['trial-balance', asOf], queryFn: () => api<{ rows: TBRow[]; totalDebits: string; totalCredits: string; balanced: boolean }>(`/accounting/trial-balance?asOf=${asOf}`), enabled: tab === 'tb', retry: false });
  const bs = useQuery({ queryKey: ['balance-sheet', asOf], queryFn: () => api<BalanceSheet>(`/accounting/balance-sheet?asOf=${asOf}`), enabled: tab === 'bs', retry: false });
  const journals = useQuery({
    queryKey: ['journals', sourceType],
    queryFn: () => api<{ items: JournalRow[]; pageInfo: { totalItems: number } }>(`/accounting/journals?page=1&pageSize=100${sourceType ? `&sourceType=${sourceType}` : ''}`),
    enabled: tab === 'journals',
    retry: false,
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounting/accounts'), enabled: canPost && tab === 'journals' });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api<Array<{ id: string; periodLabel: string; status: string; lockedAt: string | null }>>('/accounting/periods'), enabled: tab === 'expenses' });

  const invalidate = () => {
    for (const k of ['pnl', 'trial-balance', 'balance-sheet', 'journals', 'periods', 'gl', 'dashboard']) void queryClient.invalidateQueries({ queryKey: [k] });
  };
  const done = (msg: string) => {
    setNotice(msg);
    setError(null);
    invalidate();
  };

  const reverse = useMutation({
    meta: { success: 'Reversal posted' },
    mutationFn: (j: JournalRow) => api<{ entryNumber: string; originalEntryNumber: string }>(`/accounting/journals/${j.id}/reverse`, { method: 'POST', body: {} }),
    onSuccess: (r) => done(`Reversal ${r.entryNumber} posted for ${r.originalEntryNumber}.`),
    onError: (e) => setError(errMsg(e, 'Reversal failed')),
  });
  const createExpense = useMutation({
    meta: { success: 'Expense recorded' },
    mutationFn: () => api<{ expenseNumber?: string }>('/accounting/expenses', { method: 'POST', body: { ...expense, amount: n(expense.amount).toFixed(2), notes: expense.notes.trim() || null } }),
    onSuccess: () => {
      setExpense((s) => ({ ...s, category: '', payee: '', amount: '', notes: '' }));
      done('Expense recorded and posted (Dr expense, Cr cash/bank).');
    },
    onError: (e) => setError(errMsg(e, 'Failed to record expense')),
  });
  const lock = useMutation({
    meta: { success: 'Period lock updated' },
    mutationFn: (locked: boolean) => api('/accounting/periods/lock', { method: 'POST', body: { periodLabel: lockMonth, locked } }),
    onSuccess: (_d, locked) => done(`Period ${lockMonth} ${locked ? 'locked — no postings can be dated in it' : 'reopened'}.`),
    onError: (e) => setError(errMsg(e, 'Failed to change period lock')),
  });

  const p = pnl.data;
  const margin = p && n(p.netSales) ? (n(p.grossProfit) / n(p.netSales)) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Accounting" subtitle="Double-entry books posted automatically from every sale, purchase, payment, return and stock movement." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net sales" value={p ? money(p.netSales) : '…'} hint={`${fmtDate(from)} – ${fmtDate(to)}`} tone="blue" />
        <Stat label="Gross profit" value={p ? money(p.grossProfit) : '…'} hint={p ? `${margin.toFixed(1)}% margin` : undefined} tone="green" />
        <Stat label="Expenses" value={p ? money(p.totalExpenses) : '…'} hint="incl. cost of goods" tone="amber" />
        <Stat label="Net profit" value={p ? money(p.netProfit) : '…'} tone={p && n(p.netProfit) < 0 ? 'red' : 'green'} />
      </div>
      <Tabs
        value={tab}
        onChange={(t) => { setTab(t); setError(null); }}
        tabs={[
          { id: 'pnl', label: 'Profit & loss' },
          { id: 'tb', label: 'Trial balance' },
          { id: 'bs', label: 'Balance sheet' },
          { id: 'journals', label: 'Journals' },
          { id: 'expenses', label: 'Expenses & periods' },
        ]}
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {tab === 'pnl' ? (
        <Card
          title="Profit & loss statement"
          actions={
            <div className="flex items-center gap-2">
              <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <span className="text-xs text-neutral-400">to</span>
              <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            </div>
          }
        >
          {pnl.isLoading ? (
            <SkeletonRows rows={6} cols={3} />
          ) : pnl.error ? (
            <ErrorState message="Failed to load P&L." retry={() => void pnl.refetch()} />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {(['income', 'expenses'] as const).map((side) => (
                <div key={side}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">{side === 'income' ? 'Income' : 'Expenses'}</h3>
                  <div className="divide-y divide-neutral-100">
                    {p![side].filter((r) => n(r.amount) !== 0).map((r) => (
                      <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between px-1 py-1.5 text-left text-sm transition-colors hover:bg-brand-50/50">
                        <span><span className="font-mono text-xs text-neutral-400">{r.code}</span> {r.name}</span>
                        <span className="tabular-nums">{money(r.amount)}</span>
                      </button>
                    ))}
                    <div className="flex justify-between px-1 py-2 text-sm font-semibold">
                      <span>Total {side}</span>
                      <span className="tabular-nums">{money(side === 'income' ? p!.totalIncome : p!.totalExpenses)}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className={cn('rounded-xl px-4 py-3 md:col-span-2', n(p!.netProfit) >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
                <div className="flex justify-between text-base font-bold">
                  <span>Net {n(p!.netProfit) >= 0 ? 'profit' : 'loss'}</span>
                  <span className="tabular-nums">{money(Math.abs(n(p!.netProfit)))}</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'tb' ? (
        <Card
          title="Trial balance"
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">as of</span>
              <Input type="date" className="w-36" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              {tb.data ? <Badge tone={tb.data.balanced ? 'green' : 'red'} dot>{tb.data.balanced ? 'Balanced' : 'Unbalanced'}</Badge> : null}
            </div>
          }
        >
          {tb.isLoading ? (
            <SkeletonRows rows={8} cols={5} />
          ) : tb.error ? (
            <ErrorState message="Failed to load trial balance." retry={() => void tb.refetch()} />
          ) : (
            <Table head={<tr><Th>Code</Th><Th>Account</Th><Th>Type</Th><Th right>Debit</Th><Th right>Credit</Th></tr>}>
              {tb.data!.rows.filter((r) => n(r.debit) !== 0 || n(r.credit) !== 0).map((r) => (
                <Tr key={r.accountId} onClick={() => setGlAccount(r.accountId)}>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="text-sm text-brand-800">{r.name}</Td>
                  <Td><Badge>{r.type.toLowerCase()}</Badge></Td>
                  <Td right>{n(r.debit) ? money(r.debit, false) : ''}</Td>
                  <Td right>{n(r.credit) ? money(r.credit, false) : ''}</Td>
                </Tr>
              ))}
              <Tr className="bg-neutral-50 font-semibold">
                <Td />
                <Td>Total</Td>
                <Td />
                <Td right>{money(tb.data!.totalDebits, false)}</Td>
                <Td right>{money(tb.data!.totalCredits, false)}</Td>
              </Tr>
            </Table>
          )}
          <p className="mt-2 text-xs text-neutral-500">Click any account to drill into its general ledger.</p>
        </Card>
      ) : null}

      {tab === 'bs' ? (
        <Card
          title="Balance sheet"
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">as of</span>
              <Input type="date" className="w-36" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              {bs.data ? <Badge tone={bs.data.balanced ? 'green' : 'red'} dot>{bs.data.balanced ? 'Assets = Liabilities + Equity' : 'Out of balance'}</Badge> : null}
            </div>
          }
        >
          {bs.isLoading ? (
            <SkeletonRows rows={8} cols={2} />
          ) : bs.error ? (
            <ErrorState message="Failed to load balance sheet." retry={() => void bs.refetch()} />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Assets</h3>
                {bs.data!.assets.filter((r) => n(r.amount) !== 0).map((r) => (
                  <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between px-1 py-1.5 text-left text-sm hover:bg-brand-50/50">
                    <span>{r.name}</span>
                    <span className={cn('tabular-nums', n(r.amount) < 0 && 'text-red-600')}>{money(r.amount)}</span>
                  </button>
                ))}
                {bs.data!.assets.some((r) => n(r.amount) < 0 && /cash|bank/i.test(r.name)) ? (
                  <p className="mt-1 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    A cash or bank balance is negative — payments were recorded before the money was received. Record the opening capital or receipts.
                  </p>
                ) : null}
                <div className="mt-1 flex justify-between border-t border-neutral-200 px-1 pt-2 font-semibold">
                  <span>Total assets</span>
                  <span className="tabular-nums">{money(bs.data!.totalAssets)}</span>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Liabilities</h3>
                {bs.data!.liabilities.filter((r) => n(r.amount) !== 0).map((r) => (
                  <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between px-1 py-1.5 text-left text-sm hover:bg-brand-50/50">
                    <span>{r.name}</span>
                    <span className="tabular-nums">{money(r.amount)}</span>
                  </button>
                ))}
                <div className="flex justify-between px-1 py-1.5 text-sm font-medium text-neutral-600">
                  <span>Total liabilities</span>
                  <span className="tabular-nums">{money(bs.data!.totalLiabilities)}</span>
                </div>
                <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">Equity</h3>
                {bs.data!.equity.filter((r) => n(r.amount) !== 0).map((r) => (
                  <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between px-1 py-1.5 text-left text-sm hover:bg-brand-50/50">
                    <span>{r.name}</span>
                    <span className="tabular-nums">{money(r.amount)}</span>
                  </button>
                ))}
                <div className="flex justify-between px-1 py-1.5 text-sm">
                  <span>Current period profit / (loss)</span>
                  <span className="tabular-nums">{money(bs.data!.retainedEarnings)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-neutral-200 px-1 pt-2 font-semibold">
                  <span>Liabilities + equity</span>
                  <span className="tabular-nums">{money(n(bs.data!.totalLiabilities) + n(bs.data!.totalEquity))}</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'journals' ? (
        <>
          {canPost && accounts.data ? <ManualJournal accounts={accounts.data} onDone={done} /> : null}
          <Card
            title={`Journal entries (${journals.data?.pageInfo.totalItems ?? 0})`}
            actions={
              <Select className="w-48" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                <option value="">All sources</option>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            }
          >
            {journals.isLoading ? (
              <SkeletonRows rows={5} cols={4} />
            ) : journals.error ? (
              <ErrorState message="Failed to load journal entries." retry={() => void journals.refetch()} />
            ) : (journals.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No journal entries" hint="Sales, purchases, payments and stock movements post here automatically." />
            ) : (
              <div className="space-y-2">
                {journals.data?.items.map((j) => {
                  const total = j.lines.reduce((s, l) => s + n(l.debit), 0);
                  const canReverse = canPost && !j.reversedById && j.sourceType !== 'JOURNAL_REVERSAL';
                  return (
                    <div key={j.id} className={cn('mc-anim-fade-up rounded-xl border px-3 py-2.5', j.reversedById ? 'border-neutral-200 bg-neutral-50/70 opacity-75' : 'border-neutral-200')}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-neutral-800">{j.entryNumber}</span>
                          <span className="text-xs text-neutral-400">{fmtDate(j.entryDate)}</span>
                          {j.sourceType ? <Badge tone={j.sourceType === 'JOURNAL_REVERSAL' ? 'red' : j.sourceType === 'MANUAL' ? 'blue' : 'neutral'}>{SOURCE_LABEL[j.sourceType] ?? j.sourceType}</Badge> : null}
                          {j.reversedById ? <Badge tone="red">Reversed</Badge> : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold tabular-nums">{money(total)}</span>
                          {canReverse ? (
                            <Button
                              variant="ghost"
                              className="text-xs"
                              disabled={reverse.isPending}
                              onClick={() => {
                                if (window.confirm(`Post a reversing entry for ${j.entryNumber}? The original stays on record.`)) reverse.mutate(j);
                              }}
                            >
                              ↺ Reverse
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-600">{j.memo}</p>
                      <div className="mt-1.5 grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
                        {j.lines.map((l, i) => (
                          <div key={i} className="flex justify-between border-b border-dashed border-neutral-100 py-0.5">
                            <span className={n(l.credit) > 0 ? 'pl-4 text-neutral-500' : 'text-neutral-700'}>
                              {n(l.credit) > 0 ? 'To ' : ''}{l.account.name}
                            </span>
                            <span className="tabular-nums">{n(l.debit) > 0 ? `Dr ${money(l.debit, false)}` : `Cr ${money(l.credit, false)}`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'expenses' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {canPost ? (
            <Card title="Record expense">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Category"><Input value={expense.category} onChange={(e) => setExpense((s) => ({ ...s, category: e.target.value }))} placeholder="Shop rent / Electricity / Salaries" /></Field>
                <Field label="Payee"><Input value={expense.payee} onChange={(e) => setExpense((s) => ({ ...s, payee: e.target.value }))} /></Field>
                <Field label="Amount (₹)"><Input inputMode="decimal" value={expense.amount} onChange={(e) => setExpense((s) => ({ ...s, amount: e.target.value }))} /></Field>
                <Field label="Paid via">
                  <Select value={expense.method} onChange={(e) => setExpense((s) => ({ ...s, method: e.target.value as 'CASH' | 'BANK' | 'UPI' }))}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                    <option value="UPI">UPI</option>
                  </Select>
                </Field>
                <Field label="Date"><Input type="date" max={todayIso()} value={expense.expenseDate} onChange={(e) => setExpense((s) => ({ ...s, expenseDate: e.target.value }))} /></Field>
                <Field label="Notes"><Input value={expense.notes} onChange={(e) => setExpense((s) => ({ ...s, notes: e.target.value }))} /></Field>
              </div>
              <div className="mt-3">
                <Button disabled={expense.category.trim().length < 2 || expense.payee.trim().length < 2 || !(n(expense.amount) > 0) || createExpense.isPending} onClick={() => createExpense.mutate()}>
                  {createExpense.isPending ? 'Posting…' : 'Record expense'}
                </Button>
              </div>
            </Card>
          ) : null}
          <Card title="Accounting periods">
            <p className="mb-3 text-xs text-neutral-500">Locking a month blocks any posting (including reversals and backdated documents) dated inside it.</p>
            {canPost ? (
              <div className="mb-3 flex items-end gap-2">
                <Field label="Month"><Input type="month" value={lockMonth} onChange={(e) => setLockMonth(e.target.value)} /></Field>
                <Button variant="secondary" disabled={lock.isPending} onClick={() => lock.mutate(true)}>Lock</Button>
                <Button variant="ghost" disabled={lock.isPending} onClick={() => lock.mutate(false)}>Reopen</Button>
              </div>
            ) : null}
            {(periods.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-neutral-500">All periods are open.</p>
            ) : (
              <div className="space-y-1.5">
                {periods.data?.map((pr) => (
                  <div key={pr.id} className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-1.5 text-sm">
                    <span className="font-mono">{pr.periodLabel}</span>
                    <Badge tone={pr.status === 'LOCKED' ? 'red' : 'green'} dot>{pr.status.toLowerCase()}{pr.lockedAt ? ` · ${fmtDate(pr.lockedAt)}` : ''}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {glAccount ? <LedgerDrawer accountId={glAccount} onClose={() => setGlAccount(null)} /> : null}
    </div>
  );
}
