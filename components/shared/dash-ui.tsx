'use client';

// ============================================================================
// DASH UI — the visual primitives of the Leads and Meetings dashboards, in the
// approved design: white stat cards with a coloured baseline and a ▲▼ chip,
// a clickable months strip, and the funnel with per-step drop-off plus the
// "biggest leak" callout. One implementation so the two dashboards can never
// drift apart visually.
// ============================================================================

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { deltaOf } from '@/lib/dashboard';

type DeltaShape = ReturnType<typeof deltaOf>;

export function DeltaChip({ d }: { d: DeltaShape }) {
  if (d.dir === 'flat') {
    return <span className="inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-bold text-faint">—</span>;
  }
  const Icon = d.dir === 'up' ? TrendingUp : TrendingDown;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold"
      style={d.good ? { background: '#E6F7EE', color: '#047857' } : { background: '#FDECEC', color: '#B91C1C' }}
    >
      <Icon className="h-3 w-3" /> {d.text}
    </span>
  );
}

export function StatCard({ label, value, foot, delta, accent, active, onClick }: {
  label: string; value: string; foot: string; delta: DeltaShape;
  accent: string; active?: boolean; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative min-w-0 overflow-hidden rounded-2xl border bg-surface p-4 pb-3.5 text-left transition',
        'hover:-translate-y-0.5 hover:shadow-[0_8px_22px_-12px_rgba(16,24,40,0.22)]',
        active ? 'border-indigo shadow-[0_0_0_3px_hsl(var(--indigo-soft))]' : 'border-border',
      )}
    >
      <div className="flex min-h-[26px] items-start justify-between gap-2">
        <span className="text-[10px] font-extrabold uppercase leading-[1.3] tracking-[0.07em] text-muted">{label}</span>
        <DeltaChip d={delta} />
      </div>
      <div className={cn('num mt-1.5 text-[26px] font-extrabold leading-none tracking-tight', value === '—' && 'text-faint')}>
        {value}
      </div>
      <div className="mt-1.5 truncate text-[11px] text-muted">{foot}</div>
      {/* the coloured baseline that keys each card to its funnel stage */}
      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-2">
        <span className="block h-full max-w-full" style={{ width: '100%', background: accent }} />
      </span>
    </button>
  );
}

export interface StripSegment { value: number; color: string; label: string }

/**
 * Months-of-the-year strip. Every bar is a control: clicking one compares the
 * current period against that month. Inert (dimmed) while the selected period
 * is a week — a week is never compared against a month.
 *
 * A bar can be STACKED: pass `segments` and each month shows its composition
 * (responded vs not, completed vs no-show vs cancelled…) instead of one flat
 * block — same footprint, twice the story. The value label stays the total.
 */
export function MonthStrip({ items, currentKey, compareKey, enabled, onPick, legend }: {
  items: { key: string; label: string; value: number; segments?: StripSegment[] }[];
  currentKey: string | null; compareKey: string | null; enabled: boolean;
  onPick: (key: string) => void;
  legend?: StripSegment[];
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    // h-full + flex-1 on the bar row: the strip STRETCHES to whatever height
    // the panel's other column sets, so the bars are always as tall as the
    // card — never a 64px chart marooned in 300px of white space.
    <div className="flex h-full min-h-[170px] flex-col">
      <div className={cn('flex flex-1 items-stretch gap-2 overflow-x-auto pb-1', !enabled && 'opacity-55')}>
        {items.map((it) => {
          const isCur = it.key === currentKey;
          const isCmp = it.key === compareKey;
          const total = Math.max(1, it.value);
          const barPct = it.value === 0 ? 0 : Math.max(6, Math.round((it.value / max) * 100));
          const barTitle = it.segments?.length
            ? `${it.label}: ${it.segments.filter((s) => s.value > 0).map((s) => `${s.value} ${s.label.toLowerCase()}`).join(' \u00b7 ') || 'nothing yet'}`
            : `${it.label} \u2014 ${it.value}`;
          return (
            <button
              key={it.key}
              onClick={() => { if (enabled && !isCur) onPick(it.key); }}
              title={enabled ? (isCur ? `${barTitle} (current period)` : `${barTitle} \u2014 click to compare`) : 'Select a month above to compare month-to-month'}
              className={cn(
                'flex min-w-[44px] flex-1 flex-col items-center gap-1 rounded-xl px-1 pb-1.5 pt-1.5 transition',
                isCur ? 'bg-[hsl(var(--indigo-soft))]' : isCmp ? 'bg-[#FEF6E7]' : enabled ? 'hover:bg-surface-2' : '',
                (!enabled || isCur) && 'cursor-default',
                it.value === 0 && 'opacity-60',
              )}
            >
              <span className={cn('num text-[11.5px] font-bold', isCur ? 'text-indigo' : isCmp ? 'text-[#B45309]' : 'text-muted')}>{it.value}</span>
              <span className="flex w-full flex-1 items-end">
                {it.value === 0 ? (
                  // An honest zero: a hairline, not a stub bar pretending to be data.
                  <span className="block h-[3px] w-full rounded-full bg-border-strong" />
                ) : it.segments?.length ? (
                  <span
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t-md transition-all"
                    style={{ height: `${barPct}%`, outline: isCmp ? '1.5px solid #C2740A' : undefined }}
                  >
                    {it.segments.map((sg) => (
                      <span key={sg.label} style={{ height: `${(sg.value / total) * 100}%`, background: sg.color }} />
                    ))}
                  </span>
                ) : (
                  <span
                    className="block w-full rounded-t-md transition-all"
                    style={{
                      height: `${barPct}%`,
                      background: isCur ? '#4F46E5' : isCmp ? '#C2740A' : '#D6D9E3',
                    }}
                  />
                )}
              </span>
              <span className={cn('text-[10.5px] font-bold', isCur ? 'text-indigo' : isCmp ? 'text-[#B45309]' : 'text-faint')}>{it.label}</span>
            </button>
          );
        })}
      </div>
      {legend && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {legend.map((sg) => (
            <span key={sg.label} className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-muted">
              <span className="h-2 w-2 rounded-[3px]" style={{ background: sg.color }} /> {sg.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface FunnelStep { label: string; value: number }

/**
 * The funnel: bar heights relative to the first step, per-step conversion and
 * loss underneath, the single biggest drop badged in the gutter where it
 * happens, and the leak sentence spelled out below.
 */
export function Funnel({ steps, leakNoun }: { steps: FunnelStep[]; leakNoun: string }) {
  if (!steps.length || steps[0].value === 0) {
    return <div className="py-8 text-center text-[12.5px] text-muted">Nothing in this period yet.</div>;
  }
  let biggest = { i: 0, lost: 0, from: '', to: '' };
  steps.forEach((s, i) => {
    if (i > 0) {
      const lost = steps[i - 1].value - s.value;
      if (lost > biggest.lost) biggest = { i, lost, from: steps[i - 1].label, to: s.label };
    }
  });
  return (
    <>
      <div className="flex items-end gap-2.5 overflow-x-auto pb-1 pt-4">
        {steps.map((s, i) => {
          // Share of the STARTING cohort, never step-vs-previous-step. Real
          // data taught us why: derived eligibility means "Reviewed" can be
          // larger than "Responded" (phone-call replies are not tracked yet),
          // and step-over-step then prints garbage like "20900% · lost −209".
          // Share-of-start is always 0–100% and always means the same thing.
          const h = Math.min(100, Math.max(7, Math.round((s.value / steps[0].value) * 100)));
          const share = i === 0 ? null : Math.round((s.value / steps[0].value) * 1000) / 10;
          const lost = i === 0 ? 0 : steps[i - 1].value - s.value;
          return (
            <div key={s.label} className="relative min-w-[84px] flex-1">
              {i === biggest.i && biggest.lost > 0 && (
                <span className="absolute -top-3.5 left-0 z-[2] -translate-x-1/2 whitespace-nowrap rounded-md border border-[#F7CFCF] bg-[#FDECEC] px-1.5 py-0.5 text-[10px] font-extrabold text-[#B91C1C]">
                  −{biggest.lost}
                </span>
              )}
              <div className="flex h-[84px] items-end">
                <span className="block w-full rounded-t-lg opacity-85 transition" style={{ height: `${h}%`, background: '#4F46E5' }} />
              </div>
              <div className="border-t-2 border-border-strong pt-2">
                <div className="num text-[18px] font-extrabold leading-none tracking-tight">{s.value}</div>
                <div className="mt-0.5 text-[11px] text-muted">{s.label}</div>
                {share !== null
                  ? <div className="mt-0.5 text-[10.5px] font-bold text-indigo">{share}%{lost > 0 && <span className="font-semibold text-faint"> · lost {lost}</span>}</div>
                  : <div className="mt-0.5 text-[10.5px] font-bold text-faint">start</div>}
              </div>
            </div>
          );
        })}
      </div>
      {biggest.lost > 0 && (
        <div className="mt-3.5 rounded-xl border border-[#F3E0B8] bg-[#FFF7E6] px-3.5 py-2.5 text-[12.5px] text-[#7A5406]">
          <b className="text-[#5C3F04]">Biggest leak:</b> {biggest.lost} {leakNoun} drop out between{' '}
          <b className="text-[#5C3F04]">{biggest.from}</b> and <b className="text-[#5C3F04]">{biggest.to}</b>.
        </div>
      )}
    </>
  );
}

export function PanelTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3.5">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted">{children}</h2>
      {sub && <div className="mt-0.5 text-[11.5px] text-faint">{sub}</div>}
    </div>
  );
}

// ============================================================================
// COLLAPSIBLE PANEL
//
// A dashboard section that can be folded away. Three deliberate choices:
//
//  * The whole header is the control. A 16px chevron is a small target for
//    something you do every time you open the page, so the title, the subtitle
//    and the chevron are all one button.
//  * The choice is REMEMBERED, per panel, in localStorage. A section you
//    collapse that springs open again on the next visit is worse than not
//    having the control at all.
//  * It reads from localStorage in an effect, not in useState's initialiser,
//    so the server and the first client render agree and React never reports a
//    hydration mismatch. The cost is one frame in the default state, which is
//    invisible; the alternative is a console full of warnings.
// ============================================================================
export function CollapsiblePanel({
  title, sub, storageKey, defaultOpen = true, right, children, className,
}: {
  title: React.ReactNode;
  sub?: string;
  /** Where the open/closed choice is remembered. Omit to make it session-only. */
  storageKey?: string;
  defaultOpen?: boolean;
  /** Optional controls pinned to the right of the header, e.g. a total. */
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const v = localStorage.getItem(`migrizo.panel.${storageKey}`);
      if (v === '0') setOpen(false);
      else if (v === '1') setOpen(true);
    } catch { /* private mode — keep the default */ }
  }, [storageKey]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (storageKey) {
        try { localStorage.setItem(`migrizo.panel.${storageKey}`, next ? '1' : '0'); } catch { /* ignore */ }
      }
      return next;
    });
  };

  return (
    <div className={cn('panel', className)}>
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <ChevronDown
            className={cn('mt-[1px] h-4 w-4 flex-shrink-0 text-faint transition-transform duration-200 group-hover:text-ink-2',
              !open && '-rotate-90')}
          />
          <span className="min-w-0">
            <span className="block text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted group-hover:text-ink-2">
              {title}
            </span>
            {sub && <span className="mt-0.5 block text-[11.5px] text-faint">{sub}</span>}
          </span>
        </button>
        {right && <div className="flex-shrink-0">{right}</div>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
