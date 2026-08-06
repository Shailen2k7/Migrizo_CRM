'use client';

// =============================================================================
// FOLLOW-UP SCHEDULER
//
// Two clicks for a preset, three for any date and time. No typing at all.
//
//   One tap    → pick a preset, press Schedule.
//   Otherwise  → click a day, click a time, press Schedule.
//
// The presets are computed from the clock rather than hard-coded, so they can
// never offer a time that has already passed. Past days are disabled, past
// times on today are disabled, days that already carry a follow-up show a dot,
// and times already taken for this lead are struck out so you cannot
// double-book yourself.
// =============================================================================

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Check, Loader2 } from 'lucide-react';
import type { FollowUp } from '@/lib/types';

const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DWS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function t12(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${ap}`;
}

/** Presets derived from the current time — never in the past. */
function presets(now: Date): { label: string; sub: string; when: Date }[] {
  const out: { label: string; sub: string; when: Date }[] = [];
  const inHour = new Date(now.getTime() + 3600000);
  inHour.setMinutes(inHour.getMinutes() > 30 ? 0 : 30, 0, 0);
  if (inHour > now) out.push({ label: 'In an hour', sub: t12(inHour), when: inHour });

  const six = new Date(now); six.setHours(18, 0, 0, 0);
  if (six.getTime() - now.getTime() > 30 * 60000) out.push({ label: 'Today', sub: t12(six), when: six });

  const tm = addDays(now, 1); tm.setHours(10, 0, 0, 0);
  out.push({ label: 'Tomorrow', sub: t12(tm), when: tm });

  const d3 = addDays(now, 3); d3.setHours(10, 0, 0, 0);
  out.push({ label: 'In 3 days', sub: `${MON[d3.getMonth()]} ${d3.getDate()}, ${t12(d3)}`, when: d3 });

  const nw = addDays(now, 7); nw.setHours(10, 0, 0, 0);
  out.push({ label: 'Next week', sub: `${MON[nw.getMonth()]} ${nw.getDate()}, ${t12(nw)}`, when: nw });

  return out;
}

interface Props {
  leadName: string;
  existing: FollowUp[];
  onSchedule: (whenIso: string, title: string) => Promise<boolean>;
}

export function FollowUpScheduler({ leadName, existing, onSchedule }: Props) {
  const now = useMemo(() => new Date(), []);
  const [calY, setCalY] = useState(now.getFullYear());
  const [calM, setCalM] = useState(now.getMonth());
  const [selDate, setSelDate] = useState<Date | null>(null);
  const [selTime, setSelTime] = useState<string | null>(null);
  const [pending, setPending] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  const firstName = leadName.split(' ')[0];

  // Days and times already spoken for, so we never double-book.
  const busyDays = useMemo(() => {
    const s = new Set<string>();
    for (const f of existing) if (f.status === 'pending') s.add(ymd(new Date(f.scheduled_at)));
    return s;
  }, [existing]);

  const busyTimes = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const f of existing) {
      if (f.status !== 'pending') continue;
      const d = new Date(f.scheduled_at);
      const k = ymd(d);
      (m[k] = m[k] || new Set()).add(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }
    return m;
  }, [existing]);

  const choose = (d: Date) => { setPending(d); };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    const ok = await onSchedule(pending.toISOString(), `Call ${firstName}`);
    setBusy(false);
    if (ok) { setPending(null); setSelDate(null); setSelTime(null); }
  };

  const reset = () => { setPending(null); setSelDate(null); setSelTime(null); };

  // ── calendar grid ──
  const cells = useMemo(() => {
    const first = new Date(calY, calM, 1);
    const lead = (first.getDay() + 6) % 7;
    const total = new Date(calY, calM + 1, 0).getDate();
    const out: (Date | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= total; d++) out.push(new Date(calY, calM, d));
    return out;
  }, [calY, calM]);

  const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // ── time slots for the chosen day, 9am–7pm at 30-minute steps ──
  const slots = useMemo(() => {
    if (!selDate) return [];
    const taken = busyTimes[ymd(selDate)] || new Set<string>();
    const isToday = ymd(selDate) === ymd(now);
    const out: { key: string; label: string; disabled: boolean }[] = [];
    for (let m = 9 * 60; m <= 19 * 60; m += 30) {
      const hh = Math.floor(m / 60), mm = m % 60;
      const dt = new Date(selDate); dt.setHours(hh, mm, 0, 0);
      const key = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      out.push({ key, label: t12(dt), disabled: (isToday && dt <= now) || taken.has(key) });
    }
    return out;
  }, [selDate, busyTimes, now]);

  const relative = (d: Date) => {
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - midnightToday.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return DAY_NAMES[d.getDay()];
    return `${MON[d.getMonth()]} ${d.getDate()}`;
  };

  return (
    <div className="rounded-[10px] border border-border bg-surface-2 px-3.5 py-3 mb-3">
      {/* one tap */}
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">One tap</div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {presets(now).map((p) => (
          <button key={p.label} onClick={() => { reset(); choose(p.when); }}
            className={cn('px-3 py-1.5 rounded-[10px] text-left border transition-all',
              pending && !selDate && pending.getTime() === p.when.getTime()
                ? 'bg-[#EEF2FF] border-[#4F46E5]'
                : 'bg-surface border-border hover:border-[#C7D2FE] hover:bg-[#EEF2FF]')}>
            <div className="text-[12.5px] font-semibold leading-tight">{p.label}</div>
            <div className="text-[11px] text-faint leading-tight mt-px">{p.sub}</div>
          </button>
        ))}
      </div>

      {/* calendar + slots */}
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Or pick a day and time</div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,214px) minmax(0,1fr)' }}>
        <div>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => { const m = calM - 1; if (m < 0) { setCalM(11); setCalY((y) => y - 1); } else setCalM(m); }}
              className="w-6 h-6 rounded-md border border-border bg-surface text-muted hover:bg-surface-2 text-[13px] leading-none">‹</button>
            <div className="text-[13px] font-semibold flex-1">{MONL[calM]} {calY}</div>
            <button onClick={() => { const m = calM + 1; if (m > 11) { setCalM(0); setCalY((y) => y + 1); } else setCalM(m); }}
              className="w-6 h-6 rounded-md border border-border bg-surface text-muted hover:bg-surface-2 text-[13px] leading-none">›</button>
          </div>
          <div className="grid grid-cols-7 gap-[3px]">
            {DWS.map((d, i) => <div key={i} className="text-[10px] font-bold text-faint text-center py-1">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const k = ymd(d);
              const past = d < midnightToday;
              const isToday = k === ymd(now);
              const on = !!selDate && k === ymd(selDate);
              return (
                <button key={k} disabled={past}
                  onClick={() => { setSelDate(d); setSelTime(null); setPending(null); }}
                  className={cn('aspect-square rounded-lg text-[12.5px] font-medium relative flex items-center justify-center transition-colors',
                    past ? 'text-[#D4D4D8] cursor-default'
                      : on ? 'bg-[#4F46E5] text-white'
                      : 'text-ink-2 hover:bg-[#EEF2FF] hover:text-[#4F46E5]',
                    isToday && !on && 'ring-[1.5px] ring-inset ring-[#C7D2FE]')}>
                  {d.getDate()}
                  {busyDays.has(k) && (
                    <span className={cn('absolute bottom-1 w-1 h-1 rounded-full', on ? 'bg-white' : 'bg-[#D97706]')} />
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-faint">
            <span className="w-1 h-1 rounded-full bg-[#D97706]" /> already has a follow-up
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            {selDate ? `Time on ${MON[selDate.getMonth()]} ${selDate.getDate()}` : 'Time'}
          </div>
          {selDate ? (
            <div className="grid gap-1.5 max-h-[196px] overflow-auto pr-0.5"
              style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))' }}>
              {slots.map((s) => (
                <button key={s.key} disabled={s.disabled}
                  onClick={() => {
                    setSelTime(s.key);
                    const [hh, mm] = s.key.split(':').map(Number);
                    const dt = new Date(selDate); dt.setHours(hh, mm, 0, 0);
                    choose(dt);
                  }}
                  className={cn('text-[12.5px] font-semibold py-2 rounded-[9px] border text-center transition-colors',
                    s.disabled ? 'bg-surface-2 text-[#D4D4D8] border-dashed border-border cursor-not-allowed'
                      : selTime === s.key ? 'bg-[#4F46E5] border-[#4F46E5] text-white'
                      : 'bg-surface border-border text-ink-2 hover:border-[#C7D2FE] hover:bg-[#EEF2FF] hover:text-[#4F46E5]')}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-faint py-2.5 leading-relaxed">
              Pick a day on the left, or use a one-tap button above.
            </div>
          )}
        </div>
      </div>

      {/* confirm */}
      {pending && (
        <div className="mt-3.5 flex items-center gap-3 flex-wrap rounded-[11px] px-3.5 py-3"
          style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-[#3730A3]">{relative(pending)} at {t12(pending)}</div>
            <div className="text-[11.5px] text-[#4F46E5] opacity-80 mt-px">
              Call {firstName} · you will hear a chime 15 minutes before
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={reset} className="btn btn-outline btn-sm">Change</button>
            <button onClick={() => void confirm()} disabled={busy} className="btn btn-primary btn-sm">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Schedule it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
