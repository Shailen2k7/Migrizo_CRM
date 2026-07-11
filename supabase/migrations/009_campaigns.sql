-- =============================================================================
-- MIGRIZO CRM — 009_campaigns.sql
-- Bulk email campaigns with throttled sending, per-recipient tracking, and a
-- workspace-wide unsubscribe/suppression list.
-- =============================================================================

-- A campaign = one send of one template to a chosen audience.
create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  created_by    uuid,
  name          text not null,
  template_key  text,                       -- which library template (or 'custom')
  subject       text not null,              -- final (possibly edited) subject
  html          text not null,              -- final (possibly edited) body HTML
  status        text not null default 'sending',  -- sending | done | paused
  total         int  not null default 0,
  sent          int  not null default 0,
  failed        int  not null default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- One row per recipient of a campaign — the send queue + delivery log.
create table if not exists public.campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  workspace_id  uuid not null,
  lead_id       uuid not null,
  email         text not null,
  full_name     text,
  status        text not null default 'queued',  -- queued | sent | failed | skipped
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz default now()
);

create index if not exists idx_camp_recip_pending
  on public.campaign_recipients (campaign_id, status);
create index if not exists idx_camp_recip_lead
  on public.campaign_recipients (lead_id);

-- Suppression list: any email here is NEVER sent to again (unsubscribes/bounces).
create table if not exists public.email_suppressions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  email         text not null,
  reason        text default 'unsubscribe',   -- unsubscribe | bounce | manual
  created_at    timestamptz default now(),
  unique (workspace_id, email)
);

-- RLS ---------------------------------------------------------------------------
alter table public.campaigns            enable row level security;
alter table public.campaign_recipients  enable row level security;
alter table public.email_suppressions   enable row level security;

drop policy if exists "ws campaigns" on public.campaigns;
create policy "ws campaigns" on public.campaigns for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "ws campaign recips" on public.campaign_recipients;
create policy "ws campaign recips" on public.campaign_recipients for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "ws suppressions" on public.email_suppressions;
create policy "ws suppressions" on public.email_suppressions for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

-- Cron: drain the campaign send queue every minute (throttled in the endpoint).
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('migrizo-campaign-drain'); exception when others then null; end $$;
select cron.schedule('migrizo-campaign-drain', '* * * * *', $$
  select net.http_post(
    url     := 'https://crm.migrizo.com/api/campaigns/drain',
    headers := '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
