// =========================================
// Core domain types — mirror Supabase schema
// =========================================

export type LeadStage =
  | 'new'
  | 'attempted'
  | 'connected'
  | 'qualified'
  | 'consultation'
  | 'proposal'
  | 'partial'
  | 'won'
  | 'lost';

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
  new:          { label: 'New inquiry',   bg: '#F4F4F6', fg: '#3A3A40', dot: '#9CA3AF' },
  attempted:    { label: 'Attempted',     bg: '#FEF3C7', fg: '#92400E', dot: '#F59E0B' },
  connected:    { label: 'Connected',     bg: '#DBEAFE', fg: '#1E40AF', dot: '#3B82F6' },
  qualified:    { label: 'Qualified',     bg: '#EDE9FE', fg: '#5B21B6', dot: '#7C3AED' },
  consultation: { label: 'Consultation',  bg: '#EEF0FF', fg: '#4338CA', dot: '#6366F1' },
  proposal:     { label: 'Proposal sent', bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B' },
  partial:      { label: 'Partial pay',   bg: '#CFFAFE', fg: '#155E75', dot: '#06B6D4' },
  won:          { label: 'Closed won',    bg: '#E6F7EE', fg: '#047857', dot: '#10B981' },
  lost:         { label: 'Closed lost',   bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444' },
};

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

export const STAGE_ORDER: LeadStage[] = [
  'new', 'attempted', 'connected', 'qualified', 'consultation', 'proposal', 'partial', 'won', 'lost'
];
