'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import type { Case, CaseStage, CaseStatus } from '@/lib/types';
import { CASE_STAGE_META, CASE_STAGE_ORDER, CASE_STATUS_META } from '@/lib/types';
import { cn, initials, avatarColor, timeAgo } from '@/lib/utils';
import { Briefcase, Plus, Search, FileCheck, Send, Stamp, Plane, MapPin, ListChecks } from 'lucide-react';
import { CaseDrawer } from '@/components/cases/case-drawer';
import { AddCaseDialog } from '@/components/cases/add-case-dialog';

type Segment = 'active' | 'all' | 'completed' | 'on_hold' | CaseStage;

export default function CasesPage() {
  const { cases, leads } = useApp();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>('active');
  const [search, setSearch] = useState('');

  const stageIdx = (s: CaseStage) => CASE_STAGE_ORDER.indexOf(s);

  // Cumulative funnel logic: a case is counted at a stage if its current_stage is AT OR PAST that stage.
  // So a case at "Endorsement" is also counted in "Profile Building" because it has already passed through.
  const countAtOrPast = (target: CaseStage) =>
    cases.filter((c) => c.status === 'active' && stageIdx(c.current_stage) >= stageIdx(target)).length;

  const stats = useMemo(() => ({
    total: cases.length,
    active: cases.filter((c) => c.status === 'active').length,
    pastProfile: countAtOrPast('profile_building'),
    inEndorsement: countAtOrPast('endorsement_submission'),
    inVisa: countAtOrPast('visa_application'),
    pastPostArrival: countAtOrPast('post_arrival'),
    completed: cases.filter((c) => c.status === 'completed').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cases]);

  const segments: { id: Segment; label: string; count: number }[] = [
    { id: 'active',    label: 'Active', count: cases.filter((c) => c.status === 'active').length },
    { id: 'all',       label: 'All',    count: cases.length },
    ...CASE_STAGE_ORDER.map((s) => ({
      id: s as Segment,
      label: CASE_STAGE_META[s].short,
      // Cumulative: chip shows count of cases at OR past this stage
      count: countAtOrPast(s),
    })),
    { id: 'completed', label: 'Completed', count: cases.filter((c) => c.status === 'completed').length },
    { id: 'on_hold',   label: 'On Hold',   count: cases.filter((c) => c.status === 'on_hold').length },
  ];

  const filtered = useMemo(() => {
    let list = cases;
    if (segment === 'active') list = list.filter((c) => c.status === 'active');
    else if (segment === 'completed') list = list.filter((c) => c.status === 'completed');
    else if (segment === 'on_hold') list = list.filter((c) => c.status === 'on_hold');
    else if (segment !== 'all') {
      // Cumulative filter: clicking a stage chip shows all active cases at OR past that stage
      list = list.filter((c) => c.status === 'active' && stageIdx(c.current_stage) >= stageIdx(segment as CaseStage));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        c.client_name.toLowerCase().includes(q) ||
        (c.client_email || '').toLowerCase().includes(q) ||
        (c.client_phone || '').toLowerCase().includes(q) ||
        c.visa_type.toLowerCase().includes(q)
      );
    }
    return list;
  }, [cases, segment, search]);

  return (
    <div className="max-w-[1480px] mx-auto px-6 md:px-8 pt-7 pb-10 animate-pageIn">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Cases</h1>
          <p className="text-[13.5px] text-muted mt-1">
            {stats.total} {stats.total === 1 ? 'case' : 'cases'} · {stats.active} active · {stats.completed} completed
          </p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> New case</button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiCard icon={Briefcase}   label="Active cases"     value={stats.active}          color="#4F46E5" />
        <KpiCard icon={FileCheck}   label="Profile building" value={stats.pastProfile}     color="#F59E0B" />
        <KpiCard icon={Send}        label="In endorsement"   value={stats.inEndorsement}   color="#3B82F6" />
        <KpiCard icon={Stamp}       label="In visa stage"    value={stats.inVisa}          color="#7C3AED" />
        <KpiCard icon={MapPin}      label="Post-arrival"     value={stats.pastPostArrival} color="#10B981" />
      </div>

      {/* Filters + search */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {segments.map((s) => (
          <button key={s.id} onClick={() => setSegment(s.id)} className={cn('filter-chip', segment === s.id && 'active')}>
            {s.label}<span className="count">{s.count}</span>
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email, phone…"
            className="pl-8 pr-3 py-2 text-[12.5px] w-[280px] rounded-md border border-border bg-surface focus:outline-none focus:border-indigo focus:ring-4 focus:ring-indigo-soft text-ink" />
        </div>
      </div>

      {/* Cases list */}
      {filtered.length === 0 ? (
        <div className="panel py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-2 mx-auto mb-4 flex items-center justify-center">
            <Briefcase className="w-7 h-7 text-faint" />
          </div>
          <h3 className="text-[15px] font-semibold mb-1">
            {cases.length === 0 ? 'No cases yet' : 'No cases match this view'}
          </h3>
          <p className="text-[12.5px] text-muted mb-5">
            {cases.length === 0 ? 'Open your first case to start tracking a visa application' : 'Try a different filter'}
          </p>
          {cases.length === 0 ? (
            <button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> Open first case</button>
          ) : (
            <button onClick={() => setSegment('active')} className="btn btn-outline">Show active</button>
          )}
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '70vh' }}>
            <table className="w-full" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  {['Client', 'Visa Type', 'Current Stage', 'Status', 'Endorsement', 'Visa', 'Last Activity'].map((h) => (
                    <th key={h} className="text-[11px] font-semibold uppercase tracking-wider px-3.5 py-2.5 text-left text-muted bg-surface border-b border-border sticky top-0 z-[2]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => <CaseRow key={c.id} caseData={c} onClick={() => setSelectedCaseId(c.id)} />)}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border text-[12px] text-muted">
            Showing <span className="num font-semibold text-ink-2">{filtered.length}</span> of <span className="num font-semibold text-ink-2">{cases.length}</span>
          </div>
        </div>
      )}

      <CaseDrawer caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} />
      <AddCaseDialog open={addOpen} onClose={() => setAddOpen(false)} leads={leads} onCreated={(id) => { setAddOpen(false); setSelectedCaseId(id); }} />
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
      <div className="text-[24px] font-bold num tracking-tight">{value}</div>
    </div>
  );
}

function CaseRow({ caseData, onClick }: { caseData: Case; onClick: () => void }) {
  const stageMeta = CASE_STAGE_META[caseData.current_stage];
  const statusMeta = CASE_STATUS_META[caseData.status];

  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-surface-2 cursor-pointer transition-colors">
      <td className="px-3.5 py-3.5 align-middle">
        <div className="flex items-center gap-2.5">
          <div className="av" style={{ background: avatarColor(caseData.id) }}>{initials(caseData.client_name)}</div>
          <div className="min-w-0">
            <div className="font-semibold text-ink text-[13.5px]">{caseData.client_name}</div>
            <div className="text-[11px] text-muted truncate max-w-[200px]">{caseData.client_email || caseData.client_phone || '—'}</div>
          </div>
        </div>
      </td>
      <td className="px-3.5 py-3.5 align-middle text-[12.5px] text-ink-2">{caseData.visa_type}</td>
      <td className="px-3.5 py-3.5 align-middle">
        <span className="chip" style={{ background: stageMeta.bg, color: stageMeta.fg, border: 'none' }}>
          <span className="chip-dot" style={{ background: stageMeta.dot }} />{stageMeta.short}
        </span>
      </td>
      <td className="px-3.5 py-3.5 align-middle">
        <span className="chip" style={{ background: statusMeta.bg, color: statusMeta.fg, border: 'none' }}>{statusMeta.label}</span>
      </td>
      <td className="px-3.5 py-3.5 align-middle">
        <EndorsementChip status={caseData.endorsement_status} />
      </td>
      <td className="px-3.5 py-3.5 align-middle">
        <EndorsementChip status={caseData.visa_status} />
      </td>
      <td className="px-3.5 py-3.5 align-middle text-[11.5px] text-muted">{timeAgo(caseData.updated_at)}</td>
    </tr>
  );
}

function EndorsementChip({ status }: { status: string }) {
  const meta: Record<string, { label: string; bg: string; fg: string }> = {
    pending:        { label: 'Pending',  bg: '#F4F4F6', fg: '#6B7280' },
    approved:       { label: 'Approved', bg: '#D1FAE5', fg: '#047857' },
    rejected:       { label: 'Rejected', bg: '#FEE2E2', fg: '#B91C1C' },
    not_applicable: { label: 'N/A',      bg: '#F4F4F6', fg: '#9CA3AF' },
  };
  const m = meta[status] || meta.pending;
  return <span className="chip" style={{ background: m.bg, color: m.fg, border: 'none' }}>{m.label}</span>;
}
