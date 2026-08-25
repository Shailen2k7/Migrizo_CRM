'use client';

// ============================================================================
// MEETINGS DASHBOARD — six cards, the year-by-month strip, the outcome funnel,
// and a "Needs attention" list, in the approved design.
//
// TWO COHORTS, EACH CARD SAYS WHICH IT USES
//   * "Scheduled" and "Call booking %" count bookings MADE in the period
//     (created_at) — the momentum metrics, the ones that move when a campaign
//     works.
//   * Show / No-show / Cancellation / Recovery count calls DUE in the period
//     (starts_at) — outcome metrics. A call booked Monday for next month is
//     momentum today but cannot be a no-show yet, so it must not sit in the
//     no-show denominator. Calls still upcoming are excluded from outcome
//     denominators for the same reason: they have no outcome yet.
// ============================================================================

import { useMemo, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { Select } from '@/components/shared/select';
import { StatCard, MonthStrip, PanelTitle } from '@/components/shared/dash-ui';
import {
  buildPeriods, primaryOptions, compareOptions, resolveCompare,
  inPeriod, pctOf, fmtPct, deltaOf, countDelta, type Period,
} from '@/lib/dashboard';
import { AlertTriangle } from 'lucide-react';

export interface DashMeeting {
  id: string; lead_id: string | null; client_name: string;
  starts_at: string; status: string; created_at: string; member_id: string;
}
export interface ReschedEvent { meeting_id: string; created_at: string }
export interface MeetFilter { label: string; ids: Set<string> }

function statsFor(meetings: DashMeeting[], resched: ReschedEvent[], p: Period) {
  const booked = meetings.filter((m) => inPeriod(m.created_at, p));
  const due = meetings.filter((m) => inPeriod(m.starts_at, p));
  const done = due.filter((m) => m.status === 'completed');
  const ns = due.filter((m) => m.status === 'no_show');
  const can = due.filter((m) => m.status === 'cancelled');
  const stillUpcoming = due.filter((m) => m.status === 'upcoming');
  const resolved = due.length - stillUpcoming.length;
  const rebooked = resched.filter((e) => inPeriod(e.created_at, p)).length;
  return { booked, due, done, ns, can, stillUpcoming, resolved, rebooked };
}

export function MeetingsDashboard({ meetings, resched, onFilter, activeFilter }: {
  meetings: DashMeeting[];
  resched: ReschedEvent[];
  onFilter: (f: MeetFilter | null) => void;
  activeFilter: MeetFilter | null;
}) {
  const { leads } = useApp();
  const now = useMemo(() => new Date(), []);
  const periods = useMemo(() => buildPeriods(now), [now]);
  const [periodKey, setPeriodKey] = useState(`m${now.getMonth()}`);
  const [cmpKey, setCmpKey] = useState('prev');

  const period = periods.get(periodKey)!;
  const cmpOpts = useMemo(() => compareOptions(periods, periodKey), [periods, periodKey]);
  const effCmp = cmpOpts.includes(cmpKey) ? cmpKey : 'prev';
  const compare = resolveCompare(periods, periodKey, effCmp);

  const cur = useMemo(() => statsFor(meetings, resched, period), [meetings, resched, period]);
  const cmp = useMemo(() => (compare ? statsFor(meetings, resched, compare) : null), [meetings, resched, compare]);

  const realLeads = useMemo(() => leads.filter((l) => !l.is_sample), [leads]);
  const eligNow = useMemo(() => realLeads.filter((l) => l.eligibility === 'eligible' && inPeriod(l.created_at, period)).length, [realLeads, period]);
  const eligCmp = useMemo(() => (compare ? realLeads.filter((l) => l.eligibility === 'eligible' && inPeriod(l.created_at, compare)).length : 0), [realLeads, compare]);

  const rates = (s: ReturnType<typeof statsFor>, elig: number) => ({
    book: pctOf(s.booked.length, elig),
    show: pctOf(s.done.length, s.resolved),
    ns:   pctOf(s.ns.length, s.resolved),
    can:  pctOf(s.can.length, s.resolved),
    rec:  pctOf(s.rebooked, s.ns.length + s.can.length),
  });
  const v = rates(cur, eligNow);
  const p = cmp ? rates(cmp, eligCmp) : null;

  // Each month bar is STACKED by what happened to the calls booked that month
  // — completed, no-show, cancelled, still upcoming. Same footprint as a flat
  // bar, but you can see at a glance whether no-shows are creeping up.
  const STRIP_LEGEND = [
    { label: 'Completed', color: '#3E9C6B', value: 0 },
    { label: 'No-show',   color: '#EF4444', value: 0 },
    { label: 'Cancelled', color: '#B7BAC3', value: 0 },
    { label: 'Upcoming',  color: '#A5B4FC', value: 0 },
  ];
  const monthItems = useMemo(() => {
    const out: { key: string; label: string; value: number; segments: { value: number; color: string; label: string }[] }[] = [];
    for (let m = 0; m <= now.getMonth(); m++) {
      const mp = periods.get(`m${m}`)!;
      const booked = meetings.filter((x) => inPeriod(x.created_at, mp));
      out.push({
        key: mp.key, label: mp.short, value: booked.length,
        segments: [
          { label: 'Completed', color: '#3E9C6B', value: booked.filter((x) => x.status === 'completed').length },
          { label: 'No-show',   color: '#EF4444', value: booked.filter((x) => x.status === 'no_show').length },
          { label: 'Cancelled', color: '#B7BAC3', value: booked.filter((x) => x.status === 'cancelled').length },
          { label: 'Upcoming',  color: '#A5B4FC', value: booked.filter((x) => x.status === 'upcoming').length },
        ],
      });
    }
    return out;
  }, [periods, meetings, now]);

  // ── Where calls get lost: no-show rate by weekday + 2-hour slot ──────────
  // Last 90 days of RESOLVED calls, and a slot only qualifies with 4+ calls —
  // one ghosted Friday is an anecdote, six is a pattern worth closing the
  // slot over. This is the panel's only judgment call, and it is directly
  // actionable in Booking settings.
  const lostSlots = useMemo(() => {
    const cutoff = Date.now() - 90 * 86_400_000;
    const buckets = new Map<string, { label: string; ns: number; total: number }>();
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
    meetings.forEach((m) => {
      if (m.status !== 'completed' && m.status !== 'no_show' && m.status !== 'cancelled') return;
      const d = new Date(m.starts_at);
      if (d.getTime() < cutoff) return;
      const band = Math.floor(d.getHours() / 2) * 2;
      const key = `${d.getDay()}-${band}`;
      const b = buckets.get(key) ?? { label: `${DAYS[d.getDay()]} · ${hour12(band)}–${hour12(band + 2)}`, ns: 0, total: 0 };
      b.total += 1;
      if (m.status === 'no_show') b.ns += 1;
      buckets.set(key, b);
    });
    return [...buckets.values()]
      .filter((b) => b.total >= 4 && b.ns > 0)
      .map((b) => ({ ...b, rate: (b.ns / b.total) * 100 }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3);
  }, [meetings]);

  const pick = (label: string, list: DashMeeting[]) => {
    const f: MeetFilter = { label, ids: new Set(list.map((m) => m.id)) };
    onFilter(activeFilter?.label === label ? null : f);
  };

  // ── Needs attention: the daily action list ────────────────────────────────
  // Dropped calls (last 30 days by start time) with no reschedule logged
  // after they dropped, plus eligible leads that have never had a call booked.
  const attention = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    const reschedAfter = new Map<string, number>();
    resched.forEach((e) => {
      const t = new Date(e.created_at).getTime();
      reschedAfter.set(e.meeting_id, Math.max(reschedAfter.get(e.meeting_id) ?? 0, t));
    });
    const dropped = meetings.filter((m) => {
      if (m.status !== 'no_show' && m.status !== 'cancelled') return false;
      const start = new Date(m.starts_at).getTime();
      if (start < cutoff) return false;
      const re = reschedAfter.get(m.id);
      return !(re && re > start);          // rescheduled after it dropped = handled
    }).sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

    const withCall = new Set(meetings.map((m) => m.lead_id).filter(Boolean) as string[]);
    const noCall = realLeads.filter((l) =>
      l.eligibility === 'eligible' && !withCall.has(l.id) && l.stage !== 'won' && l.stage !== 'junk');
    return { dropped, noCall };
  }, [meetings, resched, realLeads]);

  return (
    <div className="mb-6 animate-pageIn">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12.5px] text-muted">
          <b className="text-ink">{cur.booked.length}</b> calls booked · <b className="text-ink">{cur.done.length}</b> completed
          {cur.stillUpcoming.length > 0 && <> · {cur.stillUpcoming.length} still upcoming</>}
          {' · '}<b className="text-ink-2">{period.label}</b>
          {compare && <> · compared with <b className="text-ink-2">{compare.label}</b></>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-faint">Period</span>
          <div className="w-[168px]">
            <Select<string> size="sm" value={periodKey} onChange={setPeriodKey}
              options={primaryOptions(periods, now).map((k) => ({ value: k, label: periods.get(k)!.label }))} />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-faint">compare with</span>
          <div className="w-[168px]">
            <Select<string> size="sm" value={effCmp} onChange={setCmpKey}
              options={cmpOpts.map((k) => ({ value: k, label: k === 'prev' ? 'Previous period' : periods.get(k)!.label }))} />
          </div>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Scheduled" value={String(cur.booked.length)}
          foot={cmp && compare ? `${cmp.booked.length} booked in ${compare.short}` : 'bookings made this period'}
          delta={countDelta(cur.booked.length, cmp ? cmp.booked.length : null)}
          accent="#16294E" active={activeFilter?.label === 'Booked in period'}
          onClick={() => pick('Booked in period', cur.booked)} />
        <StatCard label="Call booking" value={eligNow > 0 ? fmtPct(v.book) : '—'}
          foot={eligNow > 0 ? `${cur.booked.length} of ${eligNow} eligible leads` : 'needs eligibility on leads'}
          delta={eligNow > 0 ? deltaOf(v.book, p?.book) : deltaOf(null, null)} accent="#4F46E5"
          active={activeFilter?.label === 'Booked in period'}
          onClick={() => pick('Booked in period', cur.booked)} />
        <StatCard label="Show rate" value={fmtPct(v.show)}
          foot={`${cur.done.length} of ${cur.resolved} held`}
          delta={deltaOf(v.show, p?.show)} accent="#047857"
          active={activeFilter?.label === 'Completed'}
          onClick={() => pick('Completed', cur.done)} />
        <StatCard label="No-show" value={fmtPct(v.ns)}
          foot={`${cur.ns.length} of ${cur.resolved} held`}
          delta={deltaOf(v.ns, p?.ns, true)} accent="#EF4444"
          active={activeFilter?.label === 'No-shows'}
          onClick={() => pick('No-shows', cur.ns)} />
        <StatCard label="Cancellation" value={fmtPct(v.can)}
          foot={`${cur.can.length} of ${cur.resolved} held`}
          delta={deltaOf(v.can, p?.can, true)} accent="#B45309"
          active={activeFilter?.label === 'Cancelled'}
          onClick={() => pick('Cancelled', cur.can)} />
        <StatCard label="Recovery" value={fmtPct(v.rec)}
          foot={`${cur.rebooked} of ${cur.ns.length + cur.can.length} dropped rebooked`}
          delta={deltaOf(v.rec, p?.rec)} accent="#7C3AED"
          active={activeFilter?.label === 'Dropped, not rebooked'}
          onClick={() => pick('Dropped, not rebooked', [...cur.ns, ...cur.can])} />
      </div>

      {/* Call flow is FULL width: it used to sit beside Needs attention in a
          grid, and equal-height grid columns stretched it with dead air while
          squeezing the months until August scrolled out of view. Full width
          gives every month room; Needs attention gets its own row below. */}
      <div className="panel mb-4 min-w-0 p-5">
        <div className="grid gap-6 lg:grid-cols-2 lg:divide-x lg:divide-border">
          {/* flex column so the strip can stretch to the height the right
              column sets — the chart always fills its card. */}
          <div className="flex min-w-0 flex-col">
            <PanelTitle sub={period.grain === 'month'
              ? 'Each bar shows what happened to that month\u2019s bookings \u00b7 click one to compare'
              : 'Select a month above to compare month-to-month'}>
              {now.getFullYear()} by month — calls booked
            </PanelTitle>
            <div className="min-h-0 flex-1">
              <MonthStrip items={monthItems} currentKey={period.grain === 'month' ? period.key : null}
                compareKey={compare && compare.grain === 'month' ? compare.key : null}
                enabled={period.grain === 'month'}
                onPick={(k) => setCmpKey(k)}
                legend={STRIP_LEGEND} />
            </div>
          </div>
          <div className="min-w-0 lg:pl-6">
            <PanelTitle sub="Percentages are shares of the calls resolved this period.">
              Outcomes — {period.short}
            </PanelTitle>
            {cur.due.length === 0 ? (
              <div className="py-6 text-center text-[12.5px] text-muted">No calls due in this period.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  { label: 'Completed', n: cur.done.length,  fg: '#047857', bg: '#E6F7EE' },
                  { label: 'No-show',   n: cur.ns.length,    fg: '#B91C1C', bg: '#FDECEC' },
                  { label: 'Cancelled', n: cur.can.length,   fg: '#6B7280', bg: '#F3F4F6' },
                  { label: 'Rebooked',  n: cur.rebooked,     fg: '#6D28D9', bg: '#F1ECFE' },
                ].map((o) => (
                  <div key={o.label} className="rounded-xl border border-border p-3">
                    <div className="num text-[20px] font-extrabold leading-none" style={{ color: o.fg }}>{o.n}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-muted">{o.label}</span>
                      <span className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold" style={{ background: o.bg, color: o.fg }}>
                        {o.label === 'Rebooked'
                          ? fmtPct(pctOf(o.n, cur.ns.length + cur.can.length))
                          : fmtPct(pctOf(o.n, cur.resolved))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Where calls get lost — the actionable half of the outcomes.
                A slot with a bad no-show rate is something you can close in
                Booking settings this afternoon. */}
            <div className="mt-4">
              <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[0.07em] text-muted">
                Where calls get lost <span className="font-bold text-faint normal-case tracking-normal">\u00b7 last 90 days, slots with 4+ calls</span>
              </div>
              {lostSlots.length === 0 ? (
                <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
                  No slot stands out yet — no time of the week is getting ghosted more than the rest.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {lostSlots.map((sl) => (
                    <div key={sl.label} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{sl.label}</span>
                      <span className="num text-[11px] text-muted">{sl.ns} of {sl.total}</span>
                      <span className="num rounded-md bg-[#FDECEC] px-2 py-0.5 text-[11px] font-extrabold text-[#B91C1C]">
                        {sl.rate.toFixed(0)}% no-show
                      </span>
                    </div>
                  ))}
                  <div className="pt-0.5 text-[10.5px] text-faint">Consider closing or moving these slots in Booking settings.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Needs attention — full-width row, cards flowing across instead of a
          tall skinny column. Every card is an action for today. */}
      <div className="panel min-w-0 p-5">
        <PanelTitle sub="Every card here is an action for today, not a statistic.">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-[#B45309]" /> Needs attention
          </span>
        </PanelTitle>
        {attention.dropped.length === 0 && attention.noCall.length === 0 ? (
          <div className="py-4 text-center text-[12.5px] text-muted">Nothing waiting — every dropped call is handled and every eligible lead has a call booked.</div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {attention.noCall.length > 0 && (
              <div className="rounded-xl border border-[#F3D9A4] bg-[#FEF6E7] px-3.5 py-2.5">
                <div className="text-[13px] font-bold text-[#854F0B]">
                  {attention.noCall.length} eligible lead{attention.noCall.length === 1 ? '' : 's'} \u00b7 no call booked
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[#A16207]">
                  {attention.noCall.slice(0, 3).map((l) => l.full_name).join(' \u00b7 ')}
                  {attention.noCall.length > 3 ? ' \u2026' : ''}
                </div>
                <div className="mt-1 text-[10.5px] text-[#A16207]/80">They said yes and nobody booked the call.</div>
              </div>
            )}
            {attention.dropped.slice(0, 7).map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-border px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">{m.client_name}</div>
                  <div className="text-[11px] text-muted">
                    {new Date(m.starts_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} \u00b7 not rebooked yet
                  </div>
                </div>
                <span className="chip whitespace-nowrap"
                  style={m.status === 'no_show'
                    ? { background: '#FDECEC', color: '#B91C1C', border: 'none' }
                    : { background: '#F3F4F6', color: '#6B7280', border: 'none' }}>
                  {m.status === 'no_show' ? 'No show' : 'Cancelled'}
                </span>
              </div>
            ))}
            {attention.dropped.length > 7 && (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-border px-3.5 py-2.5 text-[12px] font-semibold text-muted">
                + {attention.dropped.length - 7} more in the last 30 days
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
