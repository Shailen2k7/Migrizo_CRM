# The simple flow, working — 3 files

You already deployed the big zip. These three finish the job. Without them the
booking link and every T2/T3/T4 follow-up NEVER send — the cron that delivers
them was being redirected to the login page since the day it was scheduled.

## Deploy

```
1. Supabase SQL editor   supabase/migrations/080_wa_simple_cadence.sql   run TWICE
2. GitHub (same paths)   lib/supabase/middleware.ts
                         lib/whatsapp/outbound.ts        → Netlify redeploy
```

## What each fixes

| File | The fault it kills |
|---|---|
| `lib/supabase/middleware.ts` | Middleware bounced the cron's POST to /login (pg_cron doesn't follow redirects), so `/api/whatsapp/intake/drain` — and the automation + sequences drains — had never once run. T6 and T2–T4 were queued forever. Three paths added to PUBLIC_PATHS; each route still authenticates with x-cron-secret. |
| `lib/whatsapp/outbound.ts` | T2 failed with `missing:1` — the code assumed "T2 carries no variables" while your actual T2 quick reply opens "Hi {{1}}". Now {{1}} = first name on every step. |
| `supabase/migrations/080_wa_simple_cadence.sql` | Booking link at **1 minute** after T5 (was 4), and the drain cron **every minute** (was every 5), so "1 min" means 1–2 min in reality, not 1–6. |

## Proven end to end on localhost against the live DB (05:12 today)

```
CUSTOMER  form message
MIGRIZO   T1                    (2 seconds)
MIGRIZO   T2                    (no-reply follow-up, placeholder filled)
CUSTOMER  📄 Upen Pathak - CV.pdf
MIGRIZO   T5  — eligible        (parsed, verdict Digital Technology)
MIGRIZO   📄 Migrizo Process.pdf
MIGRIZO   T6  — booking link
CUSTOMER  "What is the total fee?"
          → no auto-reply, needs_attention flag lit, human takes over
```

Every message above landed on the test phone for real.
