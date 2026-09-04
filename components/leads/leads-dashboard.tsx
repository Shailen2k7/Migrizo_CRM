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
  inPeriod, countDelta, type Period,
} from '@/lib/dashboard';
import type { Lead } from '@/lib/types';

export interface DashFilter { label: string; ids: Set<string> }

/**
 * Stages that mean a lead got past qualification — it was assessed, quoted, or
 * closed. `stage` holds ONE current value, so a lead that progressed from hot
 * to invoice_sent no longer reads as 'hot'. Any funnel step that tests
 * `stage === 'hot'` therefore reports progress as loss. This set is what
 * "reached hot" actually means, and it is deliberately the same list migration
 * 074 used to decide who had been assessed.
 */
const HOT_OR_BEYOND = ['hot', 'mr_coming_soon', 'invoice_sent', 'won'];

/**
 * The one cohort definition every card and the funnel read.
 *
 * Everything is cohorted by created_at: "of the leads that arrived in this
 * period, how many are hot / cold / starred". That keeps the cards answering
 * the same question about the same set of people, so they can be read across
 * without a mental gear change. Eligibility is the deliberate exception — it
 * is cohorted by when the verdict was reached, not when the lead arrived.
 */
function cohortOf(leads: Lead[], p: Period) {
  const created = leads.filter((l) => inPeriod(l.created_at, p));
  return {
    created,
    hot: created.filter((l) => l.stage === 'hot'),
    cold: created.filter((l) => l.stage === 'cold'),
    spotlight: created.filter((l) => l.is_spotlight),
    workable: created.filter((l) => l.stage !== 'junk'),
    // Cumulative, not "currently sitting at hot" — see HOT_OR_BEYOND.
    reachedHot: created.filter((l) => HOT_OR_BEYOND.includes(l.stage)),
    reviewed: created.filter((l) => !!l.eligibility),
    eligible: created.filter((l) => l.eligibility === 'eligible'),
    notEligible: created.filter((l) => l.eligibility === 'not_eligible'),
    won: created.filter((l) => l.stage === 'won'),
  };
}

/**
 * The verdicts genuinely reached inside a period. Only rows with a real
 * timestamp reach here — see the `verdicts` comment below for why that
 * exclusion matters.
 */
function pickTold(dated: Lead[], p: Period | null) {
  const inside = p ? dated.filter((l) => inPeriod(l.eligibility_at!, p)) : [];
  return {
    eligible: inside.filter((l) => l.eligibility === 'eligible'),
    notEligible: inside.filter((l) => l.eligibility === 'not_eligible'),
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
   * TWO DIFFERENT THINGS LIVE IN leads.eligibility, AND CONFLATING THEM LIES.
   *
   * 'derived' — migration 074 stamped a verdict on the whole back catalogue by
   *   reading the lead's stage: anyone at hot-or-beyond became 'eligible',
   *   anyone at junk became 'not_eligible'. That is a relabelling of the
   *   pipeline, not a decision anybody reached or communicated, and
   *   eligibility_at holds the moment the migration ran rather than the moment
   *   anyone was told. It cannot be cohorted by date. It is also why the
   *   not-eligible total reads in the hundreds: that number is overwhelmingly
   *   the junk pile wearing a different name.
   *
   * 'whatsapp' / 'manual' — a verdict somebody actually reached and sent, with
   *   a real timestamp behind it. These are the only rows that can honestly
   *   answer "how many did we assess this period".
   *
   * So the headline is the DATED count for the selected period — which makes
   * all six cards read across as one period's story instead of four being
   * September and two being all of history — and the foot carries the all-time
   * total plus how much of it is inherited, so the big number is still there
   * and is labelled for what it is.
   */
  const verdicts = useMemo(() => ({
    allEligible:    real.filter((l) => l.eligibility === 'eligible'),
    allNotEligible: real.filter((l) => l.eligibility === 'not_eligible'),
    inheritedEligible:    real.filter((l) => l.eligibility === 'eligible' && l.eligibility_source === 'derived').length,
    inheritedNotEligible: real.filter((l) => l.eligibility === 'not_eligible' && l.eligibility_source === 'derived').length,
    dated: real.filter(
      (l) => (l.eligibility_source === 'whatsapp' || l.eligibility_source === 'manual') && !!l.eligibility_at,
    ),
  }), [real]);

  const told = useMemo(() => pickTold(verdicts.dated, period), [verdicts.dated, period]);
  const cmpTold = useMemo(() => pickTold(verdicts.dated, compare), [verdicts.dated, compare]);

  const recording = verdicts.allEligible.length + verdicts.allNotEligible.length > 0;
  const inheritedTotal = verdicts.inheritedEligible + verdicts.inheritedNotEligible;

  const verdictFoot = (allTime: number, inherited: number) =>
    inherited > 0 ? `${allTime} all-time · ${inherited} inherited` : `${allTime} all-time`;

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

  /**
   * Every step is CUMULATIVE: "how many of this period's leads reached at
   * least this far". That is the only way a funnel can be read as a funnel.
   *
   * The previous version used `stage === 'hot'` for the third step, which
   * silently counted progress as loss — a lead that moved on to invoice_sent
   * left the Hot bar and was reported as a drop-out, and every cold lead still
   * in play was labelled "lost". Reading "70 leads lost" in a Monday review
   * when those 70 are working cold leads is worse than showing nothing.
   *
   * Eligibility is deliberately not a step: it is a verdict about a person,
   * not a stage they pass through.
   */
  const funnelSteps = [
    { label: 'All leads',     value: cur.created.length },
    { label: 'Workable',      value: cur.workable.length },
    { label: 'Hot or beyond', value: cur.reachedHot.length },
    { label: 'Won',           value: cur.won.length },
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

        {/* Headline = told in this period; foot = the all-time ledger. Both
            scales are on the card, and neither pretends to be the other. */}
        <StatCard label="Eligible" value={recording ? String(told.eligible.length) : '—'}
          foot={recording ? verdictFoot(verdicts.allEligible.length, verdicts.inheritedEligible) : notYet}
          delta={countDelta(told.eligible.length, compare ? cmpTold.eligible.length : null)}
          accent="#047857" active={activeFilter?.label === 'Told eligible'}
          onClick={told.eligible.length > 0 ? () => pick('Told eligible', told.eligible) : undefined} />

        <StatCard label="Not eligible" value={recording ? String(told.notEligible.length) : '—'}
          foot={recording ? verdictFoot(verdicts.allNotEligible.length, verdicts.inheritedNotEligible) : notYet}
          delta={countDelta(told.notEligible.length, compare ? cmpTold.notEligible.length : null)}
          accent="#B45309" active={activeFilter?.label === 'Told not eligible'}
          onClick={told.notEligible.length > 0 ? () => pick('Told not eligible', told.notEligible) : undefined} />
      </div>

      {/* The one sentence that stops somebody reading the all-time figure as a
          verdict we actually delivered. It disappears once the backfill is no
          longer the majority of the ledger. */}
      {inheritedTotal > 0 && (
        <div className="mb-4 -mt-1 text-[11.5px] leading-relaxed text-faint">
          <b className="text-muted">Eligible / Not eligible</b> count verdicts sent in {period.short}.
          The all-time totals include <b className="text-muted">{inheritedTotal}</b> inherited from the
          2024 backfill, which inferred a verdict from the lead&apos;s stage — junk became
          &ldquo;not eligible&rdquo;, hot-or-beyond became &ldquo;eligible&rdquo;. Those were never
          communicated to anyone; only the {verdicts.dated.length} dated verdicts were.
        </div>
      )}

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
