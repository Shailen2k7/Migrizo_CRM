# Manual mode · Quick replies with "/" · No cold or hot lead untouched

7 files + one deletion. Run the migration, upload, redeploy.

```
supabase/migrations/056_whatsapp_manual_mode.sql   NEW — run in Supabase SQL Editor
app/api/whatsapp/automation/drain/route.ts         REPLACE
app/(app)/whatsapp/page.tsx                        REPLACE
components/whatsapp/automation-tab.tsx             REPLACE
components/whatsapp/replies-tab.tsx                NEW
components/whatsapp/quick-reply-palette.tsx        NEW
lib/whatsapp/types.ts                              REPLACE
components/whatsapp/qa-tab.tsx                     DELETE (replaced by replies-tab)
```

`tsc` clean · `next build` green · migration applied twice · **8 behavioural
tests passing** on a real Postgres.

---

## 1. Why did Ajay get the links after saying "Sure will send it today"?

Because the old rule was *"an eligible lead replied → send the guide + booking
link"*. It never read WHAT they said — any reply pulled the trigger. That whole
step is now deleted. Verified by test: a lead replying "Sure will send it
today" now gets **nothing automated** — the chat is flagged and it's yours.

## 2. What is automatic now (and nothing else)

**Live / incoming leads — first touch only:**
- Ad-form lead → the approved welcome template (CV + LinkedIn ask). That's it.
- Direct message / click-to-WhatsApp → the free-text intro (CV + LinkedIn ask).
  Ad answers are still parsed into name, field and budget; the 🔥 hot-lane push
  still fires.
- The moment they reply: chat flagged "Needs reply", journey shows **With your
  team**, and NOTHING further is queued. No auto Q&A, no auto links, no
  reminders. Humans own every live conversation.

**Cold & hot leads — approved template follow-ups, no lead untouched:**
- Pick a sequence for **Hot** and one for **Cold** on the Automation tab
  (build the steps in the Sequences tab from your approved templates).
- Every lead sitting in that stage is enrolled automatically — the existing
  backlog the moment you save, new entrants within 10 minutes, forever.
- Politeness rules, all enforced in the database:
  only **quiet** leads are enrolled (no chat activity in 24h) · a reply
  **pauses** their follow-ups instantly · leaving the stage **stops** them ·
  a booked meeting stops everything · STOP suppresses forever · each sequence
  reaches a number **once, ever** — no repeat blasts.
- The tab shows the truth per lane: total in stage, getting follow-ups,
  paused, finished — and an **untouched** counter that turns into a green
  "Every lead covered" tick when it hits zero.

## 3. Quick replies — "/" and it's sent

- In any open chat, type **/** — a command palette rises above the box.
  Keep typing to filter (`/gu` → Guide + video), **↑↓** to choose, **Enter**
  to insert, **Enter** again to send. Two keystrokes for your daily answers.
- A quick reply can carry a **file** (brochure PDF, checklist) — it's staged
  as a chip on the composer and goes out with the message. Links live in the
  body as plain text; WhatsApp makes them tappable.
- Tokens fill themselves at insert time: `{{name}}` `{{pdf}}` `{{video}}`
  `{{booking}}` — so what you see in the box is exactly what they receive.
- The **Q&A tab is now the Quick replies tab**. Every answer you saved there
  was imported automatically, plus two new ones: `/guide` (guide + video, in
  a human voice, no icons) and `/book` (booking link).

## 4. The messages sound human now

- The old auto-sent "Great news 🎉 📄 🎥" copy is retired; the `/guide` quick
  reply carries the same content with no icons, written like a person.
- ⚠️ The welcome template's `1️⃣ 2️⃣` icons live in the **Meta-approved body** —
  no CRM edit can change what the phone shows. Submit a new template in
  Interakt (suggested body below), and once approved, add it in the Templates
  tab and pick it in Automation → Step 1.

**Suggested `fresh_lead_02` (UTILITY, variable {{1}} = first name):**

```
Hi {{1}}, thanks for your enquiry about the UK Global Talent Visa with Migrizo.

To review your profile properly, our team needs two quick things from you:

Your updated CV — you can attach it right here
Your LinkedIn profile link

Send these over and we will personally go through your profile and come back to you shortly.
```

## 5. The dead strip at the bottom is gone

The page was subtracting 56px for a header that only exists on mobile — that
phantom allowance was exactly the blank band under the composer. The inbox now
runs edge to edge on desktop.

---

## Upload, then test

1. **Supabase → SQL Editor → run 056.** Safe to run twice.
2. Upload the files (and delete `components/whatsapp/qa-tab.tsx`), redeploy,
   then Settings → Test connection once.
3. **Automation tab** — green scheduler bar should say first touch every
   minute, follow-up sends + enrol sweep every 10 minutes.
4. **Follow-ups**: pick your Hot and Cold sequences, Save. The save sweeps
   immediately — the toast tells you how many leads were enrolled, and the
   untouched counter should drop to a green tick. Sends go out inside your
   send window (10:00–19:00 IST) under the daily cap.
5. **First touch**: submit a test ad-form lead → welcome template arrives →
   reply from the phone → NOTHING else arrives, chat shows "Needs reply",
   feed shows *With your team*.
6. **Quick replies**: open that chat, type `/gu`, Enter, Enter → the guide
   message lands with your links filled in. Try attaching the brochure PDF to
   a reply in the Quick replies tab and send it the same way.
7. **Pause-on-reply**: from a phone that's in a follow-up sequence, send any
   message → its enrolment flips to *paused* (visible in the Sequences tab).
