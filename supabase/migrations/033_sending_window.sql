-- ============================================================================
-- 033: SEND DURING WORKING HOURS, NOT AT MIDNIGHT
--
-- THE PROBLEM
--
-- The daily auto enrolment resets on the Indian calendar day, so the first
-- tick after 00:00 IST enrolled the batch AND sent their first email in the
-- same run. With a cap of 30 and a batch size of 40, the entire day's volume
-- left at about five past midnight.
--
-- Cold email arriving at 00:05 reads as a machine, gets opened far less, and
-- teaches spam filters exactly the wrong thing about your domain.
--
-- THE FIX
--
-- Two changes:
--
--   1. A sending window. Nothing sends outside 09:00 to 18:00 IST, Monday to
--      Saturday. The clock still ticks; it simply has nothing to do at night.
--
--   2. A pace. Instead of emptying the whole daily allowance in the first
--      tick of the morning, the cap is released gradually across the window,
--      so the day's volume is spread rather than dumped.
--
-- The settings are per workspace so they can be changed without a deploy.
--
-- Safe to run repeatedly.
-- ============================================================================

alter table public.sequence_settings
  add column if not exists send_from_hour int     not null default 9,   -- IST
  add column if not exists send_to_hour   int     not null default 18,  -- IST
  add column if not exists send_on_sunday boolean not null default false;


-- ── Are we inside the window right now? ─────────────────────────────────────

create or replace function public.sequence_window_open(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select case
    when s.workspace_id is null then false
    when extract(dow from (now() at time zone 'Asia/Kolkata')) = 0
         and not s.send_on_sunday then false
    else extract(hour from (now() at time zone 'Asia/Kolkata'))
           between s.send_from_hour and (s.send_to_hour - 1)
  end
  from public.sequence_settings s
 where s.workspace_id = p_workspace_id;
$fn$;
grant execute on function public.sequence_window_open(uuid) to authenticated;


-- ── How many may go out at this moment? ─────────────────────────────────────
-- Releases the daily cap gradually across the window instead of all at once,
-- so a nine hour window sends roughly an ninth of the day's volume each hour.

create or replace function public.sequence_allowance_now(p_workspace_id uuid)
returns int
language plpgsql stable security definer set search_path = public as $fn$
declare
  s record; cap int; sent int;
  hours numeric; elapsed numeric; allowed int;
begin
  select * into s from public.sequence_settings where workspace_id = p_workspace_id;
  if s is null then return 0; end if;
  if not public.sequence_window_open(p_workspace_id) then return 0; end if;

  cap  := public.sequence_daily_cap(p_workspace_id);
  sent := public.sequence_sent_today(p_workspace_id);

  hours := greatest(s.send_to_hour - s.send_from_hour, 1);
  -- Hours completed so far, plus the hour currently in progress, so the first
  -- tick of the morning is allowed to send its share rather than nothing.
  elapsed := (extract(hour from (now() at time zone 'Asia/Kolkata')) - s.send_from_hour)
             + (extract(minute from (now() at time zone 'Asia/Kolkata')) / 60.0)
             + 1;

  allowed := floor(cap * least(elapsed / hours, 1.0));
  return greatest(allowed - sent, 0);
end;
$fn$;
grant execute on function public.sequence_allowance_now(uuid) to authenticated;


-- ── Newly enrolled leads wait for the window ────────────────────────────────
-- Auto enrolment still happens on the day boundary, which is fine because
-- enrolling is silent. Their first email is simply scheduled for the start of
-- the window rather than immediately.

create or replace function public.sequence_next_window_start(p_workspace_id uuid)
returns timestamptz
language plpgsql stable security definer set search_path = public as $fn$
-- ist and candidate hold IST wall-clock values, so they must be plain
-- timestamps. Declaring them timestamptz makes Postgres reinterpret them in
-- the server timezone and the answer comes out hours adrift.
declare s record; ist timestamp; d date; h int; candidate timestamp;
begin
  select * into s from public.sequence_settings where workspace_id = p_workspace_id;
  if s is null then return now(); end if;

  ist := now() at time zone 'Asia/Kolkata';
  d := ist::date;
  h := extract(hour from ist);

  -- Later today if the window has not opened, otherwise tomorrow.
  if h < s.send_from_hour then
    candidate := (d + make_interval(hours => s.send_from_hour));
  elsif h < s.send_to_hour then
    return now();                      -- window is open, go now
  else
    candidate := ((d + 1) + make_interval(hours => s.send_from_hour));
  end if;

  -- Skip Sunday if it is switched off.
  while extract(dow from candidate) = 0 and not s.send_on_sunday loop
    candidate := candidate + interval '1 day';
  end loop;

  return candidate at time zone 'Asia/Kolkata';
end;
$fn$;
grant execute on function public.sequence_next_window_start(uuid) to authenticated;


-- Auto enrolment now schedules the first email for the window, not for now().
create or replace function public.sequence_auto_enrol()
returns table (workspace_id uuid, cold_added int, hot_added int)
language plpgsql security definer set search_path = public as $fn$
declare
  s record; seq record; lead record;
  today date; want int; made int; start_at timestamptz;
begin
  today := (now() at time zone 'Asia/Kolkata')::date;

  for s in
    select * from public.sequence_settings
     where auto_enrol
       and (last_enrolled_on is null or last_enrolled_on < today)
       and (cold_per_day > 0 or hot_per_day > 0)
  loop
    cold_added := 0;
    hot_added := 0;
    start_at := public.sequence_next_window_start(s.workspace_id);

    for seq in
      select sq.id, sq.audience,
             case sq.audience when 'cold' then s.cold_per_day else s.hot_per_day end as target
        from public.sequences sq
       where sq.workspace_id = s.workspace_id
         and sq.active
         and sq.audience in ('cold','hot')
    loop
      want := seq.target;
      made := 0;
      if want > 0 then
        for lead in
          select l.id
            from public.leads l
           where l.workspace_id = s.workspace_id
             and l.stage = seq.audience
             and l.is_sample is not true
             and l.retired_at is null
             and coalesce(l.email, '') like '%@%'
             and not exists (select 1 from public.email_suppressions x
                              where x.workspace_id = s.workspace_id
                                and lower(x.email) = lower(l.email))
             and not exists (select 1 from public.lead_sequences ls
                              where ls.lead_id = l.id)
           order by l.last_touched_at asc nulls first, l.created_at asc
           limit want
        loop
          insert into public.lead_sequences (workspace_id, lead_id, sequence_id, next_send_at)
          values (s.workspace_id, lead.id, seq.id, start_at)
          on conflict do nothing;
          made := made + 1;
        end loop;
      end if;

      if seq.audience = 'cold' then cold_added := made; else hot_added := made; end if;
    end loop;

    update public.sequence_settings
       set last_enrolled_on = today, updated_at = now()
     where sequence_settings.workspace_id = s.workspace_id;

    workspace_id := s.workspace_id;
    return next;
  end loop;
end;
$fn$;


-- Manual enrolment gets the same treatment, so a batch added at 11pm waits.
create or replace function public.enroll_fresh_leads(
  p_workspace_id uuid, p_sequence_id uuid, p_count int
)
returns table (enrolled int, reason text)
language plpgsql security definer set search_path = public as $fn$
declare
  v_seq record; v_lead record; v_made int := 0; v_start timestamptz;
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

  v_start := public.sequence_next_window_start(p_workspace_id);

  for v_lead in
    select l.id
      from public.leads l
     where l.workspace_id = p_workspace_id
       and l.stage = v_seq.audience
       and l.is_sample is not true
       and l.retired_at is null
       and coalesce(l.email, '') like '%@%'
       and not exists (select 1 from public.email_suppressions s
                        where s.workspace_id = p_workspace_id
                          and lower(s.email) = lower(l.email))
       and not exists (select 1 from public.lead_sequences ls
                        where ls.lead_id = l.id)
     order by l.last_touched_at asc nulls first, l.created_at asc
     limit p_count
  loop
    insert into public.lead_sequences (workspace_id, lead_id, sequence_id, next_send_at)
    values (p_workspace_id, v_lead.id, p_sequence_id, v_start)
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


-- Show the window in the UI status card.
-- Dropped first because the returned columns change shape.
drop function if exists public.sequence_auto_status(uuid);
create or replace function public.sequence_auto_status(p_workspace_id uuid)
returns table (
  auto_enrol boolean, cold_per_day int, hot_per_day int,
  last_enrolled_on date, enrolled_today boolean,
  cap_today int, projected_daily int,
  send_from_hour int, send_to_hour int, send_on_sunday boolean,
  window_open boolean, allowance_now int
)
language sql stable security definer set search_path = public as $fn$
  select
    s.auto_enrol, s.cold_per_day, s.hot_per_day, s.last_enrolled_on,
    (s.last_enrolled_on = (now() at time zone 'Asia/Kolkata')::date),
    public.sequence_daily_cap(p_workspace_id),
    (s.cold_per_day * coalesce((select count(*) from public.sequence_steps st
        join public.sequences sq on sq.id = st.sequence_id
       where sq.workspace_id = p_workspace_id and sq.audience = 'cold'), 6)
     + s.hot_per_day * coalesce((select count(*) from public.sequence_steps st
        join public.sequences sq on sq.id = st.sequence_id
       where sq.workspace_id = p_workspace_id and sq.audience = 'hot'), 5))::int,
    s.send_from_hour, s.send_to_hour, s.send_on_sunday,
    public.sequence_window_open(p_workspace_id),
    public.sequence_allowance_now(p_workspace_id)
  from public.sequence_settings s
 where s.workspace_id = p_workspace_id;
$fn$;
grant execute on function public.sequence_auto_status(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ── VERIFICATION ────────────────────────────────────────────────────────────
select workspace_id,
       send_from_hour || ':00 to ' || send_to_hour || ':00 IST' as window,
       send_on_sunday,
       public.sequence_window_open(workspace_id) as open_right_now,
       public.sequence_allowance_now(workspace_id) as may_send_now,
       (public.sequence_next_window_start(workspace_id) at time zone 'Asia/Kolkata') as next_open
  from public.sequence_settings;
