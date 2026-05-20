'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import type { FollowUp } from '@/lib/types';
import { isFollowUpOverdue, isFollowUpToday, isFollowUpThisWeek } from '@/lib/types';
import { Plus, Search, CalendarClock, AlertCircle, CalendarCheck2, Calendar, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FollowUpsList } from '@/components/followups/followups-list';
import { AddFollowUpDialog } from '@/components/followups/add-followup-dialog';
import { LeadDrawer } from '@/components/leads/lead-drawer';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';

type Segment = 'today' | 'overdue' | 'upcoming' | 'completed' | 'all';

export default function FollowUpsPage() {
  const { followUps } = useApp();
  const [segment, setSegment] = useState<Segment>('today');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [paymentLeadId, setPaymentLeadId] = useState<string | null>(null);

  const counts = useMemo(() => ({
    overdue:   followUps.filter(isFollowUpOverdue).length,
    today:     followUps.filter(isFollowUpToday).length,
    thisWeek:  followUps.filter(isFollowUpThisWeek).length,
    completed: followUps.filter((f) => f.status === 'completed').length,
  }), [followUps]);

  const filtered = useMemo(() => {
    let list = followUps;
    const now = Date.now();

    if (segment === 'today')      list = list.filter(isFollowUpToday);
    else if (segment === 'overdue')   list = list.filter(isFollowUpOverdue);
    else if (segment === 'upcoming')  list = list.filter((f) => f.status === 'pending' && new Date(f.scheduled_at).getTime() > now && !isFollowUpToday(f));
    else if (segment === 'completed') list = list.filter((f) => f.status === 'completed');
    // 'all' shows everything

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((f) => f.title.toLowerCase().includes(q) || (f.notes || '').toLowerCase().includes(q));
    }

    // For overdue, show oldest first (most urgent). Others: chronological.
    return [...list].sort((a, b) => {
      if (segment === 'overdue') return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
      if (segment === 'completed') return new Date(b.completed_at || b.scheduled_at).getTime() - new Date(a.completed_at || a.scheduled_at).getTime();
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });
  }, [followUps, segment, search]);

  const segments: { id: Segment; label: string; count: number; tone?: string }[] = [
    { id: 'today',     label: 'Today',     count: counts.today,     tone: '#B45309' },
    { id: 'overdue',   label: 'Overdue',   count: counts.overdue,   tone: '#B91C1C' },
    { id: 'upcoming',  label: 'Upcoming',  count: followUps.filter((f) => f.status === 'pending' && new Date(f.scheduled_at).getTime() > Date.now() && !isFollowUpToday(f)).length },
    { id: 'completed', label: 'Completed', count: counts.completed },
    { id: 'all',       label: 'All',       count: followUps.length },
  ];

  return (
    <div className="max-w-[1480px] mx-auto px-6 md:px-8 pt-7 pb-10 animate-pageIn">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Follow-ups</h1>
          <p className="text-[13.5px] text-muted mt-1">
            {counts.overdue > 0 && <span className="text-rose-600 font-semibold">{counts.overdue} overdue · </span>}
            {counts.today} today · {counts.thisWeek} this week · {counts.completed} completed
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> New follow-up</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard icon={AlertCircle}     label="Overdue"     value={counts.overdue}     color="#EF4444" />
        <KpiCard icon={CalendarClock}   label="Today"       value={counts.today}       color="#F59E0B" />
        <KpiCard icon={Calendar}        label="This week"   value={counts.thisWeek}    color="#3B82F6" />
        <KpiCard icon={CheckCircle2}    label="Completed"   value={counts.completed}   color="#10B981" />
      </div>

      {/* Filter tabs + search */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {segments.map((s) => (
          <button key={s.id} onClick={() => setSegment(s.id)} className={cn('filter-chip', segment === s.id && 'active')}>
            {s.label}<span className="count" style={s.tone && s.count > 0 && segment !== s.id ? { background: s.tone + '20', color: s.tone } : undefined}>{s.count}</span>
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or notes…"
            className="pl-8 pr-3 py-2 text-[12.5px] w-[280px] rounded-md border border-border bg-surface focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft text-ink" />
        </div>
      </div>

      <FollowUpsList
        followUps={filtered}
        showLeadColumn={true}
        onLeadClick={(leadId) => setSelectedLeadId(leadId)}
        emptyMessage={
          segment === 'today' ? "Nothing scheduled for today" :
          segment === 'overdue' ? "No overdue follow-ups — great job!" :
          segment === 'upcoming' ? "No upcoming follow-ups scheduled" :
          segment === 'completed' ? "No completed follow-ups yet" :
          "No follow-ups yet"
        }
        emptyAction={
          followUps.length === 0 ? (
            <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm"><Plus className="w-3.5 h-3.5" /> Schedule first follow-up</button>
          ) : null
        }
      />

      <AddFollowUpDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <LeadDrawer
        leadId={selectedLeadId}
        onClose={() => setSelectedLeadId(null)}
        onRecordPayment={(id) => setPaymentLeadId(id)}
      />
      <RecordPaymentDialog open={!!paymentLeadId} onClose={() => setPaymentLeadId(null)} presetLeadId={paymentLeadId} />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color: string }) {
  return (
    <div className="panel panel-pad">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-muted">{label}</span>
        <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: color + '15', color }}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="text-[24px] font-bold num tracking-tight" style={value > 0 ? { color } : undefined}>{value}</div>
    </div>
  );
}
