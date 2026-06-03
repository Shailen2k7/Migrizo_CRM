// =============================================================================
// MIGRIZO CASE JOURNEY — single source of truth
// Pure data + helpers, ZERO dependencies. Safe to import in the CRM today and
// in the client-facing dashboard later. The CRM writes `case.journey` (JSONB)
// and `case.current_phase`; the client site reads the same shape and renders
// the identical journey. Keep this file in sync across both apps.
// =============================================================================

export type PhaseKey = 'start' | 'map' | 'build' | 'write' | 'check' | 'submit';
export type PhaseKind = 'tasks' | 'pillars';
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
  index: number;      // 1..6
  code: string;       // "START"
  name: string;       // "Onboard & Lock"
  kind: PhaseKind;
  accent: string;     // hex accent for the phase
  tint: string;       // soft background tint
  tasks?: JourneyTask[];
  pillars?: JourneyPillar[];
  gate: string;       // the gate that must be ticked to advance
}

// -----------------------------------------------------------------------------
// THE JOURNEY — 6 phases · 23 core tasks · 4 pillars · 6 gates
// -----------------------------------------------------------------------------
export const JOURNEY: JourneyPhase[] = [
  {
    key: 'start', index: 1, code: 'START', name: 'Onboard & Lock', kind: 'tasks',
    accent: '#6366F1', tint: '#EEF0FF',
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
    key: 'map', index: 2, code: 'MAP', name: 'Audit & Strategy', kind: 'tasks',
    accent: '#F59E0B', tint: '#FEF6E7',
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
    key: 'build', index: 3, code: 'BUILD', name: 'Evidence Engine', kind: 'pillars',
    accent: '#EC4899', tint: '#FCE7F3',
    pillars: [
      { key: 'recognition',  letter: 'A', name: 'Recognition',  hint: 'articles, press, awards' },
      { key: 'influence',    letter: 'B', name: 'Influence',    hint: 'talks, mentoring, judging, events' },
      { key: 'innovation',   letter: 'C', name: 'Innovation',   hint: 'product / company / project / IP' },
      { key: 'track_record', letter: 'D', name: 'Track Record', hint: 'LinkedIn, portfolio, publications' },
    ],
    gate: 'All four pillars have evidence',
  },
  {
    key: 'write', index: 4, code: 'WRITE', name: 'Application Docs', kind: 'tasks',
    accent: '#3B82F6', tint: '#DBEAFE',
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
    key: 'check', index: 5, code: 'CHECK', name: 'QC & Approval', kind: 'tasks',
    accent: '#8B5CF6', tint: '#EDE9FE',
    tasks: [
      { key: 'check_internal', label: 'Internal review vs endorsing-body rules' },
      { key: 'check_format',   label: 'Format / count / file-size check' },
      { key: 'check_client',   label: 'Client final review & approval' },
    ],
    gate: 'Client approved the final pack',
  },
  {
    key: 'submit', index: 6, code: 'SUBMIT', name: 'Lodge & Decision', kind: 'tasks',
    accent: '#10B981', tint: '#D1FAE5',
    tasks: [
      { key: 'submit_application', label: 'Submit endorsement application' },
      { key: 'submit_log',         label: 'Log submission date + reference' },
      { key: 'submit_track',       label: 'Track decision' },
    ],
    gate: 'Decision received',
  },
];

export const DECISION_META: Record<Decision, { label: string; bg: string; fg: string }> = {
  pending:      { label: 'Awaiting decision', bg: '#FEF6E7', fg: '#854F0B' },
  approved:     { label: 'Endorsed ✓',         bg: '#D1FAE5', fg: '#047857' },
  rejected:     { label: 'Rejected',           bg: '#FEE2E2', fg: '#B91C1C' },
  resubmission: { label: 'Resubmission',       bg: '#DBEAFE', fg: '#1E40AF' },
};

// -----------------------------------------------------------------------------
// STATE SHAPE (stored in cases.journey JSONB)
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

// Normalize possibly-partial JSON coming back from the DB into a full state.
export function normalizeJourney(raw: unknown): CaseJourneyState {
  const j = (raw && typeof raw === 'object') ? raw as Partial<CaseJourneyState> : {};
  return { tasks: j.tasks || {}, pillars: j.pillars || {}, gates: j.gates || {} };
}

// -----------------------------------------------------------------------------
// COUNTS
// -----------------------------------------------------------------------------
export const TOTAL_TASKS = JOURNEY.reduce((s, p) => s + (p.tasks?.length || 0), 0);   // 23
export const TOTAL_PILLARS = JOURNEY.reduce((s, p) => s + (p.pillars?.length || 0), 0); // 4
export const TOTAL_ITEMS = TOTAL_TASKS + TOTAL_PILLARS;                                // 27
export const TOTAL_PHASES = JOURNEY.length;                                            // 6

export function getPhase(key: PhaseKey): JourneyPhase {
  return JOURNEY.find((p) => p.key === key) || JOURNEY[0];
}

// -----------------------------------------------------------------------------
// PER-PHASE PROGRESS
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
// Phase 1 is always unlocked.
export function isPhaseUnlocked(state: CaseJourneyState, phase: JourneyPhase): boolean {
  if (phase.index === 1) return true;
  const prev = JOURNEY[phase.index - 2];
  return isGatePassed(state, prev.key);
}

// The active phase = first phase whose gate hasn't been passed yet.
// If all gates passed, returns the last phase (case is at the finish line).
export function activePhase(state: CaseJourneyState): JourneyPhase {
  for (const p of JOURNEY) {
    if (!isGatePassed(state, p.key)) return p;
  }
  return JOURNEY[JOURNEY.length - 1];
}

export function allGatesPassed(state: CaseJourneyState): boolean {
  return JOURNEY.every((p) => isGatePassed(state, p.key));
}

// -----------------------------------------------------------------------------
// OVERALL PROGRESS
// -----------------------------------------------------------------------------
export function overallProgress(state: CaseJourneyState): { done: number; total: number; pct: number } {
  let done = 0;
  for (const p of JOURNEY) done += phaseProgress(state, p).done;
  const pct = TOTAL_ITEMS === 0 ? 0 : Math.round((done / TOTAL_ITEMS) * 100);
  return { done, total: TOTAL_ITEMS, pct };
}

// Number of gates passed (0..6) — handy for a "phase X of 6" label.
export function phasesCleared(state: CaseJourneyState): number {
  return JOURNEY.filter((p) => isGatePassed(state, p.key)).length;
}
