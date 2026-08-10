# WhatsApp fix pack — 4 files

Upload these 4 files into your repo (same paths), then run the one migration.

```
supabase/migrations/049_whatsapp_clear_conversation.sql   NEW
app/api/whatsapp/send/route.ts                            REPLACE
components/whatsapp/template-picker.tsx                   REPLACE
app/(app)/whatsapp/page.tsx                               REPLACE
```

Then in Supabase → SQL Editor, paste and run `049_whatsapp_clear_conversation.sql`.
It is idempotent — safe to run twice.

`tsc --noEmit` clean. `next build` green. Migration applied twice on Postgres 16, 7 test paths pass.

---

## PART 1 — Why you still can't send templates to existing chats

There were **three** separate causes, all wearing the same disguise. The audit
found the third one, and it is almost certainly your actual blocker.

### Cause 1 — Meta approved them, but your CRM never heard about it

Interakt approving a template does not write anything into your database. That
only happens if Interakt's *template-status* webhook is switched on, and it
isn't. So all 13 templates still sit at `meta_status = 'draft'` in the CRM, and
the send route refuses anything not marked approved.

**Fix:** WhatsApp → Templates tab → **"Mark all as approved in Meta"**. One click,
once. There's a banner there now explaining it.

### Cause 2 — The body text drifted between the CRM and Interakt

Six of your templates have **zero** `{{1}}` placeholders in the CRM copy, while
Interakt's copy of the same template has one. Interakt then rejects the send
with *"Missing variable values… expected number of values are 1"* — technically
accurate, completely unhelpful.

**Fix:** Templates tab is now editable. Open Interakt, copy the body **exactly**
as Meta approved it, paste it into the CRM, save. The CRM re-derives the
variable list from the body on save, so the two stay in step. The picker now
shows a `1 var` chip so a mismatch is visible before you press Send.

### Cause 3 — "Daily cap reached (0 of 100)" was lying to you  ← the real one

`whatsapp_can_send` folds three unrelated conditions — *credential connected*,
*not paused*, *under the daily cap* — into a single `allowed` flag. The send
route read that one flag and reported the last of the three. So a **disconnected
Interakt credential** surfaced in the UI as *"Daily cap reached (0 of 100)"*,
which sent you looking at limits instead of at the connection.

The route now tests the three conditions separately and names the right one:

| What's actually wrong | What you now see |
|---|---|
| Credential not verified on this deploy | `not_connected` — "press Test connection" |
| Sending paused | `sending_paused` |
| Genuinely over the cap | `cap_reached — 100 of 100` |

**Fix:** Settings → WhatsApp → **Test connection**. If it goes green, sending
works. `connected` is set by that test and is per-deploy — a Netlify redeploy
resets it, which is why this bit you after a deploy.

**Do these in order: 3, then 1, then 2.** Cause 3 blocks every send; the other
two only block specific templates.

---

## PART 2 — Close a chat and reopen it fresh

Chat header → **⋯** menu → two options.

**Clear messages** — wipes every message, keeps the contact in your inbox. Opens
as an empty thread.

**Delete conversation** — removes the thread entirely. It disappears from the
list and reappears blank the next time that number messages you, or you message
them.

Both are admin-only (`is_campaign_admin`), both write an `activity` row with the
message count, so a cleared chat still leaves an audit trail.

### Two decisions worth knowing about

**Opt-outs survive.** Clearing never touches `whatsapp_suppressions`. If someone
sent STOP, they stay stopped. A clear is a housekeeping action, not a way to
resurrect consent.

**Clear keeps `last_inbound_at`.** Meta's 24-hour customer-service window is a
fact about the real world, not a row in your database. If clearing reset that
timestamp, the CRM would think the window was shut while WhatsApp still had it
open, and your free-form replies would start failing for no visible reason.
*Delete* drops it along with the row — correct, because the next message
genuinely re-opens the window.

---

## PART 3 — Audit findings

**Fixed — the picker let you select an unsendable template.** It computed a
`blocked` flag and then never used it. You could pick a draft or Meta-rejected
template, press Send, and only find out at the server. Blocked templates are now
disabled in the list with the reason on the row: *"Meta rejected this template"*,
*"Not marked approved in this CRM"*, *"Retired"*.

**Fixed — variable count was invisible until failure.** Each template now shows
a `1 var` / `0 vars` chip, and a footer warning when a template has no variables
(the usual sign of Cause 2 above).

**Not a bug — "not delivered to maintain healthy ecosystem engagement."** That's
Meta's per-recipient marketing frequency cap. It counts marketing messages that
person received from *every* business, not just you, so it fires even on a day
you sent five. Nothing to fix in code — send UTILITY-category templates to
recently-active contacts, or wait it out.

---

## After this

Sequences, caps, and the send window are already live. The lead automation we
scoped (7 phases) is the next build. When you're ready I'll need from you:
the profession list (eligible + auto-junk), 15–20 FAQs, the process PDF, the
video link, the scheduler link, and the welcome message you want to use.
