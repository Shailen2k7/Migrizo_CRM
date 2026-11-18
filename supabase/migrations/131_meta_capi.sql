-- =============================================================================
-- MIGRIZO CRM — 131_meta_capi.sql
-- Meta Conversions API (CRM) — send our real lead stages back to Meta so the
-- ads can optimise for "conversion leads" instead of raw form fills.
--
-- WHAT THIS ADDS (nothing existing is changed or removed):
--   1. leads.meta_leadgen_id      — Meta's numeric lead id (text, indexed)
--      leads.meta_lead_created_at — when Meta created the lead (unix seconds)
--   2. meta_capi_events           — one row per (lead, event): the queue, the
--                                   idempotency guard and the send log in one
--   3. Triggers that fill the queue:
--        lead       — when a lead first gets its Meta id (i.e. on arrival)
--        contacted  — first stage change made by a TEAM MEMBER
--        qualified  — a team member marks the lead Eligible / Highly eligible
--      Automations (service role, no signed-in user) never count as contact
--      or qualification.
--
-- HOW THE META ID ARRIVES: the ingest endpoint already writes Make's
-- meta_lead_id + created_time into form_submissions. A trigger copies them
-- onto the lead. So the lead-intake code itself is not touched at all.
--
-- Sending happens in /api/meta-capi/run (called every minute by cron, see
-- the separate cron SQL). The triggers only insert queue rows — they never
-- call out, so a Meta problem can never slow down or block a CRM action.
-- Safe to run more than once.
-- =============================================================================

-- 1) Fields on the lead ------------------------------------------------------
alter table public.leads add column if not exists meta_leadgen_id text;
alter table public.leads add column if not exists meta_lead_created_at bigint;
create index if not exists idx_leads_meta_leadgen_id
  on public.leads (meta_leadgen_id) where meta_leadgen_id is not null;

-- 2) Queue + idempotency + log ----------------------------------------------
create table if not exists public.meta_capi_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid references public.workspaces(id) on delete cascade,
  lead_id          uuid not null references public.leads(id) on delete cascade,
  event_name       text not null check (event_name in ('lead', 'contacted', 'qualified')),
  event_time       bigint not null,                    -- unix seconds, when the stage happened
  status           text not null default 'pending'
                   check (status in ('pending', 'sent', 'failed', 'skipped')),
  sent_at          timestamptz,
  http_status      integer,
  response_body    text,
  attempt_count    integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  source           text not null default 'trigger',    -- trigger | backfill
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Never the same stage twice for the same lead.
  unique (lead_id, event_name)
);
create index if not exists idx_meta_capi_due
  on public.meta_capi_events (next_attempt_at) where status = 'pending';

alter table public.meta_capi_events enable row level security;
drop policy if exists "ws meta capi read" on public.meta_capi_events;
create policy "ws meta capi read" on public.meta_capi_events for select to public
  using (workspace_id in (select user_workspaces()));
-- No insert/update policy: only triggers (security definer) and the server
-- (service role) write here.

-- Helper: queue one event, silently ignoring a repeat. ------------------------
create or replace function public.meta_capi_enqueue(
  p_workspace uuid, p_lead uuid, p_event text, p_time timestamptz, p_source text default 'trigger'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.meta_capi_events (workspace_id, lead_id, event_name, event_time, source)
  values (p_workspace, p_lead, p_event, floor(extract(epoch from coalesce(p_time, now())))::bigint, p_source)
  on conflict (lead_id, event_name) do nothing;
exception when others then
  -- A queue problem must never fail the CRM action that caused it.
  raise warning 'meta_capi_enqueue failed for lead % / %: %', p_lead, p_event, sqlerrm;
end $$;

-- 3a) form_submissions → copy the Meta id onto the lead ------------------------
create or replace function public.meta_capi_copy_leadgen_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.meta_lead_id is not null and new.meta_lead_id ~ '^[0-9]+$' and new.lead_id is not null then
    update public.leads
       set meta_leadgen_id = new.meta_lead_id,
           meta_lead_created_at = floor(extract(epoch from coalesce(new.submitted_at, now())))::bigint
     where id = new.lead_id
       and meta_leadgen_id is null;   -- keep the first id a lead arrived with
  end if;
  return new;
exception when others then
  raise warning 'meta_capi_copy_leadgen_id failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_meta_capi_copy_leadgen_id on public.form_submissions;
create trigger trg_meta_capi_copy_leadgen_id
  after insert on public.form_submissions
  for each row execute function public.meta_capi_copy_leadgen_id();

-- 3b) leads → queue stage events ----------------------------------------------
create or replace function public.meta_capi_lead_events()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.meta_leadgen_id is null then
    return new;                                   -- not a Meta lead: nothing to send
  end if;

  -- lead: the moment the lead got its Meta id (arrival). Event time = when the
  -- lead was created in the CRM.
  if tg_op = 'INSERT' or old.meta_leadgen_id is null then
    perform public.meta_capi_enqueue(new.workspace_id, new.id, 'lead', new.created_at);
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null then
    -- contacted: first stage change made by a signed-in team member.
    if new.stage is distinct from old.stage then
      perform public.meta_capi_enqueue(new.workspace_id, new.id, 'contacted', now());
    end if;
    -- qualified: a team member marks the lead Eligible (or Highly eligible).
    if new.eligibility in ('eligible', 'highly_eligible')
       and coalesce(old.eligibility, '') not in ('eligible', 'highly_eligible') then
      perform public.meta_capi_enqueue(new.workspace_id, new.id, 'qualified', coalesce(new.eligibility_at, now()));
    end if;
  end if;
  return new;
exception when others then
  raise warning 'meta_capi_lead_events failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists trg_meta_capi_lead_events on public.leads;
create trigger trg_meta_capi_lead_events
  after insert or update of meta_leadgen_id, stage, eligibility on public.leads
  for each row execute function public.meta_capi_lead_events();

-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'leads' and column_name like 'meta_lead%';
--   select count(*) from public.meta_capi_events;
