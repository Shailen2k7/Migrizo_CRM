# Fix: the daily cap no longer blocks replies

## What was wrong
The cap counted EVERY outbound message. A day of campaign sends used up the
allowance, and then a human could not answer a lead who had just written in —
the CRM refused with "Daily cap reached". Backwards: replying to someone who
messaged you is the safest traffic on WhatsApp and should never be rationed.

## The rule now (same as Interakt and every good BSP)

| Message | Counts toward the daily cap? |
|---|---|
| Campaign step (hot / cold follow-up) | YES |
| Template to someone who has NOT written in (window shut) | YES |
| Any reply inside their open 24-hour window | **NO — always free** |
| Quick replies, follow-up answers, media in a live chat | **NO — always free** |

The decision is stamped on each message in the database the moment it is
recorded, so no code path can forget it. The campaign engine uses the same
definition, so a busy day of human chat can never starve the campaign of its
quota (and vice versa).

## Deploy — 2 steps

1. Supabase → SQL Editor → run `supabase/migrations/064_cap_only_for_outreach.sql`
   (safe to run twice). It also back-fills history, so today's counter drops to
   only the real outreach and your allowance is freed immediately.

2. Replace these 2 files, commit, push:
   - `app/api/whatsapp/send/route.ts`     ← stops refusing replies
   - `components/whatsapp/settings-tab.tsx` ← the cap is now labelled
     "Daily cap (new outreach only)" with the rule spelled out under it

## Test it in 30 seconds
Open the chat that just failed and send the same message again. It goes out —
even though the counter still reads 110 of 110. Then check Settings: "used
today" now shows outreach only, and the green note explains the rule.
