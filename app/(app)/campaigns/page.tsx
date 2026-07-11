'use client';

// =============================================================================
// CAMPAIGN SEND FLOW — reached ONLY from the Pipeline (no sidebar entry).
// Steps: recipients (preselected on the board) → template (built-in + custom,
// with add/edit/delete) → edit & PREVIEW (mandatory) → send.
// =============================================================================
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { CAMPAIGN_TEMPLATES, TEMPLATE_BY_KEY } from '@/lib/email/campaign-templates';
import { Send, Pencil, Eye, ChevronLeft, CheckCircle2, Loader2, Plus, Trash2, Copy, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CustomTemplate { id: string; name: string; track: string; subject: string; html: string; }
type Step = 'template' | 'edit' | 'review';

export default function CampaignsPage() {
  const { leads, role, workspace } = useApp();
  const router = useRouter();
  const [step, setStep] = useState<Step>('template');
  const [ids, setIds] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomTemplate[]>([]);
  const [srcKind, setSrcKind] = useState<'builtin' | 'custom'>('builtin');
  const [srcKey, setSrcKey] = useState('');           // builtin key or custom id
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');               // editable body HTML ({{name}}, {{UNSUB}})
  const [previewName, setPreviewName] = useState('Rahul');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ queued: number; skipped: number } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false); // template manager editor
  const [editing, setEditing] = useState<CustomTemplate | null>(null);

  // recipients handed over from the Pipeline selection
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('campaign_preselect');
      if (raw) { const v: string[] = JSON.parse(raw); if (Array.isArray(v)) setIds(v); }
    } catch { /* ignore */ }
  }, []);
  const recipients = useMemo(() => {
    const set = new Set(ids);
    return leads.filter((l) => set.has(l.id) && l.email && l.email.includes('@'));
  }, [leads, ids]);

  // load custom templates
  const loadCustom = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.from('email_templates')
      .select('id, name, track, subject, html')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false });
    setCustom((data as CustomTemplate[]) || []);
  }, [workspace.id]);
  useEffect(() => { void loadCustom(); }, [loadCustom]);

  if (role !== 'admin') {
    return <div className="max-w-[900px] mx-auto px-6 py-20 text-center text-muted">Campaigns are available to workspace admins.</div>;
  }

  // ---- choose a template → move to edit+preview ----
  function choose(kind: 'builtin' | 'custom', key: string) {
    setSrcKind(kind); setSrcKey(key);
    if (kind === 'builtin') {
      const t = TEMPLATE_BY_KEY[key];
      setSubject(t.subject); setHtml(t.build('{{name}}'));
    } else {
      const t = custom.find((c) => c.id === key)!;
      setSubject(t.subject); setHtml(t.html);
    }
    setStep('edit');
  }

  // ---- template manager: save / delete custom ----
  async function saveTemplate(t: Partial<CustomTemplate> & { name: string; subject: string; html: string }) {
    const supabase = createClient();
    if (t.id) {
      const { error } = await supabase.from('email_templates')
        .update({ name: t.name, subject: t.subject, html: t.html, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Template updated');
    } else {
      const { error } = await supabase.from('email_templates')
        .insert({ workspace_id: workspace.id, name: t.name, track: 'Custom', subject: t.subject, html: t.html });
      if (error) { toast.error(error.message); return; }
      toast.success('Template added');
    }
    setEditorOpen(false); setEditing(null);
    void loadCustom();
  }
  async function deleteTemplate(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('email_templates').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Template deleted');
    void loadCustom();
  }

  // ---- launch ----
  async function launch() {
    setSending(true);
    try {
      const res = await fetch('/api/campaigns/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: srcKind === 'builtin' ? TEMPLATE_BY_KEY[srcKey]?.name : custom.find((c) => c.id === srcKey)?.name,
          templateKey: srcKind === 'builtin' ? srcKey : 'custom',
          subject, html, leadIds: recipients.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!data.ok) { toast.error(`Could not start: ${data.reason || 'error'}`); setSending(false); return; }
      setSent({ queued: data.queued, skipped: data.skipped });
      sessionStorage.removeItem('campaign_preselect');
    } catch { toast.error('Network error'); }
    setSending(false);
  }

  const previewHtml = html
    .replace(/\{\{\s*name\s*\}\}/gi, previewName || 'there')
    .replace(/\{\{\s*UNSUB\s*\}\}/gi, '<a style="color:#8FA0C4;text-decoration:underline;">Unsubscribe</a>');

  // ---- SENT ----
  if (sent) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-16 text-center animate-pageIn">
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7 text-emerald-600" /></div>
        <h1 className="text-[22px] font-bold text-ink mb-2">Campaign started</h1>
        <p className="text-[14px] text-muted mb-1">Queued <b className="text-ink">{sent.queued}</b> emails. They send gradually in the background to protect your domain.</p>
        {sent.skipped > 0 && <p className="text-[12.5px] text-muted">{sent.skipped} skipped (no email, duplicate, or unsubscribed).</p>}
        <p className="text-[12.5px] text-muted mt-2 mb-6">Each send appears in the lead's Emails tab.</p>
        <button onClick={() => router.push('/pipeline')} className="btn btn-primary mx-auto"><ArrowLeft className="w-4 h-4" /> Back to Pipeline</button>
      </div>
    );
  }

  // no recipients → guide back to pipeline
  if (recipients.length === 0) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-16 text-center animate-pageIn">
        <h1 className="text-[20px] font-bold text-ink mb-2">No leads selected</h1>
        <p className="text-[13.5px] text-muted mb-6">Select leads on the Pipeline first — tick the checkbox on any card or in a column header, then hit "Choose template &amp; send".</p>
        <button onClick={() => router.push('/pipeline')} className="btn btn-primary mx-auto"><ArrowLeft className="w-4 h-4" /> Go to Pipeline</button>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-16 animate-pageIn">
      <button onClick={() => (step === 'template' ? router.push('/pipeline') : setStep(step === 'review' ? 'edit' : 'template'))} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink mb-3">
        <ChevronLeft className="w-4 h-4" />{step === 'template' ? 'Back to Pipeline' : 'Back'}
      </button>
      <div className="flex items-center gap-2.5 mb-1"><Send className="w-5 h-5 text-indigo" /><h1 className="text-[22px] font-bold text-ink">Email {recipients.length} selected lead{recipients.length === 1 ? '' : 's'}</h1></div>
      <p className="text-[13px] text-muted mb-6">{step === 'template' ? 'Pick a template — or create and manage your own.' : step === 'edit' ? 'Edit the subject and content, and check the live preview.' : 'Final check before sending.'}</p>

      {/* STEP: TEMPLATE PICKER + MANAGER */}
      {step === 'template' && (
        <div className="animate-fadeIn">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-[15px] font-semibold text-ink">Templates</h2>
            <button onClick={() => { setEditing(null); setEditorOpen(true); }} className="btn btn-outline btn-sm"><Plus className="w-3.5 h-3.5" /> New template</button>
          </div>
          {custom.length > 0 && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">Your templates</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {custom.map((t) => (
                  <div key={t.id} className="panel px-4 py-3.5 hover:border-indigo transition group relative">
                    <button onClick={() => choose('custom', t.id)} className="text-left w-full">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5 inline-block mb-1">Custom</div>
                      <div className="text-[13.5px] font-semibold text-ink group-hover:text-indigo pr-14">{t.name}</div>
                      <div className="text-[12px] text-muted mt-0.5 truncate pr-14">{t.subject}</div>
                    </button>
                    <div className="absolute top-3 right-3 flex gap-1">
                      <button onClick={() => { setEditing(t); setEditorOpen(true); }} className="p-1.5 rounded-md hover:bg-surface-2 text-muted hover:text-ink" title="Edit template"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { if (confirm(`Delete "${t.name}"?`)) void deleteTemplate(t.id); }} className="p-1.5 rounded-md hover:bg-red-50 text-muted hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-2">Library</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CAMPAIGN_TEMPLATES.map((t) => (
              <div key={t.key} className="panel px-4 py-3.5 hover:border-indigo transition group relative">
                <button onClick={() => choose('builtin', t.key)} className="text-left w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-indigo bg-indigo-soft rounded px-1.5 py-0.5">{t.track}</span>
                    {t.temperature !== 'any' && <span className="text-[10px] text-muted">{t.temperature === 'hot' ? '🔥 hot' : '❄️ cold'}</span>}
                  </div>
                  <div className="text-[13.5px] font-semibold text-ink group-hover:text-indigo pr-10">{t.subject}</div>
                </button>
                <button
                  onClick={() => { setEditing({ id: '', name: `${t.name} (copy)`, track: 'Custom', subject: t.subject, html: t.build('{{name}}') }); setEditorOpen(true); }}
                  className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-surface-2 text-muted hover:text-ink" title="Duplicate into an editable custom template"
                ><Copy className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP: EDIT + LIVE PREVIEW */}
      {step === 'edit' && (
        <div className="animate-fadeIn grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink mb-3 flex items-center gap-2"><Pencil className="w-4 h-4" />Edit</h2>
            <label className="block text-[12px] font-medium text-muted mb-1">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-[13.5px] mb-1 focus:border-indigo outline-none" />
            <div className={cn('text-[11px] mb-3', subject.length > 50 ? 'text-amber-600' : 'text-faint')}>{subject.length} chars{subject.length > 50 ? ' · keep under 50' : ''}</div>
            <label className="block text-[12px] font-medium text-muted mb-1">Body HTML <span className="text-faint">({'{{name}}'} = first name)</span></label>
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false}
              className="w-full h-[300px] px-3 py-2.5 border border-border rounded-lg text-[11px] font-mono leading-relaxed focus:border-indigo outline-none resize-y mb-3" />
            <label className="block text-[12px] font-medium text-muted mb-1">Preview with name</label>
            <input value={previewName} onChange={(e) => setPreviewName(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg text-[13px] mb-4 focus:border-indigo outline-none" />
            <button onClick={() => setStep('review')} className="btn btn-primary w-full justify-center">Continue to final review →</button>
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-ink mb-3 flex items-center gap-2"><Eye className="w-4 h-4" />Live preview <span className="text-[11px] text-muted font-normal">exactly what the client receives</span></h2>
            <div className="border border-border rounded-xl overflow-hidden bg-white">
              <div className="px-4 py-2.5 border-b border-border bg-surface-2 text-[12px]"><span className="text-muted">Subject:</span> <b className="text-ink">{subject.replace(/\{\{\s*name\s*\}\}/gi, previewName)}</b></div>
              <iframe title="preview" className="w-full" style={{ height: 600, border: 0 }} srcDoc={previewHtml} />
            </div>
          </div>
        </div>
      )}

      {/* STEP: REVIEW (final preview + send) */}
      {step === 'review' && (
        <div className="animate-fadeIn grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
          <div>
            <div className="panel divide-y divide-border mb-4">
              <div className="px-4 py-3 flex justify-between text-[13px]"><span className="text-muted">Recipients</span><b className="text-ink">{recipients.length} leads</b></div>
              <div className="px-4 py-3 flex justify-between gap-4 text-[13px]"><span className="text-muted flex-shrink-0">Subject</span><b className="text-ink text-right">{subject.replace(/\{\{\s*name\s*\}\}/gi, previewName)}</b></div>
            </div>
            <div className="panel max-h-[220px] overflow-y-auto mb-4">
              {recipients.slice(0, 100).map((l) => (
                <div key={l.id} className="px-4 py-2 border-b border-border last:border-0 flex justify-between text-[12px]">
                  <span className="text-ink">{l.full_name}</span><span className="text-muted">{l.email}</span>
                </div>
              ))}
              {recipients.length > 100 && <div className="px-4 py-2 text-[11.5px] text-muted">+ {recipients.length - 100} more…</div>}
            </div>
            <div className="panel px-4 py-3 mb-4 text-[12px] text-muted leading-relaxed bg-amber-50 border-amber-200">
              Sends gradually (≈40/min) with each recipient's first name and an unsubscribe link. Unsubscribed and duplicate emails are skipped.
            </div>
            <button disabled={sending} onClick={launch} className="btn btn-primary w-full justify-center py-3">
              {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Send className="w-4 h-4" /> Send to {recipients.length} leads</>}
            </button>
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-ink mb-2">Final preview</h2>
            <div className="border border-border rounded-xl overflow-hidden bg-white">
              <iframe title="final" className="w-full" style={{ height: 620, border: 0 }} srcDoc={previewHtml} />
            </div>
          </div>
        </div>
      )}

      {/* TEMPLATE EDITOR MODAL (add / edit custom) */}
      {editorOpen && (
        <TemplateEditor
          initial={editing}
          onSave={saveTemplate}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({ initial, onSave, onClose }: {
  initial: CustomTemplate | null;
  onSave: (t: { id?: string; name: string; subject: string; html: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [subject, setSubject] = useState(initial?.subject || '');
  const [html, setHtml] = useState(initial?.html || '');
  const [previewName] = useState('Rahul');
  const previewHtml = html
    .replace(/\{\{\s*name\s*\}\}/gi, previewName)
    .replace(/\{\{\s*UNSUB\s*\}\}/gi, '<a style="color:#8FA0C4;text-decoration:underline;">Unsubscribe</a>');
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-[1050px] max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-bold text-ink">{initial?.id ? 'Edit template' : 'New template'}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-[13px]">Close</button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <label className="block text-[12px] font-medium text-muted mb-1">Template name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-[13.5px] mb-3 focus:border-indigo outline-none" placeholder="e.g. Diwali special offer" />
            <label className="block text-[12px] font-medium text-muted mb-1">Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-[13.5px] mb-3 focus:border-indigo outline-none" />
            <label className="block text-[12px] font-medium text-muted mb-1">Body HTML <span className="text-faint">({'{{name}}'} = first name, {'{{UNSUB}}'} = unsubscribe)</span></label>
            <textarea value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false}
              className="w-full h-[340px] px-3 py-2.5 border border-border rounded-lg text-[11px] font-mono leading-relaxed focus:border-indigo outline-none resize-y mb-4"
              placeholder="Paste or write email-safe HTML here. Tip: duplicate a library template to start from a polished design." />
            <button
              onClick={() => { if (!name.trim() || !subject.trim() || !html.trim()) { toast.error('Name, subject and body are required'); return; } onSave({ id: initial?.id || undefined, name: name.trim(), subject: subject.trim(), html }); }}
              className="btn btn-primary w-full justify-center"
            >{initial?.id ? 'Save changes' : 'Add template'}</button>
          </div>
          <div>
            <div className="text-[12px] font-medium text-muted mb-1">Live preview</div>
            <div className="border border-border rounded-xl overflow-hidden bg-white">
              <iframe title="tpl-preview" className="w-full" style={{ height: 520, border: 0 }} srcDoc={previewHtml || '<div style="padding:40px;font-family:sans-serif;color:#9AA0AC;text-align:center;">Start typing HTML to see the preview</div>'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
