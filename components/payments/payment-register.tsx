'use client';

// ============================================================================
// PAYMENT REGISTER — who paid, how much, and when. Grouped by the month the
// money actually arrived.
//
// WHY THIS EXISTS SEPARATELY FROM THE DASHBOARD
// The dashboard answers "how are we doing" in aggregate. In a review meeting
// the very next question is always "who?" — and until now the only way to
// answer it was to open clients one at a time. This is the ledger view: every
// payment received, named, dated, and totalled by month.
//
// WHY THE DATE IS EDITABLE HERE
// recordPayment stamped paid_at with `new Date()` — the moment somebody typed
// the payment into the CRM, not the moment the money landed. Every payment
// entered during the initial data load therefore carries that load's date, so
// clients who converted in March or April all appear under whichever month the
// CRM went live. The money is not missing; it is filed under the wrong month.
// Nothing can fix that automatically — only the person who knows when the
// payment actually came in can. So the date is editable in place, right next
// to the name, where the correction is obvious and takes one click.
// ============================================================================

import { useMemo, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { MILESTONE_META } from '@/lib/types';
import type { Payment, Lead } from '@/lib/types';
import { formatMoney, formatINR, toINR, initials, avatarColor, cn } from '@/lib/utils';
import { CollapsiblePanel, PanelTitle } from '@/components/shared/dash-ui';
import { Calendar, Check, X, AlertTriangle, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface Row {
  payment: Payment;
  lead: Lead;
  ccy: string;
  /** Payment currency disagrees with the client's — excluded from totals. */
  conflicted: boolean;
}

interface MonthGroup {
  key: string;          // 'YYYY-MM', or 'undated'
  label: string;        // 'May 2026'
  rows: Row[];
  totalINR: number;
  clients: number;
  conflicts: number;
}

const UNDATED = 'undated';

function monthKeyOf(iso: string | null): string {
  if (!iso) return UNDATED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return UNDATED;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(key: string): string {
  if (key === UNDATED) return 'Date not recorded';
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** YYYY-MM-DD in LOCAL time — toISOString() would shift IST back a day. */
function dateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function PaymentRegister({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const { leads, payments, updatePayment } = useApp();
  const [openKeys, setOpenKeys] = useState<Set<string> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  /**
   * Only money that actually arrived. A pending or overdue row is a promise,
   * and putting promises in a register of receipts is how a review meeting
   * ends up celebrating revenue nobody has.
   */
  const groups = useMemo<MonthGroup[]>(() => {
    const byMonth = new Map<string, Row[]>();

    for (const p of payments) {
      if (p.status !== 'paid') continue;
      const lead = leadById.get(p.lead_id);
      if (!lead || lead.is_sample || lead.hidden_from_payments) continue;

      const ccy = lead.currency || 'INR';
      const row: Row = { payment: p, lead, ccy, conflicted: !!p.currency && p.currency !== ccy };
      const k = monthKeyOf(p.paid_at);
      const list = byMonth.get(k);
      if (list) list.push(row); else byMonth.set(k, [row]);
    }

    const out: MonthGroup[] = [];
    for (const [key, rows] of byMonth) {
      rows.sort((a, b) => {
        const ta = a.payment.paid_at ? new Date(a.payment.paid_at).getTime() : 0;
        const tb = b.payment.paid_at ? new Date(b.payment.paid_at).getTime() : 0;
        return tb - ta || a.lead.full_name.localeCompare(b.lead.full_name);
      });
      out.push({
        key,
        label: monthLabelOf(key),
        rows,
        // Conflicted rows are excluded, exactly as they are on the dashboard,
        // so the two views can never disagree about a month's total.
        totalINR: rows.reduce((s, r) => s + (r.conflicted ? 0 : toINR(r.payment.amount || 0, r.ccy)), 0),
        clients: new Set(rows.map((r) => r.lead.id)).size,
        conflicts: rows.filter((r) => r.conflicted).length,
      });
    }

    // Newest month first; undated pinned to the top because it needs fixing.
    out.sort((a, b) => {
      if (a.key === UNDATED) return -1;
      if (b.key === UNDATED) return 1;
      return b.key.localeCompare(a.key);
    });
    return out;
  }, [payments, leadById]);

  const grand = useMemo(() => ({
    inr: groups.reduce((s, g) => s + g.totalINR, 0),
    count: groups.reduce((s, g) => s + g.rows.length, 0),
    clients: new Set(groups.flatMap((g) => g.rows.map((r) => r.lead.id))).size,
  }), [groups]);

  // Null means "never touched" → everything open, which is what a review wants.
  const isOpen = (k: string) => (openKeys === null ? true : openKeys.has(k));
  const toggle = (k: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev ?? groups.map((g) => g.key));
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const allOpen = groups.length > 0 && groups.every((g) => isOpen(g.key));

  const beginEdit = (p: Payment) => { setEditing(p.id); setDraft(dateInputValue(p.paid_at)); };
  const cancelEdit = () => { setEditing(null); setDraft(''); };

  const commit = async (p: Payment) => {
    if (!draft) { toast.error('Pick a date first'); return; }
    // Noon local, so a timezone shift can never move it across a month boundary.
    const next = new Date(`${draft}T12:00:00`);
    if (Number.isNaN(next.getTime())) { toast.error('That date is not valid'); return; }
    if (next.getTime() > Date.now()) { toast.error('A payment cannot be received in the future'); return; }
    setSaving(true);
    try {
      await updatePayment(p.id, { paid_at: next.toISOString() });
      toast.success(`Moved to ${next.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`);
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  if (groups.length === 0) {
    return (
      <CollapsiblePanel storageKey="payments.register" title="Payment register"
        sub="Every payment received, grouped by the month it arrived.">
        <div className="py-8 text-center text-[12.5px] text-muted">No payments recorded yet.</div>
      </CollapsiblePanel>
    );
  }

  return (
    <CollapsiblePanel
      storageKey="payments.register"
      title="Payment register — who paid, and when"
      sub="Every payment received, grouped by the month the money arrived. Click any date to correct it."
      right={
        <span className="num text-[11.5px] text-faint">
          {formatINR(grand.inr)} · {grand.count} payment{grand.count === 1 ? '' : 's'} · {grand.clients} client{grand.clients === 1 ? '' : 's'}
        </span>
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <PanelTitle sub="Totals convert to INR at the standing rate and exclude rows whose currency disagrees with the client's.">
          By month
        </PanelTitle>
        <button
          onClick={() => setOpenKeys(allOpen ? new Set() : new Set(groups.map((g) => g.key)))}
          className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:text-ink"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="space-y-2">
        {groups.map((g) => {
          const open = isOpen(g.key);
          const undated = g.key === UNDATED;
          return (
            <div key={g.key} className={cn('overflow-hidden rounded-xl border', undated ? 'border-[#FDE68A]' : 'border-border')}>
              {/* Month header — the whole bar is the toggle. */}
              <button
                onClick={() => toggle(g.key)}
                className={cn(
                  'flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition',
                  undated ? 'bg-[hsl(var(--amber-soft))]' : 'bg-surface-2 hover:bg-surface',
                )}
              >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
                <span className="text-[13px] font-bold text-ink">{g.label}</span>
                {undated && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#FDE68A] px-1.5 py-0.5 text-[10px] font-bold text-[#92400E]">
                    <AlertTriangle className="h-3 w-3" /> needs a date
                  </span>
                )}
                <span className="ml-auto flex items-center gap-3 text-[11.5px] text-muted">
                  <span>{g.rows.length} payment{g.rows.length === 1 ? '' : 's'}</span>
                  <span className="hidden sm:inline">{g.clients} client{g.clients === 1 ? '' : 's'}</span>
                  <b className="num text-[13px] text-ink">{formatINR(g.totalINR)}</b>
                </span>
              </button>

              {open && (
                <div className="divide-y divide-border">
                  {g.rows.map(({ payment: p, lead, ccy, conflicted }) => (
                    <div key={p.id} className="flex items-center gap-3 bg-surface px-3.5 py-2.5">
                      <div className="av shrink-0" style={{ background: avatarColor(lead.id), width: 28, height: 28, fontSize: 11 }}>
                        {initials(lead.full_name)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <button onClick={() => onOpenLead(lead.id)} className="truncate text-[13px] font-semibold hover:underline">
                          {lead.full_name}
                        </button>
                        <div className="text-[11px] text-muted">
                          {MILESTONE_META[p.milestone]?.label || p.milestone}
                          {p.note ? ` · ${p.note}` : ''}
                        </div>
                      </div>

                      {conflicted && (
                        <span
                          title={`This payment is recorded in ${p.currency} but the client is billed in ${ccy}. It is left out of the totals until one of them is corrected.`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[hsl(var(--rose-soft))] px-1.5 py-0.5 text-[10px] font-bold text-[#B91C1C]"
                        >
                          <AlertTriangle className="h-3 w-3" /> {p.currency} vs {ccy}
                        </span>
                      )}

                      <div className={cn('num shrink-0 text-right text-[13px] font-bold', conflicted && 'text-faint line-through')}>
                        {formatMoney(p.amount || 0, ccy)}
                      </div>

                      {/* The date, editable in place. */}
                      <div className="w-[168px] shrink-0 text-right">
                        {editing === p.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="date"
                              autoFocus
                              value={draft}
                              max={dateInputValue(new Date().toISOString())}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commit(p);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              className="w-[124px] rounded-md border border-indigo bg-surface px-1.5 py-1 text-[11.5px] text-ink focus:outline-none focus:ring-4 focus:ring-indigo-soft"
                            />
                            <button onClick={() => commit(p)} disabled={saving}
                              className="rounded-md bg-indigo p-1 text-white disabled:opacity-50" title="Save">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={cancelEdit} className="rounded-md border border-border p-1 text-muted" title="Cancel">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => beginEdit(p)}
                            className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-muted transition hover:bg-surface-2 hover:text-ink"
                            title="Change the date this payment was received"
                          >
                            <Calendar className="h-3 w-3 text-faint group-hover:text-indigo" />
                            {p.paid_at
                              ? new Date(p.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                              : <span className="font-semibold text-[#B45309]">set date</span>}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {g.conflicts > 0 && (
                    <div className="bg-surface px-3.5 py-2 text-[11px] text-muted">
                      {g.conflicts} row{g.conflicts === 1 ? '' : 's'} left out of this month&apos;s total because the
                      payment currency and the client currency disagree.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CollapsiblePanel>
  );
}
