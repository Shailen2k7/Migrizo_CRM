-- =============================================================================
-- 083 — EVERY AD-FORM SUBMISSION IS RECORDED
-- -----------------------------------------------------------------------------
-- THE PROBLEM THIS FIXES
--
-- Meta counts SUBMISSIONS. The CRM counted PEOPLE. When someone who is already
-- in the database fills the form again, the ingest endpoint folded their answers
-- into the existing lead and wrote NOTHING — no row, no timestamp, no activity.
-- The submission left no trace anywhere in Postgres.
--
-- Two consequences, both bad:
--   1. Daily Tracker could never agree with Meta, and there was no way to find
--      out why without opening Make.com and reading execution logs by hand.
--   2. A repeat submission is one of the strongest buying signals there is —
--      that person came back and filled the form a SECOND time — and nobody
--      ever found out.
--
-- WHAT THIS ADDS
--   • form_submissions — one row per submission, forever. New or returning.
--   • leads.last_form_submitted_at / form_submission_count
--   • form_submission_stats() — the numbers Daily Tracker shows
--
-- Idempotent. Safe to run twice.
-- =============================================================================

-- ── the table ────────────────────────────────────────────────────────────────
create table if not exists public.form_submissions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete set null,

  -- Meta's own id for the submission. Unique, so re-running a Make scenario or
  -- a webhook retry can never double-count. Null when Make does not send it.
  meta_lead_id  text,

  submitted_at  timestamptz not null default now(),
  is_new_lead   boolean not null default true,

  -- a snapshot of what arrived, so the record survives later edits to the lead
  full_name     text,
  phone         text,
  email         text,

  -- campaign attribution, when Make sends it
  ad_name       text,
  form_name     text,
  campaign_name text,
  platform      text,

  raw           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

comment on table public.form_submissions is
  'One row per Meta ad-form submission, new lead or returning. Lets the CRM reconcile with Meta exactly. 083.';

-- One submission id, one row. This is what makes the count trustworthy.
create unique index if not exists form_submissions_meta_id
  on public.form_submissions (meta_lead_id) where meta_lead_id is not null;

create index if not exists form_submissions_ws_time
  on public.form_submissions (workspace_id, submitted_at desc);

create index if not exists form_submissions_lead
  on public.form_submissions (lead_id);

-- ── lead columns ─────────────────────────────────────────────────────────────
alter table public.leads add column if not exists last_form_submitted_at timestamptz;
alter table public.leads add column if not exists form_submission_count  int not null default 1;

comment on column public.leads.last_form_submitted_at is
  'When this person most recently filled the ad form. Updated on every submission, including repeats. 083.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.form_submissions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'form_submissions'
       and policyname = 'form_submissions_read'
  ) then
    create policy form_submissions_read on public.form_submissions
      for select to authenticated
      using (workspace_id in (select public.user_workspaces()));
  end if;
end $$;

-- Writes come only from the ingest endpoint on the service role, which bypasses
-- RLS. No insert/update/delete policy is granted to authenticated on purpose.

-- ── the numbers Daily Tracker shows ──────────────────────────────────────────
-- Returns submissions / new / returning for a window, plus the lead ids behind
-- the returning ones so the UI can list them without a second query.
drop function if exists public.form_submission_stats(uuid, timestamptz, timestamptz);

create function public.form_submission_stats(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz
) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'submissions', count(*),
    'new_leads',   count(*) filter (where is_new_lead),
    'returning',   count(*) filter (where not is_new_lead),
    'returning_lead_ids',
      coalesce(jsonb_agg(distinct lead_id) filter (where not is_new_lead and lead_id is not null), '[]'::jsonb),
    'first_at',    min(submitted_at),
    'last_at',     max(submitted_at)
  )
  from public.form_submissions
  where workspace_id = p_workspace_id
    and workspace_id in (select public.user_workspaces())
    and submitted_at >= p_from
    and submitted_at <  p_to;
$$;

grant execute on function public.form_submission_stats(uuid, timestamptz, timestamptz) to authenticated;

-- ── backfill: give existing leads a starting point ───────────────────────────
-- Every lead that came from the ad form gets one historical submission row, so
-- the table is not empty for past dates and old days still reconcile roughly.
-- Guarded so re-running never duplicates.
insert into public.form_submissions
  (workspace_id, lead_id, submitted_at, is_new_lead, full_name, phone, email, form_name, raw)
select l.workspace_id, l.id, l.created_at, true, l.full_name, l.phone, l.email,
       'backfilled from lead record', coalesce(l.intake, '{}'::jsonb)
  from public.leads l
 where coalesce(l.source, '') ilike '%meta%'
   and not exists (
     select 1 from public.form_submissions s where s.lead_id = l.id
   );

update public.leads
   set last_form_submitted_at = coalesce(last_form_submitted_at, created_at)
 where last_form_submitted_at is null;

do $$
declare v int;
begin
  select count(*) into v from public.form_submissions;
  raise notice '083 DONE: form_submissions now holds % rows.', v;
end $$;
