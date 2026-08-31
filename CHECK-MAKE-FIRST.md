# Check this before anything else — 30 seconds

Your newest lead is **11:52 AM**. Not a trickle — a **hard stop**.

A dedupe problem, a timezone problem or a filter problem would all still let
leads through, just fewer or in the wrong bucket. Something stopping dead at a
specific minute is a switch being flipped, and there are only three switches.

## 1. Is the Make scenario still ON?

Make.com → your scenario → the **Active** toggle, top right.

Make **auto-deactivates a scenario after consecutive errors.** If the toggle is
grey, that is your answer and nothing in the CRM is broken.

## 2. Have you run out of Make operations?

Make.com → **Organisation → Usage**.

Each lead costs your scenario **3 operations** (New Lead → Get Lead Details →
HTTP). At 30 leads a day that is 90 operations a day, ~2,700 a month.

The Core plan is 10,000/month. The free plan is 1,000 — which 30 leads a day
burns through in **11 days**. When the quota is hit the scenario stops silently,
mid-day, exactly like this.

This is my strongest suspicion.

## 3. Did Make error at 11:52?

Make.com → your scenario → **HISTORY** → look at the run around 11:52 AM, and
whether any run exists after it.

- Runs after 11:52 with errors → open one and send me the error
- **No runs after 11:52 at all** → Meta stopped sending, or the scenario is off

---

Whatever it turns out to be, send me a screenshot of the Active toggle and the
Usage page. That ends this today.
