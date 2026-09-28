// =============================================================================
// CASE STAGES — the ten-step delivery pipeline, defined once.
// -----------------------------------------------------------------------------
// The case module runs on ten stages, in the owner's own order (27 Sep 2026
// design): Case Created → Profile Building → Documents Collection → Profile
// Review → Application Prep → Internal QC → Client Approval → Submission →
// Awaiting Decision → Completed.
//
// NO GATES. A case can be moved to any stage with one click; nothing blocks.
//
// TWO MODELS, ONE TRUTH. The old six-phase journey (lib/journey.ts) still
// drives the client update email and the 558 existing checklist items, so it
// is not deleted — instead every stage knows which phase it belongs to, and
// moving a stage silently keeps current_phase in sync. The stage lives in
// cases.delivery_stage (a column that already existed, defaulted to
// 'onboarding' and never used, which is also why stageOf() must be able to
// read legacy values).
//
// Colours are the same Nordic family as Master Leads, so the CRM stays one
// product. Everything here is a pure function — nothing writes or sends.
// =============================================================================

import type { Case } from './types';
import type { PhaseKey } from './journey';

export type CaseStageKey =
  | 'case_created'
  | 'profile_building'
  | 'docs_collection'
  | 'profile_review'
  | 'application_prep'
  | 'internal_qc'
  | 'client_approval'
  | 'submission'
  | 'awaiting_decision'
  | 'completed';

export interface StageMeta {
  key: CaseStageKey;
  label: string;
  short: string;
  /** Which old journey phase this stage keeps in sync (client emails read it). */
  phase: PhaseKey;
  /** Days a case is expected to spend here before it reads At risk / Overdue. */
  targetDays: number;
  bg: string; border: string; accent: string; ink: string;
}

export const CASE_STAGES: StageMeta[] = [
  { key: 'case_created',      label: 'Case Created',         short: 'Created',   phase: 'onboarding',    targetDays: 3,
    bg: '#EFEEEA', border: '#DDDBD4', accent: '#87857C', ink: '#383731' },
  { key: 'profile_building',  label: 'Profile Building',     short: 'Profile',   phase: 'profile',       targetDays: 45,
    bg: '#F6E8EB', border: '#EACDD4', accent: '#B35F76', ink: '#521F2E' },
  { key: 'docs_collection',   label: 'Documents Collection', short: 'Documents', phase: 'profile',       targetDays: 10,
    bg: '#F5EEE2', border: '#E7DAC1', accent: '#B08238', ink: '#4A3615' },
  { key: 'profile_review',    label: 'Profile Review',       short: 'Review',    phase: 'write_approve', targetDays: 7,
    bg: '#EDEAF5', border: '#D9D3EB', accent: '#7465AE', ink: '#2F2756' },
  { key: 'application_prep',  label: 'Application Prep',     short: 'App Prep',  phase: 'write_approve', targetDays: 14,
    bg: '#F1E4DE', border: '#E2CCC1', accent: '#A9705A', ink: '#4A2A1D' },
  { key: 'internal_qc',       label: 'Internal QC',          short: 'QC',        phase: 'write_approve', targetDays: 5,
    bg: '#E7EBF1', border: '#D2D9E4', accent: '#6B7A99', ink: '#242E42' },
  { key: 'client_approval',   label: 'Client Approval',      short: 'Approval',  phase: 'write_approve', targetDays: 7,
    bg: '#E3EFEC', border: '#C7DED8', accent: '#4A8A80', ink: '#1C413B' },
  { key: 'submission',        label: 'Submission',           short: 'Submitted', phase: 'endorsement',   targetDays: 5,
    bg: '#E4EDF4', border: '#C8D9E7', accent: '#4A7BA0', ink: '#1C3A52' },
  { key: 'awaiting_decision', label: 'Awaiting Decision',    short: 'Decision',  phase: 'endorsement',   targetDays: 56,
    bg: '#EDEAF5', border: '#D9D3EB', accent: '#8B7BC7', ink: '#2F2756' },
  { key: 'completed',         label: 'Completed',            short: 'Done',      phase: 'visa',          targetDays: 0,
    bg: '#E8EEDD', border: '#D1DDBC', accent: '#6A8C3A', ink: '#2E4115' },
];

export const STAGE_BY_KEY: Record<CaseStageKey, StageMeta> =
  Object.fromEntries(CASE_STAGES.map((s) => [s.key, s])) as Record<CaseStageKey, StageMeta>;

const KEYS = CASE_STAGES.map((s) => s.key);
export const stageIndex = (k: CaseStageKey) => KEYS.indexOf(k);

/**
 * The case's stage, whatever era its row was written in.
 *
 * delivery_stage existed for months with a default of 'onboarding' and was
 * never shown anywhere, so all 28 live cases carry legacy values. Rather than
 * migrating data, the old phase decides where they land — and the two cases
 * already past endorsement submission land in Awaiting Decision, not
 * Submission, because endorsement_submitted_at says they already sent it.
 */
export function stageOf(c: Pick<Case, 'delivery_stage' | 'current_phase' | 'endorsement_submitted_at' | 'status'>): CaseStageKey {
  const raw = c.delivery_stage as CaseStageKey | string | null | undefined;
  if (raw && (KEYS as string[]).includes(raw)) return raw as CaseStageKey;
  if (c.status === 'completed') return 'completed';
  switch (c.current_phase) {
    case 'profile':       return 'profile_building';
    case 'write_approve': return 'profile_review';
    case 'endorsement':   return c.endorsement_submitted_at ? 'awaiting_decision' : 'submission';
    case 'visa':          return 'awaiting_decision';
    default:              return 'case_created';
  }
}

/** Stage → the coarse progress number every surface shows for this case. */
export function progressOf(stage: CaseStageKey): number {
  return Math.round((stageIndex(stage) / (KEYS.length - 1)) * 100);
}

// ── Health ───────────────────────────────────────────────────────────────────

export type CaseHealth = 'on_track' | 'at_risk' | 'overdue' | 'done';

export const HEALTH_META: Record<CaseHealth, { label: string; bg: string; fg: string; dot: string }> = {
  on_track: { label: 'On Track', bg: '#E3EFEC', fg: '#1C413B', dot: '#4A8A80' },
  at_risk:  { label: 'At Risk',  bg: '#F5EEE2', fg: '#4A3615', dot: '#B08238' },
  overdue:  { label: 'Overdue',  bg: '#F6E6DC', fg: '#55230F', dot: '#B65A36' },
  done:     { label: 'Done',     bg: '#E8EEDD', fg: '#2E4115', dot: '#6A8C3A' },
};

const DAY = 86_400_000;

/**
 * When the case entered its current stage. The column from migration 124
 * wins; until that runs the case form keeps the same timestamp inside
 * journey.details; legacy rows fall back to their last update.
 */
export function stageEnteredAt(c: Pick<Case, 'stage_entered_at' | 'updated_at' | 'started_at' | 'journey'>): string {
  return (c.stage_entered_at as string | null | undefined)
    || (c.journey as { details?: { stage_entered_at?: string | null } } | null)?.details?.stage_entered_at
    || c.updated_at || c.started_at;
}

export function daysInStage(c: Pick<Case, 'stage_entered_at' | 'updated_at' | 'started_at' | 'journey'>): number {
  return Math.max(0, Math.floor((Date.now() - new Date(stageEnteredAt(c)).getTime()) / DAY));
}

/**
 * On track / At risk / Overdue, judged purely from how long the case has sat
 * in its stage against that stage's target. At 70% of the target it reads
 * At risk — the point where a nudge still changes the outcome — and past the
 * target it is Overdue. Awaiting Decision is judged too (56 days), because a
 * decision that is slower than the endorsing body's own service standard is
 * exactly the thing to chase.
 */
export function healthOf(c: Case): CaseHealth {
  const stage = stageOf(c);
  if (stage === 'completed') return 'done';
  const target = STAGE_BY_KEY[stage].targetDays;
  const days = daysInStage(c);
  if (days > target) return 'overdue';
  if (days > target * 0.7) return 'at_risk';
  return 'on_track';
}

// ── Small shared helpers ─────────────────────────────────────────────────────

export type WaitingOn = 'client' | 'team' | 'authority';

export const WAITING_META: Record<WaitingOn, { label: string; dot: string }> = {
  client:    { label: 'Client',    dot: '#B08238' },
  team:      { label: 'Team',      dot: '#4A7BA0' },
  authority: { label: 'Authority', dot: '#7465AE' },
};

export function waitingOf(c: Case): WaitingOn {
  const w = (c.waiting_on as WaitingOn | null | undefined);
  return w && w in WAITING_META ? w : 'team';
}

/**
 * The display case number. Real rows get cases.case_no from migration 124;
 * until it is run, the number is the case's rank by creation date — stable
 * enough to read out loud, and replaced by the permanent one the moment the
 * migration lands.
 */
export function caseNoLabel(c: Case, all: Case[]): string {
  const real = (c as Case & { case_no?: number | null }).case_no;
  if (real) return `MIG-${real}`;
  const rank = [...all].sort((a, b) => a.created_at.localeCompare(b.created_at)).findIndex((x) => x.id === c.id);
  return `MIG-${1001 + Math.max(0, rank)}`;
}

/** Target filing date: the column (124), else the case form's date, else 120 days from start. */
export function targetDateOf(c: Case): Date {
  const t = (c.target_submission_at as string | null | undefined)
    || (c.journey as { details?: { target_date?: string | null } } | null)?.details?.target_date;
  return t ? new Date(t) : new Date(new Date(c.started_at).getTime() + 120 * DAY);
}

export function daysLeftOf(c: Case): number {
  return Math.ceil((targetDateOf(c).getTime() - Date.now()) / DAY);
}

/** Fresh conversions flash for 24 hours — home banner, board badge, push. */
export function isNewCase(c: Pick<Case, 'created_at'>): boolean {
  return Date.now() - new Date(c.created_at).getTime() < 24 * 3600_000;
}

// ── Default owner ────────────────────────────────────────────────────────────

/**
 * Every new case is Mansi Behl's unless someone reassigns it — manual cases,
 * and the automatic case opened when a lead is marked Converted (migration
 * 124 uses the same id). If she ever leaves the workspace, cases fall back to
 * whoever opened them.
 */
export const DEFAULT_CASE_OWNER = { id: 'bc7c5aa7-025b-44fe-b794-a106fe416a4b', name: 'Mansi Behl' } as const;

// ── Decisions: endorsement and visa outcome ──────────────────────────────────

/**
 * Where a case stands with the decision-makers, read from the columns the
 * case page writes (endorsement_status, visa_status, endorsement_submitted_at).
 * The latest decision wins: a granted visa outranks the endorsement before it.
 */
export type Outcome = 'awaiting' | 'endorsed' | 'endorsement_refused' | 'visa_granted' | 'visa_refused';

export const OUTCOME_META: Record<Outcome, { label: string; bg: string; fg: string; dot: string }> = {
  awaiting:            { label: 'Awaiting endorsement', bg: '#EDEAF6', fg: '#4A3E86', dot: '#7465AE' },
  endorsed:            { label: 'Endorsement approved', bg: '#DDF3E8', fg: '#0E7A50', dot: '#16A36B' },
  endorsement_refused: { label: 'Endorsement refused',  bg: '#FBE7E2', fg: '#9A3B2A', dot: '#D2583F' },
  visa_granted:        { label: 'Visa granted',         bg: '#D4EFE1', fg: '#0B5E3E', dot: '#0E7A50' },
  visa_refused:        { label: 'Visa refused',         bg: '#FBE7E2', fg: '#9A3B2A', dot: '#B8452E' },
};
export const OUTCOME_ORDER: Outcome[] = ['awaiting', 'endorsed', 'endorsement_refused', 'visa_granted', 'visa_refused'];

export function outcomeOf(c: Case): Outcome | null {
  if (c.visa_status === 'approved') return 'visa_granted';
  if (c.visa_status === 'rejected') return 'visa_refused';
  if (c.endorsement_status === 'approved') return 'endorsed';
  if (c.endorsement_status === 'rejected') return 'endorsement_refused';
  if (c.endorsement_submitted_at || stageOf(c) === 'awaiting_decision') return 'awaiting';
  return null;
}

// ── The Cases home pipeline: seven steps ─────────────────────────────────────

/**
 * The Cases page shows the book of work in seven steps (owner's list, 28 Sep
 * 2026). Each groups one or more of the ten detailed stages above, which the
 * case page itself still uses unchanged — so nothing is migrated and a case's
 * detailed stage is never lost.
 */
export type PipelineKey = 'onboarded' | 'documents' | 'preparation' | 'quality' | 'client_review' | 'submitted' | 'decision';

export interface PipelineStep { key: PipelineKey; label: string; stages: CaseStageKey[]; bg: string; ink: string; accent: string }

export const PIPELINE: PipelineStep[] = [
  { key: 'onboarded',     label: 'New Case Onboarded',      stages: ['case_created'],
    bg: '#EEF1F4', ink: '#3D4757', accent: '#8A94A3' },
  { key: 'documents',     label: 'Documents Collection',    stages: ['docs_collection'],
    bg: '#F5EEE2', ink: '#4A3615', accent: '#B08238' },
  { key: 'preparation',   label: 'Application Preparation', stages: ['profile_building', 'profile_review', 'application_prep'],
    bg: '#F6E8EB', ink: '#521F2E', accent: '#B35F76' },
  { key: 'quality',       label: 'Quality Check',           stages: ['internal_qc'],
    bg: '#E7EBF1', ink: '#242E42', accent: '#6B7A99' },
  { key: 'client_review', label: 'Client Review',           stages: ['client_approval'],
    bg: '#EDEAF5', ink: '#2F2756', accent: '#7465AE' },
  { key: 'submitted',     label: 'Submitted',               stages: ['submission'],
    bg: '#E4EDF4', ink: '#1C3A52', accent: '#4A7BA0' },
  { key: 'decision',      label: 'Decision',                stages: ['awaiting_decision', 'completed'],
    bg: '#DDF3E8', ink: '#0E7A50', accent: '#16A36B' },
];

export const PIPELINE_BY_KEY: Record<PipelineKey, PipelineStep> =
  Object.fromEntries(PIPELINE.map((p) => [p.key, p])) as Record<PipelineKey, PipelineStep>;

export function pipelineOf(stage: CaseStageKey): PipelineKey {
  return (PIPELINE.find((p) => p.stages.includes(stage)) ?? PIPELINE[0]).key;
}
