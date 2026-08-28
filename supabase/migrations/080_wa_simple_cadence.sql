-- =============================================================================
-- 080 — THE SIMPLE FLOW, ON THE CLOCK THE FOUNDER ASKED FOR
-- -----------------------------------------------------------------------------
-- The journey is: chat in -> T1. CV in -> parse -> T5 + process PDF -> booking
-- link. No CV -> T2/T3/T4 until they reply. A question -> human takes over.
-- The two timing changes here make that journey feel immediate:
--
--   1. T6 (booking link) fires 1 MINUTE after T5, not 4. The founder's spec:
--      "once we send T5, then after 1 min, meeting booking link goes too."
--
--   2. The intake drain cron runs EVERY MINUTE, not every 5. The drain is what
--      actually delivers T6 and the T2-T4 chase, so a 5-minute cron meant
--      "1 minute after T5" could really be 6. Every minute, the worst case is
--      ~2. The drain exits in milliseconds when nothing is due, so the extra
--      invocations cost effectively nothing.
--
-- This file REPLACES wa_intake_advance from 076 — the cadence lives inside
-- that function on purpose, so every caller moves rows the same way. The ONLY
-- change from 076's version is '4 minutes' -> '1 minute'; everything else is
-- copied byte-for-byte. (Rule 5: never edit an old migration; supersede it.)
--
-- Idempotent: safe to run twice. Second run is NOTICEs only.
-- =============================================================================

-- ── 1. THE CADENCE ──────────────────────────────────────────────────────────
--   chase/session   T1→T2 +4h,  T2→T3 +6h,  T3→T4 +10h   (in-window)
--   chase/template  T1→T2 +1d,  T2→T3 +2d,  T3→T4 +3d    (number-safe)
--   verdict         T5 → T6 ONE minute later; 6 and 7 are terminal.
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
      -- T5 just went out — the booking link follows in ONE minute (080).
      update public.wa_intake
         set sent_count = sent_count + 1, next_step = 6,
             next_send_at = now() + interval '1 minute',
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

-- ── 2. THE CLOCK — every minute ─────────────────────────────────────────────
-- Same job name and shape as 076; only the schedule changes. Wrapped so a
-- database without pg_cron (local dev) applies the rest cleanly.
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

-- ── 3. VERIFY ───────────────────────────────────────────────────────────────
do $$
declare
  v_one_min  boolean;
  v_schedule text;
begin
  select pg_get_functiondef(p.oid) like '%interval ''1 minute''%' into v_one_min
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'wa_intake_advance';

  begin
    select schedule into v_schedule from cron.job where jobname = 'migrizo-wa-intake';
  exception when others then
    v_schedule := '(pg_cron not available here)';
  end;

  raise notice '080 — T6 fires 1 minute after T5 ....... %', v_one_min;
  raise notice '080 — intake drain schedule ............ %', v_schedule;

  if not v_one_min then
    raise exception '080 did not apply cleanly — wa_intake_advance still on the old delay';
  end if;
end $$;
