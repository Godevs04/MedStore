'use client';

import { useEffect, useSyncExternalStore } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastTone, title: string, description?: string): number {
  const id = ++seq;
  // Collapse identical toasts fired in quick succession (e.g. a retried query).
  items = [...items.filter((t) => !(t.title === title && t.description === description)), { id, tone, title, description }].slice(-4);
  emit();
  return id;
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
  warning: (title: string, description?: string) => push('warning', title, description),
  dismiss: (id: number) => {
    items = items.filter((t) => t.id !== id);
    emit();
  },
};

const TONE: Record<ToastTone, { ring: string; icon: string; iconBg: string }> = {
  success: { ring: 'border-emerald-200', icon: '✓', iconBg: 'bg-emerald-500' },
  error: { ring: 'border-red-200', icon: '!', iconBg: 'bg-red-500' },
  warning: { ring: 'border-amber-200', icon: '!', iconBg: 'bg-amber-500' },
  info: { ring: 'border-brand-200', icon: 'i', iconBg: 'bg-brand-600' },
};

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    const t = setTimeout(() => toast.dismiss(item.id), item.tone === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [item.id, item.tone]);
  const tone = TONE[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={`mc-anim-toast pointer-events-auto flex w-80 items-start gap-3 rounded-xl border ${tone.ring} bg-white/95 px-3.5 py-3 shadow-lg shadow-neutral-900/10 backdrop-blur`}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${tone.iconBg}`}>{tone.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900">{item.title}</p>
        {item.description ? <p className="mt-0.5 break-words text-xs text-neutral-500">{item.description}</p> : null}
      </div>
      <button aria-label="Dismiss" className="text-neutral-400 transition-colors hover:text-neutral-700" onClick={() => toast.dismiss(item.id)}>
        ✕
      </button>
    </div>
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
const serverSnapshot: ToastItem[] = [];

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, () => serverSnapshot);
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}
