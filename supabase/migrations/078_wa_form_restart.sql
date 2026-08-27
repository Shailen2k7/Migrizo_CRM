-- =============================================================================
-- 078 — META FORM MESSAGE RESTARTS THE CHASE
-- -----------------------------------------------------------------------------
-- When someone arrives through a Meta lead ad, WhatsApp pre-fills their first
-- message for them: "Hello! I filled out your form..." followed by the answers
-- they just gave. That message is the single strongest signal we ever get that
-- a person wants to talk to us RIGHT NOW.
--
-- Until now it was treated like any other text, so a lead who was already in
-- the Cold campaign, or older than 48 hours, got nothing back. This migration
-- gives the app what it needs to answer every one of them:
--
--   1. wa_intake_restart()  — put a chase back to step 1 no matter what state
--      it is in, or start one from scratch. The unique index added in 076
--      (wa_intake_one_live) means a plain enqueue silently does nothing when a
--      chase is already waiting at step 3, which is exactly the case we need to
--      restart. This does it in one atomic statement.
--
--   2. whatsapp_conversations.tag — a short human label on the conversation.
--      Set to 'Returning' when someone whose CV we already hold comes back
--      through the form: they must never be asked for that CV a second time,
--      so a human picks the conversation up instead of a robot answering it.
--
--   3. whatsapp_conversations_list() gains `tag` so the inbox can show it.
--      A function's return table cannot be changed by CREATE OR REPLACE, so
--      this one is dropped and rebuilt. Both happen inside this migration's
--      transaction — no window exists where the inbox has no list function.
--
-- Idempotent: safe to run twice. Second run is NOTICEs only.
-- =============================================================================

-- ── 1. THE TAG COLUMN ───────────────────────────────────────────────────────
alter table public.whatsapp_conversations
  add column if not exists tag text;

comment on column public.whatsapp_conversations.tag is
  'Short human label shown as a chip in the inbox. ''Returning'' = came back '
  'through the Meta form and we already hold their profile, so a human should '
  'answer rather than the autopilot re-asking for a CV. Null for most chats.';

-- Only ever a handful of tagged rows, so a partial index keeps it small.
create index if not exists idx_wa_conv_tag
  on public.whatsapp_conversations (workspace_id)
  where tag is not null;

-- RLS: no new policy needed. `tag` is a column on whatsapp_conversations, which
-- already carries workspace-scoped policies from migration 040, and every read
-- below goes through a security-definer function that filters on
-- user_workspaces(). Adding a column cannot widen that.

-- ── 2. RESTART A CHASE ──────────────────────────────────────────────────────
-- Returns the id of a chase row sitting at step 1, ready to be claimed, or
-- null when the number is suppressed. Three cases, one statement each:
--
--   * a chase is already waiting (any step) -> wind it back to step 1
--   * a chase exists but is done/failed     -> revive it at step 1
--   * no chase at all                       -> create one
--
-- fail_count and last_error are cleared: a fresh form submission is a fresh
-- start, and carrying five old strikes into it would kill the new chase early.
create or replace function public.wa_intake_restart(
  p_workspace_id uuid,
  p_lead_id      uuid,
  p_phone        text
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_id    uuid;
begin
  if v_phone is null then return null; end if;

  -- RULE 2 holds here as it does everywhere: an opted-out number is never
  -- messaged, whatever signal we just received.
  if exists (select 1 from public.whatsapp_suppressions s
              where s.workspace_id = p_workspace_id and s.phone_e164 = v_phone) then
    return null;
  end if;

  -- Existing row for this number on the chase track, whatever its status.
  --
  -- A WAITING row is preferred over a newer done/failed one, and that ordering
  -- is load-bearing, not cosmetic: 076 puts a unique index on
  -- (workspace_id, phone_e164, track) WHERE status = 'waiting'. If a number
  -- somehow has both a done row and a waiting row, picking the done one and
  -- flipping it to 'waiting' would collide with the row already holding that
  -- slot and raise. Picking the waiting row instead updates the slot in place,
  -- which can never conflict with itself.
  select id into v_id
    from public.wa_intake
   where workspace_id = p_workspace_id
     and phone_e164   = v_phone
     and track        = 'chase'
   order by (status = 'waiting') desc, created_at desc
   limit 1
     for update;

  if found then
    update public.wa_intake
       set status       = 'waiting',
           next_step    = 1,
           next_send_at = now(),
           -- claimed_at MUST be cleared, and this is the line the whole
           -- feature hangs on. wa_intake_claim_one only claims a row whose
           -- claimed_at is null or older than ten minutes. A chase that the
           -- drain just leased, or that sent T1 moments ago, carries a fresh
           -- claimed_at — so leaving it set would put the row at step 1 and
           -- then refuse to claim it, and T1 would silently never go out in
           -- exactly the busy case this feature exists for. The old lease
           -- belongs to a journey that no longer exists.
           claimed_at   = null,
           lead_id      = coalesce(p_lead_id, lead_id),
           fail_count   = 0,
           last_error   = null,
           updated_at   = now()
     where id = v_id;
    return v_id;
  end if;

  insert into public.wa_intake
      (workspace_id, lead_id, phone_e164, track, next_step, next_send_at)
  values (p_workspace_id, p_lead_id, v_phone, 'chase', 1, now())
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function public.wa_intake_restart(uuid, uuid, text) to service_role;

comment on function public.wa_intake_restart(uuid, uuid, text) is
  'Force a chase back to step 1 (or create one) after a Meta form message. '
  'Unlike wa_intake_enqueue this overrides a chase already in flight, which is '
  'the whole point — the person just told us they want to start again. '
  'Returns null for suppressed numbers.';

-- ── 3. FIND A LEAD FROM THE DETAILS INSIDE THE MESSAGE ──────────────────────
-- People fill the form on a laptop and then message us from their actual
-- phone, so the number we are chatting with is often NOT the number on the
-- form. The pre-filled message carries both an email and the phone they typed,
-- which is enough to find the lead the conversation belongs to.
--
-- Phone matching deliberately reuses whatsapp_normalize_phone(), the same
-- comparison whatsapp_find_or_create_conversation() has always used, so a
-- number matched here and a number matched there can never disagree.
--
-- Email is tried FIRST: people mistype their own phone number far more often
-- than their own email address.
create or replace function public.wa_find_lead_by_contact(
  p_workspace_id uuid,
  p_phone        text default null,
  p_email        text default null
) returns uuid
language sql stable security definer set search_path = public as $$
  select l.id
    from public.leads l
   where l.workspace_id = p_workspace_id
     and (
       (p_email is not null and lower(l.email) = lower(p_email))
       or
       (p_phone is not null
        and public.whatsapp_normalize_phone(l.phone)
            = public.whatsapp_normalize_phone(p_phone))
     )
   order by (p_email is not null and lower(l.email) = lower(p_email)) desc,
            l.created_at desc
   limit 1;
$$;

grant execute on function public.wa_find_lead_by_contact(uuid, text, text) to service_role;

comment on function public.wa_find_lead_by_contact(uuid, text, text) is
  'Find a lead by the email/phone written INSIDE a Meta form message, so an '
  'orphan WhatsApp conversation started from a different number can be linked '
  'to the lead it belongs to. Email wins over phone when both match.';

-- ── 4. TAG ON THE INBOX LIST ────────────────────────────────────────────────
-- Return table gains `tag`, so the old function must go first. Everything else
-- is byte-for-byte the definition from migration 040.
drop function if exists public.whatsapp_conversations_list(uuid, int);

create or replace function public.whatsapp_conversations_list(
  p_workspace_id uuid,
  p_limit        int default 300
) returns table (
  id uuid, lead_id uuid, phone_e164 text, lead_name text, lead_stage text,
  visa_type text, owner_id uuid, status text,
  unread_count int, needs_attention boolean,
  last_inbound_at timestamptz, last_message_at timestamptz,
  last_preview text, last_direction text,
  window_open boolean, window_expires_at timestamptz, suppressed boolean,
  tag text
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
                  where s.workspace_id = c.workspace_id and s.phone_e164 = c.phone_e164) as suppressed,
         c.tag
    from public.whatsapp_conversations c
    left join public.leads l on l.id = c.lead_id
   where c.workspace_id = p_workspace_id
     and c.workspace_id in (select user_workspaces())
   order by c.last_message_at desc nulls last
   limit p_limit;
$$;

grant execute on function public.whatsapp_conversations_list(uuid, int) to authenticated;

-- ── 5. VERIFY ───────────────────────────────────────────────────────────────
do $$
declare
  v_has_tag  boolean;
  v_has_fn   boolean;
  v_list_tag boolean;
  v_has_find boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'whatsapp_conversations'
       and column_name = 'tag'
  ) into v_has_tag;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wa_intake_restart'
  ) into v_has_fn;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'whatsapp_conversations_list'
       and pg_get_function_result(p.oid) like '%tag text%'
  ) into v_list_tag;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'wa_find_lead_by_contact'
  ) into v_has_find;

  raise notice '078 — conversations.tag column .......... %', v_has_tag;
  raise notice '078 — wa_intake_restart() ............... %', v_has_fn;
  raise notice '078 — conversations_list returns tag .... %', v_list_tag;
  raise notice '078 — wa_find_lead_by_contact() ......... %', v_has_find;

  if not (v_has_tag and v_has_fn and v_list_tag and v_has_find) then
    raise exception '078 did not apply cleanly — see the flags above';
  end if;
end $$;
