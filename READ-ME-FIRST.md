# WhatsApp Lead Automation — the complete system, one go

6 files. Upload to the same paths, run the one migration, redeploy. Done.

```
supabase/migrations/051_whatsapp_automation.sql       NEW — run in Supabase SQL Editor
app/api/whatsapp/automation/drain/route.ts            NEW
components/whatsapp/automation-tab.tsx                NEW
components/whatsapp/qa-tab.tsx                        NEW
components/whatsapp/sequences-tab.tsx                 REPLACE
app/(app)/whatsapp/page.tsx                           REPLACE
```

`tsc` clean · `next build` green · migration applied twice on Postgres 16 ·
**30 automated tests passing** (14 database, 16 routing/logic). No new env
variables — it uses what's already in Netlify.

---

## The flow you approved, exactly as built

**① Lead arrives from the Meta ad** — already tagged with their field and
whether they'll pay (your new Make.com intake). No CV scanning anywhere.

**② Sorted at the door.** Field is tech / research / engineering / arts →
eligible. Eligible AND willing to pay → 🔥 **priority: pushed to your phone
the moment the welcome goes out**, so a human can jump in early. Any other
field → still welcomed, but replies are handed to a human, never auto-promised.

**③ Welcome = `fresh_lead_01`** (changeable via a dropdown on the Automation
tab). Goes out within a minute of the lead arriving.

**④ They reply** → eligible leads automatically get the **guide + video
message, then the booking-link message**. Their reply opened the 24-hour
window, so these always deliver.

**⑤ No reply** → `fresh_lead_01` is re-sent at +24h and +48h (both timings
editable). Still silent a day later → eligible fields are enrolled into the
**cold sequence you pick from a dropdown**; off-field leads simply stop.

**⑥ Meeting booked → everything stops.** The journey, queued messages, and
any running sequences for that number.

**∞ The Q&A brain** (its own new tab) — on every incoming message:
1. Discounts/negotiation, complaints, "ready to pay", guarantees →
   **never answered by the robot.** Chat flagged "Needs reply" + push.
   This is decided by plain code before any AI runs.
2. Matches a Q&A you saved → sends **your answer, word-for-word**. The AI
   only picks which saved answer fits — it cannot compose.
3. Casual chatter ("ok", "thanks", a file) → silence.
4. A real question nothing covers → flagged + push. Silence beats guessing.

Four Q&As are pre-seeded, including the **price answer built from your GTV
brochure** (£3,000 fixed fee · ~£4,000 government costs · ~£7,500/3yr ·
~£9,500/5yr → free assessment call). The standard price question is
auto-answered; the moment someone says "discount" or starts negotiating,
rule 1 takes over and a human gets it.

---

## Setup — do these once, in order

1. **Supabase → SQL Editor** → run `051_whatsapp_automation.sql` (safe twice).
2. Upload the 5 code files → deploy → **Settings → Test connection**
   (resets on every deploy — always re-test after deploying).
3. **Templates tab** → open `fresh_lead_01` and make sure the body matches
   your Interakt copy EXACTLY (the migration seeds a sensible body marked
   approved, but the variable count must match Interakt's or sends fail).
4. **Automation tab** → paste the PDF link, video link, booking link →
   pick your cold sequence in step 4 → flip the master switch ON.
5. **Q&A tab** → read the 4 seeded answers, edit to your voice, add more.
6. Test with **dry-run ON** (Settings): submit a test lead through Make,
   watch it move through the Automation tab. Nothing leaves the CRM until
   you turn dry-run off.

## Where things surface

- 🔥 Hot lead arrives → push: "Hot lead — willing to pay".
- Wrong-field lead replies → push + "Needs your decision" list on the
  Automation tab (one click: Eligible → assets go out / Not eligible → Junk).
- Unknown question → push + "Needs reply" flag in the inbox.
- Every automated send is in the chat thread and the lead's activity log.

## Also in this bundle

- **Compact design pass** on the WhatsApp module — Make-style density:
  smaller chrome, tighter rows and paddings, same font, same Migrizo green.
  The new Automation and Q&A tabs are born compact.
- **Sequences tab** now opens with a one-line cheat-sheet of how it works.
- The **sequences cron fix** from the audit is in the migration (sequences
  used to have NO scheduler at all — now every 10 minutes).
- Everything from the earlier packs (send fixes, clear/delete chat, editable
  templates) is already in your repo and untouched.

## Answers the robot will never give

Discount or negotiation requests · complaints · payment handling ·
guarantee/success-rate questions. These always reach a human, by design —
a premium brand's hardest questions deserve a person.
