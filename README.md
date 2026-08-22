# Roadmap Builder v5 — IFV built properly, zero GTV bleed

Replaces every earlier roadmap zip. 5 SQL + 3 files.

## What was actually broken

Not wording — structure. I seeded "general" activities with no visa attached,
and "general" meant **shown for every route**. So GTV admin work leaked into
founder plans: Evidence audit, CV and personal statement, Final evidence
consolidation, and **Recommendation letters** — which an IFV applicant needs
none of.

A general activity now belongs to a **visa**. GTV generals appear only on GTV
routes, IFV generals only on IFV. Criterion-linked activities were already safe.
And the Manage library dialog now stamps the visa when you add a general
activity, so the same leak cannot come back through the UI.

## IFV, from your list

**Four tests, not three.** Innovative + Viable + Scalable, plus the one that was
missing entirely: proof the applicant genuinely **is the founder / key person
and will run the business day to day** — judged separately from the idea, so it
is now its own criterion.

| | Activities |
|---|---|
| **INN · Innovative** | Business idea document · Innovation / USP evidence · Market research · Competitor analysis · IP, patents or proprietary tech |
| **VIA · Viable** | Detailed business plan · Financial projections · Funding & source of funds · Founder skills & experience · Costing and pricing model |
| **SCA · Scalable** | Go-to-market plan · UK job creation plan · Growth & expansion plan · Traction evidence (website, users, customers, revenue, pilots) · Partnerships & contracts |
| **ROLE · Founder role & day-to-day** | Proof of founder role (incorporation, shareholding, directorship) · Day-to-day involvement plan · Team & org structure |
| **Admin** | Passport & personal details · Updated CV / founder profile · Endorsing body selection · Pitch deck · Endorsement interview prep · Final application pack |

24 IFV activities. **No recommendation letters. No GTV work anywhere.**

The earlier IFV guesses (Business plan — innovation section, Financial model,
Founder capability evidence, etc.) are retired rather than deleted, so any
roadmap already sent still renders.

## Deploy

1. Supabase → SQL Editor, in order (all safe to run twice):
   `067` → `068` → `069` → `070` → **`071_ifv_proper.sql`** (new)

2. Replace these 3 files, commit, push:
   - `lib/roadmap/library.ts`
   - `components/roadmap/roadmap-builder.tsx`
   - `components/leads/lead-drawer.tsx`

## Verified
- **Leak check on the database**: querying everything an IFV plan can see
  returns zero rows matching recommendation letters, evidence audit, personal
  statement or evidence consolidation.
- **12 logic cases**: IFV never offers any of the four GTV admin items; IFV does
  offer passport, founder CV and final application pack; GTV keeps its
  recommendation letters and never sees IFV admin; criterion-linked activities
  survive on both; an unset visa still sees everything so nobody hits a dead
  screen.
- 071 applied twice, zero errors, no duplicates. `tsc` clean, `next build` green.
