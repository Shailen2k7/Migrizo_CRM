# "tech_" — Meta sends slugs, not labels

2 files. Run the migration, upload, redeploy.

```
supabase/migrations/060_fix_option_slugs.sql   NEW — run in Supabase SQL Editor
lib/intake.ts                                  REPLACE
```

`tsc` clean · `next build` green · migration applied twice ·
**18 mapper tests passing** · retroactive repair proven on a real Postgres.

⚠️ Run **059 first** if you haven't — this builds on it.

---

## What your screenshot actually showed me

`Field of expertise: tech_` — with a trailing underscore. That is not the
label a person saw, it is Meta's **option slug**. When a form option has no
separate label, Meta sends the slug: `tech_`, `art_`, `arts_culture`,
`not_sure`.

Underscore is a **word character** in both JS and Postgres regex. So:

```
\btech\b   does NOT match  "tech_"    → Industry stayed Not set
\barts?\b  does NOT match  "art_"     → Industry stayed Not set
```

But `research_` and `engineering_` mapped fine — because those rules use a
bare substring with no closing boundary. **That is the entire reason it
"worked for some leads and not others."** It was never about the lead; it was
about whether the matching rule happened to end in a word boundary.

## The second bug — worse, and silent

`not_sure` skipped the MAYBE rule (which reads `not sure`, with a space) and
was then caught by `sure` inside the YES rule. **Undecided leads were being
tagged "willing to invest"** — and your hot lane reads exactly that field.
Now `not_sure` → Maybe, and migration 060 corrects the ones already stored
wrong.

## The fix

A slug is read as the words it stands for: underscores, hyphens and plus
signs become spaces before matching. Your **raw answer is untouched** — the
drawer still shows exactly what Meta sent, which is how you spotted this.

Then `intake_rederive()` re-reads every stored answer with the corrected
rules, so existing leads get fixed retroactively and the campaign audience
sweep picks them up within 10 minutes.

**Verified end to end:** `tech_ → Tech`, `art_ → Art`, `arts_culture → Art`,
`not_sure → Maybe`, `no_i_cannot_afford → No`, and `Software Engineer` still
correctly reads as Tech, not Engineering.

## Test it (60 seconds)

1. Run 060 → the query at the bottom prints the slug table; `tech_` shows
   `tech`, `not_sure` shows `maybe`.
2. Upload `lib/intake.ts`, redeploy.
3. Open your Shailen Kumar Pathak lead → **Industry now reads Tech in the
   dropdown**, selected automatically. No more manual picking.
4. `/intake-test` → change the sample's expertise to `["tech_"]` → Run →
   green, Industry = Tech, and the trace shows which rule fired.
