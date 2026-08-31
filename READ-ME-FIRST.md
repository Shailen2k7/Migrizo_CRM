# Every submission now shows in Daily tracker

You said it plainly, so here it is with no argument: **every person who fills the
form appears in Daily tracker, whether they are new or already in the CRM.**

## What changes

The **LEADS ADDED** list now includes returning submitters alongside new leads.
Anyone already in your database who filled the form again in that window shows up
as a row, tagged **FILLED AGAIN** in purple, with the time they re-submitted.

The count above the list counts them too. Nothing is hidden any more.

**One person is still one row.** A returning submitter appears once, on their
existing record, rather than creating a second copy — otherwise they would get a
second welcome email, sit twice in your pipeline, and be counted twice in every
report. You see the event; the pipeline stays clean.

## Also in this pack — 085, the ingest log

Right now a POST that is *rejected* (bad token, missing name, database error)
leaves **no trace anywhere in the database**. That is exactly why I have not been
able to tell you which side is losing leads, and why you have had to open Make by
hand three times.

After 085, every POST is logged with its outcome:

```sql
select public.ingest_health(1);
```

Gives `arrived / created / returning / rejected` plus the reason for each
rejection. And to see them in full:

```sql
select received_at at time zone 'Asia/Kolkata' as at_ist,
       reason, full_name, phone, email, payload
  from public.ingest_log
 where outcome = 'rejected'
 order by received_at desc limit 50;
```

## Install

1. Supabase SQL editor → `supabase/migrations/085_ingest_log.sql` (idempotent)
2. Upload the 3 code files
3. Netlify redeploys

Logging is fire-and-forget and fully guarded — if the table is missing or the
insert fails, lead creation carries on untouched. It can never be why a lead is lost.

## But read CHECK-MAKE-FIRST.md before you do any of this

Your newest lead is 11:52 AM. That is a hard stop, and no CRM change fixes a
hard stop. The 30-second check is in that file.
