# Industry (Tech / Research / …) in the lead exports

## What you get

The CSV now has an **Industry** column showing `Tech`, `Research`, `Art`,
`Engineering`, `Education`, `Business`, `Healthcare`, `Finance`, `Other` —
placed right after "Current stage", next to the other "what kind of lead is
this" columns, so it sorts and pivots naturally in Excel.

A **Tags** column comes with it, for the free-form labels like `meta-lead`
(comma-separated when a lead has several).

## Two extra things worth knowing

**1. It rescues leads whose tag looked blank.** Facebook sends option slugs
like `tech_` and `art_`. Those match nothing in our list, so they would have
exported as an empty cell even though the lead is clearly tagged. The export
now normalises them — `tech_` exports as `Tech`. If any of your leads were
saved with the raw slug, they appear correctly from now on.

**2. It never silently drops a value.** An industry we have no entry for is
tidied and shown (`quantum_computing` → `Quantum computing`) rather than
vanishing. An export that quietly loses data is worse than one showing
something unexpected. A lead with genuinely no industry gives an empty cell, so
Excel's filter treats it as "(Blanks)".

## Also fixed while I was there

- The **Leads page** export had the same missing column — fixed identically, so
  both files match.
- The Leads page export was missing its UTF-8 marker, so Excel mangled accented
  names on opening. Added. (Daily tracker already had it.)

## Files (3) — no database change, nothing to run in Supabase

| File | What changed |
|---|---|
| `lib/types.ts` | new `industryLabel()` helper — one source of truth for both exports |
| `components/daily-tracker/daily-tracker-view.tsx` | Industry + Tags columns |
| `app/(app)/leads/page.tsx` | Industry + Tags columns, UTF-8 fix |

## How it was verified
- 14 unit cases on the label helper: null, empty, whitespace, every normal
  value, the `tech_` / `art_` slugs, and unknown values — all pass.
- The real CSV builder was run over sample leads and asserted on: header
  present, `tech_` → `Tech`, names containing commas correctly quoted,
  multi-tag cells quoted, blank industry giving an empty cell (not the word
  "null"), and every row having exactly as many columns as the header.
- `tsc --noEmit` clean, `next build` green.

## Deploy
Replace the 3 files, commit, push. Then Daily tracker → Export CSV and open it:
Industry is column E.
