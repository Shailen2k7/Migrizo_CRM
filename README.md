# Campaign rebuild — full reset + one new engine

Everything old is torn down. One engine, two campaigns (Hot + Cold), every
existing hot/cold lead auto-enrolled the moment you run the migration.

## 1 · Delete these from your repo (old system, now dead)

- `components/whatsapp/campaigns-tab.tsx`
- the whole folder `app/api/whatsapp/automation/`
- the whole folder `app/api/whatsapp/sequences/`

## 2 · Add / replace these files

| File | What it is |
|---|---|
| `supabase/migrations/062_campaign_reset.sql` | Deletes ALL old campaign machinery, builds the new one, re-creates your 2 campaigns from the approved templates (7 cold + 6 hot), enrols every cold/hot lead immediately, schedules the crons |
| `app/api/whatsapp/campaigns/run/route.ts` | The one engine. Cron, the "Run engine now" button and the test button all use this same code |
| `components/whatsapp/campaign-center.tsx` | The new Campaigns screen |
| `app/(app)/whatsapp/page.tsx` | Wired to the new screen; lead-panel Pause/Resume/Stop now act on the new tables |

## 3 · Run the migration

Supabase → SQL Editor → paste the whole of `062_campaign_reset.sql` → Run.
It is safe to run twice. The moment it finishes, every cold and hot lead in
the database is enrolled and message 1 is due — sending starts on the next
engine tick inside your sending hours (10:00–19:00).

## 4 · Deploy

Commit + push. Wait for Netlify to go green.

## 5 · The 60-second proof

1. Open **WhatsApp → Campaigns**.
2. The dark strip at the top is the engine's pulse. If anything is wrong
   (paused, dry-run, cron missing, website answering errors) it says so in
   plain English right there.
3. Open a campaign → **Messages & test** → type your number → **Send test**.
   That message goes through the exact code cron uses — if it lands on your
   phone, the whole pipe works.
4. Press **Run engine now**. Watch "Sent today" move.

## How it runs itself

- Every 10 min: new cold/hot leads join their campaign; leads that left the
  stage stop. No lead untouched, no lead chased after moving on.
- Every 5 min: the engine sends whatever is due (max 50/day, 10:00–19:00).
- A reply pauses that person. An opt-out stops them forever. A booked meeting
  stops them. All automatic, enforced in the database.

## Message pacing (from your approved templates)

Message 1 today, then +3, +4, +5, +7, +8, +10 days → day 0, 3, 7, 12, 19, 27, 37.
Change any gap or template on the screen itself — no code involved.
