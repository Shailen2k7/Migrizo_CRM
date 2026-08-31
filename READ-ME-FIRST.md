# Found it. Two bugs, both mine.

I compared your Aug 7 copy against what is live now. Here is exactly what changed
and why leads stopped appearing.

---

## Bug 1 — I made lead matching far more aggressive

**Aug 7 (working):**
```ts
.eq('phone', phone)          // exact string match
```

**What I shipped:**
```ts
.ilike('phone', `%${last10}`)   // ANY lead ending in the same 10 digits
// plus a NEW email fallback that never existed before
```

I changed it to fix a real problem — Meta sends `+919812345678`,
`919812345678` and `p:+91 98123 45678` for the same person. But it had a
consequence I did not think through.

**Any lead in your database stored without a country code** — `9812345678`,
typical of CSV imports and manually added leads — now matches Meta's
`+919812345678`. Under the old code those were two different records and a new
lead was created, which is why you saw every lead. Under my code they match, so
the person is folded into the old record and **never appears in Daily tracker**.

The email fallback made it worse: a second, entirely new way to suppress a lead.

**Fixed:** reverted to the exact match that ran for a year.

Loose matching is only safe once returning submissions are reliably visible — and
because of bug 2, they were not. Exact matching errs towards showing you a lead,
which is the right way to be wrong. A visible duplicate can be merged; an
invisible lead is gone.

---

## Bug 2 — the submissions counter has been recording nothing at all

Migration 083 created the uniqueness guard as a **partial** index:

```sql
create unique index form_submissions_meta_id
  on form_submissions (meta_lead_id) where meta_lead_id is not null;
```

The endpoint writes with `ON CONFLICT (meta_lead_id)`. **Postgres cannot use a
partial index as a conflict target**, so every single write failed with
*"there is no unique or exclusion constraint matching the ON CONFLICT
specification"*.

And I never checked that error, so it failed **silently**.

**Since the deploy, not one submission has been recorded.** Every number on that
line — "11 submissions = 11 new + 0 returning" — is backfill data from 083,
frozen at deploy time. That is why "returning" sat at 0 no matter what happened:
nothing was ever being written to read back.

**Fixed:** 086 rebuilds it as a plain unique index. Postgres treats NULLs as
distinct, so submissions without a Meta id are still unlimited, and ON CONFLICT
resolves. The endpoint now logs the error if it ever fails again.

---

## What you get back

- Every lead that arrives creates a visible row again, exactly as on Aug 7
- The submissions line becomes live instead of frozen
- Returning submitters appear in the list, tagged **FILLED AGAIN**
- 085 logs every POST including rejected ones, so this is diagnosable from SQL

## Install — order matters

1. `supabase/migrations/086_fix_submission_index.sql` ← **this one first**
2. `supabase/migrations/085_ingest_log.sql`
3. Upload the 3 code files
4. Netlify redeploys

Both migrations are idempotent.

## Then verify

```sql
-- should climb as leads arrive, instead of sitting frozen
select count(*), max(submitted_at at time zone 'Asia/Kolkata')
  from form_submissions;
```

---

## Still worth checking separately

Your newest lead was **11:52 AM** — a hard stop, which neither of these bugs
explains. Bug 1 suppresses *some* leads, not all of them at a fixed minute.

So please still check: is the Make scenario **Active**, and how many operations
are left on your plan? Each lead costs 3.
