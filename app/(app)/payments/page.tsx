'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { MILESTONE_META, PAYMENT_META } from '@/lib/types';
import type { Milestone, Payment, Lead } from '@/lib/types';
import { formatMoney, initials, avatarColor, cn } from '@/lib/utils';
import { Plus, Download, Search, IndianRupee, Check, EyeOff, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PaymentsDashboard } from '@/components/payments/payments-dashboard';
import { PaymentRegister } from '@/components/payments/payment-register';

type PaySegment = 'all' | 'active' | 'overdue' | 'completed';

export default function PaymentsPage() {
  const { leads, payments, updateLead, canViewPayments } = useApp();
  const ui = useUI();
  const [seg, setSeg] = useState<PaySegment>('all');
  const [search, setSearch] = useState('');
  const [confirmHide, setConfirmHide] = useState<Lead | null>(null);
  // Set by a dashboard card or a milestone-ladder number: restricts the client
  // list below to exactly the clients that number counted.
  const [dashFilter, setDashFilter] = useState<{ label: string; ids: Set<string> } | null>(null);
  const [showHiddenList, setShowHiddenList] = useState(false);

  // Build per-client payment summary
  const clientRows = useMemo(() => {
    const map = new Map<string, { lead: Lead; payments: Payment[]; collected: number; pending: number; overdue: number; status: 'active' | 'overdue' | 'completed' }>();
    leads.forEach((l) => {
      if (l.hidden_from_payments) return;
      const pays = payments.filter((p) => p.lead_id === l.id);
      const collected = l.amount_paid || 0;
      const pendingAmount = Math.max(0, (l.amount_total || 0) - collected);
      const overdueAmount = l.amount_overdue || 0;
      const completed = l.amount_total > 0 && collected >= l.amount_total;
      if (pays.length > 0 || l.stage === 'won' || l.stage === 'invoice_sent' || (l.amount_total || 0) > 0 || collected > 0 || overdueAmount > 0) {
        map.set(l.id, {
          lead: l,
          payments: pays,
          collected,
          pending: pendingAmount,
          overdue: overdueAmount,
          status: completed ? 'completed' : overdueAmount > 0 ? 'overdue' : 'active',
        });
      }
    });
    return Array.from(map.values());
  }, [leads, payments]);

  const hiddenClients = useMemo(() => leads.filter((l) => l.hidden_from_payments), [leads]);

  // A dashboard drill-in may point at clients who have no payment row yet (a
  // fee was quoted, nothing paid). Those are missing from clientRows, so the
  // filter builds its own rows rather than silently showing fewer people than
  // the number that was clicked.
  const dashRows = useMemo(() => {
    if (!dashFilter) return null;
    const byId = new Map(clientRows.map((r) => [r.lead.id, r]));
    return [...dashFilter.ids]
      .map((id) => {
        const existing = byId.get(id);
        if (existing) return existing;
        const lead = leads.find((l) => l.id === id);
        if (!lead || lead.hidden_from_payments) return null;
        const pays = payments.filter((p) => p.lead_id === lead.id);
        const collected = lead.amount_paid || 0;
        const pendingAmount = Math.max(0, (lead.amount_total || 0) - collected);
        const overdueAmount = lead.amount_overdue || 0;
        const completed = lead.amount_total > 0 && collected >= lead.amount_total;
        return {
          lead, payments: pays, collected, pending: pendingAmount, overdue: overdueAmount,
          status: (completed ? 'completed' : overdueAmount > 0 ? 'overdue' : 'active') as 'active' | 'overdue' | 'completed',
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  }, [dashFilter, clientRows, leads, payments]);

  const filtered = useMemo(() => {
    const base = dashRows ?? clientRows;
    return base.filter((r) => {
      // A drill-in already picked the exact people; the segment chips would
      // only ever subtract from an answer the user just asked for.
      if (!dashFilter && seg !== 'all' && r.status !== seg) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!r.lead.full_name.toLowerCase().includes(q) && !(r.lead.phone || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [clientRows, dashRows, dashFilter, seg, search]);

  const counts = useMemo(() => ({
    all: clientRows.length,
    active: clientRows.filter((r) => r.status === 'active').length,
    overdue: clientRows.filter((r) => r.status === 'overdue').length,
    completed: clientRows.filter((r) => r.status === 'completed').length,
  }), [clientRows]);

  const exportCsv = () => {
    if (payments.length === 0) { toast.error('No payments to export'); return; }
    const headers = ['Client', 'Milestone', 'Amount', 'Currency', 'Status', 'Paid At', 'Note'];
    const rows = payments.map((p) => {
      const l = leads.find((x) => x.id === p.lead_id);
      return [l?.full_name || '—', MILESTONE_META[p.milestone].label, p.amount, l?.currency || 'INR', p.status, p.paid_at || '', p.note || ''];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `migrizo-payments-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${payments.length} payments`);
  };

  if (!canViewPayments) {
    return (
      <div className="px-8 py-16 max-w-md mx-auto text-center">
        <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-4">
          <IndianRupee className="w-5 h-5 text-faint" />
        </div>
        <h2 className="text-[16px] font-semibold mb-1">Payments aren&apos;t available to you</h2>
        <p className="text-[13px] text-muted">Your admin hasn&apos;t enabled payment visibility for your account. Reach out to them if you think this is a mistake.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10 animate-pageIn">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Payments</h1>
          <p className="text-[13.5px] text-muted mt-2">Milestone-based tracking across active clients</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={exportCsv} className="btn btn-outline"><Download className="w-4 h-4" /> Export</button>
          <button onClick={() => ui.openRecordPayment()} className="btn btn-primary"><Plus className="w-4 h-4" /> Record Payment</button>
        </div>
      </div>

      <PaymentsDashboard onFilter={setDashFilter} activeFilter={dashFilter} onOpenLead={ui.openLeadDrawer} />

      {/* The named, dated ledger behind the dashboard's aggregates. */}
      <div className="mb-5">
        <PaymentRegister onOpenLead={ui.openLeadDrawer} />
      </div>

      {/* Drill-in banner: says exactly what restricted the list and how to get
          out of it. A filter you cannot see is a bug report. */}
      {dashFilter && (
        <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-[hsl(var(--indigo-soft-2))] bg-[hsl(var(--indigo-soft))] px-3.5 py-2">
          <span className="text-[12.5px] font-semibold text-[#3730A3]">
            Showing <b>{dashFilter.label}</b> · {dashFilter.ids.size} client{dashFilter.ids.size === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => setDashFilter(null)}
            className="ml-auto rounded-lg border border-[hsl(var(--indigo-soft-2))] bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 transition hover:text-ink"
          >
            Show all clients
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['all', 'active', 'overdue', 'completed'] as PaySegment[]).map((s) => (
          <button key={s} onClick={() => { setSeg(s); setDashFilter(null); }} className={cn('filter-chip', !dashFilter && seg === s && 'active')}>
            {s.charAt(0).toUpperCase() + s.slice(1)} <span className="count" style={s === 'overdue' ? { background: 'hsl(var(--rose-soft))', color: '#B91C1C' } : {}}>{counts[s]}</span>
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client…" className="pl-8 pr-3 py-2 text-[12.5px] w-[240px] rounded-md border border-border bg-surface focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft text-ink" />
        </div>
      </div>

      {/* Client payment list */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="panel py-16 text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-surface-2"><IndianRupee className="w-7 h-7 text-faint" /></div>
            <h3 className="text-[15px] font-semibold mb-1">No payments to show</h3>
            <p className="text-[12.5px] text-muted mb-5">Convert leads or record a payment to populate this view</p>
            <button onClick={() => ui.openRecordPayment()} className="btn btn-primary"><Plus className="w-4 h-4" /> Record first payment</button>
          </div>
        ) : (
          filtered.map((r) => <ClientPaymentRow key={r.lead.id} lead={r.lead} payments={r.payments} currency={r.lead.currency || 'INR'} collected={r.collected} pending={r.pending} overdue={r.overdue} status={r.status} onOpen={() => ui.openLeadDrawer(r.lead.id)} onRecord={() => ui.openRecordPayment(r.lead.id)} onHide={() => setConfirmHide(r.lead)} />)
        )}
      </div>

      {/* Hidden clients section */}
      {hiddenClients.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setShowHiddenList((s) => !s)} className="inline-flex items-center gap-2 text-[12px] font-medium text-muted hover:text-ink mb-3">
            <EyeOff className="w-3.5 h-3.5" />
            {hiddenClients.length} client{hiddenClients.length === 1 ? '' : 's'} hidden from Payments
            <span className="text-faint">· {showHiddenList ? 'hide list' : 'show list'}</span>
          </button>
          {showHiddenList && (
            <div className="space-y-2">
              {hiddenClients.map((l) => (
                <div key={l.id} className="panel p-3 flex items-center gap-3" style={{ opacity: 0.7 }}>
                  <div className="av" style={{ background: avatarColor(l.id), width: 30, height: 30, fontSize: 11 }}>{initials(l.full_name)}</div>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => ui.openLeadDrawer(l.id)} className="text-[13px] font-semibold hover:underline">{l.full_name}</button>
                    <div className="text-[11px] text-muted">{l.visa_type || '—'} · {l.email || l.phone || '—'} · Still in Leads</div>
                  </div>
                  <button onClick={async () => { await updateLead(l.id, { hidden_from_payments: false }); toast.success(`${l.full_name} restored to Payments`); }} className="btn btn-outline btn-sm">
                    <Eye className="w-3.5 h-3.5" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmHide}
        onClose={() => setConfirmHide(null)}
        onConfirm={async () => {
          if (confirmHide) {
            await updateLead(confirmHide.id, { hidden_from_payments: true });
            toast.success(`${confirmHide.full_name} removed from Payments`);
            setConfirmHide(null);
          }
        }}
        title={confirmHide ? `Remove ${confirmHide.full_name} from Payments?` : 'Remove from Payments?'}
        description="This will hide them from the Payments section only. They stay in Leads, Dashboard, Daily Tracker, and Cases. Their payment history is preserved — you can restore them anytime from the hidden list at the bottom of this page."
        confirmLabel="Remove from Payments"
        cancelLabel="Keep here"
        variant="warning"
      />
    </div>
  );
}

function ClientPaymentRow({ lead, payments: pays, currency, collected, pending, overdue, status, onOpen, onRecord, onHide }: { lead: Lead; payments: Payment[]; currency: string; collected: number; pending: number; overdue: number; status: string; onOpen: () => void; onRecord: () => void; onHide: () => void }) {
  const milestones: Milestone[] = ['kickstart', 'profile_building', 'endorsement', 'post_approval'];
  return (
    <div className="panel p-4 flex items-center gap-4 hover:border-border-strong transition-all group">
      <div className="av" style={{ background: avatarColor(lead.id), width: 36, height: 36, fontSize: 13 }}>{initials(lead.full_name)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <button onClick={onOpen} className="text-[14px] font-semibold hover:underline">{lead.full_name}</button>
          {status === 'overdue' && <span className="chip" style={{ background: 'hsl(var(--rose-soft))', color: '#B91C1C', border: 'none' }}>Overdue</span>}
          {status === 'completed' && <span className="chip" style={{ background: 'hsl(var(--green-soft))', color: '#047857', border: 'none' }}>Completed</span>}
        </div>
        <div className="text-[11.5px] text-muted">{lead.visa_type || '—'} · {pays.length}/4 milestones {lead.amount_total > 0 && <>· Total {formatMoney(lead.amount_total, currency)}</>}</div>
      </div>
      <div className="flex items-center gap-1.5">
        {milestones.map((m) => {
          const p = pays.find((x) => x.milestone === m);
          const paid = p?.status === 'paid';
          const overdueRow = p?.status === 'overdue' || (p?.status === 'pending' && p?.due_date && new Date(p.due_date).getTime() < Date.now());
          return (
            <div key={m} title={MILESTONE_META[m].label} className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold"
              style={{
                background: paid ? '#10B981' : overdueRow ? '#EF4444' : p ? 'hsl(var(--amber-soft))' : 'hsl(var(--surface-2))',
                color: paid ? '#fff' : overdueRow ? '#fff' : p ? '#B45309' : 'hsl(var(--faint))',
              }}>
              {paid ? <Check className="w-3.5 h-3.5" /> : MILESTONE_META[m].pct + '%'}
            </div>
          );
        })}
      </div>
      <div className="text-right min-w-[110px]">
        <div className="text-[10px] text-muted uppercase tracking-wider font-semibold">Collected</div>
        <div className="num text-[15px] font-bold mt-0.5" style={{ color: '#0F6E56' }}>{formatMoney(collected, currency)}</div>
        {pending > 0 && (
          <div className="text-[10.5px] num mt-0.5" style={{ color: '#854F0B' }}>
            {formatMoney(pending, currency)} pending
          </div>
        )}
        {overdue > 0 && (
          <div className="text-[10.5px] num font-semibold mt-0.5" style={{ color: '#A32D2D' }}>
            {formatMoney(overdue, currency)} overdue
          </div>
        )}
        {pending === 0 && overdue === 0 && lead.amount_total > 0 && (
          <div className="text-[10.5px] num mt-0.5" style={{ color: '#9CA3AF' }}>Paid in full</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onRecord} className="btn btn-outline btn-sm"><Plus className="w-3.5 h-3.5" /> Log</button>
        <button onClick={onHide} title="Remove from Payments only — lead stays in Leads, Cases &amp; Dashboard" className="btn btn-outline btn-sm text-muted hover:text-danger hover:border-rose-200">
          <EyeOff className="w-3.5 h-3.5" /> Remove
        </button>
      </div>
    </div>
  );
}
