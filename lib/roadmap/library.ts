// ============================================================================
// ROADMAP LIBRARY — the reusable half of the roadmap system.
//
// Routes, criteria (MC / OC1..OCn) and the activity library are set up once and
// reused for every client. Nothing here decides anything: it is a catalogue the
// consultant picks from. The judgement — which criteria this candidate should
// be endorsed against, which activities close their gaps — stays human.
//
// The per-client selections live in `roadmaps.builder` (migration 067) in the
// BuilderState shape below, so a plan can be reopened and edited at any time,
// including after it has been sent.
// ============================================================================

/**
 * How a route is assessed. Not every route works like Tech Nation:
 *
 *   criteria  tick the criteria to evidence   (Digital Tech, Arts, Innovator Founder)
 *   pathway   choose ONE qualifying route     (Academia & Research)
 *   simple    no criteria — build from activities alone
 */
export type RouteMode = 'criteria' | 'pathway' | 'simple';

export interface RmRoute {
  id: string; name: string; sort_order: number; active: boolean;
  mode: RouteMode;
  /**
   * Which VISA this route belongs to (migration 070).
   *
   * Innovator Founder is not a Global Talent route — it is a different visa.
   * GTV has disciplines you choose between (Digital Technology, Arts,
   * Academia); IFV is a single route with nothing to choose. The builder shows
   * only the routes for the lead's own visa, so an IFV client is never offered
   * "Arts and Culture" as if it were an alternative.
   */
  visa: 'gtv' | 'ifv';
}
export interface RmCriterion  {
  id: string; route_id: string; code: string;
  kind: 'mandatory' | 'optional' | 'pathway';
  title: string; description: string | null; sort_order: number; active: boolean;
}
export interface RmActivity {
  id: string; criterion_id: string | null; title: string; detail: string | null;
  priority: Priority; sort_order: number; active: boolean;
  /**
   * Only meaningful for GENERAL activities (criterion_id === null): which visa
   * they belong to (migration 071).
   *
   * Without this, "general" meant "every route", which is how GTV admin work —
   * evidence audit, personal statement, recommendation letters — ended up on
   * Innovator Founder plans. A founder needs none of it. Criterion-linked rows
   * are already scoped through their route, so this is null for those.
   */
  visa: 'gtv' | 'ifv' | null;
}

export type Priority = 'ESSENTIAL' | 'IMPORTANT' | 'GOOD TO HAVE';
export const PRIORITIES: Priority[] = ['ESSENTIAL', 'IMPORTANT', 'GOOD TO HAVE'];

export const PRIORITY_META: Record<Priority, { label: string; bg: string; fg: string; dot: string }> = {
  ESSENTIAL:      { label: 'Essential',   bg: '#FEECEC', fg: '#B42318', dot: '#EF4444' },
  IMPORTANT:      { label: 'Important',   bg: '#FEF6E7', fg: '#92400E', dot: '#F59E0B' },
  'GOOD TO HAVE': { label: 'Good to have', bg: '#ECFDF3', fg: '#15803D', dot: '#22C55E' },
};

/** One row the consultant has chosen for this client. */
export interface BuilderItem {
  /** Where it came from — null for something typed by hand. */
  activity_id: string | null;
  /** 'OC3', 'MC', or '' when the activity serves the plan rather than a criterion. */
  criterion_code: string;
  title: string;
  detail: string;
  priority: Priority;
  /** Week band, 1-based and inclusive. week_to === week_from for a single week. */
  week_from: number;
  week_to: number;
}

/** Everything the consultant chose. Stored on roadmaps.builder so it reopens. */
export interface BuilderState {
  route_id: string | null;
  route_name: string;
  profile: string;          // "AI Engineer at Infosys"
  grade: string;            // Exceptional Talent / Exceptional Promise
  duration_weeks: number;   // 4 / 6 / 8 / 12
  criterion_ids: string[];  // the ticked MC + OCs
  summary: string;          // the 1–2 lines: what we need to build
  evidence_score: string;   // optional, free text e.g. "62/100"
  items: BuilderItem[];
  strengths: string[];
  gaps: string[];
}

/** What section 2 is called, and what it asks for, per route shape. */
export function criteriaCopy(mode: RouteMode): { title: string; hint: string; empty: string; single: boolean } {
  if (mode === 'pathway') {
    return {
      title: 'Qualifying pathway',
      hint: 'Pick the ONE route this applicant qualifies under. For an appointment, fellowship or grant the plan is collecting documents, not building new evidence.',
      empty: 'No pathways set for this route yet — add them in Manage library, or build the plan from activities below.',
      single: true,
    };
  }
  return {
    title: 'Criteria to build against',
    hint: 'You decide. Tick the criteria this candidate will be endorsed on.',
    empty: 'No criteria set for this route yet — add them in Manage library, or build the plan from activities below.',
    single: false,
  };
}

export const GRADES = ['Exceptional Talent', 'Exceptional Promise'];

/**
 * Per-route look and grading. Accents keep the four routes visually distinct
 * (a founder plan should not look like a research plan), and grades exist only
 * where the endorsing body actually awards them — Innovator Founder has no
 * Talent/Promise split, so its grade list is empty and the UI hides the field.
 */
export function routeTheme(name: string): { accent: string; soft: string; ink: string; grades: string[] } {
  const n = (name || '').toLowerCase();
  if (n.includes('innovator')) return { accent: '#0D9488', soft: '#F0FDFA', ink: '#115E59', grades: [] };
  if (n.includes('academia') || n.includes('research'))
    return { accent: '#0284C7', soft: '#F0F9FF', ink: '#075985', grades: GRADES };
  if (n.includes('art')) return { accent: '#DB2777', soft: '#FDF2F8', ink: '#9D174D', grades: GRADES };
  return { accent: '#4F46E5', soft: '#EEF2FF', ink: '#3730A3', grades: GRADES };
}
export const DURATIONS = [4, 6, 8, 12];

export const VISA_LABEL: Record<'gtv' | 'ifv', string> = {
  gtv: 'Global Talent Visa',
  ifv: 'Innovator Founder Visa',
};

/**
 * Resolve a lead's stored visa_type to 'gtv' | 'ifv', or null when it has never
 * been set. Mirrors getVisaMeta in lib/types so free-text legacy values
 * ("Global Talent", "innovator founder") still resolve.
 */
export function leadVisa(visaType: string | null | undefined): 'gtv' | 'ifv' | null {
  if (!visaType) return null;
  const k = visaType.toLowerCase().trim();
  if (k === 'gtv' || k === 'ifv') return k;
  if (k.includes('innovator') || k.includes('founder') || k.includes('ifv')) return 'ifv';
  if (k.includes('global') || k.includes('talent') || k.includes('gtv')) return 'gtv';
  return null;
}

export function emptyBuilder(): BuilderState {
  return {
    route_id: null, route_name: '', profile: '', grade: GRADES[1],
    duration_weeks: 8, criterion_ids: [], summary: '', evidence_score: '',
    items: [], strengths: [], gaps: [],
  };
}

/**
 * Spread activities evenly across the plan, Essential first.
 *
 * This is a STARTING LAYOUT, not a decision — the consultant drags the weeks
 * afterwards. It exists only so nobody has to type twelve week numbers by hand
 * before they can see the shape of the plan.
 *
 * Bands are paired weeks when the plan is long enough (Week 1–2, 3–4 …), which
 * is how these roadmaps read best; a 4-week plan gets single weeks instead.
 */
export function autoSchedule(items: BuilderItem[], weeks: number): BuilderItem[] {
  if (items.length === 0) return items;
  const rank: Record<Priority, number> = { ESSENTIAL: 0, IMPORTANT: 1, 'GOOD TO HAVE': 2 };
  const ordered = [...items].sort((a, b) => rank[a.priority] - rank[b.priority]);

  const bandSize = weeks >= 6 ? 2 : 1;
  const bandCount = Math.max(1, Math.ceil(weeks / bandSize));
  const perBand = Math.ceil(ordered.length / bandCount);

  return ordered.map((it, i) => {
    const band = Math.min(bandCount - 1, Math.floor(i / perBand));
    const from = band * bandSize + 1;
    const to = Math.min(weeks, from + bandSize - 1);
    return { ...it, week_from: from, week_to: to };
  });
}

/** "Week 3–4" / "Week 5" — the label the client sees. */
export function weekLabel(item: Pick<BuilderItem, 'week_from' | 'week_to'>): string {
  return item.week_from === item.week_to
    ? `Week ${item.week_from}`
    : `Week ${item.week_from}–${item.week_to}`;
}

/** Sort by week, then by priority, so the plan always reads in order. */
export function sortItems(items: BuilderItem[]): BuilderItem[] {
  const rank: Record<Priority, number> = { ESSENTIAL: 0, IMPORTANT: 1, 'GOOD TO HAVE': 2 };
  return [...items].sort((a, b) =>
    a.week_from - b.week_from || a.week_to - b.week_to || rank[a.priority] - rank[b.priority]);
}
