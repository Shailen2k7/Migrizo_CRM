# WhatsApp removal — complete

The WhatsApp module is gone from the CRM. WhatsApp now lives entirely in Interakt.
`npm run type-check` and `npm run build` are both green with zero WhatsApp code in the app.

There are **three steps**, in this order. Do not skip step 1.

---

## STEP 1 — Delete these folders and files on GitHub

This is the part a zip cannot do for you. Delete each of these from the repo.

| Delete | What it was |
|---|---|
| `app/(app)/whatsapp/` | The WhatsApp inbox page |
| `app/wa/` | The popout chat window |
| `app/api/whatsapp/` | All 11 WhatsApp API routes (webhook, send, drain, campaigns, media, assets, diagnose, test-connection) |
| `components/whatsapp/` | All 11 WhatsApp components |
| `lib/whatsapp/` | The whole engine — Interakt adapter, intake, outbound, profile, eligibility, types |

On GitHub: open the folder → **⋯** → **Delete directory** → commit.
Locally, if you prefer: `git rm -r "app/(app)/whatsapp" app/wa app/api/whatsapp components/whatsapp lib/whatsapp`

**Nothing else in the repo is deleted.**

---

## STEP 2 — Upload the files in this zip

Same paths, overwriting what's there.

| File | What changed |
|---|---|
| `components/sidebar.tsx` | WhatsApp nav item, unread badge and the `useWaUnread` hook removed |
| `components/shared/app-shell.tsx` | The `<WaAlerts>` watcher removed — no more inbound chime or tab counter |
| `lib/supabase/middleware.ts` | The two WhatsApp webhook paths taken out of the public allowlist |
| `app/api/ingest/meta-lead/route.ts` | No longer enqueues the T1 chase. Meta leads still land, still get the welcome email |
| `app/api/lead/cv/[leadId]/route.ts` | **Open CV still works.** Now reads the archived file, then falls back to the extracted profile as a printable document. No chat lookup |
| `lib/files/serve.ts` | **New.** The file-download code, moved out of `lib/whatsapp/`. Same fix that stopped the 0-byte downloads |
| `components/leads/lead-drawer.tsx` | Stale "sent on WhatsApp / file deleted" copy corrected |
| `lib/types.ts`, `lib/ai/context.ts`, `app/(app)/ai/page.tsx`, `app/api/queue/draft/route.ts` | Wording made channel-neutral |
| `package.json` | Removed `pdf-parse`, `mammoth`, `word-extractor` — only the CV pipeline used them |

Netlify redeploys. The CRM has no WhatsApp module.

**Optional but tidy:** delete `INTERAKT_API_KEY` and `WHATSAPP_WEBHOOK_SECRET` from Netlify environment variables.
Also turn off the webhook in Interakt so it stops posting to a URL that no longer exists.

---

## STEP 3 — The database, when you're ready

Two SQL files. **Run them in order, on separate days if you want.**

### `081_preserve_cvs_before_whatsapp_removal.sql` — run this first, it is safe

Some leads' CVs were never copied into the permanent archive; their only pointer
is a row in `whatsapp_messages`. This finds every one of them and points
`leads.cv_path` at the file that is already sitting in Storage.

No file is moved or copied. It only ever fills a blank. Run it twice if you like.

It prints how many CVs it recovered. **Read that number before going further.**

At the bottom of the file there is a query that exports your whole chat history
to CSV. Run it and download the file. Interakt has the same history, so this is
a second copy, not your only one.

### `082_remove_whatsapp.sql` — destructive, no undo

Unschedules the three cron jobs, drops every `whatsapp_*` and `wa_*` function
and trigger, then drops the 11 tables. It prints a confirmation showing 0 tables,
0 functions and 0 cron jobs remaining.

**What deliberately survives:**

- The `whatsapp-media` storage bucket and every file in it. Your archived CVs
  live there and `leads.cv_path` still points at them, so **Open CV keeps working**.
  A Supabase bucket cannot be renamed, so the name stays. Nobody sees it.
- Every lead column: `profile_text`, `profile_ai`, `eligibility`,
  `eligibility_source`, `profile_received`, `cv_path`, `cv_name`,
  `first_response_at`. That is lead data, not WhatsApp data — and it is years of
  AI eligibility verdicts. Deleting it would be throwing away the asset.
- The `whatsapp` option on follow-up channel. You still message people; you just
  do it from Interakt now.

---

## What I deliberately did NOT remove

Three things mention WhatsApp but are not the module. Say the word and they go too.

| Where | What it is | Why I kept it |
|---|---|---|
| **My Queue** | A "Send on WhatsApp" button that opens `wa.me` | It is how a rep starts a chat from their own phone. More useful now, not less, since chats live in Interakt |
| **Follow-ups** | "WhatsApp" as a channel option | You still follow up on WhatsApp. Removing it would break existing follow-up records |
| **Public blog** | Share-on-WhatsApp button and a "WhatsApp us" CTA | Marketing on the public site, nothing to do with the CRM |

---

## `_ARCHIVE-do-not-upload/`

Six files pulled out before deletion. **Do not put these in the repo** — they are
not wired to anything and would be dead code.

Keep them in a folder on your machine. Two of them matter:

- **`eligibility.ts`** — the 8-family, ~400-keyword rulebook. The single most
  valuable file we wrote. Channel-agnostic; it works on any text.
- **`profile.ts`** — the CV pipeline. PDF / DOC / DOCX / photo → text →
  Claude verdict. Works on any file source, not just WhatsApp.

When you build v2 with a client portal for CV uploads, these two drop straight in.
The other four (`intake`, `outbound`, `interakt`, `formhello`) are WhatsApp-specific
and only worth keeping as a reference for how the T1–T7 ladder was timed.

---

## Verify it worked

- [ ] No **WhatsApp** item in the sidebar
- [ ] `/whatsapp` returns 404
- [ ] No chime and no `(3)` in the browser tab when a message arrives
- [ ] A new Meta lead still lands in the CRM and still gets the welcome email
- [ ] Open a lead who sent a CV → **Open CV** → the file opens
- [ ] Leads, payments, cases, meetings, campaigns and emails all unchanged
