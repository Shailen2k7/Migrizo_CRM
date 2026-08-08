-- ============================================================================
-- 040: WHATSAPP — messaging core (Interakt)
--
-- Stage 1. Everything needed to send, receive, and keep the conversation on
-- the lead. Sequences arrive in 041.
--
-- THREE BEHAVIOUR RULES, decided with Shailen — the code below enforces them:
--
--   1. A REPLY DOES NOT STOP ANYTHING.
--      Replying means interested, not converted. An inbound message flags the
--      conversation (unread + needs_attention) and notifies the owner. The
--      sequence keeps running until a human pauses it, exactly like the email
--      Campaign Center. Pause / Resume / Stop live in whatsapp_lead_action().
--
--   2. "STOP" OR "NO" IS FINAL.
--      An opt-out keyword suppresses the number forever, moves the lead to
--      stage = 'junk', and exits every sequence they are in — WhatsApp AND
--      email. We never message them again on any channel.
--
--   3. ONE CHANNEL PER LEAD.
--      A lead in a live email sequence cannot be enrolled in WhatsApp and vice
--      versa. Enforced in 041 where WhatsApp enrolment is created; the exit
--      side is enforced here.
--
-- Idempotent. Safe to run twice.
-- ============================================================================


-- ── 1. PHONE NORMALISATION ──────────────────────────────────────────────────
-- Interakt wants the country code WITHOUT the "+". leads.phone is free text
-- typed by humans: "+91 98201 44518", "098201 44518", "9820144518", "0091...".
-- One function, IMMUTABLE so we can index on it.

create or replace function public.whatsapp_normalize_phone(
  p_raw text,
  p_default_cc text default '91'
) returns text
language plpgsql immutable as $fn$
declare d text; v_intl boolean;
begin
  if p_raw is null then return null; end if;

  d := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- Did the writer already tell us this is international? A leading "+" or a
  -- "00" trunk prefix means the country code is ALREADY on the front, so we
  -- must not add one. Without this a Singapore number (+65 8123 4567 -> ten
  -- digits) is read as an Indian national number and silently becomes
  -- 916581234567 — a real number belonging to somebody else.
  v_intl := (left(btrim(p_raw), 1) = '+') or (left(d, 2) = '00');

  if left(d, 2) = '00' then d := substr(d, 3); end if;
  while left(d, 1) = '0' loop d := substr(d, 2); end loop;
  if d = '' then return null; end if;

  -- Only a bare national number gets the default country code.
  if not v_intl and length(d) = 10 then d := p_default_cc || d; end if;

  -- sanity: E.164 is 8..15 digits including country code
  if length(d) < 8 or length(d) > 15 then return null; end if;

  return d;
end;
$fn$;

comment on function public.whatsapp_normalize_phone(text, text) is
  'Free-text phone -> E.164 digits with no leading +. Returns NULL when unusable.';

-- Find a lead by phone fast (webhook does this on every inbound message).
-- Dropped first so re-running this file after any change to the function above
-- rebuilds the index against the new behaviour instead of keeping stale keys.
drop index if exists public.idx_leads_phone_norm;
create index if not exists idx_leads_phone_norm
  on public.leads (workspace_id, public.whatsapp_normalize_phone(phone))
  where phone is not null;


-- ── 2. OPT-OUT KEYWORD DETECTION ────────────────────────────────────────────
-- Deliberately strict: we match the whole message, not a substring. "No, tell
-- me more" must NOT junk the lead. Our own templates end with "Just reply NO",
-- so a bare NO is a real opt-out.

create or replace function public.whatsapp_is_optout(p_body text)
returns boolean
language sql immutable as $$
  select btrim(regexp_replace(
           upper(regexp_replace(coalesce(p_body, ''), '[^A-Za-z ]', '', 'g')),
           '\s+', ' ', 'g'))
         = any (array[
           'STOP','NO','UNSUBSCRIBE','UNSUB','OPT OUT','OPTOUT',
           'REMOVE','REMOVE ME','DND','NOT INTERESTED','DONT CONTACT',
           'DO NOT CONTACT','LEAVE ME ALONE','NAHI','BAND KARO'
         ]);
$$;


-- ── 3. TABLES ───────────────────────────────────────────────────────────────

-- Connection + safety config. Secrets live in Netlify env, never here.
create table if not exists public.whatsapp_settings (
  workspace_id      uuid primary key references public.workspaces(id) on delete cascade,
  phone_e164        text,                                   -- 918976543210
  display_number    text,                                   -- "+91 89765 43210"
  waba_id           text,
  connected         boolean not null default false,
  dry_run           boolean not null default true,          -- ON until first real send
  daily_cap         int     not null default 100,
  auto_pause_below  text    not null default 'HIGH'
                    check (auto_pause_below in ('HIGH','MEDIUM','LOW','NEVER')),
  quality_rating    text,                                   -- HIGH | MEDIUM | LOW
  messaging_tier    int,
  sending_paused    boolean not null default false,
  pause_reason      text,
  last_tested_at    timestamptz,
  last_test_error   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One row per lead we have ever messaged on WhatsApp.
create table if not exists public.whatsapp_conversations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  lead_id           uuid references public.leads(id) on delete set null,
  phone_e164        text not null,
  owner_id          uuid,                                   -- who picks up replies
  status            text not null default 'open' check (status in ('open','closed')),
  unread_count      int  not null default 0,
  needs_attention   boolean not null default false,         -- RULE 1: replied, human should look
  last_inbound_at   timestamptz,                            -- drives the 24h window
  last_outbound_at  timestamptz,
  last_message_at   timestamptz,
  last_preview      text,
  last_direction    text check (last_direction in ('in','out')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, phone_e164)
);

create index if not exists idx_wa_conv_ws     on public.whatsapp_conversations (workspace_id, last_message_at desc);
create index if not exists idx_wa_conv_lead   on public.whatsapp_conversations (lead_id);
create index if not exists idx_wa_conv_unread on public.whatsapp_conversations (workspace_id) where unread_count > 0;

-- Every message, both directions.
create table if not exists public.whatsapp_messages (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  conversation_id   uuid not null references public.whatsapp_conversations(id) on delete cascade,
  lead_id           uuid references public.leads(id) on delete set null,
  direction         text not null check (direction in ('in','out')),
  body              text not null default '',
  template_code     text,                                   -- null = free-form
  template_category text check (template_category in ('MARKETING','UTILITY','AUTHENTICATION')),
  variables         jsonb,                                  -- what we filled in
  provider_msg_id   text,                                   -- Interakt's id, for receipts
  status            text not null default 'queued'
                    check (status in ('queued','sent','delivered','read','failed','received')),
  error_code        text,
  error_detail      text,
  sent_by           uuid,                                   -- null = automation
  sequence_step     text,                                   -- e.g. 'C3' when sent by 041
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_wa_msg_conv on public.whatsapp_messages (conversation_id, created_at);
create index if not exists idx_wa_msg_prov on public.whatsapp_messages (provider_msg_id) where provider_msg_id is not null;
create index if not exists idx_wa_msg_ws   on public.whatsapp_messages (workspace_id, created_at desc);

-- Meta-approved templates, authored here and submitted through Interakt.
create table if not exists public.whatsapp_templates (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  code           text not null,                             -- migrizo_cold_01
  name           text not null,                             -- "Cold 1 · The 1/2/3 question"
  track          text not null default 'cold' check (track in ('cold','hot','utility','custom')),
  category       text not null default 'MARKETING'
                 check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  language       text not null default 'en',
  body           text not null,                             -- with {{1}} {{2}} placeholders
  variables      jsonb not null default '[]'::jsonb,        -- [{n,label,default}]
  meta_status    text not null default 'draft'
                 check (meta_status in ('draft','submitted','approved','rejected','paused')),
  meta_reason    text,
  step_no        int,                                       -- position in its track
  day_offset     int,                                       -- days after enrolment (041 uses this)
  is_seeded      boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, code)
);

create index if not exists idx_wa_tpl_ws on public.whatsapp_templates (workspace_id, track, step_no);

-- RULE 2. Never message these numbers again, on any channel.
create table if not exists public.whatsapp_suppressions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone_e164   text not null,
  lead_id      uuid references public.leads(id) on delete set null,
  reason       text not null default 'stop_reply'
               check (reason in ('stop_reply','invalid_number','manual','bounced','complaint')),
  keyword      text,                                        -- the literal word they sent
  created_at   timestamptz not null default now(),
  unique (workspace_id, phone_e164)
);

create index if not exists idx_wa_supp on public.whatsapp_suppressions (workspace_id, phone_e164);


-- ── 4. TOUCH TRIGGERS ───────────────────────────────────────────────────────
create or replace function public.whatsapp_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['whatsapp_settings','whatsapp_conversations','whatsapp_messages','whatsapp_templates'] loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function public.whatsapp_touch()', t);
  end loop;
end $$;


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Conversations + messages: any active workspace member (the whole sales team
-- needs to chat). Settings, templates, suppressions: campaign admins only.

alter table public.whatsapp_settings      enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages      enable row level security;
alter table public.whatsapp_templates     enable row level security;
alter table public.whatsapp_suppressions  enable row level security;

drop policy if exists "wa members conversations" on public.whatsapp_conversations;
create policy "wa members conversations" on public.whatsapp_conversations for all to authenticated
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "wa members messages" on public.whatsapp_messages;
create policy "wa members messages" on public.whatsapp_messages for all to authenticated
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "wa read templates" on public.whatsapp_templates;
create policy "wa read templates" on public.whatsapp_templates for select to authenticated
  using (workspace_id in (select user_workspaces()));

drop policy if exists "wa admin templates" on public.whatsapp_templates;
create policy "wa admin templates" on public.whatsapp_templates for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "wa read settings" on public.whatsapp_settings;
create policy "wa read settings" on public.whatsapp_settings for select to authenticated
  using (workspace_id in (select user_workspaces()));

drop policy if exists "wa admin settings" on public.whatsapp_settings;
create policy "wa admin settings" on public.whatsapp_settings for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "wa read suppressions" on public.whatsapp_suppressions;
create policy "wa read suppressions" on public.whatsapp_suppressions for select to authenticated
  using (workspace_id in (select user_workspaces()));

drop policy if exists "wa admin suppressions" on public.whatsapp_suppressions;
create policy "wa admin suppressions" on public.whatsapp_suppressions for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));


-- ── 6. CONVERSATION RESOLUTION ──────────────────────────────────────────────
-- Called by both the send route and the webhook. Matches an existing thread by
-- number; otherwise creates one and links it to a lead if we can find one.

create or replace function public.whatsapp_find_or_create_conversation(
  p_workspace_id uuid,
  p_phone        text,
  p_lead_id      uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_lead  uuid := p_lead_id;
  v_owner uuid;
  v_id    uuid;
begin
  if v_phone is null then
    raise exception 'whatsapp: unusable phone number %', p_phone;
  end if;

  select id into v_id
    from public.whatsapp_conversations
   where workspace_id = p_workspace_id and phone_e164 = v_phone;
  if v_id is not null then
    -- late lead link (number messaged us before the lead existed)
    if v_lead is not null then
      update public.whatsapp_conversations
         set lead_id = coalesce(lead_id, v_lead)
       where id = v_id;
    end if;
    return v_id;
  end if;

  if v_lead is null then
    select l.id into v_lead
      from public.leads l
     where l.workspace_id = p_workspace_id
       and public.whatsapp_normalize_phone(l.phone) = v_phone
     order by l.created_at desc
     limit 1;
  end if;

  -- RULE: cold replies go to Prateek. Owner resolution is workspace owner as
  -- the safe default; 041 overrides per-sequence.
  select w.owner_id into v_owner from public.workspaces w where w.id = p_workspace_id;

  insert into public.whatsapp_conversations (workspace_id, lead_id, phone_e164, owner_id)
  values (p_workspace_id, v_lead, v_phone, v_owner)
  returning id into v_id;

  return v_id;
end;
$fn$;


-- ── 7. RULE 2 — OPT-OUT: suppress, junk, exit every sequence ────────────────

create or replace function public.whatsapp_optout(
  p_workspace_id uuid,
  p_phone        text,
  p_keyword      text default null,
  p_reason       text default 'stop_reply'
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_lead  uuid;
  v_email text;
begin
  if v_phone is null then return null; end if;

  select c.lead_id into v_lead
    from public.whatsapp_conversations c
   where c.workspace_id = p_workspace_id and c.phone_e164 = v_phone;

  if v_lead is null then
    select l.id into v_lead from public.leads l
     where l.workspace_id = p_workspace_id
       and public.whatsapp_normalize_phone(l.phone) = v_phone
     limit 1;
  end if;

  -- a) never message this number again
  insert into public.whatsapp_suppressions (workspace_id, phone_e164, lead_id, reason, keyword)
  values (p_workspace_id, v_phone, v_lead, p_reason, p_keyword)
  on conflict (workspace_id, phone_e164) do nothing;

  -- b) close the thread and clear the attention flag
  update public.whatsapp_conversations
     set status = 'closed', needs_attention = false, unread_count = 0, updated_at = now()
   where workspace_id = p_workspace_id and phone_e164 = v_phone;

  if v_lead is not null then
    -- c) lead becomes junk (the email engine's maintenance pass already treats
    --    stage = 'junk' as do-not-contact, so this covers both channels)
    update public.leads
       set stage = 'junk', updated_at = now()
     where id = v_lead and stage <> 'won';

    -- d) belt and braces: exit any live email enrolment right now rather than
    --    waiting for the next maintenance tick
    if to_regclass('public.lead_sequences') is not null then
      update public.lead_sequences
         set status = 'do_not_contact', exit_reason = 'unsubscribed',
             exited_at = now(), updated_at = now()
       where lead_id = v_lead
         and status in ('active','paused','sleeping','reengagement');
    end if;

    -- e) and suppress their email too — one opt-out means all channels
    select l.email into v_email from public.leads l where l.id = v_lead;
    if v_email is not null and v_email <> '' and to_regclass('public.email_suppressions') is not null then
      insert into public.email_suppressions (workspace_id, email, reason)
      values (p_workspace_id, lower(v_email), 'unsubscribe')
      on conflict (workspace_id, email) do nothing;
    end if;

    insert into public.activity (workspace_id, user_id, lead_id, action, meta)
    values (p_workspace_id, null, v_lead, 'whatsapp_optout',
            jsonb_build_object('phone', v_phone, 'keyword', p_keyword, 'reason', p_reason,
                               'moved_to', 'junk'));
  end if;

  return v_lead;
end;
$fn$;


-- ── 8. INBOUND (webhook) ────────────────────────────────────────────────────
-- RULE 1 lives here: we flag, we do NOT stop the sequence.

create or replace function public.whatsapp_record_inbound(
  p_workspace_id  uuid,
  p_phone         text,
  p_body          text,
  p_provider_id   text default null,
  p_sent_at       timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_conv   uuid;
  v_lead   uuid;
  v_msg    uuid;
  v_optout boolean := public.whatsapp_is_optout(p_body);
begin
  v_conv := public.whatsapp_find_or_create_conversation(p_workspace_id, p_phone);
  select lead_id into v_lead from public.whatsapp_conversations where id = v_conv;

  -- idempotency: Interakt retries webhooks
  if p_provider_id is not null then
    select id into v_msg from public.whatsapp_messages where provider_msg_id = p_provider_id;
    if v_msg is not null then
      return jsonb_build_object('duplicate', true, 'message_id', v_msg, 'conversation_id', v_conv);
    end if;
  end if;

  insert into public.whatsapp_messages
    (workspace_id, conversation_id, lead_id, direction, body, provider_msg_id, status, created_at)
  values
    (p_workspace_id, v_conv, v_lead, 'in', coalesce(p_body,''), p_provider_id, 'received', p_sent_at)
  returning id into v_msg;

  update public.whatsapp_conversations
     set last_inbound_at  = p_sent_at,     -- opens the 24-hour window
         last_message_at  = p_sent_at,
         last_preview     = left(coalesce(p_body,''), 180),
         last_direction   = 'in',
         unread_count     = unread_count + 1,
         needs_attention  = true,          -- RULE 1: surface it, don't act on it
         status           = 'open',
         updated_at       = now()
   where id = v_conv;

  if v_lead is not null then
    insert into public.activity (workspace_id, user_id, lead_id, action, meta)
    values (p_workspace_id, null, v_lead, 'whatsapp_received',
            jsonb_build_object('preview', left(coalesce(p_body,''), 180), 'conversation_id', v_conv));
  end if;

  -- RULE 2 overrides everything
  if v_optout then
    perform public.whatsapp_optout(p_workspace_id, p_phone, upper(trim(p_body)), 'stop_reply');
  end if;

  return jsonb_build_object(
    'duplicate', false, 'message_id', v_msg, 'conversation_id', v_conv,
    'lead_id', v_lead, 'optout', v_optout);
end;
$fn$;


-- ── 9. OUTBOUND + DELIVERY RECEIPTS ─────────────────────────────────────────

create or replace function public.whatsapp_record_outbound(
  p_workspace_id  uuid,
  p_phone         text,
  p_body          text,
  p_template_code text default null,
  p_category      text default null,
  p_variables     jsonb default null,
  p_sent_by       uuid default null,
  p_lead_id       uuid default null,
  p_step          text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_conv uuid; v_lead uuid; v_msg uuid;
  v_phone text := public.whatsapp_normalize_phone(p_phone);
begin
  -- RULE 2: suppressed numbers are never messaged, no matter who asks
  if exists (select 1 from public.whatsapp_suppressions
              where workspace_id = p_workspace_id and phone_e164 = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;

  v_conv := public.whatsapp_find_or_create_conversation(p_workspace_id, p_phone, p_lead_id);
  select lead_id into v_lead from public.whatsapp_conversations where id = v_conv;

  insert into public.whatsapp_messages
    (workspace_id, conversation_id, lead_id, direction, body, template_code,
     template_category, variables, sent_by, sequence_step, status)
  values
    (p_workspace_id, v_conv, v_lead, 'out', coalesce(p_body,''), p_template_code,
     p_category, p_variables, p_sent_by, p_step, 'queued')
  returning id into v_msg;

  update public.whatsapp_conversations
     set last_outbound_at = now(), last_message_at = now(),
         last_preview = left(coalesce(p_body,''), 180), last_direction = 'out',
         updated_at = now()
   where id = v_conv;

  return jsonb_build_object('ok', true, 'message_id', v_msg,
                            'conversation_id', v_conv, 'lead_id', v_lead);
end;
$fn$;

-- Attach Interakt's id once the API call returns.
create or replace function public.whatsapp_attach_provider_id(
  p_message_id uuid, p_provider_id text
) returns void
language sql security definer set search_path = public as $$
  update public.whatsapp_messages
     set provider_msg_id = p_provider_id, status = 'sent', updated_at = now()
   where id = p_message_id;
$$;

-- Delivery receipts from the webhook. Never moves a status backwards.
create or replace function public.whatsapp_update_status(
  p_provider_id text,
  p_status      text,
  p_error_code  text default null,
  p_error_detail text default null
) returns boolean
language plpgsql security definer set search_path = public as $fn$
declare
  v_rank  int;
  v_cur   int;
  v_id    uuid;
  v_lead  uuid;
  v_ws    uuid;
begin
  select id, lead_id, workspace_id,
         case status when 'queued' then 0 when 'sent' then 1 when 'delivered' then 2
                     when 'read' then 3 when 'failed' then 9 else 0 end
    into v_id, v_lead, v_ws, v_cur
    from public.whatsapp_messages where provider_msg_id = p_provider_id;

  if v_id is null then return false; end if;

  v_rank := case p_status when 'sent' then 1 when 'delivered' then 2
                          when 'read' then 3 when 'failed' then 9 else -1 end;
  if v_rank < 0 then return false; end if;
  if v_cur = 9 and v_rank <> 9 then return false; end if;   -- failed is terminal
  if v_rank <= v_cur then return true; end if;              -- out-of-order receipt

  update public.whatsapp_messages
     set status = p_status, error_code = p_error_code,
         error_detail = p_error_detail, updated_at = now()
   where id = v_id;

  if p_status = 'failed' and v_lead is not null then
    insert into public.activity (workspace_id, user_id, lead_id, action, meta)
    values (v_ws, null, v_lead, 'whatsapp_failed',
            jsonb_build_object('code', p_error_code, 'detail', p_error_detail));
  end if;

  return true;
end;
$fn$;


-- ── 10. INBOX READS ─────────────────────────────────────────────────────────
-- One RPC for the whole conversation list. Keeps the page to a single query.

create or replace function public.whatsapp_conversations_list(
  p_workspace_id uuid,
  p_limit        int default 300
) returns table (
  id uuid, lead_id uuid, phone_e164 text, lead_name text, lead_stage text,
  visa_type text, owner_id uuid, status text,
  unread_count int, needs_attention boolean,
  last_inbound_at timestamptz, last_message_at timestamptz,
  last_preview text, last_direction text,
  window_open boolean, window_expires_at timestamptz, suppressed boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.lead_id, c.phone_e164,
         coalesce(l.full_name, c.phone_e164) as lead_name,
         l.stage, l.visa_type, c.owner_id,
         c.status, c.unread_count, c.needs_attention,
         c.last_inbound_at, c.last_message_at, c.last_preview, c.last_direction,
         (c.last_inbound_at is not null and c.last_inbound_at > now() - interval '24 hours') as window_open,
         (c.last_inbound_at + interval '24 hours') as window_expires_at,
         exists (select 1 from public.whatsapp_suppressions s
                  where s.workspace_id = c.workspace_id and s.phone_e164 = c.phone_e164) as suppressed
    from public.whatsapp_conversations c
    left join public.leads l on l.id = c.lead_id
   where c.workspace_id = p_workspace_id
     and c.workspace_id in (select user_workspaces())
   order by c.last_message_at desc nulls last
   limit p_limit;
$$;

create or replace function public.whatsapp_thread(
  p_conversation_id uuid,
  p_limit           int default 400
) returns setof public.whatsapp_messages
language sql stable security definer set search_path = public as $$
  select m.* from public.whatsapp_messages m
   where m.conversation_id = p_conversation_id
     and m.workspace_id in (select user_workspaces())
   order by m.created_at asc
   limit p_limit;
$$;

create or replace function public.whatsapp_mark_read(p_conversation_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.whatsapp_conversations
     set unread_count = 0, updated_at = now()
   where id = p_conversation_id
     and workspace_id in (select user_workspaces());
$$;

-- Bigin's "Mark as Closed". Also clears the attention flag.
create or replace function public.whatsapp_set_conversation_status(
  p_conversation_id uuid, p_status text
) returns text
language plpgsql security definer set search_path = public as $fn$
begin
  if p_status not in ('open','closed') then return 'bad_status'; end if;
  update public.whatsapp_conversations
     set status = p_status,
         needs_attention = case when p_status = 'closed' then false else needs_attention end,
         updated_at = now()
   where id = p_conversation_id
     and workspace_id in (select user_workspaces());
  return p_status;
end;
$fn$;

-- Clear the "they replied, look at me" flag without closing the thread.
create or replace function public.whatsapp_clear_attention(p_conversation_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.whatsapp_conversations
     set needs_attention = false, updated_at = now()
   where id = p_conversation_id
     and workspace_id in (select user_workspaces());
$$;

-- Manual suppression from the UI ("junk this lead").
create or replace function public.whatsapp_suppress_manual(p_conversation_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_phone text;
begin
  select workspace_id, phone_e164 into v_ws, v_phone
    from public.whatsapp_conversations
   where id = p_conversation_id and workspace_id in (select user_workspaces());
  if v_ws is null then return null; end if;
  return public.whatsapp_optout(v_ws, v_phone, null, 'manual');
end;
$fn$;

-- Topbar counters.
create or replace function public.whatsapp_stats(p_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'conversations', (select count(*) from public.whatsapp_conversations
                       where workspace_id = p_workspace_id),
    'unread',        (select count(*) from public.whatsapp_conversations
                       where workspace_id = p_workspace_id and unread_count > 0),
    'attention',     (select count(*) from public.whatsapp_conversations
                       where workspace_id = p_workspace_id and needs_attention),
    'window_open',   (select count(*) from public.whatsapp_conversations
                       where workspace_id = p_workspace_id
                         and last_inbound_at > now() - interval '24 hours'),
    'sent_today',    (select count(*) from public.whatsapp_messages
                       where workspace_id = p_workspace_id and direction = 'out'
                         and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
                                            at time zone 'Asia/Kolkata'
                         and status <> 'failed'),
    'failed_today',  (select count(*) from public.whatsapp_messages
                       where workspace_id = p_workspace_id and direction = 'out'
                         and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
                                            at time zone 'Asia/Kolkata'
                         and status = 'failed'),
    'suppressed',    (select count(*) from public.whatsapp_suppressions
                       where workspace_id = p_workspace_id)
  ) where p_workspace_id in (select user_workspaces());
$$;

-- Daily cap check, used by the send route and by 041's drain.
-- Always returns a row, even before the settings row exists.
create or replace function public.whatsapp_can_send(p_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select * from public.whatsapp_settings where workspace_id = p_workspace_id
  ), used as (
    select count(*) as n from public.whatsapp_messages m
     where m.workspace_id = p_workspace_id and m.direction = 'out'
       and m.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
                            at time zone 'Asia/Kolkata'
       and m.status <> 'failed'
  )
  select jsonb_build_object(
    'allowed',   coalesce((select connected from s), false)
                 and not coalesce((select sending_paused from s), false)
                 and (select n from used) < coalesce((select daily_cap from s), 100),
    'connected', coalesce((select connected from s), false),
    'dry_run',   coalesce((select dry_run from s), true),
    'cap',       coalesce((select daily_cap from s), 100),
    'sent_today',(select n from used),
    'remaining', greatest(0, coalesce((select daily_cap from s), 100) - (select n from used)),
    'paused',    coalesce((select sending_paused from s), false),
    'reason',    (select pause_reason from s)
  );
$$;


-- ── 11. SEED THE TEMPLATE LIBRARY ───────────────────────────────────────────
-- 11 templates: 6 cold, 5 hot. Cold must be MARKETING (Meta's rule for
-- business-initiated outreach). Hot goes in as UTILITY — cheaper, no marketing
-- frequency cap, better delivery.
--
-- DECISION ON C5/C6 (Shailen left this to me):
--   The original draft had 5 cold messages ending in the exit. The revision
--   said 6 but never wrote the extra one, and the drafted C5 was a copy of H4.
--   Duplicating H4 in cold wastes the ladder's best rung, so C5 is now a
--   proof/result message with its own editable slot — cold gets an A/B lever
--   the same way H3 does — and C6 stays the graceful exit. Final ladder:
--   question -> myth -> who we work with -> cost -> proof -> exit.
--
-- Idempotent: only seeds if the workspace has no seeded templates.

create or replace function public.whatsapp_seed_templates(p_workspace_id uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  -- Admin-gated for browser callers. auth.uid() is NULL when run as postgres
  -- (Supabase SQL editor) or service_role, which already have full access —
  -- so allow those through instead of silently returning -1.
  if auth.uid() is not null and not public.is_campaign_admin(p_workspace_id) then
    return -1;
  end if;
  select count(*) into v_n from public.whatsapp_templates
   where workspace_id = p_workspace_id and is_seeded;
  if v_n > 0 then return 0; end if;

  insert into public.whatsapp_templates
    (workspace_id, code, name, track, category, body, variables, step_no, day_offset, is_seeded)
  values
  (p_workspace_id,'migrizo_cold_01','Cold 1 · The 1/2/3 question','cold','MARKETING',
   E'Hi {{1}}, this is Prateek from Migrizo. You enquired about the UK Global Talent Visa.\n\nOne quick question so I point you the right way: are you in tech, science, or business?\n\nReply 1, 2 or 3.',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 1, 0, true),

  (p_workspace_id,'migrizo_cold_02','Cold 2 · Myth (editable)','cold','MARKETING',
   E'{{1}}, most people think {{2}}.\n\nIt isn''t true — {{3}}.\n\nWant me to check yours? Reply YES.\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""},
     {"n":"2","label":"The myth","default":"you need a UK job offer for this visa"},
     {"n":"3","label":"The correction","default":"it is judged entirely on your own track record"}]'::jsonb,
   2, 3, true),

  (p_workspace_id,'migrizo_cold_03','Cold 3 · Who we work with','cold','MARKETING',
   E'{{1}}, we work with founders and senior engineers on this route.\n\nI can tell you honestly whether your profile is close, or not far off. Shall I take a look?\n\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 3, 7, true),

  (p_workspace_id,'migrizo_cold_04','Cold 4 · Cost','cold','MARKETING',
   E'{{1}}, quick one on cost since everyone asks.\n\nOur fee is {{2}} across 4 stages, government fees separate. Nothing large upfront.\n\nWant the full breakdown?\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""},
     {"n":"2","label":"Fee figure","default":"£3,000"}]'::jsonb, 4, 14, true),

  (p_workspace_id,'migrizo_cold_05','Cold 5 · Recent result (editable)','cold','MARKETING',
   E'{{1}}, one recent example in case it helps you judge.\n\n{{2}}\n\nIf that sounds anything like your situation, reply YES and I''ll look at yours.\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""},
     {"n":"2","label":"The result / case study","default":"A senior engineer in Bengaluru came to us certain he was not eligible. Endorsed in eleven weeks, on the strength of open source and conference talks he had never thought to count."}]'::jsonb,
   5, 19, true),

  (p_workspace_id,'migrizo_cold_06','Cold 6 · Graceful exit','cold','MARKETING',
   E'{{1}}, I''ll stop here rather than fill your chat.\n\nIf the UK is still on your mind this year, reply YES and I''ll pick it up. Otherwise, all the best.',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 6, 25, true),

  (p_workspace_id,'migrizo_hot_01','Hot 1 · Pick a call slot','hot','UTILITY',
   E'{{1}}, good to hear from you.\n\nBest way forward is a quick 15-minute call — I''ll tell you honestly if your profile fits.\n\nWhich suits you better?\n1  Today evening\n2  Tomorrow morning\n3  This weekend',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 1, 0, true),

  (p_workspace_id,'migrizo_hot_02','Hot 2 · Any time works','hot','UTILITY',
   E'{{1}}, no rush on picking a slot.\n\nIf it''s easier, just tell me a rough time and I''ll work around it. Even 10 minutes is enough to know if this is worth pursuing.\n\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 2, 2, true),

  (p_workspace_id,'migrizo_hot_03','Hot 3 · Proof (editable)','hot','UTILITY',
   E'{{1}}, one thing that might help you decide.\n\n{{2}}\n\nWorth a 15-minute call to see where you stand? Reply YES.\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""},
     {"n":"2","label":"Case study / proof point","default":"We took a Bengaluru CTO from probably-not-eligible to endorsed in 11 weeks — same profile shape as yours."}]'::jsonb,
   3, 4, true),

  (p_workspace_id,'migrizo_hot_04','Hot 4 · Free assessment','hot','UTILITY',
   E'{{1}}, I''d rather tell you now if this isn''t for you than waste your time.\n\nSend me your LinkedIn and I''ll give you a straight yes or no, free.\n\nFair? Reply with the link.\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 4, 7, true),

  (p_workspace_id,'migrizo_hot_05','Hot 5 · Door open','hot','UTILITY',
   E'{{1}}, I''ll leave it here for now.\n\nWhen you''re ready to look at the UK properly, reply and I''ll pick it straight up.\n\nNot the right time? Just reply NO.',
   '[{"n":"1","label":"First name","default":""}]'::jsonb, 5, 12, true);

  return 11;
end;
$fn$;


-- ── 12. GRANTS ──────────────────────────────────────────────────────────────
grant execute on function public.whatsapp_normalize_phone(text, text)            to authenticated, service_role;
grant execute on function public.whatsapp_is_optout(text)                        to authenticated, service_role;
grant execute on function public.whatsapp_conversations_list(uuid, int)          to authenticated;
grant execute on function public.whatsapp_thread(uuid, int)                      to authenticated;
grant execute on function public.whatsapp_mark_read(uuid)                        to authenticated;
grant execute on function public.whatsapp_set_conversation_status(uuid, text)    to authenticated;
grant execute on function public.whatsapp_clear_attention(uuid)                  to authenticated;
grant execute on function public.whatsapp_suppress_manual(uuid)                  to authenticated;
grant execute on function public.whatsapp_stats(uuid)                            to authenticated;
grant execute on function public.whatsapp_can_send(uuid)                         to authenticated, service_role;
grant execute on function public.whatsapp_seed_templates(uuid)                   to authenticated;

-- Webhook / cron only — never exposed to the browser.
grant execute on function public.whatsapp_find_or_create_conversation(uuid, text, uuid)                     to service_role;
grant execute on function public.whatsapp_record_inbound(uuid, text, text, text, timestamptz)               to service_role;
grant execute on function public.whatsapp_record_outbound(uuid, text, text, text, text, jsonb, uuid, uuid, text) to service_role;
grant execute on function public.whatsapp_attach_provider_id(uuid, text)                                    to service_role;
grant execute on function public.whatsapp_update_status(text, text, text, text)                             to service_role;
grant execute on function public.whatsapp_optout(uuid, text, text, text)                                    to service_role, authenticated;


-- ── 13. SETTINGS ROW FOR EVERY WORKSPACE, NOW AND IN FUTURE ─────────────────
insert into public.whatsapp_settings (workspace_id)
select w.id from public.workspaces w
on conflict (workspace_id) do nothing;

create or replace function public.whatsapp_settings_bootstrap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_settings (workspace_id) values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_settings_bootstrap on public.workspaces;
create trigger trg_whatsapp_settings_bootstrap
  after insert on public.workspaces
  for each row execute function public.whatsapp_settings_bootstrap();


-- ── 14. REALTIME ────────────────────────────────────────────────────────────
-- The inbox subscribes to these so messages appear without a refresh.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.whatsapp_messages';
    exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.whatsapp_conversations';
    exception when duplicate_object then null; end;
  end if;
end $$;
