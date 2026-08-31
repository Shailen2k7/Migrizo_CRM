# Multiple booking pages — one per person

Type-check and build both green. **One code file changed.**

---

## What you can now do

Meetings → **Booking settings**. At the top there's a row of booking pages with
a **+ Add a person** button beside them.

| Action | Where |
|---|---|
| Create a page for Mansi | Booking settings → **+ Add a person** |
| Switch between pages | Click a name in that row |
| Pause just Mansi's page | Team booking pages list → **Pause** |
| Edit Mansi's hours, slots, days off | Pick her name, then edit as normal |
| See only Mansi's calls | Meetings → the **Everyone's calls** dropdown |

Each page keeps its own link, hours, slot length, notice, daily cap, days off,
reminders and live/paused state. Nothing is shared between them.

---

## Setting Mansi up — two minutes

1. Meetings → **Booking settings** → **+ Add a person**
2. **Whose calendar is this?** — pick Mansi if she has a CRM login.
   If she doesn't, choose *"Someone without a CRM login — I'll manage it"*.
   A booking page does not require a login; you just manage it from your account.
3. **Booking link** → `mansi` → the page becomes `crm.migrizo.com/book/mansi`
4. **Name shown to the client** → `Mansi Behal` — this is what appears on the
   booking page, in the confirmation email and in every reminder
5. **Meeting title** → e.g. `GTV Consultation`
6. **Meeting link** → her Google Meet or Zoom room
7. Set her hours, slot length and notice — they are hers alone
8. **Create booking page**

Copy her link from the Team booking pages list at the bottom.

---

## What the client sees

Whichever link you send decides everything. Send `/book/mansi` and the page says
**Mansi Behal**, offers her hours, and every email — confirmation, reminders,
reschedule, cancel — carries her name and her meeting link. Nothing says Shailen.

---

## Whose calls are whose

The Meetings page gets an **Everyone's calls** dropdown next to the status filters.
It applies to the calendar, the upcoming list and the history at once, so you can
check Mansi's week without reading past your own.

Every meeting is already tagged to the person who was booked — that has always been
stored, it just had no filter until now.

---

## Install

1. **If you have not yet run `084_scheduler_flexible.sql`, run it first.** It is
   included here again and is safe to run twice. The new fields depend on it.
2. Upload `app/(app)/meetings/page.tsx`.
3. Netlify redeploys.

---

## Verify

- [ ] Booking settings shows a **+ Add a person** button
- [ ] Create Mansi's page and open `/book/mansi` in a private window
- [ ] It shows her name, her hours, her meeting title
- [ ] Book a test slot — the confirmation email says Mansi
- [ ] Pause her page from the team list → the link shows your paused message
- [ ] Meetings → **Everyone's calls** → pick Mansi → only her calls remain

---

## Two things worth knowing

**Only admins see other people's pages.** A non-admin opening Booking settings sees
only their own, exactly as before. Bear in mind the underlying database rule is
workspace-wide, so this is a UI boundary rather than a hard lock — fine for a team
of six, worth tightening if you ever hire beyond people you fully trust.

**Round-robin is the natural next step.** Right now you choose who gets the call by
choosing which link you send. If you'd rather have one link that hands the call to
whoever is free — or splits them evenly between you and Mansi — say the word. It
builds on exactly this structure.
