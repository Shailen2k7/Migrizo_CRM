-- =============================================================================
-- RUN THIS FIRST — it answers the question in 10 seconds, no deploy needed
-- Paste into the Supabase SQL editor. Read-only, changes nothing.
-- =============================================================================

-- ── 1. How many leads actually exist for today, in IST? ──────────────────────
-- If this says 11, the CRM genuinely only has 11. If it says 31, the leads are
-- there and the Daily Tracker is the problem — completely different fixes.
select count(*) as leads_created_today_ist
  from public.leads
 where created_at >= (((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata');


-- ── 2. Hour by hour, IST — where did today's leads stop? ─────────────────────
-- A run of empty hours after a certain time is the signal. It tells you exactly
-- when submissions stopped reaching the CRM.
select to_char(created_at at time zone 'Asia/Kolkata', 'HH24:00') as hour_ist,
       count(*)                                                   as leads,
       min(created_at at time zone 'Asia/Kolkata')::time          as first,
       max(created_at at time zone 'Asia/Kolkata')::time          as last
  from public.leads
 where created_at >= (((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata')
 group by 1
 order by 1;


-- ── 3. THE ONE THAT MATTERS — the last 48 hours, split by IST day ────────────
-- Meta reports in your AD ACCOUNT's timezone, which is NOT IST. We proved this
-- yesterday: your export named "20260830" contained rows timestamped 31 Aug IST.
--
-- So Meta's "today" and the CRM's "today" are DIFFERENT WINDOWS. Comparing them
-- on a single day cannot work. Two days side by side shows whether the leads are
-- simply landing on the other side of the line.
select (created_at at time zone 'Asia/Kolkata')::date as ist_day,
       count(*)                                       as leads,
       count(*) filter (where source ilike '%meta%')  as from_meta_ads,
       min(created_at at time zone 'Asia/Kolkata')::time as first_ist,
       max(created_at at time zone 'Asia/Kolkata')::time as last_ist
  from public.leads
 where created_at >= now() - interval '3 days'
 group by 1
 order by 1 desc;

-- Add yesterday + today together and compare with Meta's two-day total.
-- If they match, nothing is lost — the boundary is just in a different place.


-- ── 4. Did the submission recorder actually start working? ───────────────────
-- (needs 083 applied, which it is — the Daily Tracker line is showing)
select (submitted_at at time zone 'Asia/Kolkata')::date as ist_day,
       count(*)                                          as submissions,
       count(*) filter (where is_new_lead)               as new_leads,
       count(*) filter (where not is_new_lead)           as returning
  from public.form_submissions
 where submitted_at >= now() - interval '3 days'
 group by 1
 order by 1 desc;


-- ── 5. AFTER you deploy 085 — the question answers itself ────────────────────
-- Every POST to the ingest endpoint, including the ones that were rejected and
-- previously left no trace at all.
--
--   select public.ingest_health(1);     -- last 24 hours
--   select public.ingest_health(7);     -- last week
--
-- Returns: arrived / created / returning / rejected, and the reason for each
-- rejection. If "arrived" is 11 while Meta says 31, the gap is Meta → Make and
-- nothing in the CRM can fix it. If "arrived" is 31 and 20 were rejected, the
-- reason column names the bug.
--
-- And to see the rejected ones in full:
--
--   select received_at at time zone 'Asia/Kolkata' as at_ist,
--          reason, full_name, phone, email, payload
--     from public.ingest_log
--    where outcome = 'rejected'
--    order by received_at desc
--    limit 50;
