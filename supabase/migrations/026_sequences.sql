-- ============================================================================
-- 026: EMAIL SEQUENCE AUTOMATION
--
-- What this adds, in one breath: sequences (Cold Nurture, Hot Follow-up,
-- Re-engagement) made of ordered steps at day offsets; per-lead enrolment rows
-- that track exactly where each person is; a maintenance sweep that exits
-- anyone who replied, booked, converted, unsubscribed, bounced or turned junk;
-- sleep after the last email and ONE re-engagement cycle, then done forever;
-- a daily cap that ramps 30 -> 60 -> 120 -> 180 over four weeks; and two hard
-- guarantees enforced by the database, not the app:
--
--     1. a lead can be in only ONE live sequence at a time
--     2. a lead can receive any given template only ONCE, ever
--
-- Stage whitelist: only stage = 'cold' or stage = 'hot' is ever enrolled or
-- emailed. Junk, won, invoice_sent, mr_coming_soon are excluded outright.
--
-- Safe to run repeatedly.
-- ============================================================================


-- ── 1. TABLES ───────────────────────────────────────────────────────────────

create table if not exists public.sequences (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  audience      text not null check (audience in ('cold','hot','reengagement')),
  description   text,
  sleep_days    int  not null default 75,     -- sleep after last email (60-90)
  reengage_to   uuid references public.sequences(id),  -- where sleepers wake into
  active        boolean not null default true,
  is_seeded     boolean not null default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  workspace_id  uuid not null,
  step_no       int  not null,                -- 1, 2, 3 ...
  day_offset    int  not null,                -- days after enrolment: 0,3,7,12,20,30
  template_id   uuid not null references public.email_templates(id) on delete cascade,
  unique (sequence_id, step_no)
);

create table if not exists public.lead_sequences (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  status        text not null default 'active' check (status in
                  ('active','paused','sleeping','reengagement',
                   'completed','converted','do_not_contact','exited')),
  current_step  int  not null default 0,      -- last step SENT (0 = nothing yet)
  enrolled_at   timestamptz not null default now(),
  last_sent_at  timestamptz,
  next_send_at  timestamptz not null default now(),
  sleep_until   timestamptz,
  is_reengaged  boolean not null default false,  -- one cycle only, then done
  exit_reason   text,                          -- replied|booked|converted|unsubscribed|bounced|junk|manual
  exited_at     timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- HARD GUARANTEE 1: one live enrolment per lead, enforced by the database.
create unique index if not exists uq_lead_live_enrolment
  on public.lead_sequences (lead_id)
  where status in ('active','paused','sleeping','reengagement');

create index if not exists idx_lseq_due
  on public.lead_sequences (workspace_id, status, next_send_at);
create index if not exists idx_lseq_lead on public.lead_sequences (lead_id);

-- Every automated send, forever. This is both the audit log and guarantee 2.
create table if not exists public.sequence_sends (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  lead_id       uuid not null,
  sequence_id   uuid not null,
  template_id   uuid not null,
  step_no       int  not null,
  subject       text,
  sent_at       timestamptz not null default now(),
  -- HARD GUARANTEE 2: nobody ever receives the same template twice.
  unique (lead_id, template_id)
);
create index if not exists idx_sseq_sends_day on public.sequence_sends (workspace_id, sent_at);

-- One settings row per workspace: when the cap ramp started.
create table if not exists public.sequence_settings (
  workspace_id    uuid primary key references public.workspaces(id) on delete cascade,
  ramp_started_at date not null default (now() at time zone 'Asia/Kolkata')::date,
  cap_override    int,                        -- set to pin the cap manually
  updated_at      timestamptz default now()
);


-- ── 2. RLS — campaign admins only, same model as Campaign Center ────────────

alter table public.sequences         enable row level security;
alter table public.sequence_steps    enable row level security;
alter table public.lead_sequences    enable row level security;
alter table public.sequence_sends    enable row level security;
alter table public.sequence_settings enable row level security;

drop policy if exists "seq admin" on public.sequences;
create policy "seq admin" on public.sequences for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "seq steps admin" on public.sequence_steps;
create policy "seq steps admin" on public.sequence_steps for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "seq leads admin" on public.lead_sequences;
create policy "seq leads admin" on public.lead_sequences for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "seq sends admin" on public.sequence_sends;
create policy "seq sends admin" on public.sequence_sends for select to authenticated
  using (public.is_campaign_admin(workspace_id));

drop policy if exists "seq settings admin" on public.sequence_settings;
create policy "seq settings admin" on public.sequence_settings for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));


-- ── 3. NEW TEMPLATES — Cold 5, Cold 6 and the Re-engagement set ─────────────
-- Idempotent: inserts only what is missing, never touches existing templates.

create or replace function public.seed_sequence_templates(p_workspace_id uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare added int := 0;
begin
  if not exists (select 1 from public.email_templates
                  where workspace_id = p_workspace_id and name = 'Cold 5: The real timeline') then
    insert into public.email_templates (workspace_id, name, track, category, sort, is_seeded, subject, html) values
    (p_workspace_id, 'Cold 5: The real timeline', 'GTV Cold', 'cold', 5, true,
     'How long the Global Talent Visa really takes',
     '<p>Hi {{name}},</p>' ||
     '<p>One more useful thing about the <b>UK Global Talent Visa</b>, because almost everyone we speak to gets this wrong.</p>' ||
     '<p>The visa itself is fast. Endorsement decisions typically come back in 4 to 8 weeks, and the visa after that in 2 to 3.</p>' ||
     '<p><b>What takes time is the evidence.</b> Recommendation letters from the right people, published work, proof of impact outside your own company. Done properly, that is 6 to 8 weeks of focused building.</p>' ||
     '<p>So the honest end-to-end picture is roughly <b>three to five months</b> from starting to holding the visa. Anyone promising faster is skipping the part that decides the outcome.</p>' ||
     '<p>If you want to know what your own timeline would look like, reply or book a call below.</p>');
    added := added + 1;
  end if;

  if not exists (select 1 from public.email_templates
                  where workspace_id = p_workspace_id and name = 'Cold 6: What it opens up') then
    insert into public.email_templates (workspace_id, name, track, category, sort, is_seeded, subject, html) values
    (p_workspace_id, 'Cold 6: What it opens up', 'GTV Cold', 'cold', 6, true,
     'What the Global Talent Visa actually gives you',
     '<p>Hi {{name}},</p>' ||
     '<p>People research the <b>UK Global Talent Visa</b> for months without ever listing what it actually gives you. Here it is, plainly.</p>' ||
     '<p><b>No employer.</b> You are not tied to a sponsor. Change jobs, freelance, or start a company on day one, without asking anyone.</p>' ||
     '<p><b>No minimum salary.</b> There is no income threshold to keep, unlike the Skilled Worker route.</p>' ||
     '<p><b>Family included.</b> Your partner and children come with you, and your partner can work freely.</p>' ||
     '<p><b>Settlement in 3 years</b> on the Exceptional Talent track, one of the fastest routes to permanent residence the UK offers.</p>' ||
     '<p>It is the most independent visa the UK has. If that is the version of the UK you want, reply and I will tell you honestly how close your profile is.</p>');
    added := added + 1;
  end if;

  if not exists (select 1 from public.email_templates
                  where workspace_id = p_workspace_id and name = 'RE 1: Six months later') then
    insert into public.email_templates (workspace_id, name, track, category, sort, is_seeded, subject, html) values
    (p_workspace_id, 'RE 1: Six months later', 'GTV Re-engage', 'reengagement', 21, true,
     'Is the UK back on the table?',
     '<p>Hi {{name}},</p>' ||
     '<p>A while back you looked into the <b>UK Global Talent Visa</b> with us at Migrizo, and the timing wasn''t right. I said I''d leave you alone, and I did.</p>' ||
     '<p>I''m writing once more because things change: new role, new plans, a partner''s job, a child''s schooling. If the UK is back on the table, your profile has probably grown since we last spoke, and it may be closer than it was.</p>' ||
     '<p>If it''s still a no, ignore this and you''ll only hear from me one more time, briefly.</p>' ||
     '<p>If it''s a maybe, just reply and I''ll take a fresh look at where you stand.</p>');
    added := added + 1;
  end if;

  if not exists (select 1 from public.email_templates
                  where workspace_id = p_workspace_id and name = 'RE 2: What changed this year') then
    insert into public.email_templates (workspace_id, name, track, category, sort, is_seeded, subject, html) values
    (p_workspace_id, 'RE 2: What changed this year', 'GTV Re-engage', 'reengagement', 22, true,
     'What''s changed with the Global Talent Visa',
     '<p>Hi {{name}},</p>' ||
     '<p>Since you last looked at the <b>UK Global Talent Visa</b>, a few things have moved, and one of them might matter to you.</p>' ||
     '<p><b>Assessment has tightened.</b> Endorsing bodies now weigh external recognition more heavily than internal achievements, which changes what a strong evidence pack looks like.</p>' ||
     '<p><b>Timelines are steadier.</b> Endorsement decisions have been coming back reliably, so the whole journey is easier to plan around a notice period or a school year.</p>' ||
     '<p><b>The route is unchanged where it counts.</b> No sponsor, no salary threshold, settlement in three years on the talent track.</p>' ||
     '<p>If any of that shifts your thinking, reply and I''ll tell you what it means for your profile specifically.</p>');
    added := added + 1;
  end if;

  if not exists (select 1 from public.email_templates
                  where workspace_id = p_workspace_id and name = 'RE 3: The final note') then
    insert into public.email_templates (workspace_id, name, track, category, sort, is_seeded, subject, html) values
    (p_workspace_id, 'RE 3: The final note', 'GTV Re-engage', 'reengagement', 23, true,
     'Closing your Global Talent Visa file',
     '<p>Hi {{name}},</p>' ||
     '<p>This is genuinely the last email about the <b>UK Global Talent Visa</b>. I''m closing your file this week.</p>' ||
     '<p>If the UK ever comes back into the picture, whether that''s next year or in five, you''re welcome to write to me directly and we''ll pick it up from wherever you are then.</p>' ||
     '<p>If now is actually the moment and this email caught you at the right time, reply with one word and I''ll call you this week.</p>' ||
     '<p>Either way, thank you for reading these, and good luck with whatever you''re building.</p>');
    added := added + 1;
  end if;

  return added;
end;
$fn$;
grant execute on function public.seed_sequence_templates(uuid) to authenticated;


-- ── 4. DEFAULT SEQUENCES — Cold Nurture, Hot Follow-up, Re-engagement ───────
-- Steps are wired to templates BY NAME, so this runs after the template seeds.
-- Idempotent: does nothing if seeded sequences already exist.

create or replace function public.seed_default_sequences(p_workspace_id uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare
  v_re   uuid; v_cold uuid; v_hot uuid;
  t uuid; made int := 0;
begin
  if exists (select 1 from public.sequences where workspace_id = p_workspace_id and is_seeded) then
    return 0;
  end if;

  perform public.seed_sequence_templates(p_workspace_id);

  -- Re-engagement first, so the other two can point their sleepers at it.
  insert into public.sequences (workspace_id, name, audience, description, sleep_days, is_seeded)
  values (p_workspace_id, 'Re-engagement', 'reengagement',
          '3 emails over 14 days. Runs once after the sleep, then the lead is done forever.', 0, true)
  returning id into v_re;

  insert into public.sequences (workspace_id, name, audience, description, sleep_days, reengage_to, is_seeded)
  values (p_workspace_id, 'Cold nurture', 'cold',
          '6 emails over 30 days, then sleeps 75 days before one re-engagement cycle.', 75, v_re, true)
  returning id into v_cold;

  insert into public.sequences (workspace_id, name, audience, description, sleep_days, reengage_to, is_seeded)
  values (p_workspace_id, 'Hot follow-up', 'hot',
          '5 emails over 20 days, then sleeps 60 days before one re-engagement cycle.', 60, v_re, true)
  returning id into v_hot;

  -- COLD: 1,2,3,5,6 then the closer (Cold 4) — day 0,3,7,12,20,30
  for t, made in
    select id, row_number() over () from (
      select id, 1 as ord from public.email_templates where workspace_id = p_workspace_id and name = 'Cold 1: The reopener'
      union all select id, 2 from public.email_templates where workspace_id = p_workspace_id and name = 'Cold 2: Two refusal mistakes'
      union all select id, 3 from public.email_templates where workspace_id = p_workspace_id and name = 'Cold 3: Client story'
      union all select id, 4 from public.email_templates where workspace_id = p_workspace_id and name = 'Cold 5: The real timeline'
      union all select id, 5 from public.email_templates where workspace_id = p_workspace_id and name = 'Cold 6: What it opens up'
      union all select id, 6 from public.email_templates where workspace_id = p_workspace_id and name = 'Cold 4: Should I close your file?'
    ) x order by ord
  loop
    insert into public.sequence_steps (sequence_id, workspace_id, step_no, day_offset, template_id)
    values (v_cold, p_workspace_id, made,
            case made when 1 then 0 when 2 then 3 when 3 then 7 when 4 then 12 when 5 then 20 else 30 end, t);
  end loop;

  -- HOT: 1..5 — day 0,3,7,12,20
  for t, made in
    select id, row_number() over () from (
      select id, 1 as ord from public.email_templates where workspace_id = p_workspace_id and name = 'Hot 1: What happens next'
      union all select id, 2 from public.email_templates where workspace_id = p_workspace_id and name = 'Hot 2: Costs and timing'
      union all select id, 3 from public.email_templates where workspace_id = p_workspace_id and name = 'Hot 3: Someone with your profile'
      union all select id, 4 from public.email_templates where workspace_id = p_workspace_id and name = 'Hot 4: Anything blocking you?'
      union all select id, 5 from public.email_templates where workspace_id = p_workspace_id and name = 'Hot 5: Leaving it with you'
    ) x order by ord
  loop
    insert into public.sequence_steps (sequence_id, workspace_id, step_no, day_offset, template_id)
    values (v_hot, p_workspace_id, made,
            case made when 1 then 0 when 2 then 3 when 3 then 7 when 4 then 12 else 20 end, t);
  end loop;

  -- RE-ENGAGEMENT: RE 1..3 — day 0,5,12
  for t, made in
    select id, row_number() over () from (
      select id, 1 as ord from public.email_templates where workspace_id = p_workspace_id and name = 'RE 1: Six months later'
      union all select id, 2 from public.email_templates where workspace_id = p_workspace_id and name = 'RE 2: What changed this year'
      union all select id, 3 from public.email_templates where workspace_id = p_workspace_id and name = 'RE 3: The final note'
    ) x order by ord
  loop
    insert into public.sequence_steps (sequence_id, workspace_id, step_no, day_offset, template_id)
    values (v_re, p_workspace_id, made,
            case made when 1 then 0 when 2 then 5 else 12 end, t);
  end loop;

  insert into public.sequence_settings (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  return 3;
end;
$fn$;
grant execute on function public.seed_default_sequences(uuid) to authenticated;


-- ── 5. THE DAILY CAP — ramps 30 -> 60 -> 120 -> 180 over four weeks ─────────

create or replace function public.sequence_daily_cap(p_workspace_id uuid)
returns int
language plpgsql stable security definer set search_path = public as $fn$
declare s record; wk int;
begin
  select * into s from public.sequence_settings where workspace_id = p_workspace_id;
  if s is null then return 30; end if;
  if s.cap_override is not null and s.cap_override > 0 then return s.cap_override; end if;
  wk := floor(((now() at time zone 'Asia/Kolkata')::date - s.ramp_started_at) / 7.0);
  return case when wk <= 0 then 30 when wk = 1 then 60 when wk = 2 then 120 else 180 end;
end;
$fn$;
grant execute on function public.sequence_daily_cap(uuid) to authenticated;

create or replace function public.sequence_sent_today(p_workspace_id uuid)
returns int
language sql stable security definer set search_path = public as $fn$
  select count(*)::int from public.sequence_sends
   where workspace_id = p_workspace_id
     and (sent_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;
$fn$;
grant execute on function public.sequence_sent_today(uuid) to authenticated;


-- ── 6. ENROL FRESH LEADS — "next 50/100, fresh only" ────────────────────────
-- Fresh means: NEVER enrolled in any sequence, ever. Also requires the right
-- stage for the sequence's audience, a contactable address, not suppressed.
-- Oldest-untouched first, same fairness rule as the Lead Engine.

create or replace function public.enroll_fresh_leads(
  p_workspace_id uuid, p_sequence_id uuid, p_count int
)
returns table (enrolled int, reason text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_seq record; v_lead record; v_made int := 0;
begin
  if not public.is_campaign_admin(p_workspace_id) then
    enrolled := 0; reason := 'forbidden'; return next; return;
  end if;
  if p_count is null or p_count < 1 then
    enrolled := 0; reason := 'bad_count'; return next; return;
  end if;

  select * into v_seq from public.sequences
   where id = p_sequence_id and workspace_id = p_workspace_id;
  if v_seq is null then enrolled := 0; reason := 'no_sequence'; return next; return; end if;
  if v_seq.audience = 'reengagement' then
    enrolled := 0; reason := 'reengagement_is_automatic'; return next; return;
  end if;

  for v_lead in
    select l.id
      from public.leads l
     where l.workspace_id = p_workspace_id
       and l.stage = v_seq.audience                       -- whitelist: cold OR hot only
       and l.is_sample is not true
       and l.retired_at is null
       and coalesce(l.email, '') like '%@%'
       and not exists (select 1 from public.email_suppressions s
                        where s.workspace_id = p_workspace_id
                          and lower(s.email) = lower(l.email))
       and not exists (select 1 from public.lead_sequences ls   -- fresh = never enrolled
                        where ls.lead_id = l.id)
     order by l.last_touched_at asc nulls first, l.created_at asc
     limit p_count
  loop
    insert into public.lead_sequences (workspace_id, lead_id, sequence_id, next_send_at)
    values (p_workspace_id, v_lead.id, p_sequence_id, now())
    on conflict do nothing;
    v_made := v_made + 1;
  end loop;

  enrolled := v_made;
  reason := case when v_made = 0 then 'none_available'
                 when v_made < p_count then 'partial' else 'ok' end;
  return next;
end;
$fn$;
grant execute on function public.enroll_fresh_leads(uuid, uuid, int) to authenticated;


-- ── 7. MAINTENANCE SWEEP — exits, wakes, safety checks ──────────────────────
-- The five automatic exits from the spec, plus junk safety. Runs every tick.

create or replace function public.sequence_maintenance()
returns table (exited int, woken int)
language plpgsql security definer set search_path = public as $fn$
declare v_exited int := 0; v_woken int := 0; r int;
begin
  -- Unsubscribed or bounced -> Do Not Contact
  update public.lead_sequences ls
     set status = 'do_not_contact', exit_reason = coalesce(s.reason, 'unsubscribed'),
         exited_at = now(), updated_at = now()
    from public.leads l
    join public.email_suppressions s
      on s.workspace_id = l.workspace_id and lower(s.email) = lower(coalesce(l.email, ''))
   where l.id = ls.lead_id
     and ls.status in ('active','paused','sleeping','reengagement');
  get diagnostics r = row_count; v_exited := v_exited + r;

  -- Converted (stage = won)
  update public.lead_sequences ls
     set status = 'converted', exit_reason = 'converted', exited_at = now(), updated_at = now()
    from public.leads l
   where l.id = ls.lead_id and l.stage = 'won'
     and ls.status in ('active','paused','sleeping','reengagement');
  get diagnostics r = row_count; v_exited := v_exited + r;

  -- Turned junk (or retired) -> never email again
  update public.lead_sequences ls
     set status = 'do_not_contact', exit_reason = 'junk', exited_at = now(), updated_at = now()
    from public.leads l
   where l.id = ls.lead_id
     and (l.stage = 'junk' or l.retired_at is not null)
     and ls.status in ('active','paused','sleeping','reengagement');
  get diagnostics r = row_count; v_exited := v_exited + r;

  -- Replied (any inbound email after enrolment)
  update public.lead_sequences ls
     set status = 'exited', exit_reason = 'replied', exited_at = now(), updated_at = now()
   where ls.status in ('active','paused','sleeping','reengagement')
     and exists (select 1 from public.lead_emails e
                  where e.lead_id = ls.lead_id and e.direction = 'in'
                    and e.created_at > ls.enrolled_at);
  get diagnostics r = row_count; v_exited := v_exited + r;

  -- Booked a call (any non-cancelled meeting after enrolment)
  update public.lead_sequences ls
     set status = 'exited', exit_reason = 'booked', exited_at = now(), updated_at = now()
   where ls.status in ('active','paused','sleeping','reengagement')
     and exists (select 1 from public.meetings m
                  where m.lead_id = ls.lead_id and m.status <> 'cancelled'
                    and m.created_at > ls.enrolled_at);
  get diagnostics r = row_count; v_exited := v_exited + r;

  -- Wake sleepers into ONE re-engagement cycle. Already re-engaged -> done.
  update public.lead_sequences ls
     set sequence_id = s.reengage_to, status = 'reengagement', current_step = 0,
         is_reengaged = true, sleep_until = null, next_send_at = now(), updated_at = now()
    from public.sequences s
   where s.id = ls.sequence_id
     and ls.status = 'sleeping' and ls.sleep_until <= now()
     and ls.is_reengaged = false and s.reengage_to is not null;
  get diagnostics r = row_count; v_woken := v_woken + r;

  -- Sleepers with nowhere to go (or already cycled) complete quietly.
  update public.lead_sequences ls
     set status = 'completed', updated_at = now()
    from public.sequences s
   where s.id = ls.sequence_id
     and ls.status = 'sleeping' and ls.sleep_until <= now()
     and (ls.is_reengaged = true or s.reengage_to is null);

  exited := v_exited; woken := v_woken; return next;
end;
$fn$;


-- ── 8. PICK WHAT IS DUE — respecting the cap, follow-ups first ──────────────
-- Returns fully-hydrated rows the sender needs. Leads mid-sequence come before
-- brand-new day-0 sends, so nobody is ever stranded halfway through.

create or replace function public.sequence_pick_due(p_limit int)
returns table (
  enrolment_id uuid, workspace_id uuid, lead_id uuid, sequence_id uuid,
  step_no int, day_offset int, template_id uuid,
  lead_name text, lead_email text, subject text, html text
)
language sql security definer set search_path = public as $fn$
  select ls.id, ls.workspace_id, ls.lead_id, ls.sequence_id,
         st.step_no, st.day_offset, st.template_id,
         l.full_name, l.email, t.subject, t.html
    from public.lead_sequences ls
    join public.sequences  sq on sq.id = ls.sequence_id and sq.active
    join public.sequence_steps st on st.sequence_id = ls.sequence_id
                                 and st.step_no = ls.current_step + 1
    join public.leads l on l.id = ls.lead_id
    join public.email_templates t on t.id = st.template_id
   where ls.status in ('active','reengagement')
     and ls.next_send_at <= now()
     and l.stage in ('cold','hot')                        -- whitelist at send time too
     and l.retired_at is null
     and coalesce(l.email,'') like '%@%'
     and not exists (select 1 from public.email_suppressions s
                      where s.workspace_id = ls.workspace_id
                        and lower(s.email) = lower(l.email))
     and not exists (select 1 from public.sequence_sends ss  -- guarantee 2, pre-checked
                      where ss.lead_id = ls.lead_id and ss.template_id = st.template_id)
   order by ls.current_step desc, ls.next_send_at asc
   limit greatest(p_limit, 0);
$fn$;


-- ── 9. MARK SENT — advance, schedule next, sleep, or complete ───────────────

create or replace function public.sequence_mark_sent(
  p_enrolment_id uuid, p_template_id uuid, p_step_no int, p_subject text
)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  ls record; nxt record; sq record;
begin
  select * into ls from public.lead_sequences where id = p_enrolment_id;
  if ls is null then return; end if;
  select * into sq from public.sequences where id = ls.sequence_id;

  insert into public.sequence_sends (workspace_id, lead_id, sequence_id, template_id, step_no, subject)
  values (ls.workspace_id, ls.lead_id, ls.sequence_id, p_template_id, p_step_no, p_subject)
  on conflict (lead_id, template_id) do nothing;

  select * into nxt from public.sequence_steps
   where sequence_id = ls.sequence_id and step_no = p_step_no + 1;

  if nxt is not null then
    -- Next email due after the gap between this step and the next.
    update public.lead_sequences
       set current_step = p_step_no, last_sent_at = now(),
           next_send_at = now() + make_interval(days => greatest(nxt.day_offset -
             coalesce((select day_offset from public.sequence_steps
                        where sequence_id = ls.sequence_id and step_no = p_step_no), 0), 1)),
           updated_at = now()
     where id = p_enrolment_id;
  elsif ls.status = 'reengagement' or sq.reengage_to is null or ls.is_reengaged then
    -- Last email of the re-engagement (or a sequence with no follow-on): done forever.
    update public.lead_sequences
       set current_step = p_step_no, last_sent_at = now(), status = 'completed', updated_at = now()
     where id = p_enrolment_id;
  else
    -- Last email of the main run: sleep, then one re-engagement cycle.
    update public.lead_sequences
       set current_step = p_step_no, last_sent_at = now(), status = 'sleeping',
           sleep_until = now() + make_interval(days => coalesce(sq.sleep_days, 75)),
           updated_at = now()
     where id = p_enrolment_id;
  end if;
end;
$fn$;

-- Safety: if a due template was somehow already sent (guarantee 2 fired),
-- skip that step forward so the enrolment can never wedge.
create or replace function public.sequence_unwedge()
returns int
language plpgsql security definer set search_path = public as $fn$
declare r record; n int := 0;
begin
  for r in
    select ls.id, st.step_no, st.template_id
      from public.lead_sequences ls
      join public.sequence_steps st on st.sequence_id = ls.sequence_id
                                   and st.step_no = ls.current_step + 1
     where ls.status in ('active','reengagement') and ls.next_send_at <= now()
       and exists (select 1 from public.sequence_sends ss
                    where ss.lead_id = ls.lead_id and ss.template_id = st.template_id)
  loop
    perform public.sequence_mark_sent(r.id, r.template_id, r.step_no,
      '(skipped: already received this email)');
    n := n + 1;
  end loop;
  return n;
end;
$fn$;


-- ── 10. UI READ MODELS ──────────────────────────────────────────────────────

create or replace function public.sequences_overview(p_workspace_id uuid)
returns table (
  id uuid, name text, audience text, description text, active boolean,
  sleep_days int, steps int, span_days int,
  n_active int, n_paused int, n_sleeping int, n_reengagement int,
  n_completed int, n_converted int, n_exited int, n_dnc int
)
language sql stable security definer set search_path = public as $fn$
  select s.id, s.name, s.audience, s.description, s.active, s.sleep_days,
         (select count(*)::int from public.sequence_steps st where st.sequence_id = s.id),
         (select coalesce(max(st.day_offset),0)::int from public.sequence_steps st where st.sequence_id = s.id),
         count(*) filter (where ls.status = 'active')::int,
         count(*) filter (where ls.status = 'paused')::int,
         count(*) filter (where ls.status = 'sleeping')::int,
         count(*) filter (where ls.status = 'reengagement')::int,
         count(*) filter (where ls.status = 'completed')::int,
         count(*) filter (where ls.status = 'converted')::int,
         count(*) filter (where ls.status = 'exited')::int,
         count(*) filter (where ls.status = 'do_not_contact')::int
    from public.sequences s
    left join public.lead_sequences ls on ls.sequence_id = s.id
   where s.workspace_id = p_workspace_id
   group by s.id
   order by case s.audience when 'cold' then 1 when 'hot' then 2 else 3 end;
$fn$;
grant execute on function public.sequences_overview(uuid) to authenticated;

create or replace function public.sequence_stats(p_workspace_id uuid)
returns table (
  in_sequence int, sent_today int, cap_today int, replied int, sleeping int,
  fresh_cold int, fresh_hot int
)
language sql stable security definer set search_path = public as $fn$
  select
    (select count(*)::int from public.lead_sequences
      where workspace_id = p_workspace_id and status in ('active','reengagement')),
    public.sequence_sent_today(p_workspace_id),
    public.sequence_daily_cap(p_workspace_id),
    (select count(*)::int from public.lead_sequences
      where workspace_id = p_workspace_id and exit_reason = 'replied'),
    (select count(*)::int from public.lead_sequences
      where workspace_id = p_workspace_id and status = 'sleeping'),
    (select count(*)::int from public.leads l
      where l.workspace_id = p_workspace_id and l.stage = 'cold'
        and l.is_sample is not true and l.retired_at is null
        and coalesce(l.email,'') like '%@%'
        and not exists (select 1 from public.lead_sequences ls where ls.lead_id = l.id)
        and not exists (select 1 from public.email_suppressions s
                         where s.workspace_id = p_workspace_id and lower(s.email) = lower(l.email))),
    (select count(*)::int from public.leads l
      where l.workspace_id = p_workspace_id and l.stage = 'hot'
        and l.is_sample is not true and l.retired_at is null
        and coalesce(l.email,'') like '%@%'
        and not exists (select 1 from public.lead_sequences ls where ls.lead_id = l.id)
        and not exists (select 1 from public.email_suppressions s
                         where s.workspace_id = p_workspace_id and lower(s.email) = lower(l.email)));
$fn$;
grant execute on function public.sequence_stats(uuid) to authenticated;

create or replace function public.sequence_leads_list(p_workspace_id uuid, p_limit int default 400)
returns table (
  enrolment_id uuid, lead_id uuid, lead_name text, lead_email text, lead_stage text,
  sequence_name text, audience text, status text, current_step int, total_steps int,
  last_sent_at timestamptz, next_send_at timestamptz, sleep_until timestamptz,
  exit_reason text, enrolled_at timestamptz
)
language sql stable security definer set search_path = public as $fn$
  select ls.id, l.id, l.full_name, l.email, l.stage,
         s.name, s.audience, ls.status, ls.current_step,
         (select count(*)::int from public.sequence_steps st where st.sequence_id = s.id),
         ls.last_sent_at, ls.next_send_at, ls.sleep_until, ls.exit_reason, ls.enrolled_at
    from public.lead_sequences ls
    join public.leads l on l.id = ls.lead_id
    join public.sequences s on s.id = ls.sequence_id
   where ls.workspace_id = p_workspace_id
   order by case ls.status when 'active' then 1 when 'reengagement' then 2 when 'paused' then 3
                           when 'sleeping' then 4 else 5 end,
            ls.next_send_at asc nulls last
   limit greatest(p_limit, 1);
$fn$;
grant execute on function public.sequence_leads_list(uuid, int) to authenticated;


-- ── 11. PER-LEAD MANUAL CONTROLS — pause / resume / stop / restart ──────────

create or replace function public.lead_sequence_action(p_enrolment_id uuid, p_action text)
returns text
language plpgsql security definer set search_path = public as $fn$
declare ls record;
begin
  select * into ls from public.lead_sequences where id = p_enrolment_id;
  if ls is null then return 'not_found'; end if;
  if not public.is_campaign_admin(ls.workspace_id) then return 'forbidden'; end if;

  if p_action = 'pause' and ls.status in ('active','reengagement') then
    update public.lead_sequences set status = 'paused', updated_at = now() where id = p_enrolment_id;
    return 'paused';
  elsif p_action = 'resume' and ls.status = 'paused' then
    update public.lead_sequences
       set status = case when ls.is_reengaged then 'reengagement' else 'active' end,
           next_send_at = greatest(ls.next_send_at, now()), updated_at = now()
     where id = p_enrolment_id;
    return 'resumed';
  elsif p_action = 'stop' then
    update public.lead_sequences
       set status = 'exited', exit_reason = 'manual', exited_at = now(), updated_at = now()
     where id = p_enrolment_id;
    return 'stopped';
  elsif p_action = 'restart' then
    -- Restart from the top. Guarantee 2 still holds: any email they already
    -- received is skipped automatically by the unwedge pass.
    update public.lead_sequences
       set status = case when ls.is_reengaged then 'reengagement' else 'active' end,
           current_step = 0, next_send_at = now(), sleep_until = null,
           exit_reason = null, exited_at = null, updated_at = now()
     where id = p_enrolment_id;
    return 'restarted';
  end if;
  return 'no_op';
end;
$fn$;
grant execute on function public.lead_sequence_action(uuid, text) to authenticated;


-- ── 12. CAMPAIGN STOP now cancels its queue permanently ─────────────────────
-- (Fixes the older one-off Campaign Center: stopped queues used to sit as
-- 'queued' forever; a status flip back would have fired them all.)

create or replace function public.campaign_cancel_queue()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.status = 'stopped' and old.status is distinct from 'stopped' then
    update public.campaign_recipients
       set status = 'skipped', error = 'campaign_stopped'
     where campaign_id = new.id and status = 'queued';
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_campaign_cancel_queue on public.campaigns;
create trigger trg_campaign_cancel_queue
  after update on public.campaigns
  for each row execute function public.campaign_cancel_queue();


-- ── 13. THE CLOCK — tick every 30 minutes ───────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('migrizo-sequences-tick'); exception when others then null; end $$;
select cron.schedule('migrizo-sequences-tick', '*/30 * * * *', $$
  select net.http_post(
    url     := 'https://crm.migrizo.com/api/sequences/tick',
    headers := '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

notify pgrst, 'reload schema';

-- Confirmation
select 'sequences' as object, count(*) from public.sequences
union all select 'sequence_steps', count(*) from public.sequence_steps
union all select 'lead_sequences', count(*) from public.lead_sequences
union all select 'cron job', count(*) from cron.job where jobname = 'migrizo-sequences-tick';
