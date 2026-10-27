'use client';

import { Icon } from '@/components/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { EXPENSE_CATEGORIES, expenseCreateSchema, financialYearOf } from '@medicore/validation';
import { api, ApiClientError, downloadCsv } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/stock';
import { ConfirmDialog, DateRangePicker, Donut, FilterChips, KpiGrid, MoneyInput, niceTicks, Pagination, SearchInput, useDebouncedValue, useFieldErrors, type DateRange, type PageInfo } from '@/components/kit';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  SkeletonRows,
  Stat,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
  cn,
  fmtDate,
  money,
  todayIso, Alert, StatusBadge, Signed } from '@/components/ui';

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
type Line = { accountId: string; code: string; name: string; amount: string };
interface Pnl {
  income: Line[];
  expenses: Line[];
  netSales: string;
  grossProfit: string;
  totalIncome: string;
  totalExpenses: string;
  netProfit: string;
}
interface BalanceSheet {
  assets: Line[];
  liabilities: Line[];
  equity: Line[];
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
interface ExpenseRow {
  id: string;
  expenseNumber: string;
  category: string;
  payee: string;
  amount: string;
  method: 'CASH' | 'BANK' | 'UPI';
  expenseDate: string;
  notes: string | null;
}
interface ExpenseSummary {
  total: string;
  count: number;
  byCategory: Array<{ category: string; amount: string; count: number }>;
}
interface Period {
  id: string;
  periodLabel: string;
  status: string;
  lockedAt: string | null;
}

type Tab = 'pnl' | 'tb' | 'bs' | 'journals' | 'expenses';
const n = (v: string | number | undefined | null) => Number(v ?? 0);
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
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', BANK: 'Bank', UPI: 'UPI' };
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });

function fyOptions() {
  const today = todayIso();
  const cur = financialYearOf(today);
  const out = [cur];
  for (let i = 1; i < 4; i += 1) out.push(financialYearOf(`${Number(cur.from.slice(0, 4)) - i}-06-01`));
  return out.map((f) => ({ ...f, to: f.to > today ? today : f.to }));
}

const errorText = (e: unknown, fb: string) => (e instanceof ApiClientError ? e.message : fb);

/** Income vs expense bars per month with net profit beneath. */
function TrendChart({ data }: { data: Array<{ month: string; income: string; expenses: string; net: string }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.flatMap((d) => [n(d.income), n(d.expenses)]));
  if (!data.length || max <= 0) return <p className="py-6 text-[13px] text-muted">No postings in this period.</p>;
  const ticks = niceTicks(max);
  const top = ticks[0]!;
  const short = (v: number) => {
    const a = Math.abs(v);
    return a >= 1e7 ? `${(a / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}k` : `${Math.round(a)}`;
  };
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setHover((h) => Math.min(data.length - 1, Math.max(0, (h ?? (e.key === 'ArrowRight' ? -1 : data.length)) + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  const active = hover !== null ? data[hover] : null;
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label="Monthly income and expenses. Use the left and right arrow keys to read values."
      onKeyDown={move}
      onBlur={() => setHover(null)}
      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex gap-3">
        <div className="relative h-40 w-10 shrink-0 text-right text-[10px] num text-faint" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              ₹{short(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 h-40" aria-hidden>
            {ticks.map((t) => (
              <span key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-line' : 'border-dashed border-line/80')} style={{ top: `${(1 - t / top) * 100}%` }} />
            ))}
          </div>
          <div className="relative flex h-40 items-end gap-1.5" onMouseLeave={() => setHover(null)} aria-hidden>
            {data.map((d, i) => (
              <div key={d.month} className="relative flex h-full flex-1 items-end justify-center gap-0.5" onMouseEnter={() => setHover(i)}>
                <div className={cn('mc-anim-grow w-1/2 max-w-4 origin-bottom rounded-t-[3px]', hover === i ? 'bg-teal-ink' : 'bg-accent/85')} style={{ height: `${(n(d.income) / top) * 100}%` }} />
                <div className={cn('mc-anim-grow w-1/2 max-w-4 origin-bottom rounded-t-[3px]', hover === i ? 'bg-warning' : 'bg-warning/60')} style={{ height: `${(n(d.expenses) / top) * 100}%` }} />
                {hover === i ? (
                  <div className="mc-anim-fade-in pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-2xs text-white shadow-pop">
                    <div className="font-medium">{monthName(d.month)} {d.month.slice(0, 4)}</div>
                    <div className="num">Income {money(d.income)}</div>
                    <div className="num">Expenses {money(d.expenses)}</div>
                    <div className="num">Net {money(d.net)}</div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5" aria-hidden>
            {data.map((d) => (
              <div key={d.month} className="flex-1 text-center">
                <div className="text-[10px] text-faint">{monthName(d.month)}</div>
                <div className={cn('text-[10px] font-medium num', n(d.net) < 0 ? 'text-danger' : n(d.net) > 0 ? 'text-success' : 'text-faint')}>{n(d.net) === 0 ? '—' : `${n(d.net) < 0 ? '−' : ''}${short(n(d.net))}`}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-2xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent/85" /> Income</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warning/60" /> Expenses</span>
        <span>Net profit under each month</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {active ? `${monthName(active.month)} ${active.month.slice(0, 4)}: income ${money(active.income)}, expenses ${money(active.expenses)}, net ${money(active.net)}` : ''}
      </p>
      <table className="sr-only">
        <thead>
          <tr><th>Month</th><th>Income</th><th>Expenses</th><th>Net</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}><th scope="row">{monthName(d.month)} {d.month.slice(0, 4)}</th><td>{money(d.income)}</td><td>{money(d.expenses)}</td><td>{money(d.net)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerDrawer({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const qs = new URLSearchParams();
  if (range.from) qs.set('from', range.from);
  if (range.to) qs.set('to', range.to);
  const q = useQuery({ queryKey: ['gl', accountId, qs.toString()], queryFn: () => api<Ledger>(`/accounting/accounts/${accountId}/ledger?${qs.toString()}`), enabled: !range.from || !range.to || range.from <= range.to });
  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={q.data ? `${q.data.account.code} · ${q.data.account.name}` : 'General ledger'} subtitle={q.data ? `${q.data.account.type.toLowerCase()} account · running balance on its natural side` : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} />
        <Button variant="ghost" className="text-xs" onClick={() => setRange({ from: '', to: '' })}>All time</Button>
      </div>
      {q.isLoading ? (
        <SkeletonRows rows={6} cols={5} />
      ) : q.error || !q.data ? (
        <ErrorState message="Failed to load ledger." retry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Opening" value={money(q.data.opening)} />
            <Stat label="Closing" value={money(q.data.closing)} />
          </div>
          {q.data.rows.length === 0 ? (
            <EmptyState title="No postings in this period" />
          ) : (
            <Table head={<tr><Th>Date</Th><Th>Entry</Th><Th>Narration</Th><Th right>Debit</Th><Th right>Credit</Th><Th right>Balance</Th></tr>}>
              {q.data.rows.map((r, i) => (
                <Tr key={`${r.entryId}-${i}`}>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(r.date)}</Td>
                  <Td className="font-mono text-xs">
                    {r.entryNumber}
                    {r.reversed ? <span className="ml-1 text-[10px] text-danger">reversed</span> : null}
                  </Td>
                  <Td className="max-w-[260px] text-xs">
                    <span className="block truncate">{r.memo}</span>
                    {r.sourceType ? <span className="text-[10px] text-faint">{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</span> : null}
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

function ManualJournal({ accounts, lockedMonths, onDone }: { accounts: Account[]; lockedMonths: Set<string>; onDone: () => void }) {
  const blank = () => ({ accountId: '', debit: '', credit: '' });
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([blank(), blank()]);
  const [confirm, setConfirm] = useState(false);
  const { errors, setErrors, clear } = useFieldErrors();
  const dr = lines.reduce((s, l) => s + Math.round(n(l.debit) * 100), 0);
  const cr = lines.reduce((s, l) => s + Math.round(n(l.credit) * 100), 0);
  const filled = lines.filter((l) => l.accountId && (n(l.debit) > 0 || n(l.credit) > 0));
  const post = useMutation({
    meta: { silent: true, silentError: true },
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
      toast.success(`Journal ${e.entryNumber} posted`, `Dr = Cr ${money(dr / 100)}`);
      setMemo('');
      setLines([blank(), blank()]);
      setConfirm(false);
      onDone();
    },
    onError: (e) => {
      setConfirm(false);
      toast.error('Journal not posted', errorText(e, 'Try again'));
    },
  });
  const review = () => {
    const next: Record<string, string> = {};
    if (memo.trim().length < 3) next.memo = 'Write a narration (min 3 characters)';
    if (date > todayIso()) next.date = 'Journals cannot be future-dated';
    else if (lockedMonths.has(date.slice(0, 7))) next.date = `${date.slice(0, 7)} is locked — reopen it first`;
    if (filled.length < 2) next.lines = 'Use at least two accounts';
    else if (dr !== cr) next.lines = `Debits and credits differ by ${money(Math.abs(dr - cr) / 100)}`;
    if (new Set(filled.map((l) => l.accountId)).size !== filled.length) next.lines = 'Each account can appear once';
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error('Please fix the journal', Object.values(next)[0]);
      return;
    }
    setConfirm(true);
  };
  return (
    <Card title="Manual journal voucher">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Date" error={errors.date}>
          <Input type="date" max={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); clear('date'); }} />
        </Field>
        <div className="sm:col-span-3">
          <Field label="Narration" required error={errors.memo}>
            <Input value={memo} onChange={(e) => { setMemo(e.target.value); clear('memo'); }} placeholder="e.g. Owner capital introduced into bank" maxLength={300} />
          </Field>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_7rem_2.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_2.5rem]">
            <Select className="min-w-0" value={l.accountId} aria-label={`Account ${i + 1}`} onChange={(e) => { setLines((s) => s.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x))); clear('lines'); }}>
              <option value="">Account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </Select>
            <MoneyInput placeholder="Debit" aria-label={`Debit ${i + 1}`} value={l.debit} onChange={(v) => { setLines((s) => s.map((x, j) => (j === i ? { ...x, debit: v, credit: v ? '' : x.credit } : x))); clear('lines'); }} />
            <MoneyInput placeholder="Credit" aria-label={`Credit ${i + 1}`} value={l.credit} onChange={(v) => { setLines((s) => s.map((x, j) => (j === i ? { ...x, credit: v, debit: v ? '' : x.debit } : x))); clear('lines'); }} />
            <Button variant="ghost" className="px-2" disabled={lines.length <= 2} onClick={() => setLines((s) => s.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}><Icon name="close" size={14} /></Button>
          </div>
        ))}
      </div>
      {errors.lines ? <p className="mt-1 text-xs text-danger">{errors.lines}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button variant="secondary" onClick={() => setLines((s) => [...s, blank()])} disabled={lines.length >= 50}><Icon name="plus" size={15} strokeWidth={2.25} /> Line</Button>
        <span className={cn('text-sm num', dr === cr ? 'text-success' : 'text-danger')}>
          Dr {money(dr / 100)} · Cr {money(cr / 100)} {dr === cr ? <span className="inline-flex items-center gap-0.5 text-success"><Icon name="check" size={12} strokeWidth={2.5} /> balanced</span> : `· difference ${money(Math.abs(dr - cr) / 100)}`}
        </span>
      </div>
      <div className="mt-3"><Button onClick={review}>Review & post</Button></div>
      <ConfirmDialog
        open={confirm}
        title="Post this journal?"
        message={<>Dated {fmtDate(date)} · {filled.length} lines · {money(dr / 100)}. Posted journals cannot be edited; correct them with a reversal.</>}
        confirmLabel="Post journal"
        busy={post.isPending}
        onConfirm={() => post.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

function ExpenseForm({ lockedMonths, onDone }: { lockedMonths: Set<string>; onDone: () => void }) {
  const blank = { category: '', payee: '', amount: '', method: 'CASH' as 'CASH' | 'BANK' | 'UPI', expenseDate: todayIso(), notes: '' };
  const [f, setF] = useState(blank);
  const { errors, clear, validate } = useFieldErrors();
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    clear(k);
  };
  const locked = lockedMonths.has(f.expenseDate.slice(0, 7));
  const save = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (body: Record<string, unknown>) => api<{ expenseNumber: string }>('/accounting/expenses', { method: 'POST', body }),
    onSuccess: (e) => {
      toast.success(`Expense ${e.expenseNumber} recorded`, `${money(f.amount)} to ${f.payee} — Dr expenses, Cr ${METHOD_LABEL[f.method]?.toLowerCase()}`);
      setF({ ...blank, method: f.method, expenseDate: f.expenseDate });
      onDone();
    },
    onError: (e) => toast.error('Expense not recorded', errorText(e, 'Try again')),
  });
  const submit = () => {
    const body = { ...f, amount: f.amount ? n(f.amount).toFixed(2) : '', notes: f.notes.trim() || null };
    const extra: Record<string, string> = locked ? { expenseDate: `${f.expenseDate.slice(0, 7)} is locked — pick another date or reopen the month` } : {};
    if (f.method === 'CASH' && n(f.amount) > 10000) extra.method = 'Cash expenses above ₹10,000 are disallowed under Income Tax s.40A(3) — pay by bank or UPI';
    if (!validate(expenseCreateSchema, body, extra)) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    save.mutate(body);
  };
  return (
    <Card title="Record expense">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category" required error={errors.category}>
          <Input list="expense-categories" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Rent, Electricity, Salaries…" />
          <datalist id="expense-categories">
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field label="Payee" required error={errors.payee}>
          <Input value={f.payee} onChange={(e) => set('payee', e.target.value)} placeholder="Who was paid" />
        </Field>
        <Field label="Amount (₹)" required error={errors.amount}>
          <MoneyInput value={f.amount} onChange={(v) => set('amount', v)} invalid={Boolean(errors.amount)} />
        </Field>
        <Field label="Paid via" error={errors.method}>
          <div className="inline-flex w-full rounded-lg border border-line bg-subtle p-0.5">
            {(['CASH', 'BANK', 'UPI'] as const).map((m) => (
              <button key={m} type="button" onClick={() => set('method', m)} className={cn('flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all', f.method === m ? 'bg-surface text-teal-ink ring-1 ring-line' : 'text-muted hover:text-ink')}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Date" required error={errors.expenseDate} hint={locked ? undefined : 'Posting date in the books'}>
          <Input type="date" max={todayIso()} value={f.expenseDate} onChange={(e) => set('expenseDate', e.target.value)} />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <Input value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} placeholder="Bill no., period…" />
        </Field>
      </div>
      {locked ? <Alert tone="warning" icon="lock" className="mt-2">{f.expenseDate.slice(0, 7)} is locked. Postings dated in a locked month are refused.</Alert> : null}
      <div className="mt-3">
        <Button onClick={submit} disabled={save.isPending}>{save.isPending ? 'Posting…' : 'Record expense'}</Button>
      </div>
    </Card>
  );
}

export default function AccountingPage() {
  const qc = useQueryClient();
  const can = useCan();
  const canPost = can('accounting.post');
  const canExport = can('reports.export');
  const fys = useMemo(fyOptions, []);
  const [tab, setTab] = useState<Tab>('pnl');
  const [fyLabel, setFyLabel] = useState(fys[0]!.label);
  const [range, setRange] = useState<DateRange>({ from: fys[0]!.from, to: fys[0]!.to });
  const [asOf, setAsOf] = useState(todayIso());
  const [sourceType, setSourceType] = useState('');
  const [journalPage, setJournalPage] = useState(1);
  const [glAccount, setGlAccount] = useState<string | null>(null);
  const [reversing, setReversing] = useState<JournalRow | null>(null);
  const [lockTarget, setLockTarget] = useState<{ month: string; locked: boolean } | null>(null);
  const [lockMonth, setLockMonth] = useState(todayIso().slice(0, 7));
  const [expCategory, setExpCategory] = useState('');
  const [expMethod, setExpMethod] = useState('');
  const [expSearch, setExpSearch] = useState('');
  const [expPage, setExpPage] = useState(1);
  const dExpSearch = useDebouncedValue(expSearch.trim(), 300);

  const validRange = !range.from || !range.to || range.from <= range.to;
  const rq = `from=${range.from}&to=${range.to}`;
  const pickFy = (label: string) => {
    setFyLabel(label);
    const f = fys.find((x) => x.label === label);
    if (f) {
      setRange({ from: f.from, to: f.to });
      setAsOf(f.to);
    }
  };

  const pnl = useQuery({ queryKey: ['pnl', rq], queryFn: () => api<Pnl>(`/accounting/profit-and-loss?${rq}`), enabled: validRange });
  const trend = useQuery({ queryKey: ['pnl-trend', rq], queryFn: () => api<Array<{ month: string; income: string; expenses: string; net: string }>>(`/accounting/profit-and-loss/trend?${rq}`), enabled: validRange && tab === 'pnl' });
  const tb = useQuery({ queryKey: ['trial-balance', asOf], queryFn: () => api<{ rows: TBRow[]; totalDebits: string; totalCredits: string; balanced: boolean }>(`/accounting/trial-balance?asOf=${asOf}`), enabled: tab === 'tb' });
  const bs = useQuery({ queryKey: ['balance-sheet', asOf], queryFn: () => api<BalanceSheet>(`/accounting/balance-sheet?asOf=${asOf}`), enabled: tab === 'bs' });
  const journals = useQuery({
    queryKey: ['journals', sourceType, journalPage],
    queryFn: () => api<{ items: JournalRow[]; pageInfo: PageInfo }>(`/accounting/journals?page=${journalPage}&pageSize=20${sourceType ? `&sourceType=${sourceType}` : ''}`),
    enabled: tab === 'journals',
    placeholderData: (prev) => prev,
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounting/accounts'), enabled: canPost && tab === 'journals' });
  const periods = useQuery({ queryKey: ['periods'], queryFn: () => api<Period[]>('/accounting/periods') });
  const lockedMonths = useMemo(() => new Set((periods.data ?? []).filter((p) => p.status === 'LOCKED').map((p) => p.periodLabel)), [periods.data]);

  const expQs = new URLSearchParams({ page: String(expPage), pageSize: '15' });
  if (range.from) expQs.set('from', range.from);
  if (range.to) expQs.set('to', range.to);
  if (expCategory) expQs.set('category', expCategory);
  if (expMethod) expQs.set('method', expMethod);
  if (dExpSearch) expQs.set('search', dExpSearch);
  const expenses = useQuery({
    queryKey: ['expenses', expQs.toString()],
    queryFn: () => api<{ items: ExpenseRow[]; total: string; pageInfo: PageInfo }>(`/accounting/expenses?${expQs.toString()}`),
    enabled: tab === 'expenses' && validRange,
    placeholderData: (prev) => prev,
  });
  const expSummary = useQuery({
    queryKey: ['expense-summary', rq],
    queryFn: () => api<ExpenseSummary>(`/accounting/expenses/summary?${rq}`),
    enabled: (tab === 'expenses' || tab === 'pnl') && validRange,
  });

  const invalidate = () => {
    for (const k of ['pnl', 'pnl-trend', 'trial-balance', 'balance-sheet', 'journals', 'periods', 'gl', 'dashboard', 'expenses', 'expense-summary']) void qc.invalidateQueries({ queryKey: [k] });
  };

  const reverse = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (v: { j: JournalRow; memo: string }) => api<{ entryNumber: string; originalEntryNumber: string }>(`/accounting/journals/${v.j.id}/reverse`, { method: 'POST', body: { memo: v.memo } }),
    onSuccess: (r) => {
      toast.success(`Reversal ${r.entryNumber} posted`, `Cancels ${r.originalEntryNumber}; the original stays on record`);
      setReversing(null);
      invalidate();
    },
    onError: (e) => toast.error('Reversal failed', errorText(e, 'Try again')),
  });
  const lock = useMutation({
    meta: { silent: true, silentError: true },
    mutationFn: (v: { month: string; locked: boolean }) => api('/accounting/periods/lock', { method: 'POST', body: { periodLabel: v.month, locked: v.locked } }),
    onSuccess: (_d, v) => {
      toast.success(v.locked ? `${v.month} locked` : `${v.month} reopened`, v.locked ? 'No posting can be dated in this month now' : 'Postings are allowed again');
      setLockTarget(null);
      invalidate();
    },
    onError: (e) => toast.error('Period lock not changed', errorText(e, 'Try again')),
  });

  const exportCsv = async (path: string, name: string) => {
    try {
      await downloadCsv(path, name);
      toast.success('Export ready', name);
    } catch (e) {
      toast.error('Export failed', errorText(e, 'Try again'));
    }
  };

  const p = pnl.data;
  const margin = p && n(p.netSales) ? (n(p.grossProfit) / n(p.netSales)) * 100 : 0;
  const opex = (expSummary.data?.byCategory ?? []).map((c) => ({ label: c.category, value: n(c.amount) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounting"
        subtitle="Double-entry books posted automatically from every sale, purchase, payment, return and stock movement."
        actions={
          <Select value={fyLabel} onChange={(e) => pickFy(e.target.value)} className="w-full sm:w-40" aria-label="Financial year">
            {fys.map((f) => (
              <option key={f.label} value={f.label}>{f.label}</option>
            ))}
            <option value="custom">Custom range</option>
          </Select>
        }
      />
      {fyLabel === 'custom' ? (
        <Card>
          <DateRangePicker value={range} onChange={setRange} />
        </Card>
      ) : null}

      <KpiGrid bare cols={4}>
        <Stat label="Net sales" value={p ? money(p.netSales) : '…'} hint={`${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
        <Stat label="Gross profit" value={p ? money(p.grossProfit) : '…'} hint={p ? `${margin.toFixed(1)}% margin` : undefined} />
        <Stat label="Operating expenses" value={expSummary.data ? money(expSummary.data.total) : '…'} hint={expSummary.data ? `${expSummary.data.count} voucher${expSummary.data.count === 1 ? '' : 's'}` : undefined} tone={expSummary.data && Number(expSummary.data.total) > 0 ? 'amber' : 'neutral'} />
        <Stat label="Net profit" value={p ? money(p.netProfit) : '…'} tone={p && n(p.netProfit) < 0 ? 'red' : p && n(p.netProfit) > 0 ? 'green' : 'neutral'} />
      </KpiGrid>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'pnl', label: 'Profit & loss' },
          { id: 'tb', label: 'Trial balance' },
          { id: 'bs', label: 'Balance sheet' },
          { id: 'journals', label: 'Journals' },
          { id: 'expenses', label: 'Expenses & periods', count: lockedMonths.size || undefined },
        ]}
      />

      {tab === 'pnl' ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Monthly trend" className="lg:col-span-2">
              {trend.isLoading ? <SkeletonRows rows={4} cols={1} /> : <TrendChart data={trend.data ?? []} />}
            </Card>
            <Card title="Where the money went">
              <Donut data={opex} format={(v) => money(v)} centerLabel="Opex" />
            </Card>
          </div>
          <Card
            title="Profit & loss statement"
            actions={canExport ? <Button variant="secondary" onClick={() => void exportCsv(`/accounting/profit-and-loss/export?${rq}`, `profit-and-loss-${range.from}-${range.to}.csv`)}><Icon name="download" size={14} /> CSV</Button> : null}
          >
            {pnl.isLoading ? (
              <SkeletonRows rows={6} cols={3} />
            ) : pnl.error || !p ? (
              <ErrorState message="Failed to load P&L." retry={() => void pnl.refetch()} />
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {(['income', 'expenses'] as const).map((side) => (
                  <div key={side}>
                    <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.06em] text-faint">{side === 'income' ? 'Income' : 'Expenses'}</h3>
                    <div className="divide-y divide-line">
                      {p[side].filter((r) => n(r.amount) !== 0).map((r) => (
                        <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between gap-4 px-1 py-2 text-left text-[13px] transition-colors hover:bg-mint/40">
                          <span><span className="font-mono text-xs text-faint">{r.code}</span> {r.name}</span>
                          <Signed value={r.amount} />
                        </button>
                      ))}
                      <div className="flex justify-between border-t border-neutral-300 px-1 py-2 text-[13px] font-medium text-ink">
                        <span>Total {side}</span>
                        <span className="num">{money(side === 'income' ? p.totalIncome : p.totalExpenses)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className={cn('border-t border-ink/30 px-1 pt-3 md:col-span-2', n(p.netProfit) > 0 ? 'text-success' : n(p.netProfit) < 0 ? 'text-danger' : 'text-ink')}>
                  <div className="flex justify-between text-section font-[550]">
                    <span>Net {n(p.netProfit) >= 0 ? 'profit' : 'loss'}</span>
                    <span className="num">{money(Math.abs(n(p.netProfit)))}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'tb' ? (
        <Card
          title="Trial balance"
          actions={
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted">as of</span>
              <Input type="date" className="w-36" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value || todayIso())} />
              {tb.data ? <Badge tone={tb.data.balanced ? 'green' : 'red'} dot>{tb.data.balanced ? 'Balanced' : 'Unbalanced'}</Badge> : null}
            </div>
          }
        >
          {tb.isLoading ? (
            <SkeletonRows rows={8} cols={5} />
          ) : tb.error || !tb.data ? (
            <ErrorState message="Failed to load trial balance." retry={() => void tb.refetch()} />
          ) : (
            <Table head={<tr><Th>Code</Th><Th>Account</Th><Th>Type</Th><Th right>Debit</Th><Th right>Credit</Th></tr>}>
              {tb.data.rows.filter((r) => n(r.debit) !== 0 || n(r.credit) !== 0).map((r) => (
                <Tr key={r.accountId} onClick={() => setGlAccount(r.accountId)}>
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td className="text-sm text-brand-deep">{r.name}</Td>
                  <Td><Badge>{r.type.toLowerCase()}</Badge></Td>
                  <Td right>{n(r.debit) ? money(r.debit, false) : ''}</Td>
                  <Td right>{n(r.credit) ? money(r.credit, false) : ''}</Td>
                </Tr>
              ))}
              <Tr className="font-medium text-ink [&>td]:border-t [&>td]:border-neutral-300">
                <Td />
                <Td>Total</Td>
                <Td />
                <Td right>{money(tb.data.totalDebits, false)}</Td>
                <Td right>{money(tb.data.totalCredits, false)}</Td>
              </Tr>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted">Click any account to drill into its general ledger.</p>
        </Card>
      ) : null}

      {tab === 'bs' ? (
        <Card
          title="Balance sheet"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted">as of</span>
              <Input type="date" className="w-36" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value || todayIso())} />
              {bs.data ? <Badge tone={bs.data.balanced ? 'green' : 'red'} dot>{bs.data.balanced ? 'Assets = Liabilities + Equity' : 'Out of balance'}</Badge> : null}
              {canExport ? <Button variant="secondary" onClick={() => void exportCsv(`/accounting/balance-sheet/export?asOf=${asOf}`, `balance-sheet-${asOf}.csv`)}><Icon name="download" size={14} /> CSV</Button> : null}
            </div>
          }
        >
          {bs.isLoading ? (
            <SkeletonRows rows={8} cols={2} />
          ) : bs.error || !bs.data ? (
            <ErrorState message="Failed to load balance sheet." retry={() => void bs.refetch()} />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.06em] text-faint">Assets</h3>
                {bs.data.assets.filter((r) => n(r.amount) !== 0).map((r) => (
                  <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between gap-4 border-b border-line px-1 py-2 text-left text-[13px] transition-colors hover:bg-mint/40">
                    <span>{r.name}</span>
                    <Signed value={r.amount} />
                  </button>
                ))}
                {bs.data.assets.some((r) => n(r.amount) < 0 && /cash|bank/i.test(r.name)) ? (
                  <Alert tone="warning" className="mt-1">
                    A cash or bank balance is negative — payments were recorded before the money was received. Record the opening capital or receipts.
                  </Alert>
                ) : null}
                <div className="mt-1 flex justify-between border-t border-neutral-300 px-1 pt-2 font-medium text-ink">
                  <span>Total assets</span>
                  <span className="num">{money(bs.data.totalAssets)}</span>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.06em] text-faint">Liabilities</h3>
                {bs.data.liabilities.filter((r) => n(r.amount) !== 0).map((r) => (
                  <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between gap-4 border-b border-line px-1 py-2 text-left text-[13px] transition-colors hover:bg-mint/40">
                    <span>{r.name}</span>
                    <Signed value={r.amount} />
                  </button>
                ))}
                <div className="flex justify-between px-1 py-1.5 text-sm font-medium text-neutral-600">
                  <span>Total liabilities</span>
                  <span className="num">{money(bs.data.totalLiabilities)}</span>
                </div>
                <h3 className="mb-2 mt-4 text-2xs font-medium uppercase tracking-[0.06em] text-faint">Equity</h3>
                {bs.data.equity.filter((r) => n(r.amount) !== 0).map((r) => (
                  <button key={r.accountId} onClick={() => setGlAccount(r.accountId)} className="flex w-full justify-between gap-4 border-b border-line px-1 py-2 text-left text-[13px] transition-colors hover:bg-mint/40">
                    <span>{r.name}</span>
                    <Signed value={r.amount} />
                  </button>
                ))}
                <div className="flex justify-between px-1 py-1.5 text-sm">
                  <span>Current period profit / (loss)</span>
                  <Signed value={bs.data.retainedEarnings} />
                </div>
                <div className="mt-1 flex justify-between border-t border-neutral-300 px-1 pt-2 font-medium text-ink">
                  <span>Liabilities + equity</span>
                  <span className="num">{money(n(bs.data.totalLiabilities) + n(bs.data.totalEquity))}</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'journals' ? (
        <>
          {canPost && accounts.data ? <ManualJournal accounts={accounts.data} lockedMonths={lockedMonths} onDone={invalidate} /> : null}
          <Card
            title={`Journal entries (${journals.data?.pageInfo.totalItems ?? 0})`}
            actions={
              <Select className="w-full sm:w-48" value={sourceType} onChange={(e) => { setSourceType(e.target.value); setJournalPage(1); }} aria-label="Source">
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
              <>
                <div className="-mx-4 divide-y divide-line border-t border-line">
                  {journals.data?.items.map((j) => {
                    const total = j.lines.reduce((s, l) => s + n(l.debit), 0);
                    const canReverse = canPost && !j.reversedById && j.sourceType !== 'JOURNAL_REVERSAL';
                    return (
                      <div key={j.id} className={cn('px-4 py-3', j.reversedById && 'bg-subtle/50 opacity-75')}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-ink">{j.entryNumber}</span>
                            <span className="text-xs text-faint">{fmtDate(j.entryDate)}</span>
                            {j.sourceType ? <Badge tone={j.sourceType === 'JOURNAL_REVERSAL' ? 'red' : j.sourceType === 'MANUAL' ? 'blue' : 'neutral'}>{SOURCE_LABEL[j.sourceType] ?? j.sourceType}</Badge> : null}
                            {j.reversedById ? <Badge tone="red">Reversed</Badge> : null}
                            {lockedMonths.has(j.entryDate.slice(0, 7)) ? <Badge tone="amber"><Icon name="lock" size={12} /> locked month</Badge> : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold num">{money(total)}</span>
                            {canReverse ? (
                              <Button variant="ghost" className="text-xs" onClick={() => setReversing(j)}><Icon name="reverse" size={14} /> Reverse</Button>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-600">{j.memo}</p>
                        <div className="mt-1.5 grid grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
                          {j.lines.map((l, i) => (
                            <div key={i} className="flex justify-between border-b border-dashed border-line py-0.5">
                              <span className={n(l.credit) > 0 ? 'pl-4 text-muted' : 'text-neutral-700'}>
                                {n(l.credit) > 0 ? 'To ' : ''}{l.account.name}
                              </span>
                              <span className="num">{n(l.debit) > 0 ? `Dr ${money(l.debit, false)}` : `Cr ${money(l.credit, false)}`}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Pagination info={journals.data?.pageInfo} onChange={setJournalPage} label="entries" />
              </>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'expenses' ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {canPost ? <ExpenseForm lockedMonths={lockedMonths} onDone={invalidate} /> : null}
            <Card title="Spend by category">
              <Donut data={opex} format={(v) => money(v)} centerLabel={expSummary.data ? money(expSummary.data.total) : ''} />
            </Card>
          </div>
          <Card title={`Expense vouchers (${expenses.data?.pageInfo.totalItems ?? 0}) · ${money(expenses.data?.total ?? 0)}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SearchInput value={expSearch} onChange={(v) => { setExpSearch(v); setExpPage(1); }} placeholder="Payee, voucher no., notes" className="w-full sm:w-60" />
              <Select value={expCategory} onChange={(e) => { setExpCategory(e.target.value); setExpPage(1); }} className="w-full sm:w-48" aria-label="Category">
                <option value="">All categories</option>
                {[...new Set([...(expSummary.data?.byCategory.map((c) => c.category) ?? []), ...EXPENSE_CATEGORIES])].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
              <FilterChips options={[{ id: 'CASH', label: 'Cash' }, { id: 'BANK', label: 'Bank' }, { id: 'UPI', label: 'UPI' }]} value={expMethod} onChange={(v) => { setExpMethod(v); setExpPage(1); }} />
            </div>
            {expenses.isLoading ? (
              <SkeletonRows rows={5} cols={5} />
            ) : expenses.error ? (
              <ErrorState message="Failed to load expenses." retry={() => void expenses.refetch()} />
            ) : (expenses.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="No expenses in this view" hint="Change the financial year or filters, or record one above." />
            ) : (
              <>
                <Table head={<tr><Th>Date</Th><Th>Voucher</Th><Th>Category</Th><Th>Payee</Th><Th>Via</Th><Th right>Amount</Th></tr>}>
                  {expenses.data?.items.map((x) => (
                    <Tr key={x.id}>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(x.expenseDate)}</Td>
                      <Td className="font-mono text-xs">{x.expenseNumber}</Td>
                      <Td><Badge>{x.category}</Badge></Td>
                      <Td className="text-sm">
                        {x.payee}
                        {x.notes ? <div className="max-w-[220px] truncate text-2xs text-muted" title={x.notes}>{x.notes}</div> : null}
                      </Td>
                      <Td className="text-xs">{METHOD_LABEL[x.method]}</Td>
                      <Td right className="font-semibold">{money(x.amount)}</Td>
                    </Tr>
                  ))}
                </Table>
                <Pagination info={expenses.data?.pageInfo} onChange={setExpPage} label="vouchers" />
              </>
            )}
          </Card>
          <Card title="Accounting periods">
            <p className="mb-3 text-xs text-muted">Lock a month after GST returns are filed. Locking blocks any posting — including reversals and backdated documents — dated inside it.</p>
            {canPost ? (
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <Field label="Month">
                  <Input type="month" value={lockMonth} max={todayIso().slice(0, 7)} onChange={(e) => setLockMonth(e.target.value)} />
                </Field>
                <Button variant="secondary" disabled={!lockMonth || lockedMonths.has(lockMonth)} onClick={() => setLockTarget({ month: lockMonth, locked: true })}><Icon name="lock" size={12} /> Lock</Button>
                <Button variant="ghost" disabled={!lockMonth || !lockedMonths.has(lockMonth)} onClick={() => setLockTarget({ month: lockMonth, locked: false })}>Reopen</Button>
              </div>
            ) : null}
            {(periods.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">All periods are open.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {periods.data?.map((pr) => (
                  <div key={pr.id} className="flex items-center justify-between rounded-md border border-line px-3 py-1.5 text-[13px]">
                    <span className="font-mono">{monthName(pr.periodLabel)} {pr.periodLabel.slice(0, 4)}</span>
                    <StatusBadge status={pr.status} tone={pr.status === 'LOCKED' ? 'red' : 'green'} label={`${pr.status.charAt(0)}${pr.status.slice(1).toLowerCase()}${pr.lockedAt ? ` · ${fmtDate(pr.lockedAt)}` : ''}`} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}

      <ConfirmDialog
        open={Boolean(reversing)}
        tone="danger"
        title={`Reverse ${reversing?.entryNumber ?? ''}?`}
        message="A mirror entry is posted today; the original stays on record for audit."
        confirmLabel="Post reversal"
        busy={reverse.isPending}
        reason={{ label: 'Reason', minLength: 3, placeholder: 'Wrong account, duplicate entry…' }}
        onConfirm={(memo) => reversing && reverse.mutate({ j: reversing, memo: memo ?? '' })}
        onCancel={() => setReversing(null)}
      />
      <ConfirmDialog
        open={Boolean(lockTarget)}
        tone={lockTarget?.locked ? 'danger' : 'primary'}
        title={lockTarget?.locked ? `Lock ${lockTarget.month}?` : `Reopen ${lockTarget?.month ?? ''}?`}
        message={lockTarget?.locked ? 'Nothing can be posted, reversed or backdated into this month until it is reopened.' : 'Reopening allows changes to a month that may already be reported in GST returns.'}
        confirmLabel={lockTarget?.locked ? 'Lock month' : 'Reopen month'}
        busy={lock.isPending}
        onConfirm={() => lockTarget && lock.mutate(lockTarget)}
        onCancel={() => setLockTarget(null)}
      />
      {glAccount ? <LedgerDrawer accountId={glAccount} onClose={() => setGlAccount(null)} /> : null}
    </div>
  );
}
