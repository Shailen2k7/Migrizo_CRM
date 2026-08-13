-- =============================================================================
-- 062_campaign_reset.sql — BURN THE OLD ENGINE. BUILD ONE THAT EXPLAINS ITSELF.
--
-- WHY (2026-08-13, after a full day of debugging)
--   Three overlapping engines had accumulated — journeys/automation (051-056),
--   sequences (047), campaigns-on-sequences (058/061) — and the founder spent
--   hours in a SQL editor to learn that a LEGACY STATIC FILE (_redirects) was
--   eating every cron call with a 405. Complexity was the bug.
--
-- THE RESET
--   DELETED  journeys, auto-jobs, automation settings, FAQs, sequences, steps,
--            enrollments, every trigger and function that served them, every
--            whatsapp cron.
--   KEPT     conversations, messages, templates, quick replies, settings,
--            suppressions — the inbox is untouched.
--
-- THE NEW ENGINE — one idea, four verbs
--   wa_campaigns        two rows: Hot leads, Cold leads. status running|paused.
--   wa_campaign_steps   the message list: template + days after the previous.
--   wa_campaign_people  one row per person per campaign. That's the whole state.
--
--   SYNC    every 10 min (and on every save): every lead in the stage joins,
--           anyone who left the stage stops. No lead untouched, ever.
--   SEND    every 5 min: due people get their next message, inside the window,
--           under the cap. Heartbeat written to whatsapp_settings so the UI can
--           SHOW the engine's pulse instead of the founder querying pg_net.
--   REPLY   pauses that person instantly (trigger, not code someone must call).
--   STOP    opt-out / meeting booked / left the stage — trigger-enforced.
--
-- Seeded from your approved templates: Hot = every active 'hot'-track template
-- in order, Cold = every active 'cold'-track template in order. Both campaigns
-- start RUNNING, and the sync at the bottom enrols the entire backlog NOW —
-- sending begins with the next engine tick inside your sending hours.
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. TEAR-DOWN ─────────────────────────────────────────────────────────────
-- Crons first, so nothing fires mid-demolition.
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job
     where jobname like 'migrizo-whatsapp-%' or jobname like 'migrizo-wa-%';
  end if;
end $cron$;

-- Triggers on shared tables (messages / leads / meetings / suppressions).
drop trigger if exists whatsapp_auto_on_inbound on public.whatsapp_messages;
drop trigger if exists trg_wa_seq_inbound       on public.whatsapp_messages;
drop trigger if exists whatsapp_auto_on_lead    on public.leads;
drop trigger if exists whatsapp_auto_on_meeting on public.meetings;
drop trigger if exists trg_wa_seq_suppression   on public.whatsapp_suppressions;

-- Functions of the retired engines.
drop function if exists public.whatsapp_auto_on_inbound()                                cascade;
drop function if exists public.whatsapp_auto_on_lead()                                   cascade;
drop function if exists public.whatsapp_auto_on_meeting()                                cascade;
drop function if exists public.whatsapp_seq_on_inbound()                                 cascade;
drop function if exists public.whatsapp_seq_on_suppression()                             cascade;
drop function if exists public.whatsapp_auto_claim(uuid, int)                            cascade;
drop function if exists public.whatsapp_auto_complete(uuid, boolean, text, boolean)      cascade;
drop function if exists public.whatsapp_auto_orphan_journey(uuid, uuid)                  cascade;
drop function if exists public.whatsapp_auto_lead_from_inbound(uuid, uuid)               cascade;
drop function if exists public.whatsapp_journey_decide(uuid, boolean)                    cascade;
drop function if exists public.whatsapp_job_retry(uuid)                                  cascade;
drop function if exists public.whatsapp_automation_overview(uuid)                        cascade;
drop function if exists public.whatsapp_stage_autoenrol(uuid)                            cascade;
drop function if exists public.whatsapp_reset_automation(uuid, text)                     cascade;
drop function if exists public.whatsapp_sequence_overview(uuid)                          cascade;
drop function if exists public.whatsapp_sequence_save_steps(uuid, jsonb)                 cascade;
drop function if exists public.whatsapp_sequence_enroll_preview(uuid, text, text, text)  cascade;
drop function if exists public.whatsapp_sequence_enroll(uuid, text, text, text, int)     cascade;
drop function if exists public.whatsapp_enrollment_action(uuid, text)                    cascade;
drop function if exists public.whatsapp_enrollment_retry(uuid)                           cascade;
drop function if exists public.whatsapp_claim_due(uuid, int)                             cascade;
drop function if exists public.whatsapp_advance_enrollment(uuid, boolean, text)          cascade;
drop function if exists public.whatsapp_campaign_matches(uuid, jsonb)                    cascade;
drop function if exists public.whatsapp_campaign_preview(uuid, jsonb, uuid)              cascade;
drop function if exists public.whatsapp_campaign_enrol(uuid)                             cascade;
drop function if exists public.whatsapp_campaign_launch(uuid, jsonb, int, int)           cascade;
drop function if exists public.whatsapp_campaign_sweep(uuid)                             cascade;
drop function if exists public.whatsapp_campaign_stats(uuid)                             cascade;
drop function if exists public.whatsapp_audience_facets(uuid, jsonb)                     cascade;

-- The three shared links ({{pdf}} / {{video}} / {{booking}} in quick replies
-- and the composer) lived on whatsapp_automation. That table dies below, so
-- the links move to whatsapp_settings first — same tokens, safer home.
alter table public.whatsapp_settings
  add column if not exists pdf_url     text,
  add column if not exists video_url   text,
  add column if not exists booking_url text;
do $$ begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'whatsapp_automation') then
    update public.whatsapp_settings s
       set pdf_url     = coalesce(s.pdf_url,     a.pdf_url),
           video_url   = coalesce(s.video_url,   a.video_url),
           booking_url = coalesce(s.booking_url, a.booking_url)
      from public.whatsapp_automation a
     where a.workspace_id = s.workspace_id;
  end if;
end $$;

-- Tables. History the founder never asked to keep goes with them.
drop table if exists public.whatsapp_auto_jobs             cascade;
drop table if exists public.whatsapp_journeys              cascade;
drop table if exists public.whatsapp_automation            cascade;
drop table if exists public.whatsapp_faqs                  cascade;
drop table if exists public.whatsapp_sequence_enrollments  cascade;
drop table if exists public.whatsapp_sequence_steps        cascade;
drop table if exists public.whatsapp_sequences             cascade;

-- The engine's pulse lives on the settings row, where the UI can read it.
alter table public.whatsapp_settings
  add column if not exists engine_last_run_at timestamptz,
  add column if not exists engine_last_result jsonb;


-- ── 2. THE NEW TABLES ────────────────────────────────────────────────────────
create table if not exists public.wa_campaigns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  stage        text not null check (stage in ('hot','cold','not_responding')),
  status       text not null default 'running' check (status in ('running','paused')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, stage)
);

create table if not exists public.wa_campaign_steps (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id  uuid not null references public.wa_campaigns(id) on delete cascade,
  step_no      int  not null check (step_no >= 1),
  template_id  uuid not null references public.whatsapp_templates(id) on delete cascade,
  wait_days    int  not null default 3 check (wait_days between 0 and 365),
  unique (campaign_id, step_no)
);

create table if not exists public.wa_campaign_people (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  campaign_id   uuid not null references public.wa_campaigns(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  phone_e164    text not null,
  -- waiting  = will receive the next message when due
  -- paused   = a human pressed pause
  -- replied  = they answered; their messages stopped; inbox owns them
  -- done     = received every step
  -- stopped  = opted out / left the stage / meeting booked
  -- failed   = 3 send failures; visible with a retry button
  status        text not null default 'waiting'
                check (status in ('waiting','paused','replied','done','stopped','failed')),
  stop_reason   text,
  next_step     int  not null default 1,
  next_send_at  timestamptz,
  sent_count    int  not null default 0,
  fail_count    int  not null default 0,
  last_error    text,
  replied_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (campaign_id, phone_e164)   -- one journey per person per campaign, ever
);

create index if not exists wa_people_due
  on public.wa_campaign_people (workspace_id, status, next_send_at);
create index if not exists wa_people_phone
  on public.wa_campaign_people (workspace_id, phone_e164);
create index if not exists wa_people_lead
  on public.wa_campaign_people (lead_id);

drop trigger if exists trg_wa_campaigns_touch on public.wa_campaigns;
create trigger trg_wa_campaigns_touch before update on public.wa_campaigns
  for each row execute function public.whatsapp_touch();
drop trigger if exists trg_wa_people_touch on public.wa_campaign_people;
create trigger trg_wa_people_touch before update on public.wa_campaign_people
  for each row execute function public.whatsapp_touch();

-- RLS: everyone in the workspace reads, campaign admins write.
alter table public.wa_campaigns       enable row level security;
alter table public.wa_campaign_steps  enable row level security;
alter table public.wa_campaign_people enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['wa_campaigns','wa_campaign_steps','wa_campaign_people'] loop
    execute format('drop policy if exists "%s read"  on public.%I', t, t);
    execute format('create policy "%s read" on public.%I for select to authenticated
                    using (workspace_id in (select user_workspaces()))', t, t);
    execute format('drop policy if exists "%s admin" on public.%I', t, t);
    execute format('create policy "%s admin" on public.%I for all to authenticated
                    using (public.is_campaign_admin(workspace_id))
                    with check (public.is_campaign_admin(workspace_id))', t, t);
  end loop;
end $rls$;


-- ── 3. SYNC — no lead untouched, no lead chased after leaving ───────────────
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

    -- OUT: the lead moved on (won, junk, other stage) → stop their messages.
    with s as (
      update public.wa_campaign_people p
         set status = 'stopped', stop_reason = 'left_stage', next_send_at = null
        from public.leads l
       where p.campaign_id = c.id and p.status in ('waiting','paused')
         and l.id = p.lead_id and l.stage <> c.stage
      returning 1)
    select count(*) into v_out from s;

    -- IN: everyone currently in the stage with a real number. Skipped only if
    -- opted out, already in this campaign, has an upcoming meeting, or wrote
    -- to us in the last 24h (they join tomorrow instead of being talked over).
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
      on conflict (campaign_id, phone_e164) do nothing
      returning 1)
    select count(*) into v_in from ins;

    v_added := v_added + v_in; v_stopped := v_stopped + v_out;
  end loop;
  return jsonb_build_object('ok', true, 'added', v_added, 'stopped', v_stopped);
end;
$fn$;
grant execute on function public.wa_sync(uuid) to authenticated, service_role;


-- ── 4. CLAIM + ADVANCE — the send engine's two verbs ────────────────────────
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
     and m.status <> 'failed' and m.created_at >= v_day;
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

    -- opted out since they were enrolled → stop forever, right here
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
      -- retired template: defer, and make it VISIBLE as an error, not silence
      update public.wa_campaign_people
         set next_send_at = now() + interval '6 hours',
             last_error = 'template "' || s.code || '" is retired — replace it in the step list'
       where id = r.id;
      continue;
    end if;

    -- 10-minute lease: a crashed engine retries instead of losing the send
    update public.wa_campaign_people set next_send_at = now() + interval '10 minutes'
     where id = r.id;

    v_claimed := v_claimed + 1;
    person_id          := r.id;
    campaign_id        := r.campaign_id;
    campaign_name      := r.name;
    step_no            := s.step_no;
    template_code      := s.code;
    template_body      := s.body;
    template_variables := s.variables;
    template_language  := s.language;
    template_category  := s.category;
    lead_id            := r.lead_id;
    phone_e164         := r.phone_e164;
    lead_name          := coalesce((select l.full_name from public.leads l where l.id = r.lead_id),
                                   r.phone_e164);
    return next;
  end loop;
end;
$fn$;
grant execute on function public.wa_claim(uuid, int) to service_role;

create or replace function public.wa_advance(p_person_id uuid, p_ok boolean, p_error text default null)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_cid uuid; v_step int; v_fails int; v_gap int;
begin
  select workspace_id, campaign_id, next_step, fail_count
    into v_ws, v_cid, v_step, v_fails
    from public.wa_campaign_people where id = p_person_id;
  if v_ws is null then return 'not_found'; end if;

  if not p_ok then
    if v_fails + 1 >= 3 then
      update public.wa_campaign_people
         set fail_count = fail_count + 1, last_error = left(coalesce(p_error,'send failed'), 400),
             status = 'failed', next_send_at = null
       where id = p_person_id;
      return 'failed';
    end if;
    update public.wa_campaign_people
       set fail_count = fail_count + 1, last_error = left(coalesce(p_error,'send failed'), 400),
           next_send_at = public.whatsapp_clamp_to_window(v_ws, now() + interval '4 hours')
     where id = p_person_id;
    return 'retry';
  end if;

  select wait_days into v_gap
    from public.wa_campaign_steps
   where campaign_id = v_cid and step_no = v_step + 1;

  if v_gap is null then
    update public.wa_campaign_people
       set next_step = next_step + 1, sent_count = sent_count + 1,
           fail_count = 0, last_error = null,
           status = 'done', next_send_at = null
     where id = p_person_id;
    return 'done';
  end if;

  update public.wa_campaign_people
     set next_step = next_step + 1, sent_count = sent_count + 1,
         fail_count = 0, last_error = null,
         next_send_at = public.whatsapp_clamp_to_window(v_ws, now() + make_interval(days => v_gap))
   where id = p_person_id;
  return 'advanced';
end;
$fn$;
grant execute on function public.wa_advance(uuid, boolean, text) to service_role;


-- ── 5. TRIGGERS — the three promises code can never forget ──────────────────
-- A reply pauses that person's messages, instantly and automatically.
create or replace function public.wa_on_inbound() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_phone text;
begin
  if new.direction <> 'in' then return new; end if;
  select phone_e164 into v_phone from public.whatsapp_conversations where id = new.conversation_id;
  if v_phone is not null then
    update public.wa_campaign_people
       set status = 'replied', replied_at = now(), next_send_at = null
     where workspace_id = new.workspace_id and phone_e164 = v_phone and status = 'waiting';
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_wa_on_inbound on public.whatsapp_messages;
create trigger trg_wa_on_inbound after insert on public.whatsapp_messages
  for each row execute function public.wa_on_inbound();

-- An opt-out stops everything for that number, forever.
create or replace function public.wa_on_suppression() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  update public.wa_campaign_people
     set status = 'stopped', stop_reason = 'opted_out', next_send_at = null
   where workspace_id = new.workspace_id and phone_e164 = new.phone_e164
     and status in ('waiting','paused','replied');
  return new;
end;
$fn$;
drop trigger if exists trg_wa_on_suppression on public.whatsapp_suppressions;
create trigger trg_wa_on_suppression after insert on public.whatsapp_suppressions
  for each row execute function public.wa_on_suppression();

-- A booked meeting means the campaign did its job. Stop.
create or replace function public.wa_on_meeting() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_phone text;
begin
  v_phone := public.whatsapp_normalize_phone(new.client_phone);
  update public.wa_campaign_people
     set status = 'stopped', stop_reason = 'meeting_booked', next_send_at = null
   where workspace_id = new.workspace_id
     and status in ('waiting','paused','replied')
     and ((new.lead_id is not null and lead_id = new.lead_id)
          or (v_phone is not null and phone_e164 = v_phone));
  return new;
end;
$fn$;
drop trigger if exists trg_wa_on_meeting on public.meetings;
create trigger trg_wa_on_meeting after insert on public.meetings
  for each row execute function public.wa_on_meeting();


-- ── 6. HUMAN VERBS ──────────────────────────────────────────────────────────
create or replace function public.wa_person_action(p_person_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_status text;
begin
  select workspace_id, status into v_ws, v_status
    from public.wa_campaign_people where id = p_person_id;
  if v_ws is null then return 'not_found'; end if;
  if not public.is_campaign_admin(v_ws) then return 'not_campaign_admin'; end if;

  if p_action = 'pause' and v_status = 'waiting' then
    update public.wa_campaign_people set status = 'paused', next_send_at = null
     where id = p_person_id;
    return 'paused';
  elsif p_action = 'resume' and v_status in ('paused','replied','failed') then
    update public.wa_campaign_people
       set status = 'waiting', fail_count = 0, last_error = null,
           next_send_at = public.whatsapp_clamp_to_window(v_ws, now())
     where id = p_person_id and stop_reason is distinct from 'opted_out';
    return 'waiting';
  elsif p_action = 'stop' and v_status in ('waiting','paused','replied','failed') then
    update public.wa_campaign_people
       set status = 'stopped', stop_reason = 'manual', next_send_at = null
     where id = p_person_id;
    return 'stopped';
  end if;
  return v_status;
end;
$fn$;
grant execute on function public.wa_person_action(uuid, text) to authenticated;

create or replace function public.wa_save_steps(p_campaign_id uuid, p_steps jsonb)
returns int language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_n int := 0; v_item jsonb; v_tpl uuid; v_wait int;
begin
  select workspace_id into v_ws from public.wa_campaigns where id = p_campaign_id;
  if v_ws is null or not public.is_campaign_admin(v_ws) then return -1; end if;

  delete from public.wa_campaign_steps where campaign_id = p_campaign_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    v_tpl  := (v_item->>'template_id')::uuid;
    v_wait := greatest(0, least(365, coalesce((v_item->>'wait_days')::int, 3)));
    if exists (select 1 from public.whatsapp_templates t
                where t.id = v_tpl and t.workspace_id = v_ws) then
      v_n := v_n + 1;
      insert into public.wa_campaign_steps (workspace_id, campaign_id, step_no, template_id, wait_days)
      values (v_ws, p_campaign_id, v_n, v_tpl, v_wait);
    end if;
  end loop;
  update public.wa_campaigns set updated_at = now() where id = p_campaign_id;
  return v_n;
end;
$fn$;
grant execute on function public.wa_save_steps(uuid, jsonb) to authenticated;


-- ── 7. ONE CALL FOR THE WHOLE SCREEN, health included ───────────────────────
create or replace function public.wa_home(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, cron as $fn$
declare
  v jsonb; v_cron jsonb := '[]'::jsonb; v_http jsonb := null;
begin
  if not (p_workspace_id in (select user_workspaces())) then
    return jsonb_build_object('ok', false, 'reason', 'not_your_workspace');
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb)
      into v_cron from cron.job where jobname like 'migrizo-wa-%';
  exception when others then v_cron := '[]'::jsonb; end;

  -- The last thing the website actually answered to the scheduler. This is the
  -- row that would have named the 405 on day one.
  begin
    select jsonb_build_object('status', status_code, 'body', left(content::text, 300), 'at', created)
      into v_http
      from net._http_response order by created desc limit 1;
  exception when others then v_http := null; end;

  select jsonb_build_object(
    'ok', true,
    'settings', (select jsonb_build_object(
        'connected', connected, 'dry_run', dry_run, 'paused', sending_paused,
        'cap', daily_cap, 'window_start', send_window_start::text,
        'window_end', send_window_end::text,
        'engine_last_run_at', engine_last_run_at,
        'engine_last_result', engine_last_result)
      from public.whatsapp_settings where workspace_id = p_workspace_id),
    'in_window', public.whatsapp_in_send_window(p_workspace_id),
    'sent_today', (select count(*) from public.whatsapp_messages m
        where m.workspace_id = p_workspace_id and m.direction = 'out'
          and m.status <> 'failed'
          and m.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'cron', v_cron,
    'last_http', v_http,
    'campaigns', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'stage', c.stage, 'status', c.status,
        'steps', (select coalesce(jsonb_agg(jsonb_build_object(
                    'step_no', s.step_no, 'template_id', s.template_id,
                    'template_name', t.name, 'template_body', t.body,
                    'wait_days', s.wait_days, 'meta_status', t.meta_status,
                    'sent', (select count(*) from public.whatsapp_messages m
                              where m.workspace_id = c.workspace_id and m.direction = 'out'
                                and m.status <> 'failed'
                                and m.sequence_step = c.id::text || ':' || s.step_no))
                    order by s.step_no), '[]'::jsonb)
                   from public.wa_campaign_steps s
                   join public.whatsapp_templates t on t.id = s.template_id
                  where s.campaign_id = c.id),
        'waiting',  (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id and p.status = 'waiting'),
        'replied',  (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id and p.status = 'replied'),
        'done',     (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id and p.status = 'done'),
        'paused',   (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id and p.status = 'paused'),
        'stopped',  (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id and p.status = 'stopped'),
        'failed',   (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id and p.status = 'failed'),
        'total',    (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id),
        'due_now',  (select count(*) from public.wa_campaign_people p
                      where p.campaign_id = c.id and p.status = 'waiting' and p.next_send_at <= now()),
        'next_send_at', (select min(p.next_send_at) from public.wa_campaign_people p
                          where p.campaign_id = c.id and p.status = 'waiting'),
        'in_stage', (select count(*) from public.leads l
                      where l.workspace_id = c.workspace_id and l.stage = c.stage
                        and coalesce(l.is_sample, false) = false)
      ) order by c.stage desc), '[]'::jsonb)
      from public.wa_campaigns c where c.workspace_id = p_workspace_id),
    'replies', (
      select coalesce(jsonb_agg(x order by x->>'replied_at' desc), '[]'::jsonb) from (
        select jsonb_build_object(
                 'person_id', p.id, 'lead_name', coalesce(l.full_name, p.phone_e164),
                 'campaign', c.name, 'replied_at', p.replied_at,
                 'body', (select m.body from public.whatsapp_messages m
                           join public.whatsapp_conversations cv on cv.id = m.conversation_id
                          where cv.workspace_id = p.workspace_id and cv.phone_e164 = p.phone_e164
                            and m.direction = 'in'
                          order by m.created_at desc limit 1)) as x
          from public.wa_campaign_people p
          join public.wa_campaigns c on c.id = p.campaign_id
          left join public.leads l on l.id = p.lead_id
         where p.workspace_id = p_workspace_id and p.status = 'replied'
         order by p.replied_at desc nulls last limit 12) q),
    'failures', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'person_id', p.id, 'lead_name', coalesce(l.full_name, p.phone_e164),
               'campaign', c.name, 'error', p.last_error, 'at_step', p.next_step)
             order by p.updated_at desc), '[]'::jsonb)
        from public.wa_campaign_people p
        join public.wa_campaigns c on c.id = p.campaign_id
        left join public.leads l on l.id = p.lead_id
       where p.workspace_id = p_workspace_id
         and (p.status = 'failed' or p.last_error is not null)
       limit 10)
  ) into v;
  return v;
end;
$fn$;
grant execute on function public.wa_home(uuid) to authenticated;


-- ── 8. SEED — your two campaigns, rebuilt from the approved templates ────────
do $seed$
declare ws record; cid uuid; n int; gaps int[] := array[0,3,4,5,7,8,10,10,10,10];
        tr text; nm text;
begin
  for ws in select id from public.workspaces loop
    foreach tr in array array['hot','cold'] loop
      nm := case tr when 'hot' then 'Hot leads — follow up' else 'Cold leads — follow up' end;
      insert into public.wa_campaigns (workspace_id, name, stage, status)
      values (ws.id, nm, tr, 'running')
      on conflict (workspace_id, stage) do nothing;

      select id into cid from public.wa_campaigns where workspace_id = ws.id and stage = tr;

      -- only seed steps when the campaign has none (safe to run twice)
      if not exists (select 1 from public.wa_campaign_steps s where s.campaign_id = cid) then
        n := 0;
        insert into public.wa_campaign_steps (workspace_id, campaign_id, step_no, template_id, wait_days)
        select ws.id, cid,
               row_number() over (order by t.step_no, t.created_at),
               t.id,
               gaps[least(row_number() over (order by t.step_no, t.created_at), 10)]
          from public.whatsapp_templates t
         where t.workspace_id = ws.id and t.track = tr and t.active;
      end if;
    end loop;
  end loop;
end $seed$;

-- Enrol the entire backlog RIGHT NOW. Sending begins on the next engine tick
-- inside your sending hours.
select public.wa_sync();


-- ── 9. CRON — two jobs, both visible in the UI's health strip ────────────────
do $cron$
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron missing — the engine will not run by itself.';
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('migrizo-wa-send','migrizo-wa-sync');

  perform cron.schedule('migrizo-wa-send', '*/5 * * * *', format(
    $job$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb);$job$,
    'https://crm.migrizo.com/api/whatsapp/campaigns/run',
    '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'));

  perform cron.schedule('migrizo-wa-sync', '*/10 * * * *', 'select public.wa_sync();');
  raise notice 'Scheduled: engine every 5 minutes, member sync every 10 minutes.';
end $cron$;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────────────
select c.name, c.status,
       (select count(*) from public.wa_campaign_steps s where s.campaign_id = c.id)  as steps,
       (select count(*) from public.wa_campaign_people p where p.campaign_id = c.id) as people
  from public.wa_campaigns c;
