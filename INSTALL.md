# Ad-form intake — 5 files

## What changed

Make was already sending `expertise` and `investment_readiness`. The route parsed
the JSON and dropped both, because its body type listed six keys and neither was
one of them, and because the `leads` table had nowhere to put them.

Every answer is now stored twice, on purpose.

| | Column | Values | Who reads it |
|---|---|---|---|
| Derived | `leads.industry` | `tech` `research` `art` `engineering` `education` `business` `healthcare` `finance` `other` | queue filters, sequence audiences, reports, anything built later |
| Derived | `leads.investment_readiness` | `yes` `maybe` `no` `null` | same |
| Raw | `leads.intake` (jsonb) | the answer exactly as submitted | the drawer, and any re-derivation |

`industry` already existed with a chip in the UI, so expertise reuses it rather
than adding a second nearly-identical column.

`null` readiness means the question was never asked. That is not the same as `no`,
and nothing in the system should treat it as one.

## Install order

```
1. Supabase → SQL Editor    supabase/migrations/050_meta_intake.sql     NEW
2. GitHub, one commit       lib/intake.ts                              NEW
                            lib/types.ts                               REPLACE
                            app/api/ingest/meta-lead/route.ts          REPLACE
                            components/leads/lead-drawer.tsx           REPLACE
```

The migration is idempotent. It prints two verification tables at the end showing
how the mappers read the wording people actually type, plus a readiness breakdown
of your existing leads (all `not asked` on the first run, which is correct).

Nothing needs to change in Make. The JSON in your screenshot is already right.

## What you will see

**Drawer header** — route chip, industry chip, then a readiness traffic light
(green Yes, amber Maybe, red No). Visible before scrolling, because it changes
how the call opens.

**Overview** — `Industry` is now a single compact dropdown instead of nine chips
competing for attention. `Can invest` is three buttons. `Source` is a new row
with an `AD FORM` badge. Both fields are editable, so a caller who learns
something on the phone can correct the form answer.

**Below the details** — a panel showing the answers verbatim. It renders straight
from the jsonb, so a question added to the Meta form tomorrow appears there on
its own with no code change.

**Visa type is gone from Overview.** The Visa route tab already owns it, states
the fee structure and journey each route implies, and makes switching a confirmed
action. Two quiet toggles in a details list were the wrong home for a field that
rewrites the agreement, the process email and the invoice labels.

## Two decisions worth knowing about

**Repeat submissions now enrich instead of vanishing.** Previously a duplicate
phone returned early and the answers went in the bin. Now the answers are folded
into the lead you already have, but only into empty fields. A value a human has
corrected in the CRM is never overwritten by an older ad-form answer.

**The mappers return `null`, never `other`, when they cannot read an answer.**
`null` means nobody could tell. `other` means a human looked and it fits nothing.
Collapsing the two would hide every unmapped form option inside a bucket that
looks deliberate.

## If a mapping is wrong

The raw answer is never touched, so this is always recoverable. Edit
`map_expertise` or `map_readiness` in the migration, edit the matching rules in
`lib/intake.ts` to keep the two in step, then run:

```sql
select * from public.intake_rederive();
```

It re-reads every stored raw answer and reports how many rows changed.

## Response payload

The route now returns `industry` and `investment_readiness` in its response.
Make's execution history will show how each answer was read, so a form option
nobody mapped surfaces there immediately rather than weeks later as a gap in a
report.

## Verified

`tsc --noEmit` clean. `next build` green. Mappers tested against 34 answer
strings including Meta's array wrapper, empty answers, and the cases that break
naive matching: "not sure" reads as maybe, "I cannot afford it" reads as no,
"fintech" reaches finance before tech claims it, "biotech" reaches healthcare.
