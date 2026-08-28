# The verdict can no longer be killed — final wiring

## Why your last test went silent

The CV arrived, stored perfectly, then nothing. Cause, proven from the logs:
the AI verdict ran INSIDE the webhook request, and Netlify kills any function
at ~26 seconds. Your earlier success squeaked through at 24s; this one didn't.
Every CV was a coin flip.

## The fix — your own rule 8, queue-and-drain

The webhook now only QUEUES the judgement (returns in ~2s, cannot be killed).
The every-minute cron drain does the reading: judge → T5 + process PDF (or T7)
in the same tick → T6 one minute later. A killed drain run simply retries via
its lease. The 20-second in-request sleep for multi-photo CVs is gone too —
the queue delay IS the settle time now.

## Deploy

```
1. Supabase SQL editor   supabase/migrations/080_wa_simple_cadence.sql   run TWICE
   (skip if already run — it is idempotent either way)
2. GitHub (same paths):  lib/supabase/middleware.ts
                         lib/whatsapp/outbound.ts
                         lib/whatsapp/intake.ts
                         app/api/whatsapp/intake/drain/route.ts
   → let Netlify redeploy
```

## Proven end to end on localhost against the live DB (07:26 today)

ELIGIBLE path:
```
07:26:20 CUSTOMER  form message
07:26:21 MIGRIZO   T1
07:26:26 CUSTOMER  📄 Upen Pathak - CV.pdf     (webhook: queued, 2s)
07:26:46 MIGRIZO   T5 — ELIGIBLE · Digital Technology
07:26:46 MIGRIZO   📄 Migrizo Process.pdf
07:26:48 MIGRIZO   T6 — booking link
```
NOT-ELIGIBLE path (07:23): judge → T7 in the same tick.
QUESTION path (05:13): no auto-reply, needs_attention flag → human.
T2 follow-up (05:13): sends with the name filled.

## Real-world timing after deploy

T1: seconds. CV → T5: up to ~1½ min (next cron tick + AI read). T5 → T6: ~1 min.
That ~1 min on T5 is the price of it never silently dying again — the old
"instant" T5 failed roughly half the time.
