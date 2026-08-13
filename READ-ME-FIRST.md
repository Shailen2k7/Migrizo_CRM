# The Campaign Engine — choose who, choose what, press start

3 files + two deletions. Run the migration, upload, redeploy.

```
supabase/migrations/058_campaign_engine.sql   NEW — run in Supabase SQL Editor
app/(app)/whatsapp/page.tsx                   REPLACE
components/whatsapp/campaigns-tab.tsx         NEW
components/whatsapp/automation-tab.tsx        DELETE
components/whatsapp/sequences-tab.tsx         DELETE  (Campaigns replaces it)
```

`tsc` clean · `next build` green · migration applied twice · **8 engine tests
passing** on a real Postgres (exact preview counts, launch, top-up sweep,
quiet rule, 24h safety, max-people cap, retry, stats funnel).

---

## What changed

**Tabs: 6 → 5.** Inbox · **Campaigns** · Quick replies · Templates · Settings.
The Automation tab is gone — its one useful job (enrolling cold/hot leads)
now lives *inside* each campaign as the audience filter. Old
`?tab=automation` links land on Campaigns.

**First-touch automation is OFF.** New Meta leads belong to your other
number, outside this CRM. This number sends campaigns, and humans answer
replies. (One switch in the database turned it off — flipping
`whatsapp_automation.enabled` back on restores it any day.)

**The inbox sidebar is compact.** Half-width New button + a filter dropdown
on one row, search under it — the chip rows are gone.

**A `/uk` quick reply is seeded.** "Continue with our team on +44 XXXX…" —
edit the number once in the Quick replies tab, then it is two keystrokes for
every replier.

## The Campaigns screen

Four numbered sections, one page:

1. **Audience** — chips for Stage, Field, Can invest, Visa, Added-when, and
   Not-messaged-in. A live card shows **"N will receive this"** with the
   exclusion breakdown (opted out, meeting booked, already in). The locked
   row shows what is always off. The count comes from the SAME SQL function
   that later sends — it cannot lie.
2. **Messages** — your step list, unchanged mechanics: template + days apart,
   drag to reorder, live bubble preview. Your existing 7-step cold sequence
   survives untouched.
3. **Limits** — send to at most N people ever, at most N per day. Blank
   per-day uses the global cap.
4. **Live** — per-step funnel, every reply with what they actually said (and
   an Open chat button), failures with the real error and one-click retry.

**Press Start** and it enrols everyone eligible immediately. A sweep re-runs
your audience filter **every 10 minutes**, so a lead who becomes cold
tomorrow joins by himself. Pausing stops everything; deleting asks first.

## The rules the database enforces (not the browser)

- Opted out, invalid phone, sample rows — never.
- Upcoming meeting — never.
- Already touched by this campaign — never again (unique index; a duplicate
  send is physically impossible).
- Any WhatsApp activity in the last 24h — not this sweep; they are retried
  next sweep once quiet.
- A reply pauses that person's remaining steps instantly (056 trigger — still
  active even with first-touch off).
- All sends respect your sending hours and the global daily cap.

---

## Test it

1. **Supabase → SQL Editor → run 058.** Then check:
   `select jobname from cron.job where jobname like 'migrizo%';`
   → you should see `migrizo-whatsapp-campaign-sweep` (the old
   stage-enrol job is replaced) alongside the two drains.
2. Upload the 2 code files, **delete `automation-tab.tsx` and
   `sequences-tab.tsx`**, redeploy, Test connection once.
3. Open **Campaigns** → your "Cold Lead - Follow up" is there with its 7
   steps. Click it.
4. In **Audience**, tick Cold + the fields you want → watch the count card
   settle on a number. That number is the truth.
5. Set **Per day = 50** → press **Start campaign** → the toast tells you how
   many were enrolled. First sends go out inside 10:00–19:00 IST.
6. Add a brand-new cold lead → within 10 minutes it appears in the campaign
   without you touching anything.
7. Reply from an enrolled test phone → their remaining steps pause, they
   appear under **Live → Replies** with their message → open the chat, type
   `/uk`, Enter, Enter.
