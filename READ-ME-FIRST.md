# Stop guessing — make the CRM answer this itself

## Run `DIAGNOSE-NOW.sql` first. No deploy needed.

Query 1 is the fork in the road:

| Result | Meaning |
|---|---|
| **11** | The CRM genuinely has 11 leads. Submissions are being lost before they reach it |
| **31** | The leads exist and the Daily Tracker is hiding them. Completely different fix |

Query 3 is the one I most expect to explain it. It shows today **and yesterday**
side by side. Add the two together and compare against Meta's two-day total.

## Why a single day can never match

Your ad account is not on IST. We proved it from your own export: the file named
`20260830` contained rows timestamped **31 Aug IST, 00:16 to 17:19**.

So Meta's "today" and the CRM's "today" are different windows that only partly
overlap. Comparing them on one day is comparing two different sets of people. The
answer is not to compare single days at all — use 7-day ranges on both sides,
where the edges cancel out.

I said this before and it was not concrete enough. Query 3 makes it visible.

---

## Then deploy 085 — so this question never needs asking again

**What is still blind:** migration 083 records submissions that SUCCEED. A POST
that is *rejected* — bad token, missing name, a database error — leaves no trace
anywhere in Postgres. That is why I cannot tell you from here which side is losing
them, and why you have had to open Make.com by hand.

**After 085,** every POST to the ingest endpoint is logged before anything can go
wrong, with its outcome and, when it fails, the reason.

```sql
select public.ingest_health(1);
```

Returns `arrived / created / returning / rejected` plus a breakdown of rejection
reasons.

- `arrived` = 11 while Meta says 31 → the gap is **Meta → Make**. Nothing in the
  CRM can fix it, and you will know that in one query instead of an afternoon
- `arrived` = 31 with 20 rejected → the **reason column names the bug**

The most likely rejection reason is `missing_name` — Make's field mapping breaking
after a form rename, which has happened to you before. The full payload is stored,
so you can see exactly what arrived without opening Make.

## Install

1. Supabase SQL editor → `supabase/migrations/085_ingest_log.sql`. Idempotent
2. Upload `app/api/ingest/meta-lead/route.ts`
3. Netlify redeploys

Logging is fire-and-forget and fully guarded — if the table is missing or the
insert fails, lead creation carries on exactly as before. It can never be the
reason a lead is lost.

## Send me

The output of queries 1, 3 and 4. That is enough for me to tell you precisely
what is happening instead of narrowing it one theory at a time.
