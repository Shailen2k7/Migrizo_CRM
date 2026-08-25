'use client';

// ============================================================================
// LEADS DASHBOARD — the approved design: six stat cards, the year-by-month
// strip, and the funnel with the biggest-leak callout, one panel each.
//
// Everything is computed CLIENT-SIDE from the leads the provider already
// holds (all of them — range 0..9999), so this adds zero queries: the page
// renders its dashboard from data it was going to load anyway.
//
// Clicking a card filters the leads table BELOW to exactly the leads that card
// counts — same period, same definition — via a Set of ids. One list, not a
// second weaker copy of the table.
// ============================================================================

import { useMemo, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { Select } from '@/components/shared/select';
import { StatCard, MonthStrip, Funnel, PanelTitle } from '@/components/shared/dash-ui';
import {
  buildPeriods, primaryOptions, compareOptions, resolveCompare,
  inPeriod, pctOf, fmtPct, deltaOf, countDelta, type Period,
} from '@/lib/dashboard';
import type { Lead } from '@/lib/types';

export interface DashFilter { label: string; ids: Set<string> }

/** The one funnel definition both the cards and the chart read. */
function cohortOf(leads: Lead[], p: Period) {
  const created = leads.filter((l) => inPeriod(l.created_at, p));
  const responded = created.filter((l) => !!l.first_response_at);
  const profiled = responded.filter((l) => !!l.profile_received);
  const reviewed = created.filter((l) => !!l.eligibility);
  const eligible = created.filter((l) => l.eligibility === 'eligible');
  const hot = eligible.filter((l) => l.stage === 'hot');
  return { created, responded, profiled, reviewed, eligible, hot };
}

export function LeadsDashboard({ onFilter, activeFilter }: {
  onFilter: (f: DashFilter | null) => void;
  activeFilter: DashFilter | null;
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

  const real = useMemo(() => leads.filter((l) => !l.is_sample), [leads]);
  const cur = useMemo(() => cohortOf(real, period), [real, period]);
  const cmp = useMemo(() => (compare ? cohortOf(real, compare) : null), [real, compare]);

  // Has anyone started recording the new fields? Until then the dependent
  // cards say so plainly instead of showing a fake 0%.
  const recording = useMemo(() => real.some((l) => l.eligibility || l.profile_received), [real]);

  const rate = (c: ReturnType<typeof cohortOf>) => ({
    resp: pctOf(c.responded.length, c.created.length),
    prof: pctOf(c.profiled.length, c.responded.length),
    elig: pctOf(c.eligible.length, c.reviewed.length),
    hot:  pctOf(c.hot.length, c.eligible.length),
    nel:  pctOf(c.reviewed.length - c.eligible.length, c.reviewed.length),
  });
  const v = rate(cur);
  const p = cmp ? rate(cmp) : null;

  const monthItems = useMemo(() => {
    const out: { key: string; label: string; value: number }[] = [];
    for (let m = 0; m <= now.getMonth(); m++) {
      const mp = periods.get(`m${m}`)!;
      out.push({ key: mp.key, label: mp.short, value: real.filter((l) => inPeriod(l.created_at, mp)).length });
    }
    return out;
  }, [periods, real, now]);

  const pick = (label: string, list: Lead[]) => {
    const f: DashFilter = { label, ids: new Set(list.map((l) => l.id)) };
    // Clicking the active card again clears the filter — a toggle, not a trap.
    onFilter(activeFilter?.label === label ? null : f);
  };
  const nel = cur.reviewed.filter((l) => l.eligibility === 'not_eligible');
  const notReplied = cur.created.filter((l) => !l.first_response_at);
  const awaitingProfile = cur.responded.filter((l) => !l.profile_received);

  const funnelSteps = recording
    ? [
        { label: 'All leads',  value: cur.created.length },
        { label: 'Responded',  value: cur.responded.length },
        { label: 'Profile in', value: cur.profiled.length },
        { label: 'Reviewed',   value: cur.reviewed.length },
        { label: 'Eligible',   value: cur.eligible.length },
        { label: 'Hot',        value: cur.hot.length },
      ]
    : [
        { label: 'All leads', value: cur.created.length },
        { label: 'Responded', value: cur.responded.length },
        { label: 'Hot',       value: cur.created.filter((l) => l.stage === 'hot').length },
      ];

  const notYet = 'field not in use yet';

  return (
    <div className="mb-5 animate-pageIn">
      {/* period + comparison selectors */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12.5px] text-muted">
          <b className="text-ink">{cur.created.length}</b> leads created · <b className="text-ink-2">{period.label}</b>
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

      {/* the six cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total leads" value={String(cur.created.length)}
          foot={cmp && compare ? `${cmp.created.length} in ${compare.short}` : 'no comparison'}
          delta={countDelta(cur.created.length, cmp ? cmp.created.length : null)}
          accent="#16294E" active={activeFilter?.label === 'All leads in period'}
          onClick={() => pick('All leads in period', cur.created)} />
        <StatCard label="Response" value={fmtPct(v.resp)}
          foot={`${cur.responded.length} of ${cur.created.length} replied`}
          delta={deltaOf(v.resp, p?.resp)} accent="#4F46E5"
          active={activeFilter?.label === 'Never replied'}
          onClick={() => pick('Never replied', notReplied)} />
        <StatCard label="Profile submission" value={recording ? fmtPct(v.prof) : '—'}
          foot={recording ? `${cur.profiled.length} of ${cur.responded.length} responded` : notYet}
          delta={recording ? deltaOf(v.prof, p?.prof) : deltaOf(null, null)} accent="#7C3AED"
          active={activeFilter?.label === 'Awaiting profile'}
          onClick={() => pick('Awaiting profile', awaitingProfile)} />
        <StatCard label="Eligibility" value={recording ? fmtPct(v.elig) : '—'}
          foot={recording ? `${cur.eligible.length} of ${cur.reviewed.length} reviewed` : notYet}
          delta={recording ? deltaOf(v.elig, p?.elig) : deltaOf(null, null)} accent="#047857"
          active={activeFilter?.label === 'Eligible'}
          onClick={() => pick('Eligible', cur.eligible)} />
        <StatCard label="HOT" value={recording ? fmtPct(v.hot) : '—'}
          foot={recording ? `${cur.hot.length} of ${cur.eligible.length} eligible` : 'needs eligibility'}
          delta={recording ? deltaOf(v.hot, p?.hot) : deltaOf(null, null)} accent="#EF4444"
          active={activeFilter?.label === 'Hot leads'}
          onClick={() => pick('Hot leads', recording ? cur.hot : cur.created.filter((l) => l.stage === 'hot'))} />
        <StatCard label="Non-eligible" value={recording ? fmtPct(v.nel) : '—'}
          foot={recording ? `${nel.length} of ${cur.reviewed.length} reviewed` : notYet}
          delta={recording ? deltaOf(v.nel, p?.nel, true) : deltaOf(null, null)} accent="#B45309"
          active={activeFilter?.label === 'Not eligible'}
          onClick={() => pick('Not eligible', nel)} />
      </div>

      {/* Lead flow: the year strip and the funnel share one panel — they are
          the same story at two zoom levels, so they live together. */}
      <div className="panel p-5">
        <PanelTitle sub={period.grain === 'month'
          ? 'Click any month to compare against it · hover a funnel bar for the exact drop'
          : 'Select a month above to compare month-to-month'}>
          Lead flow — {now.getFullYear()} by month, then the funnel for {period.short}
        </PanelTitle>
        <MonthStrip items={monthItems} currentKey={period.grain === 'month' ? period.key : null}
          compareKey={compare && compare.grain === 'month' ? compare.key : null}
          enabled={period.grain === 'month'}
          onPick={(k) => setCmpKey(k)} />
        <div className="my-4 border-t border-border" />
        <Funnel steps={funnelSteps} leakNoun="leads" />
        {!recording && (
          <div className="mt-3 text-[11.5px] text-muted">
            Profile and eligibility are not being recorded yet — set them in the lead drawer (under Stage) and this funnel gains its Profile, Reviewed and Eligible stages automatically.
          </div>
        )}
      </div>
    </div>
  );
}
