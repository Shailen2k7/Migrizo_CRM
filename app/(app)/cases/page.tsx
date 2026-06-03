'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import type { Case } from '@/lib/types';
import { cn, initials, avatarColor, timeAgo } from '@/lib/utils';
import { Briefcase, Plus, Search } from 'lucide-react';
import { CaseDrawer } from '@/components/cases/case-drawer';
import { AddCaseDialog } from '@/components/cases/add-case-dialog';
import {
  JOURNEY, normalizeJourney, activePhase, overallProgress, phasesCleared,
  isGatePassed, allGatesPassed, DECISION_META, type PhaseKey,
} from '@/lib/journey';

type Segment = 'all' | 'closed' | PhaseKey;

export default function CasesPage() {
  const { cases, leads } = useApp();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');

  // Pre-compute each case's journey snapshot once.
  const snapshots = useMemo(() => cases.map((c) => {
    const j = normalizeJourney(c.journey);
    return {
      case: c,
      journey: j,
      phase: activePhase(j),
      progress: overallProgress(j),
      cleared: phasesCleared(j),
      finished: allGatesPassed(j),
      decided: c.decision && c.decision !== 'pending',
      archived: !!c.archived_at,
    };
  }), [cases]);

  // How many OPEN cases are currently sitting in each phase.
  const phaseCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of snapshots) {
      if (s.finished || s.archived) continue;
      m[s.phase.key] = (m[s.phase.key] || 0) + 1;
    }
    return m;
  }, [snapshots]);

  const openCount = snapshots.filter((s) => !s.archived).length;
  const closedCount = snapshots.filter((s) => s.archived).length;

  const segments: { id: Segment; label: string; count: number; accent?: string }[] = [
    { id: 'all', label: 'All open', count: openCount },
    ...JOURNEY.map((p) => ({ id: p.key as Segment, label: p.code, count: phaseCounts[p.key] || 0, accent: p.accent })),
    { id: 'closed', label: 'Closed', count: closedCount },
  ];

  const filtered = useMemo(() => {
    let list = snapshots;
    if (segment === 'closed') list = list.filter((s) => s.archived);
    else if (segment === 'all') list = list.filter((s) => !s.archived);
    else list = list.filter((s) => !s.archived && !s.finished && s.phase.key === segment);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.case.client_name.toLowerCase().includes(q) || (s.case.visa_type || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => new Date(b.case.updated_at).getTime() - new Date(a.case.updated_at).getTime());
  }, [snapshots, segment, search]);

  return (
    <div className="max-w-[1240px] mx-auto px-8 pt-7 pb-10 animate-pageIn">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight flex items-center gap-2.5">
            <Briefcase className="w-6 h-6 text-indigo-600" /> Cases
          </h1>
          <p className="text-[13.5px] text-muted mt-1.5">Every endorsement client, tracked through one clear 6-phase journey</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> New case</button>
      </div>

      {/* Phase funnel strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5 mb-6">
        {JOURNEY.map((p) => {
          const count = phaseCounts[p.key] || 0;
          return (
            <button key={p.key} onClick={() => setSegment(p.key)}
              className="rounded-xl border p-3 text-left transition-all hover:border-border-strong"
              style={{ background: count > 0 ? p.tint : 'hsl(var(--surface))', borderColor: segment === p.key ? p.accent : 'hsl(var(--border))' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: p.accent }}>{p.index}</span>
                <span className="text-[10px] font-bold tracking-wide" style={{ color: p.accent }}>{p.code}</span>
              </div>
              <div className="text-[22px] font-bold num leading-none" style={{ color: count > 0 ? p.accent : 'hsl(var(--faint))' }}>{count}</div>
              <div className="text-[10.5px] text-muted mt-0.5 leading-tight">{p.name}</div>
            </button>
          );
        })}
      </div>

      {/* Filter chips + search */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {segments.map((s) => (
            <button key={s.id} onClick={() => setSegment(s.id)} className={cn('filter-chip', segment === s.id && 'active')}>
              {s.label}<span className="count">{s.count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client…"
            className="pl-8 pr-3 py-2 border border-border rounded-md bg-surface text-[13px] outline-none focus:border-indigo-400 w-[200px]" />
        </div>
      </div>

      {/* Case list */}
      {filtered.length === 0 ? (
        <div className="panel panel-pad text-center py-16">
          <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3"><Briefcase className="w-5 h-5 text-faint" /></div>
          <div className="text-[14px] font-medium mb-1">No cases here</div>
          <div className="text-[12.5px] text-muted mb-4">{cases.length === 0 ? 'Open your first case to start tracking the journey.' : 'Try a different filter.'}</div>
          {cases.length === 0 && <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm mx-auto"><Plus className="w-3.5 h-3.5" /> New case</button>}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((s) => <CaseRow key={s.case.id} snap={s} onOpen={() => setSelectedCaseId(s.case.id)} />)}
        </div>
      )}

      <CaseDrawer caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} />
      <AddCaseDialog open={addOpen} onClose={() => setAddOpen(false)} leads={leads} onCreated={(id) => { setAddOpen(false); setSelectedCaseId(id); }} />
    </div>
  );
}

function CaseRow({ snap, onOpen }: { snap: { case: Case; phase: ReturnType<typeof activePhase>; progress: { pct: number; done: number; total: number }; cleared: number; finished: boolean; archived: boolean }; onOpen: () => void }) {
  const c = snap.case;
  const phase = snap.phase;
  const archived = snap.archived;
  const decision = c.decision && c.decision !== 'pending' ? DECISION_META[c.decision] : null;
  const phaseLabel = archived ? 'Closed' : snap.finished ? 'Completed' : `${phase.code} · Phase ${phase.index}/6`;
  const barColor = archived ? 'hsl(var(--faint))' : snap.finished ? '#10B981' : phase.accent;
  const labelColor = archived ? 'hsl(var(--muted))' : snap.finished ? '#047857' : phase.accent;

  return (
    <button onClick={onOpen} className={cn('panel w-full p-4 flex items-center gap-4 hover:border-border-strong transition-all text-left group', archived && 'opacity-65 hover:opacity-100')}>
      <div className="av" style={{ background: avatarColor(c.id), width: 38, height: 38, fontSize: 13 }}>{initials(c.client_name)}</div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[14px] font-semibold group-hover:underline truncate">{c.client_name}</span>
          {decision && <span className="chip" style={{ background: decision.bg, color: decision.fg, border: 'none' }}>{decision.label}</span>}
        </div>
        <div className="text-[11.5px] text-muted truncate">{c.visa_type || 'UK Global Talent'}{c.owner_name ? ` · ${c.owner_name}` : ''} · updated {timeAgo(c.updated_at)}</div>
      </div>

      <div className="hidden sm:block w-[220px] flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold" style={{ color: labelColor }}>{phaseLabel}</span>
          <span className="text-[10.5px] text-muted num">{snap.progress.pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${snap.progress.pct}%`, background: barColor }} />
        </div>
        <div className="flex items-center gap-1 mt-1.5">
          {JOURNEY.map((p) => (
            <div key={p.key} className="flex-1 h-1 rounded-full" style={{ background: isGatePassed(normalizeJourney(c.journey), p.key) ? (archived ? 'hsl(var(--faint))' : p.accent) : 'hsl(var(--surface-2))' }} />
          ))}
        </div>
      </div>
    </button>
  );
}
