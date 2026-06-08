'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Users, Target, Clock, IndianRupee, BarChart3, Sparkles, ArrowRight, MessageSquarePlus, UserPlus, ArrowRightCircle } from 'lucide-react';
import type { Lead, Payment, Activity } from '@/lib/types';
import { STAGE_META } from '@/lib/types';
import { formatINR, timeAgo, initials, avatarColor } from '@/lib/utils';

// =========================================
// KPI Cards
// =========================================
export function KPICards({ leads, payments, canViewPayments = true }: { leads: Lead[]; payments: Payment[]; canViewPayments?: boolean }) {
  const stats = useMemo(() => {
    const now = Date.now(); const weekMs = 7 * 86400000;
    const newThisWeek = leads.filter((l) => now - new Date(l.created_at).getTime() < weekMs).length;
    const newPrevWeek = leads.filter((l) => {
      const t = new Date(l.created_at).getTime();
      return t < now - weekMs && t >= now - 2 * weekMs;
    }).length;
    const weekDelta = newPrevWeek === 0 ? null : ((newThisWeek - newPrevWeek) / newPrevWeek) * 100;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const followUpsToday = leads.filter((l) => {
      if (!l.next_follow_up) return false;
      const t = new Date(l.next_follow_up).getTime();
      return t >= today.getTime() && t < tomorrow.getTime();
    }).length;

    const overdue = leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() < now && l.stage !== 'won' && l.stage !== 'junk').length;

    // Revenue reads the SAME source as the Payments tab (lead-level amount_paid,
    // excluding leads hidden from payments) so the two screens always agree.
    const paymentLeads = leads.filter((l) => !l.hidden_from_payments);
    const revenueCollected = paymentLeads.reduce((s, l) => s + (l.amount_paid || 0), 0);
    const revenuePending = paymentLeads.reduce((s, l) => s + Math.max(0, (l.amount_total || 0) - (l.amount_paid || 0)), 0);

    const wonCount = leads.filter((l) => l.stage === 'won').length;
    const closableCount = leads.filter((l) => !['won', 'junk'].includes(l.stage)).length;
    const conversion = closableCount === 0 ? 0 : (wonCount / (wonCount + closableCount)) * 100;

    return { newThisWeek, weekDelta, followUpsToday, overdue, revenueCollected, revenuePending, conversion, wonCount };
  }, [leads, payments]);

  const cards = [
    { label: 'New this week', value: stats.newThisWeek, sub: stats.weekDelta != null ? `${stats.weekDelta >= 0 ? '+' : ''}${stats.weekDelta.toFixed(0)}% vs last week` : 'No prior data', deltaPositive: (stats.weekDelta ?? 0) >= 0, icon: Users },
    { label: 'Follow-ups today', value: stats.followUpsToday, sub: stats.overdue > 0 ? `${stats.overdue} overdue` : 'On track', deltaPositive: stats.overdue === 0, icon: Clock },
    { label: 'Revenue collected', value: formatINR(stats.revenueCollected), sub: `${formatINR(stats.revenuePending)} outstanding`, deltaPositive: true, icon: IndianRupee, isMoney: true, money: true },
    { label: 'Closed won', value: stats.wonCount, sub: `${stats.conversion.toFixed(0)}% conversion`, deltaPositive: stats.conversion >= 20, icon: Target },
    { label: 'Active pipeline', value: leads.filter((l) => !['won', 'junk', 'won'].includes(l.stage)).length, sub: 'In active stages', deltaPositive: true, icon: BarChart3 },
  ].filter((c) => canViewPayments || !(c as { money?: boolean }).money);

  return (
    <>
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="kpi transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.label}</span>
              <Icon className="w-3.5 h-3.5 text-faint" />
            </div>
            <div className={`text-[30px] font-bold tracking-tight leading-none mt-3.5 num ${c.isMoney ? 'text-success-dark dark:text-success' : 'text-ink'}`}>
              {c.value}
            </div>
            <div className="flex items-center gap-1 text-[11.5px] mt-2 text-muted">
              {c.deltaPositive ? <TrendingUp className="w-3 h-3 text-success" /> : <TrendingDown className="w-3 h-3 text-warning" />}
              <span className="truncate">{c.sub}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

// =========================================
// AI Insights — computed live from data
// =========================================
export function computeInsight(leads: Lead[], payments: Payment[]): string {
  const now = Date.now();
  const overdueFu = leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() < now && l.stage !== 'won' && l.stage !== 'junk');
  if (overdueFu.length > 0) {
    return `${overdueFu.length} lead${overdueFu.length > 1 ? 's' : ''} have overdue follow-ups. The longer you wait, the colder they get — consider clearing this list before noon.`;
  }
  const proposals = leads.filter((l) => l.stage === 'invoice_sent');
  if (proposals.length >= 3) {
    return `${proposals.length} clients are at proposal stage. Following up within 48hrs of sending a proposal increases close rates by ~30%.`;
  }
  const hot = leads.filter((l) => l.score >= 75 && !['won', 'junk'].includes(l.stage));
  if (hot.length > 0) {
    return `You have ${hot.length} hot lead${hot.length > 1 ? 's' : ''} in your pipeline. Prioritize these — they're 3x more likely to close.`;
  }
  return `Pipeline is healthy. Add new leads or import from Zoho Bigin to grow it.`;
}

export function AIInsightsStrip({ leads, payments }: { leads: Lead[]; payments: Payment[] }) {
  const text = useMemo(() => computeInsight(leads, payments), [leads, payments]);
  return (
    <div className="panel panel-pad mb-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#6366F1,#7C3AED)', color: '#fff' }}>
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-semibold">AI Insights</h3>
            <span className="chip" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA', border: 'none' }}>Live</span>
          </div>
          <div className="text-[13px] text-ink-2">{text}</div>
        </div>
      </div>
    </div>
  );
}

// =========================================
// Activity feed
// =========================================
const ACTION_LABEL: Record<string, { icon: React.ComponentType<{ className?: string }>; verb: string; color: string }> = {
  created_lead:      { icon: UserPlus, verb: 'added', color: '#6366F1' },
  moved_stage:       { icon: ArrowRightCircle, verb: 'moved', color: '#7C3AED' },
  added_note:        { icon: MessageSquarePlus, verb: 'noted', color: '#3B82F6' },
  recorded_payment:  { icon: IndianRupee, verb: 'logged payment', color: '#10B981' },
  imported_leads:    { icon: Users, verb: 'imported', color: '#F59E0B' },
};

export function ActivityFeed({ activity, leads, memberNameById }: { activity: Activity[]; leads: Lead[]; memberNameById: (id: string | null | undefined) => string }) {
  if (activity.length === 0) return <div className="py-10 text-center text-[12.5px] text-muted">No activity yet</div>;
  return (
    <div>
      {activity.slice(0, 12).map((a) => {
        const meta = ACTION_LABEL[a.action] || { icon: Sparkles, verb: a.action, color: '#9CA3AF' };
        const Icon = meta.icon;
        const lead = a.lead_id ? leads.find((l) => l.id === a.lead_id) : null;
        const actor = memberNameById(a.user_id);
        const label = (() => {
          if (a.action === 'created_lead') return <><span className="font-semibold">{actor}</span> added new lead <span className="font-semibold">{(a.meta as { name?: string }).name || lead?.full_name || '—'}</span></>;
          if (a.action === 'moved_stage') {
            const m = a.meta as { from?: string; to?: string };
            return <><span className="font-semibold">{actor}</span> moved <span className="font-semibold">{lead?.full_name || 'a lead'}</span> from <span className="text-muted">{m.from}</span> → <span className="font-medium">{m.to}</span></>;
          }
          if (a.action === 'added_note') return <><span className="font-semibold">{actor}</span> added a note on <span className="font-semibold">{lead?.full_name || 'a lead'}</span></>;
          if (a.action === 'recorded_payment') {
            const m = a.meta as { amount?: number };
            return <><span className="font-semibold">{actor}</span> logged <span className="font-semibold">{formatINR(m.amount || 0)}</span> payment for <span className="font-semibold">{lead?.full_name || 'client'}</span></>;
          }
          if (a.action === 'imported_leads') return <><span className="font-semibold">{actor}</span> imported <span className="font-semibold">{(a.meta as { count?: number }).count || 0}</span> leads</>;
          return <><span className="font-semibold">{actor}</span> · {a.action}</>;
        })();
        return (
          <div key={a.id} className="flex gap-3 py-3 border-b border-border last:border-0">
            <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: meta.color + '20', color: meta.color }}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] text-ink-2 leading-snug">{label}</div>
              <div className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5">
                <span>{timeAgo(a.created_at)}</span>
                <span className="text-faint">·</span>
                <span className="text-faint">{new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
