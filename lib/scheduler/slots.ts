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

/** Day-of-week key ('mon'…) of a UTC instant, seen from timezone `tz`. */
function dayKeyIn(tz: string, at: Date): string {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at).toLowerCase().slice(0, 3);
  return DAY_KEYS.includes(wd) ? wd : 'mon';
}

export interface SlotQuery {
  tz: string;                       // member timezone
  workingHours: WorkingHours;
  slotMinutes: number;
  bufferMinutes: number;
  fromUtc: Date;                    // range start (inclusive)
  toUtc: Date;                      // range end (exclusive)
  busy: { start: Date; end: Date }[]; // existing meetings (UTC)
  minNoticeMinutes?: number;        // default 60 — nobody can book 5 minutes ahead
}

/** All free slot start times (UTC) inside the range. */
export function computeSlots(q: SlotQuery): Date[] {
  const out: Date[] = [];
  const minStart = new Date(Date.now() + (q.minNoticeMinutes ?? 60) * 60000);
  const buffered = q.busy.map((b) => ({
    start: new Date(b.start.getTime() - q.bufferMinutes * 60000),
    end: new Date(b.end.getTime() + q.bufferMinutes * 60000),
  }));

  // Walk each calendar day of the range, in the MEMBER's timezone.
  const cursor = new Date(q.fromUtc);
  for (let guard = 0; guard < 62 && cursor < q.toUtc; guard++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: q.tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(cursor).split('-').map(Number);
    const [y, m, d] = parts;
    const windows = q.workingHours[dayKeyIn(q.tz, cursor)] || [];
    for (const [open, close] of windows) {
      const [oh, om] = open.split(':').map(Number);
      const [ch, cm] = close.split(':').map(Number);
      let t = zonedToUtc(q.tz, y, m, d, oh, om);
      const end = zonedToUtc(q.tz, y, m, d, ch, cm);
      while (t.getTime() + q.slotMinutes * 60000 <= end.getTime()) {
        const slotEnd = new Date(t.getTime() + q.slotMinutes * 60000);
        const clash = buffered.some((b) => t < b.end && slotEnd > b.start);
        if (!clash && t >= minStart && t >= q.fromUtc && t < q.toUtc) out.push(new Date(t));
        t = new Date(t.getTime() + q.slotMinutes * 60000);
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
