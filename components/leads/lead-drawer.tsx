'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, Mail, MessageSquare, IndianRupee, Trash2, Save, Undo2, FileText, CalendarClock, Plus, Star } from 'lucide-react';
import type { Lead, Note, Payment, LeadStage } from '@/lib/types';
import { STAGE_META, MILESTONE_META } from '@/lib/types';
import { useApp } from '@/components/shared/app-provider';
import { Select } from '@/components/shared/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FollowUpsList } from '@/components/followups/followups-list';
import { AddFollowUpDialog } from '@/components/followups/add-followup-dialog';
import { PaymentRow } from '@/components/payments/payment-row';
import { IndustrySelector, IndustryChip } from '@/components/shared/industry-chip';
import { initials, avatarColor, formatINRFull, timeAgo, scoreColor, cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  leadId: string | null;
  onClose: () => void;
  onRecordPayment: (leadId: string) => void;
}

export function LeadDrawer({ leadId, onClose, onRecordPayment }: Props) {
  const { leads, payments, followUps, updateLead, deleteLead, toggleSpotlight, addNote, getNotes, role, memberNameById } = useApp();
  const [tab, setTab] = useState<'overview' | 'notes' | 'payments' | 'followups'>('overview');
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [pendingLead, setPendingLead] = useState<Partial<Lead>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addFollowUpOpen, setAddFollowUpOpen] = useState(false);

  const lead = leads.find((l) => l.id === leadId);
  const effectiveLead = useMemo(() => (lead ? { ...lead, ...pendingLead } : null), [lead, pendingLead]);
  const pendingCount = Object.keys(pendingLead).length;
  const isDirty = pendingCount > 0;

  useEffect(() => {
    if (!leadId) { setPendingLead({}); return; }
    setTab('overview'); setNewNote('');
    getNotes(leadId).then(setNotes);
  }, [leadId, getNotes]);

  const submitNote = async () => {
    if (!leadId || !newNote.trim()) return;
    await addNote(leadId, newNote.trim());
    setNewNote('');
    const fresh = await getNotes(leadId);
    setNotes(fresh);
  };

  const setLeadPending = (patch: Partial<Lead>) => {
    setPendingLead((prev) => {
      const next: Partial<Lead> = { ...prev, ...patch };
      if (lead) {
        (Object.keys(next) as (keyof Lead)[]).forEach((k) => {
          if (next[k] === lead[k]) delete next[k];
        });
      }
      return next;
    });
  };

  const saveChanges = async () => {
    if (!lead || !isDirty) return;
    setSaving(true);
    try {
      await updateLead(lead.id, pendingLead);
      setPendingLead({});
      toast.success(`Saved ${pendingCount} change${pendingCount === 1 ? '' : 's'}`);
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    setPendingLead({});
    toast.info('Changes discarded');
  };

  const handleClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  const leadPayments: Payment[] = leadId ? payments.filter((p) => p.lead_id === leadId) : [];
  const leadFollowUps = useMemo(() => followUps.filter((f) => f.lead_id === leadId), [followUps, leadId]);
  const pendingFollowUps = leadFollowUps.filter((f) => f.status === 'pending').length;
  const open = !!leadId && !!effectiveLead;

  return (
    <>
      <AnimatePresence>
        {open && effectiveLead && lead && (
          <>
            <motion.div className="fixed inset-0 z-[60]" style={{ background: 'rgba(15,17,21,0.25)', backdropFilter: 'blur(3px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={handleClose} />
            <motion.aside className="fixed top-0 right-0 bottom-0 w-[min(640px,92vw)] bg-surface border-l border-border z-[70] flex flex-col"
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
              <div className="px-6 py-5 border-b border-border flex items-center gap-3">
                <div className="av" style={{ background: avatarColor(effectiveLead.id), width: 36, height: 36, fontSize: 13 }}>{initials(effectiveLead.full_name)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-[16px] font-semibold leading-tight truncate">{effectiveLead.full_name}</div>
                    <IndustryChip industry={effectiveLead.industry} size="xs" />
                  </div>
                  <div className="text-[12px] text-muted leading-tight mt-1 truncate">{[effectiveLead.phone, effectiveLead.email].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleSpotlight(effectiveLead.id)}
                    title={effectiveLead.is_spotlight ? 'Remove from Spotlight' : 'Add to Spotlight'}
                    className="btn btn-ghost p-2"
                  >
                    <Star className="w-4 h-4" style={effectiveLead.is_spotlight ? { fill: '#F59E0B', color: '#F59E0B' } : { color: '#9CA3AF' }} />
                  </button>
                  <button onClick={handleClose} className="btn btn-ghost p-2"><X className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="flex items-center gap-1 mx-6 mt-5 p-1 rounded-md bg-surface-2 w-fit">
                {(['overview', 'notes', 'followups', 'payments'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-1.5 rounded-md text-[12.5px] font-medium', tab === t ? 'bg-surface shadow-sm' : 'text-muted hover:bg-surface')}>
                    {t === 'followups' ? 'Follow-ups' : t.charAt(0).toUpperCase() + t.slice(1)}
                    {t === 'notes' && notes.length > 0 ? ` · ${notes.length}` : ''}
                    {t === 'followups' && pendingFollowUps > 0 ? ` · ${pendingFollowUps}` : ''}
                    {t === 'payments' && leadPayments.length > 0 ? ` · ${leadPayments.length}` : ''}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {tab === 'overview' && (
                  <div className="space-y-1 mb-6">
                    <Row label="Stage">
                      <div style={{ maxWidth: 220 }}>
                        <Select<LeadStage>
                          value={effectiveLead.stage}
                          onChange={(v) => setLeadPending({ stage: v })}
                          options={(Object.keys(STAGE_META) as LeadStage[]).map((k) => ({ value: k, label: STAGE_META[k].label, color: STAGE_META[k].dot }))}
                          size="sm"
                        />
                      </div>
                    </Row>
                    <Row label="Lead score">
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={100} value={effectiveLead.score} onChange={(e) => setLeadPending({ score: Number(e.target.value) })} className="w-40" style={{ accentColor: scoreColor(effectiveLead.score) }} />
                        <span className="num text-[12.5px] font-semibold" style={{ color: scoreColor(effectiveLead.score) }}>{effectiveLead.score}</span>
                      </div>
                    </Row>
                    <Row label="Next follow-up">
                      <input type="datetime-local" className="input py-1.5 px-2.5 w-auto text-[12px]"
                        value={effectiveLead.next_follow_up ? new Date(effectiveLead.next_follow_up).toISOString().slice(0, 16) : ''}
                        onChange={(e) => setLeadPending({ next_follow_up: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                    </Row>
                    <Row label="Full name">
                      <InlineText value={effectiveLead.full_name} onChange={(v) => setLeadPending({ full_name: v || '' })} placeholder="Full name" />
                    </Row>
                    <Row label="Visa type">
                      <InlineText value={effectiveLead.visa_type} onChange={(v) => setLeadPending({ visa_type: v })} placeholder="UK GTV…" />
                    </Row>
                    <Row label="Industry">
                      <div className="py-1">
                        <IndustrySelector value={effectiveLead.industry} onChange={(v) => setLeadPending({ industry: v })} size="sm" />
                      </div>
                    </Row>
                    <Row label="Phone">
                      <InlineText value={effectiveLead.phone} onChange={(v) => setLeadPending({ phone: v })} placeholder="+91…" />
                    </Row>
                    <Row label="Email">
                      <InlineText value={effectiveLead.email} onChange={(v) => setLeadPending({ email: v })} placeholder="email@…" />
                    </Row>
                    <Row label="Total fee">
                      <InlineNumber
                        value={effectiveLead.amount_total}
                        onChange={(v) => {
                          const paid = effectiveLead.amount_paid || 0;
                          const status = paid === 0 ? 'none' : (v > 0 && paid >= v) ? 'paid' : 'partial';
                          setLeadPending({ amount_total: v, payment_status: status });
                        }}
                        placeholder="0"
                      />
                    </Row>
                    <Row label="Amount paid">
                      <InlineNumber
                        value={effectiveLead.amount_paid}
                        onChange={(v) => {
                          const total = effectiveLead.amount_total || 0;
                          const status = v === 0 ? 'none' : (total > 0 && v >= total) ? 'paid' : 'partial';
                          setLeadPending({ amount_paid: v, payment_status: status });
                        }}
                        placeholder="0"
                      />
                    </Row>
                    <Row label="Overdue">
                      <InlineNumber
                        value={effectiveLead.amount_overdue}
                        onChange={(v) => setLeadPending({ amount_overdue: v })}
                        placeholder="0"
                      />
                      {(effectiveLead.amount_overdue || 0) > 0 && (
                        <span className="text-[10.5px] font-medium ml-2" style={{ color: '#A32D2D' }}>· past due</span>
                      )}
                    </Row>
                    {effectiveLead.amount_total > 0 && (
                      <Row label="Remaining">
                        <span className="text-[13px] font-semibold num" style={{ color: Math.max(0, (effectiveLead.amount_total || 0) - (effectiveLead.amount_paid || 0)) > 0 ? '#854F0B' : '#0F6E56' }}>
                          {formatINRFull(Math.max(0, (effectiveLead.amount_total || 0) - (effectiveLead.amount_paid || 0)))}
                        </span>
                        <span className="text-[10.5px] text-faint ml-2">· total − paid</span>
                      </Row>
                    )}
                    <Row label="Created">
                      <span className="text-[13px] text-ink-2">
                        {new Date(effectiveLead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        <span className="text-muted"> · {timeAgo(effectiveLead.created_at)}</span>
                      </span>
                    </Row>
                    {effectiveLead.created_by && (
                      <Row label="Added by">
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
                          <div className="av" style={{ background: avatarColor(effectiveLead.created_by), width: 18, height: 18, fontSize: 8 }}>{initials(memberNameById(effectiveLead.created_by))}</div>
                          {memberNameById(effectiveLead.created_by)}
                        </span>
                      </Row>
                    )}
                    {effectiveLead.last_note_author_id && effectiveLead.last_note_at && (
                      <Row label="Last note by">
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
                          <div className="av" style={{ background: avatarColor(effectiveLead.last_note_author_id), width: 18, height: 18, fontSize: 8 }}>{initials(memberNameById(effectiveLead.last_note_author_id))}</div>
                          {memberNameById(effectiveLead.last_note_author_id)}<span className="text-muted"> · {timeAgo(effectiveLead.last_note_at)}</span>
                        </span>
                      </Row>
                    )}
                  </div>
                )}

                {tab === 'notes' && (
                  <>
                    <div className="mb-4">
                      <textarea className="input mb-2" rows={3} placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)}
                        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitNote(); }} />
                      <div className="flex items-center justify-between"><span className="text-[11px] text-muted">⌘ + Enter to save</span>
                        <button onClick={submitNote} disabled={!newNote.trim()} className="btn btn-primary btn-sm disabled:opacity-50">Add note</button>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {notes.length === 0 ? <div className="text-center py-10 text-[12.5px] text-muted">No notes yet</div> :
                        notes.map((n) => (
                          <div key={n.id} className="rounded-xl border border-border p-3.5">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="av" style={{ background: avatarColor(n.author_id || 'unknown'), width: 22, height: 22, fontSize: 9 }}>
                                {initials(memberNameById(n.author_id))}
                              </div>
                              <span className="text-[12px] font-semibold text-ink">{memberNameById(n.author_id)}</span>
                              <span className="text-[11px] text-muted">· {timeAgo(n.created_at)}</span>
                              <span className="text-[10.5px] text-faint ml-auto">{new Date(n.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                            <div className="text-[12.5px] text-ink-2 leading-relaxed whitespace-pre-wrap pl-7">{n.body}</div>
                          </div>
                        ))}
                    </div>
                  </>
                )}

                {tab === 'followups' && (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-[12.5px] text-muted">
                        {pendingFollowUps > 0
                          ? `${pendingFollowUps} pending · ${leadFollowUps.length} total`
                          : leadFollowUps.length > 0
                            ? `All ${leadFollowUps.length} follow-up${leadFollowUps.length === 1 ? '' : 's'} completed`
                            : 'No follow-ups yet'}
                      </div>
                      <button onClick={() => setAddFollowUpOpen(true)} className="btn btn-primary btn-sm">
                        <Plus className="w-3.5 h-3.5" /> New follow-up
                      </button>
                    </div>
                    <FollowUpsList
                      followUps={leadFollowUps}
                      showLeadColumn={false}
                      emptyMessage="No follow-ups for this lead"
                      emptyAction={
                        <button onClick={() => setAddFollowUpOpen(true)} className="btn btn-primary btn-sm">
                          <Plus className="w-3.5 h-3.5" /> Schedule first follow-up
                        </button>
                      }
                    />
                  </>
                )}

                {tab === 'payments' && (
                  <>
                    <div className="flex items-center justify-between mb-3 gap-3">
                      <div className="text-[11.5px] text-muted">
                        {leadPayments.length === 0
                          ? 'Track every payment for this client here — received, pending, or overdue.'
                          : 'Hover any payment to edit or delete it. Changes update totals everywhere.'}
                      </div>
                      <button onClick={() => onRecordPayment(lead.id)} className="btn btn-primary btn-sm flex-shrink-0">
                        <IndianRupee className="w-3.5 h-3.5" /> Add payment
                      </button>
                    </div>
                    {leadPayments.length === 0 ? (
                      <div className="text-center py-8 rounded-md border border-dashed border-border">
                        <div className="text-[12.5px] text-muted mb-1">No payments yet</div>
                        <div className="text-[11px] text-faint max-w-[280px] mx-auto">Click <strong>Add payment</strong> above to log a received payment or schedule one for a future date.</div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {leadPayments.map((p) => (
                          <PaymentRow key={p.id} payment={p} />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {isDirty && <div className="h-20" />}
              </div>

              <div className="px-6 py-4 border-t border-border flex items-center gap-2 bg-surface-2">
                <a href={effectiveLead.phone ? `tel:${effectiveLead.phone}` : '#'} className={cn('btn btn-outline btn-sm', !effectiveLead.phone && 'opacity-50 pointer-events-none')}><Phone className="w-3.5 h-3.5" /> Call</a>
                <a href={effectiveLead.email ? `mailto:${effectiveLead.email}` : '#'} className={cn('btn btn-outline btn-sm', !effectiveLead.email && 'opacity-50 pointer-events-none')}><Mail className="w-3.5 h-3.5" /> Email</a>
                <button onClick={() => setTab('notes')} className="btn btn-outline btn-sm"><MessageSquare className="w-3.5 h-3.5" /> Note</button>
                <button onClick={() => onRecordPayment(lead.id)} className="btn btn-primary btn-sm ml-auto"><IndianRupee className="w-3.5 h-3.5" /> Record payment</button>
                {role === 'admin' && (
                  <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost p-2" title="Delete lead">
                    <Trash2 className="w-4 h-4 text-danger" />
                  </button>
                )}
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
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => { if (lead) { await deleteLead(lead.id); setConfirmDelete(false); onClose(); } }}
        title="Delete this lead?"
        description={`This permanently deletes ${lead?.full_name} and all related notes and payment records. This cannot be undone.`}
        confirmLabel="Delete lead"
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

      <AddFollowUpDialog
        open={addFollowUpOpen}
        onClose={() => setAddFollowUpOpen(false)}
        presetLeadId={leadId}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center py-2 border-b border-border">
      <span className="text-[12px] text-muted">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function InlineText({ value, onChange, placeholder }: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { setEditing(false); const t = v.trim(); if ((t || null) !== (value || null)) onChange(t || null); };
  if (editing) return <input className="input py-1.5 px-2.5 text-[12px]" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(value || ''); setEditing(false); } }} placeholder={placeholder} />;
  return <button onClick={() => setEditing(true)} className="text-[13px] text-ink-2 hover:text-ink hover:bg-surface-2 px-2 py-1 -mx-2 -my-1 rounded text-left">{value || <span className="text-faint">{placeholder || '—'}</span>}</button>;
}

function InlineNumber({ value, onChange, placeholder }: { value: number | null; onChange: (v: number) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState((value ?? 0).toString());
  useEffect(() => setV((value ?? 0).toString()), [value]);
  const commit = () => {
    setEditing(false);
    const n = Math.max(0, Math.round(parseFloat(v) || 0));
    if (n !== (value || 0)) onChange(n);
  };
  if (editing) return <input type="number" min="0" className="input py-1.5 px-2.5 text-[12px] w-[140px] num" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV((value ?? 0).toString()); setEditing(false); } }} placeholder={placeholder} />;
  return <button onClick={() => setEditing(true)} className="num font-semibold text-[13px] hover:text-ink hover:bg-surface-2 px-2 py-1 -mx-2 -my-1 rounded text-left">{formatINRFull(value || 0)}</button>;
}
