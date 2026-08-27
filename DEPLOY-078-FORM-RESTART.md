# Meta form message restarts the chase — deploy steps

One feature, one zip. Four files, nothing else touched.

## What changes for a lead

When someone taps through a Meta lead ad, WhatsApp pre-fills their first message
with the answers they just gave. That message now means one thing, always:
**answer this person.**

Stage, age, source and country stop being consulted. A lead who has sat in the
Cold campaign for six months and taps the ad today gets T1 within seconds, then
T2/T3/T4 on the normal cadence. This is the case that was silently dropping
before — the old guard demanded `stage='cold'` **and** created in the last 48h
**and** never messaged, and a real re-engaging lead fails all three.

## The order it runs in

1. **Cooldown** — a T1 already sent to this chat in the last **24 hours**? Stop.
   Nothing else runs. This is what stops Interakt's webhook retries and
   double-taps on the ad button from sending T1 twice.
2. **Orphan rescue** — chat has no lead? The form block contains the name, phone
   and email they typed. Match a lead on those and link the chat. People fill
   the form on a laptop and message from their phone, so the number we are
   chatting with is often not the number on the form. **Only ever links an
   existing lead — never creates one.**
3. **Returning** — do we already hold their CV (`profile_text` / `profile_ai`)?
   Then no automated message goes out at all. The chat is tagged **Returning**,
   `needs_attention` is set, and a human picks it up. Asking someone for a CV
   they already sent is the fastest way to look like a machine.
4. **Otherwise** — the chase is wound back to step 1 and T1 fires now.

Opt-outs still win over all of it: `wa_intake_restart` returns null for a
suppressed number, and `whatsapp_record_outbound` refuses it again at send time.

## Deploy, in this order

1. **Run the migration** in Supabase SQL editor:
   `supabase/migrations/078_wa_form_restart.sql`
   Run it, then run it a **second time** — the second run must finish with
   NOTICEs only. It ends with four verification flags and raises if any is false.
2. **Upload the three code files to GitHub** (same paths), let Netlify redeploy.

The migration must go first. `lib/whatsapp/intake.ts` calls two RPCs that do not
exist until it has run, and `app/(app)/whatsapp/page.tsx` reads a column that
does not exist until it has run.

## Files

| File | What |
|---|---|
| `supabase/migrations/078_wa_form_restart.sql` | **NEW** — `tag` column, `wa_intake_restart()`, `wa_find_lead_by_contact()`, rebuilt `whatsapp_conversations_list()` |
| `lib/whatsapp/intake.ts` | Pattern detection, 24h cooldown, orphan link, returning tag, restart + T1 |
| `lib/whatsapp/types.ts` | `tag` on the conversation row type |
| `app/(app)/whatsapp/page.tsx` | The `Returning` chip in the conversation list |

## Two things worth knowing

**`whatsapp_conversations_list` is dropped and recreated.** Postgres will not let
a function's return table change in place, and `tag` is being added to it. Both
statements are inside the migration's transaction, so no window exists where the
inbox has no list function — but this is the RPC your inbox loads from, so run
the migration when you can watch it rather than at 2am.

**The pattern matcher does not rely on the greeting.** Two tests, either
sufficient: the phrase `filled out/in your form`, **or** two or more of the
labelled lines (`Full name:`, `Phone number:`, `Email:`, `Field of expertise`,
`Readiness to invest`). The second test is the insurance — Meta has already
reworded this text once. `DEPLOY-INTAKE-AUTOPILOT.md` records it as "filled **in**
your form" while the messages arriving today say "filled **out** your form".

## Verified

`tsc --noEmit` clean · `next build` green (39/39 pages) · pattern matcher tested
against 8 cases including both real greeting variants, a reworded greeting, and
five negatives that must not match (plain hello, a question, a single field, CV
prose). Contact extraction pulls the correct form phone and email out of both
real messages.

**Not verified: the migration has not been run.** There is no Postgres or Docker
on this machine and no service-role key available to reach Supabase, so the
apply-twice check is yours to do at step 1. Watch for the four NOTICE flags.
