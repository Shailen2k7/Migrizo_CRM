# Final pack — one engine, both doors, failures you can see

4 files + 1 migration. Run the SQL, upload, redeploy.

```
supabase/migrations/055_whatsapp_health_panel.sql   NEW — run in Supabase SQL Editor
app/api/whatsapp/automation/drain/route.ts          REPLACE
app/api/whatsapp/webhook/route.ts                   REPLACE
components/whatsapp/automation-tab.tsx              REPLACE
```

`tsc` clean · `next build` green · migration applied twice · all tests passing.

---

## 1. Tonight's failure, fixed at the root

Your test worked all the way to the last step, then the guide + booking link
never came. The reason (found in the jobs table): the assets job checked the
24-hour window against the conversation's CACHED timestamp and lost a
**36-second race** with the very reply that triggered it. It saw "window
closed" and gave up — permanently.

Two changes:

- **The window is now read from the newest inbound message row itself** — the
  thing that queued the job, which cannot be stale.
- **A closed-window result right after a reply retries twice** before failing.
  Only a genuinely day-old job fails permanently.

With this, both doors run the SAME engine end to end. The open-window path is
now, as it always should have been, the easier one: no template, no approval,
no delivery caps, no waiting.

## 2. Failures are now visible — with a Retry button

Both of tonight's problems (the scheduler, this race) failed silently with the
answer sitting in a database table. No more SQL debugging:

**Automation tab → "Failed steps" card** (red, top of the right rail): every
failed job from the last 7 days with the lead's name, the step, the
plain-English reason, and **↻ Retry now** — one click puts it back in the
queue with fresh attempts.

## 3. The "None" caption

Interakt serialises an absent caption as the literal string "None" (Python's
None). Your CV bubble showed it; the intent brain read it as text. Now
stripped at the webhook — an empty caption is empty.

---

## For the lead stuck right now (your UK number test)

After deploying, the failed assets job will appear in the **Failed steps**
card — press **Retry now** and the guide + video + booking link go out within
a minute (the window is still open until ~11 PM IST tomorrow).

Or from SQL, immediately:

```sql
update whatsapp_auto_jobs set status='queued', attempts=0, error=null, due_at=now()
 where status='failed' and kind='assets';
```

## The system, complete

Form leads and direct messages now run one identical journey: tagged at entry
(POST body or parsed first message) → hot-lane push → welcome/intro → reply →
guide + video + booking → booked stops everything → silence gets reminders
then the cold sequence → Q&A answers your saved questions → sensitive topics
always reach a human → and anything that fails shows up with a reason and a
retry button.
