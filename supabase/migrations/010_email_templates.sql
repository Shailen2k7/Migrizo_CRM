-- =============================================================================
-- MIGRIZO CRM — 010_email_templates.sql
-- Custom email templates: add / edit / delete your own campaign templates
-- alongside the 13 built-in ones.
-- =============================================================================
create table if not exists public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  created_by    uuid,
  name          text not null,
  track         text default 'Custom',
  subject       text not null,
  html          text not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.email_templates enable row level security;
drop policy if exists "ws email templates" on public.email_templates;
create policy "ws email templates" on public.email_templates for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));
