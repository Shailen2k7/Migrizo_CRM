-- =============================================================================
-- 085 — LOG EVERY POST THAT HITS THE LEAD INGEST ENDPOINT
-- -----------------------------------------------------------------------------
-- THE GAP THIS CLOSES
--
-- 083 records every submission that SUCCEEDS. A submission that is rejected —
-- bad token, missing name, workspace not found, a database error — still leaves
-- no trace anywhere in Postgres. So when Meta says 31 and the CRM says 11, there
-- is no way to tell from the database whether:
--
--   (a) only 11 POSTs ever arrived        → the gap is Meta → Make
--   (b) 31 arrived and 20 were rejected   → the gap is inside the CRM
--
-- Today that question can only be answered by opening Make.com and reading
-- execution logs one at a time. That is not acceptable for something checked
-- every morning.
--
-- After this, one query answers it. Every POST is logged before anything can go
-- wrong, with its outcome and — when it fails — the reason.
--
-- This mirrors whatsapp_webhook_log (042), which is what made "inbound is not
-- working" a five-second SELECT instead of an afternoon of guessing.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

create table if not exists public.ingest_log (
  id           uuid primary key default gen_random_uuid(),
  received_at  timestamptz not null default now(),

  -- 'created' | 'returning' | 'rejected'
  outcome      text not null,
  -- populated on rejection: missing_name, unauthorized, bad_json,
  -- no_workspace, insert_failed, …
  reason       text,

  lead_id      uuid,
  workspace_id uuid,

  -- what arrived, so a broken Make mapping is visible without opening Make
  full_name    text,
  phone        text,
  email        text,
  payload      jsonb not null default '{}'::jsonb,

  ms           int
);

create index if not exists ingest_log_time    on public.ingest_log (received_at desc);
create index if not exists ingest_log_outcome on public.ingest_log (outcome, received_at desc);

comment on table public.ingest_log is
  'One row per POST to /api/ingest/meta-lead, including the rejected ones. Answers "did it even arrive?". 085.';

alter table public.ingest_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ingest_log' and policyname = 'ingest_log_read'
  ) then
    -- Readable by any signed-in team member. Written only by the service role.
    create policy ingest_log_read on public.ingest_log
      for select to authenticated using (true);
  end if;
end $$;

-- ── keep it from growing forever ─────────────────────────────────────────────
create or replace function public.ingest_log_prune(p_days int default 60)
returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.ingest_log
     where received_at < now() - (p_days || ' days')::interval
    returning 1
  ) select count(*)::int from gone;
$$;

-- ── the morning question, as one function ────────────────────────────────────
-- "How many submissions reached the CRM today, and what happened to them?"
drop function if exists public.ingest_health(int);

create function public.ingest_health(p_days int default 1)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'window_days',   p_days,
    'arrived',       count(*),
    'created',       count(*) filter (where outcome = 'created'),
    'returning',     count(*) filter (where outcome = 'returning'),
    'rejected',      count(*) filter (where outcome = 'rejected'),
    'reasons',       coalesce(jsonb_object_agg(r.reason, r.n) filter (where r.reason is not null), '{}'::jsonb),
    'first_at',      min(received_at),
    'last_at',       max(received_at)
  )
  from public.ingest_log l
  left join lateral (
    select l.reason as reason,
           count(*) over (partition by l.reason) as n
  ) r on true
  where l.received_at >= now() - (p_days || ' days')::interval;
$$;

grant execute on function public.ingest_health(int) to authenticated;

do $$
begin
  raise notice '085 DONE: every lead POST is now logged, rejections included.';
end $$;
