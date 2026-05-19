// =========================================
// Core domain types — mirror Supabase schema
// =========================================

export type LeadStage =
  | 'hot'
  | 'cold'
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
  last_note: string | null;
  last_note_author_id: string | null;
  last_note_at: string | null;
  tags: string[];
  created_at: string;
  created_by: string | null;
  updated_at: string;
  is_sample: boolean;
}

export interface Note {
  id: string;
  lead_id: string;
  workspace_id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  lead_id: string;
  workspace_id: string;
  milestone: Milestone;
  amount: number;
  status: MilestoneStatus;
  due_date: string | null;
  paid_at: string | null;
  note: string | null;
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
  mr_coming_soon: { label: 'Mr. Coming Soon', bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B' },
  invoice_sent:   { label: 'Invoice Sent',    bg: '#EDE9FE', fg: '#5B21B6', dot: '#7C3AED' },
  won:            { label: 'Won',             bg: '#E6F7EE', fg: '#047857', dot: '#10B981' },
  junk:           { label: 'Junk',            bg: '#F4F4F6', fg: '#6B7280', dot: '#9CA3AF' },
};

// Tag order used for dropdowns + filters (logical sales-funnel order)
export const STAGE_ORDER: LeadStage[] = ['hot', 'cold', 'mr_coming_soon', 'invoice_sent', 'won', 'junk'];

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
