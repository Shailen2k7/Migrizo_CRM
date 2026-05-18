'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { Topbar } from '@/components/topbar';
import { KPICards, AIInsightsStrip, ActivityFeed } from '@/components/dashboard/dashboard-bits';
import { FunnelChart, TemperatureDonut, DailyChart, RevenueChart } from '@/components/dashboard/charts';
import { Bell, X, ArrowRight, UserPlus, UploadCloud, PhoneCall, AlertTriangle, ArrowUpRight } from 'lucide-react';
import { greeting, todayDateString, timeAgo } from '@/lib/utils';

export default function DashboardPage() {
  const router = useRouter();
  const { leads, payments, activity, user } = useApp();
  const ui = useUI();
  const [notifOpen, setNotifOpen] = useState(false);

  const notifications = useMemo(() => {
    const out: { id: string; type: 'overdue-fu' | 'overdue-pay' | 'hot'; text: string; leadId?: string; time: string }[] = [];
    const now = Date.now();
    leads.forEach((l) => {
      if (l.next_follow_up && new Date(l.next_follow_up).getTime() < now && !['won', 'lost'].includes(l.stage)) {
        out.push({ id: 'fu-' + l.id, type: 'overdue-fu', text: `Follow-up overdue for ${l.full_name}`, leadId: l.id, time: timeAgo(l.next_follow_up) });
      }
    });
    payments.forEach((p) => {
      if (p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date).getTime() < now)) {
        const lead = leads.find((l) => l.id === p.lead_id);
        out.push({ id: 'pay-' + p.id, type: 'overdue-pay', text: `Payment overdue for ${lead?.full_name || 'client'}`, leadId: p.lead_id, time: timeAgo(p.due_date) });
      }
    });
    return out.slice(0, 20);
  }, [leads, payments]);

  const followUpsToday = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    return leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() >= today.getTime() && new Date(l.next_follow_up).getTime() < tomorrow.getTime()).length;
  }, [leads]);

  const overdueCount = useMemo(() => leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() < Date.now() && !['won', 'lost'].includes(l.stage)).length, [leads]);

  return (
    <div className="max-w-[1480px] mx-auto px-8 pt-7 pb-10 animate-pageIn">
      <div className="flex items-start justify-between mb-7 gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] md:text-[30px] font-bold tracking-tight leading-[1.1] flex items-center gap-2.5">
            {greeting()}, {user.name.split(' ')[0]} <span style={{ transform: 'translateY(-2px)', display: 'inline-block' }}>👋</span>
          </h1>
          <p className="text-[13.5px] text-muted mt-2">{todayDateString()}</p>
        </div>
        <Topbar leads={leads} notifCount={notifications.length} onAddLead={ui.openAddLead} onImport={ui.openImport} onOpenNotifs={() => setNotifOpen((v) => !v)} onOpenLead={ui.openLeadDrawer} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-3">
        <KPICards leads={leads} payments={payments} />
      </div>

      <AIInsightsStrip leads={leads} payments={payments} />

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3 mb-3">
        <div className="panel panel-pad">
          <div className="section-h mb-5"><div><h2>Lead Funnel</h2><div className="sub">Current pipeline by stage</div></div></div>
          <FunnelChart leads={leads} />
        </div>
        <div className="panel panel-pad">
          <div className="section-h mb-5"><div><h2>Lead Temperature</h2><div className="sub">Distribution by quality</div></div></div>
          <TemperatureDonut leads={leads} />
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
        <div className="panel panel-pad"><div className="section-h mb-5"><div><h2>Daily New Leads</h2><div className="sub">Last 14 days inflow</div></div></div><DailyChart leads={leads} /></div>
        <div className="panel panel-pad"><div className="section-h mb-5"><div><h2>Revenue Trend</h2><div className="sub">Last 6 months closed revenue</div></div></div><RevenueChart payments={payments} /></div>
      </div>

      {/* Activity + Quick Access */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-3">
        <div className="panel panel-pad">
          <div className="section-h mb-2"><div><h2>Recent Activity</h2><div className="sub">Latest movements across the team</div></div><button onClick={() => router.push('/leads')} className="btn btn-ghost btn-sm">View all <ArrowRight className="w-3.5 h-3.5" /></button></div>
          <ActivityFeed activity={activity} leads={leads} />
        </div>
        <div className="space-y-3">
          <div className="section-h"><h2 className="text-[14px] font-semibold">Quick Access</h2></div>
          <QA onClick={ui.openAddLead} icon={UserPlus} bg="hsl(var(--indigo-soft))" color="#4338CA" title="Add a new lead" sub="Capture an inquiry in 10 seconds" />
          <QA onClick={ui.openImport} icon={UploadCloud} bg="#EDE9FE" color="#7C3AED" title="Import from Zoho Bigin" sub="CSV or Excel · auto-mapped" />
          <QA onClick={() => router.push('/leads?segment=today')} icon={PhoneCall} bg="hsl(var(--amber-soft))" color="#B45309" title="Today's follow-ups" sub={`${followUpsToday} calls scheduled`} />
          <QA onClick={() => router.push('/leads?segment=overdue')} icon={AlertTriangle} bg="hsl(var(--rose-soft))" color="#B91C1C" title="Overdue items" sub={`${overdueCount} need attention`} />
        </div>
      </div>

      {/* Notifications panel */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} />
          <div className="fixed top-[88px] right-8 w-[360px] panel shadow-lg z-40">
            <div className="panel-pad pb-3 flex items-center justify-between border-b border-border">
              <h3 className="text-[14px] font-semibold">Notifications</h3>
              <button onClick={() => setNotifOpen(false)} className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-2 max-h-[440px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-10 text-center text-[12.5px] text-muted">All clear ✨</div>
              ) : (
                notifications.map((n) => (
                  <button key={n.id} onClick={() => { if (n.leadId) ui.openLeadDrawer(n.leadId); setNotifOpen(false); }} className="w-full flex items-start gap-3 p-3 rounded-md hover:bg-surface-2 text-left">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'hsl(var(--rose-soft))', color: '#B91C1C' }}><AlertTriangle className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-medium leading-tight">{n.text}</div>
                      <div className="text-[11px] text-muted mt-0.5">{n.time}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function QA({ onClick, icon: Icon, bg, color, title, sub }: { onClick: () => void; icon: React.ComponentType<{ className?: string }>; bg: string; color: string; title: string; sub: string }) {
  return (
    <button onClick={onClick} className="w-full text-left bg-surface border border-border rounded-xl p-3.5 hover:border-border-strong hover:-translate-y-px hover:shadow-md transition-all flex items-start gap-3">
      <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: bg, color }}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[11.5px] text-muted mt-0.5">{sub}</div>
      </div>
      <ArrowUpRight className="w-3.5 h-3.5 text-faint" />
    </button>
  );
}
