'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import type { Case } from '@/lib/types';
import { cn, initials, avatarColor, timeAgo } from '@/lib/utils';
import { Briefcase, Plus, Search, Moon, CheckCircle2, Trash2 } from 'lucide-react';
import { CaseDrawer } from '@/components/cases/case-drawer';
import { AddCaseDialog } from '@/components/cases/add-case-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  JOURNEY, getJourney, normalizeVisaType, normalizeJourney, activePhase, overallProgress, phasesCleared,
  isGatePassed, allGatesPassed, DECISION_META, type PhaseKey,
} from '@/lib/journey';

type Segment = 'all' | 'dormant' | 'closed' | PhaseKey;

// A case with no movement for this many days is treated as dormant (abandoned).
const DORMANT_DAYS = 30;

type Snap = {
  case: Case;
  phase: ReturnType<typeof activePhase>;
  progress: { pct: number; done: number; total: number };
  cleared: number;
  finished: boolean;
  archived: boolean;
  dormant: boolean;
  idleDays: number;
};

export default function CasesPage() {
  const { cases, leads, deleteCase } = useApp();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<Case | null>(null);

  const snapshots: Snap[] = useMemo(() => cases.map((c) => {
    const j = normalizeJourney(c.journey);
    const route = getJourney(normalizeVisaType(c.visa_type));
    const finished = allGatesPassed(j, route);
    const archived = !!c.archived_at;
    const idleDays = Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000);
    return {
      case: c,
      phase: activePhase(j, route),
      progress: overallProgress(j, route),
      cleared: phasesCleared(j, route),
      finished,
      archived,
      dormant: !archived && !finished && idleDays >= DORMANT_DAYS,
      idleDays,
    };
  }), [cases]);

  // Active = open, not dormant, not closed.
  const active = useMemo(() => snapshots.filter((s) => !s.archived && !s.dormant), [snapshots]);
  const phaseCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of active) m[s.phase.key] = (m[s.phase.key] || 0) + 1;
    return m;
  }, [active]);

  const openCount = active.length;
  const dormantCount = snapshots.filter((s) => s.dormant).length;
  const closedCount = snapshots.filter((s) => s.archived).length;

  const segments: { id: Segment; label: string; count: number }[] = [
    { id: 'all', label: 'All active', count: openCount },
    ...JOURNEY.map((p) => ({ id: p.key as Segment, label: p.code, count: phaseCounts[p.key] || 0 })),
    { id: 'dormant', label: 'Dormant', count: dormantCount },
    { id: 'closed', label: 'Closed', count: closedCount },
  ];

  const filtered = useMemo(() => {
    let list: Snap[];
    if (segment === 'closed') list = snapshots.filter((s) => s.archived);
    else if (segment === 'dormant') list = snapshots.filter((s) => s.dormant);
    else if (segment === 'all') list = active;
    else list = active.filter((s) => s.phase.key === segment);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.case.client_name.toLowerCase().includes(q) || (s.case.visa_type || '').toLowerCase().includes(q));
    return [...list].sort((a, b) => new Date(b.case.updated_at).getTime() - new Date(a.case.updated_at).getTime());
  }, [snapshots, active, segment, search]);

  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10 animate-pageIn">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight flex items-center gap-2.5">
            <Briefcase className="w-6 h-6 text-indigo-600" /> Cases
          </h1>
          <p className="text-[13.5px] text-muted mt-1.5">Every client, tracked through one clear 5-step journey</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="w-4 h-4" /> New case</button>
      </div>

      {/* Phase funnel strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 mb-3">
        {JOURNEY.map((p) => {
          const count = phaseCounts[p.key] || 0;
          const on = segment === p.key;
          return (
            <button key={p.key} onClick={() => setSegment(on ? 'all' : p.key)}
              className="rounded-2xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{
                background: count > 0 ? p.tint : 'hsl(var(--surface))',
                borderColor: on ? p.accent : 'hsl(var(--border))',
                boxShadow: on ? `0 0 0 1px ${p.accent}` : undefined,
              }}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: p.accent }}>{p.index}</span>
                <span className="text-[10px] font-bold tracking-wide" style={{ color: p.accent }}>{p.code}</span>
              </div>
              <div className="text-[24px] font-bold num leading-none" style={{ color: count > 0 ? p.accent : 'hsl(var(--faint))' }}>{count}</div>
              <div className="text-[11px] text-ink-2 font-medium mt-1 leading-tight">{p.name}</div>
            </button>
          );
        })}
      </div>

      {/* Dormant banner */}
      {dormantCount > 0 && segment !== 'dormant' && (
        <button onClick={() => setSegment('dormant')}
          className="w-full mb-4 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left hover:bg-amber-100/70 transition-colors">
          <Moon className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-[12.5px] text-amber-900 font-medium">
            {dormantCount} {dormantCount === 1 ? 'client has' : 'clients have'} gone quiet for {DORMANT_DAYS}+ days
          </span>
          <span className="ml-auto text-[12px] font-semibold text-amber-700">View dormant →</span>
        </button>
      )}

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
        <div className="space-y-3">
          {filtered.map((s) => <CaseCard key={s.case.id} snap={s} onOpen={() => setSelectedCaseId(s.case.id)} onRemove={() => setConfirmRemove(s.case)} />)}
        </div>
      )}

      <CaseDrawer caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} />
      <AddCaseDialog open={addOpen} onClose={() => setAddOpen(false)} leads={leads} onCreated={(id) => { setAddOpen(false); setSelectedCaseId(id); }} />

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (confirmRemove) { await deleteCase(confirmRemove.id); setConfirmRemove(null); }
        }}
        title={confirmRemove ? `Remove ${confirmRemove.client_name}'s case?` : 'Remove case?'}
        description="This removes the case from the Cases tab only. The client stays in Leads (and Payments, if they have any) — only the visa-journey case is deleted. This cannot be undone."
        confirmLabel="Remove from Cases"
        cancelLabel="Keep case"
        variant="danger"
      />
    </div>
  );
}

function CaseCard({ snap, onOpen, onRemove }: { snap: Snap; onOpen: () => void; onRemove: () => void }) {
  const c = snap.case;
  const phase = snap.phase;
  const { archived, dormant, finished } = snap;
  const decision = c.decision && c.decision !== 'pending' ? DECISION_META[c.decision] : null;

  const accent = finished ? '#10B981' : dormant ? '#F59E0B' : archived ? '#9CA3AF' : phase.accent;
  const phaseLabel = archived ? 'Closed' : finished ? 'Completed' : `${phase.name}`;

  return (
    <div className="relative group">
    <button onClick={onOpen}
      className={cn(
        'relative w-full overflow-hidden rounded-2xl border bg-surface text-left transition-all',
        'hover:-translate-y-0.5 hover:shadow-lg hover:border-border-strong',
        (archived || dormant) && 'opacity-90 hover:opacity-100',
      )}
      style={{ borderColor: 'hsl(var(--border))' }}>
      {/* left accent rail */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: accent }} />

      <div className="flex items-center gap-4 pl-6 pr-4 py-4">
        {/* avatar */}
        <div className="relative flex-shrink-0">
          <div className="av" style={{ background: avatarColor(c.id), width: 44, height: 44, fontSize: 15, boxShadow: `0 0 0 3px ${accent}22` }}>{initials(c.client_name)}</div>
        </div>

        {/* identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[15px] font-semibold group-hover:underline truncate">{c.client_name}</span>
            {decision && <span className="chip" style={{ background: decision.bg, color: decision.fg, border: 'none' }}>{decision.label}</span>}
            {dormant && <span className="chip inline-flex items-center gap-1" style={{ background: '#FEF3C7', color: '#92400E', border: 'none' }}><Moon className="w-3 h-3" /> Dormant · {snap.idleDays}d</span>}
            {finished && !archived && <span className="chip inline-flex items-center gap-1" style={{ background: '#D1FAE5', color: '#047857', border: 'none' }}><CheckCircle2 className="w-3 h-3" /> Done</span>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-surface-2 text-ink-2">{c.visa_type || 'UK Global Talent'}</span>
            <span className="text-[11.5px] text-muted truncate">{c.owner_name ? `${c.owner_name} · ` : ''}updated {timeAgo(c.updated_at)}</span>
          </div>
        </div>

        {/* progress block */}
        <div className="hidden sm:block w-[240px] flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11.5px] font-semibold truncate" style={{ color: accent }}>{phaseLabel}</span>
            <span className="text-[11px] text-muted num font-medium">{snap.progress.pct}%</span>
          </div>
          {/* 5-step stepper */}
          <div className="flex items-center gap-1">
            {JOURNEY.map((p) => {
              const passed = isGatePassed(normalizeJourney(c.journey), p.key);
              const current = !archived && !finished && p.key === phase.key;
              return (
                <div key={p.key} className="flex-1 h-1.5 rounded-full transition-all"
                  style={{ background: passed ? accent : current ? `${accent}66` : 'hsl(var(--surface-2))' }} />
              );
            })}
          </div>
          <div className="text-[10.5px] text-muted mt-1.5">{archived ? 'Case closed' : `Step ${phase.index} of ${JOURNEY.length}`}</div>
        </div>
      </div>
    </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove from Cases (client stays in Leads)"
        className="absolute top-3 right-3 z-10 p-2 rounded-md bg-surface/80 backdrop-blur text-muted hover:text-danger hover:bg-rose-50 border border-border transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
