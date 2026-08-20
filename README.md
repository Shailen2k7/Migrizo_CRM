# Sound on new message + unread count in the browser tab

## What you get

**1. A soft chime when a lead writes in.** Plays from ANY page of the CRM —
you can be in Payments and still hear it, like WhatsApp Web in a background tab.

**2. The browser tab shows the count**, exactly like your screenshot:
`(3) Migrizo CRM`. It counts unread conversations and falls back to a plain
title the moment you have read everything. Works from every page.

**3. A mute button** in the WhatsApp header (bell icon, next to the number
pill). Clicking unmute plays the sound once so you can hear what you are
turning on. The setting is per-browser, so muting during a call does not
silence the rest of the team.

## Deliberate behaviour (so it stays pleasant, not annoying)

- Only INBOUND messages chime. Campaign sends never make a sound.
- No chime while you are actively looking at the WhatsApp screen — you can
  already see the message land.
- Bursts collapse: ten replies arriving together = ONE chime, not ten.
- The sidebar's green WhatsApp badge already existed and keeps working.

## Files (4) — no database change, nothing to run in Supabase

| File | What changed |
|---|---|
| `components/whatsapp/wa-alerts.tsx` | NEW — the watcher (sound + tab title) |
| `lib/chime.ts` | added the gentle two-note "message" voice |
| `components/shared/app-shell.tsx` | mounts the watcher on every page |
| `app/(app)/whatsapp/page.tsx` | the mute bell in the header |

## Test it in 60 seconds
1. Deploy, open the CRM, and click anywhere once (browsers block sound until
   you interact with the page — normal for every web app).
2. Switch to another CRM page, e.g. Leads.
3. Message your CRM WhatsApp number from your phone.
4. You should hear the chime and see the browser tab become `(1) Migrizo CRM`.
5. Open the WhatsApp tab and read it — the count disappears.
