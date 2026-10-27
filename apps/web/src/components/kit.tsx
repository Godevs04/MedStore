'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ZodTypeAny } from 'zod';
import { financialYearOf, INDIAN_STATE_CODES, isValidGstinChecksum, panFromGstin, stateName, zodFieldErrors } from '@medicore/validation';
import { Icon, type IconName } from './icons';
import { Button, cn, Input, Select, Textarea, todayIso } from './ui';

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Returns `value` after it has stopped changing for `delay` ms (search boxes). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases a number from its previous value to `target` (respects reduced motion). */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (prefersReducedMotion() || start === target) {
      from.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(start + (target - start) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/**
 * Field errors driven by a Zod schema. `validate` returns the parsed data or
 * null (and populates `errors`); `setServerErrors` maps API `details` inline.
 */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return {
    errors,
    setErrors,
    clear: (field?: string) =>
      setErrors((prev) => {
        if (!field) return {};
        if (!(field in prev)) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      }),
    validate<S extends ZodTypeAny>(schema: S, data: unknown, extra: Record<string, string> = {}): ReturnType<S['parse']> | null {
      const result = schema.safeParse(data);
      const next = { ...(result.success ? {} : zodFieldErrors(result.error)), ...extra };
      setErrors(next);
      return result.success && Object.keys(extra).length === 0 ? (result.data as ReturnType<S['parse']>) : null;
    },
    setServerErrors(details: Array<{ field?: string; message: string }> | undefined) {
      if (!details?.length) return false;
      const next: Record<string, string> = {};
      for (const d of details) if (d.field && !(d.field in next)) next[d.field] = d.message;
      setErrors(next);
      return Object.keys(next).length > 0;
    },
  };
}

// ── Numbers & charts ─────────────────────────────────────────────────────────

export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN') }: { value: number; format?: (n: number) => string }) {
  const shown = useCountUp(value);
  return <span className="tabular-nums">{format(shown)}</span>;
}

/** Tiny inline trend line (no axes). */
export function Sparkline({ values, className, tone = 'brand' }: { values: number[]; className?: string; tone?: 'brand' | 'red' | 'amber' }) {
  const id = useId();
  if (values.length < 2) return <div className={cn('h-10', className)} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 36 - ((v - min) / span) * 32]);
  const line = pts.map(([x, y]) => `${x!.toFixed(2)},${y!.toFixed(2)}`).join(' ');
  const stroke = { brand: '#0d9488', red: '#dc2626', amber: '#d97706' }[tone];
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={cn('h-10 w-full overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${line} 100,40`} fill={`url(#${id})`} className="mc-anim-fade-in" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" className="mc-draw-line" />
    </svg>
  );
}

/** Vertical bar chart with a y-axis scale and hover tooltip. */
export function BarChart({
  data,
  format = (n) => n.toLocaleString('en-IN'),
  height = 180,
  tone = 'brand',
}: {
  data: Array<{ label: string; value: number; hint?: string }>;
  format?: (n: number) => string;
  height?: number;
  tone?: 'brand' | 'amber' | 'red';
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const niceMax = max <= 0 ? 1 : Math.pow(10, Math.floor(Math.log10(max))) * Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max))));
  const ticks = [niceMax, niceMax / 2, 0];
  const bar = { brand: 'from-brand-500 to-brand-300', amber: 'from-amber-500 to-amber-300', red: 'from-red-500 to-red-300' }[tone];
  if (data.length === 0) return <p className="py-8 text-center text-xs text-neutral-400">No data for this period.</p>;
  return (
    <div className="flex gap-2">
      <div className="flex flex-col justify-between pb-5 text-right text-[10px] tabular-nums text-neutral-400" style={{ height }}>
        {ticks.map((t) => (
          <span key={t}>{format(t)}</span>
        ))}
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: height - 20 }}>
          {ticks.map((t) => (
            <span key={t} className="border-t border-dashed border-neutral-200" />
          ))}
        </div>
        <div className="relative flex items-end gap-1" style={{ height: height - 20 }}>
          {data.map((d, i) => (
            <div
              key={`${d.label}-${i}`}
              className="group relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={cn('mc-anim-grow w-full origin-bottom rounded-t-md bg-gradient-to-t transition-opacity', bar, hover !== null && hover !== i && 'opacity-50')}
                style={{ height: `${(d.value / niceMax) * 100}%`, minHeight: d.value > 0 ? 3 : 0, animationDelay: `${Math.min(i, 30) * 18}ms` }}
              />
              {hover === i ? (
                <div className="mc-anim-scale-in pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-900 px-2 py-1 text-[11px] text-white shadow-lg">
                  <p className="font-semibold">{format(d.value)}</p>
                  <p className="text-neutral-300">{d.hint ?? d.label}</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1 text-[10px] text-neutral-400">
          {data.map((d, i) => (
            <span key={`${d.label}-${i}`} className="flex-1 truncate text-center">
              {data.length > 16 && i % Math.ceil(data.length / 8) !== 0 ? '' : d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const DONUT_COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#84cc16', '#64748b'];

/** Donut with legend for a share breakdown (payment mix, reasons). */
export function Donut({
  data,
  format = (n) => n.toLocaleString('en-IN'),
  centerLabel,
}: {
  data: Array<{ label: string; value: number }>;
  format?: (n: number) => string;
  centerLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = 15.915;
  let offset = 25;
  if (total <= 0) return <p className="py-8 text-center text-xs text-neutral-400">Nothing recorded yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0 -rotate-0" aria-hidden>
        <circle cx="21" cy="21" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="5" />
        {data.map((d, i) => {
          const pct = (d.value / total) * 100;
          const el = (
            <circle
              key={d.label}
              cx="21"
              cy="21"
              r={radius}
              fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="5"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
              className="mc-anim-fade-in"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          );
          offset -= pct;
          return el;
        })}
        <text x="21" y="20" textAnchor="middle" className="fill-neutral-900 text-[5px] font-semibold">
          {format(total)}
        </text>
        <text x="21" y="26" textAnchor="middle" className="fill-neutral-400 text-[3px]">
          {centerLabel ?? 'Total'}
        </text>
      </svg>
      <ul className="min-w-[10rem] flex-1 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="mc-anim-fade-up flex items-center gap-2" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="flex-1 text-neutral-600">{d.label}</span>
            <span className="font-medium tabular-nums text-neutral-900">{format(d.value)}</span>
            <span className="w-10 text-right tabular-nums text-neutral-400">{((d.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal progress meter (0–100). */
export function Meter({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'amber' | 'red' | 'green'; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = { brand: 'bg-brand-500', amber: 'bg-amber-500', red: 'bg-red-500', green: 'bg-emerald-500' }[tone];
  return (
    <div className="space-y-1">
      {label ? <p className="text-[11px] text-neutral-500">{label}</p> : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('mc-anim-grow-x h-full origin-left rounded-full', bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Lists: pagination, sorting, filters ──────────────────────────────────────

export interface PageInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function Pagination({ info, onChange, label = 'rows' }: { info: PageInfo | undefined; onChange: (page: number) => void; label?: string }) {
  if (!info || info.totalItems === 0) return null;
  const { page, totalPages, totalItems, pageSize } = info;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(totalItems, page * pageSize);
  const pages = pageList(page, totalPages);
  return (
    <nav className="mc-anim-fade-in flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-neutral-500" aria-label="Pagination">
      <span>
        Showing <b className="font-semibold text-neutral-700">{first.toLocaleString('en-IN')}</b>–
        <b className="font-semibold text-neutral-700">{last.toLocaleString('en-IN')}</b> of {totalItems.toLocaleString('en-IN')} {label}
      </span>
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <PageButton disabled={page <= 1} onClick={() => onChange(page - 1)} label="Previous page">
            ‹
          </PageButton>
          {pages.map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <PageButton key={p} active={p === page} onClick={() => onChange(p)} label={`Page ${p}`}>
                {p}
              </PageButton>
            ),
          )}
          <PageButton disabled={page >= totalPages} onClick={() => onChange(page + 1)} label="Next page">
            ›
          </PageButton>
        </div>
      ) : null}
    </nav>
  );
}

function pageList(page: number, total: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let p = 1; p <= total; p += 1) {
    if (p === 1 || p === total || Math.abs(p - page) <= 1) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}

function PageButton({ children, active, disabled, onClick, label }: { children: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-w-[1.75rem] rounded-md px-2 py-1 font-medium transition-all duration-150 disabled:opacity-40',
        active ? 'bg-brand-600 text-white shadow-sm' : 'text-neutral-600 hover:bg-brand-50 hover:text-brand-700',
      )}
    >
      {children}
    </button>
  );
}

export interface SortState<F extends string> {
  field: F;
  direction: 'asc' | 'desc';
}

export function SortableTh<F extends string>({
  label,
  field,
  sort,
  onSort,
  right,
}: {
  label: string;
  field: F;
  sort: SortState<F>;
  onSort: (next: SortState<F>) => void;
  right?: boolean;
}) {
  const active = sort.field === field;
  return (
    <th className={cn('px-2 py-2 font-medium', right && 'text-right')} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort({ field, direction: active && sort.direction === 'desc' ? 'asc' : 'desc' })}
        className={cn('inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-brand-700', active && 'text-brand-700')}
      >
        {label}
        <Icon name="chevronDown" size={12} strokeWidth={2.25} className={cn('transition-transform duration-200', active ? 'opacity-100' : 'opacity-30', active && sort.direction === 'asc' && 'rotate-180')} />
      </button>
    </th>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  allLabel = 'All',
}: {
  options: Array<{ id: T; label: string; icon?: IconName; count?: number; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }>;
  value: T | '';
  onChange: (id: T | '') => void;
  allLabel?: string | null;
}) {
  const tones = {
    neutral: 'data-[on=true]:bg-neutral-800 data-[on=true]:text-white',
    green: 'data-[on=true]:bg-emerald-600 data-[on=true]:text-white',
    amber: 'data-[on=true]:bg-amber-500 data-[on=true]:text-white',
    red: 'data-[on=true]:bg-red-600 data-[on=true]:text-white',
    blue: 'data-[on=true]:bg-brand-600 data-[on=true]:text-white',
  };
  const chip = 'rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 transition-all duration-200 hover:border-brand-300 hover:text-brand-700 data-[on=true]:border-transparent data-[on=true]:shadow-sm active:scale-95';
  return (
    <div className="mc-anim-fade-in flex flex-wrap gap-1.5" role="group">
      {allLabel !== null ? (
        <button type="button" data-on={value === ''} onClick={() => onChange('')} className={cn(chip, tones.blue)}>
          {allLabel}
        </button>
      ) : null}
      {options.map((o) => (
        <button key={o.id} type="button" data-on={value === o.id} onClick={() => onChange(value === o.id && allLabel !== null ? '' : o.id)} className={cn(chip, tones[o.tone ?? 'blue'])}>
          {o.icon ? <Icon name={o.icon} size={12} strokeWidth={2.25} className="mr-1" /> : null}
          {o.label}
          {o.count !== undefined ? <span className="ml-1 tabular-nums opacity-70">{o.count.toLocaleString('en-IN')}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Search input with a leading icon and clear button. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8 pr-7" aria-label={placeholder} />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="mc-anim-scale-in absolute right-2 top-1/2 flex -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700">
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </div>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const grid = { 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-3 lg:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' }[cols];
  return <div className={cn('grid grid-cols-2 gap-3', grid)}>{children}</div>;
}

// ── Date range with Indian FY presets ────────────────────────────────────────

export interface DateRange {
  from: string;
  to: string;
}

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function datePresets(today = todayIso()): Array<{ id: string; label: string; range: DateRange }> {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shift(monthStart, -1);
  const fy = financialYearOf(today);
  const lastFy = financialYearOf(shift(fy.from, -1));
  return [
    { id: 'today', label: 'Today', range: { from: today, to: today } },
    { id: '7d', label: '7 days', range: { from: shift(today, -6), to: today } },
    { id: '30d', label: '30 days', range: { from: shift(today, -29), to: today } },
    { id: 'month', label: 'This month', range: { from: monthStart, to: today } },
    { id: 'lastMonth', label: 'Last month', range: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd } },
    { id: 'fy', label: fy.label, range: { from: fy.from, to: today } },
    { id: 'lastFy', label: lastFy.label, range: { from: lastFy.from, to: lastFy.to } },
  ];
}

export function DateRangePicker({ value, onChange, presets = true }: { value: DateRange; onChange: (r: DateRange) => void; presets?: boolean }) {
  const all = useMemo(() => datePresets(), []);
  const invalid = value.from && value.to && value.from > value.to;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets ? (
        <div className="flex flex-wrap gap-1">
          {all.map((p) => {
            const on = p.range.from === value.from && p.range.to === value.to;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.range)}
                className={cn(
                  'rounded-md px-2 py-1 text-xs font-medium transition-all duration-150',
                  on ? 'bg-brand-600 text-white shadow-sm' : 'text-neutral-600 hover:bg-brand-50 hover:text-brand-700',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Input type="date" value={value.from} max={value.to || todayIso()} onChange={(e) => onChange({ ...value, from: e.target.value })} className="w-36" aria-label="From date" />
        <span className="text-xs text-neutral-400">to</span>
        <Input type="date" value={value.to} min={value.from} max={todayIso()} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-36" aria-label="To date" />
      </div>
      {invalid ? <span className="mc-anim-shake text-xs text-red-600">“From” must be on or before “To”</span> : null}
    </div>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy,
  reason,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  /** When set, a reason textarea is required (min length) and passed to onConfirm. */
  reason?: { label: string; minLength?: number; placeholder?: string };
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const min = reason?.minLength ?? 3;
  const reasonOk = !reason || text.trim().length >= min;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="mc-anim-fade-in absolute inset-0 bg-neutral-900/40 backdrop-blur-[2px]" onClick={() => !busy && onCancel()} />
      <div className="mc-anim-pop relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', tone === 'danger' ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-700')}>
            {tone === 'danger' ? '!' : '?'}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
            {message ? <div className="text-sm text-neutral-600">{message}</div> : null}
          </div>
        </div>
        {children ? <div className="mt-4">{children}</div> : null}
        {reason ? (
          <label className="mt-4 block space-y-1">
            <span className="text-xs font-medium text-neutral-600">
              {reason.label}
              <span className="ml-0.5 text-red-500">*</span>
            </span>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} autoFocus />
            {!reasonOk && text.length > 0 ? <span className="text-[11px] text-red-600">At least {min} characters</span> : null}
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={busy || !reasonOk} onClick={() => onConfirm(text.trim())} autoFocus={!reason}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Combobox ─────────────────────────────────────────────────────────────────

export interface ComboItem {
  id: string;
  label: string;
  sublabel?: string;
  badge?: ReactNode;
  disabled?: boolean;
}

/**
 * Searchable single-select. Filters `items` locally, or calls `onSearch` for
 * server-side search (pass the debounced query to your query hook).
 */
export function Combobox({
  items,
  value,
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  onSearch,
  loading,
  footer,
  disabled,
  invalid,
}: {
  items: ComboItem[];
  value: string | null;
  onChange: (id: string | null, item: ComboItem | null) => void;
  placeholder?: string;
  emptyText?: string;
  onSearch?: (q: string) => void;
  loading?: boolean;
  footer?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === value) ?? null;
  const [selectedLabel, setSelectedLabel] = useState<string>(selected?.label ?? '');
  useEffect(() => {
    if (selected) setSelectedLabel(selected.label);
    else if (!value) setSelectedLabel('');
  }, [selected, value]);

  const filtered = useMemo(() => {
    if (onSearch) return items;
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((i) => `${i.label} ${i.sublabel ?? ''}`.toLowerCase().includes(q)).slice(0, 50);
  }, [items, query, onSearch]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (item: ComboItem) => {
    if (item.disabled) return;
    onChange(item.id, item);
    setSelectedLabel(item.label);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <Input
        value={open ? query : selectedLabel}
        placeholder={selectedLabel || placeholder}
        disabled={disabled}
        className={cn('pr-7', invalid && 'border-red-400')}
        role="combobox"
        aria-expanded={open}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          onSearch?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(filtered.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            const item = filtered[active];
            if (open && item) {
              e.preventDefault();
              pick(item);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {value && !disabled ? (
        <button
          type="button"
          aria-label="Clear selection"
          className="absolute right-2 top-1/2 flex -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700"
          onClick={() => {
            onChange(null, null);
            setSelectedLabel('');
          }}
        >
          <Icon name="close" size={13} />
        </button>
      ) : (
        <Icon name="chevronDown" size={14} className={cn('pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 transition-transform duration-200', open && 'rotate-180')} />
      )}
      {open ? (
        <div className="mc-anim-scale-in absolute z-40 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-xl" role="listbox">
          {loading ? <p className="px-3 py-2 text-xs text-neutral-500">Searching…</p> : null}
          {!loading && filtered.length === 0 ? <p className="px-3 py-2 text-xs text-neutral-500">{emptyText}</p> : null}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === value}
              disabled={item.disabled}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-45',
                i === active ? 'bg-brand-50 text-brand-800' : 'text-neutral-700',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                {item.sublabel ? <span className="block truncate text-[11px] text-neutral-500">{item.sublabel}</span> : null}
              </span>
              {item.badge}
              {item.id === value ? <Icon name="check" size={14} strokeWidth={2.5} className="text-brand-600" /> : null}
            </button>
          ))}
          {footer ? <div className="border-t border-neutral-100 px-2 pt-1">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── India-specific inputs ────────────────────────────────────────────────────

export function StateSelect({ value, onChange, allowEmpty = true, invalid }: { value: string; onChange: (code: string) => void; allowEmpty?: boolean; invalid?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn(invalid && 'border-red-400')}>
      {allowEmpty ? <option value="">Select state…</option> : null}
      {INDIAN_STATE_CODES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.code} · {s.name}
        </option>
      ))}
    </Select>
  );
}

const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

/**
 * GSTIN input that upper-cases as you type, shows the registered state, and
 * reports the derived state code and PAN so forms can auto-fill them. A bad
 * check digit is a warning (typo hint), never a hard block.
 */
export function GstinInput({
  value,
  onChange,
  onDerived,
  invalid,
  placeholder = '27ABCDE1234F1Z5',
}: {
  value: string;
  onChange: (v: string) => void;
  onDerived?: (d: { stateCode: string; pan: string }) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const upper = value.trim().toUpperCase();
  const complete = upper.length === 15;
  const formatOk = GSTIN_FORMAT.test(upper);
  const checksumOk = formatOk && isValidGstinChecksum(upper);
  const state = formatOk ? stateName(upper.slice(0, 2)) : undefined;
  const lastDerived = useRef('');
  useEffect(() => {
    if (formatOk && onDerived && lastDerived.current !== upper) {
      lastDerived.current = upper;
      onDerived({ stateCode: upper.slice(0, 2), pan: panFromGstin(upper) });
    }
  }, [formatOk, upper, onDerived]);
  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          value={value}
          maxLength={15}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
          className={cn('pr-16 font-mono tracking-wider', invalid && 'border-red-400')}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-neutral-400">{upper.length}/15</span>
      </div>
      {complete ? (
        <p className={cn('mc-anim-fade-in flex items-center gap-1 text-[11px]', !formatOk ? 'text-red-600' : checksumOk ? 'text-emerald-700' : 'text-amber-700')}>
          {!formatOk ? (
            'Format looks wrong: 2-digit state + 10-char PAN + entity + Z + check'
          ) : checksumOk ? (
            <>
              <span className="mc-anim-pop inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Icon name="check" size={9} strokeWidth={3} />
              </span>
              {state ?? 'Unknown state'} · PAN {panFromGstin(upper)}
            </>
          ) : (
            <>
              <Icon name="warning" size={12} />
              Check digit doesn’t match — please re-check for a typo ({state ?? 'unknown state'})
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

/** ₹ input that only accepts amounts with up to 2 decimals. */
export function MoneyInput({
  value,
  onChange,
  invalid,
  placeholder = '0.00',
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">₹</span>
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, '');
          if (/^\d{0,13}(\.\d{0,2})?$/.test(v)) onChange(v);
        }}
        className={cn('pl-6 tabular-nums', invalid && 'border-red-400')}
        {...rest}
      />
    </div>
  );
}

/** Whole-number or decimal quantity input. */
export function QtyInput({
  value,
  onChange,
  decimals = 0,
  invalid,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  decimals?: number;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const pattern = decimals > 0 ? new RegExp(`^\\d{0,9}(\\.\\d{0,${decimals}})?$`) : /^\d{0,9}$/;
  return (
    <Input
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(decimals > 0 ? /[^\d.]/g : /\D/g, '');
        if (pattern.test(v)) onChange(v);
      }}
      className={cn('tabular-nums', invalid && 'border-red-400', className)}
      {...rest}
    />
  );
}

/** Section heading inside long forms. */
export function FormSection({ title, hint, children, delay }: { title: string; hint?: string; children: ReactNode; delay?: number }) {
  return (
    <fieldset className="mc-anim-fade-up space-y-3 rounded-xl border border-neutral-200/80 bg-neutral-50/40 p-3" style={delay !== undefined ? { animationDelay: `${delay}ms` } : undefined}>
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{title}</legend>
      {hint ? <p className="-mt-1 text-[11px] text-neutral-500">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

/** Days-to-expiry pill with colour by urgency. */
export function ExpiryPill({ days }: { days: number }) {
  const tone =
    days < 0 ? 'bg-red-100 text-red-700 ring-red-200' : days <= 30 ? 'bg-red-50 text-red-700 ring-red-200' : days <= 90 ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ring-1 ring-inset', tone)}>
      {days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `${days}d left`}
    </span>
  );
}

/** Keyboard shortcut hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex min-h-4 items-center justify-center rounded border border-neutral-300 bg-neutral-50 px-1 font-mono text-[10px] text-neutral-500 shadow-[0_1px_0_#d4d4d4]">{children}</kbd>;
}
