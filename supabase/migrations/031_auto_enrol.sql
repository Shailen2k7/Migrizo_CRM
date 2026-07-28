-- ============================================================================
-- 031: AUTOMATIC DAILY ENROLMENT
--
-- Until now you pressed "Enrol" by hand. This lets the system top itself up
-- every day: a number of fresh cold leads and a separate number of fresh hot
-- leads, picked oldest first, never repeating anyone.
--
-- Hot is kept separate on purpose. Hot leads are scarcer and their sequence is
-- shorter (5 emails over 20 days against 6 over 30), so one shared number
-- would either burn through the hot pool or starve the cold one.
--
-- It runs once per Indian calendar day, driven by the same 30 minute clock
-- that sends the emails. If the clock misses a run, the next one catches up;
-- if it runs ten times in an hour, only the first enrols anything.
--
-- Safe to run repeatedly.
-- ============================================================================

alter table public.sequence_settings
  add column if not exists auto_enrol       boolean not null default false,
  add column if not exists cold_per_day     int     not null default 0,
  add column if not exists hot_per_day      int     not null default 0,
  add column if not exists last_enrolled_on date;

-- Every workspace needs a settings row for the toggle to have somewhere to live.
insert into public.sequence_settings (workspace_id)
select w.id from public.workspaces w
 where not exists (select 1 from public.sequence_settings s where s.workspace_id = w.id);


-- ── The daily top up ────────────────────────────────────────────────────────
-- Called by the tick. Deliberately does NOT go through enroll_fresh_leads,
-- because that checks is_campaign_admin and the cron has no signed-in user.

create or replace function public.sequence_auto_enrol()
returns table (workspace_id uuid, cold_added int, hot_added int)
language plpgsql security definer set search_path = public as $fn$
declare
  s record; seq record; lead record;
  today date; want int; made int;
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

    -- One pass for cold, one for hot. Same rules, different pool.
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
             and l.stage = seq.audience              -- whitelist, cold or hot only
             and l.is_sample is not true
             and l.retired_at is null
             and coalesce(l.email, '') like '%@%'
             and not exists (select 1 from public.email_suppressions x
                              where x.workspace_id = s.workspace_id
                                and lower(x.email) = lower(l.email))
             and not exists (select 1 from public.lead_sequences ls
                              where ls.lead_id = l.id)   -- fresh means never enrolled
           order by l.last_touched_at asc nulls first, l.created_at asc
           limit want
        loop
          insert into public.lead_sequences (workspace_id, lead_id, sequence_id, next_send_at)
          values (s.workspace_id, lead.id, seq.id, now())
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


-- ── Saving the settings from the UI ─────────────────────────────────────────

create or replace function public.sequence_set_auto_enrol(
  p_workspace_id uuid, p_active boolean, p_cold int, p_hot int
)
returns text
language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_campaign_admin(p_workspace_id) then return 'forbidden'; end if;

  insert into public.sequence_settings (workspace_id) values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  update public.sequence_settings
     set auto_enrol   = coalesce(p_active, false),
         cold_per_day = greatest(coalesce(p_cold, 0), 0),
         hot_per_day  = greatest(coalesce(p_hot, 0), 0),
         updated_at   = now()
   where sequence_settings.workspace_id = p_workspace_id;

  return 'saved';
end;
$fn$;
grant execute on function public.sequence_set_auto_enrol(uuid, boolean, int, int) to authenticated;


-- ── What the UI needs to show ───────────────────────────────────────────────

create or replace function public.sequence_auto_status(p_workspace_id uuid)
returns table (
  auto_enrol boolean, cold_per_day int, hot_per_day int,
  last_enrolled_on date, enrolled_today boolean,
  cap_today int, projected_daily int
)
language sql stable security definer set search_path = public as $fn$
  select
    s.auto_enrol, s.cold_per_day, s.hot_per_day, s.last_enrolled_on,
    (s.last_enrolled_on = (now() at time zone 'Asia/Kolkata')::date),
    public.sequence_daily_cap(p_workspace_id),
    -- Each enrolled lead eventually sends one email per step. At a steady
    -- rate, daily volume settles at (rate x number of steps).
    (s.cold_per_day * coalesce((select count(*) from public.sequence_steps st
        join public.sequences sq on sq.id = st.sequence_id
       where sq.workspace_id = p_workspace_id and sq.audience = 'cold'), 6)
     + s.hot_per_day * coalesce((select count(*) from public.sequence_steps st
        join public.sequences sq on sq.id = st.sequence_id
       where sq.workspace_id = p_workspace_id and sq.audience = 'hot'), 5))::int
  from public.sequence_settings s
 where s.workspace_id = p_workspace_id;
$fn$;
grant execute on function public.sequence_auto_status(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── VERIFICATION ────────────────────────────────────────────────────────────
select workspace_id, auto_enrol, cold_per_day, hot_per_day, last_enrolled_on
  from public.sequence_settings;
