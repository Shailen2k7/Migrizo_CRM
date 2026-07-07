-- =============================================================================
-- MIGRIZO CRM — 002_current_state.sql
-- Consolidated snapshot of the LIVE production schema (generated from Supabase).
-- This is the source-of-truth baseline: running it on an empty database
-- reproduces the current schema (tables, constraints, indexes, functions,
-- triggers, and RLS policies). Idempotent: safe to re-run.
--
-- NOTE: tables marked [LEGACY] below are leftovers from the old Zoho/static CRM
-- and are NOT used by the Next.js app. They are included for a faithful snapshot;
-- see the cleanup section at the end of this file to drop them when ready.
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- TABLES
-- ----------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid default gen_random_uuid() not null,
  name text not null,
  owner_id uuid not null,
  created_at timestamptz default now(),
  allow_member_task_edit boolean default false not null
);

create table if not exists public.profiles (  -- [LEGACY: unused by app]
  id uuid not null,
  full_name text default ''::text not null,
  role text default 'counselor'::text not null,
  avatar_initials text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  role text default 'admin'::text not null,
  created_at timestamptz default now(),
  status text default 'active'::text,
  can_view_payments boolean default true not null
);

create table if not exists public.leads (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  full_name text not null,
  phone text,
  email text,
  visa_type text,
  stage text default 'cold'::text not null,
  source text,
  score integer default 50,
  next_follow_up timestamptz,
  payment_status text default 'none'::text,
  amount_paid bigint default 0,
  amount_total bigint default 0,
  last_note text,
  last_note_author_id uuid,
  last_note_at timestamptz,
  tags text[] default '{}'::text[],
  created_at timestamptz default now(),
  created_by uuid,
  updated_at timestamptz default now(),
  is_sample boolean default false,
  hidden_from_payments boolean default false not null,
  industry text,
  amount_overdue numeric default 0 not null,
  is_spotlight boolean default false not null,
  won_at timestamptz,
  currency text default 'INR'::text not null
);

create table if not exists public.cases (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  lead_id uuid,
  client_name text not null,
  client_email text,
  client_phone text,
  visa_type text default 'Global Talent Visa'::text,
  current_stage text default 'roadmap_building'::text not null,
  status text default 'active'::text not null,
  endorsement_status text default 'pending'::text,
  visa_status text default 'pending'::text,
  started_at timestamptz default now(),
  endorsement_submitted_at timestamptz,
  endorsement_approved_at timestamptz,
  visa_submitted_at timestamptz,
  visa_approved_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  current_phase text default 'start'::text not null,
  journey jsonb default '{"gates": {}, "tasks": {}, "pillars": {}}'::jsonb not null,
  owner_id uuid,
  owner_name text,
  endorsing_body text,
  submission_ref text,
  submitted_at timestamptz,
  decision text default 'pending'::text not null,
  decided_at timestamptz,
  archived_at timestamptz,
  client_token uuid default gen_random_uuid() not null,
  visa_decision text default 'pending'::text not null
);

create table if not exists public.notes (
  id uuid default gen_random_uuid() not null,
  lead_id uuid not null,
  workspace_id uuid not null,
  body text not null,
  author_id uuid,
  created_at timestamptz default now()
);

create table if not exists public.payments (
  id uuid default gen_random_uuid() not null,
  lead_id uuid not null,
  workspace_id uuid not null,
  milestone text not null,
  amount bigint not null,
  status text default 'pending'::text,
  due_date date,
  paid_at timestamptz,
  note text,
  created_at timestamptz default now(),
  created_by uuid,
  currency text default 'INR'::text not null
);

create table if not exists public.activity (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  user_id uuid,
  lead_id uuid,
  action text not null,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.follow_ups (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  lead_id uuid not null,
  title text not null,
  scheduled_at timestamptz not null,
  channel text default 'call'::text not null,
  status text default 'pending'::text not null,
  notes text,
  outcome text,
  completed_at timestamptz,
  assigned_to uuid,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.case_activity (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  workspace_id uuid not null,
  user_id uuid,
  action text not null,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.case_checklist_items (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  stage text not null,
  category text,
  title text not null,
  description text,
  status text default 'pending'::text not null,
  notes text,
  display_order integer default 0,
  is_required boolean default true,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.case_tasks (
  id uuid default gen_random_uuid() not null,
  case_id uuid,
  stage integer not null,
  label text not null,
  status text default 'not_started'::text not null,
  notes text default ''::text,
  sort_order integer default 0,
  is_custom boolean default false,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.audit_log (  -- [LEGACY: unused by app]
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  user_name text,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_name text,
  before_state jsonb,
  after_state jsonb,
  ip_address text,
  created_at timestamptz default now()
);

create table if not exists public.leads_cache (  -- [LEGACY: unused by app]
  zoho_id text not null,
  full_name text,
  phone text,
  email text,
  score integer default 0,
  tags text[] default '{}'::text[],
  stage text default 'New Inquiry'::text,
  amount_paid numeric default 0,
  total_fee numeric default 0,
  payment_phase text,
  owner_name text,
  last_contacted timestamptz,
  raw jsonb,
  synced_at timestamptz default now()
);

create table if not exists public.tasks_cache (  -- [LEGACY: unused by app]
  zoho_id text not null,
  subject text,
  due_date timestamptz,
  status text default 'Not Started'::text,
  contact_id text,
  contact_name text,
  contact_phone text,
  priority text default 'Normal'::text,
  description text,
  raw jsonb,
  synced_at timestamptz default now()
);

create table if not exists public.events_cache (  -- [LEGACY: unused by app]
  zoho_id text not null,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  contact_id text,
  contact_name text,
  event_type text default 'Consultation'::text,
  location text,
  raw jsonb,
  synced_at timestamptz default now()
);

create table if not exists public.zoho_tokens (  -- [LEGACY: unused by app]
  id integer default 1 not null,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  api_domain text default 'https://www.zohoapis.in'::text,
  connected_by uuid,
  updated_at timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- CONSTRAINTS (primary keys, foreign keys, unique, check)
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_pkey') then
    execute 'alter table public.activity add constraint activity_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'audit_log_pkey') then
    execute 'alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_activity_pkey') then
    execute 'alter table public.case_activity add constraint case_activity_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_checklist_items_pkey') then
    execute 'alter table public.case_checklist_items add constraint case_checklist_items_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_tasks_pkey') then
    execute 'alter table public.case_tasks add constraint case_tasks_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_pkey') then
    execute 'alter table public.cases add constraint cases_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_cache_pkey') then
    execute 'alter table public.events_cache add constraint events_cache_pkey PRIMARY KEY (zoho_id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_pkey') then
    execute 'alter table public.follow_ups add constraint follow_ups_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_pkey') then
    execute 'alter table public.leads add constraint leads_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_cache_pkey') then
    execute 'alter table public.leads_cache add constraint leads_cache_pkey PRIMARY KEY (zoho_id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notes_pkey') then
    execute 'alter table public.notes add constraint notes_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_pkey') then
    execute 'alter table public.payments add constraint payments_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pkey') then
    execute 'alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_cache_pkey') then
    execute 'alter table public.tasks_cache add constraint tasks_cache_pkey PRIMARY KEY (zoho_id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_members_pkey') then
    execute 'alter table public.workspace_members add constraint workspace_members_pkey PRIMARY KEY (workspace_id, user_id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_pkey') then
    execute 'alter table public.workspaces add constraint workspaces_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'zoho_tokens_pkey') then
    execute 'alter table public.zoho_tokens add constraint zoho_tokens_pkey PRIMARY KEY (id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_workspace_id_fkey') then
    execute 'alter table public.activity add constraint activity_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_user_id_fkey') then
    execute 'alter table public.activity add constraint activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'activity_lead_id_fkey') then
    execute 'alter table public.activity add constraint activity_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'audit_log_user_id_fkey') then
    execute 'alter table public.audit_log add constraint audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_activity_case_id_fkey') then
    execute 'alter table public.case_activity add constraint case_activity_case_id_fkey FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_activity_workspace_id_fkey') then
    execute 'alter table public.case_activity add constraint case_activity_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_activity_user_id_fkey') then
    execute 'alter table public.case_activity add constraint case_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_checklist_items_case_id_fkey') then
    execute 'alter table public.case_checklist_items add constraint case_checklist_items_case_id_fkey FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_checklist_items_completed_by_fkey') then
    execute 'alter table public.case_checklist_items add constraint case_checklist_items_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_workspace_id_fkey') then
    execute 'alter table public.cases add constraint cases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_lead_id_fkey') then
    execute 'alter table public.cases add constraint cases_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_created_by_fkey') then
    execute 'alter table public.cases add constraint cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_created_by_fkey') then
    execute 'alter table public.follow_ups add constraint follow_ups_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_workspace_id_fkey') then
    execute 'alter table public.follow_ups add constraint follow_ups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_lead_id_fkey') then
    execute 'alter table public.follow_ups add constraint follow_ups_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_assigned_to_fkey') then
    execute 'alter table public.follow_ups add constraint follow_ups_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_workspace_id_fkey') then
    execute 'alter table public.leads add constraint leads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_last_note_author_id_fkey') then
    execute 'alter table public.leads add constraint leads_last_note_author_id_fkey FOREIGN KEY (last_note_author_id) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_created_by_fkey') then
    execute 'alter table public.leads add constraint leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notes_lead_id_fkey') then
    execute 'alter table public.notes add constraint notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notes_workspace_id_fkey') then
    execute 'alter table public.notes add constraint notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notes_author_id_fkey') then
    execute 'alter table public.notes add constraint notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_lead_id_fkey') then
    execute 'alter table public.payments add constraint payments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_workspace_id_fkey') then
    execute 'alter table public.payments add constraint payments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_created_by_fkey') then
    execute 'alter table public.payments add constraint payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_id_fkey') then
    execute 'alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_members_workspace_id_fkey') then
    execute 'alter table public.workspace_members add constraint workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_members_user_id_fkey') then
    execute 'alter table public.workspace_members add constraint workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_owner_id_fkey') then
    execute 'alter table public.workspaces add constraint workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'zoho_tokens_connected_by_fkey') then
    execute 'alter table public.zoho_tokens add constraint zoho_tokens_connected_by_fkey FOREIGN KEY (connected_by) REFERENCES auth.users(id)';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_checklist_items_status_check') then
    execute 'alter table public.case_checklist_items add constraint case_checklist_items_status_check CHECK ((status = ANY (ARRAY[''pending''::text, ''in_progress''::text, ''completed''::text, ''not_applicable''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_tasks_stage_check') then
    execute 'alter table public.case_tasks add constraint case_tasks_stage_check CHECK (((stage >= 1) AND (stage <= 6)))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'case_tasks_status_check') then
    execute 'alter table public.case_tasks add constraint case_tasks_status_check CHECK ((status = ANY (ARRAY[''not_started''::text, ''in_progress''::text, ''done''::text, ''na''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_current_stage_check') then
    execute 'alter table public.cases add constraint cases_current_stage_check CHECK ((current_stage = ANY (ARRAY[''roadmap_building''::text, ''profile_building''::text, ''final_mapping''::text, ''endorsement_submission''::text, ''visa_application''::text, ''post_arrival''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_status_check') then
    execute 'alter table public.cases add constraint cases_status_check CHECK ((status = ANY (ARRAY[''active''::text, ''on_hold''::text, ''completed''::text, ''rejected''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_endorsement_status_check') then
    execute 'alter table public.cases add constraint cases_endorsement_status_check CHECK ((endorsement_status = ANY (ARRAY[''pending''::text, ''approved''::text, ''rejected''::text, ''not_applicable''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_visa_status_check') then
    execute 'alter table public.cases add constraint cases_visa_status_check CHECK ((visa_status = ANY (ARRAY[''pending''::text, ''approved''::text, ''rejected''::text, ''not_applicable''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cases_visa_decision_chk') then
    execute 'alter table public.cases add constraint cases_visa_decision_chk CHECK ((visa_decision = ANY (ARRAY[''pending''::text, ''approved''::text, ''rejected''::text, ''resubmission''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_channel_check') then
    execute 'alter table public.follow_ups add constraint follow_ups_channel_check CHECK ((channel = ANY (ARRAY[''call''::text, ''email''::text, ''whatsapp''::text, ''meeting''::text, ''other''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_status_check') then
    execute 'alter table public.follow_ups add constraint follow_ups_status_check CHECK ((status = ANY (ARRAY[''pending''::text, ''completed''::text, ''missed''::text, ''cancelled''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_score_check') then
    execute 'alter table public.leads add constraint leads_score_check CHECK (((score >= 0) AND (score <= 100)))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_payment_status_check') then
    execute 'alter table public.leads add constraint leads_payment_status_check CHECK ((payment_status = ANY (ARRAY[''none''::text, ''partial''::text, ''paid''::text, ''overdue''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_stage_check') then
    execute 'alter table public.leads add constraint leads_stage_check CHECK ((stage = ANY (ARRAY[''hot''::text, ''cold''::text, ''mr_coming_soon''::text, ''invoice_sent''::text, ''won''::text, ''junk''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_currency_chk') then
    execute 'alter table public.leads add constraint leads_currency_chk CHECK ((currency = ANY (ARRAY[''INR''::text, ''GBP''::text, ''USD''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_milestone_check') then
    execute 'alter table public.payments add constraint payments_milestone_check CHECK ((milestone = ANY (ARRAY[''kickstart''::text, ''profile_building''::text, ''endorsement''::text, ''post_approval''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_status_check') then
    execute 'alter table public.payments add constraint payments_status_check CHECK ((status = ANY (ARRAY[''pending''::text, ''paid''::text, ''overdue''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_currency_chk') then
    execute 'alter table public.payments add constraint payments_currency_chk CHECK ((currency = ANY (ARRAY[''INR''::text, ''GBP''::text, ''USD''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_members_role_check') then
    execute 'alter table public.workspace_members add constraint workspace_members_role_check CHECK ((role = ANY (ARRAY[''admin''::text, ''member''::text])))';
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_members_status_check') then
    execute 'alter table public.workspace_members add constraint workspace_members_status_check CHECK ((status = ANY (ARRAY[''pending''::text, ''active''::text, ''paused''::text])))';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log USING btree (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads_cache USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_leads_payment_phase ON public.leads_cache USING btree (payment_phase);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks_cache USING btree (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks_cache USING btree (status);
CREATE INDEX IF NOT EXISTS idx_checklist_case ON public.case_checklist_items USING btree (case_id);
CREATE INDEX IF NOT EXISTS idx_checklist_stage ON public.case_checklist_items USING btree (case_id, stage);
CREATE INDEX IF NOT EXISTS idx_case_activity_case ON public.case_activity USING btree (case_id);
CREATE INDEX IF NOT EXISTS idx_case_activity_ws ON public.case_activity USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_cases_workspace ON public.cases USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_cases_lead ON public.cases USING btree (lead_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases USING btree (status);
CREATE INDEX IF NOT EXISTS idx_cases_stage ON public.cases USING btree (current_stage);
CREATE UNIQUE INDEX IF NOT EXISTS cases_client_token_key ON public.cases USING btree (client_token);
CREATE INDEX IF NOT EXISTS idx_cases_client_token ON public.cases USING btree (client_token);
CREATE INDEX IF NOT EXISTS idx_notes_lead ON public.notes USING btree (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_workspace ON public.activity USING btree (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_workspace ON public.leads USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads USING btree (workspace_id, phone) WHERE (phone IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads USING btree (workspace_id, email) WHERE (email IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up ON public.leads USING btree (workspace_id, next_follow_up);
CREATE INDEX IF NOT EXISTS idx_leads_hidden_from_payments ON public.leads USING btree (workspace_id, hidden_from_payments) WHERE (hidden_from_payments = false);
CREATE INDEX IF NOT EXISTS idx_leads_industry ON public.leads USING btree (workspace_id, industry) WHERE (industry IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_leads_spotlight ON public.leads USING btree (workspace_id, is_spotlight) WHERE (is_spotlight = true);
CREATE INDEX IF NOT EXISTS idx_payments_lead ON public.payments USING btree (lead_id);
CREATE INDEX IF NOT EXISTS idx_payments_workspace ON public.payments USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_due ON public.payments USING btree (workspace_id, due_date) WHERE (status <> 'paid'::text);
CREATE INDEX IF NOT EXISTS idx_followups_workspace ON public.follow_ups USING btree (workspace_id);
CREATE INDEX IF NOT EXISTS idx_followups_lead ON public.follow_ups USING btree (lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_status ON public.follow_ups USING btree (status);
CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON public.follow_ups USING btree (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_followups_lookup ON public.follow_ups USING btree (workspace_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_case_tasks_case ON public.case_tasks USING btree (case_id);
CREATE INDEX IF NOT EXISTS idx_case_tasks_stage ON public.case_tasks USING btree (case_id, stage, sort_order);

-- ----------------------------------------------------------------------------
-- FUNCTIONS / RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_member(p_workspace_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only active admins can approve members';
  end if;
  update public.workspace_members set status = 'active'
  where workspace_id = p_workspace_id and user_id = p_user_id;
end$function$;

CREATE OR REPLACE FUNCTION public.approve_member_by_email(p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_user_id uuid;
  ws_id uuid;
begin
  select id into target_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if target_user_id is null then return format('User %s not found', p_email); end if;
  select wm.workspace_id into ws_id from public.workspace_members wm where wm.user_id = target_user_id limit 1;
  if ws_id is null then return format('User %s has no workspace membership', p_email); end if;
  if not public.is_workspace_admin(ws_id) then return 'You are not an admin of that workspace'; end if;
  update public.workspace_members set status = 'active' where user_id = target_user_id and workspace_id = ws_id;
  return format('Approved %s', p_email);
end$function$;

CREATE OR REPLACE FUNCTION public.change_member_role(p_workspace_id uuid, p_user_id uuid, p_new_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare is_owner boolean;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only active admins can change roles';
  end if;
  if p_new_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;
  select (owner_id = p_user_id) into is_owner from public.workspaces where id = p_workspace_id;
  if coalesce(is_owner, false) and p_new_role <> 'admin' then
    raise exception 'Cannot demote the workspace owner';
  end if;
  update public.workspace_members set role = p_new_role where workspace_id = p_workspace_id and user_id = p_user_id;
end$function$;

CREATE OR REPLACE FUNCTION public.create_case_with_defaults(p_workspace_id uuid, p_lead_id uuid, p_client_name text, p_visa_type text DEFAULT 'Global Talent Visa'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_case_id uuid;
  client_email_v text;
  client_phone_v text;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id = p_workspace_id
      and wm.status = 'active'
  ) then
    raise exception 'Not an active member of this workspace';
  end if;

  if p_lead_id is not null then
    select l.email, l.phone into client_email_v, client_phone_v from public.leads l where l.id = p_lead_id;
  end if;

  insert into public.cases (workspace_id, lead_id, client_name, client_email, client_phone, visa_type, created_by)
  values (p_workspace_id, p_lead_id, p_client_name, client_email_v, client_phone_v, p_visa_type, auth.uid())
  returning id into new_case_id;

  insert into public.case_checklist_items (case_id, stage, category, title, description, display_order, is_required) values
    (new_case_id, 'roadmap_building', 'consultation', 'Initial consultation completed',      'Discovery call to understand the client''s profile and goals', 1, true),
    (new_case_id, 'roadmap_building', 'consultation', 'Career roadmap document created',     'Personalized 3–6 month plan delivered', 2, true),
    (new_case_id, 'roadmap_building', 'consultation', 'Visa route confirmed',                'Global Talent / Innovator Founder / Skilled Worker', 3, true),
    (new_case_id, 'roadmap_building', 'consultation', 'Timeline agreed with client',         'Estimated submission and decision dates', 4, true),
    (new_case_id, 'roadmap_building', 'agreement',    'Service agreement signed',            'Engagement letter executed', 5, true),
    (new_case_id, 'roadmap_building', 'agreement',    'Kickstart payment received (25%)',    null, 6, true),

    (new_case_id, 'profile_building', 'documents', 'Passport copy',                            'Clear scan of all relevant pages', 10, true),
    (new_case_id, 'profile_building', 'documents', 'Experience certificates',                  'From all employers in the relevant field', 11, true),
    (new_case_id, 'profile_building', 'documents', 'Relieving letters',                        'For all previous employers', 12, true),
    (new_case_id, 'profile_building', 'documents', 'Salary slips (last 6 months)',             null, 13, true),
    (new_case_id, 'profile_building', 'documents', 'Education certificates',                   'Degree, mark sheets, transcripts', 14, true),
    (new_case_id, 'profile_building', 'documents', 'Tax returns (last 2 years)',               'Form 16 or ITR', 15, false),

    (new_case_id, 'profile_building', 'achievements', 'Awards and certifications',             'Industry recognition collected and verified', 20, true),
    (new_case_id, 'profile_building', 'achievements', 'Patents (if applicable)',               null, 21, false),
    (new_case_id, 'profile_building', 'achievements', 'Publications and citations',            'Journal articles, conference papers, h-index', 22, false),

    (new_case_id, 'profile_building', 'recognition', 'Domestic recognition documentation',     'National-level awards or media features', 30, false),
    (new_case_id, 'profile_building', 'recognition', 'International recognition documentation','Cross-border awards or invitations', 31, false),
    (new_case_id, 'profile_building', 'recognition', 'Media coverage compilation',             'Articles, interviews, podcast appearances', 32, false),

    (new_case_id, 'profile_building', 'online', 'LinkedIn profile optimized',                  'Headline, About, Experience, Skills, Recommendations', 40, true),
    (new_case_id, 'profile_building', 'online', 'LinkedIn posts published (10+)',              'High-quality thought-leadership posts', 41, true),
    (new_case_id, 'profile_building', 'online', 'GitHub / portfolio updated',                  'Project showcases, code samples', 42, false),
    (new_case_id, 'profile_building', 'online', 'Personal website / blog',                     null, 43, false),

    (new_case_id, 'profile_building', 'references', 'LOR 1 — Industry peer',                   'Letter from a peer-level professional', 50, true),
    (new_case_id, 'profile_building', 'references', 'LOR 2 — Senior leader',                   'Letter from a senior leader/director', 51, true),
    (new_case_id, 'profile_building', 'references', 'LOR 3 — International expert',            'Cross-border endorsement (recommended)', 52, true),

    (new_case_id, 'profile_building', 'mentorship', 'Mentorship sessions completed',           'Minimum 3 sessions with an industry mentor', 60, true),
    (new_case_id, 'profile_building', 'mentorship', 'Mentor endorsement letter',               'Written endorsement from mentor', 61, false),

    (new_case_id, 'profile_building', 'publications', 'Paper publication submitted',           'Academic or industry journal', 70, false),
    (new_case_id, 'profile_building', 'publications', 'News media publication',                'Op-ed, byline article, interview', 71, false),
    (new_case_id, 'profile_building', 'publications', 'Framework / methodology documented',    'Original framework developed by the client', 72, false),
    (new_case_id, 'profile_building', 'publications', 'Speaking engagements',                  'Conferences, webinars, panels', 73, false),

    (new_case_id, 'profile_building', 'payment', 'Profile-building payment received (35%)',    null, 80, true),

    (new_case_id, 'final_mapping', 'application', 'Application form — first draft',           'Complete application form drafted', 100, true),
    (new_case_id, 'final_mapping', 'application', 'Application form — client review',         'Reviewed and approved by client', 101, true),
    (new_case_id, 'final_mapping', 'application', 'Application form — final version',         null, 102, true),
    (new_case_id, 'final_mapping', 'evidence',    'All evidence indexed and labelled',         'Each document tagged to a specific criterion', 103, true),
    (new_case_id, 'final_mapping', 'evidence',    'Personal statement — final version',       '1,000-word personal statement polished', 104, true),
    (new_case_id, 'final_mapping', 'qa',          'Internal quality check completed',          'Senior reviewer sign-off', 105, true),
    (new_case_id, 'final_mapping', 'qa',          'Mock submission test passed',               'Full dress rehearsal of submission', 106, true),

    (new_case_id, 'endorsement_submission', 'submission', 'Endorsement application submitted',  null, 200, true),
    (new_case_id, 'endorsement_submission', 'submission', 'Submission acknowledgment received', 'Reference number from endorsing body', 201, true),
    (new_case_id, 'endorsement_submission', 'submission', 'Endorsement payment received (25%)', null, 202, true),
    (new_case_id, 'endorsement_submission', 'tracking',   'Awaiting endorsement decision',      'Typical wait: 8 weeks', 203, true),
    (new_case_id, 'endorsement_submission', 'tracking',   'Endorsement decision received',      'Approved / Rejected', 204, true),

    (new_case_id, 'visa_application', 'submission', 'Visa application form completed',      'UKVI online form', 300, true),
    (new_case_id, 'visa_application', 'submission', 'Biometric appointment booked',         null, 301, true),
    (new_case_id, 'visa_application', 'submission', 'Biometric appointment completed',      null, 302, true),
    (new_case_id, 'visa_application', 'submission', 'Visa fee paid',                        null, 303, true),
    (new_case_id, 'visa_application', 'submission', 'IHS (Health Surcharge) paid',          null, 304, true),
    (new_case_id, 'visa_application', 'submission', 'Documents uploaded to UKVI portal',    null, 305, true),
    (new_case_id, 'visa_application', 'tracking',   'Visa decision received',                null, 306, true),

    (new_case_id, 'post_arrival', 'arrival',   'UK arrival confirmed',                          'Date of landing recorded', 400, true),
    (new_case_id, 'post_arrival', 'arrival',   'BRP (Biometric Residence Permit) collected',    null, 401, true),
    (new_case_id, 'post_arrival', 'setup',     'National Insurance number applied',             null, 402, true),
    (new_case_id, 'post_arrival', 'setup',     'UK bank account opened',                        null, 403, true),
    (new_case_id, 'post_arrival', 'setup',     'Housing — initial accommodation',               null, 404, false),
    (new_case_id, 'post_arrival', 'setup',     'Housing — long-term let',                       null, 405, false),
    (new_case_id, 'post_arrival', 'setup',     'Employment / business registration',            null, 406, false),
    (new_case_id, 'post_arrival', 'followup',  '3-month check-in call',                         null, 407, true),
    (new_case_id, 'post_arrival', 'followup',  '6-month milestone check',                       null, 408, true),
    (new_case_id, 'post_arrival', 'followup',  '12-month milestone check',                      'Year-1 review', 409, true),
    (new_case_id, 'post_arrival', 'payment',   'Post-approval payment received (15%)',          null, 410, true);

  insert into public.case_activity (case_id, workspace_id, user_id, action, meta)
  values (new_case_id, p_workspace_id, auth.uid(), 'case_created', jsonb_build_object('client_name', p_client_name, 'visa_type', p_visa_type));

  return new_case_id;
end$function$;

CREATE OR REPLACE FUNCTION public.get_case_journey(p_token uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'client_name',   c.client_name,
    'visa_type',     c.visa_type,
    'owner_name',    c.owner_name,
    'current_phase', c.current_phase,
    'journey',       c.journey,
    'decision',      c.decision,
    'decided_at',    c.decided_at,
    'submission_ref',c.submission_ref,
    'submitted_at',  c.submitted_at,
    'archived_at',   c.archived_at,
    'updated_at',    c.updated_at
  )
  from public.cases c
  where c.client_token = p_token
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_users_display_info(p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, email text, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    id,
    email::text,
    coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))::text
  from auth.users
  where id = any(p_user_ids);
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  primary_ws_id uuid;
  display_name text;
begin
  -- Find primary (oldest) workspace
  select id into primary_ws_id from public.workspaces order by created_at asc limit 1;

  if primary_ws_id is null then
    -- First user ever: create workspace, become admin
    display_name := coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    );
    insert into public.workspaces (name, owner_id) values ('Migrizo CRM', new.id) returning id into primary_ws_id;
    insert into public.workspace_members (workspace_id, user_id, role, status)
    values (primary_ws_id, new.id, 'admin', 'active');
  else
    -- Subsequent user: pending member of primary workspace
    insert into public.workspace_members (workspace_id, user_id, role, status)
    values (primary_ws_id, new.id, 'member', 'pending')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end$function$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
      and role = 'admin' and status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.list_workspace_members(p_workspace_id uuid)
 RETURNS TABLE(user_id uuid, email text, full_name text, role text, status text, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    wm.user_id,
    u.email::text,
    coalesce(
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name',
      split_part(u.email::text, '@', 1)
    )::text,
    wm.role::text,
    wm.status::text,
    wm.created_at
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id
  where wm.workspace_id = p_workspace_id
    and exists (
      select 1 from public.workspace_members caller
      where caller.user_id = auth.uid() and caller.workspace_id = p_workspace_id
    )
  order by
    case wm.status when 'pending' then 0 when 'active' then 1 else 2 end,
    wm.created_at asc;
$function$;

CREATE OR REPLACE FUNCTION public.log_case_activity(p_case_id uuid, p_action text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ws_id uuid;
begin
  select c.workspace_id into ws_id from public.cases c where c.id = p_case_id;
  if ws_id is null then raise exception 'Case not found'; end if;

  insert into public.case_activity (case_id, workspace_id, user_id, action, meta)
  values (p_case_id, ws_id, auth.uid(), p_action, p_meta);
end$function$;

CREATE OR REPLACE FUNCTION public.my_membership()
 RETURNS TABLE(workspace_id uuid, workspace_name text, role text, status text, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select wm.workspace_id, w.name::text, wm.role::text, wm.status::text, wm.created_at
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  where wm.user_id = auth.uid()
  order by wm.created_at asc
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.pause_member(p_workspace_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare is_owner boolean;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only active admins can pause members';
  end if;
  select (owner_id = p_user_id) into is_owner from public.workspaces where id = p_workspace_id;
  if coalesce(is_owner, false) then
    raise exception 'Cannot pause the workspace owner';
  end if;
  update public.workspace_members set status = 'paused'
  where workspace_id = p_workspace_id and user_id = p_user_id;
end$function$;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare is_owner boolean;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only active admins can remove members';
  end if;
  select (owner_id = p_user_id) into is_owner from public.workspaces where id = p_workspace_id;
  if coalesce(is_owner, false) then
    raise exception 'Cannot remove the workspace owner';
  end if;
  delete from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id;
end$function$;

CREATE OR REPLACE FUNCTION public.reset_workspace(ws_id uuid, sample_only boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_workspace_admin(ws_id) then
    raise exception 'Only workspace admins can reset data';
  end if;

  if sample_only then
    delete from public.leads where workspace_id = ws_id and is_sample = true;
  else
    delete from public.activity where workspace_id = ws_id;
    delete from public.payments where workspace_id = ws_id;
    delete from public.notes where workspace_id = ws_id;
    delete from public.leads where workspace_id = ws_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resume_member(p_workspace_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_workspace_admin(p_workspace_id) then
    raise exception 'Only active admins can resume members';
  end if;
  update public.workspace_members set status = 'active'
  where workspace_id = p_workspace_id and user_id = p_user_id;
end$function$;

CREATE OR REPLACE FUNCTION public.run_consolidation(p_super_admin_email text, p_auto_approve_emails text[] DEFAULT ARRAY[]::text[])
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  admin_id uuid;
  primary_ws_id uuid;
  other_ws_id uuid;
  msg text := '';
  moved_data int := 0;
  moved_members int := 0;
  auto_approved int := 0;
begin
  -- Find super admin
  select id into admin_id from auth.users where lower(email) = lower(p_super_admin_email);
  if admin_id is null then raise exception 'Super admin user % not found in auth.users', p_super_admin_email; end if;

  -- Find or create the primary workspace
  select id into primary_ws_id from public.workspaces where owner_id = admin_id order by created_at asc limit 1;
  if primary_ws_id is null then
    insert into public.workspaces (name, owner_id) values ('Migrizo CRM', admin_id) returning id into primary_ws_id;
  end if;

  -- Ensure admin is admin+active in the primary workspace
  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (primary_ws_id, admin_id, 'admin', 'active')
  on conflict (workspace_id, user_id) do update set role = 'admin', status = 'active';

  -- For every OTHER workspace: move data into primary, move members as PENDING, delete the empty workspace
  for other_ws_id in select id from public.workspaces where id != primary_ws_id loop
    update public.leads    set workspace_id = primary_ws_id where workspace_id = other_ws_id;
    update public.notes    set workspace_id = primary_ws_id where workspace_id = other_ws_id;
    update public.payments set workspace_id = primary_ws_id where workspace_id = other_ws_id;
    update public.activity set workspace_id = primary_ws_id where workspace_id = other_ws_id;
    moved_data := moved_data + 1;

    insert into public.workspace_members (workspace_id, user_id, role, status)
    select primary_ws_id, user_id, 'member', 'pending'
    from public.workspace_members
    where workspace_id = other_ws_id and user_id != admin_id
    on conflict (workspace_id, user_id) do nothing;

    moved_members := moved_members + (select count(*) from public.workspace_members where workspace_id = other_ws_id and user_id != admin_id);

    delete from public.workspace_members where workspace_id = other_ws_id;
    delete from public.workspaces where id = other_ws_id;
  end loop;

  -- Auto-approve specified emails
  if array_length(p_auto_approve_emails, 1) > 0 then
    update public.workspace_members
    set status = 'active'
    where workspace_id = primary_ws_id
      and user_id in (select id from auth.users where lower(email) = any(select lower(e) from unnest(p_auto_approve_emails) e));
    get diagnostics auto_approved = row_count;
  end if;

  msg := format(
    'Consolidation done. Primary workspace: %s. Merged %s extra workspaces. Moved %s members (pending). Auto-approved %s emails.',
    primary_ws_id, moved_data, moved_members, auto_approved
  );
  return msg;
end$function$;

CREATE OR REPLACE FUNCTION public.sync_lead_next_followup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_lead_id uuid;
  next_time timestamptz;
begin
  target_lead_id := coalesce(new.lead_id, old.lead_id);

  select min(f.scheduled_at) into next_time
  from public.follow_ups f
  where f.lead_id = target_lead_id and f.status = 'pending';

  update public.leads set next_follow_up = next_time where id = target_lead_id;

  return coalesce(new, old);
end$function$;

CREATE OR REPLACE FUNCTION public.sync_lead_payment_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_lead_id uuid;
  total_paid numeric;
  lead_total numeric;
begin
  target_lead_id := coalesce(new.lead_id, old.lead_id);

  select coalesce(sum(amount), 0) into total_paid
  from public.payments
  where lead_id = target_lead_id and status = 'paid';

  select amount_total into lead_total from public.leads where id = target_lead_id;

  update public.leads
  set amount_paid = total_paid,
      payment_status = case
        when total_paid = 0 then 'none'
        when coalesce(lead_total, 0) > 0 and total_paid >= lead_total then 'paid'
        else 'partial'
      end
  where id = target_lead_id;

  return coalesce(new, old);
end$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.user_workspaces()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select workspace_id from public.workspace_members
  where user_id = auth.uid() and status = 'active';
$function$;

-- ----------------------------------------------------------------------------
-- TRIGGERS
-- ----------------------------------------------------------------------------
drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at BEFORE UPDATE on public.leads for each row EXECUTE FUNCTION update_updated_at();
drop trigger if exists trg_case_tasks_touch_updated on public.case_tasks;
create trigger trg_case_tasks_touch_updated BEFORE UPDATE on public.case_tasks for each row EXECUTE FUNCTION touch_updated_at();
drop trigger if exists cases_touch on public.cases;
create trigger cases_touch BEFORE UPDATE on public.cases for each row EXECUTE FUNCTION touch_updated_at();
drop trigger if exists checklist_touch on public.case_checklist_items;
create trigger checklist_touch BEFORE UPDATE on public.case_checklist_items for each row EXECUTE FUNCTION touch_updated_at();
drop trigger if exists followups_touch on public.follow_ups;
create trigger followups_touch BEFORE UPDATE on public.follow_ups for each row EXECUTE FUNCTION touch_updated_at();
drop trigger if exists followups_sync_lead on public.follow_ups;
create trigger followups_sync_lead AFTER INSERT or UPDATE or DELETE on public.follow_ups for each row EXECUTE FUNCTION sync_lead_next_followup();
drop trigger if exists payments_sync_lead on public.payments;
create trigger payments_sync_lead AFTER INSERT or UPDATE or DELETE on public.payments for each row EXECUTE FUNCTION sync_lead_payment_totals();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY + POLICIES
-- ----------------------------------------------------------------------------
alter table public.activity enable row level security;
alter table public.audit_log enable row level security;
alter table public.case_activity enable row level security;
alter table public.case_checklist_items enable row level security;
alter table public.case_tasks enable row level security;
alter table public.cases enable row level security;
alter table public.events_cache enable row level security;
alter table public.follow_ups enable row level security;
alter table public.leads enable row level security;
alter table public.leads_cache enable row level security;
alter table public.notes enable row level security;
alter table public.payments enable row level security;
alter table public.profiles enable row level security;
alter table public.tasks_cache enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspaces enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to public using ((auth.uid() = id));
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to public using ((auth.uid() = id));
drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles for select to public using ((EXISTS ( SELECT 1
   FROM profiles profiles_1
  WHERE ((profiles_1.id = auth.uid()) AND (profiles_1.role = 'admin'::text)))));
drop policy if exists "Admins read all audit logs" on public.audit_log;
create policy "Admins read all audit logs" on public.audit_log for select to public using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
drop policy if exists "Authenticated users insert logs" on public.audit_log;
create policy "Authenticated users insert logs" on public.audit_log for insert to public with check ((auth.uid() IS NOT NULL));
drop policy if exists "Authenticated users read leads" on public.leads_cache;
create policy "Authenticated users read leads" on public.leads_cache for select to public using ((auth.uid() IS NOT NULL));
drop policy if exists "Authenticated users read tasks" on public.tasks_cache;
create policy "Authenticated users read tasks" on public.tasks_cache for select to public using ((auth.uid() IS NOT NULL));
drop policy if exists "Authenticated users read events" on public.events_cache;
create policy "Authenticated users read events" on public.events_cache for select to public using ((auth.uid() IS NOT NULL));
drop policy if exists "update own workspace" on public.workspaces;
create policy "update own workspace" on public.workspaces for update to public using ((owner_id = auth.uid()));
drop policy if exists "admin update members" on public.workspace_members;
create policy "admin update members" on public.workspace_members for update to public using (is_workspace_admin(workspace_id));
drop policy if exists "view leads in workspace" on public.leads;
create policy "view leads in workspace" on public.leads for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert leads in workspace" on public.leads;
create policy "insert leads in workspace" on public.leads for insert to public with check ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "update leads in workspace" on public.leads;
create policy "update leads in workspace" on public.leads for update to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "delete leads admin only" on public.leads;
create policy "delete leads admin only" on public.leads for delete to public using (is_workspace_admin(workspace_id));
drop policy if exists "view notes in workspace" on public.notes;
create policy "view notes in workspace" on public.notes for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert notes in workspace" on public.notes;
create policy "insert notes in workspace" on public.notes for insert to public with check (((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)) AND (author_id = auth.uid())));
drop policy if exists "delete own notes or admin" on public.notes;
create policy "delete own notes or admin" on public.notes for delete to public using (((author_id = auth.uid()) OR is_workspace_admin(workspace_id)));
drop policy if exists "view payments in workspace" on public.payments;
create policy "view payments in workspace" on public.payments for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert payments in workspace" on public.payments;
create policy "insert payments in workspace" on public.payments for insert to public with check ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "update payments in workspace" on public.payments;
create policy "update payments in workspace" on public.payments for update to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "delete payments admin only" on public.payments;
create policy "delete payments admin only" on public.payments for delete to public using (is_workspace_admin(workspace_id));
drop policy if exists "view activity in workspace" on public.activity;
create policy "view activity in workspace" on public.activity for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert activity in workspace" on public.activity;
create policy "insert activity in workspace" on public.activity for insert to public with check ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "view memberships" on public.workspace_members;
create policy "view memberships" on public.workspace_members for select to public using (((user_id = auth.uid()) OR (workspace_id IN ( SELECT user_workspaces() AS user_workspaces))));
drop policy if exists "members can view workspace" on public.workspaces;
create policy "members can view workspace" on public.workspaces for select to public using ((id IN ( SELECT wm.workspace_id
   FROM workspace_members wm
  WHERE (wm.user_id = auth.uid()))));
drop policy if exists "Authenticated read case_tasks" on public.case_tasks;
create policy "Authenticated read case_tasks" on public.case_tasks for select to public using ((auth.uid() IS NOT NULL));
drop policy if exists "Authenticated insert case_tasks" on public.case_tasks;
create policy "Authenticated insert case_tasks" on public.case_tasks for insert to public with check ((auth.uid() IS NOT NULL));
drop policy if exists "Authenticated update case_tasks" on public.case_tasks;
create policy "Authenticated update case_tasks" on public.case_tasks for update to public using ((auth.uid() IS NOT NULL));
drop policy if exists "Authenticated delete case_tasks" on public.case_tasks;
create policy "Authenticated delete case_tasks" on public.case_tasks for delete to public using ((auth.uid() IS NOT NULL));
drop policy if exists "view cases" on public.cases;
create policy "view cases" on public.cases for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert cases" on public.cases;
create policy "insert cases" on public.cases for insert to public with check ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "update cases" on public.cases;
create policy "update cases" on public.cases for update to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "delete cases" on public.cases;
create policy "delete cases" on public.cases for delete to public using (is_workspace_admin(workspace_id));
drop policy if exists "view checklist" on public.case_checklist_items;
create policy "view checklist" on public.case_checklist_items for select to public using ((EXISTS ( SELECT 1
   FROM cases c
  WHERE ((c.id = case_checklist_items.case_id) AND (c.workspace_id IN ( SELECT user_workspaces() AS user_workspaces))))));
drop policy if exists "modify checklist" on public.case_checklist_items;
create policy "modify checklist" on public.case_checklist_items for all to public using ((EXISTS ( SELECT 1
   FROM cases c
  WHERE ((c.id = case_checklist_items.case_id) AND (c.workspace_id IN ( SELECT user_workspaces() AS user_workspaces)))))) with check ((EXISTS ( SELECT 1
   FROM cases c
  WHERE ((c.id = case_checklist_items.case_id) AND (c.workspace_id IN ( SELECT user_workspaces() AS user_workspaces))))));
drop policy if exists "view case activity" on public.case_activity;
create policy "view case activity" on public.case_activity for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert case activity" on public.case_activity;
create policy "insert case activity" on public.case_activity for insert to public with check ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "view followups" on public.follow_ups;
create policy "view followups" on public.follow_ups for select to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "insert followups" on public.follow_ups;
create policy "insert followups" on public.follow_ups for insert to public with check ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "update followups" on public.follow_ups;
create policy "update followups" on public.follow_ups for update to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));
drop policy if exists "delete followups" on public.follow_ups;
create policy "delete followups" on public.follow_ups for delete to public using ((workspace_id IN ( SELECT user_workspaces() AS user_workspaces)));

-- ----------------------------------------------------------------------------
-- OPTIONAL CLEANUP — legacy Zoho/static-CRM tables (uncomment to drop)
-- The Next.js app does NOT use these. Drop only after confirming nothing reads them.
-- ----------------------------------------------------------------------------
-- drop table if exists public.leads_cache cascade;
-- drop table if exists public.tasks_cache cascade;
-- drop table if exists public.events_cache cascade;
-- drop table if exists public.zoho_tokens cascade;
-- drop table if exists public.audit_log cascade;
-- (profiles is left in place — handle_new_user trigger may populate it.)
