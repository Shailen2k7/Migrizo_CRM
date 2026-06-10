// =============================================================================
// MIGRIZO CASE JOURNEY — single source of truth  (v2, route-aware)
// Pure data + helpers, ZERO dependencies. Safe to import in the CRM and in the
// client-facing dashboard. The CRM writes `case.journey` (JSONB),
// `case.current_phase`, `case.visa_type`, `case.decision` (endorsement) and
// `case.visa_decision`. The client portal reads the SAME shape via
// supabase.rpc('get_case_journey', { p_token }) / realtime and renders the
// identical journey. KEEP THIS FILE IDENTICAL ACROSS BOTH APPS.
//
// What changed vs v1 (all additive / backward-compatible):
//   • New `VisaType` = 'gtv' | 'ifv', with getJourney(visaType).
//   • The journey now runs end-to-end: Endorsement → Visa → Decision/Landing
//     (v1 stopped at the endorsement decision).
//   • Three MACRO STAGES group the phases for the client spine.
//   • A full IFV phase set (Innovation / Viability / Scalability).
//   • Client-facing labels (`clientName`, `clientBlurb`) for the portal.
//   • A second decision (`visa`) in addition to the endorsement decision.
//   • Every v1 export still exists and behaves as before for GTV (the default).
// =============================================================================

// -----------------------------------------------------------------------------
// CORE TYPES
// -----------------------------------------------------------------------------
export type VisaType = 'gtv' | 'ifv';

export type PhaseKey =
  // GTV endorsement phases (v1 keys kept for backward compatibility)
  | 'start' | 'map' | 'build' | 'write' | 'check' | 'submit'
  // IFV endorsement phases
  | 'ifv_start' | 'ifv_concept' | 'ifv_plan' | 'ifv_docs' | 'ifv_check' | 'ifv_endorse'
  // shared post-endorsement phases (both routes)
  | 'visa_prep' | 'visa_lodge' | 'outcome';

export type PhaseKind = 'tasks' | 'pillars';
export type MacroKey = 'endorsement' | 'visa' | 'decision';
export type DecisionOf = 'endorsement' | 'visa';
export type Decision = 'pending' | 'approved' | 'rejected' | 'resubmission';

export interface JourneyTask {
  key: string;
  label: string;
}

export interface JourneyPillar {
  key: string;
  letter: string;   // A / B / C / D
  name: string;
  hint: string;
}

export interface JourneyPhase {
  key: PhaseKey;
  index: number;        // 1..N within its own route's journey
  code: string;         // "START"
  name: string;         // internal CRM label, e.g. "Onboard & Lock"
  clientName: string;   // warm, client-facing label, e.g. "Getting started"
  clientBlurb: string;  // one line shown to the client
  macro: MacroKey;      // which of the 3 client-facing macro stages it belongs to
  kind: PhaseKind;
  accent: string;       // hex accent for the phase
  tint: string;         // soft background tint
  tasks?: JourneyTask[];
  pillars?: JourneyPillar[];
  gate: string;         // the gate that must be ticked to advance
  decisionOf?: DecisionOf; // if set, this phase carries a decision outcome
}

// -----------------------------------------------------------------------------
// MACRO STAGES — the 3-step spine the client portal shows. Both routes share it.
// -----------------------------------------------------------------------------
export interface MacroStage { key: MacroKey; name: string; blurb: string }
export const MACRO_STAGES: MacroStage[] = [
  { key: 'endorsement', name: 'Endorsement',      blurb: 'Getting you endorsed by the designated body' },
  { key: 'visa',        name: 'Visa Application',  blurb: 'Lodging your visa with the Home Office' },
  { key: 'decision',    name: 'Decision',          blurb: 'Your outcome and landing in the UK' },
];

// -----------------------------------------------------------------------------
// ROUTE METADATA
// -----------------------------------------------------------------------------
export interface RouteMeta {
  code: string;            // 'GTV'
  label: string;           // 'UK Global Talent Visa'
  short: string;           // 'Global Talent'
  evidenceModel: 'criteria' | 'business';
}
export const ROUTE_META: Record<VisaType, RouteMeta> = {
  gtv: { code: 'GTV', label: 'UK Global Talent Visa',    short: 'Global Talent',    evidenceModel: 'criteria' },
  ifv: { code: 'IFV', label: 'UK Innovator Founder Visa', short: 'Innovator Founder', evidenceModel: 'business' },
};

export function getRouteMeta(visaType: VisaType): RouteMeta {
  return ROUTE_META[visaType] || ROUTE_META.gtv;
}

export function normalizeVisaType(raw: unknown): VisaType {
  return raw === 'ifv' ? 'ifv' : 'gtv';
}

// -----------------------------------------------------------------------------
// SHARED POST-ENDORSEMENT PHASES (identical for GTV and IFV)
// Visa Application → Decision & Landing. index 7,8,9 in both routes.
// -----------------------------------------------------------------------------
const VISA_PREP: JourneyPhase = {
  key: 'visa_prep', index: 7, code: 'VISA-PREP', name: 'Visa Application Prep',
  clientName: 'Preparing your visa application',
  clientBlurb: 'With your endorsement secured, we prepare and complete the visa application.',
  macro: 'visa', kind: 'tasks', accent: '#0EA5E9', tint: '#E0F2FE',
  tasks: [
    { key: 'visa_endorsement_in', label: 'Confirm endorsement letter received' },
    { key: 'visa_docs',           label: 'Gather visa supporting documents' },
    { key: 'visa_online',         label: 'Complete the online visa application' },
    { key: 'visa_pay',            label: 'Pay visa fee + Immigration Health Surcharge' },
  ],
  gate: 'Visa application ready to submit',
};

const VISA_LODGE: JourneyPhase = {
  key: 'visa_lodge', index: 8, code: 'VISA-LODGE', name: 'Lodge Visa & Biometrics',
  clientName: 'Visa submitted',
  clientBlurb: 'The visa is lodged with the Home Office and your biometrics are booked.',
  macro: 'visa', kind: 'tasks', accent: '#6366F1', tint: '#EEF0FF',
  tasks: [
    { key: 'visa_submit',     label: 'Submit visa application' },
    { key: 'visa_biometrics', label: 'Book & attend biometrics (VFS)' },
    { key: 'visa_upload',     label: 'Upload supporting documents' },
  ],
  gate: 'Visa submitted — awaiting decision',
};

const OUTCOME: JourneyPhase = {
  key: 'outcome', index: 9, code: 'OUTCOME', name: 'Visa Decision & Landing',
  clientName: 'Decision & landing',
  clientBlurb: 'Your visa decision arrives — then we help you land and settle in the UK.',
  macro: 'decision', kind: 'tasks', accent: '#10B981', tint: '#D1FAE5',
  decisionOf: 'visa',
  tasks: [
    { key: 'outcome_decision', label: 'Visa decision received' },
    { key: 'outcome_brp',      label: 'Collect BRP / activate eVisa' },
    { key: 'outcome_landing',  label: 'Landing & relocation guidance' },
  ],
  gate: 'Visa granted — you are in',
};

// -----------------------------------------------------------------------------
// GTV JOURNEY  — 6 endorsement phases (v1, extended labels) + visa + decision
// -----------------------------------------------------------------------------
const GTV_JOURNEY: JourneyPhase[] = [
  {
    key: 'start', index: 1, code: 'START', name: 'Onboard & Lock',
    clientName: 'Getting started', clientBlurb: 'We set up your case, collect your documents and lock the roadmap.',
    macro: 'endorsement', kind: 'tasks', accent: '#6366F1', tint: '#EEF0FF',
    tasks: [
      { key: 'start_create',  label: 'Create case + assign owner' },
      { key: 'start_sla',     label: 'Sign service agreement (SLA)' },
      { key: 'start_drive',   label: 'Set up Drive folder (fixed template)' },
      { key: 'start_docs',    label: 'Collect ID + employment docs' },
      { key: 'start_kickoff', label: 'Kickoff call' },
      { key: 'start_roadmap', label: 'Build & freeze roadmap' },
    ],
    gate: 'Roadmap frozen — ready to map evidence',
  },
  {
    key: 'map', index: 2, code: 'MAP', name: 'Audit & Strategy',
    clientName: 'Strategy & planning', clientBlurb: 'We confirm your route and map your evidence against the criteria.',
    macro: 'endorsement', kind: 'tasks', accent: '#F59E0B', tint: '#FEF6E7',
    tasks: [
      { key: 'map_route',    label: 'Confirm route + endorsing body' },
      { key: 'map_evidence', label: 'List all existing evidence' },
      { key: 'map_pillars',  label: 'Map evidence to the 4 pillars' },
      { key: 'map_gaps',     label: 'Identify gaps per pillar' },
      { key: 'map_plan',     label: 'Agree gap-closure plan with client' },
    ],
    gate: 'Gap-closure plan agreed with client',
  },
  {
    key: 'build', index: 3, code: 'BUILD', name: 'Evidence Engine',
    clientName: 'Building your evidence', clientBlurb: 'We build proof across your four criteria pillars.',
    macro: 'endorsement', kind: 'pillars', accent: '#EC4899', tint: '#FCE7F3',
    pillars: [
      { key: 'recognition',  letter: 'A', name: 'Recognition',  hint: 'articles, press, awards' },
      { key: 'influence',    letter: 'B', name: 'Influence',    hint: 'talks, mentoring, judging, events' },
      { key: 'innovation',   letter: 'C', name: 'Innovation',   hint: 'product / company / project / IP' },
      { key: 'track_record', letter: 'D', name: 'Track Record', hint: 'LinkedIn, portfolio, publications' },
    ],
    gate: 'All four pillars have evidence',
  },
  {
    key: 'write', index: 4, code: 'WRITE', name: 'Application Docs',
    clientName: 'Writing your application', clientBlurb: 'We write your CV, personal statement and recommendation letters.',
    macro: 'endorsement', kind: 'tasks', accent: '#3B82F6', tint: '#DBEAFE',
    tasks: [
      { key: 'write_cv',           label: 'GTV-aligned CV' },
      { key: 'write_statement',    label: 'Personal statement' },
      { key: 'write_descriptions', label: 'Evidence descriptions (one per piece)' },
      { key: 'write_recommenders', label: 'Identify 3 recommenders' },
      { key: 'write_draft_lors',   label: 'Draft letters of recommendation' },
      { key: 'write_signed_lors',  label: 'Collect signed LORs' },
    ],
    gate: 'All docs drafted & LORs signed',
  },
  {
    key: 'check', index: 5, code: 'CHECK', name: 'QC & Approval',
    clientName: 'Final checks & your approval', clientBlurb: 'We quality-check the pack against the rules and you give final sign-off.',
    macro: 'endorsement', kind: 'tasks', accent: '#8B5CF6', tint: '#EDE9FE',
    tasks: [
      { key: 'check_internal', label: 'Internal review vs endorsing-body rules' },
      { key: 'check_format',   label: 'Format / count / file-size check' },
      { key: 'check_client',   label: 'Client final review & approval' },
    ],
    gate: 'Client approved the final pack',
  },
  {
    key: 'submit', index: 6, code: 'SUBMIT', name: 'Lodge & Decision',
    clientName: 'Endorsement decision', clientBlurb: 'We submit your endorsement application and track the decision.',
    macro: 'endorsement', kind: 'tasks', accent: '#10B981', tint: '#D1FAE5',
    decisionOf: 'endorsement',
    tasks: [
      { key: 'submit_application', label: 'Submit endorsement application' },
      { key: 'submit_log',         label: 'Log submission date + reference' },
      { key: 'submit_track',       label: 'Track decision' },
    ],
    gate: 'Endorsement decision received',
  },
  VISA_PREP, VISA_LODGE, OUTCOME,
];

// -----------------------------------------------------------------------------
// IFV JOURNEY — innovator-founder endorsement + the SAME visa + decision stages
// -----------------------------------------------------------------------------
const IFV_JOURNEY: JourneyPhase[] = [
  {
    key: 'ifv_start', index: 1, code: 'START', name: 'Onboard & Lock',
    clientName: 'Getting started', clientBlurb: 'We set up your case, collect your documents and lock the roadmap.',
    macro: 'endorsement', kind: 'tasks', accent: '#6366F1', tint: '#EEF0FF',
    tasks: [
      { key: 'ifv_start_create',  label: 'Create case + assign owner' },
      { key: 'ifv_start_sla',     label: 'Sign service agreement (SLA)' },
      { key: 'ifv_start_drive',   label: 'Set up Drive folder (fixed template)' },
      { key: 'ifv_start_docs',    label: 'Collect ID + founder background docs' },
      { key: 'ifv_start_kickoff', label: 'Kickoff call' },
      { key: 'ifv_start_roadmap', label: 'Build & freeze roadmap' },
    ],
    gate: 'Roadmap frozen — ready to shape the concept',
  },
  {
    key: 'ifv_concept', index: 2, code: 'CONCEPT', name: 'Concept & Endorsing Body',
    clientName: 'Your business concept', clientBlurb: 'We confirm the endorsing body and shape your innovative business concept.',
    macro: 'endorsement', kind: 'tasks', accent: '#F59E0B', tint: '#FEF6E7',
    tasks: [
      { key: 'ifv_concept_body',    label: 'Confirm approved endorsing body' },
      { key: 'ifv_concept_idea',    label: 'Define the innovative concept' },
      { key: 'ifv_concept_market',  label: 'Market research & positioning' },
      { key: 'ifv_concept_founder', label: 'Founder background & active role' },
    ],
    gate: 'Concept agreed and endorsing-body fit confirmed',
  },
  {
    key: 'ifv_plan', index: 3, code: 'PLAN', name: 'Business Plan',
    clientName: 'Building your business case', clientBlurb: 'We build your plan to meet the three tests: innovative, viable and scalable.',
    macro: 'endorsement', kind: 'pillars', accent: '#EC4899', tint: '#FCE7F3',
    pillars: [
      { key: 'innovative', letter: 'A', name: 'Innovative', hint: 'original idea, market gap, differentiation' },
      { key: 'viable',     letter: 'B', name: 'Viable',     hint: 'skills, experience, resources to deliver' },
      { key: 'scalable',   letter: 'C', name: 'Scalable',   hint: 'growth, jobs, national/international reach' },
    ],
    gate: 'Business plan meets all three tests',
  },
  {
    key: 'ifv_docs', index: 4, code: 'DOCS', name: 'Application Documents',
    clientName: 'Preparing your documents', clientBlurb: 'We finalise your business plan, financials and supporting evidence.',
    macro: 'endorsement', kind: 'tasks', accent: '#3B82F6', tint: '#DBEAFE',
    tasks: [
      { key: 'ifv_docs_plan',       label: 'Finalise business plan document' },
      { key: 'ifv_docs_financials', label: 'Financial projections' },
      { key: 'ifv_docs_evidence',   label: 'Supporting evidence pack' },
      { key: 'ifv_docs_cv',         label: 'Founder CV' },
    ],
    gate: 'Document pack complete',
  },
  {
    key: 'ifv_check', index: 5, code: 'CHECK', name: 'QC & Approval',
    clientName: 'Final checks & your approval', clientBlurb: 'We quality-check against the endorsing-body criteria and you sign off.',
    macro: 'endorsement', kind: 'tasks', accent: '#8B5CF6', tint: '#EDE9FE',
    tasks: [
      { key: 'ifv_check_internal', label: 'Internal review vs endorsing-body criteria' },
      { key: 'ifv_check_client',   label: 'Client final review & approval' },
    ],
    gate: 'Client approved the pack',
  },
  {
    key: 'ifv_endorse', index: 6, code: 'ENDORSE', name: 'Endorsement & Interview',
    clientName: 'Endorsement decision', clientBlurb: 'We submit to the endorsing body, prepare you for interview and secure the letter.',
    macro: 'endorsement', kind: 'tasks', accent: '#10B981', tint: '#D1FAE5',
    decisionOf: 'endorsement',
    tasks: [
      { key: 'ifv_endorse_submit',    label: 'Submit endorsement application' },
      { key: 'ifv_endorse_interview', label: 'Attend endorsement interview' },
      { key: 'ifv_endorse_letter',    label: 'Receive endorsement letter' },
    ],
    gate: 'Endorsement letter issued',
  },
  VISA_PREP, VISA_LODGE, OUTCOME,
];

// -----------------------------------------------------------------------------
// JOURNEY SELECTOR
// `JOURNEY` stays exported as the GTV journey so all existing CRM imports keep
// working unchanged. Use getJourney(case.visa_type) for route-aware code.
// -----------------------------------------------------------------------------
export const JOURNEY: JourneyPhase[] = GTV_JOURNEY;

export function getJourney(visaType: VisaType): JourneyPhase[] {
  return visaType === 'ifv' ? IFV_JOURNEY : GTV_JOURNEY;
}

// -----------------------------------------------------------------------------
// DECISIONS — endorsement decision (v1, kept) + visa decision (new)
// -----------------------------------------------------------------------------
export const DECISION_META: Record<Decision, { label: string; bg: string; fg: string }> = {
  pending:      { label: 'Awaiting decision', bg: '#FEF6E7', fg: '#854F0B' },
  approved:     { label: 'Endorsed ✓',         bg: '#D1FAE5', fg: '#047857' },
  rejected:     { label: 'Rejected',           bg: '#FEE2E2', fg: '#B91C1C' },
  resubmission: { label: 'Resubmission',       bg: '#DBEAFE', fg: '#1E40AF' },
};

export const VISA_DECISION_META: Record<Decision, { label: string; bg: string; fg: string }> = {
  pending:      { label: 'Awaiting visa decision', bg: '#FEF6E7', fg: '#854F0B' },
  approved:     { label: 'Visa granted ✓',          bg: '#D1FAE5', fg: '#047857' },
  rejected:     { label: 'Visa refused',            bg: '#FEE2E2', fg: '#B91C1C' },
  resubmission: { label: 'Admin review / appeal',   bg: '#DBEAFE', fg: '#1E40AF' },
};

export function decisionMetaFor(kind: DecisionOf) {
  return kind === 'visa' ? VISA_DECISION_META : DECISION_META;
}

// -----------------------------------------------------------------------------
// STATE SHAPE (stored in cases.journey JSONB) — unchanged from v1
// -----------------------------------------------------------------------------
export interface PillarEvidence { title: string; link?: string }
export interface CaseJourneyState {
  tasks: Record<string, { done: boolean; at?: string; by?: string }>;
  pillars: Record<string, { done: boolean; evidence?: PillarEvidence[] }>;
  gates: Record<string, { passed: boolean; at?: string }>;
}

export function emptyJourney(): CaseJourneyState {
  return { tasks: {}, pillars: {}, gates: {} };
}

export function normalizeJourney(raw: unknown): CaseJourneyState {
  const j = (raw && typeof raw === 'object') ? raw as Partial<CaseJourneyState> : {};
  return { tasks: j.tasks || {}, pillars: j.pillars || {}, gates: j.gates || {} };
}

// -----------------------------------------------------------------------------
// COUNTS — per-journey helpers + GTV constants kept for backward compatibility
// -----------------------------------------------------------------------------
export function totalTasksOf(journey: JourneyPhase[]): number {
  return journey.reduce((s, p) => s + (p.tasks?.length || 0), 0);
}
export function totalPillarsOf(journey: JourneyPhase[]): number {
  return journey.reduce((s, p) => s + (p.pillars?.length || 0), 0);
}
export function totalItemsOf(journey: JourneyPhase[]): number {
  return totalTasksOf(journey) + totalPillarsOf(journey);
}

export const TOTAL_TASKS = totalTasksOf(JOURNEY);
export const TOTAL_PILLARS = totalPillarsOf(JOURNEY);
export const TOTAL_ITEMS = totalItemsOf(JOURNEY);
export const TOTAL_PHASES = JOURNEY.length;

export function getPhase(key: PhaseKey, journey: JourneyPhase[] = JOURNEY): JourneyPhase {
  return journey.find((p) => p.key === key) || journey[0];
}

// -----------------------------------------------------------------------------
// PER-PHASE PROGRESS  (route-agnostic — operate on a given phase)
// -----------------------------------------------------------------------------
export function phaseProgress(state: CaseJourneyState, phase: JourneyPhase): { done: number; total: number } {
  if (phase.kind === 'pillars') {
    const total = phase.pillars?.length || 0;
    const done = (phase.pillars || []).filter((p) => state.pillars[p.key]?.done).length;
    return { done, total };
  }
  const total = phase.tasks?.length || 0;
  const done = (phase.tasks || []).filter((t) => state.tasks[t.key]?.done).length;
  return { done, total };
}

export function isPhaseComplete(state: CaseJourneyState, phase: JourneyPhase): boolean {
  const { done, total } = phaseProgress(state, phase);
  return total > 0 && done >= total;
}

export function isGatePassed(state: CaseJourneyState, phaseKey: PhaseKey): boolean {
  return !!state.gates[phaseKey]?.passed;
}

// A phase is unlocked once the PREVIOUS phase's gate has been passed.
// Pass the route's journey for IFV; defaults to GTV for existing callers.
export function isPhaseUnlocked(state: CaseJourneyState, phase: JourneyPhase, journey: JourneyPhase[] = JOURNEY): boolean {
  if (phase.index === 1) return true;
  const prev = journey[phase.index - 2];
  return prev ? isGatePassed(state, prev.key) : true;
}

// The active phase = first phase whose gate hasn't been passed yet.
export function activePhase(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): JourneyPhase {
  for (const p of journey) {
    if (!isGatePassed(state, p.key)) return p;
  }
  return journey[journey.length - 1];
}

export function allGatesPassed(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): boolean {
  return journey.every((p) => isGatePassed(state, p.key));
}

// -----------------------------------------------------------------------------
// OVERALL PROGRESS
// -----------------------------------------------------------------------------
export function overallProgress(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): { done: number; total: number; pct: number } {
  let done = 0;
  for (const p of journey) done += phaseProgress(state, p).done;
  const total = totalItemsOf(journey);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

// Number of gates passed — handy for a "phase X of N" label.
export function phasesCleared(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): number {
  return journey.filter((p) => isGatePassed(state, p.key)).length;
}

// -----------------------------------------------------------------------------
// MACRO STAGE HELPERS — power the client portal's 3-step spine
// -----------------------------------------------------------------------------
export function phasesInMacro(journey: JourneyPhase[], macro: MacroKey): JourneyPhase[] {
  return journey.filter((p) => p.macro === macro);
}

// done/total = gates passed within that macro stage (whole phases, not items).
export function macroStageProgress(state: CaseJourneyState, journey: JourneyPhase[], macro: MacroKey): { done: number; total: number } {
  const phases = phasesInMacro(journey, macro);
  const done = phases.filter((p) => isGatePassed(state, p.key)).length;
  return { done, total: phases.length };
}

export function macroStageStatus(state: CaseJourneyState, journey: JourneyPhase[], macro: MacroKey): 'done' | 'active' | 'upcoming' {
  const { done, total } = macroStageProgress(state, journey, macro);
  if (total > 0 && done >= total) return 'done';
  const active = activePhase(state, journey);
  return active.macro === macro ? 'active' : 'upcoming';
}

export function activeMacro(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): MacroKey {
  return activePhase(state, journey).macro;
}

// -----------------------------------------------------------------------------
// DECISION HELPERS
// -----------------------------------------------------------------------------
// The phase in a route that carries a given decision (endorsement / visa).
export function decisionPhase(journey: JourneyPhase[], kind: DecisionOf): JourneyPhase | undefined {
  return journey.find((p) => p.decisionOf === kind);
}

// -----------------------------------------------------------------------------
// CLIENT PORTAL
// The customer dashboard lives at this base. Login-based (no token in URL), but
// clientPortalUrl(token) is kept for the CRM's existing copy-able tracking link.
// The portal reads the same case via supabase.rpc('get_case_journey', { p_token })
// or, post-login, via a row subscription on the client's own case (realtime).
// -----------------------------------------------------------------------------
export const CLIENT_PORTAL_BASE = 'https://app.migrizo.com';

export function clientPortalUrl(token: string | null | undefined): string {
  return token ? `${CLIENT_PORTAL_BASE}/c/${token}` : '';
}
