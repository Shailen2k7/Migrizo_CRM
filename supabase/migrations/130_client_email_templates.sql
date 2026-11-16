-- =============================================================================
-- MIGRIZO CRM — 130_client_email_templates.sql
-- Editable wording for one-to-one client emails sent from the lead drawer
-- (first one: the Document checklist email, one row per visa:
-- key = 'checklist_gtv' / 'checklist_ifv').
--
-- Separate from email_templates on purpose: that table feeds Campaigns and
-- Automation, and these must never appear there.
-- Safe to run more than once. Creates one new table; changes nothing else.
-- =============================================================================
create table if not exists public.client_email_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  key           text not null,
  subject       text not null default '',
  body          text not null default '',
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  unique (workspace_id, key)
);

alter table public.client_email_templates enable row level security;

drop policy if exists "ws client email templates" on public.client_email_templates;
create policy "ws client email templates" on public.client_email_templates for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));
