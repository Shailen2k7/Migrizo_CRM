'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown, Plus, Trash2, CheckCircle2, Circle, Clock, Ban, FileText, Phone, Mail, Pencil, Briefcase, Save, Undo2 } from 'lucide-react';
import { useApp } from '@/components/shared/app-provider';
import type { Case, CaseStage, CaseChecklistItem, CaseActivity, CaseStatus, ChecklistStatus, EndorsementStatus } from '@/lib/types';
import { CASE_STAGE_META, CASE_STAGE_ORDER, CASE_STATUS_META, CATEGORY_LABELS } from '@/lib/types';
import { Select } from '@/components/shared/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { initials, avatarColor, timeAgo, cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  caseId: string | null;
  onClose: () => void;
}

export function CaseDrawer({ caseId, onClose }: Props) {
  const { cases, updateCase, deleteCase, getChecklist, updateChecklistItem, addChecklistItem, deleteChecklistItem, getCaseActivity, role, memberNameById } = useApp();
  const caseData = caseId ? cases.find((c) => c.id === caseId) : null;

  const [items, setItems] = useState<CaseChecklistItem[]>([]);
  const [activityLog, setActivityLog] = useState<CaseActivity[]>([]);
  const [pendingItems, setPendingItems] = useState<Record<string, Partial<CaseChecklistItem>>>({});
  const [pendingCase, setPendingCase] = useState<Partial<Case>>({});

  const [expandedStage, setExpandedStage] = useState<CaseStage | null>(null);
  const [tab, setTab] = useState<'pipeline' | 'overview' | 'activity'>('pipeline');
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'case' | 'item'; id: string; label: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);

  const effectiveItems = useMemo(
    () => items.map((i) => ({ ...i, ...pendingItems[i.id] })),
    [items, pendingItems]
  );
  const effectiveCase = useMemo(
    () => (caseData ? { ...caseData, ...pendingCase } : null),
    [caseData, pendingCase]
  );

  const pendingCount = Object.keys(pendingItems).length + Object.keys(pendingCase).length;
  const isDirty = pendingCount > 0;

  const reload = useCallback(async () => {
    if (!caseId) return;
    const [list, log] = await Promise.all([getChecklist(caseId), getCaseActivity(caseId)]);
    setItems(list);
    setActivityLog(log);
  }, [caseId, getChecklist, getCaseActivity]);

  useEffect(() => {
    if (!caseId) { setItems([]); setActivityLog([]); setPendingItems({}); setPendingCase({}); return; }
    reload();
  }, [caseId, reload]);

  useEffect(() => {
    if (effectiveCase && !expandedStage) setExpandedStage(effectiveCase.current_stage);
  }, [effectiveCase, expandedStage]);

  const stageProgress = useMemo(() => {
    const map: Record<CaseStage, { total: number; done: number; required: number; requiredDone: number }> = {
      roadmap_building: { total: 0, done: 0, required: 0, requiredDone: 0 },
      profile_building: { total: 0, done: 0, required: 0, requiredDone: 0 },
      final_mapping: { total: 0, done: 0, required: 0, requiredDone: 0 },
      endorsement_submission: { total: 0, done: 0, required: 0, requiredDone: 0 },
      visa_application: { total: 0, done: 0, required: 0, requiredDone: 0 },
      post_arrival: { total: 0, done: 0, required: 0, requiredDone: 0 },
    };
    effectiveItems.forEach((it) => {
      if (it.status === 'not_applicable') return;
      map[it.stage].total++;
      if (it.is_required) map[it.stage].required++;
      if (it.status === 'completed') {
        map[it.stage].done++;
        if (it.is_required) map[it.stage].requiredDone++;
      }
    });
    return map;
  }, [effectiveItems]);

  const overallProgress = useMemo(() => {
    const totals = Object.values(stageProgress).reduce(
      (a, b) => ({ total: a.total + b.required, done: a.done + b.requiredDone }),
      { total: 0, done: 0 }
    );
    return totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100);
  }, [stageProgress]);

  // Derive current_stage purely from item completion state.
  // Returns the FIRST stage that has incomplete required items, or the last stage if all complete.
  // This is BIDIRECTIONAL — works forward when items are completed AND backward when items get unchecked.
  const deriveCurrentStage = useCallback((sourceItems: CaseChecklistItem[]): CaseStage => {
    for (const stage of CASE_STAGE_ORDER) {
      const requiredInStage = sourceItems.filter(
        (i) => i.stage === stage && i.is_required && i.status !== 'not_applicable'
      );
      const completedInStage = requiredInStage.filter((i) => i.status === 'completed');
      // If there are required items remaining, this is the current stage
      if (requiredInStage.length > 0 && completedInStage.length < requiredInStage.length) {
        return stage;
      }
      // Otherwise stage is fully complete (or empty of required items) — keep walking forward
    }
    // Every stage is complete — case is at the final stage
    return CASE_STAGE_ORDER[CASE_STAGE_ORDER.length - 1];
  }, []);

  // Keep current_stage synced with the actual checklist state.
  // Runs whenever items change (load, save, add, delete) and the user isn't editing.
  // The check `target === caseData.current_stage` prevents infinite loops on success.
  // The throttle prevents infinite loops on DB update failure.
  const lastSyncAttempt = useRef<{ caseId: string; target: CaseStage; time: number } | null>(null);
  useEffect(() => {
    if (!caseId || !caseData || items.length === 0) return;
    if (isDirty) return;

    const target = deriveCurrentStage(items);
    if (target === caseData.current_stage) return;

    // Throttle: don't retry the same sync target within 3 seconds
    const now = Date.now();
    const last = lastSyncAttempt.current;
    if (last && last.caseId === caseId && last.target === target && (now - last.time) < 3000) return;
    lastSyncAttempt.current = { caseId, target, time: now };

    updateCase(caseData.id, { current_stage: target });
    setExpandedStage(target);
  }, [caseId, caseData, items, isDirty, deriveCurrentStage, updateCase]);

  const setItemPending = (itemId: string, patch: Partial<CaseChecklistItem>) => {
    setPendingItems((prev) => {
      const original = items.find((i) => i.id === itemId);
      const nextPatch = { ...prev[itemId], ...patch };
      if (original) {
        const sameStatus = nextPatch.status === undefined || nextPatch.status === original.status;
        const sameNotes = nextPatch.notes === undefined || nextPatch.notes === (original.notes || '');
        if (sameStatus && sameNotes) {
          const { [itemId]: _omitted, ...rest } = prev;
          return rest;
        }
      }
      return { ...prev, [itemId]: nextPatch };
    });
  };

  const setCasePending = (patch: Partial<Case>) => {
    setPendingCase((prev) => {
      const next: Partial<Case> = { ...prev, ...patch };
      if (caseData) {
        (Object.keys(next) as (keyof Case)[]).forEach((k) => {
          if (next[k] === caseData[k]) delete next[k];
        });
      }
      return next;
    });
  };

  const toggleItem = (item: CaseChecklistItem) => {
    const current = effectiveItems.find((i) => i.id === item.id)!;
    const newStatus: ChecklistStatus = current.status === 'completed' ? 'pending' : 'completed';
    setItemPending(item.id, { status: newStatus });
  };

  const cycleItem = (item: CaseChecklistItem) => {
    const order: ChecklistStatus[] = ['pending', 'in_progress', 'completed', 'not_applicable'];
    const current = effectiveItems.find((i) => i.id === item.id)!;
    const next = order[(order.indexOf(current.status) + 1) % order.length];
    setItemPending(item.id, { status: next });
  };

  const setItemNote = (itemId: string, notes: string) => {
    setItemPending(itemId, { notes });
  };

  const discardChanges = () => {
    setPendingItems({});
    setPendingCase({});
    toast.info('Changes discarded');
  };

  const saveChanges = async () => {
    if (!effectiveCase || !isDirty) return;
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(pendingItems).map(([id, patch]) => updateChecklistItem(id, patch))
      );

      const caseUpdates: Partial<Case> = { ...pendingCase };
      const beforeStage = effectiveCase.current_stage;

      // Re-derive current_stage from the EFFECTIVE items (which include pending changes).
      // This handles both advances (when completing items) and rewinds (when unchecking).
      if (!pendingCase.current_stage) {
        const target = deriveCurrentStage(effectiveItems);
        if (target !== beforeStage) {
          caseUpdates.current_stage = target;
        }
      }

      if (Object.keys(caseUpdates).length > 0) {
        await updateCase(effectiveCase.id, caseUpdates);
      }

      setPendingItems({});
      setPendingCase({});
      await reload();

      if (caseUpdates.current_stage && caseUpdates.current_stage !== beforeStage) {
        const fromIdx = CASE_STAGE_ORDER.indexOf(beforeStage);
        const toIdx = CASE_STAGE_ORDER.indexOf(caseUpdates.current_stage);
        const verb = toIdx > fromIdx ? 'advanced' : 'moved back';
        toast.success(`Saved · ${verb} to ${CASE_STAGE_META[caseUpdates.current_stage].label}`);
        setExpandedStage(caseUpdates.current_stage);
      } else {
        toast.success(`Saved ${pendingCount} change${pendingCount === 1 ? '' : 's'}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === 'case' && effectiveCase) {
      await deleteCase(effectiveCase.id);
      setConfirmDelete(null);
      onClose();
    } else if (confirmDelete.kind === 'item') {
      await deleteChecklistItem(confirmDelete.id);
      setConfirmDelete(null);
      reload();
    }
  };

  return (
    <>
      <AnimatePresence>
        {caseId && effectiveCase && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/30 z-40" onClick={handleClose} />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-[920px] bg-surface z-50 flex flex-col shadow-2xl"
            >
              <div className="px-6 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="av" style={{ background: avatarColor(effectiveCase.id), width: 44, height: 44, fontSize: 16 }}>{initials(effectiveCase.client_name)}</div>
                  <div className="min-w-0">
                    <h2 className="text-[18px] font-bold tracking-tight truncate">{effectiveCase.client_name}</h2>
                    <div className="flex items-center gap-2 text-[11.5px] text-muted mt-0.5 flex-wrap">
                      <span>{effectiveCase.visa_type}</span>
                      {effectiveCase.client_email && <><span>·</span><a href={`mailto:${effectiveCase.client_email}`} className="hover:text-indigo-600 inline-flex items-center gap-1"><Mail className="w-3 h-3" />{effectiveCase.client_email}</a></>}
                      {effectiveCase.client_phone && <><span>·</span><a href={`tel:${effectiveCase.client_phone}`} className="hover:text-indigo-600 inline-flex items-center gap-1"><Phone className="w-3 h-3" />{effectiveCase.client_phone}</a></>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div style={{ minWidth: 130 }}>
                    <Select<CaseStatus>
                      value={effectiveCase.status}
                      onChange={(s) => setCasePending({ status: s })}
                      options={(Object.keys(CASE_STATUS_META) as CaseStatus[]).map((k) => ({ value: k, label: CASE_STATUS_META[k].label, color: CASE_STATUS_META[k].fg }))}
                      size="sm"
                    />
                  </div>
                  {role === 'admin' && (
                    <button onClick={() => setConfirmDelete({ kind: 'case', id: effectiveCase.id, label: effectiveCase.client_name })}
                      className="p-2 rounded hover:bg-rose-50 text-muted hover:text-danger" title="Delete case">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={handleClose} className="p-2 rounded hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
                </div>
              </div>

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
                    <div className="text-[11px] text-muted">Started {timeAgo(effectiveCase.started_at)}</div>
                  </div>
                  <div className="inline-flex p-1 rounded-md bg-surface-2 gap-1">
                    {(['pipeline', 'overview', 'activity'] as const).map((t) => (
                      <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1 rounded text-[12px] font-medium capitalize', tab === t ? 'bg-surface shadow-sm text-ink' : 'text-muted')}>{t}</button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                  {CASE_STAGE_ORDER.map((s, i) => {
                    const meta = CASE_STAGE_META[s];
                    const prog = stageProgress[s];
                    const pct = prog.required === 0 ? 0 : Math.round((prog.requiredDone / prog.required) * 100);
                    const isCurrent = effectiveCase.current_stage === s;
                    const isCompleted = pct === 100 && prog.required > 0;
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

              <div className="flex-1 overflow-y-auto p-6">
                {tab === 'pipeline' && (
                  <div className="space-y-2">
                    {CASE_STAGE_ORDER.map((s) => {
                      const stageItems = effectiveItems.filter((i) => i.stage === s);
                      const meta = CASE_STAGE_META[s];
                      const prog = stageProgress[s];
                      const isCurrent = effectiveCase.current_stage === s;
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
                          onItemToggle={toggleItem}
                          onItemCycle={cycleItem}
                          onItemNote={(item, n) => setItemNote(item.id, n)}
                          onItemDelete={(item) => setConfirmDelete({ kind: 'item', id: item.id, label: item.title })}
                          onAddItem={async (input) => { await addChecklistItem(effectiveCase.id, input); reload(); }}
                          memberNameById={memberNameById}
                          pendingItems={pendingItems}
                        />
                      );
                    })}
                  </div>
                )}

                {tab === 'overview' && (
                  <OverviewTab effectiveCase={effectiveCase} onChange={setCasePending} />
                )}

                {tab === 'activity' && (
                  <ActivityLogTab activity={activityLog} memberNameById={memberNameById} />
                )}

                {isDirty && <div className="h-20" />}
              </div>

              <AnimatePresence>
                {isDirty && (
                  <motion.div
                    initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="absolute left-0 right-0 bottom-0 border-t border-border bg-surface flex items-center justify-between px-6 py-3 shadow-[0_-8px_16px_-8px_rgba(0,0,0,0.08)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      <span className="text-[13px] text-ink-2">
                        <strong className="text-ink">{pendingCount}</strong> unsaved change{pendingCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={discardChanges} disabled={saving} className="btn btn-ghost btn-sm disabled:opacity-50">
                        <Undo2 className="w-3.5 h-3.5" /> Discard
                      </button>
                      <button onClick={saveChanges} disabled={saving} className="btn btn-primary btn-sm disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        title={confirmDelete?.kind === 'case' ? 'Delete this case?' : 'Delete this item?'}
        description={confirmDelete?.kind === 'case'
          ? `This permanently deletes the case for ${confirmDelete?.label} and all its checklist items and activity. This cannot be undone.`
          : `Remove "${confirmDelete?.label}" from this checklist? This cannot be undone.`}
        confirmLabel={confirmDelete?.kind === 'case' ? 'Delete case' : 'Delete item'}
        variant="danger"
      />
      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() => { setConfirmClose(false); discardChanges(); onClose(); }}
        title="Discard unsaved changes?"
        description={`You have ${pendingCount} unsaved change${pendingCount === 1 ? '' : 's'}. Closing now will lose them.`}
        confirmLabel="Discard & close"
        cancelLabel="Keep editing"
        variant="warning"
      />
    </>
  );
}

function StageAccordion({
  stage, meta, progress, isCurrent, isExpanded, onToggle, items, onItemToggle, onItemCycle, onItemNote, onItemDelete, onAddItem, memberNameById, pendingItems,
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
  onItemDelete: (i: CaseChecklistItem) => void;
  onAddItem: (input: Partial<CaseChecklistItem>) => Promise<void>;
  memberNameById: (id: string | null | undefined) => string;
  pendingItems: Record<string, Partial<CaseChecklistItem>>;
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
                    <ChecklistRow key={it.id}
                      item={it}
                      isPending={!!pendingItems[it.id]}
                      onToggle={() => onItemToggle(it)}
                      onCycle={() => onItemCycle(it)}
                      onNoteSave={(n) => onItemNote(it, n)}
                      onDelete={() => onItemDelete(it)}
                      memberNameById={memberNameById}
                    />
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

            {isCurrent && pct === 100 && progress.required > 0 && (
              <div className="rounded-md border p-3 flex items-center gap-2 mt-3" style={{ background: '#ECFDF5', borderColor: '#A7F3D0', color: '#065F46' }}>
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <div className="text-[12.5px]">All required items complete — click <strong>Save changes</strong> to advance to the next stage.</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item, isPending, onToggle, onCycle, onNoteSave, onDelete, memberNameById }: {
  item: CaseChecklistItem;
  isPending: boolean;
  onToggle: () => void;
  onCycle: () => void;
  onNoteSave: (notes: string) => void;
  onDelete: () => void;
  memberNameById: (id: string | null | undefined) => string;
}) {
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState(item.notes || '');

  useEffect(() => { setNoteText(item.notes || ''); }, [item.notes]);

  const StatusIcon = item.status === 'completed' ? CheckCircle2
    : item.status === 'in_progress' ? Clock
    : item.status === 'not_applicable' ? Ban
    : Circle;
  const iconColor = item.status === 'completed' ? '#10B981'
    : item.status === 'in_progress' ? '#F59E0B'
    : item.status === 'not_applicable' ? '#9CA3AF'
    : '#9CA3AF';

  return (
    <div className={cn(
      'rounded-md transition-colors px-2 py-2 group',
      item.status === 'completed' && 'opacity-70',
      isPending && 'bg-amber-50/60'
    )}>
      <div className="flex items-start gap-2">
        <button onClick={onToggle} className="flex-shrink-0 mt-0.5" title="Toggle complete">
          <StatusIcon className="w-4 h-4" style={{ color: iconColor }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn('text-[12.5px] leading-snug', item.status === 'completed' && 'line-through text-muted')}>
              {item.title}
              {item.is_required && <span className="ml-1.5 text-[10px] text-rose-500" title="Required">•</span>}
            </div>
            {isPending && <span className="chip" style={{ background: '#FEF3C7', color: '#B45309', border: 'none', fontSize: 9, padding: '1px 5px' }}>Unsaved</span>}
          </div>
          {item.description && <div className="text-[11px] text-muted mt-0.5">{item.description}</div>}
          {item.completed_at && !isPending && (
            <div className="text-[10.5px] text-faint mt-0.5">
              Completed by {memberNameById(item.completed_by)} · {timeAgo(item.completed_at)}
            </div>
          )}
          {showNote ? (
            <div className="mt-2">
              <textarea
                value={noteText}
                onChange={(e) => { setNoteText(e.target.value); onNoteSave(e.target.value); }}
                rows={2} placeholder="Add a note…" className="input text-[12px] py-2 resize-none" autoFocus
              />
              <button onClick={() => setShowNote(false)} className="text-[11px] text-muted hover:text-ink mt-1">Close note editor</button>
            </div>
          ) : item.notes && (
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
            <button onClick={() => setShowNote(true)} className="p-1 rounded hover:bg-surface text-muted hover:text-ink" title="Add / edit note">
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

function OverviewTab({ effectiveCase, onChange }: { effectiveCase: Case; onChange: (p: Partial<Case>) => void }) {
  const statusOptions = [
    { value: 'pending' as EndorsementStatus,        label: 'Pending',        color: '#9CA3AF' },
    { value: 'approved' as EndorsementStatus,       label: 'Approved',       color: '#10B981' },
    { value: 'rejected' as EndorsementStatus,       label: 'Rejected',       color: '#EF4444' },
    { value: 'not_applicable' as EndorsementStatus, label: 'Not applicable', color: '#9CA3AF' },
  ];

  return (
    <div className="space-y-3 max-w-[700px]">
      <div className="panel panel-pad">
        <h3 className="text-[14px] font-semibold mb-3">Application status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="input-label">Endorsement status</label>
            <Select<EndorsementStatus>
              value={effectiveCase.endorsement_status}
              onChange={(s) => onChange({
                endorsement_status: s,
                endorsement_approved_at: s === 'approved' && !effectiveCase.endorsement_approved_at ? new Date().toISOString() : effectiveCase.endorsement_approved_at,
              })}
              options={statusOptions}
            />
          </div>
          <div>
            <label className="input-label">Visa decision</label>
            <Select<EndorsementStatus>
              value={effectiveCase.visa_status}
              onChange={(s) => onChange({
                visa_status: s,
                visa_approved_at: s === 'approved' && !effectiveCase.visa_approved_at ? new Date().toISOString() : effectiveCase.visa_approved_at,
              })}
              options={statusOptions}
            />
          </div>
        </div>
      </div>

      <div className="panel panel-pad">
        <h3 className="text-[14px] font-semibold mb-3">Key dates</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <DateRow label="Case started"          value={effectiveCase.started_at} />
          <DateRow label="Endorsement submitted" value={effectiveCase.endorsement_submitted_at} />
          <DateRow label="Endorsement approved"  value={effectiveCase.endorsement_approved_at} />
          <DateRow label="Visa submitted"        value={effectiveCase.visa_submitted_at} />
          <DateRow label="Visa approved"         value={effectiveCase.visa_approved_at} />
          <DateRow label="Arrived in UK"         value={effectiveCase.arrived_at} />
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
