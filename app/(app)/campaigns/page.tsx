'use client';

// =============================================================================
// CAMPAIGN CENTER — super-admin only.
//
// Four tabs:
//   Send      → pick recipients' templates, edit content, preview, launch
//   Templates → the GTV library (4 cold + 5 hot, seeded) + custom. Everything
//               is editable including the subject; templates hold CONTENT ONLY
//               and the branded frame (logo, GTV badge, Shailen's signature,
//               booking CTA, unsubscribe button) is applied automatically, so
//               every email keeps the same format.
//   History   → every campaign with live counts + Pause / Resume / Stop
//   Access    → the owner can grant campaign rights to other members
//
// Access: workspaces.owner_id (the super admin) or an explicit grant. Checked
// by RPC here AND enforced by RLS + the create API server-side.
// =============================================================================
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { wrapCampaignEmail } from '@/lib/email/campaign-shell';
import RichEmailEditor, { sanitizeEmailHtml } from '@/components/rich-email-editor';
import AutomationPanel from '@/components/automation-panel';
import {
  Send, Eye, CheckCircle2, Loader2, Plus, Trash2, ArrowLeft, X,
  Megaphone, FileText, History, ShieldCheck, Pause, Play, Square, Pencil, Users, Workflow,
} from 'lucide-react';
import { cn, initials, avatarColor } from '@/lib/utils';
import { toast } from 'sonner';

interface Tpl { id: string; name: string; track: string; category: string; sort: number; is_seeded: boolean; subject: string; html: string }
interface Camp { id: string; name: string; subject: string; status: string; total: number; sent: number; failed: number; created_at: string }
type Tab = 'send' | 'automation' | 'templates' | 'history' | 'access';
type SendStep = 'recipients' | 'template' | 'edit' | 'review';

const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  cold: { label: 'COLD SEQUENCE', color: '#0E7490', bg: '#ECFEFF' },
  hot: { label: 'HOT SEQUENCE', color: '#B91C1C', bg: '#FEF2F2' },
  custom: { label: 'CUSTOM', color: '#6B7280', bg: '#F4F6FA' },
};

export default function CampaignCenterPage() {
  const app = useApp() as ReturnType<typeof useApp> & {
    workspace: { id: string }; user: { id: string };
    members: { user_id: string; full_name: string; role: string; status: string }[];
  };
  const { leads, workspace, user, members } = app;
  const router = useRouter();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('send');
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [camps, setCamps] = useState<Camp[]>([]);
  const [grants, setGrants] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(false);

  // send flow state
  const [step, setStep] = useState<SendStep>('recipients');
  const [ids, setIds] = useState<string[]>([]);
  const [pickSearch, setPickSearch] = useState('');
  const [srcId, setSrcId] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [previewName, setPreviewName] = useState('Rahul');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ queued: number; skipped: number } | null>(null);

  // template editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Tpl> | null>(null);
  const [tplPreview, setTplPreview] = useState(false);
  // The editor works in ordinary text; HTML is produced only on save.
  const [plainBody, setPlainBody] = useState('');

  // ── boot: check access, seed defaults, load everything ──
  const loadAll = useCallback(async () => {
    const supabase = createClient();
    const [{ data: t }, { data: c }, { data: g }, { data: ws }] = await Promise.all([
      supabase.from('email_templates').select('id, name, track, category, sort, is_seeded, subject, html')
        .eq('workspace_id', workspace.id).order('sort').order('created_at'),
      supabase.from('campaigns').select('id, name, subject, status, total, sent, failed, created_at')
        .eq('workspace_id', workspace.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('campaign_access').select('user_id').eq('workspace_id', workspace.id),
      supabase.from('workspaces').select('owner_id').eq('id', workspace.id).single(),
    ]);
    setTpls((t as Tpl[]) || []);
    setCamps((c as Camp[]) || []);
    setGrants(((g as { user_id: string }[]) || []).map((x) => x.user_id));
    setIsOwner(ws?.owner_id === user.id);
  }, [workspace.id, user.id]);

  useEffect(() => {
    let gone = false;
    (async () => {
      const supabase = createClient();
      const { data: ok } = await supabase.rpc('is_campaign_admin', { p_workspace_id: workspace.id });
      if (gone) return;
      setAllowed(!!ok);
      if (!ok) return;
      // Seed the 9 GTV templates once; harmless no-op after that.
      await supabase.rpc('seed_campaign_templates', { p_workspace_id: workspace.id });
      // Recipients preselected on the Pipeline board, if any.
      try {
        const raw = sessionStorage.getItem('campaign_preselect');
        if (raw) { const v: string[] = JSON.parse(raw); if (Array.isArray(v) && v.length) { setIds(v); setStep('template'); } }
      } catch { /* ignore */ }
      await loadAll();
    })();
    return () => { gone = true; };
  }, [workspace.id, loadAll]);

  const recipients = useMemo(() => {
    const set = new Set(ids);
    return leads.filter((l) => set.has(l.id) && l.email && l.email.includes('@'));
  }, [leads, ids]);

  const emailable = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    return leads
      .filter((l) => l.email && l.email.includes('@'))
      .filter((l) => !q || (l.full_name || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q));
  }, [leads, pickSearch]);

  // ── template ops ──
  async function saveTpl() {
    const body = sanitizeEmailHtml(plainBody);
    if (!editing?.name?.trim() || !editing?.subject?.trim() || !body.trim()) {
      toast.error('Name, subject and content are all required'); return;
    }
    editing.html = body;
    const supabase = createClient();
    if (editing.id) {
      const { error } = await supabase.from('email_templates')
        .update({ name: editing.name, subject: editing.subject, html: body, updated_at: new Date().toISOString() })
        .eq('id', editing.id);
      if (error) { toast.error(error.message); return; }
      toast.success('Template saved');
    } else {
      const { error } = await supabase.from('email_templates')
        .insert({ workspace_id: workspace.id, name: editing.name, track: 'Custom', category: 'custom', sort: 100, subject: editing.subject, html: body });
      if (error) { toast.error(error.message); return; }
      toast.success('Template added');
    }
    setEditorOpen(false); setEditing(null); setTplPreview(false); setPlainBody('');
    void loadAll();
  }
  async function deleteTpl(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('email_templates').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Template deleted');
    void loadAll();
  }

  // ── campaign controls ──
  async function setCampStatus(id: string, status: 'sending' | 'paused' | 'stopped') {
    const supabase = createClient();
    const { error } = await supabase.from('campaigns').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    if (status === 'stopped') {
      // Stopping also clears the remaining queue so it can never resume by accident.
      await supabase.from('campaign_recipients').update({ status: 'skipped', error: 'campaign stopped' })
        .eq('campaign_id', id).eq('status', 'queued');
    }
    toast.success(status === 'paused' ? 'Campaign paused — queued emails are on hold' : status === 'sending' ? 'Campaign resumed' : 'Campaign stopped');
    void loadAll();
  }

  // ── access ──
  async function toggleGrant(memberId: string) {
    const supabase = createClient();
    if (grants.includes(memberId)) {
      const { error } = await supabase.from('campaign_access').delete().eq('workspace_id', workspace.id).eq('user_id', memberId);
      if (error) { toast.error(error.message); return; }
      toast.success('Access removed');
    } else {
      const { error } = await supabase.from('campaign_access').insert({ workspace_id: workspace.id, user_id: memberId, granted_by: user.id });
      if (error) { toast.error(error.message); return; }
      toast.success('Access granted');
    }
    void loadAll();
  }

  // ── launch ──
  async function launch() {
    setSending(true);
    try {
      const res = await fetch('/api/campaigns/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tpls.find((t) => t.id === srcId)?.name || subject,
          templateKey: srcId || 'custom',
          subject, html: sanitizeEmailHtml(content), leadIds: recipients.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!data.ok) { toast.error(`Could not start: ${data.reason || 'error'}`); setSending(false); return; }
      setSent({ queued: data.queued, skipped: data.skipped });
      sessionStorage.removeItem('campaign_preselect');
      void loadAll();
    } catch { toast.error('Network error'); }
    setSending(false);
  }

  // `c` is editor HTML; sanitise to the safe tag set before framing it.
  const previewHtml = (c: string) => wrapCampaignEmail(
    sanitizeEmailHtml(c).replace(/\{\{\s*name\s*\}\}/gi, previewName || 'there'), subject
  ).replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, '#');

  // ── gates ──
  if (allowed === null) {
    return <div className="py-20 text-center text-[13px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Checking access…</div>;
  }
  if (!allowed) {
    return (
      <div className="max-w-[600px] mx-auto px-6 py-20 text-center">
        <ShieldCheck className="w-8 h-8 mx-auto text-faint mb-3" />
        <div className="text-[15px] font-semibold">Campaigns are restricted</div>
        <div className="text-[13px] text-muted mt-1">Only the workspace owner can run email campaigns. Ask them to grant you access from the Campaign Center.</div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-16 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7 text-emerald-600" /></div>
        <h1 className="text-[22px] font-bold mb-2">Campaign started</h1>
        <p className="text-[14px] text-muted mb-1">Queued <b className="text-ink">{sent.queued}</b> emails. They send gradually in the background to protect your domain.</p>
        {sent.skipped > 0 && <p className="text-[12.5px] text-muted">{sent.skipped} skipped (no email, duplicate, or unsubscribed).</p>}
        <div className="flex gap-2 justify-center mt-6">
          <button onClick={() => { setSent(null); setTab('history'); setStep('recipients'); setIds([]); }} className="btn btn-primary"><History className="w-4 h-4" /> View in History</button>
          <button onClick={() => router.push('/pipeline')} className="btn"><ArrowLeft className="w-4 h-4" /> Pipeline</button>
        </div>
      </div>
    );
  }

  const TABS: { key: Tab; label: string; Icon: typeof Send; ownerOnly?: boolean }[] = [
    { key: 'send', label: 'Send', Icon: Megaphone },
    { key: 'automation', label: 'Automation', Icon: Workflow },
    { key: 'templates', label: 'Templates', Icon: FileText },
    { key: 'history', label: 'History', Icon: History },
    { key: 'access', label: 'Access', Icon: ShieldCheck, ownerOnly: true },
  ];

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center"><Megaphone className="w-4 h-4" /></span>
        Campaign Center
      </h1>
      <p className="text-[13px] text-muted mt-1">One off sends and self running sequences, in one place. Every email carries the same frame, signature, booking link and one click unsubscribe.</p>

      {/* tabs */}
      <div className="flex gap-1.5 mt-5 border-b border-border pb-0 flex-wrap">
        {TABS.filter((t) => !t.ownerOnly || isOwner).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2.5 rounded-t-lg border-b-2 -mb-px transition-colors',
              tab === key ? 'border-indigo-600 text-indigo-700 bg-indigo-50/50' : 'border-transparent text-muted hover:text-ink-2')}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ════ AUTOMATION ════ */}
      {tab === 'automation' && <AutomationPanel />}

      {/* ════ SEND ════ */}
      {tab === 'send' && (
        <div className="mt-5">
          {/* stepper */}
          <div className="flex items-center gap-2 text-[11.5px] font-bold mb-5 flex-wrap">
            {(['recipients', 'template', 'edit', 'review'] as SendStep[]).map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className={cn('px-2.5 py-1 rounded-full', step === s ? 'bg-indigo-600 text-white' : 'bg-surface-2 text-muted')}>{i + 1}. {s === 'recipients' ? 'Recipients' : s === 'template' ? 'Template' : s === 'edit' ? 'Edit' : 'Preview & send'}</span>
                {i < 3 && <span className="text-faint">→</span>}
              </span>
            ))}
          </div>

          {step === 'recipients' && (
            <div>
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} placeholder="Search leads by name or email…"
                  className="flex-1 min-w-[220px] text-[13px] border border-border rounded-xl px-3.5 py-2.5 bg-surface outline-none focus:border-indigo-400" />
                <button onClick={() => setIds(emailable.map((l) => l.id))} className="text-[12px] font-bold text-indigo-700">Select all ({emailable.length})</button>
                <button onClick={() => setIds([])} className="text-[12px] font-bold text-muted">Clear</button>
              </div>
              <div className="rounded-xl border border-border bg-surface max-h-[420px] overflow-y-auto divide-y divide-border-2">
                {emailable.slice(0, 400).map((l) => {
                  const on = ids.includes(l.id);
                  return (
                    <button key={l.id} onClick={() => setIds((p) => on ? p.filter((x) => x !== l.id) : [...p, l.id])}
                      className={cn('w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors', on ? 'bg-indigo-50/60' : 'hover:bg-surface-2')}>
                      <span className={cn('w-4.5 h-4.5 w-[18px] h-[18px] rounded-md border-2 flex items-center justify-center flex-shrink-0', on ? 'bg-indigo-600 border-indigo-600' : 'border-border-strong')}>
                        {on && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </span>
                      <span className="text-[13px] font-medium flex-1 truncate">{l.full_name}</span>
                      <span className="text-[11.5px] text-faint truncate max-w-[220px]">{l.email}</span>
                    </button>
                  );
                })}
                {emailable.length === 0 && <div className="px-4 py-10 text-center text-[12.5px] text-faint">No leads with an email address match.</div>}
              </div>
              <div className="flex items-center justify-between mt-4">
                <span className="text-[12.5px] text-muted"><b className="text-ink">{ids.length}</b> selected · duplicates and unsubscribed are removed automatically</span>
                <button disabled={ids.length === 0} onClick={() => setStep('template')} className="btn btn-primary disabled:opacity-40">Choose template →</button>
              </div>
            </div>
          )}

          {step === 'template' && (
            <div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' }}>
                {tpls.map((t) => {
                  const m = CATEGORY_META[t.category] || CATEGORY_META.custom;
                  return (
                    <button key={t.id} onClick={() => { setSrcId(t.id); setSubject(t.subject); setContent(t.html); setStep('edit'); }}
                      className="text-left rounded-[15px] border border-border bg-surface p-4 hover:-translate-y-0.5 hover:shadow-lg hover:border-indigo-200 transition-all">
                      <span className="text-[9px] font-extrabold px-2 py-1 rounded-md" style={{ background: m.bg, color: m.color }}>{m.label}</span>
                      <div className="text-[13.5px] font-bold mt-2.5 leading-snug">{t.name}</div>
                      <div className="text-[11.5px] text-faint mt-1.5 line-clamp-2">{t.subject}</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between mt-4">
                <button onClick={() => setStep('recipients')} className="btn"><ArrowLeft className="w-4 h-4" /> Recipients</button>
                <span className="text-[12px] text-faint self-center">Manage the library in the Templates tab</span>
              </div>
            </div>
          )}

          {step === 'edit' && (
            <div>
              <label className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)}
                className="w-full text-[13.5px] font-semibold border border-border rounded-xl px-3.5 py-2.5 bg-surface outline-none focus:border-indigo-400 mt-1.5 mb-4" />
              <label className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Message</label>
              <div className="mt-1.5">
                <RichEmailEditor value={content} onChange={setContent} minHeight={440} />
              </div>

              {/\[[A-Z]/.test(content) && (
                <div className="text-[12px] mt-2 rounded-lg px-3 py-2.5" style={{ background: '#FDF0F2', color: '#C9455C' }}>
                  This message still contains something in [SQUARE BRACKETS]. Replace it before sending.
                </div>
              )}
              <div className="flex justify-between mt-4">
                <button onClick={() => setStep('template')} className="btn"><ArrowLeft className="w-4 h-4" /> Templates</button>
                <button disabled={!subject.trim() || !content.trim()} onClick={() => setStep('review')} className="btn btn-primary disabled:opacity-40"><Eye className="w-4 h-4" /> Preview</button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div>
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <span className="text-[12.5px] text-muted">Previewing as</span>
                <input value={previewName} onChange={(e) => setPreviewName(e.target.value)}
                  className="w-[130px] text-[12.5px] border border-border rounded-lg px-2.5 py-1.5 bg-surface outline-none focus:border-indigo-400" />
                <span className="ml-auto text-[12.5px] text-muted">To <b className="text-ink">{recipients.length}</b> recipients</span>
              </div>
              <div className="rounded-xl border border-border overflow-hidden bg-white" style={{ height: 560 }}>
                <iframe title="preview" srcDoc={previewHtml(content)} className="w-full h-full" sandbox="" />
              </div>
              {content.includes('[') && (
                <div className="mt-3 rounded-xl px-4 py-3 text-[12.5px] font-semibold" style={{ background: '#FFF8EC', color: '#B45309', border: '1px solid #FBE3B8' }}>
                  ⚠ This email still contains [square-bracket] placeholders. Go back and fill them in before sending.
                </div>
              )}
              <div className="flex justify-between mt-4">
                <button onClick={() => setStep('edit')} className="btn"><ArrowLeft className="w-4 h-4" /> Edit</button>
                <button disabled={sending || content.includes('[')} onClick={launch} className="btn btn-primary disabled:opacity-40">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to {recipients.length} leads
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════ TEMPLATES ════ */}
      {tab === 'templates' && (
        <div className="mt-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[12.5px] text-muted">Everything is editable — name, subject and content. The email frame stays fixed so the format never drifts.</span>
            <button onClick={() => { setEditing({ name: '', subject: '', html: '' }); setPlainBody('<p>Hi {{name}},</p><p><br/></p>'); setEditorOpen(true); setTplPreview(false); }} className="btn btn-primary"><Plus className="w-4 h-4" /> New template</button>
          </div>
          {(['cold', 'hot', 'custom'] as const).map((cat) => {
            const list = tpls.filter((t) => (t.category || 'custom') === cat);
            if (list.length === 0) return null;
            const m = CATEGORY_META[cat];
            return (
              <div key={cat} className="mb-6">
                <div className="text-[11px] font-extrabold tracking-[0.09em] uppercase mb-2.5" style={{ color: m.color }}>{m.label} · {list.length}</div>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))' }}>
                  {list.map((t) => (
                    <div key={t.id} className="rounded-[15px] border border-border bg-surface p-4">
                      <div className="text-[13.5px] font-bold leading-snug">{t.name}</div>
                      <div className="text-[11.5px] text-faint mt-1.5 line-clamp-2">{t.subject}</div>
                      <div className="flex gap-2 mt-3.5">
                        <button onClick={() => { setEditing({ ...t }); setPlainBody(t.html); setEditorOpen(true); setTplPreview(false); }}
                          className="flex-1 text-[11.5px] font-bold py-2 rounded-lg border border-border hover:border-indigo-300 hover:bg-indigo-50 transition-colors">
                          <Pencil className="w-3 h-3 inline mr-1" />Edit
                        </button>
                        <button onClick={() => { if (confirm(`Delete "${t.name}"? This cannot be undone.`)) void deleteTpl(t.id); }}
                          className="text-[11.5px] font-bold px-3 py-2 rounded-lg border border-border text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════ HISTORY ════ */}
      {tab === 'history' && (
        <div className="mt-5 space-y-2.5">
          {camps.length === 0 && <div className="py-14 text-center text-[13px] text-faint">No campaigns yet.</div>}
          {camps.map((c) => {
            const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
            return (
              <div key={c.id} className="rounded-[15px] border border-border bg-surface p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold truncate">{c.name}</div>
                    <div className="text-[11.5px] text-faint truncate mt-0.5">{c.subject}</div>
                  </div>
                  <span className={cn('text-[9.5px] font-extrabold px-2.5 py-1 rounded-full',
                    c.status === 'sending' ? 'bg-indigo-50 text-indigo-700'
                    : c.status === 'paused' ? 'bg-amber-50 text-amber-700'
                    : c.status === 'stopped' ? 'bg-rose-50 text-rose-700'
                    : 'bg-emerald-50 text-emerald-700')}>
                    {c.status.toUpperCase()}
                  </span>
                  <div className="flex gap-1.5">
                    {c.status === 'sending' && (
                      <button onClick={() => void setCampStatus(c.id, 'paused')} title="Pause — queued emails hold"
                        className="p-2 rounded-lg border border-border hover:bg-amber-50 hover:border-amber-200 text-amber-700"><Pause className="w-3.5 h-3.5" /></button>
                    )}
                    {c.status === 'paused' && (
                      <button onClick={() => void setCampStatus(c.id, 'sending')} title="Resume"
                        className="p-2 rounded-lg border border-border hover:bg-emerald-50 hover:border-emerald-200 text-emerald-700"><Play className="w-3.5 h-3.5" /></button>
                    )}
                    {(c.status === 'sending' || c.status === 'paused') && (
                      <button onClick={() => { if (confirm('Stop this campaign? Remaining queued emails will be cancelled permanently.')) void setCampStatus(c.id, 'stopped'); }} title="Stop permanently"
                        className="p-2 rounded-lg border border-border hover:bg-rose-50 hover:border-rose-200 text-rose-700"><Square className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.status === 'stopped' ? '#E11D48' : 'linear-gradient(90deg,#4F46E5,#6366F1)' }} />
                  </div>
                  <span className="text-[11.5px] text-muted whitespace-nowrap">{c.sent}/{c.total} sent{c.failed > 0 && <span className="text-rose-600"> · {c.failed} failed</span>}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════ ACCESS ════ */}
      {tab === 'access' && isOwner && (
        <div className="mt-5">
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-[12.5px] text-muted leading-relaxed mb-4">
            <Users className="w-3.5 h-3.5 inline mr-1.5" />
            As the workspace owner you always have full campaign rights. Grant other members access here — they get everything except this Access tab, and you can revoke at any time.
          </div>
          <div className="space-y-2">
            {(members || []).filter((m) => m.status === 'active' && m.user_id !== user.id).map((m) => {
              const has = grants.includes(m.user_id);
              return (
                <div key={m.user_id} className="rounded-[15px] border border-border bg-surface p-4 flex items-center gap-3">
                  <div className="av" style={{ background: avatarColor(m.user_id), width: 34, height: 34, borderRadius: 10, fontSize: 12 }}>{initials(m.full_name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold">{m.full_name}</div>
                    <div className="text-[11.5px] text-faint">{m.role === 'admin' ? 'Admin' : 'Member'}</div>
                  </div>
                  <button onClick={() => void toggleGrant(m.user_id)}
                    className={cn('text-[12px] font-bold px-4 py-2 rounded-xl border-[1.5px] transition-colors',
                      has ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-surface border-border text-muted hover:text-ink-2')}>
                    {has ? 'Access granted' : 'Grant access'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ════ TEMPLATE EDITOR DRAWER ════ */}
      {editorOpen && editing && (
        <>
          <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(15,17,21,.45)', backdropFilter: 'blur(3px)' }} onClick={() => { setEditorOpen(false); setEditing(null); }} />
          <aside className="fixed top-0 right-0 bottom-0 z-[70] bg-surface border-l border-border flex flex-col" style={{ width: 'min(640px,96vw)' }}>
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="text-[15px] font-bold">{editing.id ? 'Edit template' : 'New template'}</div>
              {editing.is_seeded && <span className="text-[9px] font-extrabold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">GTV LIBRARY</span>}
              <div className="ml-auto flex gap-0.5 p-0.5 rounded-lg bg-surface-2">
                <button onClick={() => setTplPreview(false)}
                  className={cn('text-[12px] font-semibold px-3 py-1.5 rounded-[7px] transition-colors',
                    !tplPreview ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>Write</button>
                <button onClick={() => setTplPreview(true)}
                  className={cn('text-[12px] font-semibold px-3 py-1.5 rounded-[7px] transition-colors',
                    tplPreview ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                  <Eye className="w-3 h-3 inline mr-1" />Preview</button>
              </div>
              <button onClick={() => { setEditorOpen(false); setEditing(null); setPlainBody(''); }} className="p-1.5 text-faint hover:text-ink"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!tplPreview ? (
                <>
                  <label className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Template name</label>
                  <input value={editing.name || ''} onChange={(e) => setEditing((p) => ({ ...p!, name: e.target.value }))}
                    className="w-full text-[13.5px] font-semibold border border-border rounded-xl px-3.5 py-2.5 bg-surface outline-none focus:border-indigo-400 mt-1.5 mb-4" />
                  <label className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Subject line</label>
                  <input value={editing.subject || ''} onChange={(e) => setEditing((p) => ({ ...p!, subject: e.target.value }))}
                    className="w-full text-[13.5px] border border-border rounded-xl px-3.5 py-2.5 bg-surface outline-none focus:border-indigo-400 mt-1.5 mb-4" />
                  <label className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint">Message</label>
                  <div className="mt-1.5">
                    <RichEmailEditor value={plainBody} onChange={setPlainBody} minHeight={460} />
                  </div>

                </>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden bg-white" style={{ height: '100%', minHeight: 480 }}>
                  <iframe title="tpl-preview" className="w-full h-full"
                    srcDoc={wrapCampaignEmail(sanitizeEmailHtml(plainBody).replace(/\{\{\s*name\s*\}\}/gi, 'Rahul'), editing.subject || '').replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, '#')}
                    sandbox="" />
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button onClick={() => { setEditorOpen(false); setEditing(null); setPlainBody(''); }} className="btn">Cancel</button>
              <button onClick={() => void saveTpl()} className="btn btn-primary">Save template</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
