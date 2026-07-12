-- =============================================================================
-- MIGRIZO CRM — 011_scheduler.sql
-- Scheduling & Reminder Module (Phase 1): booking pages, meetings, the
-- reminder queue, and the booking activity log.
-- =============================================================================

-- One row per bookable team member (personal booking link).
create table if not exists public.scheduler_members (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid not null,
  slug           text not null unique,          -- crm.migrizo.com/book/<slug>
  display_name   text not null,
  title          text default 'Consultation',
  bio            text,
  meeting_link   text,                          -- personal Google Meet/Zoom link (used until Google OAuth phase)
  timezone       text not null default 'Asia/Kolkata',
  slot_minutes   int  not null default 30,
  buffer_minutes int  not null default 10,
  working_hours  jsonb not null default '{"mon":[["10:00","18:00"]],"tue":[["10:00","18:00"]],"wed":[["10:00","18:00"]],"thu":[["10:00","18:00"]],"fri":[["10:00","18:00"]],"sat":[],"sun":[]}',
  active         boolean not null default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- Every booked meeting.
create table if not exists public.meetings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  member_id      uuid not null references public.scheduler_members(id) on delete cascade,
  lead_id        uuid,                          -- auto-linked when the email/phone matches a lead
  client_name    text not null,
  client_email   text not null,
  client_phone   text,
  client_tz      text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'upcoming',  -- upcoming | completed | cancelled | no_show
  notes          text,
  meet_link      text,
  manage_token   text not null unique,          -- powers one-click reschedule/cancel
  source         text default 'booking_page',
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_meetings_ws_time on public.meetings (workspace_id, starts_at);
create index if not exists idx_meetings_member_time on public.meetings (member_id, starts_at) where status = 'upcoming';

-- The reminder queue (drained by cron, with retries).
create table if not exists public.meeting_reminders (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  workspace_id uuid not null,
  kind         text not null,        -- confirm | h24 | h3 | h1 | m15 | start | followup
  send_at      timestamptz not null,
  status       text not null default 'queued',   -- queued | sent | failed | skipped
  attempts     int  not null default 0,
  error        text,
  sent_at      timestamptz,
  created_at   timestamptz default now()
);
create index if not exists idx_reminders_due on public.meeting_reminders (status, send_at);

-- Booking activity timeline (every event, auditable).
create table if not exists public.meeting_activity (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  workspace_id uuid not null,
  event        text not null,        -- booked | rescheduled | cancelled | reminder_sent | status_changed | note_added | email_failed
  meta         jsonb default '{}',
  created_at   timestamptz default now()
);
create index if not exists idx_meeting_activity on public.meeting_activity (meeting_id, created_at desc);

-- RLS ------------------------------------------------------------------------
alter table public.scheduler_members enable row level security;
alter table public.meetings          enable row level security;
alter table public.meeting_reminders enable row level security;
alter table public.meeting_activity  enable row level security;

drop policy if exists "ws sched members" on public.scheduler_members;
create policy "ws sched members" on public.scheduler_members for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "ws meetings" on public.meetings;
create policy "ws meetings" on public.meetings for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "ws meeting reminders" on public.meeting_reminders;
create policy "ws meeting reminders" on public.meeting_reminders for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "ws meeting activity" on public.meeting_activity;
create policy "ws meeting activity" on public.meeting_activity for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

-- Cron: drain due reminders every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin perform cron.unschedule('migrizo-meeting-reminders'); exception when others then null; end $$;
select cron.schedule('migrizo-meeting-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://crm.migrizo.com/api/scheduler/remind',
    headers := '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
