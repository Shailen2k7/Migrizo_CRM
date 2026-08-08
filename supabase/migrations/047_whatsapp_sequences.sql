-- =============================================================================
-- 047_whatsapp_sequences.sql — THE SEQUENCE ENGINE
--
-- Turns the WhatsApp module from a manual inbox into an automation channel:
-- build a sequence as a numbered step list, enrol a filtered batch of leads,
-- and a cron drain sends the right template to the right person on the right
-- day — inside the send window, under the daily cap, respecting every
-- suppression rule that already exists.
--
-- DECISIONS ENCODED HERE (agreed with Shailen, 2026-08-08)
-- --------------------------------------------------------
--   * Enrolment is MANUAL. Nothing enters a sequence unless a human enrols it.
--   * A reply NEVER stops a sequence. It flags the enrollment (has_replied)
--     and the inbox already flags the thread. A human pauses; code does not.
--   * STOP / NO / opt-out stops enrollments instantly and forever (trigger).
--   * Edits apply going forward: enrollments remember only how many steps they
--     have received; the NEXT step is always read from the current step list.
--   * Send window is per-workspace, default 10:00–19:00 IST. Nothing is even
--     claimed outside it.
--   * ONE global daily cap (whatsapp_settings.daily_cap) shared by everything —
--     Meta rate-limits the number, not the sequence. A per-sequence limit can
--     further restrict, never exceed.
--
-- QUEUE-AND-DRAIN, same shape as email:
--   enrol  = create   (validates, dedupes, suppresses, inserts 'active' rows)
--   drain  = cron     (claims due rows with SKIP LOCKED, sends, advances)
--   pause/resume/stop = flip status; the drain only ever touches 'active'.
--
-- Safe to run twice.
-- =============================================================================


-- ── 0. SETTINGS: the send window lives with the other knobs ─────────────────
alter table public.whatsapp_settings
  add column if not exists send_window_start time not null default '10:00',
  add column if not exists send_window_end   time not null default '19:00';


-- ── 1. TABLES ───────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_sequences (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  description  text,
  status       text not null default 'draft'
               check (status in ('draft','active','paused','archived')),
  -- null = use the global cap only. A value here can only *further* limit.
  daily_limit  int check (daily_limit is null or daily_limit > 0),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.whatsapp_sequence_steps (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sequence_id  uuid not null references public.whatsapp_sequences(id) on delete cascade,
  step_no      int  not null check (step_no >= 1),
  template_id  uuid not null references public.whatsapp_templates(id) on delete cascade,
  -- Days after the PREVIOUS step. Step 1's value is ignored (sends at enrol).
  wait_days    int  not null default 3 check (wait_days >= 0 and wait_days <= 365),
  created_at   timestamptz not null default now(),
  unique (sequence_id, step_no)
);

create table if not exists public.whatsapp_sequence_enrollments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  sequence_id   uuid not null references public.whatsapp_sequences(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,
  -- Snapshot at enrol time. Triggers match on this, so a later edit to the
  -- lead's phone cannot silently detach an enrollment from its suppressions.
  phone_e164    text not null,
  status        text not null default 'active'
                check (status in ('active','paused','stopped','completed')),
  -- Number of steps already SENT. The next step is current_step + 1, read
  -- from the live step list — this is what makes edits apply going forward.
  current_step  int not null default 0,
  next_send_at  timestamptz,
  sent_count    int not null default 0,
  fail_count    int not null default 0,
  last_error    text,
  has_replied   boolean not null default false,
  last_reply_at timestamptz,
  last_sent_at  timestamptz,
  stop_reason   text,            -- manual | opted_out | failed
  completed_at  timestamptz,
  enrolled_by   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One enrolment per phone per sequence, ever. Re-running an enrol is a no-op.
  unique (sequence_id, phone_e164)
);

create index if not exists idx_wa_enroll_due
  on public.whatsapp_sequence_enrollments (workspace_id, status, next_send_at);
create index if not exists idx_wa_enroll_phone
  on public.whatsapp_sequence_enrollments (workspace_id, phone_e164);
create index if not exists idx_wa_steps_seq
  on public.whatsapp_sequence_steps (sequence_id, step_no);

-- updated_at maintenance (whatsapp_touch() ships in 040)
drop trigger if exists trg_wa_sequences_touch on public.whatsapp_sequences;
create trigger trg_wa_sequences_touch before update on public.whatsapp_sequences
  for each row execute function public.whatsapp_touch();
drop trigger if exists trg_wa_enroll_touch on public.whatsapp_sequence_enrollments;
create trigger trg_wa_enroll_touch before update on public.whatsapp_sequence_enrollments
  for each row execute function public.whatsapp_touch();


-- ── 2. RLS ──────────────────────────────────────────────────────────────────
alter table public.whatsapp_sequences            enable row level security;
alter table public.whatsapp_sequence_steps       enable row level security;
alter table public.whatsapp_sequence_enrollments enable row level security;

drop policy if exists "wa seq read" on public.whatsapp_sequences;
create policy "wa seq read" on public.whatsapp_sequences for select to authenticated
  using (workspace_id in (select user_workspaces()));
drop policy if exists "wa seq admin" on public.whatsapp_sequences;
create policy "wa seq admin" on public.whatsapp_sequences for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "wa steps read" on public.whatsapp_sequence_steps;
create policy "wa steps read" on public.whatsapp_sequence_steps for select to authenticated
  using (workspace_id in (select user_workspaces()));
drop policy if exists "wa steps admin" on public.whatsapp_sequence_steps;
create policy "wa steps admin" on public.whatsapp_sequence_steps for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "wa enroll read" on public.whatsapp_sequence_enrollments;
create policy "wa enroll read" on public.whatsapp_sequence_enrollments for select to authenticated
  using (workspace_id in (select user_workspaces()));
drop policy if exists "wa enroll admin" on public.whatsapp_sequence_enrollments;
create policy "wa enroll admin" on public.whatsapp_sequence_enrollments for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));


-- ── 3. THE SEND WINDOW ──────────────────────────────────────────────────────
-- All times are IST (Asia/Kolkata, no DST). "Clamp" answers one question: if I
-- want to send at time T, when am I actually allowed to? Inside the window: T.
-- Before it opens: today at open. After it shuts: tomorrow at open.
create or replace function public.whatsapp_clamp_to_window(
  p_workspace_id uuid, p_ts timestamptz
) returns timestamptz
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_start time; v_end time;
  v_local timestamp;      -- p_ts as an IST wall-clock time
  v_day   date;
begin
  select send_window_start, send_window_end into v_start, v_end
    from public.whatsapp_settings where workspace_id = p_workspace_id;
  v_start := coalesce(v_start, '10:00'::time);
  v_end   := coalesce(v_end,   '19:00'::time);

  v_local := p_ts at time zone 'Asia/Kolkata';
  v_day   := v_local::date;

  if v_local::time < v_start then
    return (v_day + v_start) at time zone 'Asia/Kolkata';
  elsif v_local::time >= v_end then
    return ((v_day + 1) + v_start) at time zone 'Asia/Kolkata';
  end if;
  return p_ts;
end;
$fn$;

create or replace function public.whatsapp_in_send_window(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.whatsapp_clamp_to_window(p_workspace_id, now()) = now();
$$;


-- ── 4. SEQUENCE OVERVIEW (the Sequences tab in one query) ───────────────────
create or replace function public.whatsapp_sequence_overview(p_workspace_id uuid)
returns table (
  id uuid, name text, description text, status text, daily_limit int,
  step_count int, enrolled_active int, enrolled_paused int,
  enrolled_completed int, enrolled_stopped int, replied int,
  sent_today int, next_due_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.description, s.status, s.daily_limit,
         (select count(*)::int from public.whatsapp_sequence_steps st
           where st.sequence_id = s.id)                              as step_count,
         count(e.id) filter (where e.status = 'active')::int         as enrolled_active,
         count(e.id) filter (where e.status = 'paused')::int         as enrolled_paused,
         count(e.id) filter (where e.status = 'completed')::int      as enrolled_completed,
         count(e.id) filter (where e.status = 'stopped')::int        as enrolled_stopped,
         count(e.id) filter (where e.has_replied)::int               as replied,
         (select count(*)::int from public.whatsapp_messages m
           where m.workspace_id = s.workspace_id and m.direction = 'out'
             and m.status <> 'failed'
             and m.sequence_step like s.id::text || ':%'
             and m.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata')
                                  at time zone 'Asia/Kolkata')       as sent_today,
         min(e.next_send_at) filter (where e.status = 'active')      as next_due_at,
         s.updated_at
    from public.whatsapp_sequences s
    left join public.whatsapp_sequence_enrollments e on e.sequence_id = s.id
   where s.workspace_id = p_workspace_id
     and s.workspace_id in (select user_workspaces())
     and s.status <> 'archived'
   group by s.id
   order by s.created_at desc;
$$;


-- ── 5. ATOMIC STEP SAVE (the editor's Save button) ──────────────────────────
-- Replaces the whole step list in one transaction, renumbered 1..N in the
-- order given. Renumbering is what keeps "next step = current_step + 1" true
-- no matter how the list was dragged around.
create or replace function public.whatsapp_sequence_save_steps(
  p_sequence_id uuid,
  p_steps       jsonb    -- [{ "template_id": "...", "wait_days": 3 }, ...]
) returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_ws uuid; v_n int := 0; v_item jsonb; v_tpl uuid; v_wait int;
begin
  select workspace_id into v_ws from public.whatsapp_sequences where id = p_sequence_id;
  if v_ws is null then return -1; end if;
  if not public.is_campaign_admin(v_ws) then return -1; end if;

  delete from public.whatsapp_sequence_steps where sequence_id = p_sequence_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb))
  loop
    v_tpl  := (v_item->>'template_id')::uuid;
    v_wait := greatest(0, least(365, coalesce((v_item->>'wait_days')::int, 3)));
    -- The template must exist in this workspace; anything else is a forged id.
    if exists (select 1 from public.whatsapp_templates t
                where t.id = v_tpl and t.workspace_id = v_ws) then
      v_n := v_n + 1;
      insert into public.whatsapp_sequence_steps
        (workspace_id, sequence_id, step_no, template_id, wait_days)
      values (v_ws, p_sequence_id, v_n, v_tpl, v_wait);
    end if;
  end loop;

  update public.whatsapp_sequences set updated_at = now() where id = p_sequence_id;
  return v_n;
end;
$fn$;


-- ── 6. ENROL PREVIEW + ENROL ────────────────────────────────────────────────
-- Both share one eligibility definition so the preview can never promise a
-- different batch than enrol delivers.
create or replace function public.whatsapp_sequence_enroll_preview(
  p_sequence_id uuid,
  p_stage       text default null,
  p_visa        text default null,
  p_query       text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_ws uuid; v_eligible int; v_existing int; v_suppressed int; v_bad int; v_steps int;
begin
  select workspace_id into v_ws from public.whatsapp_sequences where id = p_sequence_id;
  if v_ws is null or not (v_ws in (select user_workspaces())) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  with base as (
    select l.id, public.whatsapp_normalize_phone(l.phone) as norm
      from public.leads l
     where l.workspace_id = v_ws
       and (p_stage is null or p_stage = '' or l.stage = p_stage)
       and (p_visa  is null or p_visa  = '' or l.visa_type = p_visa)
       and (p_query is null or btrim(p_query) = ''
            or l.full_name ilike '%'||btrim(p_query)||'%'
            or coalesce(l.phone,'')  ilike '%'||btrim(p_query)||'%'
            or coalesce(l.email,'')  ilike '%'||btrim(p_query)||'%')
  ), judged as (
    select b.*,
      (b.norm is null)                                        as bad,
      (s.phone_e164 is not null)                              as sup,
      (en.id is not null)                                     as already
      from base b
      left join public.whatsapp_suppressions s
        on s.workspace_id = v_ws and s.phone_e164 = b.norm
      left join public.whatsapp_sequence_enrollments en
        on en.sequence_id = p_sequence_id and en.phone_e164 = b.norm
  )
  select count(*) filter (where not bad and not sup and not already),
         count(*) filter (where already),
         count(*) filter (where sup and not already),
         count(*) filter (where bad)
    into v_eligible, v_existing, v_suppressed, v_bad
    from judged;

  select count(*) into v_steps
    from public.whatsapp_sequence_steps where sequence_id = p_sequence_id;

  return jsonb_build_object(
    'ok', true,
    'eligible',         v_eligible,
    'already_enrolled', v_existing,
    'suppressed',       v_suppressed,
    'bad_phone',        v_bad,
    'steps',            v_steps,
    'total_messages',   v_eligible * v_steps
  );
end;
$fn$;

create or replace function public.whatsapp_sequence_enroll(
  p_sequence_id uuid,
  p_stage       text default null,
  p_visa        text default null,
  p_query       text default null,
  p_limit       int  default null   -- cap the batch; null = everyone eligible
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_ws uuid; v_n int;
begin
  select workspace_id into v_ws from public.whatsapp_sequences where id = p_sequence_id;
  if v_ws is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.is_campaign_admin(v_ws) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;
  if not exists (select 1 from public.whatsapp_sequence_steps where sequence_id = p_sequence_id) then
    return jsonb_build_object('ok', false, 'reason', 'no_steps',
      'detail', 'Add at least one step before enrolling anyone.');
  end if;

  with base as (
    select l.id as lead_id, public.whatsapp_normalize_phone(l.phone) as norm
      from public.leads l
     where l.workspace_id = v_ws
       and (p_stage is null or p_stage = '' or l.stage = p_stage)
       and (p_visa  is null or p_visa  = '' or l.visa_type = p_visa)
       and (p_query is null or btrim(p_query) = ''
            or l.full_name ilike '%'||btrim(p_query)||'%'
            or coalesce(l.phone,'')  ilike '%'||btrim(p_query)||'%'
            or coalesce(l.email,'')  ilike '%'||btrim(p_query)||'%')
  ), eligible as (
    select b.lead_id, b.norm
      from base b
      left join public.whatsapp_suppressions s
        on s.workspace_id = v_ws and s.phone_e164 = b.norm
      left join public.whatsapp_sequence_enrollments en
        on en.sequence_id = p_sequence_id and en.phone_e164 = b.norm
     where b.norm is not null and s.phone_e164 is null and en.id is null
     limit coalesce(nullif(p_limit, 0), 100000)
  ), ins as (
    insert into public.whatsapp_sequence_enrollments
      (workspace_id, sequence_id, lead_id, phone_e164, status, current_step,
       next_send_at, enrolled_by)
    select v_ws, p_sequence_id, e.lead_id, e.norm, 'active', 0,
           public.whatsapp_clamp_to_window(v_ws, now()), auth.uid()
      from eligible e
    on conflict (sequence_id, phone_e164) do nothing
    returning 1
  )
  select count(*) into v_n from ins;

  return jsonb_build_object('ok', true, 'enrolled', v_n);
end;
$fn$;


-- ── 7. PER-LEAD PAUSE / RESUME / STOP (the buttons become real) ─────────────
create or replace function public.whatsapp_enrollment_action(
  p_enrollment_id uuid, p_action text
) returns text
language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_status text;
begin
  select workspace_id, status into v_ws, v_status
    from public.whatsapp_sequence_enrollments where id = p_enrollment_id;
  if v_ws is null or not (v_ws in (select user_workspaces())) then return 'not_found'; end if;

  if p_action = 'pause' and v_status = 'active' then
    update public.whatsapp_sequence_enrollments
       set status = 'paused' where id = p_enrollment_id;
    return 'paused';
  elsif p_action = 'resume' and v_status = 'paused' then
    update public.whatsapp_sequence_enrollments
       set status = 'active',
           next_send_at = public.whatsapp_clamp_to_window(
             v_ws, greatest(now(), coalesce(next_send_at, now())))
     where id = p_enrollment_id;
    return 'active';
  elsif p_action = 'stop' and v_status in ('active','paused') then
    update public.whatsapp_sequence_enrollments
       set status = 'stopped', stop_reason = 'manual' where id = p_enrollment_id;
    return 'stopped';
  end if;
  return v_status;
end;
$fn$;


-- ── 8. CLAIM DUE SENDS (the drain's first half) ─────────────────────────────
-- Service-role only. Row locks with SKIP LOCKED make overlapping cron runs
-- safe; the 10-minute lease means a crashed drain retries instead of losing
-- the send. Enforces, in order: window open -> global cap -> per-sequence cap
-- -> suppression (stops the enrollment) -> step still exists (else completes)
-- -> template usable (else defers 6h).
create or replace function public.whatsapp_claim_due(
  p_workspace_id uuid, p_batch int default 10
) returns table (
  enrollment_id uuid, sequence_id uuid, sequence_name text, step_no int,
  wait_days int, template_id uuid, template_code text, template_body text,
  template_variables jsonb, template_language text, template_category text,
  lead_id uuid, phone_e164 text, lead_name text
)
language plpgsql security definer set search_path = public as $fn$
declare
  v_cap int; v_used int; v_remaining int;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata')
                             at time zone 'Asia/Kolkata';
  v_claimed int := 0;
  v_seq_used jsonb := '{}'::jsonb;   -- sequence_id -> sends already today
  r record; v_step record; v_lim int; v_su int;
begin
  if not public.whatsapp_in_send_window(p_workspace_id) then return; end if;

  select coalesce(daily_cap, 100) into v_cap
    from public.whatsapp_settings where workspace_id = p_workspace_id;
  select count(*) into v_used from public.whatsapp_messages m
   where m.workspace_id = p_workspace_id and m.direction = 'out'
     and m.status <> 'failed' and m.created_at >= v_day_start;
  v_remaining := greatest(0, coalesce(v_cap, 100) - v_used);
  if v_remaining = 0 then return; end if;

  for r in
    select e.id as eid, e.sequence_id as sid, e.current_step, e.lead_id, e.phone_e164,
           s.name as sname, s.daily_limit
      from public.whatsapp_sequence_enrollments e
      join public.whatsapp_sequences s on s.id = e.sequence_id
     where e.workspace_id = p_workspace_id
       and e.status = 'active' and s.status = 'active'
       and e.next_send_at is not null and e.next_send_at <= now()
     order by e.next_send_at asc
       for update of e skip locked
     limit greatest(p_batch * 3, 30)   -- headroom: some rows get skipped below
  loop
    exit when v_claimed >= least(p_batch, v_remaining);

    -- Suppressed since enrolment? Stop it here and never look again.
    if exists (select 1 from public.whatsapp_suppressions su
                where su.workspace_id = p_workspace_id and su.phone_e164 = r.phone_e164) then
      update public.whatsapp_sequence_enrollments
         set status = 'stopped', stop_reason = 'opted_out' where id = r.eid;
      continue;
    end if;

    -- The next step, from the CURRENT list (edits apply going forward).
    select st.step_no, st.wait_days, st.template_id,
           t.code, t.body, t.variables, t.language, t.category, t.meta_status, t.active
      into v_step
      from public.whatsapp_sequence_steps st
      join public.whatsapp_templates t on t.id = st.template_id
     where st.sequence_id = r.sid and st.step_no = r.current_step + 1;

    if v_step is null then
      update public.whatsapp_sequence_enrollments
         set status = 'completed', completed_at = now(), next_send_at = null
       where id = r.eid;
      continue;
    end if;

    -- Template retired or not yet approved (dry-run may proceed; the route
    -- decides — but a hard-inactive template defers rather than fails).
    if not v_step.active then
      update public.whatsapp_sequence_enrollments
         set next_send_at = now() + interval '6 hours',
             last_error = 'template_inactive'
       where id = r.eid;
      continue;
    end if;

    -- Per-sequence limit: min() with global, never more.
    v_lim := coalesce(r.daily_limit, 2147483647);
    v_su  := coalesce((v_seq_used->>r.sid::text)::int,
             (select count(*) from public.whatsapp_messages m
               where m.workspace_id = p_workspace_id and m.direction = 'out'
                 and m.status <> 'failed' and m.created_at >= v_day_start
                 and m.sequence_step like r.sid::text || ':%'));
    if v_su >= v_lim then
      -- This sequence is done for today; try again after the day rolls over.
      update public.whatsapp_sequence_enrollments
         set next_send_at = public.whatsapp_clamp_to_window(
               p_workspace_id, v_day_start + interval '1 day')
       where id = r.eid;
      continue;
    end if;
    v_seq_used := jsonb_set(v_seq_used, array[r.sid::text], to_jsonb(v_su + 1));

    -- Lease: if the drain dies after this, the row comes back in 10 minutes.
    update public.whatsapp_sequence_enrollments
       set next_send_at = now() + interval '10 minutes' where id = r.eid;

    v_claimed := v_claimed + 1;
    enrollment_id      := r.eid;
    sequence_id        := r.sid;
    sequence_name      := r.sname;
    step_no            := v_step.step_no;
    wait_days          := v_step.wait_days;
    template_id        := v_step.template_id;
    template_code      := v_step.code;
    template_body      := v_step.body;
    template_variables := v_step.variables;
    template_language  := v_step.language;
    template_category  := v_step.category;
    lead_id            := r.lead_id;
    phone_e164         := r.phone_e164;
    lead_name          := coalesce((select l.full_name from public.leads l where l.id = r.lead_id),
                                   r.phone_e164);
    return next;
  end loop;
end;
$fn$;


-- ── 9. ADVANCE (the drain's second half) ────────────────────────────────────
create or replace function public.whatsapp_advance_enrollment(
  p_enrollment_id uuid, p_ok boolean, p_error text default null
) returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_ws uuid; v_seq uuid; v_cur int; v_fail int; v_next record;
begin
  select workspace_id, sequence_id, current_step, fail_count
    into v_ws, v_seq, v_cur, v_fail
    from public.whatsapp_sequence_enrollments where id = p_enrollment_id;
  if v_ws is null then return 'not_found'; end if;

  if not p_ok then
    -- Three consecutive failures is a signal, not noise. Stop and surface it.
    if v_fail + 1 >= 3 then
      update public.whatsapp_sequence_enrollments
         set fail_count = fail_count + 1, last_error = left(coalesce(p_error,'send_failed'),500),
             status = 'stopped', stop_reason = 'failed', next_send_at = null
       where id = p_enrollment_id;
      return 'stopped';
    end if;
    update public.whatsapp_sequence_enrollments
       set fail_count = fail_count + 1, last_error = left(coalesce(p_error,'send_failed'),500),
           next_send_at = public.whatsapp_clamp_to_window(v_ws, now() + interval '4 hours')
     where id = p_enrollment_id;
    return 'retry';
  end if;

  -- Success: this step is done; schedule the next from the live list.
  select st.wait_days into v_next
    from public.whatsapp_sequence_steps st
   where st.sequence_id = v_seq and st.step_no = v_cur + 2;

  if v_next is null then
    update public.whatsapp_sequence_enrollments
       set current_step = current_step + 1, sent_count = sent_count + 1,
           last_sent_at = now(), fail_count = 0, last_error = null,
           status = 'completed', completed_at = now(), next_send_at = null
     where id = p_enrollment_id;
    return 'completed';
  end if;

  update public.whatsapp_sequence_enrollments
     set current_step = current_step + 1, sent_count = sent_count + 1,
         last_sent_at = now(), fail_count = 0, last_error = null,
         next_send_at = public.whatsapp_clamp_to_window(
           v_ws, now() + make_interval(days => greatest(0, v_next.wait_days)))
   where id = p_enrollment_id;
  return 'advanced';
end;
$fn$;


-- ── 10. TRIGGERS: the two rules that must never depend on app code ──────────
-- RULE 1: a reply flags, never stops.
create or replace function public.whatsapp_seq_on_inbound() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_phone text;
begin
  if new.direction <> 'in' then return new; end if;
  select phone_e164 into v_phone
    from public.whatsapp_conversations where id = new.conversation_id;
  if v_phone is not null then
    update public.whatsapp_sequence_enrollments
       set has_replied = true, last_reply_at = now()
     where workspace_id = new.workspace_id and phone_e164 = v_phone
       and status in ('active','paused');
  end if;
  return new;
end;
$fn$;
drop trigger if exists trg_wa_seq_inbound on public.whatsapp_messages;
create trigger trg_wa_seq_inbound after insert on public.whatsapp_messages
  for each row execute function public.whatsapp_seq_on_inbound();

-- RULE 2: an opt-out stops everything for that number, instantly.
create or replace function public.whatsapp_seq_on_suppression() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  update public.whatsapp_sequence_enrollments
     set status = 'stopped', stop_reason = 'opted_out', next_send_at = null
   where workspace_id = new.workspace_id and phone_e164 = new.phone_e164
     and status in ('active','paused');
  return new;
end;
$fn$;
drop trigger if exists trg_wa_seq_suppression on public.whatsapp_suppressions;
create trigger trg_wa_seq_suppression after insert on public.whatsapp_suppressions
  for each row execute function public.whatsapp_seq_on_suppression();


-- ── 11. GRANTS ──────────────────────────────────────────────────────────────
revoke all on function public.whatsapp_clamp_to_window(uuid, timestamptz) from public;
revoke all on function public.whatsapp_in_send_window(uuid) from public;
revoke all on function public.whatsapp_sequence_overview(uuid) from public;
revoke all on function public.whatsapp_sequence_save_steps(uuid, jsonb) from public;
revoke all on function public.whatsapp_sequence_enroll_preview(uuid, text, text, text) from public;
revoke all on function public.whatsapp_sequence_enroll(uuid, text, text, text, int) from public;
revoke all on function public.whatsapp_enrollment_action(uuid, text) from public;
revoke all on function public.whatsapp_claim_due(uuid, int) from public;
revoke all on function public.whatsapp_advance_enrollment(uuid, boolean, text) from public;

grant execute on function public.whatsapp_clamp_to_window(uuid, timestamptz)          to authenticated, service_role;
grant execute on function public.whatsapp_in_send_window(uuid)                        to authenticated, service_role;
grant execute on function public.whatsapp_sequence_overview(uuid)                     to authenticated;
grant execute on function public.whatsapp_sequence_save_steps(uuid, jsonb)            to authenticated;
grant execute on function public.whatsapp_sequence_enroll_preview(uuid, text, text, text) to authenticated;
grant execute on function public.whatsapp_sequence_enroll(uuid, text, text, text, int)    to authenticated, service_role;
grant execute on function public.whatsapp_enrollment_action(uuid, text)               to authenticated;
grant execute on function public.whatsapp_claim_due(uuid, int)                        to service_role;
grant execute on function public.whatsapp_advance_enrollment(uuid, boolean, text)     to service_role;
