'use client';

// =============================================================================
// PIPELINE BOARD — Bigin-style kanban over leads
// -----------------------------------------------------------------------------
// * Tabs across the top: one per pipeline (GTV, IFV, ...), plus "+ New".
// * Columns = the selected pipeline's stages. Drag a lead card between columns
//   to change its stage (uses the app's existing optimistic updateLead, so
//   activity logging + realtime keep working untouched).
// * "Manage" opens an inline editor: rename/recolor/reorder/delete stages,
//   add stages, rename/delete pipelines — no separate settings page needed.
// * Leads with no pipeline_id (e.g. fresh Meta ingests) appear in the default
//   pipeline, so nothing ever disappears.
// =============================================================================

import { Suspense, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { usePipelines, getStageColor, STAGE_COLOR_LIST, type Pipeline, type Stage, type StageColor } from '@/lib/pipelines';
import { getVisaMeta, type Lead } from '@/lib/types';
import { formatMoneyShort } from '@/lib/utils';
import { Plus, Settings2, X, ChevronUp, ChevronDown, Trash2, GripVertical, Check } from 'lucide-react';
import { toast } from 'sonner';

// Lead may carry pipeline_id after migration 003; the base type doesn't know it yet.
type LeadP = Lead & { pipeline_id?: string | null };

// -----------------------------------------------------------------------------
// Page shell
// -----------------------------------------------------------------------------
function PipelinePageInner() {
  const { leads, updateLead, workspace } = useApp();
  const ui = useUI();
  const pl = usePipelines(workspace.id);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

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
    <div className="px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-6 animate-pageIn h-full flex flex-col">
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
              onClick={() => setSelectedId(p.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium whitespace-nowrap border transition-all ${
                active ? 'bg-[#4F46E5] text-white border-transparent shadow-sm' : 'bg-surface text-ink-2 border-border hover:border-border-strong'
              }`}
            >
              {p.name}
              <span className={`text-[11px] px-1.5 py-0.5 rounded-full leading-none ${active ? 'bg-white/20' : 'bg-surface-2 text-muted'}`}>{count}</span>
            </button>
          );
        })}
        <NewPipelineButton onCreate={async (name) => { const p = await pl.createPipeline(name); if (p) setSelectedId(p.id); }} />
      </div>

      {orphans.length > 0 && (
        <div className="mb-3 text-[12.5px] px-3.5 py-2.5 rounded-[10px] border" style={{ background: '#FEFAF0', borderColor: '#F5E3B5', color: '#8A5A0B' }}>
          {orphans.length} lead{orphans.length === 1 ? '' : 's'} in this pipeline have a stage that no longer exists — drag them out of the “Unassigned” column.
        </div>
      )}

      {/* Board */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden -mx-1 px-1">
        <div className="flex gap-3.5 h-full pb-2" style={{ minHeight: 420 }}>
          {stages.map((stage) => {
            const col = getStageColor(stage.color);
            const items = leadsByStage.get(stage.stage_key) || [];
            const sums = new Map<string, number>();
            for (const l of items) {
              if (l.amount_total > 0) sums.set(l.currency || 'INR', (sums.get(l.currency || 'INR') || 0) + l.amount_total);
            }
            const sumLabel = sums.size === 0 ? '—' : Array.from(sums.entries()).map(([c, n]) => formatMoneyShort(n, c)).join(' · ');
            const isOver = overStage === stage.id;
            return (
              <div
                key={stage.id}
                className="flex flex-col w-[280px] flex-shrink-0 rounded-[14px] border transition-all"
                style={{
                  background: isOver ? col.bg : col.soft,
                  borderColor: isOver ? col.dot : 'hsl(var(--border))',
                  boxShadow: isOver ? `0 0 0 2px ${col.dot}33` : undefined,
                }}
                onDragEnter={(e) => { e.preventDefault(); dragCounter.current[stage.id] = (dragCounter.current[stage.id] || 0) + 1; setOverStage(stage.id); }}
                onDragLeave={() => { dragCounter.current[stage.id] = (dragCounter.current[stage.id] || 1) - 1; if (dragCounter.current[stage.id] <= 0) setOverStage((s) => (s === stage.id ? null : s)); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); onDropToStage(stage); }}
              >
                {/* Column header */}
                <div className="px-3.5 pt-3.5 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col.dot }} />
                    <span className="text-[13px] font-semibold truncate" style={{ color: col.fg }}>{stage.name}</span>
                    <span className="ml-auto text-[11.5px] font-medium px-2 py-0.5 rounded-full" style={{ background: col.bg, color: col.fg }}>
                      {items.length}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1.5 pl-4">{sumLabel}</div>
                </div>
                {/* Cards */}
                <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-2">
                  {items.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      dragging={dragId === lead.id}
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => { setDragId(null); setOverStage(null); dragCounter.current = {}; }}
                      onClick={() => ui.openLeadDrawer(lead.id)}
                    />
                  ))}
                  {items.length === 0 && (
                    <div className="border border-dashed rounded-[10px] py-8 text-center text-[12px] text-faint" style={{ borderColor: 'hsl(var(--border))' }}>
                      Drop leads here
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Orphans column (only when needed) */}
          {orphans.length > 0 && (
            <div className="flex flex-col w-[280px] flex-shrink-0 rounded-[14px] border border-dashed" style={{ background: '#FBFBFC', borderColor: 'hsl(var(--border))' }}>
              <div className="px-3.5 pt-3.5 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                  <span className="text-[13px] font-semibold text-ink-2">Unassigned</span>
                  <span className="ml-auto text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-surface-2 text-muted">{orphans.length}</span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-2">
                {orphans.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    dragging={dragId === lead.id}
                    onDragStart={() => setDragId(lead.id)}
                    onDragEnd={() => { setDragId(null); setOverStage(null); dragCounter.current = {}; }}
                    onClick={() => ui.openLeadDrawer(lead.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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
// Lead card
// -----------------------------------------------------------------------------
function LeadCard({ lead, dragging, onDragStart, onDragEnd, onClick }: {
  lead: LeadP; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void;
}) {
  const visa = getVisaMeta(lead.visa_type);
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', lead.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`group bg-surface border border-border rounded-[10px] px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-all hover:border-border-strong hover:shadow-sm ${dragging ? 'opacity-40 rotate-[1.5deg] scale-[0.98]' : ''}`}
    >
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
        <span className="font-medium" style={{ color: lead.amount_total > 0 ? '#0F1115' : undefined }}>
          {lead.amount_total > 0 ? formatMoneyShort(lead.amount_total, lead.currency) : 'No value'}
        </span>
        <span className="ml-auto">{relTime(lead.updated_at)}</span>
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
