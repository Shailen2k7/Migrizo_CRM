'use client';

// =============================================================================
// DOCUMENT CHECKLIST EMAIL — edit, preview, save as template, send.
//
// Left: the wording (subject + plain-text body) for the chosen visa.
// Right: a live preview built by the same renderer the server sends with, so
// what you see is what the client gets — logo header, footer and signature
// are fixed; only the words are yours.
//
// "Save template" stores the wording for every future checklist email of that
// visa (client_email_templates, migration 130). Sending without saving sends
// your edits once and leaves the template alone.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { X, Send, Save, RotateCcw, Loader2, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  CHECKLIST_DEFAULTS, checklistKey, renderChecklist,
  type ChecklistTemplate, type ChecklistVisa,
} from '@/lib/email/checklist';
import { DEFAULT_SIGNATURE, type EmailSignature } from '@/lib/email/custom';

interface Props {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  lead: { id: string; full_name: string | null; email: string | null };
  initialVisa: ChecklistVisa;
  workspaceId: string;
  userId: string;
}

const VISA_LABEL: Record<ChecklistVisa, string> = { gtv: 'Global Talent (GTV)', ifv: 'Innovator Founder (IFV)' };
const same = (a: ChecklistTemplate, b: ChecklistTemplate) => a.subject === b.subject && a.body === b.body;

export function ChecklistEmailModal({ open, onClose, onSent, lead, initialVisa, workspaceId, userId }: Props) {
  const [visa, setVisa] = useState<ChecklistVisa>(initialVisa);
  // What is stored (or the built-in default) vs what is in the editor now.
  const [saved, setSaved] = useState<Record<ChecklistVisa, ChecklistTemplate>>(CHECKLIST_DEFAULTS);
  const [custom, setCustom] = useState<Record<ChecklistVisa, boolean>>({ gtv: false, ifv: false });
  const [draft, setDraft] = useState<Record<ChecklistVisa, ChecklistTemplate>>(CHECKLIST_DEFAULTS);
  const [sig, setSig] = useState<EmailSignature>(DEFAULT_SIGNATURE);
  const [loading, setLoading] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVisa(initialVisa);
    let alive = true;
    setLoading(true);
    const supabase = createClient();
    Promise.all([
      supabase.from('client_email_templates').select('key, subject, body')
        .eq('workspace_id', workspaceId).in('key', [checklistKey('gtv'), checklistKey('ifv')]),
      supabase.from('email_signatures').select('signature')
        .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),
    ]).then(([tpl, s]) => {
      if (!alive) return;
      const next = { ...CHECKLIST_DEFAULTS };
      const isCustom = { gtv: false, ifv: false };
      if (tpl.error) setTableMissing(true);
      else {
        setTableMissing(false);
        for (const r of (tpl.data || []) as { key: string; subject: string; body: string }[]) {
          const v = r.key === checklistKey('ifv') ? 'ifv' : r.key === checklistKey('gtv') ? 'gtv' : null;
          if (v && r.body.trim()) { next[v] = { subject: r.subject, body: r.body }; isCustom[v] = true; }
        }
      }
      setSaved(next); setDraft(next); setCustom(isCustom);
      setSig({ ...DEFAULT_SIGNATURE, ...((s.data?.signature as Partial<EmailSignature>) || {}) });
      setLoading(false);
    });
    return () => { alive = false; };
  }, [open, initialVisa, workspaceId, userId]);

  const cur = draft[visa];
  const edited = !same(cur, saved[visa]);
  const isDefault = same(cur, CHECKLIST_DEFAULTS[visa]);
  const preview = useMemo(() => renderChecklist(lead, cur, sig), [lead, cur, sig]);

  const setField = (k: keyof ChecklistTemplate, v: string) => setDraft((d) => ({ ...d, [visa]: { ...d[visa], [k]: v } }));

  const save = async () => {
    if (tableMissing) { toast.error('Run the "client email templates" SQL in Supabase first, then try again'); return; }
    if (!cur.subject.trim() || !cur.body.trim()) { toast.error('Subject and message cannot be empty'); return; }
    setSaving(true);
    const { error } = await createClient().from('client_email_templates').upsert({
      workspace_id: workspaceId, key: checklistKey(visa), subject: cur.subject.trim(), body: cur.body.trim(),
      updated_by: userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,key' });
    setSaving(false);
    if (error) { toast.error(`Could not save: ${error.message}`); return; }
    const clean = { subject: cur.subject.trim(), body: cur.body.trim() };
    setSaved((s) => ({ ...s, [visa]: clean }));
    setDraft((d) => ({ ...d, [visa]: clean }));
    setCustom((c) => ({ ...c, [visa]: true }));
    toast.success(`${visa.toUpperCase()} checklist template saved — used for every future send`);
  };

  const send = async () => {
    if (!lead.email) { toast.error('This lead has no email address'); return; }
    if (!cur.subject.trim() || !cur.body.trim()) { toast.error('Subject and message cannot be empty'); return; }
    setSending(true);
    try {
      const res = await fetch('/api/email/checklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, visa, subject: cur.subject, body: cur.body }),
      });
      const j = await res.json().catch(() => null);
      if (j?.ok) { toast.success(`Document checklist sent to ${lead.email}`); onSent(); onClose(); }
      else toast.error(`Send failed${j?.reason ? `: ${j.reason}` : ''}`);
    } catch { toast.error('Send failed — check your connection'); }
    finally { setSending(false); }
  };

  if (!open) return null;
  const busy = saving || sending;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/45" onClick={() => !busy && onClose()} />
      <div className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-[1180px] h-[92vh] flex flex-col overflow-hidden">

        {/* header */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#E0F2FE] flex items-center justify-center flex-shrink-0">
            <ClipboardList className="w-4 h-4 text-[#0369A1]" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold truncate">Document checklist email</div>
            <div className="text-[11.5px] text-muted truncate">To {lead.email || '—'}</div>
          </div>
          <div className="ml-auto flex items-center gap-1 p-0.5 rounded-lg bg-surface-2 border border-border">
            {(['gtv', 'ifv'] as ChecklistVisa[]).map((v) => (
              <button key={v} onClick={() => setVisa(v)} disabled={busy}
                className={cn('px-3 py-1 rounded-md text-[12px] font-semibold transition-all',
                  visa === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                {VISA_LABEL[v]}
              </button>
            ))}
          </div>
          <button onClick={() => !busy && onClose()} className="p-1.5 text-faint hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* editor */}
          <div className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-border p-4 sm:p-5 gap-3 overflow-y-auto">
            {tableMissing && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                Saving templates needs a one-time SQL step in Supabase. You can still edit and send — edits just won&apos;t be kept.
              </div>
            )}
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className={cn('px-2 py-0.5 rounded-full font-semibold',
                custom[visa] ? 'bg-[#E6F7EE] text-[#047857]' : 'bg-surface-2 text-muted')}>
                {custom[visa] ? 'Your saved template' : 'Built-in default'}
              </span>
              {edited && <span className="px-2 py-0.5 rounded-full font-semibold bg-[#FEF3C7] text-[#B45309]">Unsaved edits</span>}
            </div>

            <label className="block">
              <span className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Subject</span>
              <input value={cur.subject} onChange={(e) => setField('subject', e.target.value)} disabled={loading || busy}
                className="mt-1 w-full text-[13px] px-3 py-2 rounded-lg border border-border bg-surface outline-none focus:border-indigo-400" />
            </label>

            <label className="flex-1 flex flex-col min-h-[260px]">
              <span className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Message</span>
              <textarea value={cur.body} onChange={(e) => setField('body', e.target.value)} disabled={loading || busy}
                spellCheck
                className="mt-1 flex-1 w-full text-[13px] leading-[1.6] px-3 py-2.5 rounded-lg border border-border bg-surface outline-none focus:border-indigo-400 resize-none font-[inherit]" />
            </label>

            <div className="text-[11px] text-muted leading-relaxed bg-surface-2 rounded-lg px-3 py-2">
              <b>{'{first_name}'}</b> / <b>{'{full_name}'}</b> fill in the client&apos;s name ·
              lines starting <b>1.</b> <b>2.</b> become the numbered checklist · <b>-</b> makes a tick-box item ·
              a blank line starts a new paragraph. Logo, footer and your signature are added automatically.
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={save} disabled={loading || busy || !edited}
                title={edited ? 'Keep this wording for every future checklist email' : 'No changes to save'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-[#047857] bg-[#E6F7EE] hover:bg-[#047857] hover:text-white transition-all disabled:opacity-40 disabled:hover:bg-[#E6F7EE] disabled:hover:text-[#047857]">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save template
              </button>
              {edited && (
                <button onClick={() => setDraft((d) => ({ ...d, [visa]: saved[visa] }))} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-muted hover:text-ink hover:bg-surface-2 transition-all">
                  <RotateCcw className="w-3.5 h-3.5" /> Undo edits
                </button>
              )}
              {!isDefault && (
                <button onClick={() => setDraft((d) => ({ ...d, [visa]: CHECKLIST_DEFAULTS[visa] }))} disabled={busy}
                  title="Put the original wording back in the editor (press Save template to keep it)"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-muted hover:text-ink hover:bg-surface-2 transition-all">
                  Use original wording
                </button>
              )}
            </div>
          </div>

          {/* live preview */}
          <div className="flex flex-col min-h-0 bg-[#F0F1F4]">
            <div className="px-4 py-2 border-b border-border bg-surface text-[12px] flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Preview</span>
              <span className="truncate text-ink-2 font-medium">{preview.subject}</span>
            </div>
            <div className="flex-1 min-h-0 relative">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center text-muted text-[13px] bg-[#F0F1F4] z-[1]">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading template…
                </div>
              )}
              <iframe title="Checklist email preview" srcDoc={preview.html} sandbox="" className="w-full h-full border-0 bg-white" />
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-t border-border flex-shrink-0">
          <div className="text-[11.5px] text-muted">
            {edited ? 'Your edits will be sent as shown. Press Save template too if you want to keep them.' : 'Sends exactly what you see in the preview.'}
          </div>
          <button onClick={send} disabled={loading || busy || !lead.email}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[#0369A1] hover:bg-[#075985] transition-all disabled:opacity-50">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {sending ? 'Sending…' : 'Send to client'}
          </button>
        </div>
      </div>
    </div>
  );
}
