-- =============================================================================
-- 124 — CASE MANAGEMENT v2
-- -----------------------------------------------------------------------------
-- Four things, all additive:
--
--   1. CASE NUMBERS. Every case gets a permanent MIG-#### number, backfilled
--      in creation order starting at 1001, sequenced for new cases.
--   2. DELIVERY FIELDS on cases: when the current stage was entered (drives
--      At risk / Overdue), who the ball is with, and the target submission
--      date the deadline counts down to.
--   3. TASK DEADLINES: checklist items gain a due date and an assignee.
--   4. WON → CASE, AUTOMATICALLY. The moment a lead's stage becomes 'won',
--      a trigger opens its case — whichever screen did it: the drawer, the
--      Master sheet, a bulk edit. One case per lead, ever; sample leads are
--      ignored; nothing is emailed or messaged by this trigger. The CRM's
--      minute-cron then pushes the "🎉 New case" notification to the team's
--      phones and desktops (code change, same release).
--
-- Existing behaviour that does NOT change: the six-phase journey powering
-- client update emails stays; the 558 checklist items stay; no WhatsApp or
-- campaign table is touched.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

-- ── 1 · Case numbers ─────────────────────────────────────────────────────────
alter table public.cases add column if not exists case_no bigint;

update public.cases c
set case_no = t.rn + 1000
from (select id, row_number() over (order by created_at, id) as rn from public.cases) t
where c.id = t.id and c.case_no is null;

do $$
declare next_no bigint;
begin
  select coalesce(max(case_no), 1000) + 1 into next_no from public.cases;
  execute format('create sequence if not exists public.cases_case_no_seq start with %s', next_no);
  -- Keep the sequence ahead of the data even when this migration re-runs.
  perform setval('public.cases_case_no_seq', greatest(next_no, nextval('public.cases_case_no_seq')), false);
  alter table public.cases alter column case_no set default nextval('public.cases_case_no_seq');
end $$;

create unique index if not exists ux_cases_case_no on public.cases (case_no);

-- ── 2 · Delivery fields ──────────────────────────────────────────────────────
alter table public.cases add column if not exists stage_entered_at     timestamptz;
alter table public.cases add column if not exists waiting_on           text;
alter table public.cases add column if not exists target_submission_at timestamptz;

do $$ begin
  alter table public.cases add constraint cases_waiting_on_chk
    check (waiting_on is null or waiting_on in ('client', 'team', 'authority'));
exception when duplicate_object then null; end $$;

-- Legacy rows: "entered current stage" is best approximated by last touch.
-- The case page records the real stage start in journey.details; prefer it,
-- because updated_at moves on every edit (owner changes, notes, photos).
update public.cases
   set stage_entered_at = coalesce((journey->'details'->>'stage_entered_at')::timestamptz, updated_at)
 where stage_entered_at is null;

-- ── 3 · Task deadlines ───────────────────────────────────────────────────────
alter table public.case_checklist_items add column if not exists due_at      timestamptz;
alter table public.case_checklist_items add column if not exists assignee_id uuid;

create index if not exists ix_ccl_due on public.case_checklist_items (case_id, due_at)
  where due_at is not null;

-- ── 4 · Won → case, automatically ────────────────────────────────────────────
create or replace function public.open_case_on_won()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_visa text;
begin
  -- Only a real transition INTO won, on a real lead.
  if new.stage is distinct from 'won' or old.stage = 'won' then return new; end if;
  if coalesce(new.is_sample, false) then return new; end if;
  -- One case per lead, ever.
  if exists (select 1 from public.cases c where c.lead_id = new.id) then return new; end if;

  v_visa := case
    when new.visa_type ilike '%ifv%' or new.visa_type ilike '%innovator%' or new.visa_type ilike '%founder%' or new.visa_type ilike '%fiv%' then 'ifv'
    else 'gtv'
  end;

  insert into public.cases (
    workspace_id, lead_id, client_name, client_email, client_phone,
    visa_type, current_phase, delivery_stage, stage_entered_at,
    decision, created_by, owner_id, owner_name
  ) values (
    new.workspace_id, new.id, new.full_name, new.email, new.phone,
    v_visa, 'onboarding', 'case_created', now(),
    'pending', null,
    -- Every case is Mansi Behl's by default (only if she is in this workspace).
    (select m.user_id from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = 'bc7c5aa7-025b-44fe-b794-a106fe416a4b'),
    (select 'Mansi Behl' from public.workspace_members m
      where m.workspace_id = new.workspace_id and m.user_id = 'bc7c5aa7-025b-44fe-b794-a106fe416a4b')
  );

  insert into public.case_activity (workspace_id, case_id, user_id, action, meta)
  select new.workspace_id, c.id, null, 'case_opened',
         jsonb_build_object('source', 'auto_on_won', 'lead_id', new.id)
  from public.cases c where c.lead_id = new.id;

  return new;
end $fn$;

drop trigger if exists open_case_on_won on public.leads;
create trigger open_case_on_won
  after update of stage on public.leads
  for each row execute function public.open_case_on_won();

-- Realtime: the in-app "new case arrived" toast listens for INSERTs on cases,
-- which only reach the browser if the table is in the realtime publication.
do $$ begin
  alter publication supabase_realtime add table public.cases;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect: every case numbered, none missing stage_entered_at, trigger listed.
select
  (select count(*) from public.cases where case_no is null)          as cases_without_number,
  (select count(*) from public.cases where stage_entered_at is null) as cases_without_stage_time,
  (select count(*) from pg_trigger
     where tgrelid = 'public.leads'::regclass and tgname = 'open_case_on_won') as trigger_installed;
