-- =============================================================================
-- MIGRIZO CRM — 006_push_notifications.sql
-- Device push subscriptions + exact-time follow-up dispatch via pg_cron.
--
-- WHAT THIS DOES
--   1. push_subscriptions table — one row per enabled device (laptop, phone).
--   2. follow_ups.notified_at   — guarantees each reminder fires exactly once.
--   3. pg_cron job (every minute) → calls the CRM's /api/push/dispatch endpoint
--      via pg_net, which sends the actual push notifications.
--
-- BEFORE RUNNING: add these env vars in Netlify (Site settings → Env vars),
-- then redeploy once so the endpoint knows the keys:
--   NEXT_PUBLIC_VAPID_PUBLIC_KEY = BJcsVxoQByloBLADHHgfhaOmekbiHOKG6wIP92npe1l9A-3MR0j4FAjeM2KBro4NpOr3MXAbvKgKoVA6NgGeFdM
--   VAPID_PRIVATE_KEY            = 9MUgqMuI3yGmFOVz3xKcq7VdRtQz4XJ9lJZDbmyAcZo
--   VAPID_SUBJECT                = mailto:info@migrizo.com
--   CRON_SECRET                  = ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9
-- =============================================================================

-- 1) Device subscriptions ------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz default now()
);

create index if not exists idx_push_subs_workspace on public.push_subscriptions (workspace_id);
create index if not exists idx_push_subs_user      on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all to public
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and workspace_id in (select user_workspaces()));

-- 2) One-shot notification guard ------------------------------------------------
alter table public.follow_ups
  add column if not exists notified_at timestamptz;

-- 3) Cron: every minute, ask the CRM to dispatch due reminders -------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of the job, then (re)schedule it.
do $$
begin
  perform cron.unschedule('migrizo-push-dispatch');
exception when others then null;
end $$;

select cron.schedule(
  'migrizo-push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://crm.migrizo.com/api/push/dispatch',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Verify: select jobname, schedule, active from cron.job;
