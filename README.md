# Roadmap Builder — complete (replaces the earlier roadmap-builder.zip)

You were right about the zeros. This fixes them, and fixes the deeper mistake
underneath them.

## The mistake

067 assumed **every route works like Tech Nation** — one mandatory criterion
plus optional ones. It doesn't. A research client would have opened the builder
and found an empty screen.

## What each route actually is

| Route | Shape | What you pick |
|---|---|---|
| Digital Technology | criteria | MC + 2 of 4 optional |
| Arts and Culture | criteria | Mandatory standard + supporting evidence |
| Innovator Founder | criteria | Innovation · Viability · Scalability — **all three required** |
| **Academia and Research** | **pathway** | **ONE of four qualifying routes** |

## Your research question, answered

Research does **not** run on OC/MC. It has four qualifying pathways, and the
applicant needs exactly one:

1. **Academic or research appointment** — an eligible senior role
2. **Individual fellowship** — from the approved list, current or within 5 years
3. **Endorsed funder** — named on an approved research grant
4. **Peer review** — no appointment, fellowship or grant

The crucial operational point: **for 1–3 there is nothing to build.** The person
either holds it or they does not. Their "roadmap" is document collection — offer
letter, HR statement of guarantee, award letter, institutional statement. Those
activities are seeded and marked Essential.

**Only pathway 4 (peer review) is an evidence-building exercise**, so that is the
one with publications, expert letters, research statement and talks.

The builder knows the difference. On a pathway route, section 2 says
*"Qualifying pathway — pick the ONE route this applicant qualifies under"*, each
option is tagged **Pick one**, and selecting one deselects the others. On a
criteria route it stays a multi-select. Same control, different rule.

## The other bug fixed

If a route had no criteria, section 3 offered nothing and you were stuck. Now a
route with no criteria set offers the **whole library**, with a note explaining
why. A consultant with a client in front of them can never hit a dead screen
because the library is unfinished.

## Deploy — 2 steps

1. Supabase → SQL Editor, in order:
   - `067_roadmap_library.sql` (skip if already run)
   - `068_roadmap_routes_complete.sql`
   Both safe to run twice, and neither overwrites wording you have edited.

2. Replace / add these files, commit, push:
   - `lib/roadmap/library.ts`
   - `components/roadmap/roadmap-builder.tsx`
   - `components/leads/lead-drawer.tsx` (2 lines vs original)

## Still yours to own
The criteria wording is a **starting point**. I have written the standard shape
of each route so nothing is empty on day one, and flagged the research grant
thresholds as needing verification before you advise on them. Open **Manage
library** and make every line Migrizo's own.

## Verified
Every route reports a non-zero criteria count and a mode. Both migrations run
twice with no duplication. `tsc` clean, `next build` green.
