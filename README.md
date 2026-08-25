# Leads & Meetings dashboards — FULL RELEASE

This is the complete, current state of everything built recently, in one
upload. It **includes** the meeting-notes-on-lead work and the invoice
UK-bank/PDF/name fixes, so there is no way to end up with half of a change
deployed. If you already uploaded those earlier zips, uploading these files
again is safe — they are the same latest versions.

---

## What's new

### Leads section
- **Dashboard on top** of the existing page: 6 cards (Total leads · Response ·
  Profile submission · Eligibility · HOT · Non-eligible), each with a ▲▼
  against the comparison period.
- **Period + Compare with** pickers — This week / Last week / This month /
  Last 30 days / any month of the year. Aug vs Jan works. A week is only ever
  compared with a week.
- **Lead flow panel** — the year-by-month strip and the funnel together in one
  panel: click any month bar to compare against it; the funnel shows each
  stage, per-step conversion, and calls out the biggest leak.
- **Click any card → the leads table below filters to exactly those leads**,
  with a banner showing what filtered it and a one-click way out. Same table,
  same sort/search/export — not a second list.
- **Nothing else on the page changed.** Same table, same columns, same chips.

### Lead drawer
- Two new one-click fields directly under Special offer:
  **Profile received** (CV / LinkedIn / Both) and **Eligibility**
  (Eligible / Not eligible / Not reviewed), stamped with who and when.
  Derived values (from the backfill) say so, and one click confirms them.

### Meetings section
- **The old page silently hid everything past ~40 rows — fixed.** Full
  history with search (name/email/phone), status filter chips, and proper
  pagination (25/page). Nothing is truncated any more.
- **Dashboard on top**: Scheduled · Call booking · Show rate · No-show ·
  Cancellation · Recovery, with the same period/compare system.
- **Call flow panel** — bookings by month + this period's outcomes.
- **Needs attention panel** — dropped calls (no-show/cancelled, last 30 days)
  not yet rebooked, and eligible leads with no call in the diary. An action
  list, not a leaderboard — built for a one-caller team.
- Calendar views (Day/Week/Month) untouched.

### Honest numbers (built in, not optional)
- Leads count by the day they were **created**; call outcomes count by the day
  the call was **due**; bookings count by the day they were **booked**. Each
  card's small print says which.
- A zero denominator shows **—**, never a fake 0%.
- Leads left "Not reviewed" stay out of every eligibility percentage — an
  untouched backlog cannot fake a good number.
- Until the team starts recording the two new fields, the dependent cards say
  "field not in use yet" instead of pretending.

---

## Deploy — 2 steps

### 1. Supabase SQL Editor — in this order
- `072_meeting_notes_on_lead.sql`   (skip if already run)
- `073_link_orphan_meetings.sql`    (skip if already run)
- `074_lead_intel.sql`              ← the new one

074 adds the three facts the dashboards need: `first_response_at` (backfilled
from every inbound WhatsApp and email, kept current by DB triggers),
`profile_received`, and `eligibility`. It also derives eligibility for your
history — anyone who reached Hot / MR coming soon / Invoice sent / Won is
marked eligible ("derived"), Junk is marked not eligible. A human's click
always outranks the derivation and survives reruns (tested).

The verification block at the end prints your real counts — responded,
eligible, not reviewed — the moment it runs.

### 2. Git — upload all files at the same paths
```
lib/dashboard.ts                          NEW — period arithmetic (unit-tested)
lib/types.ts
lib/email/branded.ts                      invoice: Migrizo Ventures + UK bank
lib/email/print.ts                        invoice PDF print rules
components/shared/dash-ui.tsx             NEW — cards / month strip / funnel
components/shared/app-provider.tsx        setLeadQualification + notes join
components/leads/leads-dashboard.tsx      NEW
components/leads/leads-table.tsx          dashboard drill-in banner
components/leads/lead-drawer.tsx          the two new fields + meeting-note chip
components/meetings/meetings-dashboard.tsx NEW
app/(app)/leads/page.tsx                  mounts the dashboard
app/(app)/meetings/page.tsx               dashboard + fixed history list
components/payments/payment-row.tsx       invoice PDF download button
app/api/invoice/pdf/route.ts              invoice PDF endpoint
app/api/email/send/route.ts               shared invoice numbering
```

## Verify after deploy
1. Leads → cards appear; Response % is real immediately (backfilled).
   Profile/Eligibility cards show real numbers from the derived backfill.
2. Click the Response card → table filters to "Never replied" with a banner.
3. Open a lead → set Eligibility → card numbers move on next visit.
4. Meetings → History shows ALL past meetings; search "August" client by name;
   flip status chips; page through.
5. Meetings dashboard → "Needs attention" lists any un-rebooked no-shows.

## Tested before shipping
- `tsc --noEmit` clean · `next build` green
- Migration 074 applied twice on a live Postgres: idempotent; triggers stamp
  inbound WhatsApp/email and ignore outbound; manual eligibility survives reruns
- 28 unit tests on the period library: Monday weeks, month boundaries
  (1 Aug in, 1 Sep out), same-grain comparison rule, zero-denominator dashes,
  delta jitter threshold, bad-up colouring
