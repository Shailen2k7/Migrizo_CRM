// =============================================================================
// MASTER LEADS — remembering how you left the sheet.
// -----------------------------------------------------------------------------
// Column widths, sort, every column filter, the date scope and whether the
// summary cards are showing — kept in localStorage for the same reasons the
// sidebar order is (see lib/nav-prefs.ts): a personal display choice, applied
// with no round trip, needing no migration.
//
// Someone who opens this sheet every morning should find it the way they left
// it: the same period in scope, still filtered to what they were working
// through. Re-applying that by hand daily is the difference between a tool
// and a chore.
//
// v2 replaced the fixed Status/GTV/WTP/Response dropdowns with per-column
// filters, so it lives under a new key — a v1 blob simply stops being read
// rather than being half-understood.
//
// Every read is defensive. Anything malformed is dropped rather than trusted,
// and a browser that blocks storage simply gets the defaults.
// =============================================================================

export type DateKind = 'all' | 'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'month' | 'custom';

export interface DatePref {
  kind: DateKind;
  /** 'YYYY-MM' when kind is 'month'. */
  month?: string;
  /** 'YYYY-MM-DD', inclusive, when kind is 'custom'. */
  from?: string;
  to?: string;
}

export interface MasterPrefs {
  widths: Record<string, number>;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  /** Column id → the values it is filtered to. Empty or absent = unfiltered. */
  filters: Record<string, string[]>;
  /** Column id → "contains" text, for the free-text columns. */
  text: Record<string, string>;
  untaggedOnly: boolean;
  date: DatePref;
  cardsHidden: boolean;
}

const KEY = 'migrizo.master.view.v2';

export const DEFAULT_PREFS: MasterPrefs = {
  widths: {},
  sortKey: 'created',
  sortDir: 'desc',
  filters: {},
  text: {},
  untaggedOnly: false,
  date: { kind: 'all' },
  cardsHidden: false,
};

const DATE_KINDS: DateKind[] = ['all', 'today', '7d', '30d', 'this_month', 'last_month', 'month', 'custom'];
const isStr = (x: unknown): x is string => typeof x === 'string';

function cleanDate(d: unknown): DatePref {
  if (!d || typeof d !== 'object') return { kind: 'all' };
  const o = d as Record<string, unknown>;
  const kind = DATE_KINDS.includes(o.kind as DateKind) ? (o.kind as DateKind) : 'all';
  if (kind === 'month') {
    return isStr(o.month) && /^\d{4}-\d{2}$/.test(o.month) ? { kind, month: o.month } : { kind: 'all' };
  }
  if (kind === 'custom') {
    const ok = (s: unknown) => isStr(s) && /^\d{4}-\d{2}-\d{2}$/.test(s);
    return ok(o.from) || ok(o.to)
      ? { kind, from: ok(o.from) ? (o.from as string) : undefined, to: ok(o.to) ? (o.to as string) : undefined }
      : { kind: 'all' };
  }
  return { kind };
}

export function loadMasterPrefs(): MasterPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<MasterPrefs>;
    const filters: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(p.filters ?? {})) {
      if (Array.isArray(v)) filters[k] = v.filter(isStr);
    }
    const text: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.text ?? {})) if (isStr(v)) text[k] = v;
    return {
      widths: Object.fromEntries(
        Object.entries(p.widths ?? {}).filter(
          ([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 36 && v <= 640,
        ),
      ),
      sortKey: isStr(p.sortKey) ? p.sortKey : DEFAULT_PREFS.sortKey,
      sortDir: p.sortDir === 'asc' ? 'asc' : 'desc',
      filters,
      text,
      untaggedOnly: p.untaggedOnly === true,
      date: cleanDate(p.date),
      cardsHidden: p.cardsHidden === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveMasterPrefs(p: MasterPrefs): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* never break the sheet over a preference */ }
}

export function clearMasterPrefs(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to undo */ }
}

// ── Date scope ───────────────────────────────────────────────────────────────
// Computed in the browser's local time, because "August" means the viewer's
// August — for this team, IST — not UTC's, which would move late-night leads
// on the 31st into the wrong month.

export interface DateRange { from: number | null; to: number | null; label: string; slug: string }

const MONTH_FMT: Intl.DateTimeFormatOptions = { month: 'short', year: 'numeric' };

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', MONTH_FMT);
}

export function monthKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayStart(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function parseDay(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
const DAY = 86_400_000;

export function rangeOf(d: DatePref, now = new Date()): DateRange {
  const today = dayStart(now);
  switch (d.kind) {
    case 'today':      return { from: today, to: today + DAY, label: 'Today', slug: 'today' };
    case '7d':         return { from: today - 6 * DAY, to: today + DAY, label: 'Last 7 days', slug: 'last-7-days' };
    case '30d':        return { from: today - 29 * DAY, to: today + DAY, label: 'Last 30 days', slug: 'last-30-days' };
    case 'this_month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const t = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { from: f, to: t, label: 'This month', slug: monthKeyOf(new Date(f).toISOString()) };
    }
    case 'last_month': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const t = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const ym = `${new Date(f).getFullYear()}-${String(new Date(f).getMonth() + 1).padStart(2, '0')}`;
      return { from: f, to: t, label: 'Last month', slug: ym };
    }
    case 'month': {
      const [y, m] = (d.month ?? '').split('-').map(Number);
      if (!y || !m) break;
      return {
        from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime(),
        label: monthLabel(d.month!), slug: d.month!,
      };
    }
    case 'custom': {
      const f = d.from ? parseDay(d.from) : null;
      const t = d.to ? parseDay(d.to) + DAY : null;
      const fmt = (s?: string) => s ? new Date(parseDay(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '…';
      return { from: f, to: t, label: `${fmt(d.from)} – ${fmt(d.to)}`, slug: `${d.from ?? 'start'}_to_${d.to ?? 'now'}` };
    }
  }
  return { from: null, to: null, label: 'All time', slug: 'all-time' };
}
