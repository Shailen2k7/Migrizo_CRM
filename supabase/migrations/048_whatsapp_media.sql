-- =============================================================================
-- 048_whatsapp_media.sql — ATTACHMENTS + SAVED REPLIES
--
-- Completes the messaging module: send and receive files, images, PDFs, audio.
--
-- SECURITY DECISION THAT SHAPES EVERYTHING HERE
-- ---------------------------------------------
-- These attachments are CVs, passports and bank statements. A public storage
-- bucket with a guessable-or-shareable URL is the wrong answer for that, no
-- matter how convenient. So:
--
--   * the bucket is PRIVATE
--   * we store the storage PATH on the message, never a public URL
--   * the browser fetches media through /api/whatsapp/media/<message_id>,
--     which checks the session and the workspace before streaming a byte
--
-- Uploads and reads happen with the service role inside our own API routes,
-- which bypasses RLS by design — so the bucket needs no storage policies, and
-- there is no path by which an anonymous request can reach a lead's CV.
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. THE BUCKET ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;


-- ── 2. MEDIA COLUMNS ON MESSAGES ────────────────────────────────────────────
alter table public.whatsapp_messages
  add column if not exists media_path text,        -- storage object path, NOT a URL
  add column if not exists media_type text         -- image | document | audio | video | sticker
    check (media_type is null or media_type in ('image','document','audio','video','sticker')),
  add column if not exists media_name text,        -- original filename, shown in the bubble
  add column if not exists media_mime text,
  add column if not exists media_size int,
  -- For inbound media we keep the provider's URL only until the fetch succeeds.
  -- If our download fails we can retry from this instead of losing the file.
  add column if not exists media_source_url text;

create index if not exists idx_wa_messages_media
  on public.whatsapp_messages (workspace_id, media_type)
  where media_path is not null;


-- ── 3. SAVED REPLIES ────────────────────────────────────────────────────────
-- The answers your team types twenty times a day. Free-form only, so they are
-- legal inside the 24-hour window and need no Meta approval.
create table if not exists public.whatsapp_saved_replies (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shortcut     text not null,                       -- "fees" -> typed as /fees
  title        text not null,
  body         text not null,
  sort_order   int  not null default 0,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, shortcut)
);

alter table public.whatsapp_saved_replies enable row level security;

drop policy if exists "wa saved read" on public.whatsapp_saved_replies;
create policy "wa saved read" on public.whatsapp_saved_replies for select to authenticated
  using (workspace_id in (select user_workspaces()));

drop policy if exists "wa saved admin" on public.whatsapp_saved_replies;
create policy "wa saved admin" on public.whatsapp_saved_replies for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop trigger if exists trg_wa_saved_touch on public.whatsapp_saved_replies;
create trigger trg_wa_saved_touch before update on public.whatsapp_saved_replies
  for each row execute function public.whatsapp_touch();

-- A few to start with. Edit or delete them freely.
insert into public.whatsapp_saved_replies (workspace_id, shortcut, title, body, sort_order)
select w.id, v.shortcut, v.title, v.body, v.sort_order
  from public.workspaces w
  cross join (values
    ('fees',   'Our fees',
     E'Our professional fee is £3,000, split across 4 stages. Government fees are separate, and there is nothing large to pay upfront.\n\nHappy to walk you through exactly what each stage covers.', 1),
    ('docs',   'Documents needed',
     E'To start we would need:\n\n1. Your CV\n2. Any evidence of impact — open source, talks, press, patents, product numbers\n3. Three people who could write recommendation letters\n\nNo rush, send what you have and we will work from there.', 2),
    ('time',   'How long it takes',
     E'Endorsement usually takes a few weeks once the evidence is ready, then the visa stage follows.\n\nThe honest answer is that most of the timeline is preparation, not waiting on the Home Office — which is the part we take off your hands.', 3),
    ('call',   'Book a call',
     E'The quickest way forward is a short call so I can look at your profile properly and tell you honestly where you stand.\n\nWould later today or tomorrow suit you better?', 4)
  ) as v(shortcut, title, body, sort_order)
on conflict (workspace_id, shortcut) do nothing;


-- ── 4. RECORD INBOUND, NOW MEDIA-AWARE ──────────────────────────────────────
-- The old 5-arg signature is dropped first. Leaving both in place would make
-- every PostgREST named-argument call ambiguous, which fails at runtime with a
-- confusing "could not choose the best candidate function" error.
drop function if exists public.whatsapp_record_inbound(uuid, text, text, text, timestamptz);

create or replace function public.whatsapp_record_inbound(
  p_workspace_id uuid,
  p_phone        text,
  p_body         text,
  p_provider_id  text default null,
  p_sent_at      timestamptz default now(),
  p_media_path   text default null,
  p_media_type   text default null,
  p_media_name   text default null,
  p_media_mime   text default null,
  p_media_size   int  default null,
  p_media_source_url text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_conv uuid; v_lead uuid; v_msg uuid;
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_optout boolean := public.whatsapp_is_optout(p_body);
  v_preview text;
begin
  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;

  -- Duplicate delivery from the provider: acknowledge, change nothing.
  if p_provider_id is not null and exists (
       select 1 from public.whatsapp_messages
        where workspace_id = p_workspace_id and provider_msg_id = p_provider_id
     ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  v_conv := public.whatsapp_find_or_create_conversation(p_workspace_id, p_phone, null);
  select lead_id into v_lead from public.whatsapp_conversations where id = v_conv;

  insert into public.whatsapp_messages
    (workspace_id, conversation_id, lead_id, direction, body, provider_msg_id,
     status, created_at, media_path, media_type, media_name, media_mime,
     media_size, media_source_url)
  values
    (p_workspace_id, v_conv, v_lead, 'in', coalesce(p_body,''), p_provider_id,
     'received', coalesce(p_sent_at, now()), p_media_path, p_media_type,
     p_media_name, p_media_mime, p_media_size, p_media_source_url)
  returning id into v_msg;

  -- A file with no caption should preview as the file, not as an empty line.
  v_preview := nullif(btrim(coalesce(p_body,'')), '');
  if v_preview is null and p_media_type is not null then
    v_preview := case p_media_type
                   when 'image'    then '📷 Photo'
                   when 'document' then '📄 ' || coalesce(p_media_name, 'Document')
                   when 'audio'    then '🎤 Voice message'
                   when 'video'    then '🎬 Video'
                   else '📎 Attachment' end;
  end if;

  -- RULE 1: a reply FLAGS the conversation. It never stops a sequence.
  update public.whatsapp_conversations
     set last_inbound_at = coalesce(p_sent_at, now()),
         last_message_at = coalesce(p_sent_at, now()),
         last_preview    = left(coalesce(v_preview, ''), 180),
         last_direction  = 'in',
         unread_count    = unread_count + 1,
         needs_attention = true,
         status          = 'open',
         updated_at      = now()
   where id = v_conv;

  -- RULE 2: STOP / NO suppresses the number and junks the lead, permanently.
  if v_optout then
    perform public.whatsapp_optout(p_workspace_id, v_phone, p_body, 'stop_reply');
    return jsonb_build_object('ok', true, 'optout', true,
                              'conversation_id', v_conv, 'message_id', v_msg);
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv,
                            'message_id', v_msg, 'lead_id', v_lead);
end;
$fn$;


-- ── 5. RECORD OUTBOUND, NOW MEDIA-AWARE ─────────────────────────────────────
drop function if exists public.whatsapp_record_outbound(uuid, text, text, text, text, jsonb, uuid, uuid, text);

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
begin
  -- RULE 2: suppressed numbers are never messaged, no matter who asks.
  if exists (select 1 from public.whatsapp_suppressions
              where workspace_id = p_workspace_id and phone_e164 = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;

  v_conv := public.whatsapp_find_or_create_conversation(p_workspace_id, p_phone, p_lead_id);
  select lead_id into v_lead from public.whatsapp_conversations where id = v_conv;

  insert into public.whatsapp_messages
    (workspace_id, conversation_id, lead_id, direction, body, template_code,
     template_category, variables, sent_by, sequence_step, status,
     media_path, media_type, media_name, media_mime, media_size)
  values
    (p_workspace_id, v_conv, v_lead, 'out', coalesce(p_body,''), p_template_code,
     p_category, p_variables, p_sent_by, p_step, 'queued',
     p_media_path, p_media_type, p_media_name, p_media_mime, p_media_size)
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
                            'conversation_id', v_conv, 'lead_id', v_lead);
end;
$fn$;


-- ── 6. GRANTS ───────────────────────────────────────────────────────────────
grant execute on function public.whatsapp_record_inbound(uuid, text, text, text, timestamptz, text, text, text, text, int, text) to service_role;
grant execute on function public.whatsapp_record_outbound(uuid, text, text, text, text, jsonb, uuid, uuid, text, text, text, text, text, int) to service_role;
