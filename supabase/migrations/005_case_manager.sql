-- =============================================================================
-- MIGRIZO CRM — 005_case_manager.sql
-- Configurable case manager (name + phone) shown in onboarding emails.
-- Seeds the current default: Mansi Behl.
-- =============================================================================
alter table public.workspaces
  add column if not exists case_manager_name  text,
  add column if not exists case_manager_phone text;

update public.workspaces
   set case_manager_name  = coalesce(case_manager_name,  'Mansi Behl'),
       case_manager_phone = coalesce(case_manager_phone, '+91 92174 28262')
 where case_manager_name is null;
