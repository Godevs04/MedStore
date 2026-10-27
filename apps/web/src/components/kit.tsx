'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ZodTypeAny } from 'zod';
import { financialYearOf, INDIAN_STATE_CODES, isValidGstinChecksum, panFromGstin, stateName, zodFieldErrors } from '@medicore/validation';
import { Icon, type IconName } from './icons';
import { Button, cn, Input, MetricGroup, Select, Textarea, todayIso, useOverlay } from './ui';

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
  return <span className="num">{format(shown)}</span>;
}

export { Sparkline } from './ui';

/** Short rupee label for chart axes only (₹1.2L, ₹45k); tooltips keep full precision. */
export const compactInr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}k` : `₹${Math.round(n)}`;

/** Rounded axis steps (1, 2, 2.5, 5 × 10ⁿ) so tick labels never repeat. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag);
  const top = step * Math.ceil(max / step);
  const ticks: number[] = [];
  for (let v = top; v > 0; v -= step) ticks.push(v);
  ticks.push(0);
  return ticks;
}

/** Vertical bar chart with a rounded y-axis, hover/keyboard tooltip and a screen-reader table. */
export function BarChart({
  data,
  format = (n) => n.toLocaleString('en-IN'),
  detailFormat,
  height = 180,
  tone = 'brand',
  emptyLabel = 'No data for this period.',
  sparseLabel,
}: {
  data: Array<{ label: string; value: number; hint?: string }>;
  format?: (n: number) => string;
  /** Full-precision formatter for tooltips and the accessible table. */
  detailFormat?: (n: number) => string;
  height?: number;
  tone?: 'brand' | 'amber' | 'red';
  emptyLabel?: string;
  /** Caption shown when only a few bars carry a value, e.g. `(n, total) => `Sales on ${n} of ${total} days``. */
  sparseLabel?: (filled: number, total: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const detail = detailFormat ?? format;
  const max = Math.max(...data.map((d) => d.value), 0);
  if (data.length === 0 || max <= 0) {
    return (
      <p className="py-6 text-[13px] text-muted">{emptyLabel}</p>
    );
  }
  const ticks = niceTicks(max);
  const top = ticks[0]!;
  const bar = { brand: 'bg-accent/85', amber: 'bg-warning/75', red: 'bg-danger/75' }[tone];
  const barHover = { brand: 'bg-teal-ink', amber: 'bg-warning', red: 'bg-danger' }[tone];
  const filled = data.filter((d) => d.value > 0).length;
  // With only one or two bars the chart labels them directly instead of relying on hover.
  const sparse = data.length > 3 && filled <= 2;
  const plot = height - 22;
  const labelEvery = data.length > 16 ? Math.ceil(data.length / 8) : data.length > 10 ? 2 : 1;
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    setHover((h) => {
      const cur = h ?? (e.key === 'ArrowRight' ? -1 : data.length);
      return Math.min(data.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    });
  };
  const active = hover !== null ? data[hover] : null;
  return (
    <div>
    <div
      className="flex gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      tabIndex={0}
      role="group"
      aria-label="Chart. Use the left and right arrow keys to read values."
      onKeyDown={move}
      onBlur={() => setHover(null)}
    >
      <div className={cn('relative w-12 shrink-0 text-right text-[10px] num text-faint', sparse && 'mt-5')} style={{ height: plot }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
            {format(t)}
          </span>
        ))}
      </div>
      <div className={cn('relative min-w-0 flex-1', sparse && 'pt-5')}>
        <div className={cn('absolute inset-x-0', sparse ? 'top-5' : 'top-0')} style={{ height: plot }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-line' : 'border-dashed border-line/80')} style={{ top: `${(1 - t / top) * 100}%` }} />
          ))}
        </div>
        <div className="relative flex items-end gap-[3px]" style={{ height: plot }} aria-hidden>
          {data.map((d, i) => (
            <div key={`${d.label}-${i}`} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <div
                className={cn('mc-anim-grow mx-auto w-full max-w-9 origin-bottom rounded-t-[3px] transition-colors', hover === i ? barHover : bar)}
                style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
              />
              {sparse && d.value > 0 && hover !== i ? (
                <span className="num pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-ink" style={{ bottom: `calc(${(d.value / top) * 100}% + 4px)` }}>
                  {format(d.value)}
                </span>
              ) : null}
              {hover === i ? (
                <div className="mc-anim-fade-in pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-2xs text-white shadow-pop">
                  <p className="num text-xs font-medium">{detail(d.value)}</p>
                  <p className="text-neutral-300">{d.hint ?? d.label}</p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-[3px] text-[10px] text-faint" aria-hidden>
          {data.map((d, i) => (
            <span key={`${d.label}-${i}`} className={cn('flex-1 truncate text-center', sparse && d.value > 0 && 'font-medium text-ink')}>
              {i % labelEvery === 0 || (sparse && d.value > 0) ? d.label : ''}
            </span>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {active ? `${active.hint ?? active.label}: ${detail(active.value)}` : ''}
        </p>
        <table className="sr-only">
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-${i}`}>
                <th scope="row">{d.hint ?? d.label}</th>
                <td>{detail(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
      {sparse && sparseLabel ? <p className="mt-3 text-xs text-muted">{sparseLabel(filled, data.length)}</p> : null}
    </div>
  );
}

const DONUT_COLORS = ['#123B3A', '#14B8A6', '#5FD8C4', '#0F766E', '#A7EBDD', '#356F9A', '#A66A17', '#94A6A2'];

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
  if (total <= 0) return <p className="py-6 text-[13px] text-muted">Nothing recorded yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0 -rotate-0" aria-hidden>
        <circle cx="21" cy="21" r={radius} fill="none" style={{ stroke: 'rgb(var(--mc-subtle))' }} strokeWidth="5" />
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
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="flex-1 text-neutral-600">{d.label}</span>
            <span className="font-medium num text-ink">{format(d.value)}</span>
            <span className="w-10 text-right num text-faint">{((d.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal progress meter (0–100). */
export function Meter({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'amber' | 'red' | 'green'; label?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  const bar = { brand: 'bg-accent', amber: 'bg-warning', red: 'bg-danger', green: 'bg-success' }[tone];
  return (
    <div className="space-y-1">
      {label ? <p className="text-2xs text-muted">{label}</p> : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
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
    <nav className="mc-anim-fade-in flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted" aria-label="Pagination">
      <span>
        Showing <b className="font-semibold text-neutral-700">{first.toLocaleString('en-IN')}</b>–
        <b className="font-semibold text-neutral-700">{last.toLocaleString('en-IN')}</b> of {totalItems.toLocaleString('en-IN')} {label}
      </span>
      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          <PageButton disabled={page <= 1} onClick={() => onChange(page - 1)} label="Previous page">
            <Icon name="chevronLeft" size={14} />
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
            <Icon name="chevronRight" size={14} />
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
        'inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-medium num transition-colors duration-150 disabled:opacity-40',
        active ? 'bg-ink text-white' : 'text-neutral-600 hover:bg-subtle hover:text-ink',
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
    <th className={cn('whitespace-nowrap px-3 py-2.5 font-semibold', right && 'text-right')} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort({ field, direction: active && sort.direction === 'desc' ? 'asc' : 'desc' })}
        className={cn('inline-flex items-center gap-1 rounded-sm uppercase tracking-[0.06em] transition-colors hover:text-ink', active && 'text-ink', right && 'flex-row-reverse')}
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
    neutral: 'data-[on=true]:border-neutral-400 data-[on=true]:bg-subtle data-[on=true]:text-ink',
    green: 'data-[on=true]:border-success/40 data-[on=true]:bg-success/10 data-[on=true]:text-success',
    amber: 'data-[on=true]:border-warning/40 data-[on=true]:bg-warning/10 data-[on=true]:text-warning',
    red: 'data-[on=true]:border-danger/40 data-[on=true]:bg-danger/10 data-[on=true]:text-danger',
    blue: 'data-[on=true]:border-accent/50 data-[on=true]:bg-mint data-[on=true]:text-brand-deep',
  };
  const chip =
    'inline-flex h-7 items-center whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:border-neutral-300 hover:text-ink';
  return (
    <div className="mc-anim-fade-in flex flex-wrap gap-1.5" role="group">
      {allLabel !== null ? (
        <button type="button" data-on={value === ''} aria-pressed={value === ''} onClick={() => onChange('')} className={cn(chip, tones.blue)}>
          {allLabel}
        </button>
      ) : null}
      {options.map((o) => (
        <button key={o.id} type="button" data-on={value === o.id} aria-pressed={value === o.id} onClick={() => onChange(value === o.id && allLabel !== null ? '' : o.id)} className={cn(chip, tones[o.tone ?? 'blue'])}>
          {o.icon ? <Icon name={o.icon} size={12} strokeWidth={2.25} className="mr-1" /> : null}
          {o.label}
          {o.count !== undefined ? <span className="ml-1 num opacity-70">{o.count.toLocaleString('en-IN')}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Search input with a leading icon and clear button. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8 pr-7" aria-label={placeholder} />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search" className="absolute right-2 top-1/2 flex -translate-y-1/2 rounded p-0.5 text-faint hover:text-neutral-700">
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </div>
  );
}

export function KpiGrid({ children, bare }: { children: ReactNode; cols?: 3 | 4 | 5 | 6; bare?: boolean }) {
  return <MetricGroup bare={bare}>{children}</MetricGroup>;
}

/** One row for search, filters and actions above a table; wraps on small screens. */
export function TableToolbar({ children, actions, className }: { children?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
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
        <div className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Date presets">
          {all.map((p) => {
            const on = p.range.from === value.from && p.range.to === value.to;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(p.range)}
                className={cn(
                  'h-7 rounded-md px-2 text-xs font-medium transition-colors duration-150',
                  on ? 'bg-subtle text-ink ring-1 ring-inset ring-line' : 'text-muted hover:text-ink',
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
        <span className="text-xs text-faint">to</span>
        <Input type="date" value={value.to} min={value.from} max={todayIso()} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-36" aria-label="To date" />
      </div>
      {invalid ? <span className="text-xs text-danger">“From” must be on or before “To”</span> : null}
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
    <ConfirmPanel title={title} busy={busy} onCancel={onCancel}>
        <div className="flex items-start gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-mint text-teal-ink')}>
            <Icon name={tone === 'danger' ? 'warning' : 'info'} size={18} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-section font-[550] text-ink">{title}</h2>
            {message ? <div className="text-[13px] text-neutral-600">{message}</div> : null}
          </div>
        </div>
        {children ? <div className="mt-4">{children}</div> : null}
        {reason ? (
          <label className="mt-4 block space-y-1">
            <span className="text-xs font-medium text-neutral-600">
              {reason.label}
              <span className="ml-0.5 text-danger">*</span>
            </span>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} autoFocus />
            {!reasonOk && text.length > 0 ? <span className="text-2xs text-danger">At least {min} characters</span> : null}
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
    </ConfirmPanel>,
    document.body,
  );
}

function ConfirmPanel({ title, busy, onCancel, children }: { title: string; busy?: boolean; onCancel: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useOverlay(true, panel);
  return (
    <div className="fixed inset-0 z-dialog flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" tabIndex={-1} className="mc-anim-fade-in absolute inset-0 bg-neutral-950/30" onClick={() => !busy && onCancel()} />
      <div ref={panel} tabIndex={-1} className="mc-anim-scale-in relative w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-overlay outline-none">
        {children}
      </div>
    </div>
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
        className={cn('pr-7', invalid && 'border-danger')}
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
          className="absolute right-2 top-1/2 flex -translate-y-1/2 rounded p-0.5 text-faint hover:text-neutral-700"
          onClick={() => {
            onChange(null, null);
            setSelectedLabel('');
          }}
        >
          <Icon name="close" size={13} />
        </button>
      ) : (
        <Icon name="chevronDown" size={14} className={cn('pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint transition-transform duration-200', open && 'rotate-180')} />
      )}
      {open ? (
        <div className="mc-anim-drop absolute z-dropdown mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-pop" role="listbox">
          {loading ? <p className="px-3 py-2 text-xs text-muted">Searching…</p> : null}
          {!loading && filtered.length === 0 ? <p className="px-3 py-2 text-xs text-muted">{emptyText}</p> : null}
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
                i === active ? 'bg-mint text-brand-deep' : 'text-neutral-700',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.label}</span>
                {item.sublabel ? <span className="block truncate text-2xs text-muted">{item.sublabel}</span> : null}
              </span>
              {item.badge}
              {item.id === value ? <Icon name="check" size={14} strokeWidth={2.5} className="text-teal-ink" /> : null}
            </button>
          ))}
          {footer ? <div className="border-t border-line px-2 pt-1">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── India-specific inputs ────────────────────────────────────────────────────

export function StateSelect({ value, onChange, allowEmpty = true, invalid }: { value: string; onChange: (code: string) => void; allowEmpty?: boolean; invalid?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={cn(invalid && 'border-danger')}>
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
          className={cn('pr-16 font-mono tracking-wider', invalid && 'border-danger')}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] num text-faint">{upper.length}/15</span>
      </div>
      {complete ? (
        <p className={cn('mc-anim-fade-in flex items-center gap-1 text-2xs', !formatOk ? 'text-danger' : checksumOk ? 'text-success' : 'text-warning')}>
          {!formatOk ? (
            'Format looks wrong: 2-digit state + 10-char PAN + entity + Z + check'
          ) : checksumOk ? (
            <>
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-white">
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
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">₹</span>
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, '');
          if (/^\d{0,13}(\.\d{0,2})?$/.test(v)) onChange(v);
        }}
        className={cn('pl-6 num', invalid && 'border-danger')}
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
      className={cn('num', invalid && 'border-danger', className)}
      {...rest}
    />
  );
}

/** Section heading inside long forms. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode; delay?: number }) {
  return (
    <fieldset className="mc-anim-fade-in space-y-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-[15px] font-medium text-ink">{title}</legend>
      {hint ? <p className="clear-both -mt-1 text-2xs text-muted">{hint}</p> : null}
      <div className="clear-both space-y-3">{children}</div>
    </fieldset>
  );
}

/** Days-to-expiry cue: a semantic dot and coloured text, never a filled row. */
export function ExpiryPill({ days }: { days: number }) {
  const tone = days <= 30 ? 'text-danger' : days <= 90 ? 'text-warning' : 'text-muted';
  const dot = days <= 30 ? 'bg-danger' : days <= 90 ? 'bg-warning' : 'bg-neutral-300';
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium num', tone)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `${days}d left`}
    </span>
  );
}

/** Keyboard shortcut hint. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex min-h-4 items-center justify-center rounded border border-line bg-surface px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}
