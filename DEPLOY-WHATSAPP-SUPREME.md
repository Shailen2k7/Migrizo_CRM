# WhatsApp Supreme — deploy steps

Second wave, on top of the Intake Autopilot zip (which you already deployed).
One zip, nothing outside these files touched.

## What's in it (your 10 points, honestly)

1. **Delete / edit like WhatsApp** — Right-click any message → **Delete for me** (hides it from your inbox + all devices instantly) and **Copy text**. Straight truth: the WhatsApp Business API does not let ANY system — Interakt's own dashboard included — edit or recall a message from the customer's phone. That feature exists only in the consumer app. Delete-for-me is the whole of what's possible, and it's built.
2. **Mark as unread** — Right-click a conversation → Mark as unread / Mark as read. Also: open in its own window.
3. **World-class notifications** — Every inbound WhatsApp message now pushes to every registered phone and desktop (lead's name + preview, tap → opens the inbox), on top of the in-app chime and tab badge. Team members must press **Enable notifications on this device** once in CRM Settings.
4. **Speed** — The inbox was already realtime (no polling). Perceived slowness was mostly T1's race (see 6). Sends stay optimistic — the bubble paints before Interakt answers.
5. **"Not supported for Document media"** — Root cause: the Process PDF "link" was a share-page (HTML), not a PDF. Fix: **Settings → Upload PDF** — the actual file now lives in your own storage and every T5 attaches it via a signed link that cannot break. Pasted links are now validated before sending, with a plain-English error instead of Interakt's cryptic one.
6. **T1 speed** — Found and closed the race: when a lead's WhatsApp hello arrived before Make finished posting the lead, T1 waited up to 15 minutes for the cron. Now the Meta ingest itself fires T1 the moment the lead lands if their chat window is already open. Both orders now land T1 in ~2 seconds.
7. **Mobile / PWA** — inbound push reaches the installed PWA on the phone (this was the missing piece — WhatsApp events never pushed before); bigger touch targets on chat rows; composer respects the iPhone home-bar safe area; app-icon badge on supported devices. 80% phone usage is exactly what the push work serves.
8. **Melodious sound** — the in-app chime now plays for EVERY role (was admin-only), everywhere in the CRM; phones get the push with a distinctive long vibration pattern (custom notification *sounds* are an OS-level restriction on web push — no website can override that; the chime covers open tabs, the push covers pockets).
9. **Engine health** — "sometimes going, sometimes not" was three real things, all fixed: the PDF failure (point 5), the T1 race (point 6), and unapproved-template sends which retry visibly instead of vanishing.
10. **Buttons** — WhatsApp-green pill Send button with press feedback, bigger rounded composer icons, polished right-click menus.

**PLUS — CV as photos:** a photographed CV (very common) is now read by vision AI: multi-page (several photos within minutes are read as one document), an is-this-even-a-CV gate (selfies and screenshots are left completely alone), then the exact same verdict flow — profile stored, images deleted, T5/T6 or T7. And **Settings → "Scan old photo CVs"** sweeps every EXISTING chat where someone already sent their CV as a photo; press until it says remaining: 0. Leads whose 24h window has closed get the verdict stored + a human flag instead of a send Meta would reject.

## Deploy (in order)

1. Upload files to GitHub (same paths). No new npm packages this time.
2. Run `supabase/migrations/077_wa_inbox_controls.sql` in Supabase — twice; second run must be NOTICEs only.
3. WhatsApp → Settings → **Upload PDF** (the actual process document file).
4. Everyone on the team: CRM Settings → **Enable notifications on this device**, on phone (installed PWA) and desktop.
5. Optional: Settings → **Scan old photo CVs**, press until remaining: 0.

## Files

| File | What |
|---|---|
| `supabase/migrations/077_wa_inbox_controls.sql` | hidden messages, mark-unread, thread filter |
| `lib/whatsapp/profile.ts` | photo-CV vision pipeline, atomic judgement claim (no double verdicts) |
| `lib/whatsapp/intake.ts` | multi-page settle, instant-T1 helper, shared verdict actions |
| `lib/whatsapp/outbound.ts` | PDF resolution (uploaded asset / validated link, long-lived text links) |
| `lib/push-server.ts` | NEW — workspace push |
| `app/api/whatsapp/webhook/route.ts` | push on inbound |
| `app/api/ingest/meta-lead/route.ts` | instant T1 on lead landing |
| `app/api/whatsapp/intake/drain/route.ts` | resolved PDF in sends |
| `app/api/whatsapp/intake/backfill-images/route.ts` | NEW — old-photo sweep (self-advancing) |
| `app/api/whatsapp/assets/upload/route.ts` | NEW — process-PDF upload |
| `app/(app)/whatsapp/page.tsx` | right-click menus, delete-for-me, unread, buttons, mobile |
| `app/wa/[id]/page.tsx` | pop-out honours delete-for-me |
| `components/whatsapp/settings-tab.tsx` | Upload PDF + Scan old photo CVs |
| `components/shared/app-shell.tsx` | chime for every role |
| `public/sw.js` | vibration + app badge |
| `lib/whatsapp/types.ts` | hidden flag |

Verified: type-check + `next build` green; migration 077 applied twice on Postgres 16 with hide/unread functionally tested; two independent adversarial code reviews (11 findings across both waves, all fixed — including the double-T5 photo race, the storage-pointer leak into message text, and the backfill loop).
