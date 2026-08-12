-- =============================================================================
-- 056_whatsapp_manual_mode.sql — FIRST TOUCH ONLY + FOLLOW-UPS FOR COLD & HOT
--
-- THE DECISION (Shailen, 2026-08-12)
--   Live conversations belong to humans. The engine's only automatic message
--   to a live/incoming lead is the FIRST TOUCH:
--     * ad-form lead      → the approved welcome template (asks CV + LinkedIn)
--     * direct message    → the free-text intro (asks CV + LinkedIn)
--   After that: nothing automated. No auto Q&A, no auto guide/booking links,
--   no reminders. A reply flags the chat and a human takes over.
--
--   Separately, NO COLD OR HOT LEAD IS EVER LEFT UNTOUCHED: every lead sitting
--   in the Cold or Hot stage is enrolled automatically into your approved
--   template follow-up sequence for that stage — backlog included — and the
--   existing sequence drain sends the steps inside the send window and daily
--   cap. Rules that keep this polite:
--     * only QUIET leads are enrolled — anyone with WhatsApp activity in the
--       last 24 hours is left to the human
--     * a reply PAUSES that lead's follow-ups instantly (human resumes/stops)
--     * an upcoming meeting, a suppression, or an existing enrolment skips them
--     * a lead who leaves the stage has their follow-ups stopped
--     * one enrolment per phone per sequence, ever — no repeats
--
--   Also ships QUICK REPLIES: saved notes (text + optional file) the inbox
--   sends with "/" — the Q&A answers are imported so nothing typed is lost.
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. SETTINGS — the two follow-up lanes ────────────────────────────────────
alter table public.whatsapp_automation
  add column if not exists hot_sequence_id uuid references public.whatsapp_sequences(id) on delete set null,
  add column if not exists auto_enrol_cold boolean not null default true,
  add column if not exists auto_enrol_hot  boolean not null default true;

-- Manual mode: the auto Q&A brain is off. The rows stay (your answers were
-- imported into Quick Replies below); flip this back only when asked.
update public.whatsapp_automation set auto_faq = false where auto_faq;

-- The old auto-assets copy carried emojis; replace only untouched defaults so
-- a message someone rewrote on purpose is never overwritten.
update public.whatsapp_automation
   set eligible_message =
'Great news, {{name}} — from what you have shared, you look like a strong fit for the UK Global Talent route.

Two things worth five minutes of your time:

Our step-by-step process guide: {{pdf}}

A short video on how the process works: {{video}}'
 where eligible_message like '%🎉%';


-- ── 2. JOURNEYS — a "handed to a human" stage ────────────────────────────────
alter table public.whatsapp_journeys drop constraint if exists whatsapp_journeys_stage_check;
alter table public.whatsapp_journeys add constraint whatsapp_journeys_stage_check check (stage in (
  'welcome_queued',   -- welcome job waiting for the drain
  'intro_queued',     -- they messaged us; intro pending
  'awaiting_reply',   -- first touch sent, waiting on the lead
  'handed_over',      -- they replied → a human owns this chat now
  'needs_review',     -- legacy
  'eligible',         -- legacy
  'waiting_booking',  -- legacy
  'booked',           -- meeting exists — done
  'not_eligible',     -- legacy human decision
  'stopped',
  'checking'          -- legacy
));

-- Historical rows from the old journey model read cleanly in the new UI.
update public.whatsapp_journeys
   set stage = 'handed_over'
 where stage in ('eligible', 'waiting_booking', 'needs_review');

-- Anything the old model still had queued must never fire again.
update public.whatsapp_auto_jobs
   set status = 'skipped', error = 'manual_mode'
 where status = 'queued' and kind in ('assets', 'faq', 'reminder', 'cold_enrol');


-- ── 3. TRIGGER: inbound message, manual-mode edition ─────────────────────────
-- Keeps: the second door (a stranger's first message creates a tagged lead and
-- queues the intro), click-to-WhatsApp parsing, lead enrichment.
-- Changes: a reply queues NOTHING. It cancels any old queued jobs, marks the
-- journey handed_over, flags the chat, and pauses template follow-ups so a
-- sequence never talks over a live human conversation.
create or replace function public.whatsapp_auto_on_inbound()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  j        public.whatsapp_journeys%rowtype;
  cfg      public.whatsapp_automation%rowtype;
  v_conv   public.whatsapp_conversations%rowtype;
  v_lead   uuid;
  v_new    boolean := false;
  v_parsed jsonb;
begin
  if new.direction <> 'in' then return new; end if;

  -- A reply PAUSES follow-ups for this number, before anything else and
  -- regardless of whether the first-touch automation is even enabled. A human
  -- resumes or stops from the inbox; code never talks over a live chat.
  update public.whatsapp_sequence_enrollments e
     set status = 'paused', has_replied = true, last_reply_at = now()
    from public.whatsapp_conversations c
   where c.id = new.conversation_id
     and e.workspace_id = new.workspace_id
     and e.phone_e164 = c.phone_e164
     and e.status = 'active';

  select * into cfg from public.whatsapp_automation where workspace_id = new.workspace_id;
  if cfg.workspace_id is null or not cfg.enabled then return new; end if;

  v_parsed := public.whatsapp_parse_ctwa(new.body);

  select * into j from public.whatsapp_journeys
   where workspace_id = new.workspace_id and conversation_id = new.conversation_id;
  if j.id is null then
    select jj.* into j from public.whatsapp_journeys jj
      join public.whatsapp_conversations c on c.id = new.conversation_id
     where jj.workspace_id = new.workspace_id and jj.phone_e164 = c.phone_e164
     limit 1;
    if j.id is not null and j.conversation_id is null then
      update public.whatsapp_journeys set conversation_id = new.conversation_id where id = j.id;
    end if;
  end if;

  -- ═══ the second door: they reached out and we have never spoken ═══════════
  if j.id is null and cfg.inbound_enabled then
    select * into v_conv from public.whatsapp_conversations where id = new.conversation_id;

    if v_conv.id is not null
       and not exists (select 1 from public.whatsapp_suppressions s
                        where s.workspace_id = new.workspace_id and s.phone_e164 = v_conv.phone_e164)
       and not exists (select 1 from public.whatsapp_messages m
                        where m.conversation_id = new.conversation_id
                          and m.direction = 'out' and m.id <> new.id)
    then
      v_lead := public.whatsapp_auto_lead_from_inbound(new.workspace_id, v_conv.id);
      if v_lead is not null then
        insert into public.whatsapp_journeys
          (workspace_id, lead_id, conversation_id, phone_e164, stage, entry_source)
        values (new.workspace_id, v_lead, v_conv.id, v_conv.phone_e164, 'intro_queued', 'whatsapp_inbound')
        on conflict (workspace_id, lead_id) do update
          set conversation_id = excluded.conversation_id
        returning * into j;

        if j.id is not null and j.stage = 'intro_queued' then
          v_new := true;
          -- Tag BEFORE the intro job runs so the hot lane sees real values.
          perform public.whatsapp_apply_ctwa(new.workspace_id, v_lead, j.id, v_parsed);
          insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
          values (new.workspace_id, j.id, 'inbound_intro',
                  jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id,
                                     'ctwa', v_parsed is not null));
        end if;
      end if;
    end if;
  end if;

  -- Late form data for a journey we already had → still worth capturing.
  if j.id is not null and not v_new and v_parsed is not null then
    perform public.whatsapp_apply_ctwa(new.workspace_id, j.lead_id, j.id, v_parsed);
    select * into j from public.whatsapp_journeys where id = j.id;
  end if;

  -- ═══ they replied → hand the chat to a human, automate nothing ════════════
  if j.id is not null and not v_new then
    update public.whatsapp_auto_jobs
       set status = 'skipped', error = 'lead_replied'
     where journey_id = j.id and status = 'queued'
       and kind in ('welcome', 'assets', 'faq', 'reminder', 'cold_enrol');

    if j.stage in ('welcome_queued', 'awaiting_reply') then
      update public.whatsapp_journeys set stage = 'handed_over' where id = j.id;
      update public.whatsapp_conversations set needs_attention = true where id = new.conversation_id;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists whatsapp_auto_on_inbound on public.whatsapp_messages;
create trigger whatsapp_auto_on_inbound after insert on public.whatsapp_messages
  for each row execute function public.whatsapp_auto_on_inbound();


-- ── 4. FOLLOW-UPS: no cold or hot lead left untouched ────────────────────────
-- Runs every 10 minutes from pg_cron (and instantly when you save the tab).
-- For each lane (cold, hot): stop follow-ups for leads that left the stage,
-- then enrol every quiet, reachable, un-enrolled lead currently in it.
create or replace function public.whatsapp_stage_autoenrol(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  cfg record; pair record;
  v_enrolled int; v_stopped int;
  v_total_enrolled int := 0; v_total_stopped int := 0;
  v_out jsonb := '{}'::jsonb;
begin
  for cfg in
    select a.* from public.whatsapp_automation a
     where (p_workspace_id is null or a.workspace_id = p_workspace_id)
  loop
    -- A human calling this must be a campaign admin; cron (no auth) passes.
    if auth.uid() is not null and not public.is_campaign_admin(cfg.workspace_id) then
      continue;
    end if;
    if not cfg.enabled then continue; end if;

    for pair in
      select * from (values
        ('cold', cfg.cold_sequence_id, cfg.auto_enrol_cold),
        ('hot',  cfg.hot_sequence_id,  cfg.auto_enrol_hot)
      ) as v(stage, seq_id, lane_on)
    loop
      if not pair.lane_on or pair.seq_id is null then continue; end if;
      if not exists (select 1 from public.whatsapp_sequences s
                      where s.id = pair.seq_id and s.workspace_id = cfg.workspace_id
                        and s.status = 'active') then continue; end if;
      if not exists (select 1 from public.whatsapp_sequence_steps st
                      where st.sequence_id = pair.seq_id) then continue; end if;

      -- Leads that left the stage stop receiving that stage's follow-ups.
      with s as (
        update public.whatsapp_sequence_enrollments e
           set status = 'stopped', stop_reason = 'stage_changed', next_send_at = null
          from public.leads l
         where e.sequence_id = pair.seq_id and e.status in ('active', 'paused')
           and l.id = e.lead_id and l.stage <> pair.stage
        returning 1
      ) select count(*) into v_stopped from s;

      -- Enrol the untouched. "Quiet" = no WhatsApp activity either way in the
      -- last 24h — follow-ups chase silence, they never interrupt a live chat.
      with ins as (
        insert into public.whatsapp_sequence_enrollments
          (workspace_id, sequence_id, lead_id, phone_e164, status, current_step, next_send_at)
        select cfg.workspace_id, pair.seq_id, l.id, p.norm, 'active', 0,
               public.whatsapp_clamp_to_window(cfg.workspace_id, now())
          from public.leads l
          cross join lateral (select public.whatsapp_normalize_phone(l.phone) as norm) p
         where l.workspace_id = cfg.workspace_id
           and l.stage = pair.stage
           and coalesce(l.is_sample, false) = false
           and p.norm is not null
           and not exists (select 1 from public.whatsapp_suppressions su
                            where su.workspace_id = cfg.workspace_id and su.phone_e164 = p.norm)
           and not exists (select 1 from public.whatsapp_sequence_enrollments en
                            where en.sequence_id = pair.seq_id and en.phone_e164 = p.norm)
           and not exists (select 1 from public.meetings m
                            where m.workspace_id = cfg.workspace_id and m.status = 'upcoming'
                              and (m.lead_id = l.id
                                   or public.whatsapp_normalize_phone(m.client_phone) = p.norm))
           and not exists (select 1 from public.whatsapp_conversations c
                            where c.workspace_id = cfg.workspace_id and c.phone_e164 = p.norm
                              and greatest(coalesce(c.last_message_at, 'epoch'::timestamptz),
                                           coalesce(c.last_inbound_at, 'epoch'::timestamptz))
                                  > now() - interval '24 hours')
        on conflict (sequence_id, phone_e164) do nothing
        returning 1
      ) select count(*) into v_enrolled from ins;

      v_total_enrolled := v_total_enrolled + v_enrolled;
      v_total_stopped  := v_total_stopped  + v_stopped;
      v_out := v_out || jsonb_build_object(pair.stage,
                 jsonb_build_object('enrolled', v_enrolled, 'stopped', v_stopped));
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'enrolled', v_total_enrolled, 'stopped', v_total_stopped) || v_out;
end;
$fn$;
grant execute on function public.whatsapp_stage_autoenrol(uuid) to authenticated, service_role;


-- ── 5. QUICK REPLIES — files, links, usage, and the Q&A import ───────────────
alter table public.whatsapp_saved_replies
  add column if not exists media_path text,
  add column if not exists media_type text,
  add column if not exists media_name text,
  add column if not exists media_mime text,
  add column if not exists media_size int,
  add column if not exists times_used int not null default 0;

-- Everything typed into the Q&A tab becomes a quick reply — nothing is lost.
insert into public.whatsapp_saved_replies (workspace_id, shortcut, title, body, sort_order)
select f.workspace_id,
       btrim(left(regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g'), 24), '-'),
       f.title, f.answer, 100 + f.sort_order
  from public.whatsapp_faqs f
 where f.active
   and btrim(left(regexp_replace(lower(f.title), '[^a-z0-9]+', '-', 'g'), 24), '-') <> ''
on conflict (workspace_id, shortcut) do nothing;

-- The guide + booking messages the old automation used to send — now two
-- keystrokes away for a human, in a human voice, no icons.
insert into public.whatsapp_saved_replies (workspace_id, shortcut, title, body, sort_order)
select w.id, v.shortcut, v.title, v.body, v.sort_order
  from public.workspaces w
  cross join (values
    ('guide', 'Guide + video',
E'Great news, {{name}} — from what you have shared, you look like a strong fit for the UK Global Talent route.\n\nTwo things worth five minutes of your time:\n\nOur step-by-step process guide: {{pdf}}\n\nA short video on how the process works: {{video}}', 10),
    ('book', 'Booking link',
E'The next step is a quick call with our team to map out your case and answer your questions.\n\nPick a time that suits you here: {{booking}}', 11)
  ) as v(shortcut, title, body, sort_order)
on conflict (workspace_id, shortcut) do nothing;

create or replace function public.whatsapp_saved_reply_used(p_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update public.whatsapp_saved_replies
     set times_used = times_used + 1, updated_at = now()
   where id = p_id and workspace_id in (select user_workspaces());
$fn$;
grant execute on function public.whatsapp_saved_reply_used(uuid) to authenticated;


-- ── 6. OVERVIEW — first touch + follow-up coverage in one call ───────────────
create or replace function public.whatsapp_automation_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'settings', (select to_jsonb(a) from public.whatsapp_automation a where a.workspace_id = p_workspace_id),
    'cron', public.whatsapp_cron_status(),
    'counts', (
      select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
        from (select stage, count(*) as n
                from public.whatsapp_journeys
               where workspace_id = p_workspace_id and stop_reason is distinct from 'faq_only'
               group by stage) s),
    'entry', (
      select coalesce(jsonb_object_agg(entry_source, n), '{}'::jsonb)
        from (select entry_source, count(*) as n
                from public.whatsapp_journeys
               where workspace_id = p_workspace_id and stop_reason is distinct from 'faq_only'
               group by entry_source) e),
    'failed_jobs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'kind', q.kind, 'error', q.error,
               'updated_at', q.updated_at, 'lead_name', l.full_name,
               'phone', jj.phone_e164)
             order by q.updated_at desc), '[]'::jsonb)
        from public.whatsapp_auto_jobs q
        join public.whatsapp_journeys jj on jj.id = q.journey_id
        join public.leads l on l.id = jj.lead_id
       where q.workspace_id = p_workspace_id
         and q.status = 'failed'
         and q.updated_at > now() - interval '7 days'
       limit 12),
    'coverage', (
      select coalesce(jsonb_object_agg(v.stage, jsonb_build_object(
        'sequence_id', v.seq_id,
        'lane_on',     v.lane_on,
        'total', (select count(*) from public.leads l
                   where l.workspace_id = p_workspace_id and l.stage = v.stage
                     and coalesce(l.is_sample, false) = false),
        'no_phone', (select count(*) from public.leads l
                      where l.workspace_id = p_workspace_id and l.stage = v.stage
                        and coalesce(l.is_sample, false) = false
                        and public.whatsapp_normalize_phone(l.phone) is null),
        'in_sequence', case when v.seq_id is null then 0 else
          (select count(*) from public.whatsapp_sequence_enrollments e
            where e.sequence_id = v.seq_id) end,
        'active', case when v.seq_id is null then 0 else
          (select count(*) from public.whatsapp_sequence_enrollments e
            where e.sequence_id = v.seq_id and e.status = 'active') end,
        'paused', case when v.seq_id is null then 0 else
          (select count(*) from public.whatsapp_sequence_enrollments e
            where e.sequence_id = v.seq_id and e.status = 'paused') end,
        'completed', case when v.seq_id is null then 0 else
          (select count(*) from public.whatsapp_sequence_enrollments e
            where e.sequence_id = v.seq_id and e.status = 'completed') end,
        'untouched', (select count(*) from public.leads l
          cross join lateral (select public.whatsapp_normalize_phone(l.phone) as norm) p
          where l.workspace_id = p_workspace_id and l.stage = v.stage
            and coalesce(l.is_sample, false) = false
            and p.norm is not null
            and not exists (select 1 from public.whatsapp_suppressions su
                             where su.workspace_id = p_workspace_id and su.phone_e164 = p.norm)
            and (v.seq_id is null or not exists
                  (select 1 from public.whatsapp_sequence_enrollments en
                    where en.sequence_id = v.seq_id and en.phone_e164 = p.norm)))
      )), '{}'::jsonb)
      from (select 'cold' as stage, a.cold_sequence_id as seq_id, a.auto_enrol_cold as lane_on
              from public.whatsapp_automation a where a.workspace_id = p_workspace_id
            union all
            select 'hot', a.hot_sequence_id, a.auto_enrol_hot
              from public.whatsapp_automation a where a.workspace_id = p_workspace_id) v),
    'sequences', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
                                order by s.created_at), '[]'::jsonb)
        from public.whatsapp_sequences s where s.workspace_id = p_workspace_id),
    'journeys', (
      select coalesce(jsonb_agg(row_j order by row_j->>'updated_at' desc), '[]'::jsonb)
        from (
          select to_jsonb(j) || jsonb_build_object(
                   'lead_name', l.full_name,
                   'lead_stage', l.stage,
                   'pending_jobs', (select count(*) from public.whatsapp_auto_jobs q
                                     where q.journey_id = j.id and q.status = 'queued'))
                 as row_j
            from public.whatsapp_journeys j
            join public.leads l on l.id = j.lead_id
           where j.workspace_id = p_workspace_id
             and j.stop_reason is distinct from 'faq_only'
           order by j.updated_at desc
           limit 40) t)
  );
$fn$;
grant execute on function public.whatsapp_automation_overview(uuid) to authenticated;


-- ── 7. CRON — the enrol sweep runs itself, in SQL, no HTTP involved ──────────
do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron is not installed — the follow-up enrol sweep will NOT run by itself.';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'migrizo-whatsapp-stage-enrol';
  perform cron.schedule('migrizo-whatsapp-stage-enrol', '*/10 * * * *',
    'select public.whatsapp_stage_autoenrol();');
  raise notice 'Scheduled: cold/hot follow-up enrolment every 10 minutes.';
end $cron$;

notify pgrst, 'reload schema';

comment on function public.whatsapp_stage_autoenrol(uuid) is
  'Enrols every quiet cold/hot lead into the stage''s follow-up sequence and stops follow-ups for leads that left the stage. Cron every 10 min; the Automation tab calls it on save for an instant sweep.';

-- ── Verification ─────────────────────────────────────────────────────────────
select public.whatsapp_cron_status() as scheduler;
