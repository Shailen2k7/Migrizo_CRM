'use client';

// ============================================================================
// PAYMENTS DASHBOARD — the Monday-review view of the money.
//
// Four questions, answered in order, all from data the provider already holds:
//
//   1. What came IN this period, and is that better than last?
//   2. How many NEW clients started paying — first money ever, not a repeat
//      instalment from someone who signed months ago? This is the growth
//      number, and totals hide it completely.
//   3. Where is everyone on the four-milestone ladder? Kickstart paid but
//      Profile Building not is the single most common stall, and it is
//      invisible in a revenue total.
//   4. The pending figure is large. WHY is it large? Hovering it explains
//      itself rather than sending anyone to a SQL editor.
//
// TWO COHORTS, AND THE CARDS SAY WHICH
//   * Collected / New clients / milestone columns count activity IN the
//     period (paid_at), so they move week to week.
//   * Pending / Overdue are LIVE balances — what is owed right now. Cohorting
//     a balance by period would be meaningless.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApp } from '@/components/shared/app-provider';
import { Select } from '@/components/shared/select';
import { StatCard, MonthStrip, CollapsiblePanel } from '@/components/shared/dash-ui';
import {
  buildPeriods, primaryOptions, compareOptions, resolveCompare,
  inPeriod, countDelta, type Period,
} from '@/lib/dashboard';
import { MILESTONE_META, type Milestone, type Lead, type Payment } from '@/lib/types';
import { formatINR, formatMoney, toINR, FX_TO_INR, cn } from '@/lib/utils';
import { Info, AlertTriangle, X } from 'lucide-react';

const MILESTONE_ORDER: Milestone[] = ['kickstart', 'profile_building', 'endorsement', 'post_approval'];

/** The instalment number people say out loud: "they've paid the second." */
const MILESTONE_ORDINAL: Record<Milestone, string> = {
  kickstart: '1st instalment',
  profile_building: '2nd instalment',
  endorsement: '3rd instalment',
  post_approval: '4th instalment',
};

const MILESTONE_ACCENT: Record<Milestone, string> = {
  kickstart: '#4F46E5',
  profile_building: '#7C3AED',
  endorsement: '#0D9488',
  post_approval: '#047857',
};

/** Everything the period-scoped half of the page needs. */
function activityIn(payments: Payment[], inr: (p: Payment) => number | null, firstPaidAt: Map<string, string>, p: Period) {
  const paidInPeriod = payments.filter(
    (x) => x.status === 'paid' && x.paid_at && inPeriod(x.paid_at, p),
  );
  const collected = paidInPeriod.reduce((s, x) => s + (inr(x) ?? 0), 0);

  // A NEW paying client is one whose very first payment landed in this period.
  // Anyone paying their second or third instalment is revenue, not growth.
  const newClients = new Set<string>();
  for (const [leadId, at] of firstPaidAt) {
    if (inPeriod(at, p)) newClients.add(leadId);
  }

  return { paidInPeriod, collected, newClients };
}

export function PaymentsDashboard({ onFilter, activeFilter, onOpenLead }: {
  onFilter: (f: { label: string; ids: Set<string> } | null) => void;
  activeFilter: { label: string; ids: Set<string> } | null;
  onOpenLead: (leadId: string) => void;
}) {
  const { leads, payments } = useApp();
  const now = useMemo(() => new Date(), []);
  const periods = useMemo(() => buildPeriods(now), [now]);
  const [periodKey, setPeriodKey] = useState(`m${now.getMonth()}`);
  const [cmpKey, setCmpKey] = useState('prev');
  const [pendingOpen, setPendingOpen] = useState(false);

  const period = periods.get(periodKey)!;
  const cmpOpts = useMemo(() => compareOptions(periods, periodKey), [periods, periodKey]);
  const effCmp = cmpOpts.includes(cmpKey) ? cmpKey : 'prev';
  const compare = resolveCompare(periods, periodKey, effCmp);

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const ccyOf = useMemo(() => (leadId: string) => leadById.get(leadId)?.currency || 'INR', [leadById]);

  // Payments on leads hidden from Payments are excluded, exactly as the
  // client list below does, so the two halves of the page always agree.
  const visiblePayments = useMemo(
    () => payments.filter((p) => !leadById.get(p.lead_id)?.hidden_from_payments),
    [payments, leadById],
  );

  /**
   * CURRENCY CONFLICTS ARE EXCLUDED, NOT GUESSED.
   *
   * A payment row carries its own currency, and so does the lead. Almost always
   * they agree. When they do not, one of the two is a typo and there is no safe
   * way to tell which from inside this component — and the cost of guessing is
   * not cosmetic: a single ₹72,500 row on a GBP client, read as £72,500, put
   * ₹92 lakh of revenue on this page that does not exist.
   *
   * So a conflicted row still counts as "this client paid" — that much is not
   * in doubt — but contributes nothing to any rupee total, and is listed by
   * name at the top of the page until someone corrects it. A number that is
   * quietly wrong is worse than a number that is visibly incomplete.
   */
  const conflicted = useMemo(() => {
    const set = new Set<string>();
    const rows: { payment: Payment; lead: Lead }[] = [];
    for (const p of visiblePayments) {
      const lead = leadById.get(p.lead_id);
      if (!lead) continue;
      const leadCcy = lead.currency || 'INR';
      if (p.currency && p.currency !== leadCcy) { set.add(p.id); rows.push({ payment: p, lead }); }
    }
    // A fingerprint of exactly which payments are in conflict. Dismissing the
    // notice hides THIS set — if a new mismatch appears tomorrow the signature
    // changes and the notice comes back on its own, so hiding it can never
    // silence a problem you have not seen yet.
    const signature = [...set].sort().join(',');
    return { ids: set, rows, signature };
  }, [visiblePayments, leadById]);

  /** A payment in rupees, or null when its currency is in dispute. */
  const inr = useMemo(
    () => (p: Payment): number | null =>
      conflicted.ids.has(p.id) ? null : toINR(p.amount || 0, ccyOf(p.lead_id)),
    [conflicted.ids, ccyOf],
  );

  /** lead_id -> ISO of that lead's earliest ever paid payment. */
  const firstPaidAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of visiblePayments) {
      if (p.status !== 'paid' || !p.paid_at) continue;
      const cur = m.get(p.lead_id);
      if (!cur || p.paid_at < cur) m.set(p.lead_id, p.paid_at);
    }
    return m;
  }, [visiblePayments]);

  const cur = useMemo(() => activityIn(visiblePayments, inr, firstPaidAt, period), [visiblePayments, inr, firstPaidAt, period]);
  const cmp = useMemo(() => (compare ? activityIn(visiblePayments, inr, firstPaidAt, compare) : null), [visiblePayments, inr, firstPaidAt, compare]);

  // ── live balances ────────────────────────────────────────────────────────
  const balances = useMemo(() => {
    const visLeads = leads.filter((l) => !l.hidden_from_payments);
    const owing = visLeads
      .map((l) => ({
        lead: l,
        ccy: l.currency || 'INR',
        paid: l.amount_paid || 0,
        due: Math.max(0, (l.amount_total || 0) - (l.amount_paid || 0)),
      }))
      .filter((x) => x.due > 0);

    const dueInr = (x: { due: number; ccy: string }) => toINR(x.due, x.ccy);
    const total = owing.reduce((s, x) => s + dueInr(x), 0);

    const partPaid = owing.filter((x) => x.paid > 0);
    const neverPaid = owing.filter((x) => x.paid === 0);

    const byStage = new Map<string, { n: number; inr: number }>();
    for (const x of owing) {
      const b = byStage.get(x.lead.stage) || { n: 0, inr: 0 };
      b.n += 1; b.inr += dueInr(x);
      byStage.set(x.lead.stage, b);
    }

    const byCcy = new Map<string, { n: number; raw: number; inr: number }>();
    for (const x of owing) {
      const b = byCcy.get(x.ccy) || { n: 0, raw: 0, inr: 0 };
      b.n += 1; b.raw += x.due; b.inr += dueInr(x);
      byCcy.set(x.ccy, b);
    }

    const overdue = visLeads.reduce((s, l) => s + toINR(l.amount_overdue || 0, l.currency || 'INR'), 0);
    const overdueClients = visLeads.filter((l) => (l.amount_overdue || 0) > 0);
    const collectedAll = visLeads.reduce((s, l) => s + toINR(l.amount_paid || 0, l.currency || 'INR'), 0);

    return {
      owing, total, partPaid, neverPaid, overdue, overdueClients, collectedAll,
      byStage: [...byStage.entries()].sort((a, b) => b[1].inr - a[1].inr),
      byCcy: [...byCcy.entries()].sort((a, b) => b[1].inr - a[1].inr),
    };
  }, [leads]);

  // ── the milestone ladder ─────────────────────────────────────────────────
  const ladder = useMemo(() => {
    return MILESTONE_ORDER.map((m) => {
      const rows = visiblePayments.filter((p) => p.milestone === m);
      const paid = rows.filter((p) => p.status === 'paid');
      const paidThisPeriod = paid.filter((p) => p.paid_at && inPeriod(p.paid_at, period));
      const paidPrevPeriod = compare ? paid.filter((p) => p.paid_at && inPeriod(p.paid_at, compare)) : [];
      const pending = rows.filter((p) => p.status === 'pending');
      const overdue = rows.filter((p) => p.status === 'overdue');

      const clients = (list: Payment[]) => new Set(list.map((p) => p.lead_id));

      return {
        milestone: m,
        meta: MILESTONE_META[m],
        clientsPaidPeriod: clients(paidThisPeriod),
        clientsPaidPrev: clients(paidPrevPeriod),
        clientsPaidAll: clients(paid),
        collectedPeriod: paidThisPeriod.reduce((s, p) => s + (inr(p) ?? 0), 0),
        collectedAll: paid.reduce((s, p) => s + (inr(p) ?? 0), 0),
        pendingClients: clients(pending),
        pendingInr: pending.reduce((s, p) => s + (inr(p) ?? 0), 0),
        overdueClients: clients(overdue),
        overdueInr: overdue.reduce((s, p) => s + (inr(p) ?? 0), 0),
      };
    });
  }, [visiblePayments, period, compare, inr]);

  // Where clients STALL: paid milestone N but never milestone N+1. This is the
  // number that turns "revenue is flat" into "eleven people stopped after the
  // kickstart and nobody chased them".
  const stalls = useMemo(() => {
    const out: { from: Milestone; to: Milestone; leads: Lead[] }[] = [];
    for (let i = 0; i < MILESTONE_ORDER.length - 1; i++) {
      const from = MILESTONE_ORDER[i], to = MILESTONE_ORDER[i + 1];
      const paidFrom = ladder[i].clientsPaidAll;
      const paidTo = ladder[i + 1].clientsPaidAll;
      const stuck = [...paidFrom].filter((id) => !paidTo.has(id))
        .map((id) => leadById.get(id))
        .filter((l): l is Lead => !!l && l.stage !== 'junk');
      if (stuck.length) out.push({ from, to, leads: stuck });
    }
    return out;
  }, [ladder, leadById]);

  // months strip: collected per month, stacked by milestone
  const STRIP_LEGEND = MILESTONE_ORDER.map((m) => ({
    label: MILESTONE_META[m].label, color: MILESTONE_ACCENT[m], value: 0,
  }));
  const monthItems = useMemo(() => {
    const out: { key: string; label: string; value: number; segments: { value: number; color: string; label: string }[] }[] = [];
    for (let m = 0; m <= now.getMonth(); m++) {
      const mp = periods.get(`m${m}`)!;
      const paid = visiblePayments.filter((p) => p.status === 'paid' && p.paid_at && inPeriod(p.paid_at, mp));
      out.push({
        key: mp.key, label: mp.short,
        value: paid.reduce((s, p) => s + (inr(p) ?? 0), 0),
        segments: MILESTONE_ORDER.map((mi) => ({
          label: MILESTONE_META[mi].label,
          color: MILESTONE_ACCENT[mi],
          value: paid.filter((p) => p.milestone === mi).reduce((s, p) => s + (inr(p) ?? 0), 0),
        })),
      });
    }
    return out;
  }, [periods, visiblePayments, now, inr]);

  const pick = (label: string, ids: Set<string>) => {
    onFilter(activeFilter?.label === label ? null : { label, ids });
  };

  const newClientList = useMemo(
    () => [...cur.newClients].map((id) => leadById.get(id)).filter((l): l is Lead => !!l),
    [cur.newClients, leadById],
  );

  // Summaries shown on the collapsed panel headers, so folding a section away
  // never hides its headline number.
  const ladderPaidAll = useMemo(
    () => new Set(visiblePayments.filter((p) => p.status === 'paid').map((p) => p.lead_id)).size,
    [visiblePayments],
  );
  const yearCollected = useMemo(
    () => monthItems.reduce((s, m) => s + m.value, 0),
    [monthItems],
  );

  return (
    <div className="mb-5 animate-pageIn">
      {/* period selectors */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12.5px] text-muted">
          <b className="text-ink">{formatINR(Math.round(cur.collected))}</b> collected · <b className="text-ink">{cur.newClients.size}</b> new paying
          {cur.newClients.size === 1 ? ' client' : ' clients'} · <b className="text-ink-2">{period.label}</b>
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

      <ConflictNotice rows={conflicted.rows} signature={conflicted.signature} onOpenLead={onOpenLead} />

      {/* four cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Collected" value={formatINR(Math.round(cur.collected))}
          foot={cmp && compare ? `${formatINR(Math.round(cmp.collected))} in ${compare.short}` : 'money received in period'}
          delta={countDelta(Math.round(cur.collected), cmp ? Math.round(cmp.collected) : null)}
          accent="#047857" active={activeFilter?.label === 'Paid in period'}
          onClick={() => pick('Paid in period', new Set(cur.paidInPeriod.map((p) => p.lead_id)))} />

        <StatCard label="New paying clients" value={String(cur.newClients.size)}
          foot={cmp && compare ? `${cmp.newClients.size} in ${compare.short} · first payment ever` : 'first payment ever'}
          delta={countDelta(cur.newClients.size, cmp ? cmp.newClients.size : null)}
          accent="#4F46E5" active={activeFilter?.label === 'New paying clients'}
          onClick={() => pick('New paying clients', new Set(newClientList.map((l) => l.id)))} />

        {/* Pending explains itself on hover. A number this size with no
            explanation is the one people stop trusting first. */}
        <div className="relative"
          onMouseEnter={() => setPendingOpen(true)}
          onMouseLeave={() => setPendingOpen(false)}>
          <StatCard label="Pending" value={formatINR(Math.round(balances.total))}
            foot={`${balances.owing.length} clients owe a balance · hover for the breakdown`}
            delta={countDelta(0, null)}
            accent="#B45309" active={activeFilter?.label === 'Owes a balance'}
            onClick={() => pick('Owes a balance', new Set(balances.owing.map((x) => x.lead.id)))} />
          <span className="pointer-events-none absolute right-3 top-3 text-faint"><Info className="h-3.5 w-3.5" /></span>
          {pendingOpen && <PendingBreakdown b={balances} />}
        </div>

        <StatCard label="Overdue" value={formatINR(Math.round(balances.overdue))}
          foot={balances.overdueClients.length ? `${balances.overdueClients.length} client${balances.overdueClients.length === 1 ? '' : 's'} past due` : 'nothing past due'}
          delta={countDelta(0, null)}
          accent="#B91C1C" active={activeFilter?.label === 'Overdue'}
          onClick={() => pick('Overdue', new Set(balances.overdueClients.map((l) => l.id)))} />
      </div>

      {/* ── the milestone ladder ─────────────────────────────────────────── */}
      <CollapsiblePanel
        className="mb-4"
        storageKey="pay.ladder"
        title={<>Milestone ladder — {period.short}</>}
        sub="Who paid what, this period and in total. Click any number to filter the client list below."
        right={<span className="text-[11.5px] text-faint">{ladderPaidAll} client{ladderPaidAll === 1 ? '' : 's'} have paid something</span>}
      >
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full border-collapse" style={{ minWidth: 720 }}>
            <thead>
              <tr className="text-left text-[10px] font-extrabold uppercase tracking-[0.07em] text-faint">
                <th className="py-2 pr-3">Instalment</th>
                <th className="py-2 pr-3 text-right">Paid this period</th>
                <th className="py-2 pr-3 text-right">Collected</th>
                <th className="py-2 pr-3 text-right">Paid all time</th>
                <th className="py-2 pr-3 text-right">Awaiting</th>
                <th className="py-2 text-right">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((r) => {
                const d = countDelta(r.clientsPaidPeriod.size, compare ? r.clientsPaidPrev.size : null);
                return (
                  <tr key={r.milestone} className="border-t border-border">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: MILESTONE_ACCENT[r.milestone] }} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold">{r.meta.label}</span>
                          <span className="block text-[11px] text-faint">{MILESTONE_ORDINAL[r.milestone]} · {r.meta.pct}% of fee</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <button onClick={() => pick(`Paid ${r.meta.label} in period`, r.clientsPaidPeriod)}
                        className="num text-[17px] font-extrabold leading-none hover:underline disabled:no-underline"
                        disabled={r.clientsPaidPeriod.size === 0}>
                        {r.clientsPaidPeriod.size}
                      </button>
                      <div className="mt-0.5 text-[10.5px] text-faint">
                        {d.dir === 'flat' ? 'clients' : <span style={{ color: d.good ? '#047857' : '#B91C1C' }}>{d.text} vs {compare?.short}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className="num text-[13px] font-semibold">{r.collectedPeriod > 0 ? formatINR(Math.round(r.collectedPeriod)) : '—'}</span>
                      <div className="mt-0.5 text-[10.5px] text-faint">{formatINR(Math.round(r.collectedAll))} all time</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <button onClick={() => pick(`Paid ${r.meta.label}`, r.clientsPaidAll)}
                        className="num text-[13px] font-semibold hover:underline disabled:no-underline"
                        disabled={r.clientsPaidAll.size === 0}>
                        {r.clientsPaidAll.size}
                      </button>
                      <div className="mt-0.5 text-[10.5px] text-faint">clients</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <button onClick={() => pick(`Awaiting ${r.meta.label}`, r.pendingClients)}
                        className={cn('num text-[13px] font-semibold hover:underline disabled:no-underline', r.pendingClients.size > 0 && 'text-[#B45309]')}
                        disabled={r.pendingClients.size === 0}>
                        {r.pendingClients.size}
                      </button>
                      <div className="mt-0.5 text-[10.5px] text-faint">{r.pendingInr > 0 ? formatINR(Math.round(r.pendingInr)) : '—'}</div>
                    </td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => pick(`${r.meta.label} overdue`, r.overdueClients)}
                        className={cn('num text-[13px] font-semibold hover:underline disabled:no-underline', r.overdueClients.size > 0 && 'text-[#B91C1C]')}
                        disabled={r.overdueClients.size === 0}>
                        {r.overdueClients.size}
                      </button>
                      <div className="mt-0.5 text-[10.5px] text-faint">{r.overdueInr > 0 ? formatINR(Math.round(r.overdueInr)) : '—'}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* where clients stop */}
        {stalls.length > 0 && (
          <div className="mt-4 border-t border-border pt-3.5">
            <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.07em] text-muted">
              Stalled between instalments <span className="font-bold normal-case tracking-normal text-faint">· paid one, never paid the next</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {stalls.map((s) => (
                <button key={`${s.from}-${s.to}`}
                  onClick={() => pick(`Stalled after ${MILESTONE_META[s.from].label}`, new Set(s.leads.map((l) => l.id)))}
                  className={cn('rounded-xl border px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm',
                    activeFilter?.label === `Stalled after ${MILESTONE_META[s.from].label}` ? 'border-indigo bg-[hsl(var(--indigo-soft))]' : 'border-border bg-surface')}>
                  <span className="num text-[16px] font-extrabold leading-none">{s.leads.length}</span>
                  <span className="ml-1.5 text-[11.5px] text-muted">stuck after {MILESTONE_META[s.from].label}</span>
                  <span className="mt-0.5 block text-[10.5px] text-faint">never paid {MILESTONE_META[s.to].label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CollapsiblePanel>

      {/* revenue by month, stacked by instalment */}
      <CollapsiblePanel
        storageKey="pay.months"
        title={<>{now.getFullYear()} by month — collected</>}
        sub={period.grain === 'month'
          ? 'Each bar is money received that month, split by instalment · click one to compare'
          : 'Select a month above to compare month-to-month'}
        right={<span className="num text-[11.5px] text-faint">{formatINR(Math.round(yearCollected))} this year</span>}
      >
        <MonthStrip items={monthItems} currentKey={period.grain === 'month' ? period.key : null}
          compareKey={compare && compare.grain === 'month' ? compare.key : null}
          enabled={period.grain === 'month'}
          onPick={(k) => setCmpKey(k)}
          legend={STRIP_LEGEND} />
      </CollapsiblePanel>
    </div>
  );
}

// ── excluded payments, said quietly ─────────────────────────────────────────
// The first version of this was a full amber block with three cards in it,
// permanently parked above the numbers. It was right and it looked like an
// error page. This is the same information as one muted line that opens on
// click and can be dismissed — but the dismissal is keyed to the exact set of
// broken payments, so a NEW mismatch reappears by itself.
function ConflictNotice({ rows, signature, onOpenLead }: {
  rows: { payment: Payment; lead: Lead }[];
  signature: string;
  onOpenLead: (leadId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try { setDismissed(localStorage.getItem('migrizo.payments.conflictsSeen')); } catch { /* ignore */ }
  }, []);

  if (rows.length === 0 || dismissed === signature) return null;

  const hide = () => {
    setDismissed(signature);
    try { localStorage.setItem('migrizo.payments.conflictsSeen', signature); } catch { /* ignore */ }
  };

  return (
    <div className="mb-3 rounded-xl border border-border bg-surface-2/60">
      <div className="flex items-center gap-2 px-3.5 py-2">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-[#B45309]" />
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="text-[12px] text-ink-2">
            <b className="font-semibold">{rows.length} payment{rows.length === 1 ? '' : 's'}</b> left out of the totals — currency doesn&rsquo;t match the client
          </span>
          <span className="ml-1.5 text-[11.5px] font-semibold text-indigo">{open ? 'Hide' : 'Review'}</span>
        </button>
        <button onClick={hide} title="Dismiss until this changes"
          className="flex-shrink-0 rounded-md p-1 text-faint transition hover:bg-surface hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }} className="overflow-hidden"
          >
            <div className="px-3.5 pb-3 pl-9">
              <p className="mb-2 text-[11.5px] leading-relaxed text-muted">
                Recorded in one currency, client set to another — there is no safe way to convert it.
                Open the client, fix whichever is wrong, and the money reappears here immediately.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {rows.map(({ payment, lead }) => (
                  <button key={payment.id} onClick={() => onOpenLead(lead.id)}
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left transition hover:border-indigo">
                    <span className="block text-[12px] font-semibold text-ink">{lead.full_name}</span>
                    <span className="block text-[10.5px] text-muted">
                      {formatMoney(payment.amount, payment.currency)} recorded · client set to {lead.currency || 'INR'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── the pending explanation ─────────────────────────────────────────────────
// Short on purpose. Three lines of composition, one line of stage split, and
// the FX caveat — because a rupee headline built partly from pounds should say
// so, at the rate it used.
function PendingBreakdown({ b }: {
  b: {
    total: number;
    owing: { lead: Lead; ccy: string; paid: number; due: number }[];
    partPaid: { due: number; ccy: string }[];
    neverPaid: { due: number; ccy: string }[];
    byStage: [string, { n: number; inr: number }][];
    byCcy: [string, { n: number; raw: number; inr: number }][];
  };
}) {
  const sum = (list: { due: number; ccy: string }[]) => list.reduce((s, x) => s + toINR(x.due, x.ccy), 0);
  const partInr = sum(b.partPaid);
  const neverInr = sum(b.neverPaid);
  const foreign = b.byCcy.filter(([c]) => c !== 'INR');

  const Row = ({ label, sub, n, inr, tone }: { label: string; sub: string; n: number; inr: number; tone: string }) => (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className="num w-7 flex-shrink-0 text-right text-[13px] font-extrabold" style={{ color: tone }}>{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-ink">{label}</span>
        <span className="block text-[10.5px] leading-tight text-muted">{sub}</span>
      </span>
      <span className="num flex-shrink-0 text-[12.5px] font-bold text-ink">{formatINR(Math.round(inr))}</span>
    </div>
  );

  return (
    <div
      className="absolute left-1/2 top-full z-[70] mt-2 w-[330px] -translate-x-1/2 rounded-2xl border border-border bg-surface p-3.5 shadow-lg"
      style={{ boxShadow: '0 18px 44px -16px rgba(15,17,21,.32), 0 4px 12px -6px rgba(15,17,21,.14)' }}
    >
      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.07em] text-muted">
        Why {formatINR(Math.round(b.total))} is pending
      </div>
      <p className="mb-2 text-[11px] leading-snug text-faint">
        Every client&rsquo;s agreed fee minus what they have actually paid.
      </p>

      <div className="divide-y divide-border border-y border-border">
        <Row label="Part-paid clients" sub="started, still owe the balance"
          n={b.partPaid.length} inr={partInr} tone="#B45309" />
        <Row label="Quoted, paid nothing" sub="fee agreed, no money in yet"
          n={b.neverPaid.length} inr={neverInr} tone="#B91C1C" />
      </div>

      <div className="mt-2.5">
        <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.07em] text-faint">By stage</div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {b.byStage.slice(0, 4).map(([stage, v]) => (
            <span key={stage} className="text-[11px] text-muted">
              <b className="font-semibold capitalize text-ink-2">{stage.replace(/_/g, ' ')}</b> {formatINR(Math.round(v.inr))}
              <span className="text-faint"> ({v.n})</span>
            </span>
          ))}
        </div>
      </div>

      {foreign.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[10.5px] leading-snug text-muted">
          Includes {foreign.map(([c, v]) => `${formatMoney(v.raw, c)}`).join(' + ')} converted at{' '}
          {foreign.map(([c]) => `₹${FX_TO_INR[c]}/${c === 'GBP' ? '£' : '$'}`).join(', ')} — set in <span className="font-mono text-[10px]">lib/utils.ts</span>.
        </div>
      )}
    </div>
  );
}
