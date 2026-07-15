'use client';

// ============================================================================
// ROADMAP TAB — lives in the lead drawer beside Emails.
// Workflow:  paste Claude Max JSON → Parse → edit anything inline (weeks can
// be edited / deleted / reordered / added) → Preview the branded email →
// Send (one click, logged to the Emails thread) or Download PDF.
// Drafts and history live in the `roadmaps` table; latest is loaded on open.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Wand2, Send, Eye, Pencil, Trash2, Plus, ArrowUp, ArrowDown, FileDown, RotateCcw, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { parseRoadmap, type RoadmapData, type RoadmapWeek } from '@/lib/roadmap/types';
import { renderRoadmapEmail } from '@/lib/roadmap/template';
import { DEFAULT_SIGNATURE, type EmailSignature } from '@/lib/email/custom';
import { toast } from 'sonner';

interface RoadmapRow { id: string; data: RoadmapData; status: string; sent_at: string | null; created_at: string; }

// ── small list editor ───────────────────────────────────────────────────────
function ListEditor({ label, items, onChange, placeholder }: {
  label: string; items: string[]; onChange: (items: string[]) => void; placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">{label}{items.length ? ` · ${items.length}` : ''}</span>
        <button onClick={() => onChange([...items, ''])} className="text-[11px] font-bold text-indigo hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
      </div>
      {items.length === 0 && <div className="text-[11.5px] text-faint border border-dashed border-border rounded-lg px-3 py-2 mb-1">Empty — this section will be hidden in the email.</div>}
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex gap-1.5">
            <input value={it} onChange={(e) => onChange(items.map((x, j) => j === i ? e.target.value : x))} placeholder={placeholder}
              className="flex-1 px-2.5 py-1.5 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none" />
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="p-1.5 rounded-md text-muted hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── main tab ────────────────────────────────────────────────────────────────
export function RoadmapTab({ leadId, clientEmail, onSent }: {
  leadId: string; clientEmail: string | null; onSent: () => void;
}) {
  const { workspace, user: appUser } = useApp() as ReturnType<typeof useApp> & { workspace: { id: string }; user: { id: string } };
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<RoadmapRow | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [mode, setMode] = useState<'paste' | 'edit' | 'preview'>('paste');
  const [raw, setRaw] = useState('');
  const [data, setData] = useState<RoadmapData | null>(null);
  const [sig, setSig] = useState<EmailSignature>(DEFAULT_SIGNATURE);
  const [busy, setBusy] = useState<'' | 'parse' | 'save' | 'send'>('');
  const [confirmSend, setConfirmSend] = useState(false);

  // load latest roadmap + sender signature
  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    Promise.all([
      supabase.from('roadmaps').select('id, data, status, sent_at, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('roadmaps').select('id', { count: 'exact', head: true }).eq('lead_id', leadId),
      supabase.from('email_signatures').select('signature').eq('workspace_id', workspace.id).eq('user_id', appUser.id).maybeSingle(),
    ]).then(([latest, count, sigRow]) => {
      if (!alive) return;
      if (latest.data) {
        const r = latest.data as RoadmapRow;
        setRow(r); setData(r.data); setMode('edit');
      }
      setHistoryCount(count.count || 0);
      setSig({ ...DEFAULT_SIGNATURE, ...((sigRow.data?.signature as Partial<EmailSignature>) || {}) });
      setLoading(false);
    });
    return () => { alive = false; };
  }, [leadId, workspace.id, appUser.id]);

  const persist = useCallback(async (d: RoadmapData, existingId: string | null): Promise<string | null> => {
    const supabase = createClient();
    if (existingId) {
      const { error } = await supabase.from('roadmaps').update({ data: d, updated_at: new Date().toISOString() }).eq('id', existingId);
      return error ? null : existingId;
    }
    const { data: ins, error } = await supabase.from('roadmaps')
      .insert({ workspace_id: workspace.id, lead_id: leadId, data: d, created_by: appUser.id })
      .select('id').single();
    return error || !ins ? null : ins.id;
  }, [workspace.id, leadId, appUser.id]);

  // ── actions ──
  const doParse = async () => {
    setBusy('parse');
    try {
      const parsed = parseRoadmap(raw);
      const id = await persist(parsed, null);
      if (!id) throw new Error('Could not save the draft — try again.');
      setRow({ id, data: parsed, status: 'draft', sent_at: null, created_at: new Date().toISOString() });
      setData(parsed); setMode('edit'); setRaw(''); setHistoryCount((c) => c + 1);
      toast.success(`Parsed — ${parsed.roadmap.length} steps for ${parsed.client_name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not parse the pasted text');
    } finally { setBusy(''); }
  };

  const doSave = async () => {
    if (!data || !row) return;
    setBusy('save');
    const id = await persist(data, row.id);
    setBusy('');
    if (id) toast.success('Draft saved'); else toast.error('Could not save changes');
  };

  const doSend = async () => {
    if (!data || !row) return;
    setBusy('send'); setConfirmSend(false);
    try {
      const id = await persist(data, row.id); // always send the latest edits
      if (!id) throw new Error('Could not save before sending');
      const res = await fetch('/api/roadmap/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roadmapId: id }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.reason === 'no_email' ? 'This lead has no email address' : `Send failed${j?.detail ? `: ${String(j.detail).slice(0, 100)}` : ''}`);
      setRow((r) => r ? { ...r, status: 'sent', sent_at: new Date().toISOString() } : r);
      onSent();
      toast.success(`Roadmap sent to ${clientEmail}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally { setBusy(''); }
  };

  const doPdf = () => {
    if (!data) return;
    const html = renderRoadmapEmail(data, sig);
    const w = window.open('', '_blank');
    if (!w) { toast.error('Popup blocked — allow popups to download the PDF'); return; }
    w.document.write(html.replace('</body>', `<script>window.onload=function(){setTimeout(function(){window.print();},400);};</script></body>`));
    w.document.close();
    toast.info('Choose “Save as PDF” in the print dialog');
  };

  // ── week helpers ──
  const setWeeks = (weeks: RoadmapWeek[]) => setData((d) => d ? { ...d, roadmap: weeks } : d);
  const moveWeek = (i: number, dir: -1 | 1) => {
    if (!data) return;
    const w = [...data.roadmap];
    const j = i + dir;
    if (j < 0 || j >= w.length) return;
    [w[i], w[j]] = [w[j], w[i]];
    setWeeks(w);
  };

  // ── render ──
  if (loading) return <div className="py-10 text-center text-[12.5px] text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading roadmap…</div>;

  // PASTE MODE
  if (mode === 'paste' || !data) {
    return (
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">New roadmap analysis</div>
        <div className="rounded-xl border border-border bg-surface-2 p-3.5 mb-3 text-[12px] text-ink-2 leading-relaxed">
          <b>How it works:</b> in Claude, attach the Evidence Playbook, paste the client&apos;s Drive link and the fixed prompt (see <b>ROADMAP_PROMPT.txt</b>), choose the number of weeks — then paste Claude&apos;s JSON block below.
        </div>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={10}
          placeholder={'Paste the JSON block from Claude here…\n\n{\n  "client_name": "…",\n  "roadmap": [ { "week": "Week 1–2", "task": "…" } ]\n}'}
          className="w-full px-3 py-2.5 border border-border rounded-xl text-[12px] font-mono focus:border-indigo outline-none resize-y mb-3" />
        <div className="flex items-center gap-2">
          <button onClick={() => void doParse()} disabled={busy === 'parse' || !raw.trim()} className="btn btn-primary btn-sm">
            {busy === 'parse' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Parse &amp; preview
          </button>
          {row && <button onClick={() => { setData(row.data); setMode('edit'); }} className="btn btn-outline btn-sm">Back to current draft</button>}
        </div>
      </div>
    );
  }

  // PREVIEW MODE — the exact email, rendered in a sandboxed frame
  if (mode === 'preview') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setMode('edit')} className="btn btn-outline btn-sm"><Pencil className="w-3.5 h-3.5" /> Back to edit</button>
          <button onClick={doPdf} className="btn btn-outline btn-sm"><FileDown className="w-3.5 h-3.5" /> Download PDF</button>
          <div className="ml-auto">
            {!confirmSend ? (
              <button onClick={() => setConfirmSend(true)} disabled={!clientEmail || busy === 'send'} className="btn btn-primary btn-sm" title={clientEmail ? `Send to ${clientEmail}` : 'Lead has no email'}>
                <Send className="w-3.5 h-3.5" /> Send roadmap
              </button>
            ) : (
              <span className="flex items-center gap-1.5">
                <button onClick={() => void doSend()} disabled={busy === 'send'} className="btn btn-sm" style={{ background: '#16294E', color: '#fff' }}>
                  {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Confirm — send to {clientEmail}
                </button>
                <button onClick={() => setConfirmSend(false)} className="btn btn-outline btn-sm">Cancel</button>
              </span>
            )}
          </div>
        </div>
        <iframe title="Roadmap preview" sandbox="" srcDoc={renderRoadmapEmail(data, sig)}
          className="w-full rounded-xl border border-border bg-white" style={{ height: '68vh' }} />
      </div>
    );
  }

  // EDIT MODE
  return (
    <div className="space-y-5">
      {/* status + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-extrabold tracking-wide px-2.5 py-1 rounded-full ${row?.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {row?.status === 'sent' ? `SENT ${row.sent_at ? new Date(row.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}` : 'DRAFT'}
        </span>
        {historyCount > 1 && <span className="text-[11px] text-faint">{historyCount} analyses for this lead</span>}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { setMode('paste'); }} className="btn btn-outline btn-sm"><RotateCcw className="w-3.5 h-3.5" /> New analysis</button>
          <button onClick={() => void doSave()} disabled={busy === 'save'} className="btn btn-outline btn-sm">{busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save draft</button>
          <button onClick={() => setMode('preview')} className="btn btn-primary btn-sm"><Eye className="w-3.5 h-3.5" /> Preview &amp; send</button>
        </div>
      </div>

      {/* headline fields */}
      <div className="grid grid-cols-2 gap-2.5">
        {([['client_name', 'Client name'], ['grade', 'Track (Talent / Promise)'], ['route', 'Route'], ['evidence_score', 'Evidence score'], ['timeline', 'Timeline']] as const).map(([k, label]) => (
          <div key={k} className={k === 'route' ? 'col-span-2' : ''}>
            <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">{label}</div>
            <input value={data[k]} onChange={(e) => setData({ ...data, [k]: e.target.value })}
              className="w-full px-2.5 py-1.5 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none" />
          </div>
        ))}
      </div>

      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted mb-1">Assessment (the opening paragraph)</div>
        <textarea value={data.assessment} onChange={(e) => setData({ ...data, assessment: e.target.value })} rows={3}
          className="w-full px-2.5 py-2 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none resize-y" />
      </div>

      {/* WEEKS — the heart of it */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">Week-by-week roadmap · {data.roadmap.length} steps</span>
          <button onClick={() => setWeeks([...data.roadmap, { week: `Week ${data.roadmap.length * 2 + 1}–${data.roadmap.length * 2 + 2}`, task: '', why: '' }])}
            className="text-[11px] font-bold text-indigo hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Add week</button>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 mb-2 text-[11px] text-amber-800">
          Deleting a week removes its task — it is <b>not</b> re-planned. For a shorter timeline, re-run the analysis in Claude asking for fewer weeks; use delete only for tasks that don&apos;t apply.
        </div>
        <div className="space-y-2">
          {data.roadmap.map((w, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-2.5">
              <div className="flex gap-1.5 items-start">
                <input value={w.week} onChange={(e) => setWeeks(data.roadmap.map((x, j) => j === i ? { ...x, week: e.target.value } : x))}
                  className="w-[92px] px-2 py-1.5 border border-border rounded-lg text-[11.5px] font-bold text-indigo focus:border-indigo outline-none" />
                <div className="flex-1 space-y-1.5">
                  <textarea value={w.task} onChange={(e) => setWeeks(data.roadmap.map((x, j) => j === i ? { ...x, task: e.target.value } : x))} rows={2} placeholder="Task"
                    className="w-full px-2.5 py-1.5 border border-border rounded-lg text-[12.5px] focus:border-indigo outline-none resize-y" />
                  <input value={w.why} onChange={(e) => setWeeks(data.roadmap.map((x, j) => j === i ? { ...x, why: e.target.value } : x))} placeholder="Why / which criterion (optional)"
                    className="w-full px-2.5 py-1.5 border border-border rounded-lg text-[11.5px] text-muted focus:border-indigo outline-none" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveWeek(i, -1)} disabled={i === 0} className="p-1 rounded text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                  <button onClick={() => moveWeek(i, 1)} disabled={i === data.roadmap.length - 1} className="p-1 rounded text-muted hover:bg-surface-2 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setWeeks(data.roadmap.filter((_, j) => j !== i))} className="p-1 rounded text-muted hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* lists */}
      <ListEditor label="Strengths" items={data.strengths} onChange={(v) => setData({ ...data, strengths: v })} placeholder="A strength the evidence already proves" />
      <ListEditor label="Gaps to close" items={data.gaps} onChange={(v) => setData({ ...data, gaps: v })} placeholder="What's missing for a strong application" />
      <ListEditor label="Priority actions" items={data.priority_actions} onChange={(v) => setData({ ...data, priority_actions: v })} placeholder="The client's top next moves" />
      <ListEditor label="Recommended publications" items={data.publications} onChange={(v) => setData({ ...data, publications: v })} placeholder="e.g. Technical article in a recognised outlet" />
      <ListEditor label="Recommended speaking" items={data.speaking} onChange={(v) => setData({ ...data, speaking: v })} placeholder="e.g. Apply to speak at XYZ Summit" />
      <ListEditor label="Watch-outs (red flags)" items={data.red_flags} onChange={(v) => setData({ ...data, red_flags: v })} placeholder="A risk to fix before submission" />
    </div>
  );
}
