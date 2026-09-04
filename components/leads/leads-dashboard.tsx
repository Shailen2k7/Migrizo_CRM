'use client';

// ============================================================================
// LEADS DASHBOARD — six cards, the year-by-month strip, and the funnel.
//
// Everything is computed CLIENT-SIDE from the leads the provider already
// holds (all of them — range 0..9999), so this adds zero queries: the page
// renders its dashboard from data it was going to load anyway.
//
// Clicking a card filters the leads table BELOW to exactly the leads that card
// counts — same period, same definition — via a Set of ids. One list, not a
// second weaker copy of the table.
//
// WHY COUNTS, NOT RATES
// These six are answered in a Monday review by pointing at a number and saying
// it out loud: "sixty-two leads, nine hot, four eligible". A percentage makes
// you do the arithmetic backwards to get there. So the headline is the count
// and the share sits underneath it, where it supports the number instead of
// replacing it.
// ============================================================================

import { useMemo, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { Select } from '@/components/shared/select';
import { StatCard, MonthStrip, Funnel, PanelTitle, CollapsiblePanel } from '@/components/shared/dash-ui';
import {
  buildPeriods, primaryOptions, compareOptions, resolveCompare,
  inPeriod, pctOf, fmtPct, countDelta, type Period,
} from '@/lib/dashboard';
import type { Lead } from '@/lib/types';

export interface DashFilter { label: string; ids: Set<string> }

/**
 * The one cohort definition every card and the funnel read.
 *
 * Everything is cohorted by created_at: "of the leads that arrived in this
 * period, how many are hot / cold / starred / eligible". That keeps all six
 * cards answering the same question about the same set of people, so they can
 * be read across without a mental gear change.
 */
function cohortOf(leads: Lead[], p: Period) {
  const created = leads.filter((l) => inPeriod(l.created_at, p));
  return {
    created,
    hot: created.filter((l) => l.stage === 'hot'),
    cold: created.filter((l) => l.stage === 'cold'),
    spotlight: created.filter((l) => l.is_spotlight),
    workable: created.filter((l) => l.stage !== 'junk'),
    reviewed: created.filter((l) => !!l.eligibility),
    eligible: created.filter((l) => l.eligibility === 'eligible'),
    notEligible: created.filter((l) => l.eligibility === 'not_eligible'),
    won: created.filter((l) => l.stage === 'won'),
  };
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

  // Starring is a live working set, not a property of a month's intake. The
  // card still counts this period's leads so it reads across with the other
  // five, but the foot carries the number people actually act on.
  const spotlightAll = useMemo(() => real.filter((l) => l.is_spotlight).length, [real]);

  /**
   * ELIGIBILITY IS A STANDING LEDGER, NOT A PERIOD COHORT — and that is a
   * decision forced by the data, not a preference.
   *
   * Nearly every verdict on record was written by migration 074's backfill,
   * which derived it from the lead's stage and stamped eligibility_at with the
   * moment the migration ran. So cohorting by verdict date would drop ~968
   * decisions into one artificial spike, and cohorting by lead-creation date
   * reports almost nothing, because a lead created this month is usually
   * reviewed later.
   *
   * Either way a per-period eligibility number would be fiction. The honest
   * figure is the running total, so that is what these two cards show, and
   * their foot says "all leads" so nobody reads them as period numbers.
   * Dated per-period eligibility needs verdicts captured at the moment they
   * are sent — the WhatsApp detection that is not wired up yet.
   */
  const ledger = useMemo(() => {
    const reviewed = real.filter((l) => !!l.eligibility);
    return {
      reviewed,
      eligible: real.filter((l) => l.eligibility === 'eligible'),
      notEligible: real.filter((l) => l.eligibility === 'not_eligible'),
    };
  }, [real]);
  const recording = ledger.reviewed.length > 0;

  /**
   * The half of the ledger that IS honestly dated.
   *
   * Migration 087 stamps eligibility_at from the WhatsApp message we actually
   * sent, so a 'whatsapp' verdict has a real moment attached — unlike the 968
   * backfilled ones. Those, and only those, can be counted per period, so the
   * foot of each card carries "N told this period" beside the running total.
   * Before 087 runs this is simply zero and the foot says nothing extra, which
   * is why it degrades cleanly rather than needing a feature flag.
   */
  const told = useMemo(() => {
    const dated = real.filter(
      (l) => l.eligibility_source === 'whatsapp' && l.eligibility_at && inPeriod(l.eligibility_at, period),
    );
    return {
      eligible: dated.filter((l) => l.eligibility === 'eligible').length,
      notEligible: dated.filter((l) => l.eligibility === 'not_eligible').length,
      any: dated.length,
    };
  }, [real, period]);

  const verdictFoot = (allTime: number, thisPeriod: number) => {
    const pct = fmtPct(pctOf(allTime, ledger.reviewed.length));
    return told.any > 0
      ? `${thisPeriod} told this period · ${pct} of ${ledger.reviewed.length}`
      : `${pct} of ${ledger.reviewed.length} reviewed · all leads`;
  };

  // Each month bar stacks hot over cold over everything else, so the strip
  // answers "is the quality of what we're buying improving?" at a glance.
  const STRIP_LEGEND = [
    { label: 'Hot', color: '#EF4444', value: 0 },
    { label: 'Cold', color: '#4F46E5', value: 0 },
    { label: 'Other', color: '#D6D9E3', value: 0 },
  ];
  const monthItems = useMemo(() => {
    const out: { key: string; label: string; value: number; segments: { value: number; color: string; label: string }[] }[] = [];
    for (let m = 0; m <= now.getMonth(); m++) {
      const mp = periods.get(`m${m}`)!;
      const created = real.filter((l) => inPeriod(l.created_at, mp));
      const hot = created.filter((l) => l.stage === 'hot').length;
      const cold = created.filter((l) => l.stage === 'cold').length;
      out.push({
        key: mp.key, label: mp.short, value: created.length,
        segments: [
          { label: 'Hot', color: '#EF4444', value: hot },
          { label: 'Cold', color: '#4F46E5', value: cold },
          { label: 'Other', color: '#D6D9E3', value: created.length - hot - cold },
        ],
      });
    }
    return out;
  }, [periods, real, now]);

  const pick = (label: string, list: Lead[]) => {
    const f: DashFilter = { label, ids: new Set(list.map((l) => l.id)) };
    // Clicking the active card again clears the filter — a toggle, not a trap.
    onFilter(activeFilter?.label === label ? null : f);
  };

  const share = (n: number) => (cur.created.length > 0 ? `${Math.round((n / cur.created.length) * 100)}% of this period` : 'nothing yet');

  // Eligibility is deliberately NOT a funnel step: the cards report it as an
  // all-time ledger, and a funnel step reading 1 beside a card reading 130
  // would be the first thing questioned in a review. The funnel stays a pure
  // period story — what arrived, and how far it got.
  const funnelSteps = [
    { label: 'All leads', value: cur.created.length },
    { label: 'Workable', value: cur.workable.length },
    { label: 'Hot',      value: cur.hot.length },
    { label: 'Won',      value: cur.won.length },
  ];

  const notYet = 'not recorded yet';

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
          {/* All time has nothing to compare against, so the control goes
              rather than offering a choice that resolves to nothing. */}
          {cmpOpts.length > 0 && (
            <>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-faint">compare with</span>
              <div className="w-[168px]">
                <Select<string> size="sm" value={effCmp} onChange={setCmpKey}
                  options={cmpOpts.map((k) => ({ value: k, label: k === 'prev' ? 'Previous period' : periods.get(k)!.label }))} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* the six cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total leads" value={String(cur.created.length)}
          foot={cmp && compare ? `${cmp.created.length} in ${compare.short}` : 'no comparison'}
          delta={countDelta(cur.created.length, cmp ? cmp.created.length : null)}
          accent="#16294E" active={activeFilter?.label === 'All leads in period'}
          onClick={() => pick('All leads in period', cur.created)} />

        <StatCard label="Hot leads" value={String(cur.hot.length)}
          foot={share(cur.hot.length)}
          delta={countDelta(cur.hot.length, cmp ? cmp.hot.length : null)}
          accent="#EF4444" active={activeFilter?.label === 'Hot leads'}
          onClick={() => pick('Hot leads', cur.hot)} />

        <StatCard label="Cold leads" value={String(cur.cold.length)}
          foot={share(cur.cold.length)}
          delta={countDelta(cur.cold.length, cmp ? cmp.cold.length : null)}
          accent="#4F46E5" active={activeFilter?.label === 'Cold leads'}
          onClick={() => pick('Cold leads', cur.cold)} />

        <StatCard label="Spotlight" value={String(cur.spotlight.length)}
          foot={`${spotlightAll} starred across all leads`}
          delta={countDelta(cur.spotlight.length, cmp ? cmp.spotlight.length : null)}
          accent="#F59E0B" active={activeFilter?.label === 'Spotlight leads'}
          onClick={() => pick('Spotlight leads', cur.spotlight)} />

        {/* The two below are all-time, not period — see the `ledger` comment. */}
        <StatCard label="Eligible" value={recording ? String(ledger.eligible.length) : '—'}
          foot={recording ? verdictFoot(ledger.eligible.length, told.eligible) : notYet}
          delta={countDelta(0, null)}
          accent="#047857" active={activeFilter?.label === 'Eligible'}
          onClick={() => pick('Eligible', ledger.eligible)} />

        <StatCard label="Not eligible" value={recording ? String(ledger.notEligible.length) : '—'}
          foot={recording ? verdictFoot(ledger.notEligible.length, told.notEligible) : notYet}
          delta={countDelta(0, null)}
          accent="#B45309" active={activeFilter?.label === 'Not eligible'}
          onClick={() => pick('Not eligible', ledger.notEligible)} />
      </div>

      {/* Lead flow: the year strip and the funnel are one story at two zoom
          levels, so they share one panel — side by side, half each, divided by
          a hairline. Stacked again only when the screen is too narrow. */}
      <CollapsiblePanel
        storageKey="leads.flow"
        title={<>Lead flow — {period.short}</>}
        sub="The year at a glance on the left, this period's funnel on the right."
        right={<span className="num text-[11.5px] text-faint">{cur.created.length} in {period.short}</span>}
      >
        <div className="grid gap-5 lg:grid-cols-2 lg:divide-x lg:divide-border">
          {/* flex column so the strip can stretch to the height the right
              column sets — the chart always fills its card. */}
          <div className="flex min-w-0 flex-col">
            <PanelTitle sub={period.grain === 'month'
              ? 'Click any month to compare against it'
              : 'Select a month above to compare month-to-month'}>
              {now.getFullYear()} by month — leads created
            </PanelTitle>
            <div className="min-h-0 flex-1">
              <MonthStrip items={monthItems} currentKey={period.grain === 'month' ? period.key : null}
                compareKey={compare && compare.grain === 'month' ? compare.key : null}
                enabled={period.grain === 'month'}
                onPick={(k) => setCmpKey(k)}
                legend={STRIP_LEGEND} />
            </div>
          </div>
          <div className="min-w-0 lg:pl-5">
            <PanelTitle sub="Each % is the share of this period's leads that reached the stage.">
              Lead funnel — {period.short}
            </PanelTitle>
            <Funnel steps={funnelSteps} leakNoun="leads" />
            {!recording && (
              <div className="mt-3 text-[11.5px] text-muted">
                Eligibility is not being recorded yet — set it in the lead drawer and the Eligible step fills in automatically.
              </div>
            )}
          </div>
        </div>
      </CollapsiblePanel>
    </div>
  );
}
