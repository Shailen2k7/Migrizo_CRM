# WhatsApp Intake Autopilot — deploy steps

One feature, one zip. Nothing outside these files was touched.

## What this does (30 seconds)

- Lead lands from Meta → messages us "Hello! I filled in your form…" → **T1 goes out instantly** as normal text (window is open, no Meta template needed).
- No reply → **T2 +4h, T3 +6h later, T4 +10h later** — all inside the 24-hour window, from your Quick replies. Any reply from the lead cancels the rest, enforced in the database.
- Lead never messages us at all → falls back to **Meta-approved templates, spread over days** (T1 → +1d → +2d → +3d), inside the 10:00–19:00 send window, to keep the number safe. Until templates are approved these retry daily and show a clear error — nothing silent.
- **CV arrives → read, judged by AI, file DELETED.** The formatted profile lives behind a new **View profile** button in the lead drawer. Eligible → T5 + process PDF + T6 booking link minutes later. Not eligible → T7. A human verdict always outranks the AI one.
- LinkedIn URL with no CV → recorded on the lead, conversation flagged for a human (we cannot read LinkedIn).
- **Master switch**: one "Campaigns ON/OFF" button on the WhatsApp Campaigns screen stops/resumes cold + hot together. **It ships OFF** (your templates aren't approved yet). The autopilot ignores it and keeps working.

## Deploy (in this order)

1. **Upload the files to GitHub** (same paths). `package.json` / `package-lock.json` changed — two new libraries (`pdf-parse`, `mammoth`) for reading CVs. Netlify installs them automatically on deploy.
2. **Run the migration** in Supabase SQL editor: `supabase/migrations/076_wa_intake.sql`. Run it, then run it a second time — second run must finish with only NOTICEs. It also pauses the cold+hot campaigns immediately.
3. **Check WhatsApp → Settings** and fill the three new fields: **Booking link**, **Video link**, **Process PDF link**. T5/T6 refuse to send while a link they need is empty (you'll see the error, the lead never sees a broken `{{2}}`).
4. **Check Quick replies**: shortcuts/titles must be recognisable as T1…T7 (they are, you saved them as T1–T7).
5. Watch the **Autopilot** counter on the Campaigns screen. Test: submit a test lead, message the business number from it, T1 should arrive within seconds. (If dry-run is ON in Settings, sends are simulated and logged instead — flip it off when ready.)

## What still needs Meta approval (not blocking)

Templates T1–T4 for the "never messaged us" branch. Create them in the Templates tab / Interakt with codes containing `t1`…`t4` and submit. Until approved, that branch retries daily and gives up per-lead after 5 days, visibly.

## Files in this zip

| File | What changed |
|---|---|
| `supabase/migrations/076_wa_intake.sql` | queue, triggers, RPCs, master switch, profile columns, cron |
| `lib/whatsapp/outbound.ts` | NEW — the one shared send path (record → send → attach) |
| `lib/whatsapp/profile.ts` | NEW — CV extract → AI verdict → delete file |
| `lib/whatsapp/intake.ts` | NEW — T1 inline + verdict orchestration |
| `lib/whatsapp/pdf-parse.d.ts` | NEW — types for pdf-parse |
| `app/api/whatsapp/intake/drain/route.ts` | NEW — the 5-minute cron drain |
| `app/api/whatsapp/webhook/route.ts` | intake hook after inbound recording |
| `app/api/ingest/meta-lead/route.ts` | new leads enter the chase |
| `app/api/whatsapp/campaigns/run/route.ts` | master-switch gate |
| `components/whatsapp/campaign-center.tsx` | master toggle + Autopilot counter |
| `components/whatsapp/settings-tab.tsx` | booking / video / PDF link fields |
| `components/leads/lead-drawer.tsx` | View profile button + modal |
| `lib/types.ts` | profile fields on Lead |
| `package.json`, `package-lock.json` | + pdf-parse, + mammoth |

Verified: `type-check` clean, `next build` green, migration applied twice on Postgres 16, and a 12-scenario simulation of the queue state machine (double-send race, reply-cancel, verdict chain, opt-out, 5-strike failure, campaign exclusion) all passing.
