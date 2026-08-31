-- =============================================================================
-- 086 — FIX: form_submissions was silently recording NOTHING
-- -----------------------------------------------------------------------------
-- MY BUG. 083 created the uniqueness guard as a PARTIAL index:
--
--   create unique index form_submissions_meta_id
--     on form_submissions (meta_lead_id) where meta_lead_id is not null;
--
-- The ingest endpoint then writes with ON CONFLICT (meta_lead_id). Postgres
-- cannot use a PARTIAL index for a conflict target unless the statement repeats
-- the same WHERE clause — so every insert failed with:
--
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- The endpoint does not check that error, so it failed silently. Since the
-- deploy, not one submission has been recorded. Every number on the Daily
-- Tracker's submissions line has been backfill data from 083, frozen in time —
-- which is exactly why "returning" has sat at 0 no matter what happened.
--
-- THE FIX: a plain unique index. Postgres treats NULLs as distinct, so any
-- number of rows without a Meta id are still allowed, and ON CONFLICT works.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

drop index if exists public.form_submissions_meta_id;

create unique index if not exists form_submissions_meta_id
  on public.form_submissions (meta_lead_id);

comment on index public.form_submissions_meta_id is
  'Full (not partial) unique index so ON CONFLICT (meta_lead_id) resolves. NULLs are distinct, so submissions without a Meta id are unlimited. 086.';

do $$
declare v_total int; v_today int;
begin
  select count(*) into v_total from public.form_submissions;
  select count(*) into v_today from public.form_submissions
   where submitted_at >= (((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata');
  raise notice '086 DONE: index rebuilt. % submission rows total, % today. New submissions will now record.',
    v_total, v_today;
end $$;
