'use client';

import { useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { Sparkles, Clock, IndianRupee, TrendingUp, Phone, AlertTriangle, Target, Zap } from 'lucide-react';
import { formatINR, timeAgo } from '@/lib/utils';

interface Insight {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  cta?: { label: string; onClick: () => void };
  color: string;
  bg: string;
}

export default function AIPage() {
  const { leads, payments } = useApp();
  const ui = useUI();

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    const now = Date.now();

    const overdueFu = leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() < now && !['won', 'lost'].includes(l.stage));
    if (overdueFu.length > 0) {
      out.push({
        icon: Clock, color: '#B91C1C', bg: 'hsl(var(--rose-soft))',
        title: `${overdueFu.length} overdue follow-up${overdueFu.length > 1 ? 's' : ''}`,
        body: `These leads were promised a call/email but haven't been contacted. Every day they wait, the close rate drops ~5%.`,
      });
    }

    const hot = leads.filter((l) => l.score >= 75 && !['won', 'lost'].includes(l.stage));
    if (hot.length > 0) {
      out.push({
        icon: Zap, color: '#F59E0B', bg: 'hsl(var(--amber-soft))',
        title: `${hot.length} hot lead${hot.length > 1 ? 's' : ''} in pipeline`,
        body: `High-score leads close 3x more often. Schedule calls for these clients today to maximise conversion.`,
      });
    }

    const proposals = leads.filter((l) => l.stage === 'proposal');
    if (proposals.length > 0) {
      out.push({
        icon: Target, color: '#4338CA', bg: 'hsl(var(--indigo-soft))',
        title: `${proposals.length} client${proposals.length > 1 ? 's' : ''} at proposal stage`,
        body: `Following up within 48 hours of sending a proposal lifts close rates by ~30%. Prioritize these accounts.`,
      });
    }

    const overduePay = payments.filter((p) => p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date).getTime() < now));
    const overdueAmt = overduePay.reduce((s, p) => s + p.amount, 0);
    if (overdueAmt > 0) {
      out.push({
        icon: AlertTriangle, color: '#B91C1C', bg: 'hsl(var(--rose-soft))',
        title: `${formatINR(overdueAmt)} in overdue payments`,
        body: `${overduePay.length} milestone payment${overduePay.length > 1 ? 's are' : ' is'} past due. Send polite reminders within 24h.`,
      });
    }

    // Conversion insight
    const wonCount = leads.filter((l) => l.stage === 'won').length;
    const totalClosed = wonCount + leads.filter((l) => l.stage === 'lost').length;
    if (totalClosed >= 5) {
      const rate = (wonCount / totalClosed) * 100;
      out.push({
        icon: TrendingUp, color: rate >= 30 ? '#047857' : '#B45309', bg: rate >= 30 ? 'hsl(var(--green-soft))' : 'hsl(var(--amber-soft))',
        title: `${rate.toFixed(0)}% win rate`,
        body: rate >= 30
          ? `Excellent close rate. Your qualification process is working — keep it consistent.`
          : `Below industry average (~30%). Audit your qualification criteria to filter low-fit leads earlier.`,
      });
    }

    // Stale leads
    const stale = leads.filter((l) => {
      const last = new Date(l.last_note_at || l.updated_at).getTime();
      return now - last > 7 * 86400000 && !['won', 'lost'].includes(l.stage);
    });
    if (stale.length > 0) {
      out.push({
        icon: Clock, color: '#7A7A82', bg: 'hsl(var(--surface-2))',
        title: `${stale.length} stale lead${stale.length > 1 ? 's' : ''}`,
        body: `Haven't been touched in 7+ days. Either re-engage with a check-in, or move them to "Closed lost" to clean your pipeline.`,
      });
    }

    if (out.length === 0) {
      out.push({
        icon: Sparkles, color: '#10B981', bg: 'hsl(var(--green-soft))',
        title: 'Pipeline looks healthy',
        body: `No urgent issues right now. Use this clear window to prospect — add new leads or import from Zoho Bigin.`,
        cta: { label: 'Import leads', onClick: ui.openImport },
      });
    }

    return out;
  }, [leads, payments, ui]);

  const actions = useMemo(() => {
    const now = Date.now(); const out: { label: string; sub: string; onClick: () => void }[] = [];
    const overdueFu = leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() < now && !['won', 'lost'].includes(l.stage));
    overdueFu.slice(0, 5).forEach((l) => out.push({ label: `Call ${l.full_name}`, sub: `Follow-up overdue · ${timeAgo(l.next_follow_up)}`, onClick: () => ui.openLeadDrawer(l.id) }));
    const hot = leads.filter((l) => l.score >= 75 && l.stage === 'proposal');
    hot.slice(0, 3).forEach((l) => out.push({ label: `Close ${l.full_name}`, sub: 'Hot proposal stage — push for decision', onClick: () => ui.openLeadDrawer(l.id) }));
    return out;
  }, [leads, ui]);

  return (
    <div className="max-w-[1480px] mx-auto px-8 pt-7 pb-10 animate-pageIn">
      <div className="mb-6">
        <h1 className="text-[28px] font-bold tracking-tight leading-[1.1] flex items-center gap-2.5">
          AI COO <span className="chip" style={{ background: 'linear-gradient(135deg, hsl(var(--indigo-soft)), #EDE9FE)', color: '#4338CA', border: 'none' }}>Beta</span>
        </h1>
        <p className="text-[13.5px] text-muted mt-2">Computed insights and recommendations from your live data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {insights.map((i, idx) => {
          const Icon = i.icon;
          return (
            <div key={idx} className="panel panel-pad">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: i.bg, color: i.color }}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[14px] font-semibold mb-1">{i.title}</h3>
                  <p className="text-[12.5px] text-ink-2 leading-relaxed">{i.body}</p>
                  {i.cta && <button onClick={i.cta.onClick} className="btn btn-outline btn-sm mt-3">{i.cta.label}</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel panel-pad">
        <h2 className="text-[15px] font-semibold mb-4">Suggested actions for today</h2>
        {actions.length === 0 ? (
          <div className="py-8 text-center text-[12.5px] text-muted">Nothing urgent right now. Use this time to prospect.</div>
        ) : (
          <div className="space-y-2">
            {actions.map((a, i) => (
              <button key={i} onClick={a.onClick} className="w-full flex items-center gap-3 p-3 rounded-md border border-border hover:border-border-strong hover:bg-surface-2 text-left transition-all">
                <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA' }}>
                  <Phone className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium">{a.label}</div>
                  <div className="text-[11.5px] text-muted">{a.sub}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
