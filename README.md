# THE fix — why the engine never ran by itself (+ Prateek's access)

## Root cause, found and confirmed
The website's security layer (middleware) has an allowlist of addresses that
may be called without a login. My new engine address was NOT on it. So every
automatic scheduler call was bounced to the login page → 405 Method Not
Allowed → nothing ever sent on its own. Your "Run engine now" button worked
because YOU are logged in. One line fixes it forever.

Also fixed in this package:
- Toggles / quick-reply saves that were silently blocked now show a real error
  instead of pretending to save.
- Every active team member (Prateek included) becomes a campaign admin, so
  toggles, steps and quick replies work on their logins too.

## Do these 3 things

1. Replace these 3 files in the repo, commit, push, wait for Netlify green:
   - lib/supabase/middleware.ts          ← THE fix
   - components/whatsapp/campaign-center.tsx
   - components/whatsapp/replies-tab.tsx

2. Supabase → SQL Editor → run supabase/migrations/063_team_access_and_fixes.sql
   (safe twice; it prints "campaign admins: N" at the end — N should equal
   your team size).

3. Nothing else. Do NOT press anything. Within 5 minutes of the deploy the
   strip should flip to "ENGINE — just now" ON ITS OWN. That flip is the
   proof: it means the scheduler finally got through.

## What to expect tomorrow
Sending hours are 10:00–19:00 IST. At 10:00 the engine starts on its own and
works through the backlog at your daily cap. Replies land in "They replied —
go talk to them". You do nothing.
