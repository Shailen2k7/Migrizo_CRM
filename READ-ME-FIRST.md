# The second door — people who message you directly

3 files. Upload, run the one migration, redeploy.

```
supabase/migrations/052_whatsapp_inbound_leads.sql   NEW — run in Supabase SQL Editor
app/api/whatsapp/automation/drain/route.ts           REPLACE
components/whatsapp/automation-tab.tsx               REPLACE
```

`tsc` clean · `next build` green · migration applied twice on Postgres 16 ·
**29 tests passing** (11 database, 18 routing/logic). No new env variables.

---

## What this adds

Until now a journey could only start from the Meta lead **form**. Anyone who
tapped "Chat on WhatsApp" on an ad, used your website button, or just saved
your number and messaged you was left to the Q&A brain and your team.

Now they become a proper lead, automatically:

**They message you (you've never spoken)**
→ a lead is created — source **"WhatsApp Inbound"**, stage Cold, so they appear
  in Leads, Pipeline and every report
→ a journey starts, and the AI **reads their first message** before saying
  anything:

| Their first message | What happens |
|---|---|
| A question your Q&A covers | **Your answer goes first**, then the CV + LinkedIn request |
| "Hi" / general interest | The CV + LinkedIn request |
| Discount, complaint, "ready to pay", guarantee | **Nothing sent.** Flagged + pushed to you |
| They open by sending a file | **Nothing sent** — asking for a CV would be absurd. Flagged for a human |
| Spam / wrong number / a bot | **Nothing sent, nobody bothered.** Journey quietly ends |

→ they reply → because there are no ad tags, **a human decides eligibility**
  ("Needs your decision" on the Automation tab). One click sends the guide +
  booking link.
→ silence → the same two reminders, then the cold sequence.

## Why this path is MORE reliable than the ad-form path

Their message opens Meta's 24-hour window, so every message here is **normal
free text** — no template, no Meta approval, and **no MARKETING frequency
cap**. The "not delivered to maintain healthy ecosystem engagement" problem
cannot happen on this path at all.

## What it will never do

- **Message a suppressed number.** Someone who said STOP stays stopped, even
  if they message again. Tested.
- **Send an intro to a reply.** If *we* messaged first (a sequence, a campaign,
  a manual template), their reply is a reply — not a new enquiry. The code
  checks for an earlier outbound message before ever introducing itself. Tested.
- **Double-answer.** The intro brain owns the first message; the Q&A brain
  takes over from the second onward. Tested.
- **Greet someone by their phone number.** A lead we only know as a number is
  greeted "Hi there", never "Hi WhatsApp 919999…".
- **Promise eligibility.** No ad tag means no automatic verdict — a human decides.

## Where you control it

**Automation tab → "The second door"** (new card below the 5 steps):
a toggle, and the opening message you send to a new enquiry — edit it freely.

In the **live feed**, inbound leads carry a small **IN** badge, and the Totals
panel now splits *From the ad form* vs *Messaged us directly*.

## One bug this also fixed

Reminders used "does this lead have any inbound message?" to decide whether to
stay quiet. Every inbound lead has one by definition — so reminders would have
been silently cancelled for all of them, forever. It now compares whose message
is *newest*, which is correct for both doors.

## Test it in 2 minutes

1. Run the migration, deploy, Settings → **Test connection**.
2. From a phone that has **never messaged your number**, send "Hi, what is the price?"
3. Within a minute you should receive **your price answer, then the CV request**
   — and the lead appears in Leads (source: WhatsApp Inbound) and in the live
   feed with an **IN** badge.
4. Now try "can you give me a discount?" from another new number → **no reply**,
   chat flagged "Needs reply", push to your phone.

Dry-run works here too — journeys advance, nothing leaves the CRM.
