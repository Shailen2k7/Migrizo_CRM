# Roadmap Builder v3 — corrected criteria, full IFV, redesigned

Replaces every earlier roadmap zip. One bundle, end to end.

## 1 · Your criteria corrections are in (migration 069)

| Code | Now means |
|---|---|
| **MC** | **Third-party recognition** — media publications, awards, high salary / increments, promotions, independent industry recognition |
| **OC1** | **Innovation** — track record of innovation in digital technology |
| **OC2** | **Work beyond the occupation** — open source, mentoring, judging, talks, community |
| **OC3** | **Commercial contribution** — revenue, growth, GTM impact with numbers |
| **OC4** | **Academic contribution** — papers, articles, publications |

The activities were re-mapped to match (the old mis-mapped seeds are retired,
anything your team added by hand is untouched). MC now carries media features,
award submissions, salary/promotion evidence and recognition letters — your
exact list.

## 2 · Innovator Founder — end to end

Switching the route to Innovator Founder lights up its whole world:
Innovation / Viability / Scalability (all three required), plus a full library —
market research, MVP evidence, business plan, funding and runway, founder CV,
UK hiring plan, expansion plan, endorsing-body selection, pitch deck, interview
prep, letters of support. **And no Grade field** — IFV has no Talent/Promise,
so the builder hides it and the document says "Innovator Founder" instead.

## 3 · The redesign

- **Route switcher leads the screen** — four colour-coded cards (GTV indigo,
  Research sky, Arts pink, IFV teal). Pick one and the entire module recolours
  and reloads that visa's criteria and activities.
- Numbered grey circles are gone — sections are now "Step 1 · You decide",
  "Step 2 · Build the plan", "Step 3 · Pace it" with the route's accent.
- Criteria and activity cards select with the route colour, not generic indigo.
- The sticky bar shows a live pulse: criteria · activities (essentials) · weeks.
- **The drawer tab strip is fixed** — labels never wrap ("Visa route" no longer
  breaks onto two lines), counts are proper little pills, narrow drawers scroll
  the strip sideways instead of stacking it.

## Deploy

1. Supabase → SQL Editor, in order (each safe to run twice):
   `067_roadmap_library.sql` → `068_roadmap_routes_complete.sql` → `069_gtv_ifv_corrected.sql`
   (Run all three even if 067/068 are already in — 069 is the corrections.)

2. Replace these 3 files, commit, push:
   - `lib/roadmap/library.ts`
   - `components/roadmap/roadmap-builder.tsx`
   - `components/leads/lead-drawer.tsx`

## Fishy things found and fixed along the way
- Grade was being sent for IFV clients ("Exceptional Promise" on a founder
  document) — now impossible.
- Switching routes used to keep activities from the previous visa's criteria in
  the plan — now switching clears them, so a founder plan can never contain GTV
  items.
- The tab strip wrapping (your screenshot) — fixed as above.

## Verified
069 applied twice with zero errors and no duplicates. Criteria read back with
your corrected titles: MC=Third-party recognition, OC1=Innovation, OC2=Work
beyond the occupation, OC3=Commercial, OC4=Academic. IFV shows 3 required
criteria with 13 active activities + 4 general. `tsc` clean, `next build` green.
