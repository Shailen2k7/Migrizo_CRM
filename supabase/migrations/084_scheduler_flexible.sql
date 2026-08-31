-- =============================================================================
-- 084 — A BOOKING PAGE YOU CAN RESHAPE WITHOUT A DEVELOPER
-- -----------------------------------------------------------------------------
-- Slot spacing, call length, buffer, per-day hours and timezone were already
-- settable (011 + 057). Five things were not, and every one of them meant
-- asking for code:
--
--   1. A LUNCH BREAK. working_hours has always been an array of windows, but
--      the UI only ever wrote one, so a day was 10:00–22:00 or nothing.
--   2. A DAY OFF. A holiday, a flight, a conference — no way to block a date
--      without editing the weekly pattern and remembering to put it back.
--   3. MINIMUM NOTICE. Hardcoded at 60 minutes. Nobody could change it.
--   4. HOW FAR AHEAD people can book. Hardcoded.
--   5. A DAILY CAP. Six discovery calls in one day is not a working day.
--
-- Plus which reminders go out, which was a code constant.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

-- ── new controls on the member's booking page ────────────────────────────────
alter table public.scheduler_members
  add column if not exists min_notice_minutes  int  not null default 60,
  add column if not exists max_days_ahead      int  not null default 30,
  add column if not exists daily_meeting_cap   int,                       -- null = no cap
  add column if not exists reminder_kinds      jsonb not null default '["h24","h3","h1","m15","start"]'::jsonb,
  add column if not exists paused_message      text;

do $$
begin
  alter table public.scheduler_members
    add constraint scheduler_min_notice_sane check (min_notice_minutes between 0 and 10080);
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.scheduler_members
    add constraint scheduler_horizon_sane check (max_days_ahead between 1 and 180);
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.scheduler_members
    add constraint scheduler_cap_sane check (daily_meeting_cap is null or daily_meeting_cap between 1 and 50);
exception when duplicate_object then null; end $$;

comment on column public.scheduler_members.min_notice_minutes is
  'How far ahead someone must book. 60 = nobody can grab a slot starting in the next hour. 084.';
comment on column public.scheduler_members.max_days_ahead is
  'How far into the future the booking page offers slots. 084.';
comment on column public.scheduler_members.daily_meeting_cap is
  'Maximum meetings offered per day. Once reached, that day shows as full. Null = unlimited. 084.';
comment on column public.scheduler_members.reminder_kinds is
  'Which reminder emails go out. Any subset of h24, h3, h1, m15, start. 084.';

-- ── one-off exceptions to the weekly pattern ─────────────────────────────────
-- A row here wins over working_hours for that single date.
--   windows = '[]'          → the whole day is blocked
--   windows = [["14:00","18:00"]] → that day only, these hours instead
create table if not exists public.scheduler_date_overrides (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  member_id     uuid not null references public.scheduler_members(id) on delete cascade,
  on_date       date not null,
  windows       jsonb not null default '[]'::jsonb,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (member_id, on_date)
);

create index if not exists scheduler_overrides_member_date
  on public.scheduler_date_overrides (member_id, on_date);

comment on table public.scheduler_date_overrides is
  'Per-date exceptions to a member''s weekly hours. Empty windows = day off. 084.';

alter table public.scheduler_date_overrides enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'scheduler_date_overrides'
       and policyname = 'ws sched overrides'
  ) then
    create policy "ws sched overrides" on public.scheduler_date_overrides
      for all to public
      using (workspace_id in (select public.user_workspaces()))
      with check (workspace_id in (select public.user_workspaces()));
  end if;
end $$;

-- ── keep the existing behaviour for everyone already set up ──────────────────
-- Nobody's page changes when this migration runs: the defaults above are
-- exactly what the code did before.
update public.scheduler_members
   set min_notice_minutes = coalesce(min_notice_minutes, 60),
       max_days_ahead     = coalesce(max_days_ahead, 30)
 where min_notice_minutes is null or max_days_ahead is null;

do $$
declare v int;
begin
  select count(*) into v from public.scheduler_members;
  raise notice '084 DONE: % booking page(s) upgraded. Nothing changed for anyone until you edit the new fields.', v;
end $$;
