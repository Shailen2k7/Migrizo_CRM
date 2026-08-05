-- ============================================================================
-- 035: GOALS, TASKS & WEEKLY REVIEWS
--
-- Three levels, deliberately:
--
--   ANNUAL   the destination for the year
--   MONTHLY  the number that says whether you are on track
--   DAILY    the tasks you actually do
--
-- Plus a weekly review, written every Monday, which is what gets read out in
-- the team meeting.
--
-- ACCESS MODEL
--   Every member sees and manages their OWN goals, tasks and reviews.
--   Admins (Shailen) see everyone's, and can set goals and assign tasks to
--   anyone. This is enforced in the database by RLS, not just hidden in the UI,
--   so a member cannot read a colleague's data even by calling the API directly.
--
-- Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Defensive: workspace_members.status is added by migration 002 in this
--    project, but adding it here means the file also runs on a stale schema
--    rather than failing halfway through.
-- ---------------------------------------------------------------------------
alter table public.workspace_members add column if not exists status text default 'active';

-- ---------------------------------------------------------------------------
-- 1. KEY RESULT AREAS — the standing areas a person owns.
-- ---------------------------------------------------------------------------
create table if not exists public.goal_areas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists goal_areas_ws_user on public.goal_areas(workspace_id, user_id);

-- ---------------------------------------------------------------------------
-- 2. GOALS — annual objectives and monthly KPIs live in one table, separated
--    by `horizon`, because they share every other column and reporting wants
--    them together.
--
--    source = 'auto'   the number is computed from CRM data (metric_key says
--                      which), so nobody types it and nobody can inflate it.
--    source = 'manual'  someone updates current_value by hand.
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  area_id       uuid references public.goal_areas(id) on delete set null,
  horizon       text not null check (horizon in ('annual','monthly')),
  title         text not null,
  why           text,
  source        text not null default 'manual' check (source in ('auto','manual')),
  metric_key    text,                      -- only meaningful when source='auto'
  target_value  numeric not null default 0,
  current_value numeric not null default 0, -- manual entry; ignored for auto
  unit          text not null default '',   -- '', 'gbp', 'pct', 'hrs'
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'active' check (status in ('active','done','dropped')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists goals_ws_user     on public.goals(workspace_id, user_id);
create index if not exists goals_period      on public.goals(workspace_id, period_start, period_end);
create index if not exists goals_horizon     on public.goals(workspace_id, horizon, status);

-- ---------------------------------------------------------------------------
-- 3. TASKS — one row per person per day per task.
--    `rolled_from` records the original date when an unfinished task is
--    carried forward, so "carried over" is a fact rather than a guess.
-- ---------------------------------------------------------------------------
create table if not exists public.goal_tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  goal_id      uuid references public.goals(id) on delete set null,
  area_id      uuid references public.goal_areas(id) on delete set null,
  title        text not null,
  task_date    date not null,
  done         boolean not null default false,
  done_at      timestamptz,
  rolled_from  date,
  note         text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists goal_tasks_ws_user_date on public.goal_tasks(workspace_id, user_id, task_date);
create index if not exists goal_tasks_date         on public.goal_tasks(workspace_id, task_date);

-- Keep done_at honest without the app having to remember.
create or replace function public.goal_tasks_touch() returns trigger
language plpgsql as $$
begin
  if new.done and not coalesce(old.done, false) then new.done_at := now();
  elsif not new.done then new.done_at := null;
  end if;
  return new;
end $$;
drop trigger if exists goal_tasks_touch_trg on public.goal_tasks;
create trigger goal_tasks_touch_trg before update on public.goal_tasks
  for each row execute function public.goal_tasks_touch();

-- ---------------------------------------------------------------------------
-- 4. WEEKLY REVIEWS — one per person per week, keyed on the Monday.
-- ---------------------------------------------------------------------------
create table if not exists public.goal_reviews (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  week_start    date not null,
  wins          text,
  blockers      text,
  next_focus    text,
  manager_note  text,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, user_id, week_start)
);
create index if not exists goal_reviews_week on public.goal_reviews(workspace_id, week_start);

-- ---------------------------------------------------------------------------
-- 5. RLS — own rows for members, everything for admins.
-- ---------------------------------------------------------------------------
alter table public.goal_areas   enable row level security;
alter table public.goals        enable row level security;
alter table public.goal_tasks   enable row level security;
alter table public.goal_reviews enable row level security;

create or replace function public.is_ws_admin(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.user_id = auth.uid()
       and m.role = 'admin'
       and coalesce(m.status, 'active') = 'active'
  );
$$;

do $$
declare t text;
begin
  foreach t in array array['goal_areas','goals','goal_tasks','goal_reviews'] loop
    execute format('drop policy if exists "read own or admin" on public.%I', t);
    execute format($f$
      create policy "read own or admin" on public.%I for select to authenticated
      using (
        workspace_id in (select user_workspaces())
        and (user_id = auth.uid() or public.is_ws_admin(workspace_id))
      )$f$, t);

    execute format('drop policy if exists "write own or admin" on public.%I', t);
    execute format($f$
      create policy "write own or admin" on public.%I for all to authenticated
      using (
        workspace_id in (select user_workspaces())
        and (user_id = auth.uid() or public.is_ws_admin(workspace_id))
      )
      with check (
        workspace_id in (select user_workspaces())
        and (user_id = auth.uid() or public.is_ws_admin(workspace_id))
      )$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. AUTO METRICS — the whole point of the tracker.
--
--    Numbers a goal can bind to are computed here from data the CRM already
--    holds, so an AUTO goal is always current and can never be massaged.
--    Returns one row per (user_id, metric_key, value) for a date window.
-- ---------------------------------------------------------------------------
create or replace function public.goal_metrics(
  p_workspace_id uuid,
  p_from date,
  p_to   date
) returns table (user_id uuid, metric_key text, value numeric)
language sql stable security definer set search_path = public as $$
  -- Revenue actually collected, credited to the lead owner.
  select l.owner_id, 'revenue', coalesce(sum(p.amount), 0)
    from public.payments p join public.leads l on l.id = p.lead_id
   where p.workspace_id = p_workspace_id and p.status = 'paid'
     and coalesce(p.paid_at::date, p.created_at::date) between p_from and p_to
     and l.owner_id is not null
   group by l.owner_id

  union all
  -- Everything invoiced, whether or not it has landed yet.
  select l.owner_id, 'invoiced', coalesce(sum(p.amount), 0)
    from public.payments p join public.leads l on l.id = p.lead_id
   where p.workspace_id = p_workspace_id
     and p.created_at::date between p_from and p_to
     and l.owner_id is not null
   group by l.owner_id

  union all
  -- Leads that reached a paying stage in the window.
  select l.owner_id, 'hot_conv', count(*)::numeric
    from public.leads l
   where l.workspace_id = p_workspace_id
     and l.stage in ('invoice_sent','won')
     and l.updated_at::date between p_from and p_to
     and l.owner_id is not null
   group by l.owner_id

  union all
  select l.owner_id, 'new_hot', count(*)::numeric
    from public.leads l
   where l.workspace_id = p_workspace_id and l.stage = 'hot'
     and l.updated_at::date between p_from and p_to
     and l.owner_id is not null
   group by l.owner_id

  union all
  -- Calling activity, straight from the queue.
  select q.user_id, 'calls', count(*)::numeric
    from public.lead_queue q
   where q.workspace_id = p_workspace_id and q.status = 'done'
     and q.day between p_from and p_to
   group by q.user_id

  union all
  select q.user_id, 'connects', count(*)::numeric
    from public.lead_queue q
   where q.workspace_id = p_workspace_id and q.status = 'done'
     and q.outcome is not null and q.outcome <> 'no_answer'
     and q.day between p_from and p_to
   group by q.user_id

  union all
  select q.user_id, 'interested', count(*)::numeric
    from public.lead_queue q
   where q.workspace_id = p_workspace_id
     and q.outcome in ('interested_hot','interested_cold')
     and q.day between p_from and p_to
   group by q.user_id

  union all
  -- Task completion rate, as a percentage, from this tracker itself.
  select t.user_id, 'task_rate',
         round(100.0 * count(*) filter (where t.done) / nullif(count(*), 0), 0)
    from public.goal_tasks t
   where t.workspace_id = p_workspace_id and t.task_date between p_from and p_to
   group by t.user_id;
$$;

grant execute on function public.goal_metrics(uuid, date, date) to authenticated;
grant execute on function public.is_ws_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. WEEK SUMMARY — what actually happened, for the Monday meeting.
--    This is the "clear and accurate picture" the review is built on: it is
--    computed, not typed, so it cannot drift from reality.
-- ---------------------------------------------------------------------------
create or replace function public.goal_week_summary(
  p_workspace_id uuid,
  p_week_start   date
) returns table (
  user_id            uuid,
  tasks_planned      bigint,
  tasks_done         bigint,
  tasks_carried      bigint,
  revenue            numeric,
  calls              bigint,
  connects           bigint,
  interested         bigint,
  hot_conv           bigint,
  review_submitted   boolean
)
language sql stable security definer set search_path = public as $$
  with wk as (select p_week_start as s, p_week_start + 6 as e),
  t as (
    select gt.user_id,
           count(*)                                   as planned,
           count(*) filter (where gt.done)            as done,
           count(*) filter (where gt.rolled_from is not null) as carried
      from public.goal_tasks gt, wk
     where gt.workspace_id = p_workspace_id and gt.task_date between wk.s and wk.e
     group by gt.user_id
  ),
  m as (
    select gm.user_id, gm.metric_key, gm.value
      from wk, public.goal_metrics(p_workspace_id, wk.s, wk.e) gm
  ),
  r as (
    select gr.user_id, gr.submitted_at is not null as submitted
      from public.goal_reviews gr
     where gr.workspace_id = p_workspace_id and gr.week_start = p_week_start
  ),
  people as (
    select wm.user_id from public.workspace_members wm
     where wm.workspace_id = p_workspace_id and coalesce(wm.status,'active') = 'active'
  )
  select p.user_id,
         coalesce(t.planned, 0),
         coalesce(t.done, 0),
         coalesce(t.carried, 0),
         coalesce((select value from m where m.user_id = p.user_id and m.metric_key = 'revenue'), 0),
         coalesce((select value from m where m.user_id = p.user_id and m.metric_key = 'calls'), 0)::bigint,
         coalesce((select value from m where m.user_id = p.user_id and m.metric_key = 'connects'), 0)::bigint,
         coalesce((select value from m where m.user_id = p.user_id and m.metric_key = 'interested'), 0)::bigint,
         coalesce((select value from m where m.user_id = p.user_id and m.metric_key = 'hot_conv'), 0)::bigint,
         coalesce(r.submitted, false)
    from people p
    left join t on t.user_id = p.user_id
    left join r on r.user_id = p.user_id;
$$;

grant execute on function public.goal_week_summary(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. ROLL OVER UNFINISHED TASKS to the next working day. Called by the app,
--    or schedule it if pg_cron is available.
-- ---------------------------------------------------------------------------
create or replace function public.goal_tasks_rollover(
  p_workspace_id uuid,
  p_from date,
  p_to   date
) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.goal_tasks (workspace_id, user_id, goal_id, area_id, title, task_date, rolled_from, created_by)
  select t.workspace_id, t.user_id, t.goal_id, t.area_id, t.title, p_to,
         coalesce(t.rolled_from, t.task_date), t.created_by
    from public.goal_tasks t
   where t.workspace_id = p_workspace_id
     and t.task_date = p_from
     and not t.done
     -- never duplicate a task already moved forward
     and not exists (
       select 1 from public.goal_tasks x
        where x.workspace_id = t.workspace_id and x.user_id = t.user_id
          and x.task_date = p_to and x.title = t.title
     );
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.goal_tasks_rollover(uuid, date, date) to authenticated;

select 'goals tracker ready' as status;
