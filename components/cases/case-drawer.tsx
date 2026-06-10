'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Check, Lock, ChevronDown, Trash2, Plus, Link2, Flag,
  CircleCheck, Sparkles, Trophy, Megaphone, Lightbulb, LineChart,
  PartyPopper, Archive, RotateCcw, Copy, ExternalLink, Mail, Send,
} from 'lucide-react';
import { useApp } from '@/components/shared/app-provider';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { cn, initials, avatarColor } from '@/lib/utils';
import {
  JOURNEY, DECISION_META, normalizeJourney, phaseProgress, isPhaseComplete,
  isGatePassed, isPhaseUnlocked, activePhase, overallProgress, phasesCleared,
  allGatesPassed, clientPortalUrl,
  type JourneyPhase, type CaseJourneyState, type Decision,
} from '@/lib/journey';
import type { Case } from '@/lib/types';

interface Props {
  caseId: string | null;
  onClose: () => void;
}

const PILLAR_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  recognition: Trophy,
  influence: Megaphone,
  innovation: Lightbulb,
  track_record: LineChart,
};

export function CaseDrawer({ caseId, onClose }: Props) {
  const { cases, updateCase, updateCaseJourney, sendClientUpdate, deleteCase, role, user } = useApp();
  const caseData = caseId ? cases.find((c) => c.id === caseId) || null : null;

  const journey: CaseJourneyState = useMemo(() => normalizeJourney(caseData?.journey), [caseData?.journey]);
  const active = useMemo(() => activePhase(journey), [journey]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const effectiveExpanded = expanded ?? active.key;
  const progress = overallProgress(journey);
  const cleared = phasesCleared(journey);
  const journeyDone = allGatesPassed(journey);
  const archived = !!caseData?.archived_at;
  const [copied, setCopied] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [sending, setSending] = useState(false);
  const [emailVal, setEmailVal] = useState('');
  useEffect(() => { setEmailVal(caseData?.client_email || ''); }, [caseData?.id, caseData?.client_email]);

  if (!caseData) return null;

  const setArchived = (on: boolean) => {
    updateCase(caseData.id, { archived_at: on ? new Date().toISOString() : null });
  };

  const copyPortal = async () => {
    const url = clientPortalUrl(caseData.client_token);
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* noop */ }
  };

  const sendUpdate = async () => {
    setSending(true);
    const ok = await sendClientUpdate(caseData.id, noteText.trim() || undefined);
    setSending(false);
    if (ok) { setNoteText(''); setNoteOpen(false); }
  };

  const toggleTask = (taskKey: string) => {
    const cur = journey.tasks[taskKey]?.done;
    const next: CaseJourneyState = {
      ...journey,
      tasks: { ...journey.tasks, [taskKey]: cur ? { done: false } : { done: true, at: new Date().toISOString(), by: user.id } },
    };
    updateCaseJourney(caseData.id, next);
  };

  const togglePillarDone = (pillarKey: string) => {
    const p = journey.pillars[pillarKey] || { done: false, evidence: [] };
    const next: CaseJourneyState = { ...journey, pillars: { ...journey.pillars, [pillarKey]: { ...p, done: !p.done } } };
    updateCaseJourney(caseData.id, next);
  };

  const addEvidence = (pillarKey: string, title: string, link: string) => {
    const t = title.trim();
    if (!t) return;
    const p = journey.pillars[pillarKey] || { done: false, evidence: [] };
    const evidence = [...(p.evidence || []), { title: t, link: link.trim() || undefined }];
    const next: CaseJourneyState = { ...journey, pillars: { ...journey.pillars, [pillarKey]: { ...p, evidence } } };
    updateCaseJourney(caseData.id, next);
  };

  const removeEvidence = (pillarKey: string, idx: number) => {
    const p = journey.pillars[pillarKey] || { done: false, evidence: [] };
    const evidence = (p.evidence || []).filter((_, i) => i !== idx);
    const next: CaseJourneyState = { ...journey, pillars: { ...journey.pillars, [pillarKey]: { ...p, evidence } } };
    updateCaseJourney(caseData.id, next);
  };

  const passGate = (phase: JourneyPhase) => {
    const passed = isGatePassed(journey, phase.key);
    const nextGates = { ...journey.gates, [phase.key]: passed ? { passed: false } : { passed: true, at: new Date().toISOString() } };
    const next: CaseJourneyState = { ...journey, gates: nextGates };
    let cp = JOURNEY[JOURNEY.length - 1].key;
    for (const p of JOURNEY) { if (!nextGates[p.key]?.passed) { cp = p.key; break; } }
    updateCaseJourney(caseData.id, next, { current_phase: cp });
    if (!passed) {
      const nextPhase = JOURNEY[phase.index];
      if (nextPhase) setExpanded(nextPhase.key);
    }
  };

  return (
    <AnimatePresence>
      {caseId && (
        <>
          <motion.div className="fixed inset-0 z-[60]" style={{ background: 'rgba(15,17,21,0.25)', backdropFilter: 'blur(3px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside className="fixed top-0 right-0 bottom-0 w-[min(680px,94vw)] bg-surface border-l border-border z-[70] flex flex-col"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>

            <div className="px-6 pt-5 pb-4 border-b border-border">
              <div className="flex items-start gap-3">
                <div className="av" style={{ background: avatarColor(caseData.id), width: 40, height: 40, fontSize: 14 }}>{initials(caseData.client_name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-[16px] font-semibold leading-tight truncate">{caseData.client_name}</div>
                    <StatusPill archived={archived} journeyDone={journeyDone} decision={caseData.decision} />
                  </div>
                  <div className="text-[12px] text-muted mt-0.5 truncate">
                    {caseData.visa_type || 'UK Global Talent'}{caseData.owner_name ? ` · Owner: ${caseData.owner_name}` : ''}
                  </div>
                </div>
                {archived
                  ? <button onClick={() => setArchived(false)} title="Reopen case" className="p-2 rounded hover:bg-surface-2 text-muted hover:text-ink"><RotateCcw className="w-4 h-4" /></button>
                  : <button onClick={() => setArchived(true)} title="Close case" className="p-2 rounded hover:bg-surface-2 text-muted hover:text-ink"><Archive className="w-4 h-4" /></button>}
                {role === 'admin' && (
                  <button onClick={() => setConfirmDelete(true)} title="Delete case" className="p-2 rounded hover:bg-rose-50 text-muted hover:text-danger"><Trash2 className="w-4 h-4" /></button>
                )}
                <button onClick={onClose} className="p-2 rounded hover:bg-surface-2 text-muted"><X className="w-4 h-4" /></button>
              </div>

              <div className="mt-4 flex items-center gap-4">
                <ProgressRing pct={progress.pct} accent={active.accent} />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <div className="text-[13px] font-semibold">
                      {cleared >= 6 ? 'All phases cleared' : <>Phase {active.index} of 6 · <span style={{ color: active.accent }}>{active.code}</span></>}
                    </div>
                    <div className="text-[11.5px] text-muted num">{progress.done}/{progress.total} done</div>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: active.accent }}
                      initial={false} animate={{ width: `${progress.pct}%` }} transition={{ duration: 0.4 }} />
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    {JOURNEY.map((p) => {
                      const done = isGatePassed(journey, p.key);
                      const isActive = p.key === active.key && cleared < 6;
                      return (
                        <div key={p.key} className="flex-1 h-1 rounded-full transition-colors"
                          style={{ background: done ? p.accent : isActive ? `${p.accent}66` : 'hsl(var(--surface-2))' }} title={p.code} />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
              {archived && (
                <div className="rounded-[14px] px-4 py-3 flex items-center gap-3" style={{ background: 'hsl(var(--surface-2))', border: '1px solid hsl(var(--border))' }}>
                  <Archive className="w-4 h-4 text-muted flex-shrink-0" />
                  <div className="flex-1 text-[12.5px] text-ink-2">This case is <span className="font-semibold">closed</span> and hidden from the main list.</div>
                  <button onClick={() => setArchived(false)} className="text-[12px] font-medium text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Reopen</button>
                </div>
              )}

              {journeyDone && !archived && (
                <div className="rounded-[16px] p-4 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #ECFDF5 0%, #EFF6FF 100%)', border: '1px solid #BBF7D0' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#10B981' }}><PartyPopper className="w-5 h-5 text-white" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-emerald-900">Journey complete</div>
                      <div className="text-[12px] text-emerald-700">All six gates cleared. Close the case to move it out of your active list.</div>
                    </div>
                    <button onClick={() => setArchived(true)} className="btn btn-sm flex-shrink-0 text-white" style={{ background: '#10B981' }}><Archive className="w-3.5 h-3.5" /> Close case</button>
                  </div>
                </div>
              )}

              {JOURNEY.map((phase) => (
                <PhaseCard
                  key={phase.key}
                  phase={phase}
                  journey={journey}
                  expanded={effectiveExpanded === phase.key}
                  onToggleExpand={() => setExpanded(effectiveExpanded === phase.key ? null : phase.key)}
                  onToggleTask={toggleTask}
                  onTogglePillarDone={togglePillarDone}
                  onAddEvidence={addEvidence}
                  onRemoveEvidence={removeEvidence}
                  onPassGate={() => passGate(phase)}
                  caseData={caseData}
                  onUpdateCase={(patch) => updateCase(caseData.id, patch)}
                />
              ))}

              {/* Client portal link — what the customer will see live on the Migrizo site */}
              <div className="rounded-[14px] border border-border p-4 mt-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="text-[11px] font-bold tracking-wide text-ink-2">CLIENT TRACKING LINK</span>
                </div>
                <p className="text-[11.5px] text-muted mb-2.5 leading-relaxed">Share this private link with {caseData.client_name.split(' ')[0]}. The customer dashboard (coming next) reads this exact journey live — no extra setup needed.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[11px] bg-surface-2 rounded-md px-2.5 py-2 text-ink-2 truncate">{clientPortalUrl(caseData.client_token) || 'Save the case to generate a link'}</code>
                  <button onClick={copyPortal} disabled={!caseData.client_token} className="btn btn-outline btn-sm flex-shrink-0 disabled:opacity-40">
                    {copied ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
              </div>

              {/* Email the client an update (auto on phase/decision changes; manual note any time) */}
              <div className="rounded-[14px] border border-border p-4 mt-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="text-[11px] font-bold tracking-wide text-ink-2">EMAIL THE CLIENT</span>
                </div>
                <label className="block text-[11px] text-muted mb-1">Client email</label>
                <input type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)}
                  onBlur={() => { const v = emailVal.trim(); if (v !== (caseData.client_email || '')) updateCase(caseData.id, { client_email: v || null }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  placeholder="name@example.com"
                  className="w-full text-[12px] border border-border rounded-md px-2.5 py-2 mb-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                {caseData.client_email ? (
                  <>
                    <p className="text-[11.5px] text-muted mb-2.5 leading-relaxed">Phase changes and decisions email {caseData.client_name.split(' ')[0]} automatically. Send a custom note whenever you like.</p>
                    {noteOpen ? (
                      <div className="space-y-2">
                        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3}
                          placeholder={`Write a quick update for ${caseData.client_name.split(' ')[0]}…`}
                          className="w-full text-[12px] border border-border rounded-md px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                        <div className="flex items-center gap-2">
                          <button onClick={sendUpdate} disabled={sending} className="btn btn-sm text-white disabled:opacity-50" style={{ background: '#4F46E5' }}>
                            <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send email'}
                          </button>
                          <button onClick={() => { setNoteOpen(false); setNoteText(''); }} className="text-[11.5px] text-muted px-2 py-1">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setNoteOpen(true)} className="btn btn-outline btn-sm"><Mail className="w-3.5 h-3.5" /> Send update</button>
                    )}
                  </>
                ) : (
                  <p className="text-[11.5px] text-muted leading-relaxed">Enter the client&rsquo;s email above to enable update emails.</p>
                )}
              </div>

              <div className="h-2" />
            </div>
          </motion.aside>

          <ConfirmDialog
            open={confirmDelete}
            onClose={() => setConfirmDelete(false)}
            onConfirm={async () => { await deleteCase(caseData.id); setConfirmDelete(false); onClose(); }}
            title="Delete this case?"
            description={`This permanently deletes the case for ${caseData.client_name} and its entire journey. This cannot be undone.`}
            confirmLabel="Delete case"
            variant="danger"
          />
        </>
      )}
    </AnimatePresence>
  );
}

function ProgressRing({ pct, accent }: { pct: number; accent: string }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="relative flex-shrink-0" style={{ width: 56, height: 56 }}>
      <svg width="56" height="56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="hsl(var(--surface-2))" strokeWidth="5" />
        <motion.circle cx="28" cy="28" r={r} fill="none" stroke={accent} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} initial={false} animate={{ strokeDashoffset: c - (c * pct) / 100 }} transition={{ duration: 0.5 }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-bold num">{pct}%</div>
    </div>
  );
}

function PhaseCard({
  phase, journey, expanded, onToggleExpand, onToggleTask, onTogglePillarDone,
  onAddEvidence, onRemoveEvidence, onPassGate, caseData, onUpdateCase,
}: {
  phase: JourneyPhase;
  journey: CaseJourneyState;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleTask: (k: string) => void;
  onTogglePillarDone: (k: string) => void;
  onAddEvidence: (k: string, title: string, link: string) => void;
  onRemoveEvidence: (k: string, idx: number) => void;
  onPassGate: () => void;
  caseData: Case;
  onUpdateCase: (patch: Partial<Case>) => void;
}) {
  const unlocked = isPhaseUnlocked(journey, phase);
  const complete = isPhaseComplete(journey, phase);
  const gatePassed = isGatePassed(journey, phase.key);
  const { done, total } = phaseProgress(journey, phase);
  const prev = phase.index > 1 ? JOURNEY[phase.index - 2] : null;
  const statusColor = gatePassed ? phase.accent : unlocked ? 'hsl(var(--ink))' : 'hsl(var(--faint))';

  return (
    <div className={cn('rounded-[14px] border transition-all overflow-hidden',
      gatePassed ? 'border-transparent' : unlocked ? 'border-border' : 'border-border opacity-70')}
      style={gatePassed ? { background: phase.tint } : { background: unlocked ? 'hsl(var(--surface))' : 'hsl(var(--surface-2))' }}>

      <button onClick={() => unlocked && onToggleExpand()} disabled={!unlocked}
        className={cn('w-full flex items-center gap-3 px-4 py-3.5 text-left', unlocked && 'cursor-pointer')}>
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold transition-colors"
            style={{
              background: gatePassed ? phase.accent : unlocked ? phase.tint : 'hsl(var(--surface))',
              color: gatePassed ? '#fff' : unlocked ? phase.accent : 'hsl(var(--faint))',
              border: gatePassed ? 'none' : `1.5px solid ${unlocked ? phase.accent : 'hsl(var(--border-strong))'}`,
            }}>
            {gatePassed ? <Check className="w-4 h-4" strokeWidth={3} /> : !unlocked ? <Lock className="w-3.5 h-3.5" /> : phase.index}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-bold tracking-[0.08em]" style={{ color: statusColor }}>{phase.code}</span>
            {gatePassed && <span className="chip" style={{ background: '#fff', color: phase.accent, fontSize: 10 }}><CircleCheck className="w-3 h-3" /> Gate cleared</span>}
          </div>
          <div className="text-[14px] font-semibold leading-tight mt-0.5" style={{ color: unlocked ? 'hsl(var(--ink))' : 'hsl(var(--muted))' }}>
            {phase.name}
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-shrink-0">
          {unlocked ? (
            <span className="text-[11.5px] font-medium num" style={{ color: complete ? phase.accent : 'hsl(var(--muted))' }}>{done}/{total}</span>
          ) : (
            <span className="text-[10.5px] text-faint">Locked</span>
          )}
          {unlocked && <ChevronDown className={cn('w-4 h-4 text-muted transition-transform', expanded && 'rotate-180')} />}
        </div>
      </button>

      {!unlocked && prev && (
        <div className="px-4 pb-3.5 -mt-1">
          <div className="text-[11.5px] text-faint pl-12">Unlocks after the {prev.code} gate is cleared</div>
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && unlocked && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1">
              {phase.kind === 'tasks' ? (
                <div className="space-y-1">
                  {phase.tasks!.map((t) => (
                    <TaskRow key={t.key} label={t.label} done={!!journey.tasks[t.key]?.done} accent={phase.accent} onToggle={() => onToggleTask(t.key)} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {phase.pillars!.map((p) => (
                    <PillarCard key={p.key} pillar={p} accent={phase.accent} state={journey.pillars[p.key]}
                      onToggleDone={() => onTogglePillarDone(p.key)}
                      onAddEvidence={(title, link) => onAddEvidence(p.key, title, link)}
                      onRemoveEvidence={(idx) => onRemoveEvidence(p.key, idx)} />
                  ))}
                </div>
              )}

              {phase.key === 'submit' && <DecisionPanel caseData={caseData} onUpdateCase={onUpdateCase} accent={phase.accent} />}

              <GateBar phase={phase} complete={complete} passed={gatePassed} onPass={onPassGate} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TaskRow({ label, done, accent, onToggle }: { label: string; done: boolean; accent: string; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-surface-2 transition-colors text-left group">
      <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all"
        style={done ? { background: accent, border: 'none' } : { border: '1.5px solid hsl(var(--border-strong))' }}>
        {done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </span>
      <span className={cn('text-[13px] transition-colors', done ? 'text-muted line-through' : 'text-ink-2 group-hover:text-ink')}>{label}</span>
    </button>
  );
}

function PillarCard({ pillar, accent, state, onToggleDone, onAddEvidence, onRemoveEvidence }: {
  pillar: { key: string; letter: string; name: string; hint: string };
  accent: string;
  state?: { done: boolean; evidence?: { title: string; link?: string }[] };
  onToggleDone: () => void;
  onAddEvidence: (title: string, link: string) => void;
  onRemoveEvidence: (idx: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const done = !!state?.done;
  const evidence = state?.evidence || [];
  const Icon = PILLAR_ICONS[pillar.key] || Sparkles;

  const submit = () => {
    if (!title.trim()) return;
    onAddEvidence(title, link);
    setTitle(''); setLink(''); setAdding(false);
  };

  return (
    <div className="rounded-xl border p-3 transition-all" style={{ borderColor: done ? accent : 'hsl(var(--border))', background: done ? `${accent}0D` : 'hsl(var(--surface))' }}>
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent}1A`, color: accent }}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold" style={{ color: accent }}>PILLAR {pillar.letter}</span>
          <div className="text-[13px] font-semibold leading-tight">{pillar.name}</div>
          <div className="text-[10.5px] text-muted mt-0.5">{pillar.hint}</div>
        </div>
        <button onClick={onToggleDone} title={done ? 'Mark not ready' : 'Mark ready'}
          className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all"
          style={done ? { background: accent } : { border: '1.5px solid hsl(var(--border-strong))' }}>
          {done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
      </div>

      {evidence.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {evidence.map((e, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11.5px] bg-surface-2 rounded-md px-2 py-1 group">
              {e.link ? (
                <a href={e.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink-2 hover:text-indigo-600 truncate flex-1">
                  <Link2 className="w-3 h-3 flex-shrink-0" />{e.title}
                </a>
              ) : (
                <span className="text-ink-2 truncate flex-1">{e.title}</span>
              )}
              <button onClick={() => onRemoveEvidence(i)} className="opacity-0 group-hover:opacity-100 text-faint hover:text-danger flex-shrink-0"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-2 space-y-1.5">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Evidence title"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setAdding(false); setTitle(''); setLink(''); } }}
            className="w-full px-2 py-1.5 border border-border rounded-md bg-surface text-[12px] outline-none focus:border-indigo-400" />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional)"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setAdding(false); setTitle(''); setLink(''); } }}
            className="w-full px-2 py-1.5 border border-border rounded-md bg-surface text-[12px] outline-none focus:border-indigo-400" />
          <div className="flex gap-1.5">
            <button onClick={submit} className="text-[11.5px] font-medium px-2.5 py-1 rounded-md text-white" style={{ background: accent }}>Add</button>
            <button onClick={() => { setAdding(false); setTitle(''); setLink(''); }} className="text-[11.5px] text-muted px-2 py-1">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 text-[11.5px] font-medium inline-flex items-center gap-1 hover:opacity-80" style={{ color: accent }}>
          <Plus className="w-3 h-3" /> Add evidence
        </button>
      )}
    </div>
  );
}

function DecisionPanel({ caseData, onUpdateCase, accent }: { caseData: Case; onUpdateCase: (patch: Partial<Case>) => void; accent: string }) {
  const [ref, setRef] = useState(caseData.submission_ref || '');
  const [submittedAt, setSubmittedAt] = useState(caseData.submitted_at ? caseData.submitted_at.split('T')[0] : '');
  const decision = caseData.decision || 'pending';
  const decisions: Decision[] = ['pending', 'approved', 'rejected', 'resubmission'];

  return (
    <div className="mt-3 rounded-xl border border-border p-3.5" style={{ background: 'hsl(var(--surface-2))' }}>
      <div className="text-[11px] font-bold tracking-wide mb-2.5" style={{ color: accent }}>SUBMISSION &amp; DECISION</div>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-[10.5px] font-medium text-muted mb-1">Reference no.</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} onBlur={() => { if (ref !== (caseData.submission_ref || '')) onUpdateCase({ submission_ref: ref || null }); }}
            placeholder="e.g. TN-2026-…" className="w-full px-2 py-1.5 border border-border rounded-md bg-surface text-[12px] outline-none focus:border-indigo-400" />
        </div>
        <div>
          <label className="block text-[10.5px] font-medium text-muted mb-1">Submitted on</label>
          <input type="date" value={submittedAt} onChange={(e) => { setSubmittedAt(e.target.value); onUpdateCase({ submitted_at: e.target.value ? new Date(e.target.value).toISOString() : null }); }}
            className="w-full px-2 py-1.5 border border-border rounded-md bg-surface text-[12px] outline-none focus:border-indigo-400" />
        </div>
      </div>
      <div className="mt-2.5">
        <label className="block text-[10.5px] font-medium text-muted mb-1.5">Decision</label>
        <div className="flex flex-wrap gap-1.5">
          {decisions.map((d) => {
            const meta = DECISION_META[d];
            const isOn = decision === d;
            return (
              <button key={d} onClick={() => onUpdateCase({ decision: d, decided_at: d === 'pending' ? null : new Date().toISOString() })}
                className="text-[11.5px] font-medium px-2.5 py-1 rounded-full border transition-all"
                style={isOn ? { background: meta.bg, color: meta.fg, borderColor: 'transparent' } : { background: 'hsl(var(--surface))', color: 'hsl(var(--muted))', borderColor: 'hsl(var(--border))' }}>
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GateBar({ phase, complete, passed, onPass }: { phase: JourneyPhase; complete: boolean; passed: boolean; onPass: () => void }) {
  if (passed) {
    return (
      <div className="mt-3 rounded-xl px-3.5 py-3 flex items-center gap-2.5" style={{ background: `${phase.accent}14` }}>
        <CircleCheck className="w-4 h-4 flex-shrink-0" style={{ color: phase.accent }} />
        <div className="flex-1 text-[12px] font-medium" style={{ color: phase.accent }}>Gate cleared · {phase.gate}</div>
        <button onClick={onPass} className="text-[11px] text-muted hover:text-ink underline">Reopen</button>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl border border-dashed px-3.5 py-3 flex items-center gap-3" style={{ borderColor: complete ? phase.accent : 'hsl(var(--border-strong))' }}>
      <Flag className="w-4 h-4 flex-shrink-0" style={{ color: complete ? phase.accent : 'hsl(var(--faint))' }} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold tracking-wide" style={{ color: complete ? phase.accent : 'hsl(var(--muted))' }}>GATE</div>
        <div className="text-[12px] text-ink-2 leading-tight">{phase.gate}</div>
      </div>
      <button onClick={onPass} disabled={!complete}
        className="text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed text-white"
        style={{ background: complete ? phase.accent : 'hsl(var(--faint))' }}>
        {complete ? 'Pass gate →' : 'Finish tasks first'}
      </button>
    </div>
  );
}

function StatusPill({ archived, journeyDone, decision }: { archived: boolean; journeyDone: boolean; decision: Decision }) {
  if (archived) {
    if (decision === 'approved') return <span className="chip" style={{ background: '#D1FAE5', color: '#047857', border: 'none' }}>Closed · Endorsed</span>;
    if (decision === 'rejected') return <span className="chip" style={{ background: '#F4F4F6', color: '#6B7280', border: 'none' }}>Closed · Rejected</span>;
    return <span className="chip" style={{ background: '#F4F4F6', color: '#6B7280', border: 'none' }}>Closed</span>;
  }
  if (journeyDone) return <span className="chip" style={{ background: '#D1FAE5', color: '#047857', border: 'none' }}>Complete</span>;
  return <span className="chip" style={{ background: '#EEF0FF', color: '#4338CA', border: 'none' }}>Open</span>;
}
