'use client';

import { Icon } from '@/components/icons';
import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from 'react';
import { Badge, Button, IconButton, Stat, cn } from '@/components/ui';
import { countOf, formatBytes, plural, type ImportSpec } from './import-specs';

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases from the previous value to `target` (ease-out cubic). */
export function useCountUp(target: number, duration = 500): number {
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
    <ol className="flex items-center gap-2" aria-label="Import progress">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span className="flex items-center gap-2" aria-current={state === 'active' ? 'step' : undefined}>
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold transition-colors duration-200',
                  state === 'done' && 'bg-primary text-white',
                  state === 'active' && 'bg-surface text-teal-ink ring-2 ring-accent',
                  state === 'todo' && 'bg-subtle text-faint ring-1 ring-line',
                )}
              >
                {state === 'done' ? <Icon name="check" size={13} strokeWidth={2.75} /> : i + 1}
              </span>
              <span className={cn('hidden whitespace-nowrap text-xs font-medium sm:inline', state === 'todo' ? 'text-faint' : 'text-ink')}>{label}</span>
            </span>
            {i < steps.length - 1 ? <span className={cn('h-px flex-1 transition-colors duration-300', i < current ? 'bg-primary' : 'bg-line')} /> : null}
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
}: {
  spec: ImportSpec;
  selected: boolean;
  allowed: boolean;
  onSelect: () => void;
  delay?: number;
}) {
  const required = spec.columns.filter((c) => c.required).map((c) => c.key);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={!allowed}
      onClick={onSelect}
      className={cn(
        'group relative rounded-lg border p-4 text-left transition-colors duration-150',
        selected ? 'border-accent bg-mint/50 ring-1 ring-accent' : 'border-line bg-surface hover:border-neutral-300 hover:bg-subtle/50',
        !allowed && 'cursor-not-allowed opacity-55 hover:border-line hover:bg-surface',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', selected ? 'bg-primary text-white' : 'bg-subtle text-muted group-hover:text-teal-ink')}>
          <Icon name={spec.icon} size={17} />
        </span>
        <span className={cn('flex h-4 w-4 items-center justify-center rounded-full border', selected ? 'border-accent bg-primary text-white' : 'border-neutral-300 text-transparent')}>
          <Icon name="check" size={10} strokeWidth={3} />
        </span>
      </span>
      <span className="mt-3 block text-sm font-semibold text-ink">{spec.title}</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted">{spec.blurb}</span>
      <span className="mt-3 flex flex-wrap items-center gap-1.5">
        {allowed ? (
          <>
            <Badge>{spec.columns.length} columns</Badge>
            <Badge tone="blue">Required: {required.join(', ')}</Badge>
          </>
        ) : (
          <Badge icon="lock">Needs {spec.permission}</Badge>
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
      <div className={cn('mc-anim-fade-in flex items-center gap-3 rounded-lg border bg-surface p-3', invalid ? 'border-danger/30' : 'border-line')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-mint text-2xs font-semibold text-teal-ink ring-1 ring-inset ring-brand-100">CSV</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{file.name}</span>
          <span className="num block text-xs text-muted">
            {formatBytes(file.size)} · {rowCount.toLocaleString('en-IN')} data {rowCount === 1 ? 'row' : 'rows'}
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
          Replace
        </Button>
        <IconButton icon="close" label="Remove file" size="sm" onClick={onClear} />
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
        'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors duration-150',
        dragging ? 'border-accent bg-mint/60' : 'border-neutral-300 bg-subtle/50 hover:border-accent/60 hover:bg-mint/30',
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface text-teal-ink ring-1 ring-line">
        <Icon name="upload" size={20} />
      </span>
      <span className="text-sm font-medium text-ink">{dragging ? 'Release to upload' : 'Drag & drop your CSV here'}</span>
      <span className="text-xs text-muted">
        or <span className="font-medium text-teal-ink underline-offset-2 group-hover:underline">browse your computer</span> · up to 5,000 rows, 10 MB
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

const TILE_TEXT = { neutral: undefined, green: 'text-success', red: 'text-danger', amber: 'text-warning' } as const;

/** A counted metric; place inside a `MetricGroup`. */
export function StatTile({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'green' | 'red' | 'amber'; delay?: number }) {
  const shown = useCountUp(value);
  return <Stat label={label} value={<span className={value > 0 ? TILE_TEXT[tone] : undefined}>{shown.toLocaleString('en-IN')}</span>} />;
}

/** Proportional valid / error / duplicate bar. */
export function ResultBar({ valid, errors, duplicates }: { valid: number; errors: number; duplicates: number }) {
  const total = Math.max(1, valid + errors + duplicates);
  const segment = (count: number) => ({ width: `${(count / total) * 100}%` });
  return (
    <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-neutral-100" aria-hidden>
      <span className="bg-success transition-[width] duration-300" style={segment(valid)} />
      <span className="bg-danger transition-[width] duration-300" style={segment(errors)} />
      <span className="bg-warning transition-[width] duration-300" style={segment(duplicates)} />
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
  const created = useCountUp(result.created, 600);
  return (
    <section className="mc-anim-fade-in rounded-xl border border-line bg-surface px-6 py-10 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
        <Icon name="checkCircle" size={26} />
      </span>
      <h2 className="mt-4 text-lg font-[550] text-ink">{countOf(created, spec)} imported</h2>
      <p className="mt-1 text-sm text-muted">
        {result.skipped > 0 || result.rejected > 0
          ? `${plural(result.skipped, 'row')} skipped as duplicates · ${result.rejected} rejected on re-validation`
          : 'Every valid row was saved. The import is recorded in the audit log.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href={spec.listHref}>
          <Button>
            View {spec.title.toLowerCase()} <Icon name="arrowRight" size={13} />
          </Button>
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
    green: 'bg-success/10 text-success ring-success/25',
    amber: 'bg-warning/10 text-warning ring-warning/25',
    red: 'bg-danger/10 text-danger ring-danger/25',
    neutral: 'bg-subtle text-neutral-600 ring-line',
  };
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-px font-mono text-2xs ring-1 ring-inset', tones[tone])}>
      {children}
    </span>
  );
}
