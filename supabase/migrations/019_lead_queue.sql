-- ============================================================================
-- 019: DAILY LEAD ENGINE
--
-- Fixes the root problem: leads had no owner, so nobody chased them.
--
--   • Leads gain an owner, a "last touched" stamp, an attempt counter and a
--     snooze date.
--   • Each morning the system hands every rep a fresh queue, drawn from the
--     cold pool OLDEST-UNTOUCHED FIRST. That guarantees full coverage — with
--     160 leads a day against ~1,000 cold, every lead is touched every ~6 days.
--   • A lead assigned today is locked to that person for the day, so two reps
--     can never call the same person.
--   • Unfinished work rolls over: yesterday's untouched assignments come back
--     at the top of today's queue.
-- ============================================================================

-- ── 1. Lead ownership + staleness ───────────────────────────────────────────
alter table public.leads add column if not exists owner_id       uuid references auth.users(id) on delete set null;
alter table public.leads add column if not exists last_touched_at timestamptz;
alter table public.leads add column if not exists attempt_count   int not null default 0;
alter table public.leads add column if not exists snooze_until    timestamptz;
alter table public.leads add column if not exists retired_at      timestamptz;
alter table public.leads add column if not exists ai_score        int;
alter table public.leads add column if not exists ai_brief        text;
alter table public.leads add column if not exists ai_scored_at    timestamptz;

-- The queue generator's main sort. Partial index keeps it small and fast.
create index if not exists idx_leads_pool
  on public.leads (workspace_id, last_touched_at nulls first)
  where retired_at is null;

create index if not exists idx_leads_owner on public.leads (workspace_id, owner_id);

-- Existing leads have never been touched → last_touched_at stays NULL, which
-- sorts FIRST. The oldest, most-neglected leads get picked up first. Exactly
-- the behaviour we want on day one.


-- ── 2. Per-person rules (admin sets these) ──────────────────────────────────
create table if not exists public.lead_queue_rules (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null,
  cold_per_day  int  not null default 0,     -- how many cold leads each morning
  takes_hot     boolean not null default false, -- also owns hot leads?
  rollover      boolean not null default true,  -- carry unfinished work forward
  active        boolean not null default true,
  updated_at    timestamptz default now(),
  primary key (workspace_id, user_id)
);

alter table public.lead_queue_rules enable row level security;

drop policy if exists "read rules" on public.lead_queue_rules;
create policy "read rules" on public.lead_queue_rules for select to authenticated
  using (workspace_id in (select user_workspaces()));

drop policy if exists "admin write rules" on public.lead_queue_rules;
create policy "admin write rules" on public.lead_queue_rules for all to authenticated
  using (workspace_id in (
    select workspace_id from public.workspace_members
     where user_id = auth.uid() and role = 'admin'))
  with check (workspace_id in (
    select workspace_id from public.workspace_members
     where user_id = auth.uid() and role = 'admin'));


-- ── 3. The daily queue ──────────────────────────────────────────────────────
create table if not exists public.lead_queue (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null,
  lead_id      uuid not null references public.leads(id) on delete cascade,
  day          date not null default current_date,
  status       text not null default 'pending'
               check (status in ('pending','done')),
  outcome      text check (outcome in ('interested','not_now','no_answer','dead')),
  note         text,
  rolled_over  boolean not null default false,
  created_at   timestamptz default now(),
  completed_at timestamptz,
  unique (lead_id, day)          -- a lead can only be served to ONE person per day
);

create index if not exists idx_queue_user_day on public.lead_queue (workspace_id, user_id, day, status);

alter table public.lead_queue enable row level security;

-- Reps see their own queue; admins see everyone's.
drop policy if exists "read own queue" on public.lead_queue;
create policy "read own queue" on public.lead_queue for select to authenticated
  using (
    workspace_id in (select user_workspaces())
    and (user_id = auth.uid() or exists (
      select 1 from public.workspace_members m
       where m.workspace_id = lead_queue.workspace_id
         and m.user_id = auth.uid() and m.role = 'admin'))
  );

drop policy if exists "write own queue" on public.lead_queue;
create policy "write own queue" on public.lead_queue for update to authenticated
  using (workspace_id in (select user_workspaces()) and user_id = auth.uid());

drop policy if exists "insert queue" on public.lead_queue;
create policy "insert queue" on public.lead_queue for insert to authenticated
  with check (workspace_id in (select user_workspaces()));


-- ── 4. Hot vs cold, in one place ────────────────────────────────────────────
-- HOT  = actively moving (qualified, consultation, proposal, partial)
-- COLD = new / attempted / connected AND untouched for 14+ days
-- Neither = won, lost, retired, sleeping.
create or replace function public.lead_is_hot(p_stage text)
returns boolean language sql immutable as $$
  select p_stage in ('qualified','consultation','proposal','partial');
$$;


-- ── 5. The morning generator ────────────────────────────────────────────────
-- Idempotent: safe to call many times a day. Returns rows created.
create or replace function public.generate_daily_queue(p_workspace_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_needed   int;
  v_rolled   int;
  v_created  int := 0;
  v_lead     record;
begin
  -- Every active rep with a cold quota.
  for r in
    select user_id, cold_per_day, rollover
      from public.lead_queue_rules
     where workspace_id = p_workspace_id and active and cold_per_day > 0
  loop
    -- Already generated for this person today? Skip.
    if exists (select 1 from public.lead_queue
                where workspace_id = p_workspace_id and user_id = r.user_id and day = current_date) then
      continue;
    end if;

    v_rolled := 0;

    -- (a) ROLLOVER — yesterday's unfinished work comes back first.
    if r.rollover then
      insert into public.lead_queue (workspace_id, user_id, lead_id, day, rolled_over)
      select q.workspace_id, q.user_id, q.lead_id, current_date, true
        from public.lead_queue q
        join public.leads l on l.id = q.lead_id
       where q.workspace_id = p_workspace_id
         and q.user_id = r.user_id
         and q.day < current_date
         and q.status = 'pending'
         and l.retired_at is null
         and (l.snooze_until is null or l.snooze_until <= now())
       order by q.day asc
       limit r.cold_per_day
      on conflict (lead_id, day) do nothing;

      get diagnostics v_rolled = row_count;

      -- Those old rows have been carried forward; close them off.
      update public.lead_queue
         set status = 'done', outcome = 'no_answer'
       where workspace_id = p_workspace_id and user_id = r.user_id
         and day < current_date and status = 'pending';
    end if;

    -- (b) TOP UP from the cold pool, oldest-untouched first.
    v_needed := greatest(0, r.cold_per_day - v_rolled);

    if v_needed > 0 then
      for v_lead in
        select l.id
          from public.leads l
         where l.workspace_id = p_workspace_id
           and l.retired_at is null
           and l.is_sample is not true
           and not public.lead_is_hot(l.stage)
           and l.stage not in ('won','lost')
           and (l.snooze_until is null or l.snooze_until <= now())
           and (l.last_touched_at is null or l.last_touched_at < now() - interval '14 days')
           -- not already served to anyone today (the daily lock)
           and not exists (select 1 from public.lead_queue q
                            where q.lead_id = l.id and q.day = current_date)
         order by l.last_touched_at asc nulls first, l.created_at asc
         limit v_needed
      loop
        insert into public.lead_queue (workspace_id, user_id, lead_id, day)
        values (p_workspace_id, r.user_id, v_lead.id, current_date)
        on conflict (lead_id, day) do nothing;
        v_created := v_created + 1;
      end loop;
    end if;

    v_created := v_created + v_rolled;
  end loop;

  return v_created;
end;
$$;

grant execute on function public.generate_daily_queue(uuid) to authenticated;
grant execute on function public.lead_is_hot(text) to authenticated;


-- ── 6. Pool health (admin dashboard) ────────────────────────────────────────
create or replace function public.lead_pool_health(p_workspace_id uuid)
returns table (
  cold_total     int,
  fresh_7d       int,
  aging_14d      int,
  stale_over_14d int,
  sleeping       int,
  oldest_days    int,
  retired        int,
  daily_capacity int
)
language sql
security definer
set search_path = public
as $$
  with pool as (
    select l.*,
           coalesce(extract(day from now() - l.last_touched_at)::int, 999) as age_days
      from public.leads l
     where l.workspace_id = p_workspace_id
       and l.is_sample is not true
       and not public.lead_is_hot(l.stage)
       and l.stage not in ('won','lost')
  )
  select
    count(*) filter (where retired_at is null)::int,
    count(*) filter (where retired_at is null and age_days < 7)::int,
    count(*) filter (where retired_at is null and age_days >= 7 and age_days <= 14)::int,
    count(*) filter (where retired_at is null and age_days > 14 and (snooze_until is null or snooze_until <= now()))::int,
    count(*) filter (where retired_at is null and snooze_until > now())::int,
    coalesce(max(age_days) filter (where retired_at is null and age_days < 999), 0)::int,
    count(*) filter (where retired_at is not null)::int,
    coalesce((select sum(cold_per_day)::int from public.lead_queue_rules
               where workspace_id = p_workspace_id and active), 0)
  from pool;
$$;

grant execute on function public.lead_pool_health(uuid) to authenticated;
