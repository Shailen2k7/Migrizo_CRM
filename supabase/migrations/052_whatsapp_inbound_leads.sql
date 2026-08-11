-- =============================================================================
-- 052_whatsapp_inbound_leads.sql — PEOPLE WHO MESSAGE US FIRST
--
-- Until now a journey could only start from the Meta lead FORM. Someone who
-- taps "Chat on WhatsApp" on an ad, a website button, or just saves the number
-- and messages us was left to the Q&A brain and a human.
--
-- This migration makes that person a first-class lead:
--
--   They message us (we have never spoken)
--        → a lead is created (source "WhatsApp Inbound", stage Cold)
--        → a journey starts, entry_source = 'whatsapp_inbound'
--        → the drain reads their FIRST message and decides what to do:
--             a question we have a saved answer for → answer it, then ask
--                                                     for CV + LinkedIn
--             plain interest / a greeting            → ask for CV + LinkedIn
--             price haggling, complaint, ready-to-pay,
--             guarantee question                     → say nothing, flag a human
--             spam / wrong number                    → say nothing, journey ends
--
-- WHY FREE TEXT, NOT A TEMPLATE
--   Their message opens Meta's 24-hour window, so we may reply in our own
--   words — no template, no approval, no MARKETING frequency cap. This path
--   is therefore MORE reliable than the ad-form path, not less.
--
-- WHAT NEVER HAPPENS
--   * A suppressed (STOP) number never starts a journey.
--   * A conversation we started (sequence, campaign, manual template) never
--     gets an intro — we check there is no earlier OUTBOUND message first.
--     The intro is only for people who genuinely reached out to us.
--   * No eligibility is assumed: an inbound lead has no ad tags, so after
--     they reply a human decides — the automation never promises anything.
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. SETTINGS ─────────────────────────────────────────────────────────────
alter table public.whatsapp_automation
  add column if not exists inbound_enabled boolean not null default true,
  add column if not exists inbound_intro_message text not null default
'Hi {{name}}, thanks for reaching out to Migrizo about the UK Global Talent Visa.

To check your eligibility, our team needs two quick things:

1. Your updated CV (just attach it here)
2. Your LinkedIn profile link

Share these and we will review your profile and come back to you shortly.';


-- ── 2. JOURNEY: where did this person come from? ────────────────────────────
alter table public.whatsapp_journeys
  add column if not exists entry_source text not null default 'meta_form';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_journeys_entry_source_check') then
    alter table public.whatsapp_journeys add constraint whatsapp_journeys_entry_source_check
      check (entry_source in ('meta_form', 'whatsapp_inbound'));
  end if;
end $c$;

-- New stage: the intro job is queued but not yet sent.
alter table public.whatsapp_journeys drop constraint if exists whatsapp_journeys_stage_check;
alter table public.whatsapp_journeys add constraint whatsapp_journeys_stage_check check (stage in (
  'welcome_queued',   -- ad-form lead, template welcome pending
  'intro_queued',     -- they messaged us, intro pending  ← NEW
  'awaiting_reply',   -- first message sent, waiting on them
  'needs_review',     -- a human decides
  'eligible',         -- assets being sent
  'waiting_booking',  -- guide + booking link delivered
  'booked',           -- meeting exists — done
  'not_eligible',     -- moved to Junk
  'stopped',          -- no reply / suppressed / manual / spam
  'checking'          -- legacy value from the 050 draft
));

alter table public.whatsapp_auto_jobs drop constraint if exists whatsapp_auto_jobs_kind_check;
alter table public.whatsapp_auto_jobs add constraint whatsapp_auto_jobs_kind_check
  check (kind in ('welcome','assets','faq','reminder','cold_enrol','notify','eligibility','inbound_intro'));


-- ── 3. A LEAD FROM A PHONE NUMBER ───────────────────────────────────────────
-- Someone messaging us is a lead even though no form was filled. We create one
-- so they appear in the CRM, the pipeline and every report — with the phone as
-- the name until a human learns better, because a fake name is worse than an
-- obvious placeholder.
create or replace function public.whatsapp_auto_lead_from_inbound(
  p_ws uuid, p_conversation uuid
) returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_lead uuid; v_phone text;
begin
  select lead_id, phone_e164 into v_lead, v_phone
    from public.whatsapp_conversations where id = p_conversation;
  if v_lead is not null then return v_lead; end if;
  if v_phone is null then return null; end if;

  -- A lead may already exist for this number without being linked.
  select l.id into v_lead
    from public.leads l
   where l.workspace_id = p_ws
     and public.whatsapp_normalize_phone(l.phone) = v_phone
   order by l.created_at desc limit 1;

  if v_lead is null then
    insert into public.leads (workspace_id, full_name, phone, stage, source)
    values (p_ws, 'WhatsApp ' || v_phone, v_phone, 'cold', 'WhatsApp Inbound')
    returning id into v_lead;
  end if;

  update public.whatsapp_conversations
     set lead_id = coalesce(lead_id, v_lead) where id = p_conversation;
  return v_lead;
end;
$fn$;


-- ── 4. THE TRIGGER ──────────────────────────────────────────────────────────
-- Replaces 051's version. Everything the old one did is kept; the new part is
-- the "they contacted us first" branch at the top.
create or replace function public.whatsapp_auto_on_inbound()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  j        public.whatsapp_journeys%rowtype;
  cfg      public.whatsapp_automation%rowtype;
  v_conv   public.whatsapp_conversations%rowtype;
  v_lead   uuid;
  v_new    boolean := false;   -- did THIS message create the journey?
begin
  if new.direction <> 'in' then return new; end if;

  select * into cfg from public.whatsapp_automation where workspace_id = new.workspace_id;
  if cfg.workspace_id is null or not cfg.enabled then return new; end if;

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

  -- ═══ NEW: they reached out to us, and we have never spoken ═══════════════
  if j.id is null and cfg.inbound_enabled then
    select * into v_conv from public.whatsapp_conversations where id = new.conversation_id;

    if v_conv.id is not null
       -- an opt-out is a promise: STOP means STOP, even if they message again
       and not exists (select 1 from public.whatsapp_suppressions s
                        where s.workspace_id = new.workspace_id and s.phone_e164 = v_conv.phone_e164)
       -- WE must not have spoken first — a reply to our sequence or template
       -- is a reply, not a new enquiry, and must never get an intro
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

        -- do update fires even when the row already existed (a faq_only
        -- bookkeeping journey); only treat it as new if it really is fresh
        if j.id is not null and j.stage = 'intro_queued' then
          v_new := true;
          insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
          values (new.workspace_id, j.id, 'inbound_intro',
                  jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id));
        end if;
      end if;
    end if;
  end if;

  -- ═══ existing behaviour, unchanged ═══════════════════════════════════════
  if j.id is not null and not v_new then
    update public.whatsapp_auto_jobs
       set status = 'skipped', error = 'lead_replied'
     where journey_id = j.id and status = 'queued' and kind in ('reminder','cold_enrol');

    if j.stage in ('welcome_queued','awaiting_reply') then
      if public.whatsapp_field_eligible(j.field) then
        update public.whatsapp_journeys set stage = 'eligible' where id = j.id;
        insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind)
        select new.workspace_id, j.id, 'assets'
         where not exists (select 1 from public.whatsapp_auto_jobs q
                            where q.journey_id = j.id and q.kind = 'assets'
                              and q.status in ('queued','running','done'));
      else
        -- No ad tag (every inbound lead) or an off-list field → a human decides.
        update public.whatsapp_journeys set stage = 'needs_review' where id = j.id;
        update public.whatsapp_conversations set needs_attention = true where id = new.conversation_id;
        insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
        select new.workspace_id, j.id, 'notify',
               jsonb_build_object('reason', 'field_review', 'conversation_id', new.conversation_id)
         where not exists (select 1 from public.whatsapp_auto_jobs q
                            where q.journey_id = j.id and q.kind = 'notify'
                              and q.payload->>'reason' = 'field_review');
      end if;
    end if;
  end if;

  -- The Q&A brain sees every text message — EXCEPT the very first one of a new
  -- inbound journey, which inbound_intro answers itself. One brain per message.
  if cfg.auto_faq and coalesce(new.body, '') <> '' and not v_new then
    insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
    select new.workspace_id,
           coalesce(j.id, public.whatsapp_auto_orphan_journey(new.workspace_id, new.conversation_id)),
           'faq',
           jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id)
     where coalesce(j.id, public.whatsapp_auto_orphan_journey(new.workspace_id, new.conversation_id)) is not null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists whatsapp_auto_on_inbound on public.whatsapp_messages;
create trigger whatsapp_auto_on_inbound after insert on public.whatsapp_messages
  for each row execute function public.whatsapp_auto_on_inbound();


-- ── 5. OVERVIEW: split the two entry doors ──────────────────────────────────
create or replace function public.whatsapp_automation_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'settings', (select to_jsonb(a) from public.whatsapp_automation a where a.workspace_id = p_workspace_id),
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
    'faqs', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order, f.created_at), '[]'::jsonb)
        from public.whatsapp_faqs f where f.workspace_id = p_workspace_id),
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

-- The human decision must also work for an inbound lead sitting at intro_queued.
create or replace function public.whatsapp_journey_decide(p_journey_id uuid, p_eligible boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare j public.whatsapp_journeys%rowtype;
begin
  select * into j from public.whatsapp_journeys where id = p_journey_id;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.is_campaign_admin(j.workspace_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;
  if j.stage not in ('needs_review','awaiting_reply','checking','intro_queued') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_stage', 'stage', j.stage);
  end if;

  if p_eligible then
    update public.whatsapp_journeys
       set stage = 'eligible',
           eligibility = coalesce(eligibility, '{}'::jsonb) || jsonb_build_object('verdict','eligible','decided_by','human')
     where id = p_journey_id;
    insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind)
    values (j.workspace_id, p_journey_id, 'assets');
  else
    update public.whatsapp_journeys
       set stage = 'not_eligible',
           eligibility = coalesce(eligibility, '{}'::jsonb) || jsonb_build_object('verdict','not_eligible','decided_by','human')
     where id = p_journey_id;
    update public.leads set stage = 'junk', updated_at = now()
     where id = j.lead_id and stage in ('cold','hot');
  end if;

  insert into public.activity (workspace_id, user_id, lead_id, action, meta)
  values (j.workspace_id, auth.uid(), j.lead_id, 'whatsapp_journey_decided',
          jsonb_build_object('eligible', p_eligible));
  return jsonb_build_object('ok', true);
end;
$fn$;

grant execute on function public.whatsapp_automation_overview(uuid) to authenticated;
grant execute on function public.whatsapp_journey_decide(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

comment on column public.whatsapp_journeys.entry_source is
  'meta_form = came from the ad form (has field/pay tags). whatsapp_inbound = messaged us first (no tags, human decides eligibility).';
