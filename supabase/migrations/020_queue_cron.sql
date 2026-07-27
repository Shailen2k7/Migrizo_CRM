-- ============================================================================
-- 020: NIGHTLY AUTO-GENERATION (00:01 India time)
--
-- Two things happen here:
--
--   1. A TIMEZONE FIX. Postgres runs on UTC, so `current_date` rolls over at
--      5:30 AM India time — meaning a queue built just after midnight IST
--      would have been filed under the previous day. Everything now uses
--      crm_today(), which is the real Indian calendar date.
--
--   2. THE SCHEDULE. A pg_cron job runs every night at 18:31 UTC — which is
--      00:01 in India — and builds tomorrow's queue for every workspace, so
--      the team logs in to a queue that is already waiting.
--
-- The on-login generation stays in place as a safety net: if cron is ever
-- disabled or fails, the first person to open My Queue still gets a queue.
-- ============================================================================

-- ── 1. One source of truth for "today" ──────────────────────────────────────
create or replace function public.crm_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

grant execute on function public.crm_today() to authenticated;

-- The queue's day column should default to the Indian date, not the UTC one.
alter table public.lead_queue alter column day set default public.crm_today();


-- ── 2. Generator, corrected to Indian dates ─────────────────────────────────
create or replace function public.generate_daily_queue(p_workspace_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_needed  int;
  v_rolled  int;
  v_created int := 0;
  v_lead    record;
  v_today   date := public.crm_today();
begin
  for r in
    select user_id, cold_per_day, rollover
      from public.lead_queue_rules
     where workspace_id = p_workspace_id and active and cold_per_day > 0
  loop
    -- Already built for this person today? Leave it alone.
    if exists (select 1 from public.lead_queue
                where workspace_id = p_workspace_id and user_id = r.user_id and day = v_today) then
      continue;
    end if;

    v_rolled := 0;

    -- (a) Yesterday's unfinished work comes back first.
    if r.rollover then
      insert into public.lead_queue (workspace_id, user_id, lead_id, day, rolled_over)
      select q.workspace_id, q.user_id, q.lead_id, v_today, true
        from public.lead_queue q
        join public.leads l on l.id = q.lead_id
       where q.workspace_id = p_workspace_id
         and q.user_id = r.user_id
         and q.day < v_today
         and q.status = 'pending'
         and l.retired_at is null
         and (l.snooze_until is null or l.snooze_until <= now())
       order by q.day asc
       limit r.cold_per_day
      on conflict (lead_id, day) do nothing;

      get diagnostics v_rolled = row_count;

      update public.lead_queue
         set status = 'done', outcome = 'no_answer'
       where workspace_id = p_workspace_id and user_id = r.user_id
         and day < v_today and status = 'pending';
    end if;

    -- (b) Top up from the cold pool, oldest-untouched first.
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
           and not exists (select 1 from public.lead_queue q
                            where q.lead_id = l.id and q.day = v_today)
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
$$;


-- ── 3. Build queues for EVERY workspace (what cron calls) ───────────────────
create or replace function public.generate_all_queues()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  w     record;
  total int := 0;
begin
  for w in select distinct workspace_id from public.lead_queue_rules where active and cold_per_day > 0
  loop
    total := total + coalesce(public.generate_daily_queue(w.workspace_id), 0);
  end loop;
  return total;
end;
$$;


-- ── 4. Schedule it ──────────────────────────────────────────────────────────
-- 18:31 UTC = 00:01 Asia/Kolkata (UTC+5:30).
-- Requires the pg_cron extension — see SETUP_STEPS for the one-click enable.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('migrizo_daily_queues')
      where exists (select 1 from cron.job where jobname = 'migrizo_daily_queues');

    perform cron.schedule(
      'migrizo_daily_queues',
      '31 18 * * *',
      $job$ select public.generate_all_queues(); $job$
    );
    raise notice 'Scheduled: queues build nightly at 00:01 India time.';
  else
    raise notice 'pg_cron is not enabled — enable it under Database > Extensions, then re-run this file to schedule the nightly job.';
  end if;
end $$;
