// =============================================================================
// MIGRIZO CASE JOURNEY — single source of truth (v3, simplified 5-step)
// Pure data + helpers, ZERO dependencies. Imported by the CRM and the email
// templates. The CRM writes case.journey (JSONB) + case.current_phase.
// =============================================================================

// ------------------------------- CORE TYPES ----------------------------------
export type VisaType = 'gtv' | 'ifv';

export type PhaseKey = 'onboarding' | 'profile' | 'write_approve' | 'endorsement' | 'visa';

export type PhaseKind = 'tasks' | 'pillars';
export type MacroKey = 'endorsement' | 'visa' | 'decision';
export type DecisionOf = 'endorsement' | 'visa';
export type Decision = 'pending' | 'approved' | 'rejected' | 'resubmission';

export interface JourneyTask { key: string; label: string }
export interface JourneyPillar { key: string; letter: string; name: string; hint: string }

export interface JourneyPhase {
  key: PhaseKey;
  index: number;        // 1..N
  code: string;         // short chip label, e.g. "PROFILE"
  name: string;         // CRM label, e.g. "Build the Profile"
  clientName: string;   // friendly label for the client
  clientBlurb: string;  // one line for the client
  macro: MacroKey;
  kind: PhaseKind;      // always 'tasks' in v3 (pillars kept for type-compat)
  accent: string;
  tint: string;
  tasks?: JourneyTask[];
  pillars?: JourneyPillar[];
  gate: string;
  decisionOf?: DecisionOf;
}

// --------------------------- MACRO STAGES (compat) ---------------------------
export interface MacroStage { key: MacroKey; name: string; blurb: string }
export const MACRO_STAGES: MacroStage[] = [
  { key: 'endorsement', name: 'Endorsement',     blurb: 'Getting you endorsed by the designated body' },
  { key: 'visa',        name: 'Visa Application', blurb: 'Lodging your visa with the Home Office' },
  { key: 'decision',    name: 'Decision',         blurb: 'Your outcome and landing in the UK' },
];

// ------------------------------- ROUTE META ----------------------------------
export interface RouteMeta { code: string; label: string; short: string; evidenceModel: 'criteria' | 'business' }
export const ROUTE_META: Record<VisaType, RouteMeta> = {
  gtv: { code: 'GTV', label: 'UK Global Talent Visa',    short: 'Global Talent',     evidenceModel: 'criteria' },
  ifv: { code: 'IFV', label: 'UK Innovator Founder Visa', short: 'Innovator Founder', evidenceModel: 'business' },
};
export function getRouteMeta(visaType: VisaType): RouteMeta { return ROUTE_META[visaType] || ROUTE_META.gtv; }
export function normalizeVisaType(raw: unknown): VisaType {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('innovator') || s.includes('founder') || s === 'ifv') return 'ifv';
  return 'gtv';
}

// ------------------------------ THE JOURNEY ----------------------------------
// One clean 5-step journey, from onboarding through visa approval.
const STEPS: JourneyPhase[] = [
  {
    key: 'onboarding', index: 1, code: 'ONBOARD', name: 'Onboarding',
    clientName: 'Getting started', clientBlurb: 'We set you up, collect your documents and agree the plan.',
    macro: 'endorsement', kind: 'tasks', accent: '#6366F1', tint: '#EEF0FF',
    tasks: [
      { key: 'ob_agreement', label: 'Sign agreement & confirm payment' },
      { key: 'ob_docs',      label: 'Collect documents' },
      { key: 'ob_kickoff',   label: 'Kickoff call & agree the plan' },
    ],
    gate: 'Onboarding complete — plan agreed',
  },
  {
    key: 'profile', index: 2, code: 'PROFILE', name: 'Build the Profile',
    clientName: 'Building your profile', clientBlurb: 'We build the recognition behind your application.',
    macro: 'endorsement', kind: 'tasks', accent: '#EC4899', tint: '#FCE7F3',
    tasks: [
      { key: 'pf_review',     label: 'Review profile & spot the gaps' },
      { key: 'pf_mentorship', label: 'Set up mentorship, talks & judging' },
      { key: 'pf_media',      label: 'Get media features & published articles' },
      { key: 'pf_innovation', label: 'Build innovation & recognition evidence' },
    ],
    gate: 'Profile built — evidence ready',
  },
  {
    key: 'write_approve', index: 3, code: 'WRITE', name: 'Write & Approve',
    clientName: 'Writing your application', clientBlurb: 'We write everything and you give the final sign-off.',
    macro: 'endorsement', kind: 'tasks', accent: '#3B82F6', tint: '#DBEAFE',
    tasks: [
      { key: 'wr_docs',   label: 'Draft CV & personal statement' },
      { key: 'wr_lors',   label: 'Get 3 recommendation letters' },
      { key: 'wr_qc',     label: 'Quality check' },
      { key: 'wr_client', label: 'Client reviews & approves' },
    ],
    gate: 'Application approved by client',
  },
  {
    key: 'endorsement', index: 4, code: 'ENDORSE', name: 'Endorsement',
    clientName: 'Endorsement decision', clientBlurb: 'We submit to the endorsing body and track the decision.',
    macro: 'endorsement', kind: 'tasks', accent: '#8B5CF6', tint: '#EDE9FE', decisionOf: 'endorsement',
    tasks: [
      { key: 'en_submit',   label: 'Submit endorsement application' },
      { key: 'en_decision', label: 'Receive endorsement decision' },
    ],
    gate: 'Endorsement decision received',
  },
  {
    key: 'visa', index: 5, code: 'VISA', name: 'Visa & Approval',
    clientName: 'Visa & approval', clientBlurb: 'We lodge your visa and help you land in the UK.',
    macro: 'visa', kind: 'tasks', accent: '#10B981', tint: '#D1FAE5', decisionOf: 'visa',
    tasks: [
      { key: 'vi_prepare',    label: 'Prepare & submit visa application' },
      { key: 'vi_biometrics', label: 'Pay fees & biometrics' },
      { key: 'vi_decision',   label: 'Visa decision & welcome to the UK' },
    ],
    gate: 'Visa decision received',
  },
];

export const JOURNEY: JourneyPhase[] = STEPS;
// Same simple journey for both routes (GTV/IFV share these 5 steps).
export function getJourney(_visaType?: VisaType): JourneyPhase[] { return STEPS; }

// ------------------------------- DECISIONS -----------------------------------
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
export function decisionMetaFor(kind: DecisionOf) { return kind === 'visa' ? VISA_DECISION_META : DECISION_META; }

// --------------------------------- STATE -------------------------------------
export interface PillarEvidence { title: string; link?: string }
export interface CaseJourneyState {
  tasks: Record<string, { done: boolean; at?: string; by?: string }>;
  pillars: Record<string, { done: boolean; evidence?: PillarEvidence[] }>;
  gates: Record<string, { passed: boolean; at?: string }>;
}
export function emptyJourney(): CaseJourneyState { return { tasks: {}, pillars: {}, gates: {} }; }
export function normalizeJourney(raw: unknown): CaseJourneyState {
  const j = (raw && typeof raw === 'object') ? raw as Partial<CaseJourneyState> : {};
  return { tasks: j.tasks || {}, pillars: j.pillars || {}, gates: j.gates || {} };
}

// --------------------------------- COUNTS ------------------------------------
export function totalTasksOf(journey: JourneyPhase[]): number { return journey.reduce((s, p) => s + (p.tasks?.length || 0), 0); }
export function totalPillarsOf(journey: JourneyPhase[]): number { return journey.reduce((s, p) => s + (p.pillars?.length || 0), 0); }
export function totalItemsOf(journey: JourneyPhase[]): number { return totalTasksOf(journey) + totalPillarsOf(journey); }
export const TOTAL_TASKS = totalTasksOf(JOURNEY);
export const TOTAL_PILLARS = totalPillarsOf(JOURNEY);
export const TOTAL_ITEMS = totalItemsOf(JOURNEY);
export const TOTAL_PHASES = JOURNEY.length;

export function getPhase(key: PhaseKey, journey: JourneyPhase[] = JOURNEY): JourneyPhase {
  return journey.find((p) => p.key === key) || journey[0];
}

// ----------------------------- PER-PHASE PROGRESS ----------------------------
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
export function isPhaseUnlocked(state: CaseJourneyState, phase: JourneyPhase, journey: JourneyPhase[] = JOURNEY): boolean {
  if (phase.index === 1) return true;
  const prev = journey[phase.index - 2];
  return prev ? isGatePassed(state, prev.key) : true;
}
export function activePhase(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): JourneyPhase {
  for (const p of journey) { if (!isGatePassed(state, p.key)) return p; }
  return journey[journey.length - 1];
}
export function allGatesPassed(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): boolean {
  return journey.every((p) => isGatePassed(state, p.key));
}
export function overallProgress(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): { done: number; total: number; pct: number } {
  let done = 0;
  for (const p of journey) done += phaseProgress(state, p).done;
  const total = totalItemsOf(journey);
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}
export function phasesCleared(state: CaseJourneyState, journey: JourneyPhase[] = JOURNEY): number {
  return journey.filter((p) => isGatePassed(state, p.key)).length;
}

// ----------------------------- MACRO HELPERS (compat) ------------------------
export function phasesInMacro(journey: JourneyPhase[], macro: MacroKey): JourneyPhase[] { return journey.filter((p) => p.macro === macro); }
export function macroStageProgress(state: CaseJourneyState, journey: JourneyPhase[], macro: MacroKey): { done: number; total: number } {
  const phases = phasesInMacro(journey, macro);
  return { done: phases.filter((p) => isGatePassed(state, p.key)).length, total: phases.length };
}
export function decisionPhase(journey: JourneyPhase[], kind: DecisionOf): JourneyPhase | undefined { return journey.find((p) => p.decisionOf === kind); }

// ------------------------------ CLIENT PORTAL --------------------------------
export const CLIENT_PORTAL_BASE = 'https://app.migrizo.com';
export function clientPortalUrl(token: string | null | undefined): string {
  return token ? `${CLIENT_PORTAL_BASE}/c/${token}` : '';
}
