'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './icons';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formats a decimal string/number as Indian-grouped rupees (display only; never used for math). */
export function money(v: string | number | null | undefined, symbol = true): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const s = inr.format(Math.abs(safe));
  const sign = safe < 0 && s !== '0.00' ? '−' : '';
  return symbol ? `${sign}₹${s}` : `${sign}${s}`;
}

/** An amount where a negative is a problem (loss, negative asset): minus sign plus danger tone. */
export function Signed({ value, symbol = true, className }: { value: string | number | null | undefined; symbol?: boolean; className?: string }) {
  const n = Number(value ?? 0);
  return <span className={cn('num', n < 0 && 'text-danger', className)}>{money(value, symbol)}</span>;
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function todayIso(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-sm hover:bg-primary-hover',
  secondary: 'border border-line bg-surface text-ink hover:border-neutral-300 hover:bg-canvas',
  tertiary: 'text-muted hover:bg-subtle hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger/90',
  /** Alias of `tertiary`. */
  ghost: 'text-muted hover:bg-subtle hover:text-ink',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium',
        'transition-colors duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1',
        size === 'sm' ? 'h-control-sm px-2.5 text-xs' : 'h-control px-3.5 text-[13px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Square icon-only button; `label` is the accessible name and tooltip. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: IconName; label: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Button variant={variant} size={size} aria-label={label} title={label} className={cn(size === 'sm' ? 'w-8 px-0' : 'w-9 px-0', className)} {...props}>
      <Icon name={icon} size={size === 'sm' ? 15 : 16} />
    </Button>
  );
}

// ── Form controls ────────────────────────────────────────────────────────────

const CONTROL =
  'w-full rounded-md border border-line bg-surface text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-quiet hover:border-neutral-300 focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-subtle disabled:text-neutral-400';

export function Input({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(CONTROL, 'h-control px-3', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, 'h-control cursor-pointer px-2.5', className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROL, 'px-3 py-2', className)} {...props} />;
}

export function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block text-xs font-medium text-neutral-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'block rounded-lg',
          error && '[&_input]:border-danger [&_select]:border-danger [&_textarea]:border-danger [&_input]:ring-3 [&_input]:ring-danger/10',
        )}
      >
        {children}
      </span>
      {error ? (
        <span key={error} className="flex items-start gap-1 text-xs text-danger" role="alert">
          <Icon name="warning" size={12} className="mt-0.5" />
          {error}
        </span>
      ) : hint ? (
        <span className="block text-2xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * Content group. `variant="panel"` (default) is a flat outlined surface; `variant="section"`
 * is an open section (heading + hairline) for grouping inside a page without another box.
 */
const InPanel = createContext(false);

export function Card({
  title,
  description,
  actions,
  children,
  className,
  variant = 'panel',
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Kept for call-site compatibility; panels no longer stagger in. */
  delay?: number;
  variant?: 'panel' | 'section';
}) {
  if (variant === 'section') {
    return (
      <section className={cn('mc-anim-fade-in min-w-0', className)}>
        {title || actions ? (
          <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2">
            <div className="min-w-0">
              {title ? <h2 className="text-section font-[550] text-ink">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
            </div>
            {actions}
          </header>
        ) : null}
        {children}
      </section>
    );
  }
  return (
    <section className={cn('mc-anim-fade-in min-w-0 rounded-xl border border-line bg-surface', className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title ? <h2 className="text-[14px] font-[550] text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div
        className={cn(
          'p-4',
          !(title || actions) && '[&>.mc-table:first-child]:-mt-4 [&>.mc-table:first-child_thead_th:first-child]:rounded-tl-[11px] [&>.mc-table:first-child_thead_th:last-child]:rounded-tr-[11px]',
          '[&>.mc-table:last-child]:-mb-4',
        )}
      >
        <InPanel.Provider value>{children}</InPanel.Provider>
      </div>
    </section>
  );
}

// ── Badges ───────────────────────────────────────────────────────────────────

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-neutral-700 ring-line',
  green: 'bg-success/10 text-success ring-success/25',
  amber: 'bg-warning/10 text-warning ring-warning/25',
  red: 'bg-danger/10 text-danger ring-danger/25',
  blue: 'bg-info/10 text-info ring-info/25',
};
const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-danger',
  blue: 'bg-info',
};

export function Badge({ tone = 'neutral', children, dot, icon }: { tone?: Tone; children: ReactNode; dot?: boolean; icon?: IconName }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-2xs font-medium ring-1 ring-inset', BADGE_TONES[tone])}>
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone])} /> : null}
      {icon ? <Icon name={icon} size={11} strokeWidth={2.25} /> : null}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; icon: IconName; label?: string }> = {
  DRAFT: { tone: 'neutral', icon: 'circle' },
  OPEN: { tone: 'blue', icon: 'circle' },
  PENDING: { tone: 'amber', icon: 'pending' },
  SUBMITTED: { tone: 'blue', icon: 'pending' },
  APPROVED: { tone: 'green', icon: 'check' },
  POSTED: { tone: 'green', icon: 'check' },
  PAID: { tone: 'green', icon: 'check' },
  ACTIVE: { tone: 'green', icon: 'check' },
  AVAILABLE: { tone: 'green', icon: 'check' },
  SALEABLE: { tone: 'green', icon: 'check' },
  COMPLETED: { tone: 'green', icon: 'check' },
  RECEIVED: { tone: 'green', icon: 'check' },
  RECONCILED: { tone: 'green', icon: 'check' },
  ISSUED: { tone: 'green', icon: 'check' },
  TRIALING: { tone: 'blue', icon: 'pending', label: 'Trial' },
  PARTIAL: { tone: 'amber', icon: 'pending' },
  PARTIALLY_PAID: { tone: 'amber', icon: 'pending', label: 'Partially paid' },
  PARTIALLY_RECEIVED: { tone: 'amber', icon: 'pending', label: 'Partially received' },
  PARTIALLY_RETURNED: { tone: 'amber', icon: 'undo', label: 'Partially returned' },
  RETURNED: { tone: 'neutral', icon: 'undo' },
  IN_TRANSIT: { tone: 'blue', icon: 'transfers', label: 'In transit' },
  DISPATCHED: { tone: 'blue', icon: 'transfers' },
  UNPAID: { tone: 'amber', icon: 'pending' },
  OVERDUE: { tone: 'red', icon: 'warning' },
  PAST_DUE: { tone: 'red', icon: 'warning', label: 'Past due' },
  REJECTED: { tone: 'red', icon: 'close' },
  CANCELLED: { tone: 'neutral', icon: 'ban' },
  VOID: { tone: 'neutral', icon: 'ban' },
  EXPIRED: { tone: 'red', icon: 'expiry' },
  EXPIRED_BLOCKED: { tone: 'red', icon: 'expiry', label: 'Expired' },
  NEAR_EXPIRY: { tone: 'amber', icon: 'expiry', label: 'Near expiry' },
  RECALLED: { tone: 'red', icon: 'danger' },
  QUARANTINED: { tone: 'amber', icon: 'lock' },
  DAMAGED: { tone: 'red', icon: 'warning' },
  BLOCKED: { tone: 'red', icon: 'ban' },
  SUSPENDED: { tone: 'red', icon: 'ban' },
  INACTIVE: { tone: 'neutral', icon: 'ban' },
  INVITED: { tone: 'blue', icon: 'mail' },
  LOCKED: { tone: 'neutral', icon: 'lock' },
};

/** Domain status with tone, icon and readable label (never colour alone). */
export function statusTone(status: string): Tone {
  return STATUS[status.toUpperCase()]?.tone ?? 'neutral';
}

export function StatusBadge({ status, label, tone }: { status: string; label?: string; tone?: Tone }) {
  const key = status.toUpperCase();
  const meta = STATUS[key];
  const text = label ?? meta?.label ?? key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
  return (
    <Badge tone={tone ?? meta?.tone ?? 'neutral'} icon={meta?.icon} dot={!meta}>
      {text}
    </Badge>
  );
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="mc-anim-fade-in flex items-center gap-2 text-[13px] text-muted" role="status">
      <Icon name="loading" size={15} className="animate-spin text-teal-ink" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function SkeletonRows({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 py-2.5">
          {Array.from({ length: cols }, (_, j) => (
            <div key={j} className="mc-skeleton h-3.5" style={{ width: j === 0 ? '26%' : `${12 + ((i + j) % 3) * 5}%`, marginLeft: j === cols - 1 ? 'auto' : undefined }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon = 'empty' }: { title: string; hint?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="mc-anim-fade-in flex flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-subtle text-muted ring-1 ring-line">
        <Icon name={icon} size={19} />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-muted">{hint}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ALERT_TONES: Record<AlertTone, { box: string; icon: IconName; iconColor: string }> = {
  info: { box: 'border-info/30 bg-info/5 text-ink', icon: 'info', iconColor: 'text-info' },
  success: { box: 'border-success/30 bg-success/5 text-ink', icon: 'checkCircle', iconColor: 'text-success' },
  warning: { box: 'border-warning/30 bg-warning/5 text-ink', icon: 'warning', iconColor: 'text-warning' },
  danger: { box: 'border-danger/30 bg-danger/5 text-ink', icon: 'danger', iconColor: 'text-danger' },
};

/** Inline notice for page- or section-level messages. */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  className?: string;
}) {
  const t = ALERT_TONES[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('mc-anim-fade-in flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]', t.box, className)}>
      <Icon name={icon ?? t.icon} size={16} className={cn('mt-px', t.iconColor)} />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn('leading-relaxed', Boolean(title) && 'text-xs opacity-90')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <Alert
      tone="danger"
      title={message}
      action={
        retry ? (
          <Button variant="secondary" size="sm" onClick={retry}>
            <Icon name="refresh" size={13} /> Try again
          </Button>
        ) : undefined
      }
    >
      Check your connection and try again. If it keeps happening, contact support.
    </Alert>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return <Alert tone="success">{children}</Alert>;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return <Alert tone="danger">{children}</Alert>;
}

// ── Tables ───────────────────────────────────────────────────────────────────

export function Table({ head, children, sticky, flush }: { head: ReactNode; children: ReactNode; sticky?: boolean; flush?: boolean }) {
  const inPanel = useContext(InPanel) && flush !== false;
  return (
    <div className={cn('mc-table mc-anim-fade-in overflow-x-auto', inPanel ? '-mx-4 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4' : '-mx-px', sticky && 'max-h-[70vh] overflow-y-auto')}>
      <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
        <thead className={cn('text-2xs font-semibold uppercase tracking-[0.06em] text-faint [&_th]:border-b [&_th]:border-line [&_th]:bg-surface', sticky && '[&_th]:sticky [&_th]:top-0 [&_th]:z-10')}>
          {head}
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0 [&_td]:border-b [&_td]:border-line/70">{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr onClick={onClick} className={cn('transition-colors duration-100 hover:bg-mint/35', onClick && 'cursor-pointer', className)}>
      {children}
    </tr>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={cn('whitespace-nowrap px-3 py-2.5 font-semibold first:pl-3 last:pr-3', right && 'text-right')}>{children}</th>;
}

export function Td({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <td className={cn('px-3 py-2.5 align-middle', right && 'text-right num', className)}>{children}</td>;
}

// ── Page structure ───────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
  filters,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <div className="mc-anim-fade-in space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-ink sm:text-display">{title}</h1>
          {subtitle ? <div className="mt-1.5 max-w-3xl text-[13px] text-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
    </div>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────

const countTiles = (children: ReactNode): number =>
  Children.toArray(children).reduce<number>(
    (n, c) => n + (isValidElement<{ children?: ReactNode }>(c) && c.type === Fragment ? countTiles(c.props.children) : 1),
    0,
  );

/**
 * A responsive grid of metric cards. `bare` is kept for call-site compatibility; every group now
 * renders the same card grid.
 */
export function MetricGroup({ children, className, columns }: { children: ReactNode; className?: string; columns?: number; bare?: boolean }) {
  const count = columns ?? countTiles(children);
  return (
    <div
      className={cn(
        'mc-metric-grid mc-anim-fade-in grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-[repeat(var(--mc-cols),minmax(0,1fr))]',
        className,
      )}
      style={{ '--mc-cols': Math.min(Math.max(1, count), 4) } as CSSProperties}
    >
      {children}
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted',
  green: 'text-success',
  amber: 'text-warning',
  red: 'text-danger',
  blue: 'text-info',
};

/** Tiny inline trend line (no axes). Only pass real series. */
export function Sparkline({ values, className, tone = 'brand', color }: { values: number[]; className?: string; tone?: 'brand' | 'red' | 'amber'; color?: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 36 - ((v - min) / span) * 32]);
  const line = pts.map(([x, y]) => `${x!.toFixed(2)},${y!.toFixed(2)}`).join(' ');
  const stroke = color ?? { brand: 'rgb(var(--mc-accent))', red: 'rgb(var(--mc-danger))', amber: 'rgb(var(--mc-warning))' }[tone];
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={cn('h-10 w-full overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: stroke, stopOpacity: 0.18 }} />
          <stop offset="100%" style={{ stopColor: stroke, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${line} 100,40`} fill={`url(#${id})`} className="mc-anim-fade-in" />
      <polyline points={line} fill="none" style={{ stroke }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="mc-draw-line" />
    </svg>
  );
}

export type MetricVariant = 'default' | 'featured' | 'compact' | 'alert';

/**
 * One metric. `featured` is the page's lead number, `compact` an inline secondary figure and
 * `alert` an operational exception marked with a semantic dot. `trend` and `spark` must come from
 * real series; omit them otherwise.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  hue,
  href,
  footer,
  icon,
  trend,
  spark,
  variant = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  /** Card colour identity; defaults to `tone`, or amber for a calm `alert` card. */
  hue?: Tone;
  /** Kept for call-site compatibility; metrics no longer stagger in. */
  delay?: number;
  href?: string;
  /** Extra content under the hint, e.g. a meter. */
  footer?: ReactNode;
  icon?: IconName;
  trend?: { value: number; label?: string; positiveIsGood?: boolean };
  spark?: number[];
  variant?: MetricVariant;
  className?: string;
}) {
  const featured = variant === 'featured';
  const up = trend ? trend.value >= 0 : false;
  const good = trend ? (trend.positiveIsGood === false ? !up : up) : false;
  const trendChip = trend ? (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium num', good ? 'text-success' : 'text-danger')}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.25} />
      {Math.abs(trend.value).toFixed(Math.abs(trend.value) < 10 ? 1 : 0)}%
      {trend.label ? <span className="font-normal text-faint">{trend.label}</span> : null}
    </span>
  ) : null;
  const valueTone = variant === 'alert' && tone !== 'neutral' ? TONE_TEXT[tone] : 'text-ink';
  const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2';

  if (featured || variant === 'compact') {
    const classes = cn('group relative block h-full min-w-0', href && focus, href && 'rounded-md', className);
    const body = (
      <>
        <p className={cn('flex items-center gap-1.5 text-muted', featured ? 'text-[13px] font-medium' : 'text-xs')}>
          {icon ? <Icon name={icon} size={featured ? 16 : 14} className="shrink-0 text-faint" /> : null}
          <span className="min-w-0 truncate">{label}</span>
          {href ? (
            <span aria-hidden className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-faint transition-colors group-hover:border-accent/50 group-hover:text-teal-ink">
              <Icon name="chevronRight" size={11} strokeWidth={2.25} />
            </span>
          ) : null}
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn('num leading-tight', featured ? 'text-metric-lg font-semibold' : 'text-lg font-medium', valueTone)}>{value}</span>
          {trendChip}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        {spark && spark.length > 1 ? <Sparkline values={spark} className={cn('mt-3', featured ? 'h-14' : 'h-8')} /> : null}
        {footer ? <div className="mt-2">{footer}</div> : null}
      </>
    );
    return href ? <Link href={href} className={classes}>{body}</Link> : <div className={classes}>{body}</div>;
  }

  const hasSpark = Boolean(spark && spark.length > 1);
  const cardTone: Tone = hue ?? (variant === 'alert' && tone === 'neutral' ? 'amber' : tone);
  const classes = cn('mc-card group relative isolate flex h-full min-w-0 flex-col overflow-hidden rounded-2xl p-4 pb-12', href && focus, className);
  const body = (
    <>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mc-card-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          <Icon name={icon ?? DEFAULT_METRIC_ICON[cardTone]} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-muted">{label}</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className={cn('num text-[1.625rem] font-semibold leading-tight tracking-tight', valueTone)}>{value}</span>
            {trendChip}
          </p>
          {hint ? <p className="mt-1 text-xs leading-snug text-muted">{hint}</p> : null}
          {footer ? <div className="mt-2">{footer}</div> : null}
        </div>
      </div>
      {hasSpark ? (
        <Sparkline values={spark!} color="rgb(var(--mc-tone))" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-12" />
      ) : (
        <svg aria-hidden viewBox="0 0 200 40" preserveAspectRatio="none" className="mc-card-wave pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-10 w-full">
          <path d="M0 30 C 30 22, 55 34, 85 26 S 140 12, 170 18 S 195 10, 200 8 V40 H0 Z" />
        </svg>
      )}
      {href ? (
        <span aria-hidden className="mc-card-arrow absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-surface shadow-sm transition-transform duration-200 group-hover:translate-x-0.5">
          <Icon name="chevronRight" size={14} strokeWidth={2.25} />
        </span>
      ) : null}
    </>
  );
  return href ? (
    <Link href={href} className={classes} data-tone={cardTone}>
      {body}
    </Link>
  ) : (
    <div className={classes} data-tone={cardTone}>
      {body}
    </div>
  );
}

const DEFAULT_METRIC_ICON: Record<Tone, IconName> = {
  neutral: 'reports',
  green: 'checkCircle',
  amber: 'warning',
  red: 'danger',
  blue: 'info',
};

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="mc-anim-fade-in scrollbar-none flex max-w-full gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-150',
            value === t.id ? 'border-accent text-brand-deep' : 'border-transparent text-muted hover:border-neutral-300 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cn('rounded px-1.5 text-2xs font-semibold num', value === t.id ? 'bg-mint text-brand-deep' : 'bg-subtle text-muted')}>{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

/** Locks page scroll and restores focus to the opener while an overlay is open. */
export function useOverlay(open: boolean, panel: React.RefObject<HTMLElement | null>) {
  // Captured during render: children with autoFocus move focus before effects run.
  const openerRef = useRef<HTMLElement | null>(null);
  if (!open) openerRef.current = null;
  else if (!openerRef.current && typeof document !== 'undefined') openerRef.current = document.activeElement as HTMLElement | null;
  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const el = panel.current;
      if (el && !el.contains(document.activeElement)) {
        const first = el.querySelector<HTMLElement>('input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
        (first ?? el).focus({ preventScroll: true });
      }
    }, 20);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      setTimeout(() => {
        if (opener && opener !== document.body && document.contains(opener)) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, [open, panel]);
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLElement>(null);
  useOverlay(open, panel);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-drawer flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" tabIndex={-1} className="mc-anim-fade-in absolute inset-0 bg-neutral-950/25" onClick={onClose} />
      <aside ref={panel} tabIndex={-1} className={cn('mc-anim-drawer relative flex h-full w-full flex-col bg-surface shadow-overlay outline-none', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-section font-[550] text-ink">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-xs text-muted">{subtitle}</div> : null}
          </div>
          <IconButton icon="close" label="Close drawer" size="sm" onClick={onClose} />
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
