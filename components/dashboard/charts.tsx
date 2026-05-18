'use client';

import { useMemo } from 'react';
import type { Lead, Payment } from '@/lib/types';
import { STAGE_META } from '@/lib/types';
import { formatINR } from '@/lib/utils';

// =========================================
// Lead Funnel — horizontal stacked bars by stage
// =========================================
export function FunnelChart({ leads }: { leads: Lead[] }) {
  const data = useMemo(() => {
    const stages: { key: string; label: string; color: string }[] = [
      { key: 'new', label: 'New', color: '#9CA3AF' },
      { key: 'qualified', label: 'Qualified', color: '#7C3AED' },
      { key: 'consultation', label: 'Consultation', color: '#6366F1' },
      { key: 'proposal', label: 'Proposal', color: '#F59E0B' },
      { key: 'won', label: 'Won', color: '#10B981' },
    ];
    const counts: Record<string, number> = {};
    leads.forEach((l) => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
    // Group "attempted" + "connected" into "qualified" bucket for visual simplicity
    counts.qualified = (counts.qualified || 0) + (counts.attempted || 0) + (counts.connected || 0);
    counts.proposal = (counts.proposal || 0) + (counts.partial || 0);
    const max = Math.max(1, ...stages.map((s) => counts[s.key] || 0));
    return stages.map((s) => ({ ...s, count: counts[s.key] || 0, max }));
  }, [leads]);

  if (leads.length === 0) return <EmptyChart label="No leads yet" />;

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.key} className="flex items-center gap-3">
          <div className="text-[12px] text-ink-2 w-24 flex-shrink-0">{d.label}</div>
          <div className="flex-1 h-7 rounded-md bg-surface-2 overflow-hidden">
            <div className="h-full transition-all flex items-center px-3 text-white text-[11.5px] font-semibold"
              style={{ width: `${Math.max(4, (d.count / d.max) * 100)}%`, background: d.color, minWidth: d.count > 0 ? 32 : 0 }}>
              {d.count > 0 ? d.count : ''}
            </div>
          </div>
          <div className="num text-[12px] font-semibold text-ink-2 w-10 text-right">{d.count}</div>
        </div>
      ))}
    </div>
  );
}

// =========================================
// Lead Temperature — donut by score buckets
// =========================================
export function TemperatureDonut({ leads }: { leads: Lead[] }) {
  const data = useMemo(() => {
    const buckets = { hot: 0, warm: 0, cold: 0, junk: 0 };
    leads.forEach((l) => {
      if (l.score === 0) buckets.junk++;
      else if (l.score >= 75) buckets.hot++;
      else if (l.score >= 50) buckets.warm++;
      else buckets.cold++;
    });
    const total = leads.length || 1;
    return [
      { label: 'Hot', value: buckets.hot, color: '#10B981' },
      { label: 'Warm', value: buckets.warm, color: '#6366F1' },
      { label: 'Cold', value: buckets.cold, color: '#F59E0B' },
      { label: 'Junk', value: buckets.junk, color: '#9CA3AF' },
    ].map((d) => ({ ...d, pct: (d.value / total) * 100 }));
  }, [leads]);

  if (leads.length === 0) return <EmptyChart label="No leads yet" />;

  const r = 64, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 160 160" width={160} height={160} className="flex-shrink-0">
        <circle cx="80" cy="80" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="18" />
        {data.map((d, i) => {
          const len = (d.pct / 100) * c;
          const dash = `${len} ${c - len}`;
          const el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={d.color} strokeWidth="18" strokeDasharray={dash} strokeDashoffset={-offset} transform="rotate(-90 80 80)" strokeLinecap="butt" />;
          offset += len;
          return el;
        })}
        <text x="80" y="78" textAnchor="middle" fontSize="22" fontWeight="700" fill="hsl(var(--ink))">{leads.length}</text>
        <text x="80" y="95" textAnchor="middle" fontSize="10" fill="hsl(var(--muted))" letterSpacing="0.5">LEADS</text>
      </svg>
      <div className="flex-1 space-y-2">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
            <span className="text-[12.5px] text-ink-2 flex-1">{d.label}</span>
            <span className="num text-[12.5px] font-semibold">{d.value}</span>
            <span className="num text-[11px] text-muted w-10 text-right">{d.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =========================================
// Daily new leads — bar chart, last 14 days
// =========================================
export function DailyChart({ leads }: { leads: Lead[] }) {
  const data = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days: { date: Date; count: number; label: string }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      days.push({ date: d, count: 0, label: d.toLocaleDateString('en-US', { day: 'numeric' }) });
    }
    leads.forEach((l) => {
      const cd = new Date(l.created_at); cd.setHours(0, 0, 0, 0);
      const idx = days.findIndex((x) => x.date.getTime() === cd.getTime());
      if (idx >= 0) days[idx].count++;
    });
    return days;
  }, [leads]);

  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <>
      <div className="mb-2 text-[12.5px] text-muted"><span className="num font-semibold text-ink">{total}</span> new leads in last 14 days</div>
      <div className="flex items-end gap-1.5 h-32 mt-3">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative">
            <div className="w-full rounded-t-md transition-all" style={{
              height: `${Math.max(4, (d.count / max) * 100)}%`,
              background: d.count > 0 ? 'linear-gradient(180deg, #6366F1, #4338CA)' : 'hsl(var(--surface-2))',
            }} />
            <div className="text-[10px] text-muted num">{d.label}</div>
            {d.count > 0 && (
              <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition bg-ink text-surface px-2 py-1 rounded text-[10.5px] num font-semibold whitespace-nowrap pointer-events-none">{d.count} leads</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

// =========================================
// Revenue trend — area chart, last 6 months
// =========================================
export function RevenueChart({ payments }: { payments: Payment[] }) {
  const data = useMemo(() => {
    const today = new Date();
    const months: { date: Date; total: number; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({ date: d, total: 0, label: d.toLocaleDateString('en-US', { month: 'short' }) });
    }
    payments.forEach((p) => {
      if (p.status !== 'paid' || !p.paid_at) return;
      const pd = new Date(p.paid_at);
      const idx = months.findIndex((m) => m.date.getMonth() === pd.getMonth() && m.date.getFullYear() === pd.getFullYear());
      if (idx >= 0) months[idx].total += p.amount;
    });
    return months;
  }, [payments]);

  const max = Math.max(1, ...data.map((d) => d.total));
  const total = data.reduce((s, d) => s + d.total, 0);
  const W = 540, H = 130, P = 16;
  const x = (i: number) => P + (i / (data.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d.total)}`).join(' ');
  const area = path + ` L ${x(data.length - 1)} ${H - P} L ${x(0)} ${H - P} Z`;

  return (
    <>
      <div className="mb-2 text-[12.5px] text-muted"><span className="num font-semibold text-ink">{formatINR(total)}</span> collected · last 6 months</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 140 }}>
        <defs>
          <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#rev-grad)" />
        <path d={path} fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.total)} r="3" fill="#4F46E5" />)}
      </svg>
      <div className="flex justify-between mt-1 px-3">
        {data.map((d, i) => <div key={i} className="text-[10.5px] text-muted num">{d.label}</div>)}
      </div>
    </>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-32 text-[12.5px] text-muted">{label}</div>;
}
