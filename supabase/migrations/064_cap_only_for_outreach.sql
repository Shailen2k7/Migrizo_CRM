-- ============================================================================
-- 064 — The daily cap protects the number from OUTREACH, not from conversation.
--
-- The bug: the cap counted EVERY outbound message. So a day of campaign sends
-- used up the allowance and then a human could not answer a lead who had just
-- written in — the CRM refused with "Daily cap reached". That is backwards.
-- Replying to someone who messaged you is the safest traffic on WhatsApp; it
-- is what Meta wants and it costs you nothing in quality rating.
--
-- The rule from now on (this is how Interakt and every good BSP behave):
--
--   • Business-INITIATED message (their 24h window is shut) → counts.
--       campaign steps, cold outreach, re-engagement templates
--   • Message inside an OPEN 24-hour window (they wrote to us first) → free.
--       every human reply in the inbox, quick replies, follow-up answers
--
-- Implemented once, in the database, so no code path can forget it: the
-- decision is stamped on each message the moment it is recorded.
-- ============================================================================

-- ── 1. Stamp every message with whether it spends the allowance ─────────────
alter table public.whatsapp_messages
  add column if not exists counts_toward_cap boolean not null default true;

comment on column public.whatsapp_messages.counts_toward_cap is
  'true = business-initiated (spends the daily cap). false = sent inside an open 24h window, i.e. a reply — never capped.';

create index if not exists wa_msgs_cap_count
  on public.whatsapp_messages (workspace_id, created_at)
  where direction = 'out' and counts_toward_cap;

-- Backfill history: anything sent while that conversation's window was open
-- was a reply, so it should never have spent the allowance. This makes today's
-- counter correct the moment the migration lands.
update public.whatsapp_messages m
   set counts_toward_cap = false
  from public.whatsapp_conversations c
 where c.id = m.conversation_id
   and m.direction = 'out'
   and m.counts_toward_cap
   and m.sequence_step is null            -- never a campaign step
   and exists (
     select 1 from public.whatsapp_messages inb
      where inb.conversation_id = m.conversation_id
        and inb.direction = 'in'
        and inb.created_at <= m.created_at
        and inb.created_at > m.created_at - interval '24 hours'
   );


-- ── 2. Record the decision at write time ────────────────────────────────────
create or replace function public.whatsapp_record_outbound(
  p_workspace_id  uuid,
  p_phone         text,
  p_body          text,
  p_template_code text default null,
  p_category      text default null,
  p_variables     jsonb default null,
  p_sent_by       uuid default null,
  p_lead_id       uuid default null,
  p_step          text default null,
  p_media_path    text default null,
  p_media_type    text default null,
  p_media_name    text default null,
  p_media_mime    text default null,
  p_media_size    int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_conv uuid; v_lead uuid; v_msg uuid; v_preview text;
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_last_in timestamptz; v_counts boolean;
begin
  -- RULE 2: suppressed numbers are never messaged, no matter who asks.
  if exists (select 1 from public.whatsapp_suppressions
              where workspace_id = p_workspace_id and phone_e164 = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;

  v_conv := public.whatsapp_find_or_create_conversation(p_workspace_id, p_phone, p_lead_id);
  select lead_id, last_inbound_at into v_lead, v_last_in
    from public.whatsapp_conversations where id = v_conv;

  -- THE RULE. A campaign step always counts (it is outreach by definition).
  -- Anything else counts only if their 24-hour window is shut — meaning we are
  -- starting the conversation rather than continuing one they started.
  v_counts := (p_step is not null)
              or v_last_in is null
              or v_last_in <= now() - interval '24 hours';

  insert into public.whatsapp_messages
    (workspace_id, conversation_id, lead_id, direction, body, template_code,
     template_category, variables, sent_by, sequence_step, status,
     media_path, media_type, media_name, media_mime, media_size,
     counts_toward_cap)
  values
    (p_workspace_id, v_conv, v_lead, 'out', coalesce(p_body,''), p_template_code,
     p_category, p_variables, p_sent_by, p_step, 'queued',
     p_media_path, p_media_type, p_media_name, p_media_mime, p_media_size,
     v_counts)
  returning id into v_msg;

  v_preview := nullif(btrim(coalesce(p_body,'')), '');
  if v_preview is null and p_media_type is not null then
    v_preview := case p_media_type
                   when 'image'    then '📷 Photo'
                   when 'document' then '📄 ' || coalesce(p_media_name, 'Document')
                   when 'audio'    then '🎤 Voice note'
                   when 'video'    then '🎬 Video'
                   else '📎 Attachment' end;
  end if;

  update public.whatsapp_conversations
     set last_outbound_at = now(), last_message_at = now(),
         last_preview = left(coalesce(v_preview, ''), 180), last_direction = 'out',
         updated_at = now()
   where id = v_conv;

  return jsonb_build_object('ok', true, 'message_id', v_msg,
                            'conversation_id', v_conv, 'lead_id', v_lead,
                            'counts_toward_cap', v_counts);
end;
$fn$;

grant execute on function public.whatsapp_record_outbound(uuid, text, text, text, text, jsonb, uuid, uuid, text, text, text, text, text, int) to service_role;


-- ── 3. The gate counts outreach only ────────────────────────────────────────
-- Same shape as before so nothing that reads it breaks; `sent_today` now means
-- "outreach sent today", and `replies_today` is reported alongside so the
-- Settings screen can show that conversation traffic was never charged.
create or replace function public.whatsapp_can_send(p_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select * from public.whatsapp_settings where workspace_id = p_workspace_id
  ), day as (
    select date_trunc('day', now() at time zone 'Asia/Kolkata')
             at time zone 'Asia/Kolkata' as start_at
  ), used as (
    select count(*) as n from public.whatsapp_messages m, day
     where m.workspace_id = p_workspace_id and m.direction = 'out'
       and m.created_at >= day.start_at
       and m.status <> 'failed'
       and m.counts_toward_cap
  ), free as (
    select count(*) as n from public.whatsapp_messages m, day
     where m.workspace_id = p_workspace_id and m.direction = 'out'
       and m.created_at >= day.start_at
       and m.status <> 'failed'
       and not m.counts_toward_cap
  )
  select jsonb_build_object(
    'allowed',      coalesce((select connected from s), false)
                    and not coalesce((select sending_paused from s), false)
                    and (select n from used) < coalesce((select daily_cap from s), 100),
    'connected',    coalesce((select connected from s), false),
    'dry_run',      coalesce((select dry_run from s), true),
    'cap',          coalesce((select daily_cap from s), 100),
    'sent_today',   (select n from used),
    'replies_today',(select n from free),
    'remaining',    greatest(0, coalesce((select daily_cap from s), 100) - (select n from used)),
    'paused',       coalesce((select sending_paused from s), false),
    'reason',       (select pause_reason from s)
  );
$$;

grant execute on function public.whatsapp_can_send(uuid) to authenticated, service_role;


-- ── 4. The engine's own counter uses the same definition ────────────────────
-- wa_claim counted every outbound row, so a busy day of human replies could
-- starve the campaign of its allowance (and vice versa). One definition now.
create or replace function public.wa_claim(p_workspace_id uuid, p_batch int default 10)
returns table (
  person_id uuid, campaign_id uuid, campaign_name text, step_no int,
  template_code text, template_body text, template_variables jsonb,
  template_language text, template_category text,
  lead_id uuid, phone_e164 text, lead_name text
)
language plpgsql security definer set search_path = public as $fn$
declare
  v_cap int; v_used int; v_remaining int; v_claimed int := 0;
  v_day timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  r record; s record;
begin
  if not public.whatsapp_in_send_window(p_workspace_id) then return; end if;

  select coalesce(daily_cap, 100) into v_cap
    from public.whatsapp_settings where workspace_id = p_workspace_id;
  select count(*) into v_used from public.whatsapp_messages m
   where m.workspace_id = p_workspace_id and m.direction = 'out'
     and m.status <> 'failed' and m.created_at >= v_day
     and m.counts_toward_cap;                      -- ← replies are free
  v_remaining := greatest(0, v_cap - v_used);
  if v_remaining = 0 then return; end if;

  for r in
    select p.id, p.campaign_id, p.next_step, p.lead_id, p.phone_e164, c.name
      from public.wa_campaign_people p
      join public.wa_campaigns c on c.id = p.campaign_id
     where p.workspace_id = p_workspace_id
       and p.status = 'waiting' and c.status = 'running'
       and p.next_send_at is not null and p.next_send_at <= now()
     order by p.next_send_at
       for update of p skip locked
     limit greatest(p_batch * 3, 30)
  loop
    exit when v_claimed >= least(p_batch, v_remaining);

    if exists (select 1 from public.whatsapp_suppressions su
                where su.workspace_id = p_workspace_id and su.phone_e164 = r.phone_e164) then
      update public.wa_campaign_people
         set status = 'stopped', stop_reason = 'opted_out', next_send_at = null
       where id = r.id;
      continue;
    end if;

    select st.step_no, st.template_id, t.code, t.body, t.variables, t.language, t.category, t.active
      into s
      from public.wa_campaign_steps st
      join public.whatsapp_templates t on t.id = st.template_id
     where st.campaign_id = r.campaign_id and st.step_no = r.next_step;

    if s is null then
      update public.wa_campaign_people
         set status = 'done', next_send_at = null where id = r.id;
      continue;
    end if;
    if not s.active then
      update public.wa_campaign_people
         set next_send_at = now() + interval '6 hours',
             last_error = 'template "' || s.code || '" is retired — replace it in the step list'
       where id = r.id;
      continue;
    end if;

    update public.wa_campaign_people set next_send_at = now() + interval '10 minutes'
     where id = r.id;

    v_claimed           := v_claimed + 1;
    person_id           := r.id;
    campaign_id         := r.campaign_id;
    campaign_name       := r.name;
    step_no             := s.step_no;
    template_code       := s.code;
    template_body       := s.body;
    template_variables  := s.variables;
    template_language   := s.language;
    template_category   := s.category;
    lead_id             := r.lead_id;
    phone_e164          := r.phone_e164;
    lead_name           := coalesce((select l.full_name from public.leads l where l.id = r.lead_id),
                                    r.phone_e164);
    return next;
  end loop;
end;
$fn$;

grant execute on function public.wa_claim(uuid, int) to service_role;

notify pgrst, 'reload schema';

-- Proof: today's numbers under the new rule.
select (public.whatsapp_can_send(workspace_id) -> 'cap')           as cap,
       (public.whatsapp_can_send(workspace_id) -> 'sent_today')    as outreach_today,
       (public.whatsapp_can_send(workspace_id) -> 'replies_today') as replies_today_free,
       (public.whatsapp_can_send(workspace_id) -> 'remaining')     as outreach_left
  from public.whatsapp_settings;
