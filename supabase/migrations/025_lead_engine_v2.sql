-- ============================================================================
-- MIGRIZO LEAD ENGINE — COMPLETE SETUP  (v2, corrected stages)
-- Run this ONE file in the Supabase SQL editor. Safe to run repeatedly.
--
-- WHAT WAS WRONG
--   The queue filtered with "not hot and not won/lost", using stage names that
--   do not exist in this CRM. Nothing matched, so JUNK, INVOICE SENT and
--   MR COMING SOON all fell into the cold pool, and hot leads were treated as
--   cold.
--
-- WHAT IT DOES NOW — an explicit whitelist:
--   COLD  ->  stage = 'cold'   worked by the daily queue
--   HOT   ->  stage = 'hot'    owned by whoever takes hot leads
--   Everything else is excluded outright: junk, won, invoice_sent,
--   mr_coming_soon, and anything added in future. A lead must also have a
--   phone or an email, since one that cannot be contacted is not workable.
-- ============================================================================

create or replace function public.crm_today()
returns date language sql stable as $fn$
  select (now() at time zone 'Asia/Kolkata')::date;
$fn$;
grant execute on function public.crm_today() to authenticated;

alter table public.lead_queue alter column day set default public.crm_today();


-- ── The only two stages this system touches ─────────────────────────────────
create or replace function public.lead_is_hot(p_stage text)
returns boolean language sql immutable as $fn$
  select p_stage = 'hot';
$fn$;

create or replace function public.lead_is_cold(p_stage text)
returns boolean language sql immutable as $fn$
  select p_stage = 'cold';
$fn$;

create or replace function public.lead_is_workable(
  p_stage text, p_retired timestamptz, p_sample boolean,
  p_snooze timestamptz, p_phone text, p_email text
)
returns boolean language sql stable as $fn$
  select public.lead_is_cold(p_stage)
     and p_retired is null
     and p_sample is not true
     and (p_snooze is null or p_snooze <= now())
     and (coalesce(p_phone, '') <> '' or coalesce(p_email, '') <> '');
$fn$;

grant execute on function public.lead_is_hot(text) to authenticated;
grant execute on function public.lead_is_cold(text) to authenticated;
grant execute on function public.lead_is_workable(text, timestamptz, boolean, timestamptz, text, text) to authenticated;


-- ── Snapshot columns for clean undo ─────────────────────────────────────────
alter table public.lead_queue add column if not exists snap_stage        text;
alter table public.lead_queue add column if not exists snap_last_touched timestamptz;
alter table public.lead_queue add column if not exists snap_attempts     int;
alter table public.lead_queue add column if not exists snap_snooze       timestamptz;
alter table public.lead_queue add column if not exists assigned_manually boolean not null default false;

create or replace function public.lead_queue_snapshot()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  select l.stage, l.last_touched_at, l.attempt_count, l.snooze_until
    into new.snap_stage, new.snap_last_touched, new.snap_attempts, new.snap_snooze
    from public.leads l where l.id = new.lead_id;
  return new;
end;
$fn$;

drop trigger if exists trg_lead_queue_snapshot on public.lead_queue;
create trigger trg_lead_queue_snapshot
  before insert on public.lead_queue
  for each row execute function public.lead_queue_snapshot();


-- ── Purge anything the old broken filter wrongly assigned ───────────────────
delete from public.lead_queue q
 using public.leads l
 where l.id = q.lead_id
   and q.status = 'pending'
   and not public.lead_is_cold(l.stage);


-- ── Nightly generator ───────────────────────────────────────────────────────
create or replace function public.generate_daily_queue(p_workspace_id uuid)
returns int language plpgsql security definer set search_path = public as $fn$
declare
  r record; v_needed int; v_rolled int; v_created int := 0; v_lead record;
  v_today date := public.crm_today();
begin
  for r in
    select user_id, cold_per_day, rollover from public.lead_queue_rules
     where workspace_id = p_workspace_id and active and cold_per_day > 0
  loop
    if exists (select 1 from public.lead_queue
                where workspace_id = p_workspace_id and user_id = r.user_id and day = v_today) then
      continue;
    end if;

    v_rolled := 0;

    if r.rollover then
      insert into public.lead_queue (workspace_id, user_id, lead_id, day, rolled_over)
      select q.workspace_id, q.user_id, q.lead_id, v_today, true
        from public.lead_queue q join public.leads l on l.id = q.lead_id
       where q.workspace_id = p_workspace_id and q.user_id = r.user_id
         and q.day < v_today and q.status = 'pending'
         and public.lead_is_workable(l.stage, l.retired_at, l.is_sample, l.snooze_until, l.phone, l.email)
       order by q.day asc limit r.cold_per_day
      on conflict (lead_id, day) do nothing;

      get diagnostics v_rolled = row_count;

      update public.lead_queue set status = 'done', outcome = 'no_answer'
       where workspace_id = p_workspace_id and user_id = r.user_id
         and day < v_today and status = 'pending';
    end if;

    v_needed := greatest(0, r.cold_per_day - v_rolled);

    if v_needed > 0 then
      for v_lead in
        select l.id from public.leads l
         where l.workspace_id = p_workspace_id
           and public.lead_is_workable(l.stage, l.retired_at, l.is_sample, l.snooze_until, l.phone, l.email)
           and not exists (select 1 from public.lead_queue q where q.lead_id = l.id and q.day = v_today)
         order by l.last_touched_at asc nulls first, l.created_at asc
         limit v_needed
      loop
        insert into public.lead_queue (workspace_id, user_id, lead_id, day)
        values (p_workspace_id, r.user_id, v_lead.id, v_today)
        on conflict (lead_id, day) do nothing;
        v_created := v_created + 1;
      end loop;
    end if;

    v_created := v_created + v_rolled;
  end loop;
  return v_created;
end;
$fn$;
grant execute on function public.generate_daily_queue(uuid) to authenticated;

create or replace function public.generate_all_queues()
returns int language plpgsql security definer set search_path = public as $fn$
declare w record; total int := 0;
begin
  for w in select distinct workspace_id from public.lead_queue_rules where active and cold_per_day > 0
  loop total := total + coalesce(public.generate_daily_queue(w.workspace_id), 0); end loop;
  return total;
end;
$fn$;
grant execute on function public.generate_all_queues() to authenticated;


-- ── Generation that explains itself ─────────────────────────────────────────
create or replace function public.generate_daily_queue_v2(p_workspace_id uuid)
returns table (created int, reason text)
language plpgsql security definer set search_path = public as $fn$
declare v_active int; v_cold int; v_made int;
begin
  select count(*) into v_active from public.lead_queue_rules
   where workspace_id = p_workspace_id and active and cold_per_day > 0;
  if v_active = 0 then created := 0; reason := 'no_quotas'; return next; return; end if;

  select count(*) into v_cold from public.leads l
   where l.workspace_id = p_workspace_id
     and public.lead_is_workable(l.stage, l.retired_at, l.is_sample, l.snooze_until, l.phone, l.email);
  if v_cold = 0 then created := 0; reason := 'no_cold_leads'; return next; return; end if;

  v_made := public.generate_daily_queue(p_workspace_id);
  created := coalesce(v_made, 0);
  reason := case when created = 0 then 'already_generated' else 'ok' end;
  return next;
end;
$fn$;
grant execute on function public.generate_daily_queue_v2(uuid) to authenticated;

create or replace function public.regenerate_today(p_workspace_id uuid)
returns table (created int, reason text)
language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.lead_queue
   where workspace_id = p_workspace_id and day = public.crm_today() and status = 'pending';
  return query select * from public.generate_daily_queue_v2(p_workspace_id);
end;
$fn$;
grant execute on function public.regenerate_today(uuid) to authenticated;


-- ── Manual top-up and clean withdrawal ──────────────────────────────────────
create or replace function public.assign_leads_manual(p_workspace_id uuid, p_user_id uuid, p_count int)
returns table (assigned int, reason text)
language plpgsql security definer set search_path = public as $fn$
declare v_lead record; v_made int := 0; v_today date := public.crm_today();
begin
  if p_count is null or p_count < 1 then assigned := 0; reason := 'bad_count'; return next; return; end if;
  for v_lead in
    select l.id from public.leads l
     where l.workspace_id = p_workspace_id
       and public.lead_is_workable(l.stage, l.retired_at, l.is_sample, l.snooze_until, l.phone, l.email)
       and not exists (select 1 from public.lead_queue q where q.lead_id = l.id and q.day = v_today)
     order by l.last_touched_at asc nulls first, l.created_at asc
     limit p_count
  loop
    insert into public.lead_queue (workspace_id, user_id, lead_id, day, assigned_manually)
    values (p_workspace_id, p_user_id, v_lead.id, v_today, true)
    on conflict (lead_id, day) do nothing;
    v_made := v_made + 1;
  end loop;
  assigned := v_made;
  reason := case when v_made = 0 then 'none_available' when v_made < p_count then 'partial' else 'ok' end;
  return next;
end;
$fn$;
grant execute on function public.assign_leads_manual(uuid, uuid, int) to authenticated;

create or replace function public.return_queue(
  p_workspace_id uuid, p_user_id uuid, p_include_worked boolean default false, p_day date default null)
returns table (released int, rewound int)
language plpgsql security definer set search_path = public as $fn$
declare q record; v_rel int := 0; v_rew int := 0; v_day date := coalesce(p_day, public.crm_today());
begin
  for q in
    select * from public.lead_queue
     where workspace_id = p_workspace_id and user_id = p_user_id and day = v_day
       and (p_include_worked or status = 'pending')
  loop
    if q.status = 'done' then
      update public.leads
         set stage = coalesce(q.snap_stage, stage), last_touched_at = q.snap_last_touched,
             attempt_count = coalesce(q.snap_attempts, 0), snooze_until = q.snap_snooze, retired_at = null
       where id = q.lead_id;
      v_rew := v_rew + 1;
    else v_rel := v_rel + 1; end if;
    delete from public.lead_queue where id = q.id;
  end loop;
  released := v_rel; rewound := v_rew; return next;
end;
$fn$;
grant execute on function public.return_queue(uuid, uuid, boolean, date) to authenticated;

create or replace function public.queue_today_by_person(p_workspace_id uuid)
returns table (user_id uuid, total int, pending int, done int, manual int)
language sql stable security definer set search_path = public as $fn$
  select q.user_id, count(*)::int,
         count(*) filter (where q.status = 'pending')::int,
         count(*) filter (where q.status = 'done')::int,
         count(*) filter (where q.assigned_manually)::int
    from public.lead_queue q
   where q.workspace_id = p_workspace_id and q.day = public.crm_today()
   group by q.user_id;
$fn$;
grant execute on function public.queue_today_by_person(uuid) to authenticated;


-- ── Pool health, counting ONLY genuine cold leads ───────────────────────────
create or replace function public.lead_pool_health(p_workspace_id uuid)
returns table (cold_total int, fresh_7d int, aging_14d int, stale_over_14d int,
               sleeping int, oldest_days int, retired int, daily_capacity int)
language sql stable security definer set search_path = public as $fn$
  with pool as (
    select l.*, coalesce(extract(day from now() - l.last_touched_at)::int, 999) as age_days
      from public.leads l
     where l.workspace_id = p_workspace_id and l.is_sample is not true
       and public.lead_is_cold(l.stage)
       and (coalesce(l.phone, '') <> '' or coalesce(l.email, '') <> '')
  )
  select count(*) filter (where retired_at is null)::int,
         count(*) filter (where retired_at is null and age_days < 7)::int,
         count(*) filter (where retired_at is null and age_days >= 7 and age_days <= 14)::int,
         count(*) filter (where retired_at is null and age_days > 14 and (snooze_until is null or snooze_until <= now()))::int,
         count(*) filter (where retired_at is null and snooze_until > now())::int,
         coalesce(max(age_days) filter (where retired_at is null and age_days < 999), 0)::int,
         count(*) filter (where retired_at is not null)::int,
         coalesce((select sum(cold_per_day)::int from public.lead_queue_rules
                    where workspace_id = p_workspace_id and active), 0)
  from pool;
$fn$;
grant execute on function public.lead_pool_health(uuid) to authenticated;


-- ── Health check ────────────────────────────────────────────────────────────
create or replace function public.queue_diagnose(p_workspace_id uuid)
returns table (check_name text, status text, detail text)
language plpgsql security definer set search_path = public as $fn$
declare v_active int; v_capacity int; v_cold int; v_today_q int;
        v_cron boolean; v_job boolean; v_total int; v_junk int; v_unreachable int;
begin
  select count(*), coalesce(sum(cold_per_day), 0) into v_active, v_capacity
    from public.lead_queue_rules where workspace_id = p_workspace_id and active and cold_per_day > 0;
  check_name := 'Daily quotas';
  if v_active = 0 then
    status := 'BLOCKED';
    detail := 'Nobody has a daily quota. Set a number in Daily assignment rules and switch Active on.';
  else
    status := 'OK'; detail := v_active || ' people, ' || v_capacity || ' leads per day.';
  end if;
  return next;

  select count(*) into v_total from public.leads where workspace_id = p_workspace_id;
  select count(*) into v_cold from public.leads l
   where l.workspace_id = p_workspace_id
     and public.lead_is_workable(l.stage, l.retired_at, l.is_sample, l.snooze_until, l.phone, l.email);
  select count(*) into v_junk from public.leads where workspace_id = p_workspace_id and stage = 'junk';
  select count(*) into v_unreachable from public.leads
   where workspace_id = p_workspace_id and stage = 'cold'
     and coalesce(phone, '') = '' and coalesce(email, '') = '';

  check_name := 'Cold leads';
  if v_cold = 0 then
    status := 'BLOCKED';
    detail := 'No workable cold leads. Only stage Cold with a phone or email is ever assigned.';
  else
    status := 'OK';
    detail := v_cold || ' workable of ' || v_total || ' total. Excluded: ' || v_junk ||
              ' junk, ' || v_unreachable || ' with no contact details, plus won and invoiced.';
  end if;
  return next;

  select count(*) into v_today_q from public.lead_queue
   where workspace_id = p_workspace_id and day = public.crm_today();
  check_name := 'Today''s queue';
  if v_today_q = 0 then status := 'EMPTY'; detail := 'Nothing assigned yet for ' || public.crm_today() || '.';
  else status := 'OK'; detail := v_today_q || ' assigned for ' || public.crm_today() || '.'; end if;
  return next;

  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_cron;
  v_job := false;
  if v_cron then
    begin execute 'select exists (select 1 from cron.job where jobname = ''migrizo_daily_queues'')' into v_job;
    exception when others then v_job := false; end;
  end if;
  check_name := 'Nightly schedule';
  if not v_cron then status := 'BLOCKED'; detail := 'pg_cron is off. Enable it under Database, Extensions, then run this file again.';
  elsif not v_job then status := 'BLOCKED'; detail := 'The job is missing. Run this file again.';
  else status := 'OK'; detail := 'Runs nightly at 00:01 India time.'; end if;
  return next;
end;
$fn$;
grant execute on function public.queue_diagnose(uuid) to authenticated;


-- ── Nightly schedule ────────────────────────────────────────────────────────
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('migrizo_daily_queues')
      where exists (select 1 from cron.job where jobname = 'migrizo_daily_queues');
    perform cron.schedule('migrizo_daily_queues', '31 18 * * *', 'select public.generate_all_queues();');
    raise notice 'Nightly job scheduled for 00:01 India time.';
  else
    raise notice 'pg_cron is not enabled. Enable it under Database > Extensions, then run this file again.';
  end if;
end
$do$;

notify pgrst, 'reload schema';


-- ── Confirmation: exactly what the engine will and will not touch ───────────
select stage, count(*) as leads,
  case when stage = 'cold' then 'ASSIGNED to the daily queue'
       when stage = 'hot'  then 'OWNED by the hot-lead owner'
       else 'EXCLUDED, never assigned' end as treatment
from public.leads
group by stage
order by count(*) desc;
