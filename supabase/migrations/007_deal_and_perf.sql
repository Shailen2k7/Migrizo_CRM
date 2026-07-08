-- =============================================================================
-- MIGRIZO CRM — 007_deal_and_perf.sql
--   1. leads.discount — the discount amount agreed for a lead (0 = none).
--      Deal amount is leads.amount_total; final payable = amount_total.
--      Original deal = amount_total + discount.
--   2. Index for the lead Email History tab (activity by lead + action).
-- =============================================================================
alter table public.leads
  add column if not exists discount bigint not null default 0;

create index if not exists idx_activity_lead_action
  on public.activity (lead_id, action, created_at desc);
