# Flexible booking calendar

Type-check and build both green.

**Where all of this lives:** Meetings page → **Booking settings** (top right).
Not Settings → that's why it may have looked missing.

---

## First, the honest bit — two of your three asks already existed

| You asked for | Status |
|---|---|
| Choose the gap between slots — 15 / 30 / 45 min | **Already there.** "Slot every (min)" — 15, 20, 30, 45, 60 |
| Day start and day end time | **Already there.** Per-day start/end under Working hours |
| Put it in the meetings module settings | It always was — behind the **Booking settings** button on the Meetings page |

So rather than rebuild those, I fixed the five things that genuinely forced you to
come back to me, plus the one real bug in the hours editor.

---

## What is new

### 1. A lunch break — the actual bug

`working_hours` has always been a **list** of windows per day. The editor only ever
wrote **one**. So a Tuesday was 10:00–22:00 or nothing — you could not say
"10:00–13:00 and 15:00–19:00".

Now each day takes as many windows as you like. **+ Add window** on any day, and
**Copy to Mon–Fri** so you set it once.

### 2. Days off and one-off hours

A date-by-date override that beats the weekly pattern.

- Pick a date, leave both times empty → **the whole day is blocked**
- Pick a date and give times → **those hours instead, that date only**
- Add a note ("Diwali", "Flight to London") so you remember why

No more editing your weekly hours for a holiday and forgetting to put them back.
Past dates drop off the list automatically.

### 3. Notice needed

Was hardcoded at 60 minutes. Now: none, 30 min, 1 / 2 / 4 / 12 hours, 1 or 2 days.
Stops someone booking a call that starts in nine minutes.

### 4. How far ahead people can book

Was hardcoded. Now 7 to 90 days. Shorter horizons create urgency and stop people
parking a call six weeks out and forgetting.

### 5. Max calls per day

Set a number and once the day hits it, it shows as fully booked however much free
time is left. Six discovery calls in one day is not a working day.

### 6. Which reminders send

24h / 3h / 1h / 15min / at start — each one a toggle. The booking confirmation
always goes; these are the nudges after it.

### 7. Pause with a message

Turning the page off used to show visitors a dead end. Now you can leave a line —
*"Away until 12 Sept, email us and we'll sort a time"* — and they see that instead.

---

## Every rule is enforced on the server too

The booking page and the booking endpoint apply the **same** settings. A stale
browser tab cannot post a slot on a day you have since blocked, inside your notice
window, past your horizon, or over your daily cap. It gets refused.

---

## How to install

1. **Supabase SQL editor** → run `supabase/migrations/084_scheduler_flexible.sql`.
   Idempotent. Nothing about your current page changes until you edit the new
   fields — the defaults are exactly what the code did before.
2. **Upload the 5 code files**, same paths.
3. Netlify redeploys.

---

## Try it in two minutes

- [ ] Meetings → Booking settings → pick a day → **+ Add window** → 10:00–13:00 and 15:00–19:00
- [ ] **Copy to Mon–Fri**, Save
- [ ] Open your public booking link — the 1–3pm gap is gone
- [ ] Back in settings, block tomorrow with a note, Save
- [ ] Refresh the booking page — tomorrow shows nothing
- [ ] Set **Max calls / day** to 2 and confirm the third slot disappears once two are booked

---

## Worth knowing

**Slot every** and **Call length** are separate on purpose. `30 / 30` offers 10:00,
10:30, 11:00 back to back. `30 / 60` offers a slot every 30 minutes for an hour-long
call. Setting them equal is the normal case.

**Gap after** applies on *both* sides of a booking, so any value above 0 removes the
neighbouring slot. Leave it at 0 unless you genuinely need breathing room.

---

## Other no-code levers worth adding later

Ranked by how often I'd expect you to want them:

1. **Different meeting types on one link** — "15-min intro" and "45-min strategy call",
   each with its own length and hours. This is the biggest one.
2. **Round-robin across the team** — one link, whoever is free takes it.
3. **Questions on the booking form** — ask for their route or LinkedIn before the call,
   answered straight onto the lead.
4. **Editable reminder wording** — the copy is currently in code.
5. **Auto no-show** — mark a meeting no-show 20 minutes after it ends if nobody
   touched it, and fire a rebooking email.

Say the word on any of them.
