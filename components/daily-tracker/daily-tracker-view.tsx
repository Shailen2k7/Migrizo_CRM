'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import type { Lead, LeadStage } from '@/lib/types';
import { STAGE_META, getStageMeta, isFollowUpOverdue, isFollowUpToday } from '@/lib/types';
import { Users, Flame, Snowflake, Trash2, Calendar, Download, AlertTriangle, ChevronRight, MessageCircle, Trophy, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn, initials, avatarColor, formatINRFull, formatMoney, toINR } from '@/lib/utils';
import { IndustryChip } from '@/components/shared/industry-chip';
import { LeadDrawer } from '@/components/leads/lead-drawer';
import { RecordPaymentDialog } from '@/components/payments/record-payment-dialog';
import { toast } from 'sonner';

// =========================================
// DATE HELPERS — local timezone, inclusive ranges
// =========================================
function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d: Date): string { const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function daysBetween(from: Date, to: Date): number { return Math.round((endOfDay(to).getTime() - startOfDay(from).getTime()) / 86400000); }
function isSameDay(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function inRange(iso: string, from: Date, to: Date): boolean { const t = new Date(iso).getTime(); return t >= startOfDay(from).getTime() && t <= endOfDay(to).getTime(); }

function formatRangeLabel(from: Date, to: Date): string {
  if (isSameDay(from, to)) {
    const w = from.toLocaleDateString('en-IN', { weekday: 'short' });
    const d = from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${w}, ${d}`;
  }
  const sameYear = from.getFullYear() === to.getFullYear();
  const f = from.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  const t = to.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f} – ${t}`;
}

function formatRangeForFilename(from: Date, to: Date): string {
  if (isSameDay(from, to)) return ymd(from);
  return `${ymd(from)}_to_${ymd(to)}`;
}

// =========================================
// CSV EXPORT
// =========================================
function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(filename: string, rows: (string | number | null)[][]) {
  const csv = rows.map((row) => row.map(escapeCSV).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); URL.revokeObjectURL(url);
}

// =========================================
// STALE LEAD DETECTION (hot leads with no recent contact)
// =========================================
function isStaleHotLead(lead: Lead): boolean {
  if (lead.stage !== 'hot') return false;
  const cutoffMs = Date.now() - 48 * 60 * 60 * 1000;
  const reference = lead.last_note_at
    ? new Date(lead.last_note_at).getTime()
    : new Date(lead.created_at).getTime();
  return reference < cutoffMs;
}

// =========================================
// COMPONENT
// =========================================
type StageFilter = 'all' | 'hot' | 'cold' | 'junk' | LeadStage;

export function DailyTrackerView() {
  const { leads, followUps, payments, memberNameById } = useApp();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [from, setFrom] = useState<Date>(today);
  const [to, setTo] = useState<Date>(today);
  const [activeCard, setActiveCard] = useState<StageFilter>('all');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [paymentLeadId, setPaymentLeadId] = useState<string | null>(null);

  const isSingleDay = isSameDay(from, to);

  // ------- Leads added within the range -------
  const leadsInRange = useMemo(() => leads.filter((l) => inRange(l.created_at, from, to)), [leads, from, to]);

  const counts = useMemo(() => {
    const c = { total: leadsInRange.length, hot: 0, cold: 0, mr_coming_soon: 0, invoice_sent: 0, won: 0, junk: 0 } as Record<string, number>;
    for (const l of leadsInRange) {
      if (l.stage in c) c[l.stage]++;
    }
    return c;
  }, [leadsInRange]);

  // ------- Closed deals: leads currently 'won' whose updated_at is in range -------
  const closedInRange = useMemo(() => leads.filter((l) => l.stage === 'won' && inRange(l.updated_at, from, to)), [leads, from, to]);
  const closedRevenue = useMemo(() => closedInRange.reduce((s, l) => s + toINR(l.amount_paid || 0, l.currency || 'INR'), 0), [closedInRange]);

  // ------- 7-day comparison for single-day view -------
  const comparison = useMemo(() => {
    if (!isSingleDay) return null;
    const sevenAgo = addDays(from, -7);
    const yesterday = addDays(from, -1);
    const prior = leads.filter((l) => inRange(l.created_at, sevenAgo, yesterday));
    if (prior.length === 0) return null;
    const avg = prior.length / 7;
    if (avg === 0) return null;
    const pct = Math.round(((counts.total - avg) / avg) * 100);
    return { avg, pct };
  }, [leads, from, isSingleDay, counts.total]);

  // ------- Stale hot leads + overdue follow-ups + overdue payments (action items) -------
  const staleHotLeads = useMemo(() => leads.filter(isStaleHotLead), [leads]);
  const overdueFollowUps = useMemo(() => followUps.filter(isFollowUpOverdue), [followUps]);
  const todayFollowUps = useMemo(() => followUps.filter(isFollowUpToday), [followUps]);

  const overduePaymentInfo = useMemo(() => {
    const overdueLeads = leads.filter((l) => !l.hidden_from_payments && (l.amount_overdue || 0) > 0);
    const total = overdueLeads.reduce((s, l) => s + toINR(l.amount_overdue || 0, l.currency || 'INR'), 0);
    return { clientCount: overdueLeads.length, totalAmount: total };
  }, [leads]);

  // ------- Filtered list based on active card -------
  const filteredList = useMemo(() => {
    let list = leadsInRange;
    if (activeCard !== 'all') list = list.filter((l) => l.stage === activeCard);
    // Sort: Won leads first (celebrate), then chronological
    return [...list].sort((a, b) => {
      if (a.stage === 'won' && b.stage !== 'won') return -1;
      if (b.stage === 'won' && a.stage !== 'won') return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [leadsInRange, activeCard]);

  // ------- Other stages with non-zero counts (for the "Also on this day" row) -------
  const otherStages: { stage: LeadStage; count: number }[] = useMemo(() => {
    const out: { stage: LeadStage; count: number }[] = [];
    (['mr_coming_soon', 'invoice_sent', 'won'] as LeadStage[]).forEach((s) => {
      if (counts[s] > 0) out.push({ stage: s, count: counts[s] });
    });
    return out;
  }, [counts]);

  // ------- Subtitle -------
  const subtitle = useMemo(() => {
    const dateLabel = formatRangeLabel(from, to);
    const plural = leadsInRange.length === 1 ? 'lead' : 'leads';
    const parts = [`${dateLabel}`, `${leadsInRange.length} new ${plural}`];
    if (closedInRange.length > 0) {
      const dealWord = closedInRange.length === 1 ? 'closed deal' : 'closed deals';
      parts.push(`${closedInRange.length} ${dealWord} worth ${formatINRFull(closedRevenue)}`);
    }
    return parts.join(' · ');
  }, [from, to, leadsInRange.length, closedInRange.length, closedRevenue]);

  // ------- Handlers -------
  const setQuickRange = (key: 'today' | 'yesterday' | 'week' | 'month') => {
    const t = startOfDay(new Date());
    if (key === 'today') { setFrom(t); setTo(t); }
    else if (key === 'yesterday') { const y = addDays(t, -1); setFrom(y); setTo(y); }
    else if (key === 'week') { setFrom(addDays(t, -6)); setTo(t); }
    else if (key === 'month') { setFrom(addDays(t, -29)); setTo(t); }
  };

  const handleExport = () => {
    if (filteredList.length === 0) {
      toast.error('No leads to export for this view');
      return;
    }
    const headers = ['Name', 'Email', 'Phone', 'Current stage', 'Visa type', 'Date added', 'Time added', 'Added by', 'Amount paid', 'Last note', 'Notes preview'];
    const rows: (string | number | null)[][] = [headers];
    for (const l of filteredList) {
      const created = new Date(l.created_at);
      rows.push([
        l.full_name,
        l.email || '',
        l.phone || '',
        getStageMeta(l.stage).label,
        l.visa_type || '',
        created.toLocaleDateString('en-IN'),
        created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        l.created_by ? memberNameById(l.created_by) : '',
        l.amount_paid || 0,
        l.last_note_at ? new Date(l.last_note_at).toLocaleString('en-IN') : '',
        l.last_note || '',
      ]);
    }
    const filename = `daily-tracker_${formatRangeForFilename(from, to)}${activeCard !== 'all' ? `_${activeCard}` : ''}.csv`;
    downloadCSV(filename, rows);
    toast.success(`Exported ${filteredList.length} lead${filteredList.length === 1 ? '' : 's'}`);
  };

  // Quick-range button state
  const t = startOfDay(new Date());
  const activeQuick: 'today' | 'yesterday' | 'week' | 'month' | null =
    isSameDay(from, t) && isSameDay(to, t) ? 'today'
    : isSameDay(from, addDays(t, -1)) && isSameDay(to, addDays(t, -1)) ? 'yesterday'
    : isSameDay(from, addDays(t, -6)) && isSameDay(to, t) ? 'week'
    : isSameDay(from, addDays(t, -29)) && isSameDay(to, t) ? 'month'
    : null;

  return (
    <div className="animate-pageIn">
      {/* HEADER */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Daily tracker</h1>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#E1F5EE', color: '#0F6E56' }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: '#1D9E75' }} />
              Live
            </span>
          </div>
          <p className="text-[13.5px] text-muted mt-1">{subtitle}</p>
        </div>
        <button onClick={handleExport} className="btn btn-secondary"><Download className="w-4 h-4" /> Export CSV</button>
      </div>

      {/* DATE RANGE PICKER */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface text-[12.5px]">
          <Calendar className="w-3.5 h-3.5 text-muted" />
          <input type="date" value={ymd(from)} onChange={(e) => { const d = parseYmd(e.target.value); setFrom(d); if (d > to) setTo(d); }} className="bg-transparent border-0 outline-0 p-0 text-[12.5px] font-medium focus:outline-none" style={{ width: 130 }} />
          <span className="text-faint">→</span>
          <input type="date" value={ymd(to)} min={ymd(from)} onChange={(e) => setTo(parseYmd(e.target.value))} className="bg-transparent border-0 outline-0 p-0 text-[12.5px] font-medium focus:outline-none" style={{ width: 130 }} />
        </div>
        <button onClick={() => setQuickRange('today')} className={cn('px-3 py-1.5 rounded-full text-[12px] font-medium', activeQuick === 'today' ? 'bg-surface border border-border' : 'text-muted hover:bg-surface-2')}>Today</button>
        <button onClick={() => setQuickRange('yesterday')} className={cn('px-3 py-1.5 rounded-full text-[12px] font-medium', activeQuick === 'yesterday' ? 'bg-surface border border-border' : 'text-muted hover:bg-surface-2')}>Yesterday</button>
        <button onClick={() => setQuickRange('week')} className={cn('px-3 py-1.5 rounded-full text-[12px] font-medium', activeQuick === 'week' ? 'bg-surface border border-border' : 'text-muted hover:bg-surface-2')}>Last 7 days</button>
        <button onClick={() => setQuickRange('month')} className={cn('px-3 py-1.5 rounded-full text-[12px] font-medium', activeQuick === 'month' ? 'bg-surface border border-border' : 'text-muted hover:bg-surface-2')}>Last 30 days</button>
      </div>

      {/* 4 STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatCard
          icon={Users}
          label="Total leads"
          count={counts.total}
          active={activeCard === 'all'}
          activeBorder="#1a1a1a"
          background="#FFFFFF"
          countColor="#0F1115"
          labelColor="#5C6470"
          onClick={() => setActiveCard('all')}
          subtitle={comparison ? <ComparisonBadge pct={comparison.pct} /> : null}
        />
        <StatCard
          icon={Flame}
          label="Hot"
          count={counts.hot}
          active={activeCard === 'hot'}
          activeBorder="#A32D2D"
          background="#FCEBEB"
          borderColor="#F09595"
          labelColor="#791F1F"
          countColor="#501313"
          onClick={() => setActiveCard('hot')}
          subtitle={counts.total > 0 ? <span className="text-[11px] font-medium" style={{ color: '#791F1F' }}>{Math.round((counts.hot / counts.total) * 100)}% of new</span> : null}
        />
        <StatCard
          icon={Snowflake}
          label="Cold"
          count={counts.cold}
          active={activeCard === 'cold'}
          activeBorder="#185FA5"
          background="#E6F1FB"
          borderColor="#85B7EB"
          labelColor="#0C447C"
          countColor="#042C53"
          onClick={() => setActiveCard('cold')}
          subtitle={counts.total > 0 ? <span className="text-[11px] font-medium" style={{ color: '#0C447C' }}>{Math.round((counts.cold / counts.total) * 100)}% of new</span> : null}
        />
        <StatCard
          icon={Trash2}
          label="Junk"
          count={counts.junk}
          active={activeCard === 'junk'}
          activeBorder="#444441"
          background="#F1EFE8"
          borderColor="#B4B2A9"
          labelColor="#444441"
          countColor="#2C2C2A"
          onClick={() => setActiveCard('junk')}
          subtitle={counts.total > 0 ? <span className="text-[11px] font-medium" style={{ color: '#444441' }}>{Math.round((counts.junk / counts.total) * 100)}% of new</span> : null}
        />
      </div>

      {/* OTHER STAGES (clickable to filter) */}
      {otherStages.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[11px] text-faint">Also on this {isSingleDay ? 'day' : 'range'}:</span>
          {otherStages.map(({ stage, count }) => {
            const meta = getStageMeta(stage);
            const isActive = activeCard === stage;
            return (
              <button key={stage} onClick={() => setActiveCard(stage)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition" style={{ background: meta.bg, color: meta.fg, border: isActive ? `1.5px solid ${meta.fg}` : '1.5px solid transparent' }}>
                {stage === 'won' && <Trophy className="w-3 h-3" />}
                {meta.label} · {count}
              </button>
            );
          })}
        </div>
      )}

      {/* ACTION CALLOUT — stale hot leads + overdue follow-ups + overdue payments */}
      {(staleHotLeads.length > 0 || overdueFollowUps.length > 0 || overduePaymentInfo.clientCount > 0) && (
        <div className="rounded-md p-3 mb-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: '#FAEEDA', border: '0.5px solid #EF9F27' }}>
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#854F0B' }} />
            <div>
              {staleHotLeads.length > 0 && (
                <div className="text-[12.5px] font-semibold" style={{ color: '#633806' }}>
                  {staleHotLeads.length} hot lead{staleHotLeads.length === 1 ? '' : 's'} {staleHotLeads.length === 1 ? 'has' : 'have'} no contact in the last 48 hours
                </div>
              )}
              {overdueFollowUps.length > 0 && (
                <div className="text-[11.5px] mt-0.5" style={{ color: '#854F0B' }}>
                  Plus {overdueFollowUps.length} overdue follow-up{overdueFollowUps.length === 1 ? '' : 's'} ({todayFollowUps.length} due today)
                </div>
              )}
              {overduePaymentInfo.clientCount > 0 && (
                <div className="text-[11.5px] mt-0.5 font-semibold" style={{ color: '#A32D2D' }}>
                  {overduePaymentInfo.clientCount} client{overduePaymentInfo.clientCount === 1 ? '' : 's'} with overdue payments · {formatINRFull(overduePaymentInfo.totalAmount)} to collect
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {staleHotLeads.length > 0 && (
              <button onClick={() => { setActiveCard('hot'); }} className="text-[11.5px] font-semibold underline" style={{ color: '#633806' }}>
                See hot leads
              </button>
            )}
            {overduePaymentInfo.clientCount > 0 && (
              <a href="/payments" className="text-[11.5px] font-semibold underline" style={{ color: '#A32D2D' }}>
                Open Payments
              </a>
            )}
          </div>
        </div>
      )}

      {/* LEAD LIST */}
      <div className="panel overflow-hidden">
        <div className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted bg-surface-2 border-b border-border">
          {filteredList.length === 0
            ? 'No leads to show'
            : `${filteredList.length} lead${filteredList.length === 1 ? '' : 's'} ${activeCard === 'all' ? 'added' : `· filtered to ${getStageMeta(activeCard).label}`}`}
        </div>
        {filteredList.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-2 mx-auto mb-3 flex items-center justify-center">
              <Users className="w-5 h-5 text-faint" />
            </div>
            <p className="text-[12.5px] text-muted">
              {activeCard === 'all'
                ? `No leads added in this ${isSingleDay ? 'day' : 'range'}`
                : `No ${getStageMeta(activeCard).label.toLowerCase()} leads added in this ${isSingleDay ? 'day' : 'range'}`}
            </p>
            {activeCard !== 'all' && counts.total > 0 && (
              <button onClick={() => setActiveCard('all')} className="text-[12px] text-indigo-600 font-medium mt-2 hover:underline">
                Show all {counts.total} leads
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredList.map((lead) => (
              <LeadRow key={lead.id} lead={lead} onClick={() => setSelectedLeadId(lead.id)} memberName={lead.created_by ? memberNameById(lead.created_by) : null} />
            ))}
          </div>
        )}
      </div>

      {/* DRAWERS */}
      <LeadDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} onRecordPayment={(id) => setPaymentLeadId(id)} />
      <RecordPaymentDialog open={!!paymentLeadId} onClose={() => setPaymentLeadId(null)} presetLeadId={paymentLeadId} />
    </div>
  );
}

// =========================================
// STAT CARD COMPONENT
// =========================================
function StatCard({ icon: Icon, label, count, active, activeBorder, background, borderColor, countColor, labelColor, onClick, subtitle }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; count: number;
  active: boolean;
  activeBorder: string;
  background: string;
  borderColor?: string;
  countColor?: string;
  labelColor?: string;
  onClick: () => void;
  subtitle: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="text-left relative rounded-md p-3.5 transition-transform hover:-translate-y-0.5" style={{
      background,
      border: active ? `2px solid ${activeBorder}` : `0.5px solid ${borderColor || '#E5E7EB'}`,
    }}>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-semibold" style={{ color: labelColor }}>
        <Icon className="w-3.5 h-3.5" />{label}
      </div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <div className="text-[26px] font-bold tracking-tight leading-none" style={{ color: countColor }}>{count}</div>
        {subtitle}
      </div>
      {active && (
        <span className="absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-white" style={{ background: activeBorder }}>Active</span>
      )}
    </button>
  );
}

function ComparisonBadge({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-[11px] font-medium text-muted">on pace with 7-day avg</span>;
  const isUp = pct > 0;
  const Icon = isUp ? ArrowUpRight : ArrowDownRight;
  const color = isUp ? '#0F6E56' : '#A32D2D';
  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color }}>
      <Icon className="w-3 h-3" />{Math.abs(pct)}% vs. 7-day avg
    </span>
  );
}

// =========================================
// LEAD ROW
// =========================================
function LeadRow({ lead, onClick, memberName }: { lead: Lead; onClick: () => void; memberName: string | null }) {
  const meta = getStageMeta(lead.stage);
  const isWon = lead.stage === 'won';
  const created = new Date(lead.created_at);
  const timeStr = created.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

  return (
    <button onClick={onClick} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-2 transition-colors group">
      <div className="av flex-shrink-0" style={{ background: avatarColor(lead.id), width: 36, height: 36, fontSize: 13 }}>
        {initials(lead.full_name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[13.5px] text-ink">{lead.full_name}</span>
            <IndustryChip industry={lead.industry} size="xs" />
            {isWon && lead.amount_paid > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#E1F5EE', color: '#0F6E56' }}>
                {formatMoney(lead.amount_paid, lead.currency)} closed
              </span>
            )}
          </div>
          <span className="text-[11px] text-faint whitespace-nowrap">{timeStr}</span>
        </div>
        <div className="text-[12px] font-semibold mt-0.5" style={{ color: meta.fg }}>
          → Currently in {meta.label} {lead.stage === 'won' ? 'pipeline' : 'lead pipeline'}
        </div>
        {(lead.email || lead.phone) && (
          <div className="text-[11.5px] text-muted mt-1">
            {[lead.email, lead.phone].filter(Boolean).join(' · ')}
          </div>
        )}
        {lead.last_note && (
          <div className="text-[11.5px] text-faint mt-1 flex items-start gap-1 line-clamp-2">
            <MessageCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>"{lead.last_note}"</span>
          </div>
        )}
        {memberName && (
          <div className="text-[10.5px] text-faint mt-1">Added by {memberName}</div>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-faint mt-1 flex-shrink-0 group-hover:text-muted transition-colors" />
    </button>
  );
}
