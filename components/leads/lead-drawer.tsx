'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, Mail, MessageSquare, IndianRupee, Trash2 } from 'lucide-react';
import type { Lead, Note, Payment, LeadStage } from '@/lib/types';
import { STAGE_META, MILESTONE_META } from '@/lib/types';
import { useApp } from '@/components/shared/app-provider';
import { initials, avatarColor, formatINRFull, timeAgo, scoreColor } from '@/lib/utils';

interface Props {
  leadId: string | null;
  onClose: () => void;
  onRecordPayment: (leadId: string) => void;
}

export function LeadDrawer({ leadId, onClose, onRecordPayment }: Props) {
  const { leads, payments, updateLead, deleteLead, addNote, getNotes, role } = useApp();
  const [tab, setTab] = useState<'overview' | 'notes' | 'payments'>('overview');
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const lead: Lead | undefined = leads.find((l) => l.id === leadId);

  useEffect(() => {
    if (!leadId) return;
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

  const leadPayments: Payment[] = leadId ? payments.filter((p) => p.lead_id === leadId) : [];
  const open = !!leadId && !!lead;

  return (
    <AnimatePresence>
      {open && lead && (
        <>
          <motion.div className="fixed inset-0 z-[60]" style={{ background: 'rgba(15,17,21,0.25)', backdropFilter: 'blur(3px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside className="fixed top-0 right-0 bottom-0 w-[min(640px,92vw)] bg-surface border-l border-border z-[70] flex flex-col"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
            <div className="px-6 py-5 border-b border-border flex items-center gap-3">
              <div className="av" style={{ background: avatarColor(lead.id), width: 36, height: 36, fontSize: 13 }}>{initials(lead.full_name)}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[16px] font-semibold leading-tight truncate">{lead.full_name}</div>
                <div className="text-[12px] text-muted leading-tight mt-1 truncate">{[lead.phone, lead.email].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <button onClick={onClose} className="btn btn-ghost p-2"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex items-center gap-1 mx-6 mt-5 p-1 rounded-md bg-surface-2 w-fit">
              {(['overview', 'notes', 'payments'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium ${tab === t ? 'bg-surface shadow-sm' : 'text-muted hover:bg-surface'}`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}{t === 'notes' && notes.length > 0 ? ` · ${notes.length}` : ''}{t === 'payments' && leadPayments.length > 0 ? ` · ${leadPayments.length}` : ''}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {tab === 'overview' && (
                <>
                  <div className="space-y-1 mb-6">
                    <Row label="Stage">
                      <select className="input py-1.5 px-2.5 w-auto text-[12px]" value={lead.stage} onChange={(e) => updateLead(lead.id, { stage: e.target.value as LeadStage })}>
                        {(Object.keys(STAGE_META) as LeadStage[]).map((k) => <option key={k} value={k}>{STAGE_META[k].label}</option>)}
                      </select>
                    </Row>
                    <Row label="Lead score">
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={100} value={lead.score} onChange={(e) => updateLead(lead.id, { score: Number(e.target.value) })} className="w-40" style={{ accentColor: scoreColor(lead.score) }} />
                        <span className="num text-[12.5px] font-semibold" style={{ color: scoreColor(lead.score) }}>{lead.score}</span>
                      </div>
                    </Row>
                    <Row label="Next follow-up">
                      <input type="datetime-local" className="input py-1.5 px-2.5 w-auto text-[12px]"
                        value={lead.next_follow_up ? new Date(lead.next_follow_up).toISOString().slice(0, 16) : ''}
                        onChange={(e) => updateLead(lead.id, { next_follow_up: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                    </Row>
                    <Row label="Visa type"><EditText value={lead.visa_type} onSave={(v) => updateLead(lead.id, { visa_type: v })} placeholder="UK GTV…" /></Row>
                    <Row label="Phone"><EditText value={lead.phone} onSave={(v) => updateLead(lead.id, { phone: v })} placeholder="+91…" /></Row>
                    <Row label="Email"><EditText value={lead.email} onSave={(v) => updateLead(lead.id, { email: v })} placeholder="email@…" /></Row>
                    <Row label="Amount paid"><span className="num font-semibold text-[13px]">{formatINRFull(lead.amount_paid)}</span></Row>
                    <Row label="Created"><span className="text-[13px] text-ink-2">{new Date(lead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}<span className="text-muted"> · {timeAgo(lead.created_at)}</span></span></Row>
                  </div>
                </>
              )}

              {tab === 'notes' && (
                <>
                  <div className="mb-4">
                    <textarea className="input mb-2" rows={3} placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitNote(); }} />
                    <div className="flex items-center justify-between"><span className="text-[11px] text-muted">⌘ + Enter to save</span><button onClick={submitNote} disabled={!newNote.trim()} className="btn btn-primary btn-sm disabled:opacity-50">Add note</button></div>
                  </div>
                  <div className="space-y-3">
                    {notes.length === 0 ? <div className="text-center py-10 text-[12.5px] text-muted">No notes yet</div> :
                      notes.map((n) => (
                        <div key={n.id} className="rounded-xl border border-border p-3.5">
                          <div className="flex items-center justify-between mb-1.5"><span className="text-[11px] text-muted">{timeAgo(n.created_at)}</span></div>
                          <div className="text-[12.5px] text-ink-2 leading-relaxed whitespace-pre-wrap">{n.body}</div>
                        </div>
                      ))}
                  </div>
                </>
              )}

              {tab === 'payments' && (
                <>
                  {leadPayments.length === 0 ? <div className="text-center py-10"><div className="text-[12.5px] text-muted mb-3">No payments recorded</div><button onClick={() => onRecordPayment(lead.id)} className="btn btn-primary btn-sm"><IndianRupee className="w-3.5 h-3.5" /> Record first payment</button></div> :
                    <div className="space-y-2">
                      {leadPayments.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-border">
                          <div><div className="text-[13px] font-semibold">{MILESTONE_META[p.milestone].label}</div><div className="text-[11px] text-muted">{p.paid_at ? timeAgo(p.paid_at) : 'pending'}{p.note ? ` · ${p.note}` : ''}</div></div>
                          <div className="text-right"><div className="num font-bold">{formatINRFull(p.amount)}</div><span className="chip" style={{ background: p.status === 'paid' ? 'hsl(var(--green-soft))' : p.status === 'overdue' ? 'hsl(var(--rose-soft))' : 'hsl(var(--amber-soft))', color: p.status === 'paid' ? '#047857' : p.status === 'overdue' ? '#B91C1C' : '#B45309', border: 'none' }}>{p.status}</span></div>
                        </div>
                      ))}
                    </div>}
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border flex items-center gap-2 bg-surface-2">
              <a href={lead.phone ? `tel:${lead.phone}` : '#'} className={`btn btn-outline btn-sm ${!lead.phone && 'opacity-50 pointer-events-none'}`}><Phone className="w-3.5 h-3.5" /> Call</a>
              <a href={lead.email ? `mailto:${lead.email}` : '#'} className={`btn btn-outline btn-sm ${!lead.email && 'opacity-50 pointer-events-none'}`}><Mail className="w-3.5 h-3.5" /> Email</a>
              <button onClick={() => setTab('notes')} className="btn btn-outline btn-sm"><MessageSquare className="w-3.5 h-3.5" /> Note</button>
              <button onClick={() => onRecordPayment(lead.id)} className="btn btn-primary btn-sm ml-auto"><IndianRupee className="w-3.5 h-3.5" /> Record payment</button>
              {role === 'admin' && (
                <button onClick={() => { if (confirm(`Delete ${lead.full_name}? This cannot be undone.`)) { deleteLead(lead.id); onClose(); } }} className="btn btn-ghost p-2" title="Delete lead">
                  <Trash2 className="w-4 h-4 text-danger" />
                </button>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
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

function EditText({ value, onSave, placeholder }: { value: string | null; onSave: (v: string | null) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { setEditing(false); const t = v.trim(); if ((t || null) !== (value || null)) onSave(t || null); };
  if (editing) return <input className="input py-1.5 px-2.5 text-[12px]" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(value || ''); setEditing(false); } }} placeholder={placeholder} />;
  return <button onClick={() => setEditing(true)} className="text-[13px] text-ink-2 hover:text-ink hover:bg-surface-2 px-2 py-1 -mx-2 -my-1 rounded">{value || <span className="text-faint">{placeholder || '—'}</span>}</button>;
}
