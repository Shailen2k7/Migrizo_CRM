'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import type { Case } from '@/lib/types';
import { cn, initials, avatarColor, timeAgo } from '@/lib/utils';
import { Briefcase, Plus, Search, Moon, CheckCircle2, Trash2, Lock, LayoutGrid, List as ListIcon } from 'lucide-react';
import { DELIVERY_STAGES, DELIVERY_BY_KEY, deliveryStageOf, type DeliveryStageKey } from '@/lib/delivery-stages';
import { CasesBoard } from '@/components/cases/cases-board';
import { CaseDrawer } from '@/components/cases/case-drawer';
import { AddCaseDialog } from '@/components/cases/add-case-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  JOURNEY, getJourney, normalizeVisaType, normalizeJourney, activePhase, overallProgress, phasesCleared,
  isGatePassed, allGatesPassed, applyCustomTasks, DECISION_META, type PhaseKey,
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
  const { role } = useApp();
  // Cases are visible to admins/owners only.
  if (role !== 'admin') {
    return (
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10">
        <div className="panel panel-pad text-center py-16 max-w-md mx-auto mt-10">
          <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3"><Lock className="w-5 h-5 text-faint" /></div>
          <div className="text-[15px] font-semibold mb-1">Cases are admin-only</div>
          <div className="text-[13px] text-muted">This area is limited to workspace owners and admins. Ask your admin if you need access.</div>
        </div>
      </div>
    );
  }
  return <CasesInner />;
}

function CasesInner() {
  const { cases, leads, deleteCase, updateCase } = useApp();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'board'>('board');
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | DeliveryStageKey>('all');
  const [confirmRemove, setConfirmRemove] = useState<Case | null>(null);

  const snapshots: Snap[] = useMemo(() => cases.map((c) => {
    const j = normalizeJourney(c.journey);
    const route = applyCustomTasks(getJourney(normalizeVisaType(c.visa_type)), j);
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

  const deliveryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cases) { const k = deliveryStageOf(c); m[k] = (m[k] || 0) + 1; }
    return m;
  }, [cases]);

  const deliveryFiltered = useMemo(() => {
    let list = cases;
    if (deliveryFilter !== 'all') list = list.filter((c) => deliveryStageOf(c) === deliveryFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => (c.client_name || '').toLowerCase().includes(q));
    return list;
  }, [cases, deliveryFilter, search]);

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
    <div className={cn("max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 animate-pageIn", view === "board" ? "flex flex-col h-[calc(100dvh-56px)] md:h-screen pb-2" : "pb-10")}>
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

      {/* View toggle + delivery-stage status */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="inline-flex items-center gap-1 bg-surface-2 rounded-lg p-1">
          <button onClick={() => setView('board')} className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition', view === 'board' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}>
            <LayoutGrid className="w-3.5 h-3.5" /> Board
          </button>
          <button onClick={() => setView('list')} className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition', view === 'list' ? 'bg-surface shadow-sm text-ink' : 'text-muted hover:text-ink')}>
            <ListIcon className="w-3.5 h-3.5" /> List
          </button>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client…"
            className="pl-8 pr-3 py-2 border border-border rounded-md bg-surface text-[13px] outline-none focus:border-indigo-400 w-full sm:w-[200px]" />
        </div>
      </div>

      {view === 'board' ? (
        <CasesBoard
          cases={cases}
          onOpen={(id) => setSelectedCaseId(id)}
          onMove={(id, stage) => updateCase(id, { delivery_stage: stage })}
          search={search}
        />
      ) : (
        <>
          {/* Delivery-stage filter chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-4">
            <button onClick={() => setDeliveryFilter('all')} className={cn('filter-chip flex-shrink-0', deliveryFilter === 'all' && 'active')}>
              All<span className="count">{cases.length}</span>
            </button>
            {DELIVERY_STAGES.map((st) => (
              <button key={st.key} onClick={() => setDeliveryFilter(st.key)}
                className={cn('filter-chip flex-shrink-0', deliveryFilter === st.key && 'active')}>
                <span className="chip-dot" style={{ background: st.accent, marginRight: 4 }} />{st.label}
                <span className="count">{deliveryCounts[st.key] || 0}</span>
              </button>
            ))}
          </div>

          {deliveryFiltered.length === 0 ? (
            <div className="panel panel-pad text-center py-16">
              <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-3"><Briefcase className="w-5 h-5 text-faint" /></div>
              <div className="text-[14px] font-medium mb-1">No cases here</div>
              <div className="text-[12.5px] text-muted mb-4">{cases.length === 0 ? 'Open your first case to start tracking.' : 'Try a different status.'}</div>
              {cases.length === 0 && <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm mx-auto"><Plus className="w-3.5 h-3.5" /> New case</button>}
            </div>
          ) : (
            <div className="space-y-2.5">
              {deliveryFiltered.map((c) => {
                const st = DELIVERY_BY_KEY[deliveryStageOf(c)];
                return (
                  <div key={c.id} className="panel px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelectedCaseId(c.id)}>
                    <div className="av flex-shrink-0" style={{ background: avatarColor(c.id) }}>{initials(c.client_name)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink text-[13.5px] truncate">{c.client_name}</div>
                      <div className="text-[11.5px] text-muted truncate">{(c.visa_type || 'gtv').toUpperCase()}{c.client_phone ? ` · ${c.client_phone}` : ''}</div>
                    </div>
                    {/* stage selector (stops row click) */}
                    <select
                      value={deliveryStageOf(c)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { e.stopPropagation(); updateCase(c.id, { delivery_stage: e.target.value }); }}
                      className="text-[12px] font-semibold rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer flex-shrink-0"
                      style={{ background: st.tint, color: st.accent }}
                    >
                      {DELIVERY_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          )}
        </>
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
