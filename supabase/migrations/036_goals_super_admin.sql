-- ============================================================================
-- 036: SUPER ADMIN VISIBILITY + MONDAY SUMMARY
--
-- WHAT WAS WRONG
--   Migration 035 let ANY workspace admin read everyone's goals and tasks.
--   That is too wide. Only the super admin should see across people; everyone
--   else — including other admins — sees strictly their own.
--
-- WHAT THIS DOES
--   1. Adds a super-admin list, seeded with shailenpathak@gmail.com. It is a
--      table rather than a hard-coded string so the address can change, or a
--      second person be added, without another migration.
--   2. Rewrites the RLS policies to use it.
--   3. Adds goal_week_oneliners(), which produces the one-line-per-person
--      summary read out in the Monday review meeting.
--
-- Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHO IS A SUPER ADMIN
-- ---------------------------------------------------------------------------
create table if not exists public.goal_super_admins (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

insert into public.goal_super_admins (email, note)
values ('shailenpathak@gmail.com', 'Founder — sees every person''s goals, tasks and reviews')
on conflict (email) do nothing;

alter table public.goal_super_admins enable row level security;

-- Everyone may READ the list (the app needs to know whether the current user
-- is on it), but nobody can modify it from the client.
drop policy if exists "read super admins" on public.goal_super_admins;
create policy "read super admins" on public.goal_super_admins
  for select to authenticated using (true);

-- Matching is on the signed-in user's email, case-insensitively, because
-- addresses get typed with different capitalisation.
create or replace function public.is_goal_super_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1
      from auth.users u
      join public.goal_super_admins s
        on lower(u.email) = lower(s.email)
     where u.id = auth.uid()
  );
$$;

grant execute on function public.is_goal_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS — own rows only, unless you are the super admin.
--    Replaces the "or is_ws_admin(...)" rules from migration 035.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['goal_areas','goals','goal_tasks','goal_reviews'] loop
    execute format('drop policy if exists "read own or admin" on public.%I', t);
    execute format('drop policy if exists "write own or admin" on public.%I', t);
    execute format('drop policy if exists "read own or super" on public.%I', t);
    execute format('drop policy if exists "write own or super" on public.%I', t);

    execute format($f$
      create policy "read own or super" on public.%I for select to authenticated
      using (
        workspace_id in (select user_workspaces())
        and (user_id = auth.uid() or public.is_goal_super_admin())
      )$f$, t);

    execute format($f$
      create policy "write own or super" on public.%I for all to authenticated
      using (
        workspace_id in (select user_workspaces())
        and (user_id = auth.uid() or public.is_goal_super_admin())
      )
      with check (
        workspace_id in (select user_workspaces())
        and (user_id = auth.uid() or public.is_goal_super_admin())
      )$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The week summary must respect the same rule. A member calling it should
--    get only their own row, not the whole team's numbers.
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
  visible as (
    select wm.user_id
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id
       and coalesce(wm.status,'active') = 'active'
       and (public.is_goal_super_admin() or wm.user_id = auth.uid())
  ),
  t as (
    select gt.user_id,
           count(*)                                            as planned,
           count(*) filter (where gt.done)                     as done,
           count(*) filter (where gt.rolled_from is not null)  as carried
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
  )
  select v.user_id,
         coalesce(t.planned, 0),
         coalesce(t.done, 0),
         coalesce(t.carried, 0),
         coalesce((select value from m where m.user_id = v.user_id and m.metric_key = 'revenue'), 0),
         coalesce((select value from m where m.user_id = v.user_id and m.metric_key = 'calls'), 0)::bigint,
         coalesce((select value from m where m.user_id = v.user_id and m.metric_key = 'connects'), 0)::bigint,
         coalesce((select value from m where m.user_id = v.user_id and m.metric_key = 'interested'), 0)::bigint,
         coalesce((select value from m where m.user_id = v.user_id and m.metric_key = 'hot_conv'), 0)::bigint,
         coalesce(r.submitted, false)
    from visible v
    left join t on t.user_id = v.user_id
    left join r on r.user_id = v.user_id;
$$;

grant execute on function public.goal_week_summary(uuid, date) to authenticated;

-- goal_metrics is called directly by the app for monthly KPI values, so it
-- needs the same restriction.
create or replace function public.goal_metrics(
  p_workspace_id uuid,
  p_from date,
  p_to   date
) returns table (user_id uuid, metric_key text, value numeric)
language sql stable security definer set search_path = public as $$
  with raw as (
    select l.owner_id as uid, 'revenue' as k, coalesce(sum(p.amount), 0) as v
      from public.payments p join public.leads l on l.id = p.lead_id
     where p.workspace_id = p_workspace_id and p.status = 'paid'
       and coalesce(p.paid_at::date, p.created_at::date) between p_from and p_to
       and l.owner_id is not null
     group by l.owner_id
    union all
    select l.owner_id, 'invoiced', coalesce(sum(p.amount), 0)
      from public.payments p join public.leads l on l.id = p.lead_id
     where p.workspace_id = p_workspace_id
       and p.created_at::date between p_from and p_to
       and l.owner_id is not null
     group by l.owner_id
    union all
    select l.owner_id, 'hot_conv', count(*)::numeric
      from public.leads l
     where l.workspace_id = p_workspace_id and l.stage in ('invoice_sent','won')
       and l.updated_at::date between p_from and p_to and l.owner_id is not null
     group by l.owner_id
    union all
    select l.owner_id, 'new_hot', count(*)::numeric
      from public.leads l
     where l.workspace_id = p_workspace_id and l.stage = 'hot'
       and l.updated_at::date between p_from and p_to and l.owner_id is not null
     group by l.owner_id
    union all
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
    select t.user_id, 'task_rate',
           round(100.0 * count(*) filter (where t.done) / nullif(count(*), 0), 0)
      from public.goal_tasks t
     where t.workspace_id = p_workspace_id and t.task_date between p_from and p_to
     group by t.user_id
  )
  select raw.uid, raw.k, raw.v
    from raw
   where public.is_goal_super_admin() or raw.uid = auth.uid();
$$;

grant execute on function public.goal_metrics(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. MONDAY SUMMARY — one line per person, plus the team totals.
--
--    Written for the review meeting: every person reduced to a single
--    readable sentence built from real numbers, so the meeting starts from
--    facts rather than from everyone recalling their own week.
-- ---------------------------------------------------------------------------
create or replace function public.goal_week_oneliners(
  p_workspace_id uuid,
  p_week_start   date
) returns table (
  user_id     uuid,
  headline    text,
  detail      text,
  score       int,
  submitted   boolean,
  wins        text,
  blockers    text,
  next_focus  text
)
language sql stable security definer set search_path = public as $$
  with s as (
    select * from public.goal_week_summary(p_workspace_id, p_week_start)
  ),
  r as (
    select gr.user_id, gr.wins, gr.blockers, gr.next_focus
      from public.goal_reviews gr
     where gr.workspace_id = p_workspace_id and gr.week_start = p_week_start
  )
  select s.user_id,
         -- headline: the one line read out in the meeting
         concat_ws(' · ',
           case when s.tasks_planned > 0
                then s.tasks_done || '/' || s.tasks_planned || ' tasks ('
                     || round(100.0 * s.tasks_done / s.tasks_planned)::int || '%)'
                else 'no tasks planned' end,
           nullif(case when s.revenue > 0 then '£' || round(s.revenue)::text || ' booked' else '' end, ''),
           nullif(case when s.hot_conv  > 0 then s.hot_conv  || ' converted' else '' end, ''),
           nullif(case when s.calls     > 0 then s.calls     || ' calls' else '' end, ''),
           nullif(case when s.interested> 0 then s.interested|| ' interested' else '' end, '')
         ),
         -- detail: the caveats worth saying out loud
         nullif(concat_ws(' · ',
           nullif(case when s.tasks_carried > 0 then s.tasks_carried || ' carried over' else '' end, ''),
           nullif(case when s.connects > 0 and s.calls > 0
                       then round(100.0 * s.connects / s.calls)::int || '% connect rate' else '' end, ''),
           case when not s.review_submitted then 'review not submitted' else '' end
         ), ''),
         case when s.tasks_planned > 0
              then round(100.0 * s.tasks_done / s.tasks_planned)::int else 0 end,
         s.review_submitted,
         r.wins, r.blockers, r.next_focus
    from s left join r on r.user_id = s.user_id;
$$;

grant execute on function public.goal_week_oneliners(uuid, date) to authenticated;

select 'super admin + summary ready' as status,
       (select count(*) from public.goal_super_admins) as super_admins;
