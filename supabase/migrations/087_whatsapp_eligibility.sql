-- =============================================================================
-- 087 — ELIGIBILITY, LEARNED FROM THE WHATSAPP VERDICT WE ACTUALLY SENT
-- -----------------------------------------------------------------------------
-- Relay (chat.migrizo.com) and this CRM share one Postgres. Relay writes every
-- WhatsApp message to public.relay_messages, and relay_conversations.lead_id
-- already points at the CRM lead. So the verdict does not need an API, a
-- webhook, or a second service: the moment the message row lands, a trigger in
-- the same transaction can set leads.eligibility.
--
-- WHY THE PHRASES ARE SHAPED THE WAY THEY ARE
--
-- 247 outbound messages mention eligibility. Only 43 are verdicts. The other
-- 204 are the opening and chase templates:
--
--     "To assess your profile and check your eligibility, kindly share…"   (t1)
--     "…had a chance to consider your UK Global Talent Visa eligibility"   (c1)
--     "…so we can review your eligibility"                                 (t2)
--
-- Matching '%eligible%' would mark 204 people as ELIGIBLE for the crime of
-- being asked for their CV. That is not a rounding error — it is a lead being
-- told one thing and recorded as the opposite.
--
-- The separation that works is grammatical, not lexical. A verdict declares
-- somebody IS eligible; a request asks about their eligibilitY. Every pattern
-- below was checked against all 247 messages, one wording at a time:
--
--     eligible      23 hits across 5 wordings, every one a genuine verdict
--     not eligible  20 hits across 2 wordings, every one a genuine verdict
--     ignored      204 hits across 22 wordings, not one of them a verdict
--
-- Three of the 23 were typed freehand rather than from the template, which is
-- exactly why the narrow '%assessed as eligible%' alone was not enough.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * It never overwrites a human's click (eligibility_source = 'manual').
--     A person who opened the drawer and chose outranks any pattern match.
--   * It never touches leads.visa_type. The not-eligible message pitches the
--     Innovator Founder route, but a pitch is not a decision — and visa_type
--     rewrites the client's agreement, their process email, their invoice
--     labels and their case journey. The CRM treats a route switch as a
--     deliberate, confirmed action on the Visa route tab, and this respects
--     that. The pitch is recorded in `activity` instead, where it is visible
--     and actionable without silently rewriting a contract field.
--   * It never fires on inbound messages, so a lead replying "am I eligible?"
--     changes nothing.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

-- ── 1. eligibility_source learns 'whatsapp' ─────────────────────────────────
-- Recreated additively, exactly as 076 did when it added 'ai'.
do $$ begin
  alter table public.leads drop constraint if exists leads_eligibility_source_chk;
  alter table public.leads add constraint leads_eligibility_source_chk
    check (eligibility_source is null or eligibility_source in ('manual','derived','ai','whatsapp'));
end $$;

comment on column public.leads.eligibility_source is
  'How the verdict was reached: manual (a person clicked it), whatsapp (the '
  'verdict message we sent, detected by 087), ai (CV assessment), derived '
  '(074''s one-off backfill from stage). Precedence: manual > whatsapp > ai > derived.';


-- ── 2. The one place the phrases live ───────────────────────────────────────
-- A function, not inline SQL, so the trigger and the backfill can never drift
-- apart — and so changing the wording later is a one-line edit in one place.
create or replace function public.relay_verdict_of(p_body text)
returns text
language sql
immutable
as $$
  select case
    -- ORDER IS LOAD-BEARING: "not eligible" contains "eligible", and getting
    -- this the wrong way round silently turns a rejection into an approval.
    when lower(coalesce(p_body, '')) like '%not eligible%'          then 'not_eligible'

    -- The standard template, sent 20 times.
    when lower(coalesce(p_body, '')) like '%assessed as eligible%'  then 'eligible'

    -- Verdicts somebody typed by hand instead of using the template:
    --   "Your profile is eligible"
    --   "Your Profile is eligible under Arts & Culture"
    --   "You are eligible Kindly check the PDF file…"
    -- The distinction that makes these safe is grammatical: a verdict says
    -- someone IS eligible, a request asks about their eligibilitY. No request
    -- template contains either phrase — verified against all 247 outbound
    -- messages that mention eligibility.
    when lower(coalesce(p_body, '')) like '%is eligible%'           then 'eligible'
    when lower(coalesce(p_body, '')) like '%you are eligible%'      then 'eligible'
    else null
  end;
$$;

comment on function public.relay_verdict_of(text) is
  'The verdict a sent WhatsApp message expresses, or null. Verified against all '
  '247 outbound messages mentioning eligibility: 23 eligible, 20 not eligible, '
  '204 correctly ignored as requests or chases, zero false matches either way.';


-- ── 3. Apply one message to one lead ────────────────────────────────────────
-- Shared by the live trigger and the backfill, so historical rows and future
-- rows are treated by identical rules.
create or replace function public.relay_apply_verdict(
  p_conversation_id uuid,
  p_body            text,
  p_sent_by         uuid,
  p_at              timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id  uuid;
  v_verdict  text;
  v_source   text;
  v_prev     text;
  v_ws       uuid;
  v_pitched  boolean;
  v_actor    uuid;
begin
  v_verdict := public.relay_verdict_of(p_body);
  if v_verdict is null then return false; end if;

  select lead_id into v_lead_id
    from public.relay_conversations
   where id = p_conversation_id;

  -- A conversation with nobody attached yet. Relay allows that on purpose
  -- (someone can message before they exist as a lead); there is simply
  -- nothing to update, and that is not an error.
  if v_lead_id is null then return false; end if;

  select eligibility_source, eligibility, workspace_id
    into v_source, v_prev, v_ws
    from public.leads
   where id = v_lead_id;

  if not found then return false; end if;

  -- A person's own click always wins.
  if v_source = 'manual' then return false; end if;

  -- Nothing to do if this exact verdict is already recorded from WhatsApp.
  if v_prev is not distinct from v_verdict and v_source = 'whatsapp' then
    return false;
  end if;

  update public.leads
     set eligibility        = v_verdict,
         eligibility_at     = coalesce(p_at, now()),
         eligibility_source = 'whatsapp',
         eligibility_by     = p_sent_by
   where id = v_lead_id;

  v_pitched := v_verdict = 'not_eligible'
               and lower(coalesce(p_body, '')) like '%innovator founder%';

  -- activity.user_id has a foreign key to auth.users; relay_messages.sent_by
  -- deliberately does not. Passing an id straight through would therefore
  -- raise inside a trigger — and a raise here would roll back the caller,
  -- which is Relay saving a WhatsApp message. Resolve it to a real user or to
  -- null, exactly as an automation-sent message already is.
  if p_sent_by is not null
     and exists (select 1 from auth.users u where u.id = p_sent_by) then
    v_actor := p_sent_by;
  else
    v_actor := null;
  end if;

  -- An audit trail, because a field that changes by itself must be able to
  -- explain who changed it and why. Also the only record that an IFV pitch
  -- was made, since visa_type is deliberately left alone.
  --
  -- Wrapped, because logging is the least important thing happening in this
  -- transaction. If the activity table is mid-migration, or a constraint
  -- changes under us, the verdict must still be recorded and — far more
  -- importantly — the WhatsApp message must still save.
  begin
    insert into public.activity (workspace_id, user_id, lead_id, action, meta)
    values (
      v_ws, v_actor, v_lead_id, 'eligibility_set',
      jsonb_build_object(
        'to', v_verdict,
        'from', v_prev,
        'source', 'whatsapp',
        'via', 'relay message',
        'pitched_ifv', v_pitched
      )
    );
  exception when others then
    raise notice '087: verdict saved for % but activity log failed (%)', v_lead_id, sqlerrm;
  end;

  return true;
end;
$$;


-- ── 4. The trigger ──────────────────────────────────────────────────────────
-- Fires on insert AND on status changes, because Relay writes a row as
-- 'queued' and updates it once the provider accepts it. Acting on 'queued'
-- would record a verdict for a message that may still fail to send; waiting
-- for a delivered state and never re-acting (step 3 is idempotent) is correct
-- in both directions.
create or replace function public.relay_eligibility_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction <> 'out' then return new; end if;
  if new.status not in ('sent', 'delivered', 'read') then return new; end if;

  -- On UPDATE, only bother when the status is what changed into a sent state.
  if tg_op = 'UPDATE'
     and old.status in ('sent', 'delivered', 'read')
     and old.body is not distinct from new.body then
    return new;
  end if;

  -- THE WHOLE THING IS WRAPPED, AND THAT IS THE POINT.
  --
  -- This trigger runs inside Relay's own INSERT. An unhandled exception here
  -- does not "fail to update eligibility" — it rolls back the caller, and the
  -- customer's WhatsApp message is never saved. A dashboard statistic is worth
  -- far less than a message. So every failure is swallowed into a notice and
  -- the message is allowed through, untouched.
  begin
    perform public.relay_apply_verdict(
      new.conversation_id, new.body, new.sent_by, coalesce(new.created_at, now())
    );
  exception when others then
    raise notice '087: eligibility sync skipped for message % (%)', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_relay_eligibility on public.relay_messages;
create trigger trg_relay_eligibility
  after insert or update on public.relay_messages
  for each row execute function public.relay_eligibility_sync();


-- ── 5. Backfill the verdicts already sent ───────────────────────────────────
-- Oldest first, so if somebody was told "not eligible" and later "eligible",
-- the LAST thing they were told is what the CRM ends up believing.
do $$
declare r record; n int := 0;
begin
  for r in
    select m.conversation_id, m.body, m.sent_by, m.created_at
      from public.relay_messages m
     where m.direction = 'out'
       and m.status in ('sent', 'delivered', 'read')
       and public.relay_verdict_of(m.body) is not null
     order by m.created_at asc
  loop
    if public.relay_apply_verdict(r.conversation_id, r.body, r.sent_by, r.created_at) then
      n := n + 1;
    end if;
  end loop;
  raise notice '087: backfilled % lead(s) from WhatsApp verdicts already sent.', n;
end $$;

notify pgrst, 'reload schema';


-- ── 6. Verification ─────────────────────────────────────────────────────────
select
  count(*) filter (where eligibility_source = 'whatsapp')                          as from_whatsapp,
  count(*) filter (where eligibility_source = 'whatsapp' and eligibility = 'eligible')     as wa_eligible,
  count(*) filter (where eligibility_source = 'whatsapp' and eligibility = 'not_eligible') as wa_not_eligible,
  count(*) filter (where eligibility_source = 'manual')                            as still_manual,
  count(*) filter (where eligibility is not null)                                  as total_with_verdict
from public.leads;
