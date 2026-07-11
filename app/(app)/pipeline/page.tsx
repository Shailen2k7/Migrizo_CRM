'use client';

// =============================================================================
// PIPELINE BOARD v2 — Bigin-style kanban over leads
// -----------------------------------------------------------------------------
// v2 changes:
//  * Stronger column styling — solid tinted background + visible colored border.
//  * No money on the board (amounts removed from cards and column headers).
//  * Big columns are paged: newest 30 cards render first, "Show more" loads the
//    rest in batches — keeps an 800-lead Cold column fast and scannable.
//  * Cards sort by most recently updated, so live leads float to the top.
// =============================================================================

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DealTag } from '@/components/shared/deal-tag';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { usePipelines, getStageColor, STAGE_COLOR_LIST, type Pipeline, type Stage, type StageColor } from '@/lib/pipelines';
import { getVisaMeta, type Lead } from '@/lib/types';
import { Plus, Settings2, X, ChevronUp, ChevronDown, Trash2, GripVertical, Check, Send } from 'lucide-react';
import { toast } from 'sonner';

// Lead may carry pipeline_id after migration 003; the base type doesn't know it yet.
type LeadP = Lead & { pipeline_id?: string | null };

const PAGE_SIZE = 30; // cards rendered per column before "Show more"

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------
function PipelinePageInner() {
  const { leads, updateLead, workspace } = useApp();
  const ui = useUI();
  const pl = usePipelines(workspace.id);
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  // Per-stage visible card count (stage.id -> n). Resets when switching pipeline.
  const [visible, setVisible] = useState<Record<string, number>>({});

  const ordered = useMemo(
    () => [...pl.pipelines].sort((a, b) => (Number(b.is_default) - Number(a.is_default)) || a.sort_order - b.sort_order),
    [pl.pipelines]
  );
  const defaultPipeline = ordered.find((p) => p.is_default) || ordered[0] || null;
  const selected = ordered.find((p) => p.id === selectedId) || defaultPipeline;
  const stages = selected ? pl.stagesFor(selected.id) : [];

  // Leads belonging to the selected pipeline. Null pipeline_id → default pipeline.
  const boardLeads = useMemo(() => {
    if (!selected) return [] as LeadP[];
    return (leads as LeadP[]).filter((l) =>
      l.pipeline_id === selected.id || (!l.pipeline_id && selected.is_default)
    );
  }, [leads, selected]);

  const leadsByStage = useMemo(() => {
    const map = new Map<string, LeadP[]>();
    for (const s of stages) map.set(s.stage_key, []);
    for (const l of boardLeads) {
      if (map.has(l.stage)) map.get(l.stage)!.push(l);
    }
    // Most recently touched first — live leads float to the top of each column.
    for (const arr of map.values()) arr.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return map;
  }, [stages, boardLeads]);

  // Leads whose stage_key doesn't match any column (e.g. stage deleted elsewhere).
  const orphans = useMemo(
    () => boardLeads.filter((l) => !stages.some((s) => s.stage_key === l.stage)),
    [boardLeads, stages]
  );

  // ---- Drag state ------------------------------------------------------------
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // ---- lead selection for bulk email (does not alter card look/drag) ----
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const emailableIds = useMemo(() => boardLeads.filter((l) => l.email && l.email.includes('@')).map((l) => l.id), [boardLeads]);
  const togglePick = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectEveryone = () => setPicked(new Set(emailableIds));
  const emailSelected = () => {
    const ids = Array.from(picked);
    if (ids.length === 0) return;
    sessionStorage.setItem('campaign_preselect', JSON.stringify(ids));
    router.push('/campaigns');
  };
  const dragCounter = useRef<Record<string, number>>({});

  const onDropToStage = async (stage: Stage) => {
    const id = dragId;
    setDragId(null); setOverStage(null); dragCounter.current = {};
    if (!id) return;
    const lead = boardLeads.find((l) => l.id === id);
    if (!lead || lead.stage === stage.stage_key) return;
    const patch: Partial<LeadP> = { stage: stage.stage_key as Lead['stage'] };
    // Custom "won"-type stages should stamp the conversion time too (the app's
    // built-in stamp only fires for the literal 'won' key).
    if (stage.stage_type === 'won' && !lead.won_at) patch.won_at = new Date().toISOString();
    await updateLead(id, patch as Partial<Lead>);
  };

  if (pl.loading) {
    return <div className="p-10 text-muted text-sm">Loading pipelines…</div>;
  }

  if (!selected) {
    return (
      <div className="max-w-[700px] mx-auto px-6 pt-16 text-center">
        <h1 className="text-[22px] font-bold">No pipelines yet</h1>
        <p className="text-[13.5px] text-muted mt-2">Run migration 003 in Supabase to create your default pipeline, or add one below.</p>
        <button className="btn btn-primary mt-5" onClick={async () => { const p = await pl.createPipeline('Global Talent Visa', 'GTV'); if (p) setSelectedId(p.id); }}>
          Create first pipeline
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-4 animate-pageIn flex flex-col h-[calc(100dvh-56px)] md:h-screen">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-[1.1]">Pipeline</h1>
          <p className="text-[13.5px] text-muted mt-2">
            {boardLeads.length} lead{boardLeads.length === 1 ? '' : 's'} in {selected.name} · drag cards between stages
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setManageOpen(true)} className="btn btn-outline">
            <Settings2 className="w-4 h-4" /> Manage
          </button>
          <button onClick={ui.openAddLead} className="btn btn-primary">
            <Plus className="w-4 h-4" /> Add Lead
          </button>
        </div>
      </div>

      {/* Pipeline tabs */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {ordered.map((p) => {
          const active = p.id === selected.id;
          const count = (leads as LeadP[]).filter((l) => l.pipeline_id === p.id || (!l.pipeline_id && p.is_default)).length;
          return (
            <button
              key={p.id}
              onClick={() => { setSelectedId(p.id); setVisible({}); }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium whitespace-nowrap border transition-all ${
                active ? 'bg-[#4F46E5] text-white border-transparent shadow-sm' : 'bg-surface text-ink-2 border-border hover:border-border-strong'
              }`}
            >
              {p.name}
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full leading-none ${active ? 'bg-white/20' : 'bg-surface-2 text-muted'}`}>{count}</span>
            </button>
          );
        })}
        <NewPipelineButton onCreate={async (name) => { const p = await pl.createPipeline(name); if (p) { setSelectedId(p.id); setVisible({}); } }} />
      </div>

      {orphans.length > 0 && (
        <div className="mb-3 text-[12.5px] px-3.5 py-2.5 rounded-[10px] border" style={{ background: '#FEFAF0', borderColor: '#F5E3B5', color: '#8A5A0B' }}>
          {orphans.length} lead{orphans.length === 1 ? '' : 's'} in this pipeline have a stage that no longer exists — drag them out of the "Unassigned" column.
        </div>
      )}

      {/* Board */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden -mx-1 px-1" style={{ overscrollBehavior: 'contain' }}>
        <div className="flex gap-3 h-full pb-2 pr-8 snap-x snap-mandatory sm:snap-none" style={{ minHeight: 420 }}>
          {stages.map((stage) => {
            const col = getStageColor(stage.color);
            const items = leadsByStage.get(stage.stage_key) || [];
            const shown = visible[stage.id] ?? PAGE_SIZE;
            const paged = items.slice(0, shown);
            const remaining = items.length - paged.length;
            const isOver = overStage === stage.id;
            return (
              <div
                key={stage.id}
                className="flex flex-col w-[31vw] sm:w-[220px] flex-shrink-0 rounded-[14px] transition-all snap-start"
                style={{
                  background: col.bg,
                  border: `1.5px solid ${isOver ? col.dot : `${col.dot}55`}`,
                  boxShadow: isOver ? `0 0 0 3px ${col.dot}2E` : `0 1px 2px rgba(15,17,21,0.04)`,
                }}
                onDragEnter={(e) => { e.preventDefault(); dragCounter.current[stage.id] = (dragCounter.current[stage.id] || 0) + 1; setOverStage(stage.id); }}
                onDragLeave={() => { dragCounter.current[stage.id] = (dragCounter.current[stage.id] || 1) - 1; if (dragCounter.current[stage.id] <= 0) setOverStage((s) => (s === stage.id ? null : s)); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onDropToStage(stage); }}
              >
                {/* Column header */}
                <div className="px-3.5 pt-3 pb-2.5 border-b" style={{ borderColor: `${col.dot}33` }}>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.dot }} />
                    <span className="text-[13px] font-bold truncate" style={{ color: col.fg }}>{stage.name}</span>
                    {(() => {
                      const colIds = items.filter((l) => l.email && l.email.includes('@')).map((l) => l.id);
                      const colSel = colIds.length > 0 && colIds.every((id) => picked.has(id));
                      if (colIds.length === 0) return null;
                      return (
                        <button
                          onClick={() => setPicked((prev) => {
                            const n = new Set(prev);
                            if (colSel) colIds.forEach((id) => n.delete(id));
                            else colIds.forEach((id) => n.add(id));
                            return n;
                          })}
                          title={colSel ? `Deselect all in ${stage.name}` : `Select all in ${stage.name}`}
                          className="ml-auto flex-shrink-0"
                        >
                          <SelectBox checked={colSel} size={18} accent={col.dot} />
                        </button>
                      );
                    })()}
                  </div>
                  <div className="text-[11px] font-semibold mt-1 pl-[18px]" style={{ color: col.fg, opacity: 0.75 }}>
                    {items.length} lead{items.length === 1 ? '' : 's'}
                  </div>
                </div>
                {/* Cards */}
                <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-2" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                  {paged.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      dragging={dragId === lead.id}
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => { setDragId(null); setOverStage(null); dragCounter.current = {}; }}
                      onClick={() => ui.openLeadDrawer(lead.id)}
                      selected={picked.has(lead.id)}
                      onToggleSelect={() => togglePick(lead.id)}
                    />
                  ))}
                  {remaining > 0 && (
                    <button
                      onClick={() => setVisible((v) => ({ ...v, [stage.id]: shown + PAGE_SIZE }))}
                      className="w-full py-2.5 rounded-[10px] text-[12px] font-semibold border border-dashed transition-all hover:shadow-sm"
                      style={{ borderColor: `${col.dot}66`, color: col.fg, background: 'rgba(255,255,255,0.55)' }}
                    >
                      Show {Math.min(PAGE_SIZE, remaining)} more · {remaining} hidden
                    </button>
                  )}
                  {items.length === 0 && (
                    <div className="border border-dashed rounded-[10px] py-8 text-center text-[12px]" style={{ borderColor: `${col.dot}55`, color: col.fg, opacity: 0.7 }}>
                      Drop leads here
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Orphans column (only when needed) */}
          {orphans.length > 0 && (
            <div className="flex flex-col w-[31vw] sm:w-[220px] flex-shrink-0 rounded-[14px]" style={{ background: '#F4F4F6', border: '1.5px dashed #9CA3AF' }}>
              <div className="px-3.5 pt-3 pb-2.5 border-b" style={{ borderColor: '#9CA3AF44' }}>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-400 flex-shrink-0" />
                  <span className="text-[13px] font-bold text-ink-2">Unassigned</span>
                  <span className="ml-auto text-[11.5px] font-bold px-2 py-0.5 rounded-full bg-white/75 text-ink-2">{orphans.length}</span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-2" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
                {orphans.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    dragging={dragId === lead.id}
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null); dragCounter.current = {}; }}
                    onClick={() => ui.openLeadDrawer(lead.id)}
                    selected={picked.has(lead.id)}
                    onToggleSelect={() => togglePick(lead.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating bar — appears only when leads are selected */}
      {picked.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-5 z-40 animate-fadeIn">
          <div className="bg-ink text-white rounded-2xl shadow-2xl px-3 py-2.5 flex items-center gap-2 whitespace-nowrap">
            <span className="text-[13px] font-semibold px-2">{picked.size} selected</span>
            <button onClick={selectEveryone} className="text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg hover:bg-white/10">All ({emailableIds.length})</button>
            <button onClick={() => setPicked(new Set())} className="text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg hover:bg-white/10">Clear</button>
            <button onClick={emailSelected} className="inline-flex items-center gap-1.5 text-[13px] font-bold px-4 py-1.5 rounded-lg bg-indigo hover:bg-indigo-600 ml-1">
              <Send className="w-4 h-4" /> Choose template &amp; send
            </button>
          </div>
        </div>
      )}

      {manageOpen && selected && (
        <ManageModal
          pipeline={selected}
          pipelines={ordered}
          stages={stages}
          leads={leads as LeadP[]}
          pl={pl}
          updateLead={updateLead}
          onSelectPipeline={setSelectedId}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Lead card — name + visa pill + last-touched time. No money on the board.
// -----------------------------------------------------------------------------
// Premium custom checkbox — rounded, brand-filled when checked, crisp check.
function SelectBox({ checked, accent = '#4F46E5', size = 18 }: { checked: boolean; accent?: string; size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 6, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        transition: 'all .15s ease',
        background: checked ? accent : '#FFFFFF',
        border: `1.5px solid ${checked ? accent : '#CBD3E1'}`,
        boxShadow: checked ? `0 1px 3px ${accent}55` : 'inset 0 1px 2px rgba(16,24,40,0.05)',
      }}
    >
      {checked && (
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </span>
  );
}

function LeadCard({ lead, dragging, onDragStart, onDragEnd, onClick, selected = false, onToggleSelect }: {
  lead: LeadP; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
  selected?: boolean; onToggleSelect?: () => void;
}) {
  const visa = getVisaMeta(lead.visa_type);
  const hasEmail = !!lead.email && lead.email.includes('@');
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', lead.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group relative bg-surface border rounded-[10px] px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-all hover:shadow-md ${selected ? 'border-indigo' : 'border-border hover:border-border-strong'} ${dragging ? 'opacity-40 rotate-[1.5deg] scale-[0.98]' : ''}`}
    >
      {/* Selection checkbox — corner overlay, only shown for leads with an email.
          Absolutely positioned so the card layout stays identical. */}
      {hasEmail && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`absolute top-1.5 right-1.5 z-10 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title={selected ? 'Deselect' : 'Select for email'}
        >
          <SelectBox checked={selected} />
        </button>
      )}
      <div className="flex items-center gap-2">
        <GripVertical className="w-3.5 h-3.5 text-faint opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 -ml-1" />
        <span className="text-[13px] font-medium truncate flex-1 -ml-1">{lead.full_name}</span>
        {visa && (
          <span className="chip flex-shrink-0" style={{ background: visa.bg, color: visa.fg, fontSize: 10, padding: '1px 7px' }}>
            {visa.short}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1.5 pl-1.5 text-[11.5px] text-muted">
        <span className="truncate">{lead.phone || lead.email || '—'}</span>
        <DealTag lead={lead} />
        <span className="ml-auto flex-shrink-0">{relTime(lead.updated_at)}</span>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}

// -----------------------------------------------------------------------------
// "+ New" pipeline button (inline name input)
// -----------------------------------------------------------------------------
function NewPipelineButton({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-medium text-ink-2 border border-dashed border-border hover:border-border-strong hover:bg-surface-2 whitespace-nowrap transition-all">
        <Plus className="w-3.5 h-3.5" /> New pipeline
      </button>
    );
  }
  return (
    <form
      className="inline-flex items-center gap-1.5"
      onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await onCreate(name); setName(''); setEditing(false); } }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setName(''); } }}
        placeholder="e.g. Innovator Founder Visa"
        className="px-3 py-2 rounded-full text-[13px] border border-border bg-surface outline-none focus:border-[#4F46E5] w-[220px]"
      />
      <button type="submit" className="btn btn-primary btn-sm rounded-full"><Check className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={() => { setEditing(false); setName(''); }} className="btn btn-ghost btn-sm rounded-full"><X className="w-3.5 h-3.5" /></button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Manage modal — edit stages of the current pipeline + pipeline actions
// -----------------------------------------------------------------------------
function ManageModal({ pipeline, pipelines, stages, leads, pl, updateLead, onSelectPipeline, onClose }: {
  pipeline: Pipeline;
  pipelines: Pipeline[];
  stages: Stage[];
  leads: LeadP[];
  pl: ReturnType<typeof usePipelines>;
  updateLead: (id: string, patch: Partial<Lead>) => Promise<void>;
  onSelectPipeline: (id: string | null) => void;
  onClose: () => void;
}) {
  const [pipelineName, setPipelineName] = useState(pipeline.name);
  const [newStage, setNewStage] = useState('');

  const leadCountInStage = (stageKey: string) =>
    leads.filter((l) => (l.pipeline_id === pipeline.id || (!l.pipeline_id && pipeline.is_default)) && l.stage === stageKey).length;
  const leadCountInPipeline = leads.filter((l) => l.pipeline_id === pipeline.id || (!l.pipeline_id && pipeline.is_default)).length;

  // Deleting a stage that still has leads: move them to the first remaining stage.
  const handleDeleteStage = async (stage: Stage) => {
    const count = leadCountInStage(stage.stage_key);
    const remaining = stages.filter((s) => s.id !== stage.id);
    if (remaining.length === 0) { toast.error('A pipeline needs at least one stage'); return; }
    if (count > 0) {
      const target = remaining[0];
      const ok = window.confirm(`"${stage.name}" has ${count} lead${count === 1 ? '' : 's'}. They'll be moved to "${target.name}". Continue?`);
      if (!ok) return;
      const affected = leads.filter((l) => (l.pipeline_id === pipeline.id || (!l.pipeline_id && pipeline.is_default)) && l.stage === stage.stage_key);
      for (const l of affected) {
        await updateLead(l.id, { stage: target.stage_key as Lead['stage'] });
      }
    }
    const done = await pl.deleteStage(stage.id);
    if (done) toast.success(`Deleted stage "${stage.name}"`);
  };

  const handleDeletePipeline = async () => {
    const ok = window.confirm(`Delete pipeline "${pipeline.name}"? This cannot be undone.`);
    if (!ok) return;
    const done = await pl.deletePipeline(pipeline.id, leadCountInPipeline);
    if (done) { onSelectPipeline(null); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fadeIn" />
      <div
        className="relative bg-surface border border-border rounded-[16px] shadow-2xl w-full max-w-[560px] max-h-[85vh] flex flex-col animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-semibold">Manage pipeline</div>
            <div className="text-[12px] text-muted mt-0.5">Rename, recolor, reorder, add or delete stages</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Pipeline name */}
          <div>
            <label className="text-[12px] font-medium text-ink-2">Pipeline name</label>
            <div className="flex gap-2 mt-1.5">
              <input
                value={pipelineName}
                onChange={(e) => setPipelineName(e.target.value)}
                className="flex-1 px-3 py-2 rounded-[10px] text-[13.5px] border border-border bg-surface outline-none focus:border-[#4F46E5]"
              />
              <button
                className="btn btn-outline"
                onClick={() => { if (pipelineName.trim() && pipelineName.trim() !== pipeline.name) pl.renamePipeline(pipeline.id, pipelineName); }}
              >
                Save
              </button>
            </div>
          </div>

          {/* Stages */}
          <div>
            <label className="text-[12px] font-medium text-ink-2">Stages</label>
            <div className="mt-1.5 space-y-1.5">
              {stages.map((s, i) => (
                <StageRow
                  key={s.id}
                  stage={s}
                  leadCount={leadCountInStage(s.stage_key)}
                  isFirst={i === 0}
                  isLast={i === stages.length - 1}
                  onRename={(name) => pl.updateStage(s.id, { name })}
                  onColor={(color) => pl.updateStage(s.id, { color })}
                  onType={(stage_type) => pl.updateStage(s.id, { stage_type })}
                  onMove={(dir) => pl.moveStage(s.id, dir)}
                  onDelete={() => handleDeleteStage(s)}
                />
              ))}
            </div>
            {/* Add stage */}
            <form
              className="flex gap-2 mt-2.5"
              onSubmit={async (e) => { e.preventDefault(); if (newStage.trim()) { await pl.createStage(pipeline.id, newStage); setNewStage(''); } }}
            >
              <input
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                placeholder="Add a stage… e.g. Consultation Booked"
                className="flex-1 px-3 py-2 rounded-[10px] text-[13px] border border-dashed border-border bg-surface outline-none focus:border-[#4F46E5]"
              />
              <button type="submit" className="btn btn-outline"><Plus className="w-4 h-4" /> Add</button>
            </form>
            <p className="text-[11.5px] text-faint mt-2">
              Mark one stage as <b>Won</b> and one as <b>Lost</b> — the Daily Tracker and AI COO use these to compute conversions.
            </p>
          </div>

          {/* Danger zone */}
          {!pipeline.is_default && (
            <div className="pt-1">
              <button onClick={handleDeletePipeline} className="btn btn-sm" style={{ background: '#FEE2E2', color: '#B91C1C' }}>
                <Trash2 className="w-3.5 h-3.5" /> Delete this pipeline
              </button>
              {leadCountInPipeline > 0 && (
                <span className="text-[11.5px] text-faint ml-2">Blocked while it has {leadCountInPipeline} lead{leadCountInPipeline === 1 ? '' : 's'}</span>
              )}
            </div>
          )}
          {pipeline.is_default && (
            <p className="text-[11.5px] text-faint">This is the default pipeline — it can be renamed and edited but not deleted. New and unassigned leads land here.</p>
          )}
          {pipelines.length > 1 && (
            <p className="text-[11.5px] text-faint">Tip: switch pipelines with the tabs on the board to manage their stages.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// One editable stage row inside the Manage modal.
function StageRow({ stage, leadCount, isFirst, isLast, onRename, onColor, onType, onMove, onDelete }: {
  stage: Stage; leadCount: number; isFirst: boolean; isLast: boolean;
  onRename: (name: string) => void;
  onColor: (c: StageColor) => void;
  onType: (t: Stage['stage_type']) => void;
  onMove: (dir: 'up' | 'down') => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [colorOpen, setColorOpen] = useState(false);
  const col = getStageColor(stage.color);

  return (
    <div className="flex items-center gap-2 border border-border rounded-[10px] px-2.5 py-2 bg-surface">
      {/* Color dot / picker */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setColorOpen((o) => !o)}
          className="w-5 h-5 rounded-full border border-black/10 flex-shrink-0"
          style={{ background: col.dot }}
          title="Change color"
        />
        {colorOpen && (
          <div className="absolute z-10 top-7 left-0 bg-surface border border-border rounded-[10px] shadow-lg p-2 grid grid-cols-5 gap-1.5 animate-fadeIn">
            {STAGE_COLOR_LIST.map((c) => (
              <button
                key={c}
                type="button"
                className="w-5 h-5 rounded-full border border-black/10"
                style={{ background: getStageColor(c).dot }}
                onClick={() => { onColor(c); setColorOpen(false); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Name (saves on blur / Enter) */}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => { if (name.trim() && name.trim() !== stage.name) onRename(name.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="flex-1 min-w-0 px-2 py-1 rounded-md text-[13px] bg-transparent outline-none focus:bg-surface-2"
      />

      <span className="text-[11px] text-faint whitespace-nowrap">{leadCount} lead{leadCount === 1 ? '' : 's'}</span>

      {/* Stage type */}
      <select
        value={stage.stage_type}
        onChange={(e) => onType(e.target.value as Stage['stage_type'])}
        className="text-[11.5px] px-1.5 py-1 rounded-md border border-border bg-surface text-ink-2 outline-none"
        title="Stage type (drives conversion metrics)"
      >
        <option value="active">Active</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>

      {/* Reorder + delete */}
      <div className="flex items-center">
        <button type="button" disabled={isFirst} onClick={() => onMove('up')} className="p-1 rounded hover:bg-surface-2 disabled:opacity-25"><ChevronUp className="w-3.5 h-3.5" /></button>
        <button type="button" disabled={isLast} onClick={() => onMove('down')} className="p-1 rounded hover:bg-surface-2 disabled:opacity-25"><ChevronDown className="w-3.5 h-3.5" /></button>
        <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-red-50 text-faint hover:text-red-600 ml-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
export default function PipelinePage() {
  return (
    <Suspense fallback={<div className="p-10 text-muted text-sm">Loading…</div>}>
      <PipelinePageInner />
    </Suspense>
  );
}
