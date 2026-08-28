'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, Mail, MessageSquare, IndianRupee, Trash2, Save, Undo2, FileText, CalendarClock, Plus, Star, Pencil, Send, Inbox, Eye, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { Lead, Note, Payment, LeadStage } from '@/lib/types';
import { STAGE_META, MILESTONE_META, OFFER_META, getVisaMeta, hasOffer, INDUSTRY_LIST, INDUSTRY_META } from '@/lib/types';
import { useApp } from '@/components/shared/app-provider';
import { usePipelines, getStageColor } from '@/lib/pipelines';
import { Select } from '@/components/shared/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FollowUpsList } from '@/components/followups/followups-list';
import { AddFollowUpDialog } from '@/components/followups/add-followup-dialog';
import { PaymentRow } from '@/components/payments/payment-row';
import { ComposeDialog, LeadEmailThread, type LeadEmailRow } from '@/components/emails/compose-dialog';
import { RoadmapBuilder } from '@/components/roadmap/roadmap-builder';
import { IndustryChip } from '@/components/shared/industry-chip';
import { READINESS_LIST, READINESS_META, getReadinessMeta, intakeEntries } from '@/lib/intake';
import { initials, avatarColor, formatMoney, timeAgo, scoreColor, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DocEditorModal } from '@/components/leads/doc-editor-modal';
import { VisaRouteTab } from '@/components/leads/visa-route-tab';
import { FollowUpScheduler } from '@/components/leads/followup-scheduler';
import { playChime } from '@/lib/chime';

interface Props {
  leadId: string | null;
  onClose: () => void;
  onRecordPayment: (leadId: string) => void;
}

export function LeadDrawer({ leadId, onClose, onRecordPayment }: Props) {
  const { leads, payments, followUps, updateLead, deleteLead, toggleSpotlight, setLeadOffer, setLeadQualification, addNote, getNotes, createFollowUp, role, memberNameById, canViewPayments, canSendEmails, workspace, user: appUser } = useApp();
  const pl = usePipelines(workspace.id);
  const [tab, setTab] = useState<'overview' | 'notes' | 'payments' | 'followups' | 'emails' | 'roadmap' | 'route'>('overview');
  const [emailLog, setEmailLog] = useState<EmailLogEntry[] | null>(null);
  const [leadEmails, setLeadEmails] = useState<LeadEmailRow[] | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [pendingLead, setPendingLead] = useState<Partial<Lead> & { pipeline_id?: string | null }>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addFollowUpOpen, setAddFollowUpOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<null | 'sla' | 'onboarding' | 'process'>(null);

  // One-click branded emails (SLA / onboarding). Server logs to the activity feed.
  const [slaConfigOpen, setSlaConfigOpen] = useState(false);
  const [slaEditMode, setSlaEditMode] = useState(false);
  const [slaDiscount, setSlaDiscount] = useState('');

  // Review-and-edit before sending. Which document the editor holds, plus the
  // discount captured at open time so the preview and the send agree.
  const [docEditor, setDocEditor] = useState<null | { type: 'sla' | 'process'; discount?: number }>(null);
  // The formatted CV text (076) — the durable copy of a file that was read
  // once and deleted. Opens in a full modal, not squeezed into a Row.
  const [showProfile, setShowProfile] = useState(false);

  const fetchDocPreview = async (): Promise<{ subject: string; html: string } | null> => {
    if (!lead || !docEditor) return null;
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: docEditor.type, leadId: lead.id, preview: true,
          ...(docEditor.discount ? { discount: docEditor.discount } : {}) }),
      });
      const j = await res.json().catch(() => null);
      if (j?.ok && j.html) return { subject: j.subject, html: j.html };
      toast.error(`Could not prepare the document${j?.reason ? `: ${j.reason}` : ''}`);
      return null;
    } catch { toast.error('Could not prepare the document'); return null; }
  };

  const sendEditedDoc = async (subject: string, html: string): Promise<boolean> => {
    if (!lead || !docEditor) return false;
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: docEditor.type, leadId: lead.id,
          overrideHtml: html, overrideSubject: subject,
          ...(docEditor.discount ? { discount: docEditor.discount } : {}) }),
      });
      const j = await res.json().catch(() => null);
      if (j?.ok) {
        toast.success(`${docEditor.type === 'sla' ? 'Agreement' : '"How it works" email'} sent to ${lead.email}`);
        if (docEditor.type === 'sla') { setSlaConfigOpen(false); setSlaEditMode(false); setSlaDiscount(''); }
        return true;
      }
      toast.error(`Send failed${j?.reason ? `: ${j.reason}` : ''}`);
      return false;
    } catch { toast.error('Send failed — check your connection'); return false; }
  };

  const sendEmail = async (type: 'sla' | 'onboarding' | 'process', discount?: number) => {
    if (!lead) return;
    if (!lead.email) { toast.error('This lead has no email address'); return; }
    setSendingEmail(type);
    try {
      let res = await fetch('/api/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, leadId: lead.id, ...(discount ? { discount } : {}) }),
      });
      let j = await res.json().catch(() => null);
      if (j?.already_sent) {
        const again = window.confirm('Onboarding email was already sent to this client. Send again?');
        if (!again) return;
        res = await fetch('/api/email/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, leadId: lead.id, force: true, ...(discount ? { discount } : {}) }),
        });
        j = await res.json().catch(() => null);
      }
      if (j?.ok) { toast.success(type === 'sla' ? `SLA sent to ${lead.email}` : type === 'process' ? `"How it works" email sent to ${lead.email}` : `Onboarding email sent to ${lead.email}`); if (type === 'sla') { setSlaConfigOpen(false); setSlaEditMode(false); setSlaDiscount(''); } }
      else toast.error(`Send failed${j?.reason ? `: ${j.reason}` : ''}`);
    } catch {
      toast.error('Send failed — check your connection');
    } finally {
      setSendingEmail(null);
    }
  };

  const lead = leads.find((l) => l.id === leadId) as (Lead & { pipeline_id?: string | null }) | undefined;
  const effectiveLead = useMemo(() => (lead ? { ...lead, ...pendingLead } : null), [lead, pendingLead]);
  const pendingCount = Object.keys(pendingLead).length;
  const isDirty = pendingCount > 0;

  useEffect(() => {
    if (!leadId) { setPendingLead({}); return; }
    setTab('overview'); setNewNote('');
    getNotes(leadId).then(setNotes);
  }, [leadId, getNotes]);

  // Load this lead's email history (from the activity log) when the drawer opens.
  useEffect(() => {
    if (!leadId) { setEmailLog(null); return; }
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from('activity')
      .select('id, user_id, action, meta, created_at')
      .eq('lead_id', leadId)
      .eq('action', 'email_sent')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (!cancelled) setEmailLog((data as EmailLogEntry[]) || []); });
    supabase
      .from('lead_emails')
      .select('id, direction, from_email, to_email, subject, body_text, status, error, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (!cancelled) setLeadEmails((data as LeadEmailRow[]) || []); });
    return () => { cancelled = true; };
  }, [leadId]);

  const submitNote = async () => {
    if (!leadId || !newNote.trim()) return;
    await addNote(leadId, newNote.trim());
    setNewNote('');
    const fresh = await getNotes(leadId);
    setNotes(fresh);
  };

  const setLeadPending = (patch: Partial<Lead> & { pipeline_id?: string | null }) => {
    setPendingLead((prev) => {
      const next: Partial<Lead> & { pipeline_id?: string | null } = { ...prev, ...patch };
      if (lead) {
        (Object.keys(next) as (keyof typeof next)[]).forEach((k) => {
          if (next[k] === (lead as unknown as Record<string, unknown>)[k as string]) delete next[k];
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

  const refreshEmails = () => {
    if (!leadId) return;
    const supabase = createClient();
    void supabase.from('lead_emails')
      .select('id, direction, from_email, to_email, subject, body_text, status, error, created_at')
      .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setLeadEmails((data as LeadEmailRow[]) || []));
    void supabase.from('activity')
      .select('id, user_id, action, meta, created_at')
      .eq('lead_id', leadId).eq('action', 'email_sent')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setEmailLog((data as EmailLogEntry[]) || []));
  };

  const handleClose = () => {
    if (isDirty) { setConfirmClose(true); return; }
    onClose();
  };

  // Escape closes the drawer (prompts first if there are unsaved edits).
  // Ignored while a nested dialog is open so it doesn't close two things at once.
  useEffect(() => {
    if (!leadId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmDelete || confirmClose || addFollowUpOpen || slaConfigOpen) return;
      handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leadId, isDirty, confirmDelete, confirmClose, addFollowUpOpen, slaConfigOpen]);

  const leadPayments: Payment[] = leadId ? payments.filter((p) => p.lead_id === leadId) : [];
  const leadCurrency = effectiveLead?.currency || 'INR';
  const leadFollowUps = useMemo(() => followUps.filter((f) => f.lead_id === leadId), [followUps, leadId]);
  const intakeAnswers = useMemo(() => intakeEntries(effectiveLead?.intake), [effectiveLead?.intake]);
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
                    {getVisaMeta(effectiveLead.visa_type) && (() => { const m = getVisaMeta(effectiveLead.visa_type)!; return (
                      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide flex-shrink-0" style={{ background: m.bg, color: m.fg }} title={m.full}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.short}
                      </span>); })()}
                    <IndustryChip industry={effectiveLead.industry} size="xs" />
                    {/* Readiness sits in the header, next to the route and the
                        industry, because it is the one fact that changes how the
                        call opens and it should be visible before the drawer is
                        scrolled. */}
                    {(() => {
                      const m = getReadinessMeta(effectiveLead.investment_readiness);
                      if (!m) return null;
                      return (
                        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold flex-shrink-0"
                          style={{ background: m.bg, color: m.fg }} title={`Ad form: ${m.label}`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />{m.short}
                        </span>
                      );
                    })()}
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

              {/* Tab strip. Labels must NEVER wrap — "Visa route" breaking onto
                  two lines is what made this read as unfinished. Counts sit in
                  proper pills instead of loose "· 7" text, and on a narrow
                  drawer the strip scrolls sideways rather than stacking. */}
              <div className="mx-6 mt-5 flex w-fit max-w-[calc(100%-3rem)] items-center gap-0.5 overflow-x-auto rounded-lg bg-surface-2 p-1 no-scrollbar">
                {(['overview', 'route', 'notes', 'followups', ...(canViewPayments ? ['payments'] as const : []), ...(canSendEmails ? (['emails', 'roadmap'] as const) : [])] as const).map((t) => {
                  const count =
                    t === 'notes' ? notes.length
                    : t === 'followups' ? pendingFollowUps
                    : t === 'payments' ? leadPayments.length
                    : t === 'emails' ? (emailLog?.length ?? 0)
                    : 0;
                  const active = tab === t;
                  return (
                    <button key={t} onClick={() => setTab(t)}
                      className={cn(
                        'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
                        active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:bg-surface hover:text-ink-2'
                      )}>
                      {t === 'followups' ? 'Follow-ups' : t === 'emails' ? 'Emails' : t === 'roadmap' ? 'Roadmap' : t === 'route' ? 'Visa route' : t.charAt(0).toUpperCase() + t.slice(1)}
                      {count > 0 && (
                        <span className={cn(
                          'rounded-full px-1.5 py-[1px] text-[10px] font-bold tabular-nums',
                          active ? 'bg-[#EEF2FF] text-[#3730A3]' : 'bg-[#E8EAF0] text-[#6B7280]'
                        )}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {tab === 'overview' && (
                  <div className="space-y-1 mb-6">
                    <Row label="Pipeline">
                      <div style={{ maxWidth: 260 }}>
                        {(() => {
                          const defaultP = pl.pipelines.find((p) => p.is_default) || pl.pipelines[0];
                          const currentPid = effectiveLead.pipeline_id || defaultP?.id || '';
                          if (!pl.pipelines.length) return <span className="text-[12.5px] text-faint">—</span>;
                          return (
                            <Select<string>
                              value={currentPid}
                              onChange={(pid) => {
                                if (pid === currentPid) return;
                                // Moving pipelines resets the lead to the target's first stage.
                                const first = pl.stagesFor(pid)[0];
                                setLeadPending({ pipeline_id: pid, ...(first ? { stage: first.stage_key as Lead['stage'] } : {}) });
                              }}
                              options={pl.pipelines.map((p) => ({ value: p.id, label: p.name + (p.is_default ? ' (default)' : '') }))}
                              size="sm"
                            />
                          );
                        })()}
                      </div>
                    </Row>
                    <Row label="Stage">
                      <div style={{ maxWidth: 220 }}>
                        {(() => {
                          const defaultP = pl.pipelines.find((p) => p.is_default) || pl.pipelines[0];
                          const currentPid = effectiveLead.pipeline_id || defaultP?.id || '';
                          const pStages = currentPid ? pl.stagesFor(currentPid) : [];
                          // Custom pipelines: stage options come from the stages table.
                          // Fallback to the built-in six if pipelines haven't loaded.
                          if (pStages.length > 0) {
                            const known = pStages.some((s) => s.stage_key === effectiveLead.stage);
                            const options = pStages.map((s) => ({ value: s.stage_key, label: s.name, color: getStageColor(s.color).dot }));
                            if (!known) options.unshift({ value: effectiveLead.stage, label: effectiveLead.stage, color: '#9CA3AF' });
                            return (
                              <Select<string>
                                value={effectiveLead.stage}
                                onChange={(v) => {
                                  const target = pStages.find((s) => s.stage_key === v);
                                  const patch: Partial<Lead> = { stage: v as Lead['stage'] };
                                  if (target?.stage_type === 'won' && !effectiveLead.won_at) patch.won_at = new Date().toISOString();
                                  setLeadPending(patch);
                                }}
                                options={options}
                                size="sm"
                              />
                            );
                          }
                          return (
                            <Select<LeadStage>
                              value={effectiveLead.stage}
                              onChange={(v) => setLeadPending({ stage: v })}
                              options={(Object.keys(STAGE_META) as LeadStage[]).map((k) => ({ value: k, label: STAGE_META[k].label, color: STAGE_META[k].dot }))}
                              size="sm"
                            />
                          );
                        })()}
                      </div>
                    </Row>
                    {/* Special pricing sits directly under Stage — the two are
                        read together — but is a SEPARATE field on purpose. A
                        lead on a free case is still Hot, still in their WhatsApp
                        campaign, still counted in the funnel. Saves immediately
                        rather than joining the pending patch, because granting a
                        discount is a decision worth stamping with a time and a
                        name the moment it is made. */}
                    <Row label="Special offer">
                      <div style={{ maxWidth: 220 }}>
                        <Select<string>
                          value={effectiveLead.offer_type ?? 'none'}
                          onChange={(v) => {
                            if (v === (effectiveLead.offer_type ?? 'none')) return;
                            if (v === 'none') { setLeadOffer(effectiveLead.id, { type: null }); return; }
                            if (v === 'free') { setLeadOffer(effectiveLead.id, { type: 'free' }); return; }
                            setLeadOffer(effectiveLead.id, {
                              type: 'discount',
                              amount: effectiveLead.offer_amount ?? 500,
                              currency: effectiveLead.offer_currency ?? 'GBP',
                            });
                          }}
                          options={[
                            { value: 'none',     label: 'No offer',          color: '#D1D5DB' },
                            { value: 'discount', label: 'Discounted quote',  color: OFFER_META.discount.dot },
                            { value: 'free',     label: 'Free case',         color: OFFER_META.free.dot },
                          ]}
                          size="sm"
                        />
                      </div>
                    </Row>
                    {effectiveLead.offer_type === 'discount' && (
                      <Row label="Offer amount">
                        <div className="flex items-center gap-2">
                          <select
                            className="input py-1.5 px-2 text-[12px] w-auto"
                            value={effectiveLead.offer_currency ?? 'GBP'}
                            onChange={(e) => setLeadOffer(effectiveLead.id, {
                              type: 'discount',
                              amount: effectiveLead.offer_amount ?? 500,
                              currency: e.target.value as 'GBP' | 'INR' | 'USD',
                            })}
                          >
                            <option value="GBP">£ GBP</option>
                            <option value="INR">₹ INR</option>
                            <option value="USD">$ USD</option>
                          </select>
                          <input
                            type="number" min={0} step={50}
                            className="input py-1.5 px-2.5 w-28 text-[12px]"
                            defaultValue={effectiveLead.offer_amount ?? 500}
                            // onBlur, not onChange: saving on every keystroke would
                            // fire a write (and a toast) for "5", "50", "500".
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n) || n < 0) { e.target.value = String(effectiveLead.offer_amount ?? 500); return; }
                              if (n === effectiveLead.offer_amount) return;
                              setLeadOffer(effectiveLead.id, {
                                type: 'discount', amount: n,
                                currency: effectiveLead.offer_currency ?? 'GBP',
                              });
                            }}
                          />
                        </div>
                      </Row>
                    )}
                    {hasOffer(effectiveLead) && effectiveLead.offer_at && (
                      <Row label="Offer given">
                        <span className="text-[12px] text-muted">
                          {new Date(effectiveLead.offer_at).toLocaleDateString('en-IN')}
                          {effectiveLead.offer_by ? ` · ${memberNameById(effectiveLead.offer_by)}` : ''}
                        </span>
                      </Row>
                    )}
                    {/* Qualification (migration 074). One click each, set during
                        the call the consultant is already on. These are the
                        denominators of the Leads dashboard, so like the offer
                        they save IMMEDIATELY with a who/when stamp rather than
                        joining the pending patch. */}
                    <Row label="Profile received">
                      <div style={{ maxWidth: 220 }}>
                        <Select<string>
                          value={effectiveLead.profile_received ?? 'none'}
                          onChange={(v) => {
                            if (v === (effectiveLead.profile_received ?? 'none')) return;
                            setLeadQualification(effectiveLead.id, { profile: v === 'none' ? null : v as 'cv' | 'linkedin' | 'both' });
                          }}
                          options={[
                            { value: 'none',     label: 'Not received yet', color: '#D1D5DB' },
                            { value: 'cv',       label: 'CV / Resume',      color: '#4F46E5' },
                            { value: 'linkedin', label: 'LinkedIn',         color: '#0284C7' },
                            { value: 'both',     label: 'CV + LinkedIn',    color: '#047857' },
                          ]}
                          size="sm"
                        />
                        {(effectiveLead.profile_text || effectiveLead.profile_received) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {effectiveLead.profile_text && (
                              <button
                                onClick={() => setShowProfile(true)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink transition hover:bg-surface-2">
                                <FileText className="h-3.5 w-3.5" /> View profile
                              </button>
                            )}
                            {/* The permanent record (079): archived original if we
                                have it, the newest chat file if not, a printable
                                document from the extracted text as last resort. */}
                            <a
                              href={`/api/lead/cv/${effectiveLead.id}`}
                              target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink transition hover:bg-surface-2">
                              <Inbox className="h-3.5 w-3.5" /> Download CV
                            </a>
                          </div>
                        )}
                      </div>
                    </Row>
                    <Row label="Eligibility">
                      <div style={{ maxWidth: 220 }}>
                        <Select<string>
                          value={effectiveLead.eligibility ?? 'none'}
                          onChange={(v) => {
                            if (v === (effectiveLead.eligibility ?? 'none')) return;
                            setLeadQualification(effectiveLead.id, { eligibility: v === 'none' ? null : v as 'eligible' | 'not_eligible' });
                          }}
                          options={[
                            { value: 'none',         label: 'Not reviewed',  color: '#D1D5DB' },
                            { value: 'eligible',     label: 'Eligible',      color: '#047857' },
                            { value: 'not_eligible', label: 'Not eligible',  color: '#B91C1C' },
                          ]}
                          size="sm"
                        />
                        {effectiveLead.eligibility && effectiveLead.eligibility_at && (
                          <div className="mt-1 text-[11px] text-muted">
                            {effectiveLead.eligibility_source === 'derived'
                              ? 'Derived from stage history — one click above confirms it'
                              : effectiveLead.eligibility_source === 'ai'
                              ? 'AI verdict from the CV they sent — one click above confirms or overrides it'
                              : `${new Date(effectiveLead.eligibility_at).toLocaleDateString('en-IN')}${effectiveLead.eligibility_by ? ` · ${memberNameById(effectiveLead.eligibility_by)}` : ''}`}
                          </div>
                        )}
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
                    {/* Visa type used to live here as a pair of toggles. It moved to
                        the Visa route tab, which states the fee structure and the
                        journey that the setting actually changes — a two-click
                        switch in a details list was too quiet for a field that
                        rewrites the agreement, the process email and the invoice
                        labels. */}
                    <Row label="Industry">
                      <div style={{ maxWidth: 220 }}>
                        <Select<string>
                          value={effectiveLead.industry || ''}
                          onChange={(v) => setLeadPending({ industry: v || null })}
                          options={[
                            { value: '', label: 'Not set', color: 'hsl(var(--faint))' },
                            ...INDUSTRY_LIST.map((k) => ({ value: k, label: INDUSTRY_META[k].label, color: INDUSTRY_META[k].ring })),
                          ]}
                          size="sm"
                        />
                      </div>
                    </Row>
                    <Row label="Can invest">
                      <div className="flex items-center gap-1.5 py-1">
                        {READINESS_LIST.map((k) => {
                          const m = READINESS_META[k];
                          const on = effectiveLead.investment_readiness === k;
                          return (
                            <button key={k} type="button"
                              onClick={() => setLeadPending({ investment_readiness: on ? null : k })}
                              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold border transition-all"
                              style={on
                                ? { background: m.bg, color: m.fg, borderColor: m.dot }
                                : { background: 'hsl(var(--surface))', color: 'hsl(var(--muted))', borderColor: 'hsl(var(--border))' }}
                              title={m.label}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: on ? m.dot : 'hsl(var(--faint))' }} />{m.short}
                            </button>
                          );
                        })}
                        {!effectiveLead.investment_readiness && (
                          <span className="text-[11px] text-faint ml-1">not asked</span>
                        )}
                      </div>
                    </Row>
                    <Row label="Source">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-ink-2">{effectiveLead.source || '—'}</span>
                        {(effectiveLead.tags || []).includes('meta-lead') && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: '#EEF0FF', color: '#3C3489' }}>
                            AD FORM
                          </span>
                        )}
                      </div>
                    </Row>
                    <Row label="Phone">
                      <InlineText value={effectiveLead.phone} onChange={(v) => setLeadPending({ phone: v })} placeholder="+91…" />
                    </Row>
                    <Row label="Email">
                      <InlineText value={effectiveLead.email} onChange={(v) => setLeadPending({ email: v })} placeholder="email@…" />
                    </Row>
                    {canViewPayments && <>
                    <Row label="Currency">
                      <div className="flex gap-1.5">
                        {(['INR', 'GBP', 'USD'] as const).map((c) => (
                          <button key={c} type="button" onClick={() => setLeadPending({ currency: c })}
                            className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-semibold border transition', leadCurrency === c ? 'border-transparent' : 'border-border hover:bg-surface-2 text-muted')}
                            style={leadCurrency === c ? { background: '#EEF0FF', color: '#3C3489' } : undefined}>
                            <span className="text-[13px]">{c === 'INR' ? '₹' : c === 'GBP' ? '£' : '$'}</span> {c}
                          </button>
                        ))}
                      </div>
                    </Row>
                    <Row label="Total fee">
                      <InlineNumber
                        currency={leadCurrency}
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
                        currency={leadCurrency}
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
                        currency={leadCurrency}
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
                          {formatMoney(Math.max(0, (effectiveLead.amount_total || 0) - (effectiveLead.amount_paid || 0)), leadCurrency)}
                        </span>
                        <span className="text-[10.5px] text-faint ml-2">· total − paid</span>
                      </Row>
                    )}
                    </>}
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

                    {/* The answers in the person's own words. The two rows above
                        are what automation reads; this is the source they were
                        read from, so when a chip looks wrong the caller can see
                        why in one glance instead of asking someone to check
                        Meta. Rendered generically from the jsonb, so a question
                        added to the ad form appears here on its own. */}
                    {intakeAnswers.length > 0 && (
                      <div className="mt-5 rounded-xl border border-border overflow-hidden">
                        <div className="px-3.5 py-2 bg-surface-2 border-b border-border flex items-center gap-2">
                          <ClipboardList className="w-3.5 h-3.5 text-muted" />
                          <span className="text-[11.5px] font-semibold text-ink-2">Answers from the ad form</span>
                          <span className="text-[10.5px] text-faint ml-auto">as submitted</span>
                        </div>
                        <div className="divide-y divide-border">
                          {intakeAnswers.map((a) => (
                            <div key={a.key} className="grid grid-cols-[150px_1fr] gap-2 px-3.5 py-2.5">
                              <span className="text-[11.5px] text-muted">{a.label}</span>
                              <span className="text-[12.5px] text-ink-2">{a.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
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
                        notes.map((n) => {
                          // A note carried over from the Meetings module. It is
                          // labelled rather than blended in, so nobody wonders
                          // why a note they never typed is on the lead — and so
                          // they know to edit it on the meeting, not here.
                          const fromMeeting = Boolean(n.meeting_id);
                          const met = n.meeting?.starts_at;
                          return (
                          <div key={n.id} className={cn('rounded-xl border p-3.5', fromMeeting ? 'border-[#C7D2FE] bg-[#F8FAFF]' : 'border-border')}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="av" style={{ background: fromMeeting ? '#4F46E5' : avatarColor(n.author_id || 'unknown'), width: 22, height: 22, fontSize: 9 }}>
                                {fromMeeting && !n.author_id ? <CalendarClock className="w-3 h-3" /> : initials(memberNameById(n.author_id))}
                              </div>
                              <span className="text-[12px] font-semibold text-ink">{fromMeeting && !n.author_id ? 'Meeting' : memberNameById(n.author_id)}</span>
                              <span className="text-[11px] text-muted">· {timeAgo(n.created_at)}</span>
                              {fromMeeting && (
                                <span className="chip whitespace-nowrap" style={{ background: '#EEF2FF', color: '#3730A3', border: 'none', fontSize: 10 }}>
                                  <CalendarClock className="w-2.5 h-2.5" />
                                  {met ? `Meeting · ${new Date(met).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Meeting note'}
                                </span>
                              )}
                              <span className="text-[10.5px] text-faint ml-auto whitespace-nowrap">{new Date(n.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                            </div>
                            <div className="text-[12.5px] text-ink-2 leading-relaxed whitespace-pre-wrap pl-7">{n.body}</div>
                          </div>
                          );
                        })}
                    </div>
                  </>
                )}

                {tab === 'followups' && (
                  <>
                    <FollowUpScheduler
                      leadName={effectiveLead.full_name}
                      existing={leadFollowUps}
                      onSchedule={async (iso, title) => {
                        const created = await createFollowUp({ lead_id: lead.id, title, scheduled_at: iso, channel: 'call' });
                        if (created) {
                          playChime('done');
                          toast.success('Follow-up scheduled — you will hear a chime 15 minutes before');
                          return true;
                        }
                        toast.error('Could not schedule that');
                        return false;
                      }}
                    />
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
                          <PaymentRow key={p.id} payment={p} currency={leadCurrency} />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {tab === 'emails' && (
                  <div>
                    <div className="space-y-1 mb-4">
                    {canSendEmails && (
                    <div className="flex items-center gap-2 pb-3 mb-1 border-b border-border">
                      <span className="text-[11px] font-semibold text-muted uppercase tracking-wide mr-1">Client emails</span>
                      <button
                        onClick={() => { setSlaConfigOpen((o) => !o); setSlaEditMode(false); setSlaDiscount(''); }}
                        disabled={sendingEmail !== null || !effectiveLead.email}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-[#506BD8] bg-[#EEF2FF] hover:bg-[#506BD8] hover:text-white transition-all disabled:opacity-50"
                        title={effectiveLead.email ? 'Prepare and send the branded Service Agreement (optionally apply a discount)' : 'Add an email address first'}
                      >
                        <FileText className="w-3.5 h-3.5" /> {sendingEmail === 'sla' ? 'Sending…' : 'Send SLA'}
                      </button>
                      <button
                        onClick={() => sendEmail('onboarding')}
                        disabled={sendingEmail !== null || !effectiveLead.email}
                        className="group/onb inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-[#047857] bg-[#E6F7EE] hover:bg-[#047857] hover:text-white transition-all disabled:opacity-50"
                        title={effectiveLead.email ? 'Send the welcome/onboarding email (auto-sends on kickstart payment)' : 'Add an email address first'}
                      >
                        <Send className="w-3.5 h-3.5 transition-transform group-hover/onb:translate-x-[1px] group-hover/onb:-translate-y-[1px]" /> {sendingEmail === 'onboarding' ? 'Sending…' : 'Send onboarding'}
                      </button>
                      <button
                        onClick={() => sendEmail('process')}
                        disabled={sendingEmail !== null || !effectiveLead.email}
                        className="group/prc inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-[#B45309] bg-[#FEF3C7] hover:bg-[#B45309] hover:text-white transition-all disabled:opacity-50"
                        title={effectiveLead.email ? 'Send the visual "How it works" process email' : 'Add an email address first'}
                      >
                        <FileText className="w-3.5 h-3.5" /> {sendingEmail === 'process' ? 'Sending…' : 'How it works'}
                      </button>
                      <button
                        onClick={() => setDocEditor({ type: 'process' })}
                        disabled={sendingEmail !== null}
                        title="Review and edit before sending"
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#506BD8] bg-white border border-[#C7D0F0] hover:bg-[#EEF2FF] transition-all disabled:opacity-50"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    )}
                    {canSendEmails && slaConfigOpen && (
                      <div className="pb-3 mb-1 -mt-1 bg-[#F7F8FC] border border-border rounded-lg px-3 py-2.5">
                        {!slaEditMode ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12.5px] text-ink-2">Send the Service Agreement — standard fee <b>£3,000</b>. Any changes?</span>
                            <div className="ml-auto flex items-center gap-2">
                              <button
                                onClick={() => setSlaEditMode(true)}
                                disabled={sendingEmail !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-[#506BD8] bg-white border border-[#C7D0F0] hover:bg-[#EEF2FF] transition-all disabled:opacity-50"
                              >
                                <Pencil className="w-3.5 h-3.5" /> Edit amount
                              </button>
                              <button
                                onClick={() => setDocEditor({ type: 'sla' })}
                                disabled={sendingEmail !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-ink-2 bg-white border border-border hover:bg-surface-2 transition-all disabled:opacity-50"
                              >
                                <Eye className="w-3.5 h-3.5" /> Review &amp; edit
                              </button>
                              <button
                                onClick={() => sendEmail('sla')}
                                disabled={sendingEmail !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-all disabled:opacity-50"
                              >
                                <Send className="w-3.5 h-3.5" /> {sendingEmail === 'sla' ? 'Sending…' : 'No changes — Send'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-medium text-ink-2">Discount</span>
                            <div className="inline-flex items-center gap-1">
                              <span className="text-[12.5px] text-muted">£</span>
                              <input
                                autoFocus type="number" min="0" max="1500" step="50" value={slaDiscount}
                                onChange={(e) => setSlaDiscount(e.target.value)}
                                placeholder="0"
                                className="w-[84px] px-2 py-1 rounded-md border border-border bg-surface text-[12.5px] outline-none focus:border-[#4F46E5]"
                              />
                            </div>
                            <span className="text-[11.5px] text-faint">Net fee payable: <b className="text-ink-2">£{(3000 - Math.min(Math.max(Number(slaDiscount) || 0, 0), 1500)).toLocaleString('en-GB')}</b></span>
                            <div className="ml-auto flex items-center gap-2">
                              <button
                                onClick={() => { setSlaEditMode(false); setSlaDiscount(''); }}
                                disabled={sendingEmail !== null}
                                className="px-2.5 py-1.5 rounded-lg text-[12.5px] text-muted hover:bg-surface-2 transition-all disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => setDocEditor({ type: 'sla', discount: Math.min(Math.max(Number(slaDiscount) || 0, 0), 1500) })}
                                disabled={sendingEmail !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-ink-2 bg-white border border-border hover:bg-surface-2 transition-all disabled:opacity-50"
                              >
                                <Eye className="w-3.5 h-3.5" /> Review &amp; edit
                              </button>
                              <button
                                onClick={() => sendEmail('sla', Math.min(Math.max(Number(slaDiscount) || 0, 0), 1500))}
                                disabled={sendingEmail !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-all disabled:opacity-50"
                              >
                                <Send className="w-3.5 h-3.5" /> {sendingEmail === 'sla' ? 'Sending…' : 'Send with discount'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    </div>
                    {canSendEmails && (
                      <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
                        <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Write your own</span>
                        <button onClick={() => setComposeOpen(true)} disabled={!effectiveLead.email}
                          className="btn btn-primary btn-sm" title={effectiveLead.email ? 'Compose a free-form email — your signature is added automatically' : 'Add an email address first'}>
                          <Send className="w-3.5 h-3.5" /> Compose email
                        </button>
                      </div>
                    )}
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Conversation</div>
                    <LeadEmailThread rows={leadEmails} />
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Template email history</div>
                    <EmailHistory log={emailLog} memberNameById={memberNameById} />
                  </div>
                )}

                {tab === 'route' && effectiveLead && (
                  <VisaRouteTab
                    lead={effectiveLead}
                    canEdit={canSendEmails}
                    onSwitch={async (next) => {
                      // Persist immediately: the route drives documents and the
                      // case journey, so it should never sit in unsaved state.
                      await updateLead(lead.id, { visa_type: next });
                      setPendingLead((prev) => { const { visa_type: _drop, ...rest } = prev; return rest; });
                      toast.success(next === 'ifv' ? 'Moved to the Innovator Founder Visa' : 'Moved to the Global Talent Visa');
                    }}
                  />
                )}

                {tab === 'roadmap' && (
                  <RoadmapBuilder leadId={lead.id} clientEmail={effectiveLead?.email || null} onSent={refreshEmails} />
                )}

                {isDirty && <div className="h-20" />}
              </div>

              <div className="px-6 py-4 border-t border-border flex items-center gap-2 bg-surface-2">
                <a href={effectiveLead.phone ? `tel:${effectiveLead.phone}` : '#'} className={cn('btn btn-outline btn-sm', !effectiveLead.phone && 'opacity-50 pointer-events-none')}><Phone className="w-3.5 h-3.5" /> Call</a>
                <a href={effectiveLead.email ? `mailto:${effectiveLead.email}` : '#'} className={cn('btn btn-outline btn-sm', !effectiveLead.email && 'opacity-50 pointer-events-none')}><Mail className="w-3.5 h-3.5" /> Email</a>
                <button onClick={() => setTab('notes')} className="btn btn-outline btn-sm"><MessageSquare className="w-3.5 h-3.5" /> Note</button>
                {canViewPayments && <button onClick={() => onRecordPayment(lead.id)} className="btn btn-primary btn-sm ml-auto"><IndianRupee className="w-3.5 h-3.5" /> Record payment</button>}
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

      {lead && (
        <ComposeDialog open={composeOpen} leadId={lead.id} toEmail={effectiveLead?.email || ''} toName={effectiveLead?.full_name || ''}
          workspaceId={workspace.id} userId={appUser.id} onClose={() => setComposeOpen(false)} onSent={refreshEmails} />
      )}
      {showProfile && effectiveLead?.profile_text && (
        <ProfileModal lead={effectiveLead} onClose={() => setShowProfile(false)} />
      )}

      <DocEditorModal
        open={docEditor !== null}
        onClose={() => setDocEditor(null)}
        docLabel={docEditor?.type === 'sla' ? 'Service Agreement — review before sending' : '"How it works" email — review before sending'}
        recipient={lead?.email || ''}
        fetchPreview={fetchDocPreview}
        send={sendEditedDoc}
      />

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

// ── PROFILE MODAL (076) ──────────────────────────────────────────────────────
// The CV the lead sent was read once, judged, and DELETED — this text is what
// survives. Rendered from the stored markdown with a tiny renderer on purpose:
// no dependency, no surprises, works in both themes.
function ProfileModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const ai = (lead.profile_ai ?? null) as
    | { eligible?: boolean; route?: string; reason?: string; at?: string }
    | null;

  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <b key={i} className="font-semibold text-ink">{part.slice(2, -2)}</b>
        : <span key={i}>{part}</span>);

  const blocks = (lead.profile_text || '').split('\n').map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} className="h-2" />;
    if (/^#{1,3}\s/.test(t)) {
      return <h3 key={i} className="mt-4 mb-1.5 text-[13px] font-semibold uppercase tracking-[.04em] text-ink">
        {t.replace(/^#{1,3}\s*/, '')}
      </h3>;
    }
    if (/^[-*]\s/.test(t)) {
      return <div key={i} className="flex gap-2 pl-1 text-[13px] leading-[1.65] text-ink-2">
        <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-muted" />
        <span>{inline(t.replace(/^[-*]\s*/, ''))}</span>
      </div>;
    }
    return <p key={i} className="text-[13px] leading-[1.65] text-ink-2">{inline(t)}</p>;
  });

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: .18, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[84vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[18px] border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{lead.full_name} — profile</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              Extracted from the CV they sent on WhatsApp · the file itself was deleted after reading
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {ai && (
          <div className={cn('mx-5 mt-4 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-[1.55]',
            ai.eligible
              ? 'border-emerald-300/40 bg-emerald-500/[.07] text-emerald-700 dark:text-emerald-300'
              : 'border-amber-300/40 bg-amber-500/[.07] text-amber-700 dark:text-amber-300')}>
            <b className="font-semibold">
              {ai.eligible ? `Looks eligible — ${ai.route || 'Global Talent'}` : 'Not eligible for Global Talent as it stands'}
            </b>
            {ai.reason ? <span className="opacity-90"> · {ai.reason}</span> : null}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {blocks}
        </div>
      </motion.div>
    </div>
  );
}

function InlineText({ value, onChange, placeholder }: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  const commit = () => { setEditing(false); const t = v.trim(); if ((t || null) !== (value || null)) onChange(t || null); };
  if (editing) return <input className="input py-1.5 px-2.5 text-[12px]" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV(value || ''); setEditing(false); } }} placeholder={placeholder} />;
  return (
    <button onClick={() => setEditing(true)} title="Click to edit" className="group/it inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink hover:bg-surface-2 px-2 py-1 -mx-2 -my-1 rounded text-left">
      <span className="border-b border-dashed border-transparent group-hover/it:border-border-strong">{value || <span className="text-faint">{placeholder || '—'}</span>}</span>
      <Pencil className="w-3 h-3 text-faint opacity-0 group-hover/it:opacity-100 transition-opacity flex-shrink-0" />
    </button>
  );
}

function InlineNumber({ value, onChange, placeholder, currency = 'INR' }: { value: number | null; onChange: (v: number) => void; placeholder?: string; currency?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState((value ?? 0).toString());
  useEffect(() => setV((value ?? 0).toString()), [value]);
  const commit = () => {
    setEditing(false);
    const n = Math.max(0, Math.round(parseFloat(v) || 0));
    if (n !== (value || 0)) onChange(n);
  };
  if (editing) return <input type="number" min="0" className="input py-1.5 px-2.5 text-[12px] w-[140px] num" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setV((value ?? 0).toString()); setEditing(false); } }} placeholder={placeholder} />;
  return <button onClick={() => setEditing(true)} className="num font-semibold text-[13px] hover:text-ink hover:bg-surface-2 px-2 py-1 -mx-2 -my-1 rounded text-left">{formatMoney(value || 0, currency)}</button>;
}

// ===========================================================================
// EMAIL HISTORY — read-only log of every branded email sent to this client.
// Data comes from the `activity` table (action = 'email_sent').
// ===========================================================================
interface EmailLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  meta: {
    email_type?: 'onboarding' | 'sla' | 'invoice' | 'process' | 'campaign';
    subject?: string;
    invoice_no?: string;
    milestone?: string;
    discount?: number;
    payment_id?: string;
  } | null;
  created_at: string;
}

const EMAIL_KINDS: Record<string, { label: string; sub: string; bg: string; fg: string; icon: 'file' | 'send' | 'rupee' }> = {
  onboarding: { label: 'Onboarding Email', sub: 'Welcome & document checklist', bg: '#E6F7EE', fg: '#047857', icon: 'send' },
  sla:        { label: 'Service Agreement (SLA)', sub: 'Sent for acceptance', bg: '#EEF2FF', fg: '#4338CA', icon: 'file' },
  invoice:    { label: 'Invoice / Receipt', sub: 'Payment document', bg: '#FEF3C7', fg: '#B45309', icon: 'rupee' },
  process:    { label: 'How It Works (GTV)', sub: 'Process & pricing explainer', bg: '#FEF6E7', fg: '#B45309', icon: 'send' },
  campaign:   { label: 'Campaign Email', sub: 'Marketing / nurture', bg: '#F3EEFF', fg: '#7C3AED', icon: 'send' },
};

function EmailHistory({ log, memberNameById }: { log: EmailLogEntry[] | null; memberNameById: (id: string | null) => string }) {
  if (log === null) {
    return <div className="py-10 text-center text-[12.5px] text-muted">Loading email history…</div>;
  }
  if (log.length === 0) {
    return (
      <div className="text-center py-10 rounded-md border border-dashed border-border">
        <Inbox className="w-6 h-6 text-faint mx-auto mb-2" />
        <div className="text-[12.5px] text-muted mb-1">No emails sent yet</div>
        <div className="text-[11px] text-faint max-w-[280px] mx-auto">Onboarding, SLA, and invoice emails you send to this client will appear here with the date and sender.</div>
      </div>
    );
  }
  return (
    <>
      <div className="text-[11.5px] text-muted mb-3">
        {log.length} email{log.length === 1 ? '' : 's'} sent to this client · most recent first
      </div>
      <div className="relative pl-1">
        {log.map((e, i) => {
          const kind = EMAIL_KINDS[e.meta?.email_type || ''] || { label: 'Email', sub: '', bg: '#F4F4F6', fg: '#6B7280', icon: 'send' as const };
          const isPaidReceipt = e.meta?.email_type === 'invoice';
          const disc = e.meta?.discount;
          return (
            <div key={e.id} className="flex gap-3 pb-3 last:pb-0">
              {/* timeline rail */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: kind.bg }}>
                  {kind.icon === 'file' && <FileText className="w-4 h-4" style={{ color: kind.fg }} />}
                  {kind.icon === 'send' && <Send className="w-4 h-4" style={{ color: kind.fg }} />}
                  {kind.icon === 'rupee' && <IndianRupee className="w-4 h-4" style={{ color: kind.fg }} />}
                </div>
                {i < log.length - 1 && <div className="w-px flex-1 bg-border mt-1" style={{ minHeight: 14 }} />}
              </div>
              {/* card */}
              <div className="flex-1 min-w-0 bg-surface border border-border rounded-[10px] px-3.5 py-2.5 -mt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-ink">{kind.label}</span>
                  <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: kind.bg, color: kind.fg }}>SENT</span>
                  {typeof disc === 'number' && disc > 0 && (
                    <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#E6F7EE', color: '#047857' }}>−£{disc.toLocaleString('en-GB')} discount</span>
                  )}
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {e.meta?.email_type === 'campaign' && e.meta?.subject ? e.meta.subject : kind.sub}
                  {e.meta?.invoice_no ? ` · ${e.meta.invoice_no}` : ''}
                  {e.meta?.milestone ? ` · ${e.meta.milestone}` : ''}
                </div>
                <div className="text-[11px] text-faint mt-1.5 flex items-center gap-1.5">
                  <span>{new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {new Date(e.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
                  {e.user_id && <><span>·</span><span>by {memberNameById(e.user_id)}</span></>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}


// One-tap follow-up slots for the quick scheduler.
function quickSlots(): { label: string; iso: string }[] {
  const now = new Date();
  const slots: { label: string; iso: string }[] = [];
  // In 1 hour (rounded to next half hour)
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  inHour.setMinutes(inHour.getMinutes() < 30 ? 30 : 60, 0, 0);
  slots.push({ label: `In 1 hour (${fmtSlot(inHour)})`, iso: inHour.toISOString() });
  // Today 6 PM (only if still ahead)
  const today6 = new Date(now); today6.setHours(18, 0, 0, 0);
  if (today6.getTime() > now.getTime() + 10 * 60 * 1000) {
    slots.push({ label: 'Today 6 PM', iso: today6.toISOString() });
  }
  // Tomorrow 10 AM
  const tom10 = new Date(now); tom10.setDate(tom10.getDate() + 1); tom10.setHours(10, 0, 0, 0);
  slots.push({ label: 'Tomorrow 10 AM', iso: tom10.toISOString() });
  // In 3 days 10 AM
  const d3 = new Date(now); d3.setDate(d3.getDate() + 3); d3.setHours(10, 0, 0, 0);
  slots.push({ label: `${d3.toLocaleDateString('en-IN', { weekday: 'short' })} 10 AM`, iso: d3.toISOString() });
  return slots;
}
function fmtSlot(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
