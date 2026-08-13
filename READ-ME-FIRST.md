# Why some leads had no Industry tag — found, fixed, repairable on screen

5 files. Run the migration, upload, redeploy.

```
supabase/migrations/059_fix_expertise_mapping.sql   NEW — run in Supabase SQL Editor
lib/intake.ts                                       REPLACE
app/api/ingest/meta-lead/route.ts                   REPLACE
app/api/ingest/meta-lead/test/route.ts              NEW
app/(app)/intake-test/page.tsx                      NEW
```

`tsc` clean · `next build` green · migration applied twice · **11 mapper +
detection tests passing** · retroactive backfill proven on a real Postgres.

---

## The bug, precisely

Your ad form's own option is the bare word **"Engineering"** — and the mapper
only knew sub-disciplines ("mechanical", "civil engineer", "electrical"…).
Tech, Research and Arts mapped fine; **every lead who picked Engineering fell
through all nine rules** and arrived with Industry "Not set". That is exactly
your "works for some leads, not others". Fixed in both the TypeScript mapper
and its SQL mirror ("Software Engineer" still counts as Tech, deliberately).

## Two more layers so this class of bug is dead

**1. Answer detection.** The route no longer trusts one key name. It finds the
two qualifying answers under the canonical key, OR any key whose name looks
like the question, OR inside Meta's raw `field_data` array. So a second ad
form whose Make mapping was never updated still lands fully tagged. The
response now says where each answer was found — visible in Make's history.

**2. Retroactive repair.** Migration 059 re-reads every lead's SAVED raw
answers with the new rules — your untagged Engineering leads get their tag
back the moment you run it, and the campaign sweep picks them up within 10
minutes. (This is why answers are stored twice: raw + derived.)

## Your test screen — /intake-test

Open **crm.migrizo.com/intake-test** (logged in). Paste the exact JSON Make
sends → **Run test** → you see: where each answer was found, what they
answered, which rule read it, what the lead would become — create or enrich —
and a plain-English problem list when something would not map. **Nothing is
ever saved from this screen.**

Below the bench: the last Meta leads as they actually landed, with raw answer
next to derived tag — a mapping gap is a red chip here, not a surprise in a
report. The **"Fix untagged leads"** button re-runs the mapper over everyone.

## Test it (2 minutes)

1. Run 059 → the query at the bottom prints `Engineering -> engineering`.
2. Upload the 4 code files, redeploy.
3. Open `/intake-test` → the sample payload already says Engineering → Run →
   green "would arrive fully tagged", Industry = Engineering.
4. Same screen → your Shailen Kumar Pathak test lead now shows an Industry
   chip instead of "Not set" (the migration backfilled it — if not, press
   "Fix untagged leads").
5. Change the sample's expertise to some nonsense ("Astrology") → Run → amber
   problem: "matched no rule — send me this wording".
