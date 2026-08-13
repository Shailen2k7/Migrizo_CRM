# No more calculating — every option tells you how many people are in it

2 files. Run the migration, upload, redeploy.

```
supabase/migrations/061_audience_facets.sql   NEW — run in Supabase SQL Editor
components/whatsapp/campaigns-tab.tsx         REPLACE
```

**Verified:** `tsc` clean · `next build` green · migrations 056→061 applied
**twice in order** · **7 new facet tests** + the **8 campaign-engine tests
re-run** (061 replaces the audience matcher, so the old suite had to prove no
regression — it did).

> One note on rigour: my first run of the new tests was passing *vacuously* —
> the workspace guard was refusing the call and every assertion compared
> against NULL, which never raises. Fixed by asserting `ok = true` before
> anything else. The results above are real.

---

## What went wrong — my fault, not yours

You ticked Yes / Maybe / No under "Can invest". All 82 hot leads have that
field empty, so the filter removed every one of them and the screen said **0**
with no reason. You had to open SQL to find out why. A filter that deletes
people invisibly is a broken filter.

## Three changes, and you never do arithmetic again

**1. Every chip carries its own count.**
`Hot leads 82` · `Tech 24` · `Never asked 82` · `Yes 0`. Chips holding nobody
are greyed out — visibly a dead end *before* you click. Counts are true
faceted counts: each row is counted with its own filter lifted, so a chip's
number is exactly what you get by clicking it.

**2. Stage is the only decision. Everything else is optional.**
Opens with three big stage chips and one green line: *"Reaching **everyone**
in the stage above — nobody is left out."* Filters hide behind **Narrow it
down**; **Reach everyone** undoes any mess in one click.

**3. A zero explains itself and offers the fix.**

> Your **Can invest** filter is removing everyone. Without it you reach **82**.
> [ Remove Can invest filter ]

**Also fixed:** "Unknown" was a dead chip that matched nothing. It is now
**Never asked** / **No tag** / **No route set**, each with a real count — and
Visa gained the same option, because all 82 of your hot leads have no route
set, which made that row unusable. Audiences you already saved are migrated
automatically. New campaigns default to stage-only with no recency rule; the
24-hour "never talk over a live chat" safety is always on and cannot be
switched off.

## Test it (30 seconds)

1. Run 061 in Supabase.
2. Upload `campaigns-tab.tsx`, redeploy.
3. Open **Hot Lead - Follow up** → Stage row reads **Hot leads 82** → green
   line confirms you are reaching everyone → count card shows 82.
4. Click **Narrow it down** → *Can invest* shows `Yes 0` `Maybe 0` `No 0`
   `Never asked 82`. The reason your screen said 0 is now visible at a glance.
5. Tick **Yes** only → count drops to 0 → amber panel names "Can invest" and
   offers the one-click fix. Press it → back to 82.
6. Press **Apply changes** to enrol them.
