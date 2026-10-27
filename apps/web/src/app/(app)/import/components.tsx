'use client';

import { Icon } from '@/components/icons';
import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { Button, cn } from '@/components/ui';
import { countOf, formatBytes, plural, type ImportSpec } from './import-specs';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases from the previous value to `target` (ease-out cubic). */
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
      const progress = Math.min(1, (now - began) / duration);
      const next = Math.round(start + (target - start) * (1 - (1 - progress) ** 3));
      setValue(next);
      from.current = next;
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mc-anim-fade-up flex items-center gap-2" aria-label="Import progress">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span className="flex items-center gap-2" aria-current={state === 'active' ? 'step' : undefined}>
              <span
                className={cn(
                  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-500',
                  state === 'done' && 'bg-brand-600 text-white shadow-sm shadow-brand-600/30',
                  state === 'active' && 'bg-white text-brand-700 ring-2 ring-brand-500',
                  state === 'todo' && 'bg-neutral-100 text-neutral-400',
                )}
              >
                {state === 'active' ? <span className="mc-anim-ripple absolute inset-0 rounded-full ring-2 ring-brand-400" /> : null}
                {state === 'done' ? <Icon name="check" size={14} strokeWidth={2.75} /> : i + 1}
              </span>
              <span className={cn('hidden whitespace-nowrap text-xs font-medium transition-colors duration-500 sm:inline', state === 'todo' ? 'text-neutral-400' : 'text-neutral-800')}>
                {label}
              </span>
            </span>
            {i < steps.length - 1 ? (
              <span className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-[width] duration-700 ease-out"
                  style={{ width: i < current ? '100%' : '0%' }}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function TypeCard({
  spec,
  selected,
  allowed,
  onSelect,
  delay,
}: {
  spec: ImportSpec;
  selected: boolean;
  allowed: boolean;
  onSelect: () => void;
  delay: number;
}) {
  const required = spec.columns.filter((c) => c.required).map((c) => c.key);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!allowed}
      onClick={onSelect}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        'mc-anim-fade-up group relative overflow-hidden rounded-xl border bg-white p-4 text-left transition-all duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
        selected
          ? 'border-brand-400 shadow-md shadow-brand-600/10 ring-1 ring-brand-400'
          : 'border-neutral-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md',
        !allowed && 'cursor-not-allowed opacity-55 hover:translate-y-0 hover:shadow-none',
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-brand-100/70 transition-transform duration-500',
          selected ? 'scale-150' : 'scale-0 group-hover:scale-100',
        )}
      />
      <span className="relative flex items-start justify-between gap-2">
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-300',
            selected ? 'bg-brand-600 text-white' : 'bg-neutral-100 text-neutral-600 group-hover:bg-brand-50 group-hover:text-brand-700',
          )}
        >
          <Icon name={spec.icon} size={18} />
        </span>
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-300',
            selected ? 'mc-anim-pop border-brand-600 bg-brand-600 text-white' : 'border-neutral-300 text-transparent',
          )}
        >
          <Icon name="check" size={11} strokeWidth={3} />
        </span>
      </span>
      <span className="relative mt-3 block text-sm font-semibold text-neutral-900">{spec.title}</span>
      <span className="relative mt-0.5 block text-xs leading-relaxed text-neutral-500">{spec.blurb}</span>
      <span className="relative mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-500">
        {allowed ? (
          <>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium">{spec.columns.length} columns</span>
            <span className="rounded bg-brand-50 px-1.5 py-0.5 font-medium text-brand-700">Required: {required.join(', ')}</span>
          </>
        ) : (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium">Needs {spec.permission}</span>
        )}
      </span>
    </button>
  );
}

export function Dropzone({
  file,
  rowCount,
  onFile,
  onClear,
  invalid,
}: {
  file: { name: string; size: number } | null;
  rowCount: number;
  onFile: (file: File) => void;
  onClear: () => void;
  invalid: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  if (file) {
    return (
      <div className={cn('mc-anim-scale-in flex items-center gap-3 rounded-xl border bg-gradient-to-r from-brand-50/70 to-white p-3', invalid ? 'mc-anim-shake border-red-200' : 'border-brand-200')}>
        <span className="mc-anim-pop flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white shadow-sm shadow-brand-600/30">
          CSV
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-neutral-900">{file.name}</span>
          <span className="block text-xs text-neutral-500">
            {formatBytes(file.size)} · {rowCount.toLocaleString('en-IN')} data {rowCount === 1 ? 'row' : 'rows'}
          </span>
        </span>
        <Button variant="ghost" onClick={() => inputRef.current?.click()}>
          Replace
        </Button>
        <Button variant="ghost" aria-label="Remove file" onClick={onClear}>
          <Icon name="close" size={14} />
        </Button>
        <HiddenInput inputRef={inputRef} onFile={onFile} />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
        dragging
          ? 'scale-[1.01] border-brand-500 bg-brand-50 shadow-inner'
          : 'border-neutral-300 bg-neutral-50/60 hover:border-brand-400 hover:bg-brand-50/40',
      )}
    >
      <span className={cn('pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,0.12),transparent_60%)] transition-opacity duration-500', dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')} />
      <span
        className={cn(
          'relative flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm ring-1 ring-neutral-200 transition-transform duration-300',
          dragging ? 'mc-anim-bob scale-110' : 'group-hover:-translate-y-0.5',
        )}
      >
        <Icon name="upload" size={22} />
      </span>
      <span className="relative text-sm font-medium text-neutral-800">{dragging ? 'Release to upload' : 'Drag & drop your CSV here'}</span>
      <span className="relative text-xs text-neutral-500">
        or <span className="font-medium text-brand-700 underline-offset-2 group-hover:underline">browse your computer</span> · up to 5,000 rows, 10 MB
      </span>
      <HiddenInput inputRef={inputRef} onFile={onFile} />
    </div>
  );
}

function HiddenInput({ inputRef, onFile }: { inputRef: RefObject<HTMLInputElement | null>; onFile: (file: File) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      className="hidden"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const picked = e.target.files?.[0];
        if (picked) onFile(picked);
        e.target.value = '';
      }}
    />
  );
}

export function StatTile({ label, value, tone, delay }: { label: string; value: number; tone: 'neutral' | 'green' | 'red' | 'amber'; delay: number }) {
  const shown = useCountUp(value);
  const tones = {
    neutral: 'from-neutral-50 text-neutral-900 ring-neutral-200',
    green: 'from-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'from-red-50 text-red-700 ring-red-200',
    amber: 'from-amber-50 text-amber-700 ring-amber-200',
  };
  return (
    <div style={{ animationDelay: `${delay}ms` }} className={cn('mc-anim-fade-up rounded-xl bg-gradient-to-b to-white p-3 ring-1 ring-inset', tones[tone])}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{shown.toLocaleString('en-IN')}</p>
    </div>
  );
}

/** Proportional valid / error / duplicate bar that grows in on mount. */
export function ResultBar({ valid, errors, duplicates }: { valid: number; errors: number; duplicates: number }) {
  const total = Math.max(1, valid + errors + duplicates);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const segment = (count: number) => ({ width: grown ? `${(count / total) * 100}%` : '0%' });
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-neutral-100" aria-hidden>
      <span className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-[width] duration-700 ease-out" style={segment(valid)} />
      <span className="bg-gradient-to-r from-red-400 to-red-500 transition-[width] delay-150 duration-700 ease-out" style={segment(errors)} />
      <span className="bg-gradient-to-r from-amber-300 to-amber-400 transition-[width] delay-300 duration-700 ease-out" style={segment(duplicates)} />
    </div>
  );
}

export function SuccessPanel({
  spec,
  result,
  onAgain,
}: {
  spec: ImportSpec;
  result: { created: number; skipped: number; rejected: number };
  onAgain: () => void;
}) {
  const created = useCountUp(result.created, 900);
  return (
    <section className="mc-anim-scale-in relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white px-6 py-10 text-center shadow-sm">
      <span className="pointer-events-none absolute left-1/2 top-10 h-24 w-24 -translate-x-1/2 rounded-full bg-emerald-300/30 blur-2xl" />
      <span className="relative mx-auto flex h-16 w-16 items-center justify-center">
        <span className="mc-anim-ripple absolute inset-0 rounded-full bg-emerald-400/40" />
        <span className="mc-anim-pop relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-600/30">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path className="mc-draw-check" d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      </span>
      <h2 className="mc-anim-fade-up relative mt-5 text-lg font-semibold text-neutral-900" style={{ animationDelay: '150ms' }}>
        {countOf(created, spec)} imported
      </h2>
      <p className="mc-anim-fade-up relative mt-1 text-sm text-neutral-500" style={{ animationDelay: '220ms' }}>
        {result.skipped > 0 || result.rejected > 0
          ? `${plural(result.skipped, 'row')} skipped as duplicates · ${result.rejected} rejected on re-validation`
          : 'Every valid row was saved. The import is recorded in the audit log.'}
      </p>
      <div className="mc-anim-fade-up relative mt-6 flex flex-wrap justify-center gap-2" style={{ animationDelay: '300ms' }}>
        <Link
          href={spec.listHref}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm shadow-brand-600/25 transition-all hover:shadow-md active:scale-[0.98]"
        >
          View {spec.title.toLowerCase()} <Icon name="arrowRight" size={13} />
        </Link>
        <Button variant="secondary" onClick={onAgain}>
          Import another file
        </Button>
      </div>
    </section>
  );
}

export function Chip({ tone, children, title }: { tone: 'green' | 'amber' | 'red' | 'neutral'; children: ReactNode; title?: string }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    neutral: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  };
  return (
    <span title={title} className={cn('mc-anim-scale-in inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] ring-1 ring-inset', tones[tone])}>
      {children}
    </span>
  );
}
