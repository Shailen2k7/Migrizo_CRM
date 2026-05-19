'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, Plus, Trash2, CheckCircle2, Circle, Clock, Ban, FileText, Phone, Mail, ExternalLink, Pencil, Briefcase } from 'lucide-react';
import { useApp } from '@/components/shared/app-provider';
import type { Case, CaseStage, CaseChecklistItem, CaseActivity, CaseStatus, ChecklistStatus } from '@/lib/types';
import { CASE_STAGE_META, CASE_STAGE_ORDER, CASE_STATUS_META, CATEGORY_LABELS } from '@/lib/types';
import { initials, avatarColor, timeAgo, cn } from '@/lib/utils';

interface Props {
  caseId: string | null;
  onClose: () => void;
}

export function CaseDrawer({ caseId, onClose }: Props) {
  const { cases, updateCase, deleteCase, getChecklist, updateChecklistItem, addChecklistItem, deleteChecklistItem, getCaseActivity, role, memberNameById } = useApp();
  const caseData = caseId ? cases.find((c) => c.id === caseId) : null;
  const [items, setItems] = useState<CaseChecklistItem[]>([]);
  const [activityLog, setActivityLog] = useState<CaseActivity[]>([]);
  const [expandedStage, setExpandedStage] = useState<CaseStage | null>(null);
  const [tab, setTab] = useState<'pipeline' | 'overview' | 'activity'>('pipeline');

  const reload = useCallback(async () => {
    if (!caseId) return;
    const [list, log] = await Promise.all([getChecklist(caseId), getCaseActivity(caseId)]);
    setItems(list);
    setActivityLog(log);
  }, [caseId, getChecklist, getCaseActivity]);

  useEffect(() => {
    if (!caseId) { setItems([]); setActivityLog([]); return; }
    reload();
  }, [caseId, reload]);

  useEffect(() => {
    if (caseData && !expandedStage) setExpandedStage(caseData.current_stage);
  }, [caseData, expandedStage]);

  // Compute progress per stage
  const stageProgress = useMemo(() => {
    const map: Record<CaseStage, { total: number; done: number; required: number; requiredDone: number }> = {
      roadmap_building: { total: 0, done: 0, required: 0, requiredDone: 0 },
      profile_building: { total: 0, done: 0, required: 0, requiredDone: 0 },
      final_mapping: { total: 0, done: 0, required: 0, requiredDone: 0 },
      endorsement_submission: { total: 0, done: 0, required: 0, requiredDone: 0 },
      visa_application: { total: 0, done: 0, required: 0, requiredDone: 0 },
      post_arrival: { total: 0, done: 0, required: 0, requiredDone: 0 },
    };
    items.forEach((it) => {
      if (it.status === 'not_applicable') return;
      map[it.stage].total++;
      if (it.is_required) map[it.stage].required++;
      if (it.status === 'completed') {
        map[it.stage].done++;
        if (it.is_required) map[it.stage].requiredDone++;
      }
    });
    return map;
  }, [items]);

  const overallProgress = useMemo(() => {
    const totals = Object.values(stageProgress).reduce((a, b) => ({
      total: a.total + b.required,
      done: a.done + b.requiredDone,
    }), { total: 0, done: 0 });
    return totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);
  }, [stageProgress]);

  const toggleStatus = async (item: CaseChecklistItem) => {
    const newStatus: ChecklistStatus = item.status === 'completed' ? 'pending' : 'completed';
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : null } : i));
    await updateChecklistItem(item.id, { status: newStatus });
    reload();
  };

  const cycleStatus = async (item: CaseChecklistItem) => {
    const order: ChecklistStatus[] = ['pending', 'in_progress', 'completed', 'not_applicable'];
    const next = order[(order.indexOf(item.status) + 1) % order.length];
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, status: next } : i));
    await updateChecklistItem(item.id, { status: next });
    reload();
  };

  const saveNote = async (item: CaseChecklistItem, notes: string) => {
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, notes } : i));
    await updateChecklistItem(item.id, { notes });
  };

  const advanceStage = async (next: CaseStage) => {
    if (!caseData) return;
    await updateCase(caseData.id, { current_stage: next });
    setExpandedStage(next);
    reload();
  };

  const handleDelete = async () => {
    if (!caseData) return;
    if (!confirm(`Delete case for ${caseData.client_name}? This is permanent.`)) return;
    await deleteCase(caseData.id);
    onClose();
  };

  return (
    <AnimatePresence>
      {caseId && caseData && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[920px] bg-surface z-50 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="av" style={{ background: avatarColor(caseData.id), width: 44, height: 44, fontSize: 16 }}>{initials(caseData.client_name)}</div>
                <div className="min-w-0">
                  <h2 className="text-[18px] font-bold tracking-tight truncate">{caseData.client_name}</h2>
                  <div className="flex items-center gap-2 text-[11.5px] text-muted mt-0.5 flex-wrap">
                    <span>{caseData.visa_type}</span>
                    {caseData.client_email && <><span>·</span><a href={`mailto:${caseData.client_email}`} className="hover:text-indigo-600 inline-flex items-center gap-1"><Mail className="w-3 h-3" />{caseData.client_email}</a></>}
                    {caseData.client_phone && <><span>·</span><a href={`tel:${caseData.client_phone}`} className="hover:text-indigo-600 inline-flex items-center gap-1"><Phone className="w-3 h-3" />{caseData.client_phone}</a></>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusDropdown caseData={caseData} onChange={(s) => updateCase(caseData.id, { status: s })} />
                {role === 'admin' && <button onClick={handleDelete} className="p-2 rounded hover:bg-rose-50 text-muted hover:text-danger" title="Delete case"><Trash2 className="w-4 h-4" /></button>}
                <button onClick={onClose} className="p-2 rounded hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Tabs + overall progress */}
            <div className="px-6 pt-4 pb-3 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 max-w-[200px]">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted">Overall progress</span>
                      <span className="num font-semibold">{overallProgress}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full transition-all" style={{ width: `${overallProgress}%`, background: 'linear-gradient(90deg, #6366F1, #10B981)' }} />
                    </div>
                  </div>
                  <div className="text-[11px] text-muted">
                    Started {timeAgo(caseData.started_at)}
                  </div>
                </div>
                <div className="inline-flex p-1 rounded-md bg-surface-2 gap-1">
                  {(['pipeline', 'overview', 'activity'] as const).map((t) => (
                    <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1 rounded text-[12px] font-medium capitalize', tab === t ? 'bg-surface shadow-sm text-ink' : 'text-muted')}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Stage stepper */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {CASE_STAGE_ORDER.map((s, i) => {
                  const meta = CASE_STAGE_META[s];
                  const prog = stageProgress[s];
                  const pct = prog.required === 0 ? 0 : Math.round((prog.requiredDone / prog.required) * 100);
                  const isCurrent = caseData.current_stage === s;
                  const isCompleted = pct === 100;
                  return (
                    <button key={s} onClick={() => { setExpandedStage(s); setTab('pipeline'); }}
                      className={cn(
                        'flex-1 min-w-[110px] px-2.5 py-2 rounded-md border transition-all text-left',
                        isCurrent ? 'border-indigo bg-indigo-soft' : 'border-border hover:bg-surface-2'
                      )}
                      style={isCurrent ? { borderColor: '#6366F1' } : undefined}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={cn('w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center flex-shrink-0', isCompleted ? 'text-white' : 'text-muted')}
                          style={{ background: isCompleted ? meta.dot : 'hsl(var(--surface-2))' }}>
                          {isCompleted ? '✓' : i + 1}
                        </span>
                        <span className={cn('text-[10.5px] uppercase tracking-wider font-semibold truncate', isCurrent ? 'text-indigo-700' : 'text-muted')}>{meta.short}</span>
                      </div>
                      <div className="text-[10px] text-muted num">{prog.requiredDone}/{prog.required} req</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {tab === 'pipeline' && (
                <div className="space-y-2">
                  {CASE_STAGE_ORDER.map((s) => {
                    const stageItems = items.filter((i) => i.stage === s);
                    const meta = CASE_STAGE_META[s];
                    const prog = stageProgress[s];
                    const isCurrent = caseData.current_stage === s;
                    const isExpanded = expandedStage === s;
                    return (
                      <StageAccordion
                        key={s}
                        stage={s}
                        meta={meta}
                        progress={prog}
                        isCurrent={isCurrent}
                        isExpanded={isExpanded}
                        onToggle={() => setExpandedStage(isExpanded ? null : s)}
                        items={stageItems}
                        onItemToggle={toggleStatus}
                        onItemCycle={cycleStatus}
                        onItemNote={saveNote}
                        onItemDelete={async (id) => { await deleteChecklistItem(id); reload(); }}
                        onAddItem={async (input) => { await addChecklistItem(caseData.id, input); reload(); }}
                        onAdvance={isCurrent && s !== 'post_arrival' ? () => advanceStage(CASE_STAGE_ORDER[CASE_STAGE_ORDER.indexOf(s) + 1]) : undefined}
                        memberNameById={memberNameById}
                      />
                    );
                  })}
                </div>
              )}

              {tab === 'overview' && (
                <OverviewTab caseData={caseData} onUpdate={(p) => updateCase(caseData.id, p)} />
              )}

              {tab === 'activity' && (
                <ActivityLogTab activity={activityLog} memberNameById={memberNameById} />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ==========================================
// Stage accordion
// ==========================================
function StageAccordion({
  stage, meta, progress, isCurrent, isExpanded, onToggle, items, onItemToggle, onItemCycle, onItemNote, onItemDelete, onAddItem, onAdvance, memberNameById,
}: {
  stage: CaseStage;
  meta: { label: string; short: string; bg: string; fg: string; dot: string; order: number };
  progress: { total: number; done: number; required: number; requiredDone: number };
  isCurrent: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  items: CaseChecklistItem[];
  onItemToggle: (i: CaseChecklistItem) => void;
  onItemCycle: (i: CaseChecklistItem) => void;
  onItemNote: (i: CaseChecklistItem, notes: string) => void;
  onItemDelete: (id: string) => Promise<void>;
  onAddItem: (input: Partial<CaseChecklistItem>) => Promise<void>;
  onAdvance?: () => void;
  memberNameById: (id: string | null | undefined) => string;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, CaseChecklistItem[]> = {};
    items.forEach((it) => {
      const cat = it.category || 'other';
      if (!g[cat]) g[cat] = [];
      g[cat].push(it);
    });
    Object.values(g).forEach((arr) => arr.sort((a, b) => a.display_order - b.display_order));
    return g;
  }, [items]);

  const [addingCategory, setAddingCategory] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const pct = progress.required === 0 ? 0 : Math.round((progress.requiredDone / progress.required) * 100);

  return (
    <div className={cn('panel overflow-hidden', isCurrent && 'ring-2 ring-indigo-200')}>
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center gap-3 hover:bg-surface-2 transition-colors text-left">
        <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 font-bold text-[12px]" style={{ background: meta.bg, color: meta.fg }}>
          {meta.order}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold">{meta.label}</h3>
            {isCurrent && <span className="chip" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA', border: 'none', fontSize: 10 }}>Current</span>}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11.5px] text-muted">
            <div className="w-24 h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${pct}%`, background: meta.dot }} />
            </div>
            <span className="num">{progress.requiredDone}/{progress.required} required</span>
            {progress.total > progress.required && <span className="num text-faint">· {progress.done}/{progress.total} total</span>}
          </div>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-muted transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {isExpanded && (
        <div className="border-t border-border bg-surface-2/30">
          <div className="px-5 py-4 space-y-4">
            {Object.entries(grouped).map(([cat, catItems]) => (
              <div key={cat}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[10.5px] uppercase tracking-wider font-semibold text-muted">{CATEGORY_LABELS[cat] || cat}</h4>
                  <button onClick={() => setAddingCategory(cat)} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add item
                  </button>
                </div>
                <div className="space-y-1">
                  {catItems.map((it) => (
                    <ChecklistRow key={it.id} item={it} onToggle={() => onItemToggle(it)} onCycle={() => onItemCycle(it)} onNoteSave={(n) => onItemNote(it, n)} onDelete={() => onItemDelete(it.id)} memberNameById={memberNameById} />
                  ))}
                  {addingCategory === cat && (
                    <div className="flex items-center gap-2 pt-1.5">
                      <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New item title…" autoFocus
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && newTitle.trim()) {
                            await onAddItem({ stage, category: cat, title: newTitle.trim(), is_required: false });
                            setNewTitle(''); setAddingCategory(null);
                          } else if (e.key === 'Escape') { setNewTitle(''); setAddingCategory(null); }
                        }}
                        className="input flex-1 py-1.5 text-[12.5px]" />
                      <button onClick={async () => {
                        if (newTitle.trim()) { await onAddItem({ stage, category: cat, title: newTitle.trim(), is_required: false }); setNewTitle(''); setAddingCategory(null); }
                      }} className="btn btn-primary btn-sm">Add</button>
                      <button onClick={() => { setNewTitle(''); setAddingCategory(null); }} className="btn btn-ghost btn-sm">Cancel</button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {onAdvance && pct === 100 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 flex items-center justify-between gap-3 mt-3" style={{ background: '#ECFDF5', borderColor: '#A7F3D0' }}>
                <div className="text-[12.5px]" style={{ color: '#065F46' }}>
                  All required items complete — ready to move to the next stage?
                </div>
                <button onClick={onAdvance} className="btn btn-primary btn-sm">Advance →</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// Checklist row
// ==========================================
function ChecklistRow({ item, onToggle, onCycle, onNoteSave, onDelete, memberNameById }: {
  item: CaseChecklistItem;
  onToggle: () => void;
  onCycle: () => void;
  onNoteSave: (notes: string) => void;
  onDelete: () => void;
  memberNameById: (id: string | null | undefined) => string;
}) {
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState(item.notes || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setNoteText(item.notes || ''); setDirty(false); }, [item.notes]);

  const saveIfDirty = () => { if (dirty) { onNoteSave(noteText); setDirty(false); } };

  const StatusIcon = item.status === 'completed' ? CheckCircle2
    : item.status === 'in_progress' ? Clock
    : item.status === 'not_applicable' ? Ban
    : Circle;
  const iconColor = item.status === 'completed' ? '#10B981'
    : item.status === 'in_progress' ? '#F59E0B'
    : item.status === 'not_applicable' ? '#9CA3AF'
    : '#9CA3AF';

  return (
    <div className={cn('rounded-md transition-colors px-2 py-2 group', item.status === 'completed' && 'opacity-70')}>
      <div className="flex items-start gap-2">
        <button onClick={onToggle} className="flex-shrink-0 mt-0.5" title="Toggle complete">
          <StatusIcon className="w-4 h-4" style={{ color: iconColor }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className={cn('text-[12.5px] leading-snug', item.status === 'completed' && 'line-through text-muted')}>
            {item.title}
            {item.is_required && <span className="ml-1.5 text-[10px] text-rose-500" title="Required">•</span>}
          </div>
          {item.description && <div className="text-[11px] text-muted mt-0.5">{item.description}</div>}
          {item.completed_at && (
            <div className="text-[10.5px] text-faint mt-0.5">
              Completed by {memberNameById(item.completed_by)} · {timeAgo(item.completed_at)}
            </div>
          )}
          {showNote && (
            <div className="mt-2">
              <textarea value={noteText} onChange={(e) => { setNoteText(e.target.value); setDirty(true); }} onBlur={saveIfDirty}
                rows={2} placeholder="Add a note (auto-saves when you click away)…" className="input text-[12px] py-2 resize-none" />
            </div>
          )}
          {!showNote && item.notes && (
            <button onClick={() => setShowNote(true)} className="text-[11px] text-muted hover:text-ink mt-1 text-left">
              <FileText className="w-3 h-3 inline mr-1" />Note: <span className="italic">{item.notes.length > 80 ? item.notes.slice(0, 80) + '…' : item.notes}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={onCycle} className="text-[10px] px-2 py-1 rounded hover:bg-surface text-muted hover:text-ink" title="Cycle status">
            {item.status === 'pending' ? 'Pending' : item.status === 'in_progress' ? 'In progress' : item.status === 'completed' ? 'Done' : 'N/A'}
          </button>
          {!showNote && (
            <button onClick={() => setShowNote(true)} className="p-1 rounded hover:bg-surface text-muted hover:text-ink" title="Add note">
              <Pencil className="w-3 h-3" />
            </button>
          )}
          <button onClick={onDelete} className="p-1 rounded hover:bg-rose-50 text-muted hover:text-danger" title="Delete item">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Overview tab — case-level info
// ==========================================
function OverviewTab({ caseData, onUpdate }: { caseData: Case; onUpdate: (p: Partial<Case>) => Promise<void> }) {
  return (
    <div className="space-y-3 max-w-[700px]">
      <div className="panel panel-pad">
        <h3 className="text-[14px] font-semibold mb-3">Application status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="input-label">Endorsement status</label>
            <select className="input" value={caseData.endorsement_status} onChange={(e) => onUpdate({
              endorsement_status: e.target.value as Case['endorsement_status'],
              endorsement_approved_at: e.target.value === 'approved' ? new Date().toISOString() : caseData.endorsement_approved_at,
            })}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </div>
          <div>
            <label className="input-label">Visa decision</label>
            <select className="input" value={caseData.visa_status} onChange={(e) => onUpdate({
              visa_status: e.target.value as Case['visa_status'],
              visa_approved_at: e.target.value === 'approved' ? new Date().toISOString() : caseData.visa_approved_at,
            })}>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="not_applicable">Not applicable</option>
            </select>
          </div>
        </div>
      </div>

      <div className="panel panel-pad">
        <h3 className="text-[14px] font-semibold mb-3">Key dates</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <DateRow label="Case started"          value={caseData.started_at} />
          <DateRow label="Endorsement submitted" value={caseData.endorsement_submitted_at} />
          <DateRow label="Endorsement approved"  value={caseData.endorsement_approved_at} />
          <DateRow label="Visa submitted"        value={caseData.visa_submitted_at} />
          <DateRow label="Visa approved"         value={caseData.visa_approved_at} />
          <DateRow label="Arrived in UK"         value={caseData.arrived_at} />
        </div>
      </div>
    </div>
  );
}

function DateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[11px] text-muted mb-0.5">{label}</div>
      <div className="text-[13px] font-medium">{value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : <span className="text-faint">—</span>}</div>
    </div>
  );
}

// ==========================================
// Activity log
// ==========================================
function ActivityLogTab({ activity, memberNameById }: { activity: CaseActivity[]; memberNameById: (id: string | null | undefined) => string }) {
  if (activity.length === 0) return <div className="py-10 text-center text-[12.5px] text-muted">No activity yet</div>;
  return (
    <div className="max-w-[700px]">
      {activity.map((a) => {
        const actor = memberNameById(a.user_id);
        const label = (() => {
          if (a.action === 'case_created')   return <><b>{actor}</b> opened this case</>;
          if (a.action === 'stage_changed')  return <><b>{actor}</b> moved to <b>{CASE_STAGE_META[(a.meta as { to: CaseStage }).to]?.label || (a.meta as { to: string }).to}</b></>;
          if (a.action === 'status_changed') return <><b>{actor}</b> changed status to <b>{(a.meta as { to: string }).to}</b></>;
          if (a.action === 'item_completed') return <><b>{actor}</b> completed <b>{(a.meta as { title: string }).title}</b></>;
          if (a.action === 'item_added')     return <><b>{actor}</b> added <b>{(a.meta as { title: string }).title}</b></>;
          return <><b>{actor}</b> · {a.action}</>;
        })();
        return (
          <div key={a.id} className="flex gap-3 py-3 border-b border-border last:border-0">
            <div className="w-7 h-7 rounded-md bg-indigo-soft flex items-center justify-center flex-shrink-0">
              <Briefcase className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] leading-snug">{label}</div>
              <div className="text-[11px] text-muted mt-0.5">
                {timeAgo(a.created_at)} · {new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// Status dropdown
// ==========================================
function StatusDropdown({ caseData, onChange }: { caseData: Case; onChange: (s: CaseStatus) => void }) {
  const [open, setOpen] = useState(false);
  const meta = CASE_STATUS_META[caseData.status];
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="chip cursor-pointer" style={{ background: meta.bg, color: meta.fg, border: 'none' }}>
        {meta.label} <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 bg-surface border border-border rounded-md shadow-lg p-1 z-50 min-w-[140px]">
            {(['active', 'on_hold', 'completed', 'rejected'] as const).map((s) => {
              const m = CASE_STATUS_META[s];
              return (
                <button key={s} onClick={() => { onChange(s); setOpen(false); }} className="w-full text-left px-2.5 py-1.5 text-[12.5px] rounded hover:bg-surface-2 flex items-center gap-2">
                  <span className="chip-dot" style={{ background: m.fg }} />{m.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
