'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { MILESTONE_META, PAYMENT_META } from '@/lib/types';
import type { Milestone, Payment, Lead } from '@/lib/types';
import { formatINR, formatINRFull, initials, avatarColor, timeAgo, cn } from '@/lib/utils';
import { Plus, Download, Search, IndianRupee, Check, Clock, AlertTriangle, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

type PaySegment = 'all' | 'active' | 'overdue' | 'completed';

export default function PaymentsPage() {
  const { leads, payments } = useApp();
  const ui = useUI();
  const [seg, setSeg] = useState<PaySegment>('all');
  const [search, setSearch] = useState('');

  // Build per-client payment summary
  const clientRows = useMemo(() => {
    const map = new Map<string, { lead: Lead; payments: Payment[]; collected: number; status: 'active' | 'overdue' | 'completed' }>();
    leads.forEach((l) => {
      const pays = payments.filter((p) => p.lead_id === l.id);
      const collected = pays.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
      const hasOverdue = pays.some((p) => p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date).getTime() < Date.now()));
      const completed = pays.length >= 4 && pays.every((p) => p.status === 'paid');
      if (pays.length > 0 || l.stage === 'won' || l.stage === 'invoice_sent' || l.amount_paid > 0) {
        map.set(l.id, {
          lead: l,
          payments: pays,
          collected,
          status: completed ? 'completed' : hasOverdue ? 'overdue' : 'active',
        });
      }
    });
    return Array.from(map.values());
  }, [leads, payments]);

  const filtered = useMemo(() => {
    return clientRows.filter((r) => {
      if (seg !== 'all' && r.status !== seg) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!r.lead.full_name.toLowerCase().includes(q) && !(r.lead.phone || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [clientRows, seg, search]);

  const counts = useMemo(() => ({
    all: clientRows.length,
    active: clientRows.filter((r) => r.status === 'active').length,
    overdue: clientRows.filter((r) => r.status === 'overdue').length,
    completed: clientRows.filter((r) => r.status === 'completed').length,
  }), [clientRows]);

  const totals = useMemo(() => {
    const collected = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
    const pending = payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0);
    const overdue = payments.filter((p) => p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date).getTime() < Date.now())).reduce((s, p) => s + p.amount, 0);
    // Forecast = pending in next 30 days + amount_total - amount_paid for active won leads
    const forecast = pending;
    return { collected, pending, overdue, forecast };
  }, [payments]);

  // Milestone pipeline: count clients whose most recent milestone is X
  const milestoneCards = useMemo(() => {
    const out: Record<Milestone, { count: number; amount: number }> = {
      kickstart: { count: 0, amount: 0 },
      profile_building: { count: 0, amount: 0 },
      endorsement: { count: 0, amount: 0 },
      post_approval: { count: 0, amount: 0 },
    };
    clientRows.forEach((r) => {
      if (r.payments.length === 0) {
        out.kickstart.count += 1;
        return;
      }
      const latest = r.payments.sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''))[0];
      out[latest.milestone].count += 1;
      out[latest.milestone].amount += latest.amount;
    });
    return out;
  }, [clientRows]);

  const exportCsv = () => {
    if (payments.length === 0) { toast.error('No payments to export'); return; }
    const headers = ['Client', 'Milestone', 'Amount', 'Status', 'Paid At', 'Note'];
    const rows = payments.map((p) => {
      const l = leads.find((x) => x.id === p.lead_id);
      return [l?.full_name || '—', MILESTONE_META[p.milestone].label, p.amount, p.status, p.paid_at || '', p.note || ''];
    });
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `migrizo-payments-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${payments.length} payments`);
  };

  return (
    <div className="max-w-[1480px] mx-auto px-8 pt-7 pb-10 animate-pageIn">
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

      {/* Payment KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <KPI label="Collected" value={formatINR(totals.collected)} color="#10B981" icon={Check} />
        <KPI label="Pending" value={formatINR(totals.pending)} color="#F59E0B" icon={Clock} />
        <KPI label="Overdue" value={formatINR(totals.overdue)} color="#EF4444" icon={AlertTriangle} />
        <KPI label="Forecast (30d)" value={formatINR(totals.forecast)} color="#6366F1" icon={TrendingUp} />
      </div>

      {/* Milestone Pipeline */}
      <div className="panel panel-pad mb-3">
        <div className="section-h mb-4"><div><h2>Milestone Pipeline</h2><div className="sub">Active clients by current payment stage</div></div></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.keys(MILESTONE_META) as Milestone[]).map((m) => {
            const meta = MILESTONE_META[m];
            const stats = milestoneCards[m];
            return (
              <div key={m} className="rounded-xl border border-border p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{meta.label}</div>
                <div className="flex items-baseline gap-1.5 mt-2"><span className="text-[24px] font-bold num">{stats.count}</span><span className="text-[12px] text-muted">clients</span></div>
                <div className="text-[12px] text-muted mt-1">{meta.pct}% of total fee</div>
                <div className="pbar mt-3"><span style={{ width: `${meta.pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(['all', 'active', 'overdue', 'completed'] as PaySegment[]).map((s) => (
          <button key={s} onClick={() => setSeg(s)} className={cn('filter-chip', seg === s && 'active')}>
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
          filtered.map((r) => <ClientPaymentRow key={r.lead.id} lead={r.lead} payments={r.payments} collected={r.collected} status={r.status} onOpen={() => ui.openLeadDrawer(r.lead.id)} onRecord={() => ui.openRecordPayment(r.lead.id)} />)
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, color, icon: Icon }: { label: string; value: string; color: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }) {
  return (
    <div className="kpi">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <Icon className="w-3.5 h-3.5" style={{ color }} />
      </div>
      <div className="text-[26px] font-bold tracking-tight leading-none mt-3.5 num" style={{ color }}>{value}</div>
    </div>
  );
}

function ClientPaymentRow({ lead, payments: pays, collected, status, onOpen, onRecord }: { lead: Lead; payments: Payment[]; collected: number; status: string; onOpen: () => void; onRecord: () => void }) {
  const milestones: Milestone[] = ['kickstart', 'profile_building', 'endorsement', 'post_approval'];
  return (
    <div className="panel p-4 flex items-center gap-4 hover:border-border-strong transition-all">
      <div className="av" style={{ background: avatarColor(lead.id), width: 36, height: 36, fontSize: 13 }}>{initials(lead.full_name)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <button onClick={onOpen} className="text-[14px] font-semibold hover:underline">{lead.full_name}</button>
          {status === 'overdue' && <span className="chip" style={{ background: 'hsl(var(--rose-soft))', color: '#B91C1C', border: 'none' }}>Overdue</span>}
          {status === 'completed' && <span className="chip" style={{ background: 'hsl(var(--green-soft))', color: '#047857', border: 'none' }}>Completed</span>}
        </div>
        <div className="text-[11.5px] text-muted">{lead.visa_type || '—'} · {pays.length}/4 milestones</div>
      </div>
      <div className="flex items-center gap-1.5">
        {milestones.map((m) => {
          const p = pays.find((x) => x.milestone === m);
          const paid = p?.status === 'paid';
          const overdue = p?.status === 'overdue' || (p?.status === 'pending' && p?.due_date && new Date(p.due_date).getTime() < Date.now());
          return (
            <div key={m} title={MILESTONE_META[m].label} className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold"
              style={{
                background: paid ? '#10B981' : overdue ? '#EF4444' : p ? 'hsl(var(--amber-soft))' : 'hsl(var(--surface-2))',
                color: paid ? '#fff' : overdue ? '#fff' : p ? '#B45309' : 'hsl(var(--faint))',
              }}>
              {paid ? <Check className="w-3.5 h-3.5" /> : MILESTONE_META[m].pct + '%'}
            </div>
          );
        })}
      </div>
      <div className="text-right min-w-[100px]">
        <div className="text-[11px] text-muted uppercase tracking-wider font-semibold">Collected</div>
        <div className="num text-[16px] font-bold mt-0.5">{formatINR(collected)}</div>
      </div>
      <button onClick={onRecord} className="btn btn-outline btn-sm"><Plus className="w-3.5 h-3.5" /> Log</button>
    </div>
  );
}
