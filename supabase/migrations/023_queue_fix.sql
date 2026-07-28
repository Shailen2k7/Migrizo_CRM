-- ============================================================================
-- 023: LEAD QUEUE — DIAGNOSTICS AND SAFER GENERATION
--
-- Why nothing was assigned:
--   Both the nightly cron and the "Generate" button loop over lead_queue_rules
--   looking for rows where active = true AND cold_per_day > 0. If no quotas
--   have been saved, that loop runs zero times — so the function succeeds and
--   returns 0. No error, no leads, no explanation. The UI then showed either
--   "0 leads assigned" or an empty queue, which looks identical to a crash.
--
-- This migration fixes the silence:
--   · queue_diagnose() reports exactly what is blocking, in plain English.
--   · generate_daily_queue_v2() returns a reason alongside the count, so the
--     UI can say WHY it did nothing.
--   · Nothing about the assignment logic itself changes — it was correct.
-- ============================================================================

-- ── A plain-English health check ────────────────────────────────────────────
create or replace function public.queue_diagnose(p_workspace_id uuid)
returns table (
  check_name text,
  status     text,
  detail     text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules      int;
  v_active     int;
  v_capacity   int;
  v_cold       int;
  v_today_q    int;
  v_cron       boolean;
  v_job        boolean;
  v_total      int;
begin
  -- 1. Are quotas configured?
  select count(*) into v_rules from public.lead_queue_rules where workspace_id = p_workspace_id;
  select count(*), coalesce(sum(cold_per_day), 0) into v_active, v_capacity
    from public.lead_queue_rules
   where workspace_id = p_workspace_id and active and cold_per_day > 0;

  check_name := 'Daily quotas';
  if v_active = 0 then
    status := 'BLOCKED';
    detail := 'No one has a daily quota. Open Lead Engine and set a number of cold leads per day for Sandra and Prateek, then switch them Active. Nothing can be assigned until this is done.';
  else
    status := 'OK';
    detail := v_active || ' people set up, ' || v_capacity || ' leads per day in total.';
  end if;
  return next;

  -- 2. Is there anything to assign?
  select count(*) into v_total from public.leads where workspace_id = p_workspace_id;
  select count(*) into v_cold
    from public.leads l
   where l.workspace_id = p_workspace_id
     and l.retired_at is null
     and l.is_sample is not true
     and not public.lead_is_hot(l.stage)
     and l.stage not in ('won','lost')
     and (l.snooze_until is null or l.snooze_until <= now())
     and (l.last_touched_at is null or l.last_touched_at < now() - interval '14 days');

  check_name := 'Eligible cold leads';
  if v_cold = 0 then
    status := 'BLOCKED';
    detail := 'No leads qualify as cold. Of ' || v_total || ' leads total, none are in new/attempted/connected and untouched for 14+ days.';
  else
    status := 'OK';
    detail := v_cold || ' cold leads ready to be worked, out of ' || v_total || ' total.';
  end if;
  return next;

  -- 3. Has today's queue been built?
  select count(*) into v_today_q
    from public.lead_queue where workspace_id = p_workspace_id and day = public.crm_today();

  check_name := 'Today''s queue';
  if v_today_q = 0 then
    status := 'EMPTY';
    detail := 'Nothing assigned for ' || public.crm_today() || ' yet. Fix anything marked BLOCKED above, then press Generate.';
  else
    status := 'OK';
    detail := v_today_q || ' leads assigned for ' || public.crm_today() || '.';
  end if;
  return next;

  -- 4. Is the nightly schedule live?
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_cron;
  v_job := false;
  if v_cron then
    begin
      execute 'select exists (select 1 from cron.job where jobname = ''migrizo_daily_queues'')' into v_job;
    exception when others then v_job := false;
    end;
  end if;

  check_name := 'Nightly schedule';
  if not v_cron then
    status := 'BLOCKED';
    detail := 'pg_cron is not enabled. Supabase dashboard, Database, Extensions, search pg_cron and switch it on. Then re-run migration 020 to create the job.';
  elsif not v_job then
    status := 'BLOCKED';
    detail := 'pg_cron is on but the job was never created. Re-run migration 020_queue_cron.sql.';
  else
    status := 'OK';
    detail := 'Runs every night at 00:01 India time.';
  end if;
  return next;
end;
$$;
grant execute on function public.queue_diagnose(uuid) to authenticated;


-- ── Generation that explains itself ─────────────────────────────────────────
-- Same logic as before, but returns a reason so the UI never shows a bare 0.
create or replace function public.generate_daily_queue_v2(p_workspace_id uuid)
returns table (created int, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int;
  v_cold   int;
  v_made   int;
begin
  select count(*) into v_active
    from public.lead_queue_rules
   where workspace_id = p_workspace_id and active and cold_per_day > 0;

  if v_active = 0 then
    created := 0;
    reason  := 'no_quotas';
    return next;
    return;
  end if;

  select count(*) into v_cold
    from public.leads l
   where l.workspace_id = p_workspace_id
     and l.retired_at is null
     and l.is_sample is not true
     and not public.lead_is_hot(l.stage)
     and l.stage not in ('won','lost')
     and (l.snooze_until is null or l.snooze_until <= now())
     and (l.last_touched_at is null or l.last_touched_at < now() - interval '14 days');

  if v_cold = 0 then
    created := 0;
    reason  := 'no_cold_leads';
    return next;
    return;
  end if;

  v_made := public.generate_daily_queue(p_workspace_id);

  created := coalesce(v_made, 0);
  if created = 0 then
    reason := 'already_generated';
  else
    reason := 'ok';
  end if;
  return next;
end;
$$;
grant execute on function public.generate_daily_queue_v2(uuid) to authenticated;


-- ── Let an admin rebuild today's queue from scratch ─────────────────────────
-- Useful when quotas are changed mid-day: clears today's UNWORKED assignments
-- and regenerates. Anything already worked is left untouched.
create or replace function public.regenerate_today(p_workspace_id uuid)
returns table (created int, reason text)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.lead_queue
   where workspace_id = p_workspace_id
     and day = public.crm_today()
     and status = 'pending';

  return query select * from public.generate_daily_queue_v2(p_workspace_id);
end;
$$;
grant execute on function public.regenerate_today(uuid) to authenticated;
