// ============================================================================
// DASHBOARD PERIODS — the shared arithmetic behind the Leads and Meetings
// dashboards. Pure functions, no React, so every rule here is unit-testable.
//
// Three rules keep the numbers trustworthy, and they live HERE so both
// dashboards obey them identically:
//   1. Cohort by the right date — leads by created_at, meetings by the date
//      they were BOOKED. A call booked Monday for next month must not vanish
//      from this week.
//   2. A zero denominator renders "—", never 0%. Zero reads as failure;
//      a dash reads as "nothing to measure yet".
//   3. A week is only ever compared with a week, a month with a month.
//      78 leads in a week is not "down 77%" from 342 in a month — that delta
//      looks like a collapse and means nothing.
// ============================================================================

export type Grain = 'week' | 'month' | 'd30';

export interface Period {
  key: string;
  label: string;      // "This month (Aug)"
  short: string;      // "Aug" — for chart legends
  grain: Grain;
  from: Date;         // inclusive
  to: Date;           // exclusive
  prevKey: string | null;
}

const MS_DAY = 86_400_000;

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;               // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Every period the pickers offer, computed fresh from "now" so the set is
 * always correct without a deploy: weeks roll on Monday, and months cover the
 * current calendar year up to today.
 */
export function buildPeriods(now = new Date()): Map<string, Period> {
  const map = new Map<string, Period>();
  const w0 = startOfWeek(now);
  const week = (key: string, start: Date, label: string, prevKey: string | null) =>
    map.set(key, { key, label, short: label, grain: 'week', from: start,
      to: new Date(start.getTime() + 7 * MS_DAY), prevKey });
  week('w0', w0, 'This week', 'w1');
  week('w1', new Date(w0.getTime() - 7 * MS_DAY), 'Last week', 'w2');
  week('w2', new Date(w0.getTime() - 14 * MS_DAY), 'Week before last', null);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  map.set('d30', { key: 'd30', label: 'Last 30 days', short: '30d', grain: 'd30',
    from: new Date(today.getTime() - 30 * MS_DAY), to: today, prevKey: 'd30p' });
  map.set('d30p', { key: 'd30p', label: 'Previous 30 days', short: 'prev 30d', grain: 'd30',
    from: new Date(today.getTime() - 60 * MS_DAY), to: new Date(today.getTime() - 30 * MS_DAY),
    prevKey: null });

  const y = now.getFullYear();
  for (let m = 0; m <= now.getMonth(); m++) {
    const key = `m${m}`;
    const isCurrent = m === now.getMonth();
    map.set(key, {
      key,
      label: isCurrent ? `This month (${MONTH_SHORT[m]})` : `${MONTH_SHORT[m]} ${y}`,
      short: MONTH_SHORT[m],
      grain: 'month',
      from: new Date(y, m, 1),
      to: new Date(y, m + 1, 1),
      prevKey: m > 0 ? `m${m - 1}` : null,
    });
  }
  return map;
}

/** Picker order: the working periods first, then the year's months. */
export function primaryOptions(periods: Map<string, Period>, now = new Date()): string[] {
  const months: string[] = [];
  for (let m = 0; m < now.getMonth(); m++) months.push(`m${m}`);
  return ['w0', 'w1', `m${now.getMonth()}`, 'd30', ...months.reverse()];
}

/** Rule 3: only same-grain comparisons are ever offered. */
export function compareOptions(periods: Map<string, Period>, periodKey: string): string[] {
  const p = periods.get(periodKey);
  if (!p) return ['prev'];
  const same = [...periods.values()]
    .filter((x) => x.grain === p.grain && x.key !== periodKey && x.key !== 'd30p')
    .map((x) => x.key);
  if (p.grain === 'month') same.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  return same.length ? ['prev', ...same] : ['prev'];
}

export function resolveCompare(periods: Map<string, Period>, periodKey: string, cmp: string): Period | null {
  const p = periods.get(periodKey);
  if (!p) return null;
  const key = cmp === 'prev' ? p.prevKey : cmp;
  return key ? periods.get(key) ?? null : null;
}

export const inPeriod = (iso: string | null | undefined, p: Period): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t < p.to.getTime();
};

/** Rule 2 lives in the types: null means "no denominator", and only the
 *  formatter may decide how that looks. */
export const pctOf = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
export const fmtPct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}%`);

/**
 * Delta between two rates, as the card chip shows it. `badUp` flips the
 * colouring for metrics where rising is the failure (no-shows, non-eligible).
 * Changes under ±0.35pp render flat — decimal jitter is not a trend.
 */
export function deltaOf(now: number | null, before: number | null | undefined, badUp = false):
  { text: string; dir: 'up' | 'down' | 'flat'; good: boolean } {
  if (now === null || before === null || before === undefined)
    return { text: '—', dir: 'flat', good: true };
  const d = now - before;
  if (Math.abs(d) < 0.35) return { text: '—', dir: 'flat', good: true };
  return { text: `${d > 0 ? '+' : ''}${d.toFixed(1)}`, dir: d > 0 ? 'up' : 'down', good: badUp ? d < 0 : d > 0 };
}

/** Count-style delta ("342 vs 298" → +14.8%). */
export function countDelta(now: number, before: number | null): { text: string; dir: 'up' | 'down' | 'flat'; good: boolean } {
  if (before === null || before === 0) return { text: '—', dir: 'flat', good: true };
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 0.5) return { text: '—', dir: 'flat', good: true };
  return { text: `${d > 0 ? '+' : ''}${d.toFixed(1)}%`, dir: d > 0 ? 'up' : 'down', good: d > 0 };
}
