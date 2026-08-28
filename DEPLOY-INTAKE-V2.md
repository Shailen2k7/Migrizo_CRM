# Intake V2 — the ladder, exactly as specified

Chat in → T1 · CV in (any format) → T5 + PDF · **+30 seconds** → T6 ·
silence → T2/T3/T4 inside 24h · not eligible → T7 · question → human.

## What changed, mapped to your audit

1. **T1 for EVERY form message, returning customers included.** The system now recognises the "Hello! I filled out your form…" message by its content. Whoever sends it — old lead, new lead, lead already in a campaign, different country code — gets T1 (max one per chat per 24h so retries can't double-send).
2. **Different number than the form? Fixed.** The form message itself carries the truth (name, email, phone). The CRM now finds the lead by the form's email or phone — or **creates the lead on the spot** — and links the chat. The 14372996780 case can't happen again.
3. **48-hour / campaign / stage guards deleted.** The only rule left: never sent them T1 → send T1.
4. **Unknown number just says "Hi"? Still gets T1.** A minimal lead is created (named after the number until we learn better).
5. **CVs are KEPT.** Nothing is deleted after reading. Original filename preserved; a meaningless auto-name ("document-17878….pdf") is renamed to "**Lead Name — CV.pdf**". New red button in WhatsApp Settings: **Delete all stored CVs** — deliberate, confirmed, batched; chats + profiles + verdicts always stay.
6. **.doc now parses** (word-extractor added), alongside .docx, .pdf and photos.
7. **Your eligibility rulebook is LAW.** All ~400 keywords are (a) written into the AI's instructions and (b) enforced by a code-level safety net: a CV whose text matches the dictionary can NEVER go out as not-eligible, whatever the model thought. Cybersecurity, AI/ML, data, cloud, all classical engineering, research/PhD, fintech, semiconductors, biotech, climate — covered. (Tested against trap CVs: a receptionist and an ALL-CAPS sales CV stay not-eligible; SOC analyst, data scientist, mechanical engineer, PhD researcher all come back eligible.)
8. **T6 lands 30–90 seconds after T5** (was 4–5+ minutes): the verdict step waits 30 seconds and the engine now runs **every minute** instead of every five.
9. **T2/T3/T4 healed.** The most likely reason they never fired is that the engine's schedule was never registered — migration 078 re-registers it unconditionally, and the Campaigns screen's health strip will now show the job.
10. **Chase never nags for a CV we already hold.** A returning lead gets T1, but if their profile is already on file the nudges stop instead of asking again.
11. **Question in between → human.** Any real message that isn't the form, a CV, or a LinkedIn link gets NO auto-reply; the chat is flagged amber and a human takes over. (The pending nudges were already cancelled by their reply.)

## Deploy

1. Upload files to GitHub (same paths). `package.json`/`package-lock.json` changed — one new library (`word-extractor`) for .doc files; Netlify installs it on deploy.
2. Run `supabase/migrations/078_intake_v2.sql` in Supabase — twice; second run must be NOTICEs only. Watch for the NOTICE "migrizo-wa-intake cron registrations: 1".
3. Test the ladder end to end: fresh test lead → form-hello from WhatsApp → T1 in seconds → send a CV (try a .doc and a photo) → T5 + PDF → T6 ~1 minute later → check the file opens from the inbox with the right name.
4. Test the honest no: send a clearly non-technical CV → T7.
5. Test human takeover: reply "what documents do I need?" → no auto-reply, amber flag.

## Files

| File | What |
|---|---|
| `supabase/migrations/078_intake_v2.sql` | every-minute engine, 30-second T6, second-precision enqueue |
| `lib/whatsapp/formhello.ts` | NEW — recognises + parses the Meta form message |
| `lib/whatsapp/eligibility.ts` | NEW — your rulebook as code: dictionary, routes, safety net, AI instructions |
| `lib/whatsapp/intake.ts` | new T1 rules, lead create/link from the form, question→human, 30s T6 |
| `lib/whatsapp/profile.ts` | keep files + friendly names, .doc parsing, rulebook prompts, safety net |
| `lib/whatsapp/word-extractor.d.ts` | NEW — types for the .doc parser |
| `app/api/whatsapp/intake/drain/route.ts` | CV-on-file guard, resolved PDF |
| `app/api/whatsapp/assets/purge-cvs/route.ts` | NEW — Delete-all-CVs endpoint |
| `components/whatsapp/settings-tab.tsx` | Delete all stored CVs button |
| `package.json`, `package-lock.json` | + word-extractor |

Verified: type-check + build green; 078 applied twice on Postgres 16 with the 30-second cadence functionally tested; form parser tested on your real screenshots (including the Hindi-name one); eligibility dictionary tested against trap CVs; adversarial review ran — 6 findings, all fixed before packaging (including a regex bug that would have marked every CV eligible).
