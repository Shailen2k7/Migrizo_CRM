-- ============================================================================
-- 076 — WHATSAPP INTAKE AUTOPILOT (Phase 1)
--
-- WHAT THIS IS
-- The chase-and-verdict machine for brand-new Meta leads, kept deliberately
-- separate from the wa_campaigns engine (062). Campaigns talk to COLD/HOT
-- stages on a day cadence with approved templates. Intake talks to a lead in
-- their FIRST hours, mostly inside the free-form 24h session window that opens
-- the moment they send us "Hello! I filled in your form…".
--
-- TWO TRACKS on one queue table:
--   chase    T1 ask-for-CV then up to three nudges (T2 T3 T4). Any reply from
--            the lead AFTER T1 cancels the rest — the trigger below enforces
--            that in the database so no code path can forget it.
--   verdict  after a CV is read and judged: T6 (booking link) queued a few
--            minutes behind the inline T5. Replies do NOT cancel this track —
--            "sounds great!" must not swallow the booking link.
--
-- TWO BRANCHES decided at send time, not enqueue time:
--   session   conversation has an inbound < 23h old → free-form quick-reply
--             text. Cadence T1 now, T2 +4h, T3 +6h, T4 +10h (all inside the
--             window, per founder decision, ignoring the 10:00–19:00 send
--             window — replying to someone who just wrote to us is normal at
--             any hour).
--   template  no open window (lead never messaged) → Meta-approved template
--             only, spread T1 → +1d → +2d → +3d and clamped to the send
--             window. Slow on purpose: four templated pings in one day to a
--             cold number is how quality ratings die, and this number has
--             already taken a 131049 hit once.
--
-- ALSO IN THIS FILE
--   * whatsapp_settings.campaigns_paused — ONE master switch for the whole
--     wa_campaigns engine (cold + hot together). Set to TRUE right now,
--     because the new number has no approved templates yet.
--   * leads.profile_text / profile_ai — the formatted CV text that survives
--     after the file itself is deleted from storage.
--   * eligibility_source gains 'ai' — the CV verdict writes eligibility
--     without stealing the 'manual' label a human click gets.
--   * wa_sync learns to leave intake-active leads alone.
--   * pg_cron job hitting /api/whatsapp/intake/drain every 5 minutes.
--
-- Idempotent: safe to run twice.
-- ============================================================================


-- ── 1. THE QUEUE ────────────────────────────────────────────────────────────
create table if not exists public.wa_intake (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete cascade,
  phone_e164    text not null,
  track         text not null default 'chase',      -- 'chase' | 'verdict'
  branch        text not null default 'template',   -- last branch actually used
  status        text not null default 'waiting',    -- see check below
  next_step     int  not null default 1,            -- T number to send next
  next_send_at  timestamptz not null default now(),
  claimed_at    timestamptz,                        -- who touched it last; the inline-send race guard
  sent_count    int  not null default 0,
  fail_count    int  not null default 0,
  last_error    text,
  replied_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$ begin
  alter table public.wa_intake add constraint wa_intake_track_chk
    check (track in ('chase','verdict'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.wa_intake add constraint wa_intake_branch_chk
    check (branch in ('session','template'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.wa_intake add constraint wa_intake_status_chk
    check (status in ('waiting','replied','done','stopped','failed','paused'));
exception when duplicate_object then null; end $$;

-- One live journey per phone per track. Finished journeys don't block a new
-- one (a lead who comes back months later can be chased again by hand).
create unique index if not exists wa_intake_one_live
  on public.wa_intake (workspace_id, phone_e164, track)
  where status = 'waiting';

create index if not exists wa_intake_due
  on public.wa_intake (workspace_id, status, next_send_at);

alter table public.wa_intake enable row level security;

drop policy if exists "wa intake read" on public.wa_intake;
create policy "wa intake read" on public.wa_intake for select to authenticated
  using (workspace_id in (select user_workspaces()));
-- Writes go through security-definer RPCs and the service role only.

comment on table public.wa_intake is
  'New-lead WhatsApp autopilot queue. track=chase is T1–T4; track=verdict is the T6 follow-up behind an inline T5. Replies cancel chase (after T1) via trigger, never verdict.';


-- ── 2. MASTER CAMPAIGN SWITCH ───────────────────────────────────────────────
alter table public.whatsapp_settings
  add column if not exists campaigns_paused boolean not null default false;

comment on column public.whatsapp_settings.campaigns_paused is
  'ONE switch for the whole wa_campaigns engine (cold + hot). The engine run route exits early while true. Does NOT affect wa_intake (the new-lead chase) or manual sends.';

-- Founder decision 2026-08-26: pause campaigns NOW — the new number has no
-- approved templates, so every engine send would fail and burn the queue.
-- Guarded by "no intake rows yet" so a re-apply months from now (after the
-- founder has resumed campaigns) cannot silently switch the engine off again.
update public.whatsapp_settings s set campaigns_paused = true
 where not exists (select 1 from public.wa_intake);


-- ── 3. LEAD PROFILE COLUMNS ─────────────────────────────────────────────────
-- The CV file is deleted after reading (founder rule: no document storage).
-- What survives is the formatted text and the AI's working-out, on the lead.
alter table public.leads add column if not exists profile_text text;
alter table public.leads add column if not exists profile_ai   jsonb;

comment on column public.leads.profile_text is
  'Formatted text profile extracted from the CV the lead sent on WhatsApp. The file itself is deleted after extraction; this is the durable copy shown by the Profile button in the lead drawer.';
comment on column public.leads.profile_ai is
  'AI working-out for the profile verdict: { eligible, route, reason, industry, model, at }.';

-- eligibility_source learns 'ai'. Recreate the check constraint additively.
do $$ begin
  alter table public.leads drop constraint if exists leads_eligibility_source_chk;
  alter table public.leads add constraint leads_eligibility_source_chk
    check (eligibility_source is null or eligibility_source in ('manual','derived','ai'));
end $$;


-- ── 4. REPLY CANCELS THE CHASE — in the database, not in code ───────────────
-- Fires on every inbound message. Rules:
--   * only the chase track — the verdict track must survive a "thanks!"
--   * only after T1 actually went out (sent_count >= 1). The lead's OPENING
--     message ("Hello! I filled in your form") arrives before T1 and must not
--     cancel the chase it is about to start.
create or replace function public.wa_intake_on_inbound()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.direction = 'in' then
    update public.wa_intake i
       set status = 'replied', replied_at = now(), updated_at = now()
      from public.whatsapp_conversations c
     where c.id = new.conversation_id
       and i.workspace_id = new.workspace_id
       and i.phone_e164 = c.phone_e164
       and i.track = 'chase'
       and i.status = 'waiting'
       and i.sent_count >= 1;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_wa_intake_on_inbound on public.whatsapp_messages;
create trigger trg_wa_intake_on_inbound
  after insert on public.whatsapp_messages
  for each row execute function public.wa_intake_on_inbound();

-- An opt-out kills the journey outright — even before T1 (the reply trigger
-- can't, its sent_count guard is for the opening hello). Without this, a
-- suppressed number would leave an immortal 'waiting' row: never claimable,
-- inflating the Autopilot counter and blocking any future journey forever.
create or replace function public.wa_intake_on_suppression()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.wa_intake
     set status = 'stopped', last_error = 'opted out', updated_at = now()
   where workspace_id = new.workspace_id
     and phone_e164 = new.phone_e164
     and status = 'waiting';
  return new;
end;
$fn$;

drop trigger if exists trg_wa_intake_on_suppression on public.whatsapp_suppressions;
create trigger trg_wa_intake_on_suppression
  after insert on public.whatsapp_suppressions
  for each row execute function public.wa_intake_on_suppression();


-- ── 5. RPCs — enqueue, claim, advance ───────────────────────────────────────

-- Enqueue a chase (or verdict) journey. ON CONFLICT the live-journey index
-- makes a second call a no-op, so ingest + webhook can both call it safely.
create or replace function public.wa_intake_enqueue(
  p_workspace_id  uuid,
  p_lead_id       uuid,
  p_phone         text,
  p_track         text default 'chase',
  p_first_step    int  default 1,
  p_delay_minutes int  default 0
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_id uuid;
begin
  if v_phone is null then return null; end if;
  -- Suppressed numbers never enter the queue at all.
  if exists (select 1 from public.whatsapp_suppressions s
              where s.workspace_id = p_workspace_id and s.phone_e164 = v_phone) then
    return null;
  end if;

  insert into public.wa_intake
      (workspace_id, lead_id, phone_e164, track, next_step, next_send_at)
  values (p_workspace_id, p_lead_id, v_phone, p_track, p_first_step,
          now() + make_interval(mins => greatest(p_delay_minutes, 0)))
  on conflict (workspace_id, phone_e164, track) where status = 'waiting'
  do nothing
  returning id into v_id;
  return v_id;
end;
$fn$;
grant execute on function public.wa_intake_enqueue(uuid, uuid, text, text, int, int) to service_role;

-- Claim due rows. Each claimed row is leased forward 10 minutes so a crashed
-- drain retries automatically and two overlapping drains cannot double-send.
create or replace function public.wa_intake_claim(p_workspace_id uuid, p_batch int default 10)
returns table (
  intake_id uuid, track text, next_step int, lead_id uuid, phone_e164 text,
  lead_name text, lead_industry text, fail_count int,
  last_inbound_at timestamptz, conversation_id uuid
)
language plpgsql security definer set search_path = public as $fn$
begin
  return query
  with due as (
    select i.id from public.wa_intake i
     where i.workspace_id = p_workspace_id
       and i.status = 'waiting'
       and i.next_send_at <= now()
       and not exists (select 1 from public.whatsapp_suppressions s
                        where s.workspace_id = i.workspace_id
                          and s.phone_e164 = i.phone_e164)
     order by i.next_send_at
     limit greatest(p_batch, 1)
     for update skip locked
  ), leased as (
    update public.wa_intake i
       set next_send_at = now() + interval '10 minutes',
           claimed_at = now(), updated_at = now()
      from due where i.id = due.id
    returning i.*
  )
  select l.id, l.track, l.next_step, l.lead_id, l.phone_e164,
         coalesce(ld.full_name, ''), ld.industry, l.fail_count,
         c.last_inbound_at, c.id
    from leased l
    left join public.leads ld on ld.id = l.lead_id
    left join public.whatsapp_conversations c
      on c.workspace_id = l.workspace_id and c.phone_e164 = l.phone_e164;
end;
$fn$;
grant execute on function public.wa_intake_claim(uuid, int) to service_role;

-- Claim ONE specific journey for an inline send (the webhook's T1). This is
-- the race guard the reviewer demanded: two webhook invocations for two
-- messages seconds apart must produce ONE T1, and a row the drain has just
-- leased must not be sent again inline. Returns the row id if this caller
-- won, null if someone else already holds it (claimed within 10 minutes).
create or replace function public.wa_intake_claim_one(
  p_workspace_id uuid,
  p_phone        text,
  p_track        text default 'chase',
  p_step         int  default 1
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_phone text := public.whatsapp_normalize_phone(p_phone);
  v_id uuid;
begin
  if v_phone is null then return null; end if;
  update public.wa_intake
     set claimed_at = now(),
         next_send_at = now() + interval '10 minutes',
         updated_at = now()
   where workspace_id = p_workspace_id
     and phone_e164 = v_phone
     and track = p_track
     and status = 'waiting'
     and next_step = p_step
     and (claimed_at is null or claimed_at < now() - interval '10 minutes')
  returning id into v_id;
  return v_id;
end;
$fn$;
grant execute on function public.wa_intake_claim_one(uuid, text, text, int) to service_role;

-- Advance after a send attempt. The cadence lives HERE so every caller —
-- drain, webhook inline T1 — moves the row the same way.
--   chase/session   T1→T2 +4h,  T2→T3 +6h,  T3→T4 +10h   (20h total, in-window)
--   chase/template  T1→T2 +1d,  T2→T3 +2d,  T3→T4 +3d    (slow, number-safe)
--   verdict         step 5 (T5, when it goes through the drain) → step 6
--                   four minutes later (T6, so the pair reads like a person
--                   typing); steps 6 and 7 are terminal.
-- Failures: soft-retry after p_retry_hours; the row dies only after 5
-- CONSECUTIVE strikes — a success resets the count, so four days of
-- "template not approved yet" cannot combine with one transient network blip
-- months later to kill a healthy journey.
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
      -- T5 just went out through the drain — T6 (booking link) follows in
      -- minutes, not hours.
      update public.wa_intake
         set sent_count = sent_count + 1, next_step = 6,
             next_send_at = now() + interval '4 minutes',
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
      -- A dead journey is a human's problem now — light the inbox flag.
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


-- ── 6. KEEP THE CAMPAIGN ENGINE OFF INTAKE LEADS ────────────────────────────
-- Same wa_sync as 062 plus ONE new exclusion: a lead mid-chase must not also
-- be enrolled in the cold campaign — two robots texting one person.
create or replace function public.wa_sync(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c record; v_in int; v_out int; v_added int := 0; v_stopped int := 0;
begin
  for c in
    select * from public.wa_campaigns
     where status = 'running'
       and (p_workspace_id is null or workspace_id = p_workspace_id)
  loop
    if auth.uid() is not null and not public.is_campaign_admin(c.workspace_id) then
      continue;
    end if;
    if not exists (select 1 from public.wa_campaign_steps s where s.campaign_id = c.id) then
      continue;
    end if;

    with s as (
      update public.wa_campaign_people p
         set status = 'stopped', stop_reason = 'left_stage', next_send_at = null
        from public.leads l
       where p.campaign_id = c.id and p.status in ('waiting','paused')
         and l.id = p.lead_id and l.stage <> c.stage
      returning 1)
    select count(*) into v_out from s;

    with ins as (
      insert into public.wa_campaign_people
        (workspace_id, campaign_id, lead_id, phone_e164, status, next_step, next_send_at)
      select c.workspace_id, c.id, l.id, p.norm, 'waiting', 1,
             public.whatsapp_clamp_to_window(c.workspace_id, now())
        from public.leads l
        cross join lateral (select public.whatsapp_normalize_phone(l.phone) as norm) p
       where l.workspace_id = c.workspace_id
         and l.stage = c.stage
         and coalesce(l.is_sample, false) = false
         and p.norm is not null
         and not exists (select 1 from public.whatsapp_suppressions su
                          where su.workspace_id = c.workspace_id and su.phone_e164 = p.norm)
         and not exists (select 1 from public.wa_campaign_people x
                          where x.campaign_id = c.id and x.phone_e164 = p.norm)
         and not exists (select 1 from public.meetings m
                          where m.workspace_id = c.workspace_id and m.status = 'upcoming'
                            and (m.lead_id = l.id
                                 or public.whatsapp_normalize_phone(m.client_phone) = p.norm))
         and not exists (select 1 from public.whatsapp_conversations cv
                          where cv.workspace_id = c.workspace_id and cv.phone_e164 = p.norm
                            and cv.last_inbound_at > now() - interval '24 hours')
         -- NEW (076): mid-intake leads are the autopilot's, not the campaign's.
         and not exists (select 1 from public.wa_intake i
                          where i.workspace_id = c.workspace_id
                            and i.phone_e164 = p.norm and i.status = 'waiting')
      on conflict (campaign_id, phone_e164) do nothing
      returning 1)
    select count(*) into v_in from ins;

    v_added := v_added + v_in; v_stopped := v_stopped + v_out;
  end loop;
  return jsonb_build_object('ok', true, 'added', v_added, 'stopped', v_stopped);
end;
$fn$;
grant execute on function public.wa_sync(uuid) to authenticated, service_role;


-- ── 7. INTAKE VISIBILITY for the campaigns screen ───────────────────────────
create or replace function public.wa_intake_stats(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'waiting', count(*) filter (where status = 'waiting'),
    'replied', count(*) filter (where status = 'replied'),
    'done',    count(*) filter (where status = 'done'),
    'failed',  count(*) filter (where status = 'failed'),
    'due_now', count(*) filter (where status = 'waiting' and next_send_at <= now())
  )
  from public.wa_intake
  where workspace_id = p_workspace_id
    and (p_workspace_id in (select user_workspaces()) or auth.uid() is null);
$fn$;
grant execute on function public.wa_intake_stats(uuid) to authenticated, service_role;


-- ── 8. CRON — the intake drain, every 5 minutes ─────────────────────────────
-- Same shape as 062's migrizo-wa-send. Wrapped so a database without pg_cron
-- (local dev) applies the rest of the file cleanly.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'migrizo-wa-intake';
  perform cron.schedule('migrizo-wa-intake', '*/5 * * * *', format(
    $job$ select net.http_post(
      url     := 'https://crm.migrizo.com/api/whatsapp/intake/drain',
      headers := jsonb_build_object('Content-Type','application/json',
                                    'x-cron-secret','ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9'),
      body    := '{}'::jsonb) $job$));
exception when others then
  raise notice 'pg_cron not available here (%), skipping schedule', sqlerrm;
end $$;

notify pgrst, 'reload schema';

-- Applied-twice proof: counts only, never mutates.
select
  (select count(*) from public.wa_intake)                        as intake_rows,
  (select campaigns_paused from public.whatsapp_settings limit 1) as campaigns_paused_now;
