-- ============================================================================
-- 024: MANUAL ASSIGNMENT AND CLEAN WITHDRAWAL
--
-- Two things the super admin needs:
--
--   1. Top up someone's queue by hand. Sandra clears her 100 by 3pm, you give
--      her another 30. Takes the next oldest-untouched leads, skips anything
--      already assigned to anyone today.
--
--   2. Take leads back, leaving no trace. Used for testing, or when someone is
--      off sick and their queue should go to someone else.
--
-- The trick that makes withdrawal exact: a trigger snapshots each lead's state
-- the moment it is assigned — by ANY route, nightly or manual. Returning a
-- worked lead restores that snapshot, so the pool is genuinely untouched
-- rather than approximately so. No test mode to switch on, nothing to forget.
-- ============================================================================

-- ── Snapshot columns ────────────────────────────────────────────────────────
alter table public.lead_queue add column if not exists snap_stage        text;
alter table public.lead_queue add column if not exists snap_last_touched timestamptz;
alter table public.lead_queue add column if not exists snap_attempts     int;
alter table public.lead_queue add column if not exists snap_snooze       timestamptz;
alter table public.lead_queue add column if not exists assigned_manually boolean not null default false;

-- ── Snapshot on every assignment, whatever created it ───────────────────────
create or replace function public.lead_queue_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select l.stage, l.last_touched_at, l.attempt_count, l.snooze_until
    into new.snap_stage, new.snap_last_touched, new.snap_attempts, new.snap_snooze
    from public.leads l
   where l.id = new.lead_id;
  return new;
end;
$$;

drop trigger if exists trg_lead_queue_snapshot on public.lead_queue;
create trigger trg_lead_queue_snapshot
  before insert on public.lead_queue
  for each row execute function public.lead_queue_snapshot();


-- ── Assign N more leads to one person, right now ────────────────────────────
create or replace function public.assign_leads_manual(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_count        int
)
returns table (assigned int, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead  record;
  v_made  int := 0;
  v_today date := public.crm_today();
begin
  if p_count is null or p_count < 1 then
    assigned := 0; reason := 'bad_count'; return next; return;
  end if;

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
       -- the daily lock: never hand the same lead to two people on one day
       and not exists (select 1 from public.lead_queue q
                        where q.lead_id = l.id and q.day = v_today)
     order by l.last_touched_at asc nulls first, l.created_at asc
     limit p_count
  loop
    insert into public.lead_queue (workspace_id, user_id, lead_id, day, assigned_manually)
    values (p_workspace_id, p_user_id, v_lead.id, v_today, true)
    on conflict (lead_id, day) do nothing;
    v_made := v_made + 1;
  end loop;

  assigned := v_made;
  reason := case when v_made = 0 then 'none_available'
                 when v_made < p_count then 'partial'
                 else 'ok' end;
  return next;
end;
$$;
grant execute on function public.assign_leads_manual(uuid, uuid, int) to authenticated;


-- ── Give leads back to the pool ─────────────────────────────────────────────
-- p_include_worked = false : only untouched assignments are released. Safe,
--   because nothing about those leads ever changed.
-- p_include_worked = true  : also rewinds leads that were worked, restoring
--   the exact state captured when they were assigned. This is what makes a
--   test account leave no trace.
create or replace function public.return_queue(
  p_workspace_id   uuid,
  p_user_id        uuid,
  p_include_worked boolean default false,
  p_day            date default null
)
returns table (released int, rewound int)
language plpgsql
security definer
set search_path = public
as $$
declare
  q       record;
  v_rel   int := 0;
  v_rew   int := 0;
  v_day   date := coalesce(p_day, public.crm_today());
begin
  for q in
    select * from public.lead_queue
     where workspace_id = p_workspace_id
       and user_id = p_user_id
       and day = v_day
       and (p_include_worked or status = 'pending')
  loop
    if q.status = 'done' then
      -- Put the lead back exactly as it was before this assignment.
      update public.leads
         set stage           = coalesce(q.snap_stage, stage),
             last_touched_at = q.snap_last_touched,
             attempt_count   = coalesce(q.snap_attempts, 0),
             snooze_until    = q.snap_snooze,
             retired_at      = null
       where id = q.lead_id;
      v_rew := v_rew + 1;
    else
      v_rel := v_rel + 1;
    end if;

    delete from public.lead_queue where id = q.id;
  end loop;

  released := v_rel;
  rewound  := v_rew;
  return next;
end;
$$;
grant execute on function public.return_queue(uuid, uuid, boolean, date) to authenticated;


-- ── Who has what today ──────────────────────────────────────────────────────
create or replace function public.queue_today_by_person(p_workspace_id uuid)
returns table (
  user_id   uuid,
  total     int,
  pending   int,
  done      int,
  manual    int
)
language sql
stable
security definer
set search_path = public
as $$
  select q.user_id,
         count(*)::int,
         count(*) filter (where q.status = 'pending')::int,
         count(*) filter (where q.status = 'done')::int,
         count(*) filter (where q.assigned_manually)::int
    from public.lead_queue q
   where q.workspace_id = p_workspace_id
     and q.day = public.crm_today()
   group by q.user_id;
$$;
grant execute on function public.queue_today_by_person(uuid) to authenticated;
