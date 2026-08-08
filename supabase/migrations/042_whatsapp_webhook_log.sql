-- =============================================================================
-- 042_whatsapp_webhook_log.sql
--
-- WHY THIS EXISTS
-- ---------------
-- When inbound WhatsApp messages do not appear in the CRM there are exactly
-- four places it can break:
--
--   1. Interakt never called us            (wrong URL, or the event box is unticked)
--   2. Interakt called us and we said 401  (secret mismatch)
--   3. We accepted it but the event type was one we do not handle
--   4. We handled it and the database write failed
--
-- Without a record of the raw call, telling those four apart means guessing.
-- This table records EVERY request that reaches the webhook — including the ones
-- we reject — so the answer is a single SELECT away, forever.
--
-- It is deliberately workspace-independent: a 401 happens before we know which
-- workspace the call belongs to, and those are the rows we most need to see.
--
-- Safe to run twice.
-- =============================================================================

-- ── 1. THE LOG TABLE ────────────────────────────────────────────────────────
create table if not exists public.whatsapp_webhook_log (
  id           bigserial primary key,
  received_at  timestamptz not null default now(),
  event_type   text,                  -- payload.type, null if unparseable
  outcome      text not null,         -- unauthorized | handled | ignored | error | bad_json
  detail       text,                  -- error message, or what we skipped and why
  phone        text,                  -- the lead's number, when the payload had one
  provider_id  text,                  -- data.message.id
  workspace_id uuid,                  -- resolved workspace, null if we never got there
  payload      jsonb                  -- the raw body, exactly as Interakt sent it
);

comment on table public.whatsapp_webhook_log is
  'Every request that hits /api/whatsapp/webhook, accepted or rejected. '
  'Diagnostic only — nothing reads it to make decisions.';

create index if not exists idx_wa_webhook_log_received
  on public.whatsapp_webhook_log (received_at desc);

create index if not exists idx_wa_webhook_log_outcome
  on public.whatsapp_webhook_log (outcome, received_at desc);


-- ── 2. RLS ──────────────────────────────────────────────────────────────────
-- Writes come from the service-role client in the webhook, which bypasses RLS.
-- Reads are for campaign admins only: the payload contains lead phone numbers
-- and message text, so this is not a table for every team member to browse.
alter table public.whatsapp_webhook_log enable row level security;

drop policy if exists "wa admin webhook log" on public.whatsapp_webhook_log;
create policy "wa admin webhook log" on public.whatsapp_webhook_log
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
       where m.user_id = auth.uid()
         and public.is_campaign_admin(m.workspace_id)
    )
  );


-- ── 3. RETENTION ────────────────────────────────────────────────────────────
-- A busy number produces thousands of receipts a day. This is a debugging aid,
-- not an archive — anything older than 14 days is noise. Called by the same
-- cron that drains the send queue, so it needs no scheduler of its own.
create or replace function public.whatsapp_webhook_log_prune(p_days int default 14)
returns int
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  delete from public.whatsapp_webhook_log
   where received_at < now() - make_interval(days => greatest(1, p_days));
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;


-- ── 4. THE ONE QUERY THAT ANSWERS "IS INBOUND WORKING?" ─────────────────────
-- Returns a plain-language verdict instead of rows to interpret. Campaign
-- admins only; returns a single jsonb object so the diagnose route can pass it
-- straight through to the client.
create or replace function public.whatsapp_webhook_health()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_total   int;
  v_401     int;
  v_in      int;
  v_last    timestamptz;
  v_last_ev text;
  v_recent  jsonb;
begin
  -- Same gate as the read policy: admins only, no workspace leakage.
  if not exists (
    select 1 from public.workspace_members m
     where m.user_id = auth.uid()
       and public.is_campaign_admin(m.workspace_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;

  select count(*) into v_total from public.whatsapp_webhook_log;

  select count(*) into v_401
    from public.whatsapp_webhook_log where outcome = 'unauthorized';

  select count(*) into v_in
    from public.whatsapp_webhook_log where event_type = 'message_received';

  select received_at, event_type into v_last, v_last_ev
    from public.whatsapp_webhook_log order by received_at desc limit 1;

  select coalesce(jsonb_agg(r order by r->>'received_at' desc), '[]'::jsonb)
    into v_recent
    from (
      select jsonb_build_object(
               'received_at', received_at,
               'event_type',  event_type,
               'outcome',     outcome,
               'detail',      detail,
               'phone',       phone
             ) as r
        from public.whatsapp_webhook_log
       order by received_at desc
       limit 15
    ) s;

  return jsonb_build_object(
    'ok', true,
    'total_calls',       v_total,
    'unauthorized',      v_401,
    'inbound_messages',  v_in,
    'last_call_at',      v_last,
    'last_event_type',   v_last_ev,
    -- The verdict. This is the whole point of the migration.
    'verdict',
      case
        when v_total = 0 then
          'NO_CALLS — Interakt has never reached this URL. The webhook URL is '
          'wrong, or the message-event checkboxes are not ticked in Interakt.'
        when v_401 = v_total then
          'ALL_REJECTED — Interakt is calling, but every call is a 401. The '
          'secret in the webhook URL does not match WHATSAPP_WEBHOOK_SECRET '
          'in Netlify.'
        when v_in = 0 then
          'NO_INBOUND — Interakt is calling and authenticating, but has never '
          'sent a message_received event. Tick the inbound-message webhook in '
          'Interakt, and turn off its built-in auto-reply.'
        else
          'HEALTHY — inbound messages are arriving and being recorded.'
      end,
    'recent', v_recent
  );
end;
$fn$;

revoke all on function public.whatsapp_webhook_health() from public;
grant execute on function public.whatsapp_webhook_health() to authenticated;
grant execute on function public.whatsapp_webhook_log_prune(int) to service_role;
