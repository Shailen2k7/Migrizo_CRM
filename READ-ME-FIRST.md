# Lead reconciliation — Meta and the CRM now agree

Build and type-check both green.

---

## What your 27 exported leads actually showed

I analysed the three exports before writing any code. **Both of my earlier theories were wrong.**

| Check | Result |
|---|---|
| Submissions in the export | **27** |
| Unique phone numbers | **27** |
| Unique email addresses | **27** |
| Duplicates inside the export | **zero** |
| Forms used | **one** — `Uk / global talent Visa - 13 Jan-copy-copy` |

So these are 27 different people, all through the same form. Not a duplicate problem
within the day, and not a wrong-form problem.

**Two real causes remain, and both are now fixed.**

### 1. You were comparing two different days

Every row in that export is timestamped **31 Aug IST** (00:16 to 17:19) — even though
Meta named the file `20260830`. Meta reports in the **ad account's timezone**, not IST.

So "Meta's 30 Aug" and "Daily Tracker's 30 Aug" are different windows containing
different people. Those two numbers could never match, on any day, no matter what.

### 2. Returning submitters were invisible

If someone already in the CRM fills the form again, the endpoint merged their
answers into the existing lead and wrote **nothing** — no row, no timestamp, no
activity. There was no record in the database that the submission ever happened.
Make's execution log was the only evidence.

That is the defect, and it is mine.

---

## STEP 1 — Find out tonight which people are actually missing

`_check/check-missing-leads.sql` has all 27 phone numbers from your export built in.
Paste it into the **Supabase SQL editor** and run it. Read-only, changes nothing.

Every row comes back as one of three things:

| Status | Meaning |
|---|---|
| `MISSING FROM CRM` | A real person Meta captured who never became a lead. If any appear, send me the list |
| `present (new)` | Arrived today, already in Daily Tracker |
| `present (older - returning submitter)` | Already in your database, filled the form again. **These are the ones that were hidden** |

The second query prints a one-line summary: missing / found / total.

`_check/meta-leads-30-aug.csv` is the same 27 people as a clean spreadsheet —
name, phone, email, time, which ad, which form.

---

## STEP 2 — The database

Run `supabase/migrations/083_form_submissions.sql` in the Supabase SQL editor.
Idempotent, safe to run twice.

It adds:

- **`form_submissions`** — one row per submission, forever, new or returning.
  Unique on Meta's own submission id, so a webhook retry can never double-count.
- **`leads.last_form_submitted_at`** and **`leads.form_submission_count`**
- **`form_submission_stats()`** — the numbers Daily Tracker reads
- A backfill: every existing Meta lead gets one historical submission row, so past
  dates are not empty

---

## STEP 3 — The three code files

| File | Change |
|---|---|
| `app/api/ingest/meta-lead/route.ts` | Records **every** submission. Matches people on the **last 10 digits** of the phone instead of an exact string, with email as fallback. On a repeat: stamps the lead, writes an activity row, returns `returning: true` |
| `components/daily-tracker/daily-tracker-view.tsx` | New line above the stat cards: **"27 form submissions = 19 new + 8 returning"**. Click "returning" to list exactly who came back |
| `supabase/migrations/083_form_submissions.sql` | The above |

Upload, Netlify redeploys, done.

---

## What changes for you

**Before:** Daily Tracker said 19. Meta said 30. No way to explain the gap without
opening Make.com and reading execution logs one by one.

**After:** Daily Tracker says `27 form submissions = 19 new + 8 returning`, and the
8 are one click away. The line reconciles with Meta for the same window.

And every repeat submission now writes **"Re-submitted the ad form"** into that
lead's timeline. Someone your team wrote off three weeks ago coming back and filling
the form again is a strong buying signal — you'll see it now.

---

## Two things worth doing separately

### Set Meta's reporting timezone, or stop comparing days

Your ad account is not on IST, which is why the export named "30 Aug" contains 31 Aug
IST rows. Until that matches, compare **date ranges of 3+ days**, not single days —
the edges will always disagree.

The account timezone is in Ads Manager → Billing → Payment settings. It can only be
changed by creating a new ad account, so in practice the fix is to compare wider
windows and rely on the reconciliation line rather than eyeballing two dashboards.

### Optional: give Make 5 more fields, get perfect attribution

In your Make scenario, on the **HTTP** module, add these to the JSON body from the
"Get Lead Details" step. All optional — everything works without them.

```
"meta_lead_id":  {{lead id}}
"created_time":  {{created_time}}
"ad_name":       {{ad_name}}
"form_name":     {{form_name}}
"campaign_name": {{campaign_name}}
```

With `meta_lead_id` present, a Make re-run or webhook retry can never double-count a
submission, and every lead carries which ad and campaign produced it — so you can
finally see cost per lead **per ad** inside the CRM.

---

## Verify after deploying

- [ ] Daily Tracker shows the submissions line above the four stat cards
- [ ] Clicking **returning** lists the people who filled the form again
- [ ] Submissions = new + returning, exactly
- [ ] A new Meta lead still lands normally
- [ ] Open a returning lead → their timeline shows "Re-submitted the ad form"
