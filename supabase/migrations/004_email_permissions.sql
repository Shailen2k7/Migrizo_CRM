-- =============================================================================
-- MIGRIZO CRM — 004_email_permissions.sql
-- Adds the workspace-level switch for the client email module.
-- Default OFF: only owners/admins can send onboarding / SLA / invoice emails.
-- Enforced both in the UI and server-side in /api/email/send.
-- =============================================================================
alter table public.workspaces
  add column if not exists allow_member_email boolean not null default false;
