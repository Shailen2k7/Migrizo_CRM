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
}
export interface RmCriterion  {
  id: string; route_id: string; code: string;
  kind: 'mandatory' | 'optional' | 'pathway';
  title: string; description: string | null; sort_order: number; active: boolean;
}
export interface RmActivity   {
  id: string; criterion_id: string | null; title: string; detail: string | null;
  priority: Priority; sort_order: number; active: boolean;
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
export const DURATIONS = [4, 6, 8, 12];

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
