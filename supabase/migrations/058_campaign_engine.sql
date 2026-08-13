-- =============================================================================
-- 058_campaign_engine.sql — SEQUENCES BECOME CAMPAIGNS
--
-- THE DECISION (Shailen, 2026-08-13)
--   This WhatsApp number has exactly one job: template campaigns to the cold
--   and hot leads already in the CRM. New Meta leads are handled on the
--   separate UK number, entirely outside this system — so the first-touch
--   automation (welcome template + inbound intro) is switched OFF here.
--   The inbox and quick replies stay: when someone replies to a campaign, a
--   human answers once and points them to the UK consultation line (/uk).
--
-- WHAT A CAMPAIGN IS
--   A sequence that owns its own AUDIENCE: a saved filter (stage, field,
--   readiness, visa, recency, quiet-time) evaluated by ONE SQL function that
--   powers the preview, the launch AND the 10-minute top-up sweep. The number
--   the founder sees before pressing Start is produced by the same query that
--   later sends — the preview cannot lie, and tomorrow's matching leads join
--   by themselves.
--
-- HARD RULES (all enforced here, none in the browser):
--   * opted-out numbers, invalid phones, sample rows: never
--   * anyone with an upcoming meeting: never
--   * anyone this campaign has already touched: never again (unique index)
--   * anyone with WhatsApp activity in the last 24h: not this sweep
--   * max_people caps total reach; daily_limit + global cap pace the sends
--   * a reply pauses the rest of that person's steps (056 trigger, unchanged)
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. FIRST-TOUCH AUTOMATION OFF ───────────────────────────────────────────
-- New leads belong to the UK number now. The 056 pause-on-reply trigger runs
-- BEFORE this flag is checked, so replies still pause campaign steps.
update public.whatsapp_automation set enabled = false where enabled;


-- ── 2. A SEQUENCE OWNS ITS AUDIENCE ─────────────────────────────────────────
alter table public.whatsapp_sequences
  add column if not exists audience   jsonb,
  add column if not exists max_people int check (max_people is null or max_people > 0),
  add column if not exists auto_topup boolean not null default true;

comment on column public.whatsapp_sequences.audience is
  'Saved filter: {stages[], industries[], readiness[], visa[], added_days, quiet_days}. Empty array = any. "unknown" inside industries/readiness matches NULL. One function (whatsapp_campaign_matches) evaluates it for preview, launch and sweep alike.';


-- ── 3. THE ONE AUDIENCE QUERY ───────────────────────────────────────────────
-- Filters only — the always-off exclusions that depend on the sequence
-- (already enrolled) or need separate counting (suppressed, meeting) are
-- applied by the callers so the preview can show WHY people were excluded.
create or replace function public.whatsapp_campaign_matches(p_ws uuid, p_audience jsonb)
returns table (lead_id uuid, phone text)
language sql stable security definer set search_path = public as $fn$
  with a as (
    select coalesce(p_audience->'stages',     '[]'::jsonb) as stages,
           coalesce(p_audience->'industries', '[]'::jsonb) as industries,
           coalesce(p_audience->'readiness',  '[]'::jsonb) as readiness,
           coalesce(p_audience->'visa',       '[]'::jsonb) as visa,
           nullif(p_audience->>'added_days', '')::int      as added_days,
           nullif(p_audience->>'quiet_days', '')::int      as quiet_days
  )
  select l.id, p.norm
    from public.leads l
    cross join a
    cross join lateral (select public.whatsapp_normalize_phone(l.phone) as norm) p
   where l.workspace_id = p_ws
     and coalesce(l.is_sample, false) = false
     and p.norm is not null
     -- stage: explicit list, or any stage still in play
     and case when jsonb_array_length(a.stages) > 0
              then l.stage in (select jsonb_array_elements_text(a.stages))
              else l.stage not in ('won', 'junk') end
     -- field
     and (jsonb_array_length(a.industries) = 0
          or l.industry in (select jsonb_array_elements_text(a.industries))
          or (a.industries ? 'unknown' and l.industry is null))
     -- willingness to pay
     and (jsonb_array_length(a.readiness) = 0
          or l.investment_readiness in (select jsonb_array_elements_text(a.readiness))
          or (a.readiness ? 'unknown' and l.investment_readiness is null))
     -- visa
     and (jsonb_array_length(a.visa) = 0
          or l.visa_type in (select jsonb_array_elements_text(a.visa)))
     -- recency of arrival
     and (a.added_days is null
          or l.created_at >= now() - make_interval(days => a.added_days))
     -- "not messaged in X days" (our last outbound on this number)
     and (a.quiet_days is null or a.quiet_days <= 0 or not exists (
            select 1 from public.whatsapp_conversations c
             where c.workspace_id = p_ws and c.phone_e164 = p.norm
               and c.last_outbound_at > now() - make_interval(days => a.quiet_days)))
     -- safety: never talk over a conversation that moved in the last 24h
     and not exists (
            select 1 from public.whatsapp_conversations c
             where c.workspace_id = p_ws and c.phone_e164 = p.norm
               and greatest(coalesce(c.last_message_at, 'epoch'::timestamptz),
                            coalesce(c.last_inbound_at, 'epoch'::timestamptz))
                   > now() - interval '24 hours');
$fn$;
grant execute on function public.whatsapp_campaign_matches(uuid, jsonb) to authenticated, service_role;


-- ── 4. PREVIEW — the live count card, with its exclusion breakdown ──────────
create or replace function public.whatsapp_campaign_preview(
  p_workspace_id uuid, p_audience jsonb, p_sequence_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_matched int; v_suppressed int; v_meeting int; v_already int; v_eligible int;
  v_steps int := 0;
begin
  if not (p_workspace_id in (select user_workspaces())) then
    return jsonb_build_object('ok', false, 'reason', 'not_your_workspace');
  end if;

  with m as (select * from public.whatsapp_campaign_matches(p_workspace_id, p_audience)),
  judged as (
    select m.*,
      exists (select 1 from public.whatsapp_suppressions s
               where s.workspace_id = p_workspace_id and s.phone_e164 = m.phone)  as sup,
      exists (select 1 from public.meetings mt
               where mt.workspace_id = p_workspace_id and mt.status = 'upcoming'
                 and (mt.lead_id = m.lead_id
                      or public.whatsapp_normalize_phone(mt.client_phone) = m.phone)) as met,
      (p_sequence_id is not null and exists (
         select 1 from public.whatsapp_sequence_enrollments e
          where e.sequence_id = p_sequence_id and e.phone_e164 = m.phone))        as already
      from m
  )
  select count(*),
         count(*) filter (where sup),
         count(*) filter (where met and not sup),
         count(*) filter (where already and not sup and not met),
         count(*) filter (where not sup and not met and not already)
    into v_matched, v_suppressed, v_meeting, v_already, v_eligible
    from judged;

  if p_sequence_id is not null then
    select count(*) into v_steps
      from public.whatsapp_sequence_steps where sequence_id = p_sequence_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'matched',         v_matched,
    'suppressed',      v_suppressed,
    'meeting_booked',  v_meeting,
    'already_in',      v_already,
    'eligible',        v_eligible,
    'steps',           v_steps,
    'total_messages',  v_eligible * greatest(v_steps, 1)
  );
end;
$fn$;
grant execute on function public.whatsapp_campaign_preview(uuid, jsonb, uuid) to authenticated;


-- ── 5. ENROL — shared by launch and sweep, capacity-aware ───────────────────
create or replace function public.whatsapp_campaign_enrol(p_sequence_id uuid)
returns int language plpgsql security definer set search_path = public as $fn$
declare
  s public.whatsapp_sequences%rowtype;
  v_room int; v_n int := 0;
begin
  select * into s from public.whatsapp_sequences where id = p_sequence_id;
  if s.id is null or s.audience is null or s.status <> 'active' then return 0; end if;
  if not exists (select 1 from public.whatsapp_sequence_steps st where st.sequence_id = s.id) then
    return 0;
  end if;

  -- max_people caps the campaign's TOTAL reach, ever — not just this batch.
  if s.max_people is not null then
    select s.max_people - count(*) into v_room
      from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id;
    if v_room <= 0 then return 0; end if;
  else
    v_room := 100000;
  end if;

  with m as (select * from public.whatsapp_campaign_matches(s.workspace_id, s.audience)),
  eligible as (
    select m.lead_id, m.phone
      from m
     where not exists (select 1 from public.whatsapp_suppressions su
                        where su.workspace_id = s.workspace_id and su.phone_e164 = m.phone)
       and not exists (select 1 from public.meetings mt
                        where mt.workspace_id = s.workspace_id and mt.status = 'upcoming'
                          and (mt.lead_id = m.lead_id
                               or public.whatsapp_normalize_phone(mt.client_phone) = m.phone))
       and not exists (select 1 from public.whatsapp_sequence_enrollments e
                        where e.sequence_id = s.id and e.phone_e164 = m.phone)
     order by m.lead_id
     limit v_room
  ), ins as (
    insert into public.whatsapp_sequence_enrollments
      (workspace_id, sequence_id, lead_id, phone_e164, status, current_step, next_send_at)
    select s.workspace_id, s.id, e.lead_id, e.phone, 'active', 0,
           public.whatsapp_clamp_to_window(s.workspace_id, now())
      from eligible e
    on conflict (sequence_id, phone_e164) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$fn$;
grant execute on function public.whatsapp_campaign_enrol(uuid) to service_role;


-- ── 6. LAUNCH — save the audience + limits, go live, enrol now ──────────────
create or replace function public.whatsapp_campaign_launch(
  p_sequence_id uuid, p_audience jsonb,
  p_max_people int default null, p_daily_limit int default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_n int;
begin
  select workspace_id into v_ws from public.whatsapp_sequences where id = p_sequence_id;
  if v_ws is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.is_campaign_admin(v_ws) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;
  if not exists (select 1 from public.whatsapp_sequence_steps st where st.sequence_id = p_sequence_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_steps',
      'detail', 'Add at least one message before starting.');
  end if;

  update public.whatsapp_sequences
     set audience = p_audience,
         max_people = p_max_people,
         daily_limit = p_daily_limit,
         status = 'active',
         updated_at = now()
   where id = p_sequence_id;

  v_n := public.whatsapp_campaign_enrol(p_sequence_id);

  insert into public.activity (workspace_id, user_id, lead_id, action, meta)
  values (v_ws, auth.uid(), null, 'whatsapp_campaign_launched',
          jsonb_build_object('sequence_id', p_sequence_id, 'enrolled', v_n));
  return jsonb_build_object('ok', true, 'enrolled', v_n);
end;
$fn$;
grant execute on function public.whatsapp_campaign_launch(uuid, jsonb, int, int) to authenticated;


-- ── 7. THE SWEEP — tomorrow's leads join by themselves ──────────────────────
create or replace function public.whatsapp_campaign_sweep(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r record; v_n int; v_total int := 0; v_ran int := 0;
begin
  for r in
    select s.id, s.workspace_id from public.whatsapp_sequences s
     where s.status = 'active' and s.auto_topup and s.audience is not null
       and (p_workspace_id is null or s.workspace_id = p_workspace_id)
  loop
    if auth.uid() is not null and not public.is_campaign_admin(r.workspace_id) then
      continue;
    end if;
    v_n := public.whatsapp_campaign_enrol(r.id);
    v_total := v_total + v_n; v_ran := v_ran + 1;
  end loop;
  return jsonb_build_object('ok', true, 'campaigns', v_ran, 'enrolled', v_total);
end;
$fn$;
grant execute on function public.whatsapp_campaign_sweep(uuid) to authenticated, service_role;


-- ── 8. LIVE STATS — the funnel, the replies, the failures ───────────────────
create or replace function public.whatsapp_campaign_stats(p_sequence_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'ok', true,
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'step_no', st.step_no,
               'template', t.name,
               'sent', (select count(*) from public.whatsapp_messages m
                         where m.workspace_id = s.workspace_id and m.direction = 'out'
                           and m.status <> 'failed'
                           and m.sequence_step = s.id::text || ':' || st.step_no),
               'failed', (select count(*) from public.whatsapp_messages m
                         where m.workspace_id = s.workspace_id
                           and m.status = 'failed'
                           and m.sequence_step = s.id::text || ':' || st.step_no)
             ) order by st.step_no), '[]'::jsonb)
        from public.whatsapp_sequence_steps st
        join public.whatsapp_templates t on t.id = st.template_id
       where st.sequence_id = s.id),
    'enrolled',  (select count(*) from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id),
    'active',    (select count(*) from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id and e.status = 'active'),
    'paused',    (select count(*) from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id and e.status = 'paused'),
    'completed', (select count(*) from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id and e.status = 'completed'),
    'replied',   (select count(*) from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id and e.has_replied),
    'opted_out', (select count(*) from public.whatsapp_sequence_enrollments e where e.sequence_id = s.id and e.stop_reason = 'opted_out'),
    'sent_today', (select count(*) from public.whatsapp_messages m
                    where m.workspace_id = s.workspace_id and m.direction = 'out'
                      and m.status <> 'failed'
                      and m.sequence_step like s.id::text || ':%'
                      and m.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'replies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', x.id, 'lead_name', x.full_name, 'phone', x.phone_e164,
               'replied_at', x.last_reply_at, 'body', x.body,
               'conversation_id', x.conversation_id) order by x.last_reply_at desc), '[]'::jsonb)
        from (
          select e.id, e.phone_e164, e.last_reply_at,
                 coalesce(l.full_name, e.phone_e164) as full_name,
                 c.id as conversation_id,
                 (select msg.body from public.whatsapp_messages msg
                   where msg.conversation_id = c.id and msg.direction = 'in'
                   order by msg.created_at desc limit 1) as body
            from public.whatsapp_sequence_enrollments e
            left join public.leads l on l.id = e.lead_id
            left join public.whatsapp_conversations c
              on c.workspace_id = e.workspace_id and c.phone_e164 = e.phone_e164
           where e.sequence_id = s.id and e.has_replied
           order by e.last_reply_at desc nulls last
           limit 15) x),
    'failures', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'enrollment_id', e.id, 'lead_name', coalesce(l.full_name, e.phone_e164),
               'phone', e.phone_e164, 'error', e.last_error, 'status', e.status,
               'at_step', e.current_step + 1) order by e.updated_at desc), '[]'::jsonb)
        from public.whatsapp_sequence_enrollments e
        left join public.leads l on l.id = e.lead_id
       where e.sequence_id = s.id and e.last_error is not null
         and (e.status = 'stopped' and e.stop_reason = 'failed' or e.fail_count > 0)
       limit 12)
  )
  from public.whatsapp_sequences s
  where s.id = p_sequence_id
    and s.workspace_id in (select user_workspaces());
$fn$;
grant execute on function public.whatsapp_campaign_stats(uuid) to authenticated;


-- ── 9. RETRY a failed enrollment ────────────────────────────────────────────
create or replace function public.whatsapp_enrollment_retry(p_enrollment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.whatsapp_sequence_enrollments where id = p_enrollment_id;
  if v_ws is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.is_campaign_admin(v_ws) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;

  update public.whatsapp_sequence_enrollments
     set status = 'active', fail_count = 0, last_error = null, stop_reason = null,
         next_send_at = public.whatsapp_clamp_to_window(v_ws, now())
   where id = p_enrollment_id and status in ('stopped', 'active', 'paused')
     and stop_reason is distinct from 'opted_out';   -- opt-out is forever

  if not found then return jsonb_build_object('ok', false, 'reason', 'not_retryable'); end if;
  return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.whatsapp_enrollment_retry(uuid) to authenticated;


-- ── 10. THE /uk HANDOFF QUICK REPLY ─────────────────────────────────────────
-- One keystroke to move a replier to the consultation line. Edit the number
-- in the Quick replies tab once — the seed is only a starting point.
insert into public.whatsapp_saved_replies (workspace_id, shortcut, title, body, sort_order)
select w.id, 'uk', 'Continue on the UK number',
E'Thanks {{name}} — great to hear from you.\n\nPlease continue this conversation with our team on WhatsApp at +44 XXXX XXXXXX. That is our dedicated consultation line and the fastest way to get your profile reviewed.\n\nJust send a quick "Hi" there and we will pick it up right away.', 5
  from public.workspaces w
on conflict (workspace_id, shortcut) do nothing;


-- ── 11. CRON — the sweep replaces the old stage-enrol job ───────────────────
do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron not installed — the campaign sweep will NOT run by itself.';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('migrizo-whatsapp-stage-enrol', 'migrizo-whatsapp-campaign-sweep');
  perform cron.schedule('migrizo-whatsapp-campaign-sweep', '*/10 * * * *',
    'select public.whatsapp_campaign_sweep();');
  raise notice 'Scheduled: campaign top-up sweep every 10 minutes.';
end $cron$;

notify pgrst, 'reload schema';

comment on function public.whatsapp_campaign_matches(uuid, jsonb) is
  'THE audience query. Preview, launch and sweep all call this one function, so the count on screen is always the list that sends.';
