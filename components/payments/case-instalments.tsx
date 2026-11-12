'use client';

// ============================================================================
// CASE INSTALMENTS — one row per case, one column per instalment.
//
// Answers, for every case on the books: how many instalments have they paid,
// how many payments did that take, how much is in, and where did they stop.
//
// Read-only. Built entirely from the cases and payments the provider already
// holds, so nothing new is stored and nothing else on the page changes.
//
// RULES
//   * An instalment is PAID when a payment is recorded against it as paid and
//     nothing is still open against it. Amounts are not compared with the
//     standard plan split: many clients agreed their own instalment amounts.
//   * Paid money plus a still-open invoice on the same instalment is PART-PAID
//     (or OVERDUE once that invoice is past due).
//   * Split payments against the same instalment are added together, so
//     "Payments made" can be higher than "Instalments paid".
//   * Columns always use the CURRENT plan's names for the client's visa, so
//     every row reads the same way. Receipts keep the names they were issued
//     under; this view does not touch them.
//   * A case leaves the ACTIVE list once it is closed (cases.archived_at).
//     "Mark as backed out" here does exactly what Cases → Close case →
//     "Client backed out" does: same fields, same timeline entry, and it is
//     undone the same way (Reopen). Nothing is deleted or sent to the client.
//   * "No payment 30+ days" flags an active, unfinished case whose last money
//     arrived more than 30 days ago and that has nothing invoiced or overdue.
// ============================================================================

import { useMemo, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { CollapsiblePanel } from '@/components/shared/dash-ui';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { createClient } from '@/lib/supabase/client';
import { normalizeJourney } from '@/lib/journey';
import { closeReasonLabel, type CaseDetails, type CloseReason } from '@/lib/case-details';
import {
  isIfvVisa, milestoneLabel,
  type Milestone, type Payment, type Lead, type Case,
} from '@/lib/types';
import { formatMoney, formatINR, toINR, cn } from '@/lib/utils';
import { Download, Search, UserX, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

const ORDER: Milestone[] = ['kickstart', 'profile_building', 'endorsement', 'post_approval'];
const ORDINAL = ['1st', '2nd', '3rd', '4th'];
const DAY = 86_400_000;

type CellState = 'paid' | 'partial' | 'overdue' | 'pending' | 'none';
type RowStatus = 'completed' | 'overdue' | 'on_track' | 'stalled' | 'not_started' | 'left';

const CELL_STYLE: Record<CellState, { bg: string; fg: string; border: string }> = {
  paid:    { bg: '#E6F7EE', fg: '#047857', border: '#A7E3C4' },
  partial: { bg: '#FEF3C7', fg: '#B45309', border: '#FCD98A' },
  overdue: { bg: '#FEE2E2', fg: '#B91C1C', border: '#FBB4B4' },
  pending: { bg: '#EEF2FF', fg: '#4338CA', border: '#C7D2FE' },
  none:    { bg: 'transparent', fg: '#9CA3AF', border: 'hsl(var(--border))' },
};

const STATUS_META: Record<RowStatus, { label: string; bg: string; fg: string }> = {
  completed:   { label: 'Fully paid',         bg: '#E6F7EE', fg: '#047857' },
  overdue:     { label: 'Overdue',            bg: '#FEE2E2', fg: '#B91C1C' },
  on_track:    { label: 'On track',           bg: '#EEF2FF', fg: '#4338CA' },
  stalled:     { label: 'No payment 30+ days', bg: '#FEF3C7', fg: '#B45309' },
  not_started: { label: 'Nothing paid yet',   bg: '#F4F4F6', fg: '#6B7280' },
  left:        { label: 'Left',               bg: '#F4F4F6', fg: '#4B5563' },
};

interface Cell {
  milestone: Milestone;
  label: string;
  state: CellState;
  paid: number;          // received against this instalment, client currency
  expected: number | null;
  payments: number;      // paid payment rows
  lastPaidAt: string | null;
  dueDate: string | null;
}

interface Row {
  c: Case;
  lead: Lead | null;
  name: string;
  ifv: boolean;
  currency: string;
  cells: Cell[];
  instalmentsPaid: number;
  paymentsMade: number;
  collected: number;
  total: number;
  lastPaidAt: string | null;
  lastStage: string;     // the furthest instalment fully paid, for "left after"
  status: RowStatus;
  closedReason: CloseReason | null;
}

/** The close reason kept in the case form when a case was closed. */
function closeReasonOf(c: Case): CloseReason | null {
  return (normalizeJourney(c.journey).details?.closed_reason as CloseReason | null | undefined) ?? null;
}

/** What the status pill says for a closed case. */
function leftLabel(r: Row): string {
  const after = r.paymentsMade > 0 ? ` after ${r.lastStage}` : ' before paying';
  if (r.closedReason === 'backed_out') return `Backed out${after}`;
  return `Closed · ${closeReasonLabel(r.closedReason)}${after}`;
}

/** What a payment counts for in the client's own billing currency. */
function creditOf(p: Payment): number {
  return p.credit_amount != null ? Number(p.credit_amount) : Number(p.amount) || 0;
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function buildRow(c: Case, lead: Lead | null, pays: Payment[], now: number): Row {
  const visa = lead?.visa_type || c.visa_type;
  const ifv = isIfvVisa(visa);
  const currency = lead?.currency || pays[0]?.currency || 'INR';
  const total = Number(lead?.amount_total) || 0;

  const cells: Cell[] = ORDER.map((m) => {
    const mine = pays.filter((p) => p.milestone === m);
    const paidRows = mine.filter((p) => p.status === 'paid');
    const paid = paidRows.reduce((s, p) => s + creditOf(p), 0);
    const open = mine.filter((p) => p.status !== 'paid');
    const isOverdue = open.some((p) => p.status === 'overdue' || (p.due_date && new Date(p.due_date).getTime() < now - DAY));
    const lastPaidAt = paidRows.map((p) => p.paid_at || p.created_at).sort().pop() ?? null;
    const dueDate = open.map((p) => p.due_date).filter(Boolean).sort()[0] ?? null;

    let state: CellState = 'none';
    if (isOverdue) state = 'overdue';
    else if (paidRows.length > 0 && open.length > 0) state = 'partial';
    else if (paidRows.length > 0) state = 'paid';
    else if (open.length > 0) state = 'pending';

    return {
      milestone: m,
      label: milestoneLabel(m, visa),
      state, paid, expected: null, payments: paidRows.length, lastPaidAt, dueDate,
    };
  });

  // Fully paid overall wins over the per-instalment split — some clients paid
  // two instalments in one go and it was recorded against a single milestone.
  const collected = cells.reduce((s, x) => s + x.paid, 0);
  const fullyPaid = total > 0 && collected >= total * 0.98;
  if (fullyPaid) cells.forEach((x) => { if (x.state !== 'paid') x.state = 'paid'; });

  const instalmentsPaid = cells.filter((x) => x.state === 'paid').length;
  const paymentsMade = cells.reduce((s, x) => s + x.payments, 0);
  const lastPaidAt = cells.map((x) => x.lastPaidAt).filter(Boolean).sort().pop() ?? null;
  const furthest = [...cells].reverse().find((x) => x.state === 'paid' || x.state === 'partial');
  const lastStage = furthest ? furthest.label : 'before any payment';

  let status: RowStatus;
  if (c.archived_at) status = 'left';
  else if (fullyPaid || instalmentsPaid === 4) status = 'completed';
  else if (cells.some((x) => x.state === 'overdue')) status = 'overdue';
  else if (paymentsMade === 0) status = cells.some((x) => x.state === 'pending') ? 'on_track' : 'not_started';
  else if (cells.some((x) => x.state === 'pending')) status = 'on_track';
  else if (lastPaidAt && now - new Date(lastPaidAt).getTime() > 30 * DAY) status = 'stalled';
  else status = 'on_track';

  return {
    c, lead, name: lead?.full_name || c.client_name, ifv, currency, cells,
    instalmentsPaid, paymentsMade, collected, total, lastPaidAt, lastStage, status,
    closedReason: c.archived_at ? closeReasonOf(c) : null,
  };
}

type Scope = 'active' | 'backed_out' | 'closed_other' | 'all';
type Bucket = 'any' | '0' | '1' | '2' | '3' | '4' | RowStatus;

export function CaseInstalments({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const { cases, leads, payments, updateCaseJourney, user } = useApp();
  const [scope, setScope] = useState<Scope>('active');
  const [bucket, setBucket] = useState<Bucket>('any');
  const [visa, setVisa] = useState<'all' | 'gtv' | 'ifv'>('all');
  const [q, setQ] = useState('');
  const [ask, setAsk] = useState<{ row: Row; to: 'backed_out' | 'reopen' } | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  // Same write as Cases → Close case → "Client backed out" (and Reopen), so
  // the Cases page, the sidebar count and this tracker always agree.
  const applyAsk = async () => {
    if (!ask) return;
    const { row, to } = ask;
    const c = row.c;
    setBusy(true);
    const nowIso = new Date().toISOString();
    const journey = normalizeJourney(c.journey);
    const details = { ...(journey.details ?? {}) } as CaseDetails;
    if (to === 'backed_out') {
      details.closed_reason = 'backed_out'; details.closed_note = null; details.closed_at = nowIso;
      await updateCaseJourney(c.id, { ...journey, details }, { archived_at: nowIso } as Partial<Case>);
      await supabase.from('case_activity').insert({
        workspace_id: c.workspace_id, case_id: c.id, user_id: user.id,
        action: 'case_closed', meta: { reason: 'backed_out', note: null, from: 'payments' },
      });
      toast.success(`${row.name} moved to Backed out`);
    } else {
      const was = details.closed_reason ?? null;
      details.closed_reason = null; details.closed_note = null; details.closed_at = null;
      await updateCaseJourney(c.id, { ...journey, details }, { archived_at: null, status: 'active' } as Partial<Case>);
      await supabase.from('case_activity').insert({
        workspace_id: c.workspace_id, case_id: c.id, user_id: user.id,
        action: 'case_reopened', meta: { was, from: 'payments' },
      });
      toast.success(`${row.name} is an active case again`);
    }
    setBusy(false);
    setAsk(null);
  };

  const rows = useMemo(() => {
    const now = Date.now();
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const paysByLead = new Map<string, Payment[]>();
    payments.forEach((p) => {
      const list = paysByLead.get(p.lead_id);
      if (list) list.push(p); else paysByLead.set(p.lead_id, [p]);
    });
    return cases.map((c) => {
      const lead = c.lead_id ? leadById.get(c.lead_id) ?? null : null;
      return buildRow(c, lead, c.lead_id ? paysByLead.get(c.lead_id) ?? [] : [], now);
    });
  }, [cases, leads, payments]);

  const inScope = useMemo(() => rows.filter((r) => {
    if (scope === 'active' && r.c.archived_at) return false;
    if (scope === 'backed_out' && !(r.c.archived_at && r.closedReason === 'backed_out')) return false;
    if (scope === 'closed_other' && !(r.c.archived_at && r.closedReason !== 'backed_out')) return false;
    if (visa !== 'all' && (visa === 'ifv') !== r.ifv) return false;
    return true;
  }), [rows, scope, visa]);

  const summary = useMemo(() => {
    const byCount = [0, 0, 0, 0, 0];
    inScope.forEach((r) => { byCount[r.instalmentsPaid] += 1; });
    return {
      cases: inScope.length,
      paying: inScope.filter((r) => r.paymentsMade > 0).length,
      payments: inScope.reduce((s, r) => s + r.paymentsMade, 0),
      collectedInr: inScope.reduce((s, r) => s + toINR(r.collected, r.currency), 0),
      byCount,
      overdue: inScope.filter((r) => r.status === 'overdue').length,
      stalled: inScope.filter((r) => r.status === 'stalled').length,
      activeCount: rows.filter((r) => !r.c.archived_at).length,
      backedOutCount: rows.filter((r) => r.c.archived_at && r.closedReason === 'backed_out').length,
      closedOtherCount: rows.filter((r) => r.c.archived_at && r.closedReason !== 'backed_out').length,
    };
  }, [inScope, rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inScope
      .filter((r) => {
        if (bucket !== 'any') {
          if (/^[0-4]$/.test(bucket)) { if (r.instalmentsPaid !== Number(bucket)) return false; }
          else if (r.status !== bucket) return false;
        }
        if (needle && !r.name.toLowerCase().includes(needle) && !(r.lead?.phone || '').includes(needle)) return false;
        return true;
      })
      .sort((a, b) => b.instalmentsPaid - a.instalmentsPaid || (b.lastPaidAt || '').localeCompare(a.lastPaidAt || ''));
  }, [inScope, bucket, q]);

  const exportCsv = () => {
    const head = ['Case', 'Client', 'Visa', 'Instalments paid', 'Payments made',
      ...ORDER.map((_, i) => `${ORDINAL[i]} instalment`), 'Collected', 'Agreed fee', 'Currency', 'Last payment', 'Status'];
    const body = shown.map((r) => [
      r.c.case_no ? `MIG-${r.c.case_no}` : '', r.name, r.ifv ? 'IFV' : 'GTV', `${r.instalmentsPaid} of 4`, r.paymentsMade,
      ...r.cells.map((x) => `${x.label}: ${x.state === 'none' ? '—' : x.state}${x.paid ? ` ${x.paid}` : ''}`),
      r.collected, r.total || '', r.currency, r.lastPaidAt ? r.lastPaidAt.slice(0, 10) : '',
      r.status === 'left' ? leftLabel(r) : STATUS_META[r.status].label,
    ]);
    const csv = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `migrizo-case-instalments-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${shown.length} cases`);
  };

  const pick = (b: Bucket) => setBucket((cur) => (cur === b ? 'any' : b));

  const tiles: { key: Bucket; label: string; value: string; foot: string; accent: string }[] = [
    { key: 'any', label: 'Cases', value: String(summary.cases), foot: `${summary.paying} have paid at least once`, accent: '#4F46E5' },
    { key: 'any', label: 'Payments made', value: String(summary.payments), foot: `≈ ${formatINR(summary.collectedInr)} collected`, accent: '#7C3AED' },
    { key: '1', label: '1 of 4 paid', value: String(summary.byCount[1]), foot: 'Kickstart only', accent: '#6366F1' },
    { key: '2', label: '2 of 4 paid', value: String(summary.byCount[2]), foot: 'Up to 2nd instalment', accent: '#8B5CF6' },
    { key: '3', label: '3 of 4 paid', value: String(summary.byCount[3]), foot: 'Up to 3rd instalment', accent: '#0D9488' },
    { key: '4', label: 'Fully paid', value: String(summary.byCount[4]), foot: 'All 4 instalments', accent: '#047857' },
    { key: 'overdue', label: 'Overdue', value: String(summary.overdue), foot: 'Instalment past due', accent: '#DC2626' },
    { key: 'stalled', label: 'No payment 30+ days', value: String(summary.stalled), foot: 'Active, nothing invoiced', accent: '#D97706' },
  ];

  return (
    <CollapsiblePanel
      className="mb-5"
      storageKey="pay.case-instalments"
      title={<>Case instalments</>}
      sub="Every case, every instalment — who has paid what, and where they stopped"
      right={<span className="text-[12px] text-muted">{summary.cases} case{summary.cases === 1 ? '' : 's'}</span>}
    >
      <div>
        {/* scope + visa */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([
            ['active', 'Active cases', summary.activeCount],
            ['backed_out', 'Backed out', summary.backedOutCount],
            ['closed_other', 'Other closed', summary.closedOtherCount],
            ['all', 'All cases', summary.activeCount + summary.backedOutCount + summary.closedOtherCount],
          ] as [Scope, string, number][]).map(([k, label, n]) => (
            <button key={k} onClick={() => { setScope(k); setBucket('any'); }} className={cn('filter-chip', scope === k && 'active')}>
              {label} <span className="count">{n}</span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {(['all', 'gtv', 'ifv'] as const).map((v) => (
            <button key={v} onClick={() => setVisa(v)} className={cn('filter-chip', visa === v && 'active')}>
              {v === 'all' ? 'GTV + IFV' : v.toUpperCase()}
            </button>
          ))}
        </div>

        {/* summary tiles — click to filter the table */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
          {tiles.map((t, i) => {
            const active = t.key !== 'any' && bucket === t.key;
            return (
              <button
                key={i}
                onClick={() => (t.key === 'any' ? setBucket('any') : pick(t.key))}
                className={cn(
                  'relative overflow-hidden rounded-xl border bg-surface px-3 pb-3 pt-2.5 text-left transition hover:-translate-y-0.5',
                  active ? 'border-indigo shadow-[0_0_0_3px_hsl(var(--indigo-soft))]' : 'border-border',
                )}
              >
                <div className="text-[9.5px] font-extrabold uppercase tracking-[0.07em] text-muted">{t.label}</div>
                <div className="num mt-1 text-[22px] font-extrabold leading-none tracking-tight">{t.value}</div>
                <div className="mt-1 truncate text-[10.5px] text-muted">{t.foot}</div>
                <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: t.accent }} />
              </button>
            );
          })}
        </div>

        {/* search + export */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {bucket !== 'any' && (
            <button onClick={() => setBucket('any')} className="rounded-lg border border-[hsl(var(--indigo-soft-2))] bg-[hsl(var(--indigo-soft))] px-2.5 py-1 text-[11.5px] font-semibold text-[#3730A3]">
              Showing {shown.length} · clear filter ✕
            </button>
          )}
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search case…" className="w-[200px] rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-[12.5px]" />
          </div>
          <button onClick={exportCsv} className="btn btn-outline"><Download className="h-4 w-4" /> Export</button>
        </div>

        {/* the table */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[920px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-surface-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted">
                <th className="px-3 py-2.5">Client</th>
                {ORDER.map((m, i) => <th key={m} className="px-2 py-2.5">{ORDINAL[i]} instalment</th>)}
                <th className="px-3 py-2.5 text-center">Paid</th>
                <th className="px-3 py-2.5 text-right">Collected</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">No cases match.</td></tr>
              ) : shown.map((r) => {
                const st = STATUS_META[r.status];
                return (
                  <tr
                    key={r.c.id}
                    onClick={() => r.lead && onOpenLead(r.lead.id)}
                    className={cn('border-t border-border align-top transition', r.lead && 'cursor-pointer hover:bg-surface-2/60', r.status === 'left' && 'opacity-75')}
                  >
                    <td className="px-3 py-2.5">
                      <div className="font-semibold leading-tight">{r.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted">
                        <span className="rounded px-1.5 py-[1px] font-bold" style={r.ifv ? { background: '#ECFEFF', color: '#0E7490' } : { background: '#EEF2FF', color: '#4338CA' }}>
                          {r.ifv ? 'IFV' : 'GTV'}
                        </span>
                        {r.c.case_no ? <span>MIG-{r.c.case_no}</span> : null}
                      </div>
                    </td>
                    {r.cells.map((x) => {
                      const s = CELL_STYLE[x.state];
                      const line =
                        x.state === 'paid' ? `✓ ${shortDate(x.lastPaidAt)}`
                        : x.state === 'partial' ? `Part ${formatMoney(x.paid, r.currency)}`
                        : x.state === 'overdue' ? `Overdue${x.dueDate ? ` · ${shortDate(x.dueDate)}` : ''}`
                        : x.state === 'pending' ? `Due${x.dueDate ? ` ${shortDate(x.dueDate)}` : ''}`
                        : '—';
                      return (
                        <td key={x.milestone} className="px-2 py-2">
                          <div
                            className="rounded-lg border px-2 py-1.5"
                            style={{ background: s.bg, color: s.fg, borderColor: s.border }}
                            title={`${x.label}${x.expected ? ` · ${formatMoney(x.expected, r.currency)} due` : ''}${x.paid ? ` · ${formatMoney(x.paid, r.currency)} received` : ''}${x.payments > 1 ? ` in ${x.payments} payments` : ''}`}
                          >
                            <div className="truncate text-[10px] font-semibold opacity-80">{x.label}</div>
                            <div className="truncate text-[11.5px] font-bold">{line}</div>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <div className="num text-[15px] font-extrabold">{r.instalmentsPaid}<span className="text-[11px] font-semibold text-muted"> / 4</span></div>
                      <div className="text-[10.5px] text-muted">{r.paymentsMade} payment{r.paymentsMade === 1 ? '' : 's'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="num font-bold">{formatMoney(r.collected, r.currency)}</div>
                      <div className="text-[10.5px] text-muted">{r.total ? `of ${formatMoney(r.total, r.currency)}` : 'no fee set'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-block rounded-full px-2 py-[3px] text-[11px] font-semibold" style={{ background: st.bg, color: st.fg }}>
                        {r.status === 'left' ? leftLabel(r) : st.label}
                      </span>
                      {r.lastPaidAt && <div className="mt-1 text-[10.5px] text-muted">Last paid {shortDate(r.lastPaidAt)}</div>}
                      <button
                        onClick={(e) => { e.stopPropagation(); setAsk({ row: r, to: r.c.archived_at ? 'reopen' : 'backed_out' }); }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-[2px] text-[10.5px] font-semibold text-muted transition hover:border-ink-2 hover:text-ink"
                      >
                        {r.c.archived_at
                          ? <><RotateCcw className="h-3 w-3" /> Reopen case</>
                          : <><UserX className="h-3 w-3" /> Mark backed out</>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-[11px] text-faint">
          Backed out and Other closed = cases closed in Cases (with that reason). Split payments against one instalment are added together. Collected total across currencies is shown in ₹ at the CRM&apos;s standing rates.
        </p>
      </div>
      <ConfirmDialog
        open={!!ask}
        onClose={() => !busy && setAsk(null)}
        onConfirm={() => void applyAsk()}
        busy={busy}
        variant={ask?.to === 'backed_out' ? 'warning' : 'info'}
        title={ask?.to === 'backed_out' ? `Mark ${ask?.row.name} as backed out?` : `Reopen ${ask?.row.name}'s case?`}
        description={ask?.to === 'backed_out'
          ? 'The case leaves Active cases (here, in Cases and in the sidebar count) and moves to Backed out. Payments, notes and the case form are kept, nothing is sent to the client, and you can reopen it any time.'
          : 'The case goes back to Active cases, here and in Cases. Nothing is sent to the client.'}
        confirmLabel={ask?.to === 'backed_out' ? 'Mark backed out' : 'Reopen case'}
      />
    </CollapsiblePanel>
  );
}
