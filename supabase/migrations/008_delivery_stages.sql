-- =============================================================================
-- MIGRIZO CRM — 008_delivery_stages.sql
-- Adds a simple delivery-status field to cases (alongside the journey system),
-- powering the Cases Board (kanban) and List filters:
--   onboarding, profile_building, submitted, endorsed, granted,
--   refused, reapplying, non_responsive, closed.
-- =============================================================================
alter table public.cases
  add column if not exists delivery_stage text not null default 'onboarding';

create index if not exists idx_cases_delivery_stage
  on public.cases (workspace_id, delivery_stage);
