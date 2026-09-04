// =========================================
// Core domain types — mirror Supabase schema
// =========================================

export type LeadStage =
  | 'hot'
  | 'cold'
  | 'not_responding'
  | 'mr_coming_soon'
  | 'invoice_sent'
  | 'won'
  | 'junk';

export type PaymentStatus = 'none' | 'partial' | 'paid' | 'overdue';

export type Milestone = 'kickstart' | 'profile_building' | 'endorsement' | 'post_approval';

export type MilestoneStatus = 'pending' | 'paid' | 'overdue';

export type WorkspaceRole = 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  allow_member_task_edit?: boolean;
  allow_member_email?: boolean;
  case_manager_name?: string | null;
  case_manager_phone?: string | null;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
}

export interface Lead {
  id: string;
  workspace_id: string;
  full_name: string;
  // Daily Lead Engine — ownership, staleness and AI scoring.
  owner_id?: string | null;
  last_touched_at?: string | null;
  attempt_count?: number | null;
  snooze_until?: string | null;
  retired_at?: string | null;
  ai_score?: number | null;
  ai_brief?: string | null;
  ai_scored_at?: string | null;
  phone: string | null;
  email: string | null;
  visa_type: string | null;
  stage: LeadStage;
  source: string | null;
  score: number;
  next_follow_up: string | null;
  payment_status: PaymentStatus;
  amount_paid: number;
  amount_total: number;
  amount_overdue: number;
  last_note: string | null;
  last_note_author_id: string | null;
  last_note_at: string | null;
  won_at: string | null;
  tags: string[];
  industry: string | null;
  // Ad-form intake (migration 050). investment_readiness is DERIVED and is what
  // automation reads; intake holds the raw answers verbatim so a mapping change
  // can always be re-run against the originals. NULL readiness means the
  // question was never asked, which is not the same as 'no'.
  investment_readiness?: 'yes' | 'maybe' | 'no' | null;
  intake?: Record<string, unknown> | null;
  // Special pricing used to win a high-quality case (migration 066). This sits
  // ALONGSIDE the stage, never replacing it — a lead can be Hot AND on a free
  // offer, and overwriting stage would drop them out of their outreach.
  offer_type?: OfferType | null;
  offer_amount?: number | null;
  offer_currency?: 'GBP' | 'INR' | 'USD' | null;
  offer_note?: string | null;
  offer_at?: string | null;
  offer_by?: string | null;
  is_spotlight: boolean;
  // Lead intelligence (migration 074) — the three facts the dashboards read.
  // first_response_at is stamped by DB triggers on the first inbound reply and
  // is never hand-edited. eligibility NULL means "not reviewed", which is a
  // real state and deliberately distinct from not_eligible.
  first_response_at?: string | null;
  profile_received?: 'cv' | 'linkedin' | 'both' | null;
  profile_received_at?: string | null;
  eligibility?: 'eligible' | 'not_eligible' | null;
  eligibility_at?: string | null;
  eligibility_by?: string | null;
  eligibility_source?: 'manual' | 'derived' | 'ai' | 'whatsapp' | null;
  // CV on record: the extracted profile text behind the
  // drawer's "View profile" button.
  /** When this person most recently filled the ad form (083). */
  last_form_submitted_at?: string | null;
  form_submission_count?: number | null;
  profile_text?: string | null;
  profile_ai?: Record<string, unknown> | null;
  // CV on record (079): permanent archived copy of the CV they sent,
  // served by /api/lead/cv/[leadId] via the drawer's "Download CV" button.
  cv_path?: string | null;
  cv_name?: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  is_sample: boolean;
  hidden_from_payments: boolean;
  currency: Currency;
  discount?: number;
}

export interface Note {
  id: string;
  lead_id: string;
  workspace_id: string;
  body: string;
  author_id: string | null;
  created_at: string;
  /**
   * Set when this note is the mirror of a meeting's notes (migration 072).
   * NULL for a note typed directly on the lead.
   */
  meeting_id?: string | null;
  /** Embedded meeting row, when getNotes could join it — used for the chip. */
  meeting?: { starts_at: string; client_name: string | null } | null;
}

export type Currency = 'INR' | 'GBP' | 'USD';

export interface Payment {
  id: string;
  lead_id: string;
  workspace_id: string;
  milestone: Milestone;
  amount: number;
  currency: Currency;
  status: MilestoneStatus;
  due_date: string | null;
  paid_at: string | null;
  note: string | null;
  /**
   * GST on this invoice (migration 075). 0 = no GST, which is every existing
   * payment. Split CGST/SGST half each on the document.
   * gst_mode 'add' = billed on top of amount; 'inclusive' = extracted from it.
   */
  gst_rate?: number;
  gst_mode?: 'add' | 'inclusive';
  created_at: string;
  created_by: string | null;
}

export interface Activity {
  id: string;
  workspace_id: string;
  user_id: string | null;
  lead_id: string | null;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
}

// =========================================
// UI display helpers
// =========================================

export const STAGE_META: Record<LeadStage, { label: string; bg: string; fg: string; dot: string }> = {
  hot:            { label: 'Hot',             bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444' },
  cold:           { label: 'Cold',            bg: '#DBEAFE', fg: '#1E40AF', dot: '#3B82F6' },
  // Set by hand when someone has clearly gone quiet. The Leads filter shows
  // these AND the ones that go stale on their own, so marking one is a
  // shortcut, never a requirement.
  not_responding: { label: 'Not Responding',  bg: '#FFF3EA', fg: '#9A3412', dot: '#EA580C' },
  mr_coming_soon: { label: 'Mr. Coming Soon', bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B' },
  invoice_sent:   { label: 'Invoice Sent',    bg: '#EDE9FE', fg: '#5B21B6', dot: '#7C3AED' },
  won:            { label: 'Won',             bg: '#E6F7EE', fg: '#047857', dot: '#10B981' },
  junk:           { label: 'Junk',            bg: '#F4F4F6', fg: '#6B7280', dot: '#9CA3AF' },
};

// Tag order used for dropdowns + filters (logical sales-funnel order)
export const STAGE_ORDER: LeadStage[] = ['hot', 'cold', 'not_responding', 'mr_coming_soon', 'invoice_sent', 'won', 'junk'];

export const PAYMENT_META: Record<PaymentStatus, { label: string; bg: string; fg: string }> = {
  none:    { label: 'Not paid', bg: '#F4F4F6', fg: '#7A7A82' },
  partial: { label: 'Partial',  bg: '#FEF3C7', fg: '#B45309' },
  paid:    { label: 'Paid',     bg: '#E6F7EE', fg: '#047857' },
  overdue: { label: 'Overdue',  bg: '#FEE2E2', fg: '#B91C1C' },
};

export const MILESTONE_META: Record<Milestone, { label: string; pct: number; order: number }> = {
  kickstart:        { label: 'Kickstart',        pct: 25, order: 1 },
  profile_building: { label: 'Profile Building', pct: 35, order: 2 },
  endorsement:      { label: 'Endorsement',      pct: 25, order: 3 },
  post_approval:    { label: 'Post Approval',    pct: 15, order: 4 },
};

// Safe accessor — returns a Junk-styled fallback for unknown stages so the app never crashes on stale data
export function getStageMeta(stage: string | null | undefined): { label: string; bg: string; fg: string; dot: string } {
  if (stage && stage in STAGE_META) return STAGE_META[stage as LeadStage];
  return { label: stage ? stage.toString() : 'Unknown', bg: '#F4F4F6', fg: '#6B7280', dot: '#9CA3AF' };
}

// ---- Visa type tags (GTV / IFV) shown across the whole system ----
export type VisaType = 'gtv' | 'ifv';
export const VISA_META: Record<VisaType, { short: string; full: string; bg: string; fg: string; dot: string }> = {
  gtv: { short: 'GTV', full: 'Global Talent Visa',     bg: '#EEF2FF', fg: '#4338CA', dot: '#6366F1' },
  ifv: { short: 'IFV', full: 'Innovator Founder Visa', bg: '#ECFEFF', fg: '#0E7490', dot: '#06B6D4' },
};
// Resolve a stored value (clean 'gtv'/'ifv' OR legacy free-text) into a tag, or null.
export function getVisaMeta(v: string | null | undefined): (typeof VISA_META)[VisaType] | null {
  if (!v) return null;
  const k = v.toLowerCase().trim();
  if (k === 'gtv' || k === 'ifv') return VISA_META[k as VisaType];
  if (k.includes('global') || k.includes('talent') || k.includes('gtv')) return VISA_META.gtv;
  if (k.includes('innovator') || k.includes('founder') || k.includes('ifv')) return VISA_META.ifv;
  return null;
}

// =========================================
// CASES MODULE TYPES
// =========================================
export type CaseStage =
  | 'roadmap_building'
  | 'profile_building'
  | 'final_mapping'
  | 'endorsement_submission'
  | 'visa_application'
  | 'post_arrival';

export type CaseStatus = 'active' | 'on_hold' | 'completed' | 'rejected';
export type ChecklistStatus = 'pending' | 'in_progress' | 'completed' | 'not_applicable';
export type EndorsementStatus = 'pending' | 'approved' | 'rejected' | 'not_applicable';

export interface Case {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  delivery_stage?: string | null;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  visa_type: string;
  current_stage: CaseStage;
  status: CaseStatus;
  endorsement_status: EndorsementStatus;
  visa_status: EndorsementStatus;
  started_at: string;
  endorsement_submitted_at: string | null;
  endorsement_approved_at: string | null;
  visa_submitted_at: string | null;
  visa_approved_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // ---- New 6-phase journey model (drives both CRM + client dashboard) ----
  current_phase: import('./journey').PhaseKey;
  journey: import('./journey').CaseJourneyState;
  owner_id: string | null;
  owner_name: string | null;
  endorsing_body: string | null;
  submission_ref: string | null;
  submitted_at: string | null;
  decision: import('./journey').Decision;
  decided_at: string | null;
  archived_at: string | null;
  client_token: string | null;
}

export interface CaseChecklistItem {
  id: string;
  case_id: string;
  stage: CaseStage;
  category: string | null;
  title: string;
  description: string | null;
  status: ChecklistStatus;
  notes: string | null;
  display_order: number;
  is_required: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseActivity {
  id: string;
  case_id: string;
  workspace_id: string;
  user_id: string | null;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export const CASE_STAGE_META: Record<CaseStage, { label: string; short: string; bg: string; fg: string; dot: string; order: number }> = {
  roadmap_building:       { label: 'Roadmap Building',         short: 'Roadmap',     bg: '#EEF0FF', fg: '#4338CA', dot: '#6366F1', order: 1 },
  profile_building:       { label: 'Profile Building',         short: 'Profile',     bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B', order: 2 },
  final_mapping:          { label: 'Final Mapping & Testing',  short: 'Mapping',     bg: '#FCE7F3', fg: '#9D174D', dot: '#EC4899', order: 3 },
  endorsement_submission: { label: 'Endorsement Submission',   short: 'Endorsement', bg: '#DBEAFE', fg: '#1E40AF', dot: '#3B82F6', order: 4 },
  visa_application:       { label: 'Visa Application',         short: 'Visa',        bg: '#EDE9FE', fg: '#5B21B6', dot: '#7C3AED', order: 5 },
  post_arrival:           { label: 'Post-Arrival Services',    short: 'Post-Arrival',bg: '#D1FAE5', fg: '#047857', dot: '#10B981', order: 6 },
};

export const CASE_STAGE_ORDER: CaseStage[] = [
  'roadmap_building', 'profile_building', 'final_mapping', 'endorsement_submission', 'visa_application', 'post_arrival',
];

export const CASE_STATUS_META: Record<CaseStatus, { label: string; bg: string; fg: string }> = {
  active:    { label: 'Active',    bg: '#E6F7EE', fg: '#047857' },
  on_hold:   { label: 'On Hold',   bg: '#FEF3C7', fg: '#B45309' },
  completed: { label: 'Completed', bg: '#DBEAFE', fg: '#1E40AF' },
  rejected:  { label: 'Rejected',  bg: '#FEE2E2', fg: '#B91C1C' },
};

export const CATEGORY_LABELS: Record<string, string> = {
  consultation: 'Consultation',
  agreement: 'Agreement & Payment',
  documents: 'Documents',
  achievements: 'Achievements',
  recognition: 'Recognition',
  online: 'Online Presence',
  references: 'Letters of Recommendation',
  mentorship: 'Mentorship',
  publications: 'Publications & Speaking',
  payment: 'Payment',
  application: 'Application',
  evidence: 'Evidence',
  qa: 'Quality Check',
  submission: 'Submission',
  tracking: 'Tracking',
  arrival: 'Arrival',
  setup: 'UK Setup',
  followup: 'Follow-up',
};

// =========================================
// FOLLOW-UPS MODULE TYPES
// =========================================
export type FollowUpChannel = 'call' | 'email' | 'whatsapp' | 'meeting' | 'other';
export type FollowUpStatus = 'pending' | 'completed' | 'missed' | 'cancelled';

export interface FollowUp {
  id: string;
  workspace_id: string;
  lead_id: string;
  title: string;
  scheduled_at: string;
  channel: FollowUpChannel;
  status: FollowUpStatus;
  notes: string | null;
  outcome: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const FOLLOWUP_CHANNEL_META: Record<FollowUpChannel, { label: string; iconKey: 'phone'|'mail'|'whatsapp'|'meeting'|'other'; bg: string; fg: string }> = {
  call:     { label: 'Call',     iconKey: 'phone',    bg: '#EEF0FF', fg: '#4338CA' },
  email:    { label: 'Email',    iconKey: 'mail',     bg: '#DBEAFE', fg: '#1E40AF' },
  whatsapp: { label: 'WhatsApp', iconKey: 'whatsapp', bg: '#D1FAE5', fg: '#047857' },
  meeting:  { label: 'Meeting',  iconKey: 'meeting',  bg: '#EDE9FE', fg: '#5B21B6' },
  other:    { label: 'Other',    iconKey: 'other',    bg: '#F4F4F6', fg: '#6B7280' },
};

export const FOLLOWUP_STATUS_META: Record<FollowUpStatus, { label: string; bg: string; fg: string }> = {
  pending:   { label: 'Pending',   bg: '#FEF3C7', fg: '#B45309' },
  completed: { label: 'Completed', bg: '#D1FAE5', fg: '#047857' },
  missed:    { label: 'Missed',    bg: '#FEE2E2', fg: '#B91C1C' },
  cancelled: { label: 'Cancelled', bg: '#F4F4F6', fg: '#6B7280' },
};

// Display helpers — derived "urgency" status (independent of DB status field)
export function isFollowUpOverdue(f: FollowUp): boolean {
  return f.status === 'pending' && new Date(f.scheduled_at).getTime() < Date.now();
}

export function isFollowUpToday(f: FollowUp): boolean {
  if (f.status !== 'pending') return false;
  const d = new Date(f.scheduled_at);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function isFollowUpThisWeek(f: FollowUp): boolean {
  if (f.status !== 'pending') return false;
  const d = new Date(f.scheduled_at).getTime();
  const now = Date.now();
  const weekFromNow = now + 7 * 24 * 60 * 60 * 1000;
  return d >= now && d <= weekFromNow;
}

export function formatFollowUpTime(scheduledAt: string): string {
  const date = new Date(scheduledAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const dayAfter = new Date(tomorrow.getTime() + 86400000);
  const weekFromToday = new Date(today.getTime() + 7 * 86400000);
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (date >= today && date < tomorrow) return `Today, ${time}`;
  if (date >= tomorrow && date < dayAfter) return `Tomorrow, ${time}`;
  if (date >= today && date < weekFromToday) return `${date.toLocaleDateString('en-IN', { weekday: 'short' })}, ${time}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })}, ${time}`;
}

// =========================================
// SPECIAL OFFER (£500 / FREE)
// =========================================
// Deliberately NOT a stage. See migration 066 for the reasoning: a lead on an
// offer is still Hot or Cold, and outreach enrols by stage.
export type OfferType = 'discount' | 'free';

export const OFFER_META: Record<OfferType, { label: string; bg: string; fg: string; dot: string }> = {
  discount: { label: 'Discounted quote', bg: '#F1ECFE', fg: '#5B21B6', dot: '#7C3AED' },
  free:     { label: 'Free case',        bg: '#EDE9FE', fg: '#4C1D95', dot: '#6D28D9' },
};

const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', INR: '₹', USD: '$' };

/** True when this lead has been given special pricing. */
export function hasOffer(lead: Pick<Lead, 'offer_type'>): boolean {
  return lead.offer_type === 'discount' || lead.offer_type === 'free';
}

/**
 * The short badge shown on the row — "£500" or "FREE".
 *
 * A discount with no amount recorded falls back to the word "OFFER" rather than
 * rendering a bare currency symbol, so a half-filled record still reads sensibly.
 */
export function offerBadge(lead: Pick<Lead, 'offer_type' | 'offer_amount' | 'offer_currency'>): string {
  if (lead.offer_type === 'free') return 'FREE';
  if (lead.offer_type !== 'discount') return '';
  const amount = lead.offer_amount;
  if (amount === null || amount === undefined) return 'OFFER';
  const symbol = CURRENCY_SYMBOL[lead.offer_currency || 'GBP'] || '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'OFFER';
  // Whole numbers read better without ".00" on a compact table row.
  const text = Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${text}`;
}

/** Full description for the drawer and exports — "Free case", "Discounted quote · £500". */
export function offerLabel(lead: Pick<Lead, 'offer_type' | 'offer_amount' | 'offer_currency'>): string {
  if (!hasOffer(lead)) return '';
  const meta = OFFER_META[lead.offer_type as OfferType];
  if (lead.offer_type === 'free') return meta.label;
  const badge = offerBadge(lead);
  return badge && badge !== 'OFFER' ? `${meta.label} · ${badge}` : meta.label;
}

// =========================================
// INDUSTRY TAGS
// =========================================
export type Industry = 'tech' | 'research' | 'art' | 'engineering' | 'education' | 'business' | 'healthcare' | 'finance' | 'other';

export const INDUSTRY_LIST: Industry[] = ['tech', 'research', 'art', 'engineering', 'education', 'business', 'healthcare', 'finance', 'other'];

export const INDUSTRY_META: Record<Industry, { label: string; bg: string; fg: string; ring: string }> = {
  tech:        { label: 'Tech',        bg: '#EEF0FF', fg: '#3C3489', ring: '#6366F1' },
  research:    { label: 'Research',    bg: '#E6F1FB', fg: '#0C447C', ring: '#3B82F6' },
  art:         { label: 'Art',         bg: '#FCEBF1', fg: '#9F1239', ring: '#EC4899' },
  engineering: { label: 'Engineering', bg: '#FAEEDA', fg: '#854F0B', ring: '#F59E0B' },
  education:   { label: 'Education',   bg: '#E1F5EE', fg: '#0F6E56', ring: '#10B981' },
  business:    { label: 'Business',    bg: '#F4F4F6', fg: '#475569', ring: '#64748B' },
  healthcare:  { label: 'Healthcare',  bg: '#FCEBEB', fg: '#A32D2D', ring: '#EF4444' },
  finance:     { label: 'Finance',     bg: '#DCFCE7', fg: '#166534', ring: '#16A34A' },
  other:       { label: 'Other',       bg: '#F4F4F6', fg: '#6B7280', ring: '#9CA3AF' },
};

export function getIndustryMeta(industry: string | null | undefined) {
  if (!industry) return null;
  return INDUSTRY_META[industry as Industry] || null;
}

/**
 * The industry as a human would write it — "Tech", "Research" — for exports and
 * anywhere else that needs plain text rather than a coloured chip.
 *
 * Two things it deliberately does that a bare lookup does not:
 *
 *  1. Recovers Meta's option slugs. Facebook sends values like "tech_" and
 *     "art_", which match no key and would otherwise export as blank even
 *     though the lead is clearly tagged. Punctuation is normalised first.
 *  2. Never silently drops a value. An industry we have no entry for is
 *     returned tidied up ("quantum_computing" -> "Quantum computing") instead
 *     of vanishing, because an export that quietly loses data is worse than one
 *     showing something unexpected.
 *
 * Returns '' only when there genuinely is no industry, which keeps the CSV cell
 * empty and lets Excel's filters treat it as "(Blanks)".
 */
export function industryLabel(industry: string | null | undefined): string {
  if (!industry) return '';
  const raw = String(industry).trim();
  if (!raw) return '';

  const direct = INDUSTRY_META[raw as Industry];
  if (direct) return direct.label;

  const cleaned = raw.toLowerCase().replace(/[_\-+]+/g, ' ').trim();
  if (!cleaned) return '';

  const normalised = INDUSTRY_META[cleaned as Industry];
  if (normalised) return normalised.label;

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
