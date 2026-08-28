-- ============================================================================
-- 078 — INTAKE V2: the founder's ladder, made punctual.
--
--   Chat in → T1 · CV in → T5 + PDF · +30 SECONDS → T6 · silence → T2/T3/T4
--   inside 24h · not eligible → T7 · question → human.
--
-- Two timing fixes carried by this file, both answers to the field audit
-- ("booking link 4+ minutes late", "T2/T3/T4 never sent"):
--
--   1. The intake drain cron runs EVERY MINUTE, not every five. pg_cron's
--      floor is one minute; with T6 queued 30 seconds behind T5, the lead
--      sees the booking link 30–90 seconds after their verdict.
--   2. wa_intake_advance's verdict step now waits 30 seconds, not 4 minutes.
--
-- The cron block REPLACES any prior registration, so a database where 076's
-- registration silently failed (the likely reason follow-ups never fired) is
-- healed by applying this file. The job name matches 'migrizo-wa-%' so the
-- Campaigns screen's health panel shows it.
--
-- Idempotent: safe to run twice.
-- ============================================================================

-- ── 1. Verdict cadence: T5 → 30 seconds → T6 ────────────────────────────────
create or replace function public.wa_intake_advance(
  p_intake_id   uuid,
  p_ok          boolean,
  p_branch      text default null,
  p_error       text default null,
  p_retry_hours int  default 12
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  r public.wa_intake%rowtype;
  v_offset interval;
begin
  select * into r from public.wa_intake where id = p_intake_id for update;
  if not found then return; end if;

  if p_ok then
    if r.track = 'verdict' and r.next_step <= 5 then
      -- T5 just went out — the booking link follows in half a minute, so the
      -- pair reads like one person finishing a thought.
      update public.wa_intake
         set sent_count = sent_count + 1, next_step = 6,
             next_send_at = now() + interval '30 seconds',
             branch = coalesce(p_branch, branch),
             fail_count = 0, last_error = null, updated_at = now()
       where id = p_intake_id;
    elsif r.track = 'verdict' or r.next_step >= 4 then
      update public.wa_intake
         set status = 'done', sent_count = sent_count + 1,
             branch = coalesce(p_branch, branch),
             fail_count = 0, last_error = null, updated_at = now()
       where id = p_intake_id;
    else
      v_offset := case
        when coalesce(p_branch, r.branch) = 'session' then
          case r.next_step when 1 then interval '4 hours'
                           when 2 then interval '6 hours'
                           else interval '10 hours' end
        else
          case r.next_step when 1 then interval '1 day'
                           when 2 then interval '2 days'
                           else interval '3 days' end
      end;
      update public.wa_intake
         set sent_count = sent_count + 1, next_step = next_step + 1,
             next_send_at = now() + v_offset,
             branch = coalesce(p_branch, branch),
             fail_count = 0, last_error = null, updated_at = now()
       where id = p_intake_id;
    end if;
  else
    if r.fail_count + 1 >= 5 then
      update public.wa_intake
         set status = 'failed', fail_count = fail_count + 1,
             last_error = left(coalesce(p_error, 'send failed'), 500),
             updated_at = now()
       where id = p_intake_id;
      update public.whatsapp_conversations
         set needs_attention = true, updated_at = now()
       where workspace_id = r.workspace_id and phone_e164 = r.phone_e164;
    else
      update public.wa_intake
         set fail_count = fail_count + 1,
             next_send_at = now() + make_interval(hours => greatest(p_retry_hours, 1)),
             last_error = left(coalesce(p_error, 'send failed'), 500),
             updated_at = now()
       where id = p_intake_id;
    end if;
  end if;
end;
$fn$;
grant execute on function public.wa_intake_advance(uuid, boolean, text, text, int) to service_role;

-- ── 2. Second-precision enqueue ─────────────────────────────────────────────
-- 076's enqueue took whole minutes; the ladder needs seconds for T6.
create or replace function public.wa_intake_enqueue_at(
  p_workspace_id uuid,
  p_lead_id      uuid,
  p_phone        text,
  p_track        text default 'chase',
  p_first_step   int  default 1,
  p_send_at      timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_id uuid;
begin
  if v_phone is null then return null; end if;
  if exists (select 1 from public.whatsapp_suppressions s
              where s.workspace_id = p_workspace_id and s.phone_e164 = v_phone) then
    return null;
  end if;

  insert into public.wa_intake
      (workspace_id, lead_id, phone_e164, track, next_step, next_send_at)
  values (p_workspace_id, p_lead_id, v_phone, p_track, p_first_step,
          coalesce(p_send_at, now()))
  on conflict (workspace_id, phone_e164, track) where status = 'waiting'
  do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;
grant execute on function public.wa_intake_enqueue_at(uuid, uuid, text, text, int, timestamptz) to service_role;

-- ── 3. The drain, every minute ──────────────────────────────────────────────
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'migrizo-wa-intake';
  perform cron.schedule('migrizo-wa-intake', '* * * * *', format(
    $job$ select net.http_post(
      url     := 'https://crm.migrizo.com/api/whatsapp/intake/drain',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-cron-secret','ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9'),
      body    := '{}'::jsonb) $job$));
exception when others then
  raise notice 'pg_cron not available here (%), skipping schedule', sqlerrm;
end $$;

notify pgrst, 'reload schema';

-- Applied-twice proof + a health readout you can eyeball.
do $$
declare v int;
begin
  begin
    select count(*) into v from cron.job where jobname = 'migrizo-wa-intake';
    raise notice 'migrizo-wa-intake cron registrations: % (must be 1)', v;
  exception when others then
    raise notice 'cron not inspectable here';
  end;
end $$;

select count(*) filter (where status = 'waiting') as waiting_journeys,
       count(*) filter (where status = 'failed')  as failed_journeys
  from public.wa_intake;
