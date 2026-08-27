# Files that never fail + a verdict that stops rejecting eligible people

This zip contains **everything not yet deployed** — migration 078 (the form-message
restart, delivered earlier) and migration 079 (media reliability + the verdict
rubric). Deploying it once brings production fully up to date.

## Run in this exact order

```
1. Supabase SQL editor   supabase/migrations/078_wa_form_restart.sql      run TWICE
2. Supabase SQL editor   supabase/migrations/079_wa_media_reliability.sql run TWICE
3. GitHub (same paths)   the six code files below → let Netlify redeploy
```

Second run of each migration must finish with NOTICEs only. Both end with
verification flags and raise on their own if anything did not apply.

**Migrations must go first.** The code calls RPCs and reads columns that do not
exist until they have run — in particular `/api/whatsapp/media/backfill` writes
`media_error`, which 079 creates.

## Files

| File | What |
|---|---|
| `supabase/migrations/078_wa_form_restart.sql` | tag column, `wa_intake_restart()`, `wa_find_lead_by_contact()`, rebuilt `whatsapp_conversations_list()` |
| `supabase/migrations/079_wa_media_reliability.sql` | `media_error` column, broken-media index |
| `lib/whatsapp/intake.ts` | Meta form-message detection, 24h cooldown, orphan lead link, Returning tag, chase restart |
| `lib/whatsapp/types.ts` | `tag` on the conversation row type |
| `app/(app)/whatsapp/page.tsx` | the `Returning` chip |
| `app/api/whatsapp/webhook/route.ts` | media capture retry, readable filenames, failure recorded to the DB |
| `lib/whatsapp/profile.ts` | the eligibility rubric, shared by both prompts; `temperature: 0` |
| `app/api/whatsapp/media/backfill/route.ts` | **NEW** — recovers attachments that failed to store |

---

## 1. Attachments: why they said "file not available"

**35% of media (14 of 40) had `media_path = null`.** The cause was on our side,
not Interakt's: their blob URLs stay valid until 2031, and re-fetching failed
ones returned the complete file every time. `captureMedia` tried the download
and the upload **once each**, and on failure wrote the reason to
`console.error` and nowhere else — no retry, no record, nothing to recover from.

**Fixed:**
- Two attempts on both the download and the upload. Most of these failures are
  transient.
- The failure reason is written to `whatsapp_messages.media_error`, in the
  database, where a human can see it.
- The source URL is retained on every failure path, which is what makes
  recovery possible at all.
- `/api/whatsapp/media/backfill` (POST, admin only) recovers stored-failed
  attachments in batches of 5, reading the URL from the message row or, when
  that is empty, from the raw payload in `whatsapp_webhook_log`.

**Already done on your live data: all 12 broken customer attachments have been
recovered and re-linked.** Remaining broken: 0. The only two left are our own
outbound "Migrizo Process.pdf" sends, which never had a stored copy — not
customer files.

## 2. Filenames: Interakt does not send them

Every inbound media payload was checked. The complete key list on the message
object is `campaign_id, campaign_name, channel_error_code,
channel_failure_reason, chat_message_type, delivered_at_utc, id,
is_template_message, media_url, message, message_content_type, message_status,
meta_data, raw_template, received_at_utc, referral, seen_at_utc,
source_message_id`.

There is **no** `file_name`, no `caption`, no `document.filename`, and the URL
itself is a random blob (`ylfdTBkupHNu.pdf`). The customer's original filename
never reaches us, so it cannot be preserved — that is an Interakt limitation, not
a bug in this CRM.

Attachments are now named from the lead instead: **`Upen Pathak — CV.pdf`**,
falling back to the phone number when the chat has no lead yet. If a filename
ever does arrive in a future Interakt version, it wins over the generated one.

## 3. The verdict: why a cybersecurity candidate was rejected

The old prompt defined Digital Technology as *"product/engineering leadership,
scaling products, open-source impact, founding or senior roles at product-led
tech companies"* and then added *"routine IT service roles ... are usually NOT
eligible"*. Cybersecurity was never mentioned. Neither was data, infrastructure,
DevOps, ML, semiconductors or telecom. A security architect matched none of the
positive wording and every word of the negative.

Three more faults: no Exceptional **Promise** route, so early-career candidates
were judged against the proven-leader bar; strict evidence-only judging of a
one-page WhatsApp CV; and **no `temperature`**, which defaults to 1.0 — the same
CV could come back eligible on one run and not on the next.

**Fixed:** one shared rubric covering your full field list, used by BOTH the
text prompt and the vision prompt (they previously carried two different
descriptions, so a PDF CV and a photographed CV could be judged differently).
Exceptional Promise added. `temperature: 0` on both calls.

**A/B tested against the old prompt on five profiles:**

| Case | Old | New | Route |
|---|---|---|---|
| Cybersecurity engineer (CISSP/OSCP, 3 CVEs) | ❌ no | ✅ **yes** | Digital Technology |
| Early-career data engineer (3 yrs) | ❌ no | ✅ **yes** | Digital Technology |
| Mechanical research PhD | yes | yes | Research & Academia |
| Retail store manager *(control)* | no | **no** | None |
| Admin assistant *(control)* | no | **no** | None |

Two false negatives fixed; the controls still correctly return no.

## Still open — not in this zip

**Your Process PDF is a Google Drive link.** `pdf_url` points at
`drive.google.com/file/d/.../view`, which serves `text/html`. `resolveProcessPdf`
correctly refuses it, so **T5's document is failing for every eligible lead**.
Fix it in WhatsApp → Settings → **Upload PDF** with the actual file. `video_url`
is also a Drive link.

**One lead is jammed.** `Modassir Faiaz` has
`profile_ai = {"status":"processing"}` left over from an interrupted run, and no
CV he sends will ever be judged. There is no staleness timeout on that claim.
Clear it with:

```sql
update public.leads set profile_ai = null where profile_ai->>'status' = 'processing';
```

A proper fix (a timeout on the claim, and moving the verdict out of the webhook
into the cron drain) is a separate change worth planning.

## Verified

`tsc --noEmit` clean · `next build` green, all routes compiled · the eligibility
rubric A/B tested live against the previous prompt on five profiles · the CV
pipeline run end-to-end locally on a real 3-page PDF from your storage
(9,556 characters extracted, verdict returned) · 12 broken attachments recovered
and re-linked on production with 0 remaining, and 16 orphaned storage objects
cleaned up afterwards.

**Not verified:** neither migration has been run — there is no Postgres or Docker
on this machine. Run each twice and watch the NOTICE flags.
