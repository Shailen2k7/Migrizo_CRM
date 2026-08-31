// =============================================================================
// SLOT ENGINE — timezone-correct availability computation.
// Works entirely with Intl (no date libs): converts a member's local working
// hours to UTC instants, subtracts existing meetings + buffer, returns slots.
// =============================================================================

export interface WorkingHours { [day: string]: [string, string][]; } // mon..sun -> [["10:00","18:00"]]

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The UTC offset (minutes) of `tz` at the given UTC instant. */
function tzOffsetMin(tz: string, at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === '24' ? 0 : p.hour), +p.minute, +p.second);
  return (asUtc - at.getTime()) / 60000;
}

/** UTC instant for wall-clock `y-m-d hh:mm` in timezone `tz`. */
export function zonedToUtc(tz: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = tzOffsetMin(tz, guess);
  const adjusted = new Date(guess.getTime() - off * 60000);
  // second pass handles DST boundaries
  const off2 = tzOffsetMin(tz, adjusted);
  return off2 === off ? adjusted : new Date(guess.getTime() - off2 * 60000);
}

/** 'YYYY-MM-DD' of a UTC instant, as seen from timezone `tz`. */
export function localDateKey(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** Day-of-week key ('mon'…) of a UTC instant, seen from timezone `tz`. */
function dayKeyIn(tz: string, at: Date): string {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at).toLowerCase().slice(0, 3);
  return DAY_KEYS.includes(wd) ? wd : 'mon';
}

export interface SlotQuery {
  tz: string;                       // member timezone
  workingHours: WorkingHours;
  slotMinutes: number;              // how long the CALL runs
  /**
   * How often a slot is OFFERED. Separate from slotMinutes on purpose: the grid
   * used to step by the call's duration, so changing a call to 60 minutes
   * silently turned an every-30-minutes page into an hourly one. With
   * stepMinutes the two decisions are independent — 30/30 gives back-to-back
   * half-hour calls, 30/60 offers a slot every half hour for an hour-long call.
   * Falls back to slotMinutes so old callers behave exactly as before.
   */
  stepMinutes?: number;
  bufferMinutes: number;
  fromUtc: Date;                    // range start (inclusive)
  toUtc: Date;                      // range end (exclusive)
  busy: { start: Date; end: Date }[]; // existing meetings (UTC)
  minNoticeMinutes?: number;        // default 60 — nobody can book 5 minutes ahead
  /**
   * One-off exceptions, keyed by local date 'YYYY-MM-DD' in the member's own
   * timezone. An entry REPLACES that day's weekly windows entirely:
   *   []                      → day off (holiday, flight, conference)
   *   [["14:00","18:00"]]     → different hours, this date only
   * Absent key → the weekly pattern applies as normal.
   */
  dateOverrides?: Record<string, [string, string][]>;
  /**
   * Most meetings to offer on any one day, counting what is already booked.
   * Six discovery calls in a day is not a working day. Undefined = no cap.
   */
  dailyCap?: number;
}

/** All free slot start times (UTC) inside the range. */
export function computeSlots(q: SlotQuery): Date[] {
  const out: Date[] = [];
  // A zero or negative step would spin this loop forever, so it is clamped
  // here as well as in the database — a bad row must never hang the page.
  const step = Math.max(5, Math.min(240, q.stepMinutes || q.slotMinutes));
  const minStart = new Date(Date.now() + (q.minNoticeMinutes ?? 60) * 60000);
  const buffered = q.busy.map((b) => ({
    start: new Date(b.start.getTime() - q.bufferMinutes * 60000),
    end: new Date(b.end.getTime() + q.bufferMinutes * 60000),
  }));

  // How many meetings are already booked on each local day — so the cap counts
  // what exists, not only what this run adds.
  const bookedPerDay = new Map<string, number>();
  if (q.dailyCap) {
    for (const b of q.busy) {
      const k = localDateKey(q.tz, b.start);
      bookedPerDay.set(k, (bookedPerDay.get(k) || 0) + 1);
    }
  }

  // Walk each calendar day of the range, in the MEMBER's timezone.
  const cursor = new Date(q.fromUtc);
  for (let guard = 0; guard < 200 && cursor < q.toUtc; guard++) {
    const dateKey = localDateKey(q.tz, cursor);
    const [y, m, d] = dateKey.split('-').map(Number);

    // A date override REPLACES the weekly pattern for this one day, including
    // replacing it with nothing at all.
    const override = q.dateOverrides ? q.dateOverrides[dateKey] : undefined;
    const windows = override !== undefined
      ? override
      : (q.workingHours[dayKeyIn(q.tz, cursor)] || []);

    // Daily cap: how many more may be offered on this date.
    let remaining = q.dailyCap
      ? Math.max(0, q.dailyCap - (bookedPerDay.get(dateKey) || 0))
      : Number.POSITIVE_INFINITY;

    for (const [open, close] of windows) {
      if (remaining <= 0) break;
      const [oh, om] = open.split(':').map(Number);
      const [ch, cm] = close.split(':').map(Number);
      let t = zonedToUtc(q.tz, y, m, d, oh, om);
      const end = zonedToUtc(q.tz, y, m, d, ch, cm);
      while (t.getTime() + q.slotMinutes * 60000 <= end.getTime()) {
        const slotEnd = new Date(t.getTime() + q.slotMinutes * 60000);
        const clash = buffered.some((b) => t < b.end && slotEnd > b.start);
        if (!clash && t >= minStart && t >= q.fromUtc && t < q.toUtc) {
          out.push(new Date(t));
          remaining -= 1;
          if (remaining <= 0) break;
        }
        t = new Date(t.getTime() + step * 60000);
      }
    }
    // advance one day (member-tz midnight ≈ +24h; Intl re-derives the day key)
    cursor.setTime(cursor.getTime() + 24 * 3600 * 1000);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** "Add to Google Calendar" URL — needs no OAuth, works for any attendee. */
export function googleCalendarUrl(opts: { title: string; start: Date; end: Date; details: string; location?: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: opts.title,
    dates: `${fmt(opts.start)}/${fmt(opts.end)}`,
    details: opts.details, location: opts.location || '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
