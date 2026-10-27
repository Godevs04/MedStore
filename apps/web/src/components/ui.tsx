'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
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

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      'bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-600/25 hover:shadow-md hover:shadow-brand-600/30 hover:brightness-[1.06] active:scale-[0.98]',
    secondary:
      'bg-white text-neutral-800 border border-neutral-300 shadow-sm hover:border-brand-400 hover:text-brand-700 active:scale-[0.98]',
    danger:
      'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-600/25 hover:brightness-[1.06] active:scale-[0.98]',
    ghost: 'text-neutral-600 hover:bg-brand-50 hover:text-brand-700 active:scale-[0.98]',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium',
        'transition-all duration-200 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none disabled:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm shadow-inner shadow-neutral-100',
        'outline-none transition-all duration-200',
        'hover:border-neutral-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15',
        'disabled:bg-neutral-100 disabled:text-neutral-400',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm shadow-inner shadow-neutral-100',
        'outline-none transition-all duration-200',
        'hover:border-neutral-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15',
        className,
      )}
      {...props}
    />
  );
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
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-neutral-600">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      <span
        className={cn(
          'block rounded-lg',
          error && '[&_input]:border-red-400 [&_select]:border-red-400 [&_textarea]:border-red-400 [&_input]:ring-3 [&_input]:ring-red-500/10',
        )}
      >
        {children}
      </span>
      {error ? (
        <span key={error} className="mc-anim-shake block text-xs text-red-600" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-[11px] text-neutral-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
  delay,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn(
        'mc-anim-fade-up rounded-xl border border-neutral-200/80 bg-white shadow-sm shadow-neutral-200/60',
        'transition-shadow duration-300 hover:shadow-md hover:shadow-neutral-200',
        className,
      )}
      style={delay !== undefined ? { animationDelay: `${delay}ms` } : undefined}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-neutral-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  dot,
}: {
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue';
  children: ReactNode;
  dot?: boolean;
}) {
  const tones = {
    neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  const dotTones = {
    neutral: 'bg-neutral-400',
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    blue: 'bg-sky-500',
  };
  return (
    <span
      className={cn(
        'mc-anim-scale-in inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
      )}
    >
      {dot ? <span className={cn('mc-anim-pulse-dot h-1.5 w-1.5 rounded-full', dotTones[tone])} /> : null}
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="mc-anim-fade-in flex items-center gap-2.5 text-sm text-neutral-500" role="status">
      <span className="relative flex h-4 w-4">
        <span className="absolute h-4 w-4 animate-spin rounded-full border-2 border-neutral-200 border-t-brand-600" />
      </span>
      {label ?? 'Loading…'}
    </div>
  );
}

export function SkeletonRows({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2.5 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3" style={{ animationDelay: `${i * 60}ms` }}>
          {Array.from({ length: cols }, (_, j) => (
            <div
              key={j}
              className="mc-skeleton h-4"
              style={{ width: j === 0 ? '28%' : `${16 + ((i + j) % 3) * 6}%`, animationDelay: `${j * 90}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, action, icon = 'empty' }: { title: string; hint?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="mc-anim-fade-up flex flex-col items-center gap-2.5 py-12 text-center">
      <div className="mc-anim-float flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 shadow-sm ring-1 ring-brand-100">
        <Icon name={icon} size={22} />
      </div>
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {hint ? <p className="max-w-md text-xs leading-relaxed text-neutral-500">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="mc-anim-scale-in flex flex-col items-center gap-2.5 rounded-xl border border-red-200 bg-gradient-to-b from-red-50 to-white py-9 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
        <Icon name="warning" size={20} />
      </div>
      <p className="text-sm font-medium text-red-800">{message}</p>
      {retry ? (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mc-anim-fade-up flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 shadow-sm shadow-emerald-100">
      <span className="mc-anim-pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {children}
    </div>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mc-anim-fade-up flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-sm shadow-red-100">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      {children}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="mc-anim-fade-in overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500">
          {head}
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={cn('transition-colors duration-150 hover:bg-brand-50/40', onClick && 'cursor-pointer', className)}
    >
      {children}
    </tr>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm shadow-inner shadow-neutral-100',
        'outline-none transition-all duration-200 hover:border-neutral-400 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15',
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mc-anim-fade-up flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  delay,
  href,
  footer,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue';
  delay?: number;
  href?: string;
  /** Extra content under the hint, e.g. a sparkline. */
  footer?: ReactNode;
}) {
  const accent = {
    neutral: 'from-neutral-300 to-neutral-200',
    green: 'from-emerald-400 to-emerald-300',
    amber: 'from-amber-400 to-amber-300',
    red: 'from-red-400 to-red-300',
    blue: 'from-brand-500 to-brand-300',
  }[tone];
  const body = (
    <div
      className={cn(
        'mc-anim-fade-up group relative overflow-hidden rounded-xl border border-neutral-200/80 bg-white px-4 py-3 shadow-sm shadow-neutral-200/60',
        'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md',
      )}
      style={delay !== undefined ? { animationDelay: `${delay}ms` } : undefined}
    >
      <span className={cn('absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r', accent)} />
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
      {body}
    </Link>
  ) : (
    body
  );
}

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
    <div className="mc-anim-fade-in inline-flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200',
            value === t.id ? 'bg-white text-brand-700 shadow-sm ring-1 ring-neutral-200' : 'text-neutral-600 hover:text-neutral-900',
          )}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-neutral-200/80 px-1.5 text-[10px] font-semibold text-neutral-600">{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Close" className="mc-anim-fade-in absolute inset-0 bg-neutral-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={cn('mc-anim-drawer relative flex h-full w-full flex-col bg-white shadow-2xl', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-xs text-neutral-500">{subtitle}</div> : null}
          </div>
          <Button variant="ghost" className="px-2" onClick={onClose} aria-label="Close drawer">
            <Icon name="close" size={18} />
          </Button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={cn('px-2 py-2 font-medium', right && 'text-right')}>{children}</th>;
}

export function Td({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <td className={cn('px-2 py-2', right && 'text-right tabular-nums', className)}>{children}</td>;
}
