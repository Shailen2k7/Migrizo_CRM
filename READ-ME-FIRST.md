# Click-to-WhatsApp leads · a scheduler that runs itself · read = read

4 files. Run the migration, upload, redeploy.

```
supabase/migrations/053_whatsapp_ctwa_and_cron.sql   NEW — run in Supabase SQL Editor
app/api/whatsapp/automation/drain/route.ts           REPLACE
components/whatsapp/automation-tab.tsx               REPLACE
app/(app)/whatsapp/page.tsx                          REPLACE
```

⚠️ Run **052 first** if you haven't — this builds on it.

`tsc` clean · `next build` green · migration applied twice · **17 new tests
passing** (11 behavioural, 6 parser matrix).

---

## 1. Click-to-WhatsApp ads now get the FULL automatic journey

Your screenshot showed the real shape of these leads: a Meta "Send message" ad
doesn't POST to our API — it sends the answers **as the first WhatsApp
message**:

```
Full name: Shailen Pathak
Email: shailenpathak@gmail.com
Field of expertise? Which area do you qualify under?: Tech
Readiness to invest? …?: Yes
```

That's now parsed. The lead arrives with a real **name, email, industry and
willingness to pay** — identical to a form lead — and runs the whole journey
with no human step:

**Ad message → tagged lead → 🔥 hot-lane push → intro asking CV + LinkedIn →
they reply → guide + video + booking link → booked stops everything.**

Verified across ad wordings: `Tech → tech`, `Research & Academia → research`,
`Arts and Culture → art`, `Maybe, depends on cost → maybe`, `No, I cannot
afford it → no`. Ordinary chat like "Hi, my email: test@x.com" or "what is the
price?" is correctly **not** mistaken for a form.

**This is now your best channel** — full tagging *and* the 24-hour window is
open, so every message is free text: no template, no approval, no marketing
frequency cap. The "not delivered" problem cannot occur here.

A bug worth naming: my first parser read the readiness answer into the
*expertise* field, because "invest in **profession**al guidance" matched the
expertise pattern. Order is now readiness-first and "profession" is anchored to
a word boundary. My own test caught it before you ever saw it.

## 2. You should never press "Run now" again

**This was a real defect, and it explains everything you've been seeing.**
Migration 051 scheduled the drains only *"if the cron schema exists"* — and on
your Supabase project pg_cron had never been enabled, so that check **silently
did nothing**. The engine has only ever moved when you pressed the button.

053 enables `pg_cron` + `pg_net`, schedules both drains (automation every
minute, sequences every 10 minutes), and — more importantly — makes the
scheduler **visible**:

- Green bar on the Automation tab: *"Running automatically — automation every
  minute, sequences every 10 minutes. Last run 2m ago."*
- Red bar if it isn't, telling you exactly what to fix.

**If you see the red bar after running the migration:** Supabase → Database →
Extensions → enable **pg_cron** and **pg_net**, then re-run 053. (Some plans
require enabling them from that screen; the migration says so rather than
failing quietly — which is the whole lesson here.)

"Run now" stays as a manual override for testing. You won't need it.

## 3. Read means read

Opening a chat cleared the badge on screen but **not in the database**, so it
came straight back on the next refresh — along with the orange "Needs reply"
dot, which nothing ever cleared.

Cause: a Supabase query builder is *lazy* — the HTTP request only fires inside
`.then()`. The code called `.rpc('whatsapp_mark_read', …)` and ignored the
result, so **no request was ever sent**. It now fires properly, and opening a
chat clears **both** the unread count and the "needs reply" flag, permanently.

---

## Test it

1. Run 053. Check the Automation tab shows the **green** scheduler bar.
2. Click your own click-to-WhatsApp ad from a phone that has **never** messaged
   you. Within a minute, with no clicking:
   - the lead appears with **Industry = Tech** and **Can invest = Yes**
   - you get the 🔥 hot-lead push
   - they receive the intro asking for CV + LinkedIn
3. Reply from that phone → guide + video + booking link arrive automatically.
4. Open any chat with an unread badge → refresh the page → badge stays gone.
