// =============================================================================
// CASE DETAILS — the GTV case form, as data.
// -----------------------------------------------------------------------------
// The case page (approved design, 28 Sep 2026) is eight numbered sections of
// checkboxes and links: Onboarding · Documents in Drive · Letters of
// recommendation · Criteria & evidence · CV & personal statement · LinkedIn ·
// Canva · Client review & filing readiness.
//
// It is stored at cases.journey.details — a JSON field every case already has
// — so it needs no migration and cannot collide with the six-phase journey the
// client emails read (tasks/pillars/gates sit beside it, untouched).
//
// Exactly 24 checkboxes make up "N of 24 tasks": 1 + 1 + 9 (three letters ×
// identified/drafted/signed) + 2 (mandatory criteria) + 4 (two optional
// criteria × two evidence items) + 2 + 1 + 2 + 2.
// =============================================================================

export interface LorRow { name: string; identified: boolean; drafted: boolean; signed: boolean; link: string }
export interface MandatoryCriterion { title: string; done: boolean; link: string }
export interface EvidenceItem { text: string; done: boolean; link: string }
export interface OptionalCriterion { code: string; title: string; evidence: [EvidenceItem, EvidenceItem] }

export interface CaseDetails {
  route: string;
  target_date: string | null;          // 'YYYY-MM-DD'
  stage_entered_at?: string | null;    // until migration 124 adds the column
  onboarded: boolean;
  onboarded_at: string | null;
  docs_received: boolean;
  drive_url: string;
  lors: [LorRow, LorRow, LorRow];
  mc: [MandatoryCriterion, MandatoryCriterion];
  oc: [OptionalCriterion, OptionalCriterion];
  cv_done: boolean; cv_link: string;
  ps_done: boolean; ps_link: string;
  linkedin_done: boolean; linkedin_url: string;
  canva_created: boolean; canva_updated: boolean; canva_url: string;
  review_discussed: boolean; review_final: boolean;
  next_action: string;
  ready_to_file_at: string | null;
  /** Client photo in the private case-photos bucket (served via /api/case/photo). */
  photo_path?: string | null;
  /** Set when the case is closed (cases.archived_at). Kept on reopen as history is in case_activity. */
  closed_reason?: CloseReason | null;
  /** Section 9 — mirrored to the cases columns on save (see withDecisions). */
  endorsement?: Verdict;
  endorsement_ref?: string;
  endorsement_submitted_on?: string | null;   // 'YYYY-MM-DD'
  endorsement_decided_on?: string | null;
  visa?: Verdict;
  visa_applied_on?: string | null;
  visa_decided_on?: string | null;
  /** Innovator Founder checklist — only present on IFV cases (see IfvDetails). */
  ifv?: IfvDetails;
  closed_note?: string | null;
  closed_at?: string | null;
}

export type Verdict = 'pending' | 'approved' | 'rejected';

/**
 * The decision fields, read from the case's own columns — those are what the
 * Cases list and every report read, so they are the truth. Only the refusal
 * dates, which have no column, come from the form.
 */
export function withDecisions(d: CaseDetails, c: {
  endorsement_status?: string | null; visa_status?: string | null; submission_ref?: string | null;
  endorsement_submitted_at?: string | null; endorsement_approved_at?: string | null;
  visa_submitted_at?: string | null; visa_approved_at?: string | null;
}): CaseDetails {
  const v = (s: string | null | undefined): Verdict => (s === 'approved' || s === 'rejected' ? s : 'pending');
  const day = (x: string | null | undefined) => (x ? x.slice(0, 10) : null);
  const endorsement = v(c.endorsement_status);
  const visa = v(c.visa_status);
  return {
    ...d,
    endorsement,
    endorsement_ref: c.submission_ref ?? '',
    endorsement_submitted_on: day(c.endorsement_submitted_at),
    endorsement_decided_on: endorsement === 'approved' ? day(c.endorsement_approved_at) ?? d.endorsement_decided_on ?? null
      : endorsement === 'rejected' ? d.endorsement_decided_on ?? null : null,
    visa,
    visa_applied_on: day(c.visa_submitted_at),
    visa_decided_on: visa === 'approved' ? day(c.visa_approved_at) ?? d.visa_decided_on ?? null
      : visa === 'rejected' ? d.visa_decided_on ?? null : null,
  };
}

/**
 * Why a case left the active book. A closed case keeps everything — form,
 * notes, payments — it only moves to the Closed view and can be reopened.
 */
export type CloseReason = 'backed_out' | 'no_response' | 'refunded' | 'refused' | 'duplicate' | 'other';
export const CLOSE_REASONS: { value: CloseReason; label: string }[] = [
  { value: 'backed_out',  label: 'Client backed out' },
  { value: 'no_response', label: 'Stopped responding' },
  { value: 'refunded',    label: 'Refunded' },
  { value: 'refused',     label: 'Endorsement / visa refused' },
  { value: 'duplicate',   label: 'Duplicate case' },
  { value: 'other',       label: 'Other' },
];
export const closeReasonLabel = (r: string | null | undefined) =>
  CLOSE_REASONS.find((x) => x.value === r)?.label ?? 'Closed';

export const GTV_ROUTES: { value: string; label: string }[] = [
  { value: 'digital_technology', label: 'Digital technology' },
  { value: 'arts_culture',       label: 'Arts & culture' },
  { value: 'academia_research',  label: 'Academia & research' },
];

/** The four Tech Nation optional criteria, with the title each starts as. */
export const OC_OPTIONS: { code: string; title: string }[] = [
  { code: 'OC1', title: 'Innovation' },
  { code: 'OC2', title: 'Recognition outside occupation' },
  { code: 'OC3', title: 'Significant contribution' },
  { code: 'OC4', title: 'Academic contribution' },
];

const evidence = (): EvidenceItem => ({ text: '', done: false, link: '' });
const lor = (): LorRow => ({ name: '', identified: false, drafted: false, signed: false, link: '' });

export function emptyDetails(): CaseDetails {
  return {
    route: 'digital_technology',
    target_date: null,
    onboarded: false, onboarded_at: null,
    docs_received: false, drive_url: '',
    lors: [lor(), lor(), lor()],
    mc: [
      { title: 'Recognition evidence', done: false, link: '' },
      { title: 'Leadership evidence', done: false, link: '' },
    ],
    oc: [
      { code: 'OC1', title: 'Innovation', evidence: [evidence(), evidence()] },
      { code: 'OC3', title: 'Significant contribution', evidence: [evidence(), evidence()] },
    ],
    cv_done: false, cv_link: '',
    ps_done: false, ps_link: '',
    linkedin_done: false, linkedin_url: '',
    canva_created: false, canva_updated: false, canva_url: '',
    review_discussed: false, review_final: false,
    next_action: '',
    ready_to_file_at: null,
  };
}

/**
 * A stored form, completed with defaults for anything missing. Written
 * defensively because this JSON is read from the database: a partial or
 * older shape must still render, never crash the page.
 */
export function hydrateDetails(raw: unknown): CaseDetails {
  const d = emptyDetails();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<CaseDetails>;
  const pick = <T,>(v: T | undefined, fb: T): T => (v === undefined || v === null ? fb : v);
  return {
    ...d,
    ...Object.fromEntries(Object.entries(r).filter(([k]) => !['lors', 'mc', 'oc'].includes(k))),
    lors: d.lors.map((x, i) => ({ ...x, ...(r.lors?.[i] ?? {}) })) as CaseDetails['lors'],
    mc: d.mc.map((x, i) => ({ ...x, ...(r.mc?.[i] ?? {}) })) as CaseDetails['mc'],
    oc: d.oc.map((x, i) => {
      const o = r.oc?.[i];
      return {
        code: pick(o?.code, x.code),
        title: pick(o?.title, x.title),
        evidence: x.evidence.map((e, j) => ({ ...e, ...(o?.evidence?.[j] ?? {}) })) as OptionalCriterion['evidence'],
      };
    }) as CaseDetails['oc'],
  } as CaseDetails;
}

/** Every checkbox on the page, with a human label — drives the count and the timeline. */
export function tasksOf(d: CaseDetails): { key: string; label: string; done: boolean }[] {
  const t: { key: string; label: string; done: boolean }[] = [
    { key: 'onboarded', label: 'Client onboarded', done: d.onboarded },
    { key: 'docs', label: 'All required documents received', done: d.docs_received },
  ];
  d.lors.forEach((l, i) => {
    t.push({ key: `lor${i}_i`, label: `LoR ${i + 1} identified`, done: l.identified });
    t.push({ key: `lor${i}_d`, label: `LoR ${i + 1} drafted`, done: l.drafted });
    t.push({ key: `lor${i}_s`, label: `LoR ${i + 1} signed`, done: l.signed });
  });
  d.mc.forEach((m, i) => t.push({ key: `mc${i}`, label: `MC${i + 1} ${m.title} complete`, done: m.done }));
  d.oc.forEach((o, i) => o.evidence.forEach((e, j) =>
    t.push({ key: `oc${i}_${j}`, label: `${o.code} evidence ${j + 1}`, done: e.done })));
  t.push({ key: 'cv', label: 'CV finalised', done: d.cv_done });
  t.push({ key: 'ps', label: 'Personal statement finalised', done: d.ps_done });
  t.push({ key: 'linkedin', label: 'LinkedIn updated', done: d.linkedin_done });
  t.push({ key: 'canva_c', label: 'Canva link created', done: d.canva_created });
  t.push({ key: 'canva_u', label: 'All documents updated in Canva', done: d.canva_updated });
  t.push({ key: 'rev_d', label: 'Canva link & evidence discussed with client', done: d.review_discussed });
  t.push({ key: 'rev_f', label: 'Final changes completed', done: d.review_final });
  return t;
}

export function progressOfDetails(d: CaseDetails): { done: number; total: number; pct: number } {
  const t = tasksOf(d);
  const done = t.filter((x) => x.done).length;
  return { done, total: t.length, pct: t.length ? Math.round((done / t.length) * 100) : 0 };
}

/** Accepts "drive.google.com/…" as well as a full URL; anything else is ignored. */
export function safeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}


// =============================================================================
// INNOVATOR FOUNDER VISA — the IFV case checklist (owner's brief, 6 Oct 2026)
// -----------------------------------------------------------------------------
// The route: Migrizo develops the business idea WITH the founder (clients come
// without one), builds the business-plan pack, an endorsing body assesses it
// as Innovative · Viable · Scalable, and the visa follows the endorsement
// letter. No post-visa check-in tracking — those are post-visa services.
//
// Stored at journey.details.ifv, beside — never inside — the GTV fields, so a
// case switched between routes keeps both checklists intact. Shared with GTV:
// onboarding, Documents in Drive, target date, next action, ready-to-file,
// the decision fields, photo and closure.
// =============================================================================

export interface IfvDoc { drafted: boolean; final: boolean; link: string }
export interface IfvCriterion { done: boolean; note: string; link: string }
export type IfvDocKey = 'business_plan' | 'financial_forecast' | 'pitch_deck' | 'market_research' | 'founder_statement';
export type IfvCriterionKey = 'innovative' | 'viable' | 'scalable';

export interface IfvDetails {
  founder_reviewed: boolean;
  idea_developed: boolean;
  idea_title: string;
  english_b2: boolean;
  funds_checked: boolean;
  docs: Record<IfvDocKey, IfvDoc>;
  criteria: Record<IfvCriterionKey, IfvCriterion>;
  review_discussed: boolean;
  review_final: boolean;
  endorsing_body: string;          // ENDORSING_BODIES value
  endorsing_body_other: string;
  interview_date: string | null;   // 'YYYY-MM-DD'
  interview_prep: boolean;
  interview_done: boolean;
}

export const IFV_DOCS: { key: IfvDocKey; label: string; hint: string }[] = [
  { key: 'business_plan',      label: 'Business plan',              hint: 'The full plan the endorsing body assesses' },
  { key: 'financial_forecast', label: 'Financial forecast (3 years)', hint: 'P&L, cash flow and key assumptions' },
  { key: 'pitch_deck',         label: 'Pitch deck',                 hint: 'Used in the endorsement interview' },
  { key: 'market_research',    label: 'Market research',            hint: 'UK market size, customers, competitors' },
  { key: 'founder_statement',  label: 'Founder CV & statement',     hint: "Why this founder can deliver this business" },
];

export const IFV_CRITERIA: { key: IfvCriterionKey; label: string; question: string }[] = [
  { key: 'innovative', label: 'Innovative', question: 'A genuine, original business plan that meets new or existing market needs and/or creates a competitive advantage.' },
  { key: 'viable',     label: 'Viable',     question: 'Realistic and achievable plan; the founder has, or is developing, the skills, knowledge and market awareness to run it.' },
  { key: 'scalable',   label: 'Scalable',   question: 'Evidence of structured planning and potential for job creation and growth into national and international markets.' },
];

/** Default first: Innovator International is the most established IFV endorsing body. */
export const ENDORSING_BODIES: { value: string; label: string }[] = [
  { value: 'innovator_international', label: 'Innovator International' },
  { value: 'envestors',               label: 'Envestors' },
  { value: 'other',                   label: 'Other' },
];

const ifvDoc = (): IfvDoc => ({ drafted: false, final: false, link: '' });
const ifvCrit = (): IfvCriterion => ({ done: false, note: '', link: '' });

export function emptyIfv(): IfvDetails {
  return {
    founder_reviewed: false, idea_developed: false, idea_title: '', english_b2: false, funds_checked: false,
    docs: { business_plan: ifvDoc(), financial_forecast: ifvDoc(), pitch_deck: ifvDoc(), market_research: ifvDoc(), founder_statement: ifvDoc() },
    criteria: { innovative: ifvCrit(), viable: ifvCrit(), scalable: ifvCrit() },
    review_discussed: false, review_final: false,
    endorsing_body: 'innovator_international', endorsing_body_other: '',
    interview_date: null, interview_prep: false, interview_done: false,
  };
}

/** A stored IFV checklist completed with defaults — older or partial shapes still render. */
export function hydrateIfv(raw: unknown): IfvDetails {
  const e = emptyIfv();
  if (!raw || typeof raw !== 'object') return e;
  const r = raw as Partial<IfvDetails>;
  return {
    ...e,
    ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'docs' && k !== 'criteria')),
    docs: Object.fromEntries(IFV_DOCS.map(({ key }) => [key, { ...e.docs[key], ...(r.docs?.[key] ?? {}) }])) as IfvDetails['docs'],
    criteria: Object.fromEntries(IFV_CRITERIA.map(({ key }) => [key, { ...e.criteria[key], ...(r.criteria?.[key] ?? {}) }])) as IfvDetails['criteria'],
  } as IfvDetails;
}

/** Every IFV checkbox, labelled for the progress count and the case timeline. */
export function tasksOfIfv(d: CaseDetails): { key: string; label: string; done: boolean }[] {
  const v = hydrateIfv(d.ifv);
  const t: { key: string; label: string; done: boolean }[] = [
    { key: 'onboarded', label: 'Client onboarded', done: d.onboarded },
    { key: 'ifv_founder', label: 'Founder profile reviewed', done: v.founder_reviewed },
    { key: 'ifv_idea', label: 'Business idea developed', done: v.idea_developed },
    { key: 'ifv_english', label: 'English (B2) evidence confirmed', done: v.english_b2 },
    { key: 'ifv_funds', label: 'Maintenance funds checked', done: v.funds_checked },
    { key: 'docs', label: 'All required documents received', done: d.docs_received },
  ];
  IFV_DOCS.forEach(({ key, label }) => {
    t.push({ key: `ifv_${key}_d`, label: `${label} drafted`, done: v.docs[key].drafted });
    t.push({ key: `ifv_${key}_f`, label: `${label} final`, done: v.docs[key].final });
  });
  IFV_CRITERIA.forEach(({ key, label }) => t.push({ key: `ifv_c_${key}`, label: `${label} evidence covered`, done: v.criteria[key].done }));
  t.push({ key: 'ifv_rev_d', label: 'Document pack discussed with client', done: v.review_discussed });
  t.push({ key: 'ifv_rev_f', label: 'Client sign-off on final pack', done: v.review_final });
  t.push({ key: 'ifv_int_p', label: 'Endorsement interview prepared', done: v.interview_prep });
  t.push({ key: 'ifv_int_d', label: 'Endorsement interview attended', done: v.interview_done });
  return t;
}

/** The checklist for this case's route. */
export function tasksFor(d: CaseDetails, ifv: boolean) {
  return ifv ? tasksOfIfv(d) : tasksOf(d);
}

export function progressFor(d: CaseDetails, ifv: boolean): { done: number; total: number; pct: number } {
  const t = tasksFor(d, ifv);
  const done = t.filter((x) => x.done).length;
  return { done, total: t.length, pct: t.length ? Math.round((done / t.length) * 100) : 0 };
}
