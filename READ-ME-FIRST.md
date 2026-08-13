# Half-hour booking slots · "Not Responding" as a real stage

8 files. Run the migration, upload, redeploy.

```
supabase/migrations/057_meeting_slots_and_not_responding.sql   NEW — run in Supabase SQL Editor
lib/scheduler/slots.ts                                         REPLACE
lib/types.ts                                                   REPLACE
app/api/booking/[slug]/slots/route.ts                          REPLACE
app/api/booking/[slug]/create/route.ts                         REPLACE
app/api/booking/manage/route.ts                                REPLACE
app/(app)/meetings/page.tsx                                    REPLACE
components/leads/leads-table.tsx                               REPLACE
```

`tsc` clean · `next build` green · migration applied twice · **7 slot-engine
tests + 4 database tests passing**.

---

## 1. Why 2:00pm was eating 2:30pm

Two separate causes, both fixed — and the second one is the real culprit.

**a) The slot grid stepped by the call's DURATION.** Grid spacing and call
length were one number, so changing a call to 60 minutes silently turned an
every-30-minutes page into an hourly one. They are now two independent
settings: **Slot every** (how often a time is offered) and **Call length**
(how long it runs).

**b) The buffer defaulted to 10 minutes, and it applies on BOTH sides.** A
2:00–2:30 call therefore blocked **1:50–2:40**, which overlaps the 2:30 slot
and removes it — so the next thing on offer was 3:00. Back-to-back half-hour
calls are impossible with any buffer above zero, so the default is now **0**
and your existing booking profile is reset once by the migration.

My test suite reproduces the old behaviour deliberately, so you can see the
diagnosis is right rather than take my word for it:

```
PASS  booking 14:00 leaves 14:30 open        (buffer 0 — the fix)
PASS  buffer 10 removes 14:30                (the old behaviour, reproduced)
PASS  60-min call on a 30-min grid still offers 10:00, 10:30, 11:00
```

**Result:** the booking page now offers 10:00, 10:30, 11:00 … and booking
2:00pm leaves 2:30pm open.

**Where to change it:** Meetings → Booking settings. The three fields now read
**Slot every 30 · Call length 30 · Gap after 0**. If you ever want breathing
room between calls, set the gap — just know it removes the neighbouring slot,
which the help text under the fields now says out loud.

## 2. "Not Responding" is now in the dropdown

The filter existed but was purely computed (open + untouched 14 days), so there
was no way to say *"this one has gone quiet"* by hand. It is now a real stage,
in the same orange as the chip, and it appears everywhere a stage appears: the
lead drawer dropdown, the Add Lead dialog, the right-click stage menu on a row,
and My Queue.

The orange **Not Responding** chip now counts **both**: the ones you marked and
the ones the 14-day rule found. Nobody is counted twice, and there is still
only one chip — marking a lead is a shortcut, never a requirement.

⚠️ **One consequence worth knowing:** moving a lead from Cold or Hot into Not
Responding takes them out of that stage, so their WhatsApp follow-up sequence
**stops** (recorded as `stage_changed`). That is usually what you want — you
are saying stop chasing this one. Move them back to Cold and the next sweep
re-enrols them.

---

## Test it

1. **Supabase → SQL Editor → run 057.** The verification query at the bottom
   prints your booking profile — confirm `slot_step_minutes = 30` and
   `buffer_minutes = 0`.
2. Upload the 7 code files, redeploy.
3. Open your public booking page → the times should now read 10:00, 10:30,
   11:00, 11:30 …
4. Book a 2:00pm slot from an incognito window → reload the page → **2:30pm is
   still offered**, and 2:00pm is gone.
5. Leads → open any lead → Stage dropdown → **Not Responding** is there, in
   orange. Pick it, then click the orange chip — that lead is in the list.
