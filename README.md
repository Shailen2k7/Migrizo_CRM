# Special offer (£500 / FREE) on leads

## The one design decision, and why

You asked for it in the status dropdown. I built it as a **separate field that
sits next to Stage** instead, because making it a stage would have quietly
broken three things:

- A lead on a £500 offer is still **Hot** or **Cold**. A stage holds one value;
  you need both facts.
- The WhatsApp engine enrols people **by stage**. Moving someone to a "special
  offer" stage would have silently dropped them out of their follow-up campaign
  — the same class of invisible failure that cost us a day on the send engine.
- Your funnel counts (2280 / 89 / 1325 …) would have stopped adding up.

So: stage keeps working exactly as before, and a lead can be "Hot + FREE case",
which is the combination actually worth looking at.

## What you get

**1. A "Special offer" chip** in the Leads toolbar, next to Spotlight, with a
live count. Click it to see only those leads. Violet, so it reads as separate
from the stage colours.

**2. A badge on the row** — `£500` or `FREE` — right beside the name, next to
the visa and industry tags. You can spot them while scanning.

**3. In the lead drawer**, directly under Stage:
   - **Special offer**: No offer / Discounted quote / Free case
   - **Offer amount** (appears only for a discount): currency + amount,
     pre-filled at £500
   - **Offer given**: the date and who granted it

The offer saves the moment you pick it — it does not wait for the Save button,
because granting a discount is a commercial decision worth stamping with a name
and a time immediately.

## Why "who and when" is recorded

Six months from now, "why is this one free?" needs an answer. More importantly,
this is an **experiment** — you are discounting to win more approved cases. With
`offer_at` and `offer_by` stored, we can later measure whether discounted leads
actually convert better than full-price ones. Without it, the experiment is
unmeasurable.

## Deploy — 2 steps

1. Supabase → SQL Editor → run `supabase/migrations/066_special_offer.sql`
   (safe to run twice; adds nullable columns only, so existing leads are
   untouched). It prints a summary of who is on an offer at the end.

2. Replace these 4 files, commit, push:
   - `lib/types.ts`
   - `components/shared/app-provider.tsx`
   - `components/leads/leads-table.tsx`
   - `components/leads/lead-drawer.tsx`

## How it was verified
- **Database test**: granting an offer to a Hot lead leaves the stage as `hot`
  (so the WhatsApp campaign keeps them), the filter finds exactly the offered
  leads, invalid values (`half_price`, `EUR`) are rejected by the database
  itself rather than only the UI, and withdrawing clears the record cleanly.
- **Formatting test**: 7 cases — FREE, £500, £1,500 (separator), ₹25,000,
  £499.50 (decimals), and a discount with no amount recorded (shows "OFFER"
  rather than a bare "£").
- Migration applied twice, `tsc --noEmit` clean, `next build` green.

## Worth doing next (not included — say the word)
Add the offer to the CSV exports, so you can measure conversion of discounted
vs full-price leads in a spreadsheet.
