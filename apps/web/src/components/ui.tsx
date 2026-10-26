'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

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

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
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

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {children}
      {error ? (
        <span className="mc-anim-fade-in block text-xs text-red-600" role="alert">
          {error}
        </span>
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
        'mc-anim-scale-in inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
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

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mc-anim-fade-up flex flex-col items-center gap-2.5 py-12 text-center">
      <div className="mc-anim-float flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl shadow-sm ring-1 ring-brand-100">
        📦
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
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-lg">⚠️</div>
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

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn('transition-colors duration-150 hover:bg-brand-50/40', className)}>{children}</tr>
  );
}
