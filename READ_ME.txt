MIGRIZO — EMAIL SEQUENCE AUTOMATION MODULE
==========================================

What's inside (9 files):

  NEW  supabase/migrations/026_sequences.sql   The engine: sequences, steps,
       per-lead state machine, both hard guarantees, exits, sleep + one
       re-engagement, daily cap ramp, 30-min cron clock, campaign-stop fix.
  NEW  supabase/migrations/025_lead_engine_v2.sql   Your live junk-lead fix,
       finally committed to the repo.
  NEW  app/(app)/automation/page.tsx           The Automation page — the
       approved design, live: Sequences / Flow / Test / Leads.
  NEW  app/api/sequences/tick/route.ts         The heartbeat (cron target).
  NEW  app/api/sequences/test/route.ts         "Send test" to your own inbox.
  NEW  app/api/email/bounce/route.ts           Resend bounce/complaint webhook.
  FIX  app/api/queue/outcome/route.ts          Repairs the "Interested" button
       (was writing stages that don't exist in this CRM).
  UPD  lib/supabase/middleware.ts              Lets the cron + webhook through.
  UPD  components/sidebar.tsx                  Adds "Automation" (admin only).

Follow SETUP_STEPS.txt top to bottom. Verified: migration runs clean twice,
full lifecycle simulated end-to-end on a real Postgres, tsc + next build green.
