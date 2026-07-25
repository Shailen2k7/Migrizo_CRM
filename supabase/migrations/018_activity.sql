-- ============================================================================
-- 018: TEAM ACTIVITY TRACKING (admin-only)
--
-- How it works, in plain terms:
--   • While someone is actively using the CRM, their browser sends one small
--     "ping" every 30 seconds saying which section they're on.
--   • Idle (no mouse/keyboard for 5 min) or tab hidden → pings stop, so idle
--     time is never counted as work.
--   • Raw pings are rolled up nightly into ONE summary row per person per day,
--     then deleted. That keeps the database small and fast forever.
--
-- Storage maths: 8 people x 90 days = ~720 summary rows. Trivial.
-- ============================================================================

-- ── Raw pings (short-lived; rolled up and deleted nightly) ──────────────────
create table if not exists public.activity_pings (
  id            bigserial primary key,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null,
  section       text not null default 'other',   -- leads | cases | payments | roadmap | learning | ...
  at            timestamptz not null default now()
);

-- One index does all the work: rollups and "who's online" both use it.
create index if not exists idx_pings_ws_at on public.activity_pings (workspace_id, at desc);
create index if not exists idx_pings_user_at on public.activity_pings (user_id, at desc);

alter table public.activity_pings enable row level security;

-- A person may only insert their OWN ping (no spoofing someone else's hours).
drop policy if exists "own ping insert" on public.activity_pings;
create policy "own ping insert" on public.activity_pings for insert to authenticated
  with check (user_id = auth.uid() and workspace_id in (select user_workspaces()));

-- Only admins may read raw pings.
drop policy if exists "admin read pings" on public.activity_pings;
create policy "admin read pings" on public.activity_pings for select to authenticated
  using (workspace_id in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role = 'admin'
  ));


-- ── Daily summary (the permanent record the dashboard reads) ────────────────
create table if not exists public.activity_days (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid not null,
  day            date not null,
  active_minutes int  not null default 0,          -- total active time that day
  first_seen     timestamptz,
  last_seen      timestamptz,
  by_section     jsonb not null default '{}'::jsonb, -- { "leads": 125, "cases": 80 } in minutes
  primary key (workspace_id, user_id, day)
);

create index if not exists idx_activity_days_ws_day on public.activity_days (workspace_id, day desc);

alter table public.activity_days enable row level security;

drop policy if exists "admin read days" on public.activity_days;
create policy "admin read days" on public.activity_days for select to authenticated
  using (workspace_id in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and role = 'admin'
  ));


-- ── Roll up a day's pings into the summary table ────────────────────────────
-- Each ping represents up to 30 seconds of activity (0.5 min). We cap a day at
-- 16h so a stuck tab can never report an absurd number.
create or replace function public.rollup_activity(p_day date default (current_date - 1))
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_days (workspace_id, user_id, day, active_minutes, first_seen, last_seen, by_section)
  select
    p.workspace_id,
    p.user_id,
    p_day,
    least(960, round(count(*) * 0.5)::int),                   -- 30s per ping, capped at 16h
    min(p.at),
    max(p.at),
    coalesce(
      (select jsonb_object_agg(s.section, s.mins)
         from (
           select section, least(960, round(count(*) * 0.5)::int) as mins
             from public.activity_pings q
            where q.workspace_id = p.workspace_id
              and q.user_id = p.user_id
              and q.at >= p_day::timestamptz
              and q.at <  (p_day + 1)::timestamptz
            group by section
         ) s),
      '{}'::jsonb)
  from public.activity_pings p
  where p.at >= p_day::timestamptz
    and p.at <  (p_day + 1)::timestamptz
  group by p.workspace_id, p.user_id
  on conflict (workspace_id, user_id, day) do update
    set active_minutes = excluded.active_minutes,
        first_seen     = excluded.first_seen,
        last_seen      = excluded.last_seen,
        by_section     = excluded.by_section;

  -- Raw pings for that day have served their purpose.
  delete from public.activity_pings
   where at >= p_day::timestamptz and at < (p_day + 1)::timestamptz;

  -- Keep 90 days of history, no more.
  delete from public.activity_days where day < (current_date - 90);
end;
$$;


-- ── Live "today" view (reads raw pings, since today isn't rolled up yet) ────
create or replace function public.activity_today(p_workspace_id uuid)
returns table (
  user_id        uuid,
  active_minutes int,
  first_seen     timestamptz,
  last_seen      timestamptz,
  by_section     jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    p.user_id,
    least(960, round(count(*) * 0.5)::int) as active_minutes,
    min(p.at) as first_seen,
    max(p.at) as last_seen,
    coalesce(
      (select jsonb_object_agg(s.section, s.mins)
         from (
           select section, least(960, round(count(*) * 0.5)::int) as mins
             from public.activity_pings q
            where q.workspace_id = p.workspace_id
              and q.user_id = p.user_id
              and q.at >= current_date::timestamptz
            group by section
         ) s),
      '{}'::jsonb) as by_section
  from public.activity_pings p
  where p.workspace_id = p_workspace_id
    and p.at >= current_date::timestamptz
    -- caller must be an admin of this workspace
    and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id
         and m.user_id = auth.uid()
         and m.role = 'admin'
    )
  group by p.workspace_id, p.user_id;
$$;

grant execute on function public.activity_today(uuid) to authenticated;
grant execute on function public.rollup_activity(date) to authenticated;


-- ── Catch-up rollup ─────────────────────────────────────────────────────────
-- Rolls up EVERY past day that still has raw pings. The admin dashboard calls
-- this when it loads, so the system maintains itself with no cron job to set
-- up: even if nobody looks for a week, the next visit tidies everything.
create or replace function public.rollup_pending()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  d date;
  n int := 0;
begin
  for d in
    select distinct (at at time zone 'UTC')::date as day
      from public.activity_pings
     where at < current_date::timestamptz
     order by 1
  loop
    perform public.rollup_activity(d);
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.rollup_pending() to authenticated;
