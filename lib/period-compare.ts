// =============================================================================
// LIKE-FOR-LIKE COMPARISON
// -----------------------------------------------------------------------------
// A period that is still running (this month, this week…) must not be compared
// with the WHOLE of the previous one: on 1 October, "18 leads vs 917 in
// September" reads as −98% when the honest comparison is 1 Oct vs 1 Sep.
//
// So while the selected period is in progress, the comparison period is cut to
// the same elapsed time from its own start — and its label says so. Finished
// periods are compared whole, exactly as before.
// =============================================================================

import type { Period } from './dashboard';

export function likeForLike(period: Period, compare: Period | null, now: Date): Period | null {
  if (!compare) return null;
  const t = now.getTime();
  const running = t >= period.from.getTime() && t < period.to.getTime();
  if (!running) return compare;

  const elapsed = t - period.from.getTime();
  const to = new Date(Math.min(compare.from.getTime() + elapsed, compare.to.getTime()));
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const lastDay = new Date(to.getTime() - 1);
  const span = compare.from.toDateString() === lastDay.toDateString()
    ? fmt(compare.from)
    : `${fmt(compare.from)}–${fmt(lastDay)}`;
  return { ...compare, to, label: `${span} (same days)`, short: span };
}
