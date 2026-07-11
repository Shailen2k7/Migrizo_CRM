'use client';

import { useState, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { CAMPAIGN_TEMPLATES, TEMPLATE_BY_KEY } from '@/lib/email/campaign-templates';
import { Send, Users, Pencil, Eye, ChevronLeft, CheckCircle2, Flame, Snowflake, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Step = 'audience' | 'template' | 'edit' | 'review';
type Seg = 'hot' | 'cold' | 'all';

export default function CampaignsPage() {
  const { leads, role } = useApp();
  const [step, setStep] = useState<Step>('audience');
  const [seg, setSeg] = useState<Seg>('hot');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [templateKey, setTemplateKey] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [previewName, setPreviewName] = useState('there');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ queued: number; skipped: number } | null>(null);

  // audience: leads with an email, filtered by segment
  const emailable = useMemo(() => leads.filter((l) => l.email && l.email.includes('@')), [leads]);
  const segLeads = useMemo(() => {
    if (seg === 'all') return emailable;
    if (seg === 'hot') return emailable.filter((l) => l.stage === 'hot');
    return emailable.filter((l) => l.stage === 'cold');
  }, [emailable, seg]);

  const recipients = useMemo(
    () => (picked.size > 0 ? segLeads.filter((l) => picked.has(l.id)) : segLeads),
    [segLeads, picked]
  );

  const tpl = templateKey ? TEMPLATE_BY_KEY[templateKey] : null;
  const bodyHtml = useMemo(() => (tpl ? tpl.build(previewName) : ''), [tpl, previewName]);

  if (role !== 'admin') {
    return <div className="max-w-[900px] mx-auto px-6 py-20 text-center text-muted">Campaigns are available to workspace admins.</div>;
  }

  function chooseTemplate(k: string) {
    setTemplateKey(k);
    setSubject(TEMPLATE_BY_KEY[k].subject);
    setStep('edit');
  }

  async function launch() {
    setSending(true);
    try {
      const finalName = recipients[0]?.full_name?.split(' ')[0] || 'there';
      // send the EDITED subject; body uses {{name}} so the server personalises per recipient
      const htmlTemplate = tpl!.build('{{name}}');
      const res = await fetch('/api/campaigns/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tpl!.name, templateKey, subject,
          html: htmlTemplate, leadIds: recipients.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!data.ok) { toast.error(`Could not start: ${data.reason || 'error'}`); setSending(false); return; }
      setSent({ queued: data.queued, skipped: data.skipped });
      void finalName;
    } catch { toast.error('Network error'); }
    setSending(false);
  }

  // ---- SENT confirmation ----
  if (sent) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-16 text-center animate-pageIn">
        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-7 h-7 text-emerald-600" /></div>
        <h1 className="text-[22px] font-bold text-ink mb-2">Campaign started</h1>
        <p className="text-[14px] text-muted mb-1">Queued <b className="text-ink">{sent.queued}</b> {sent.queued === 1 ? 'email' : 'emails'}. They send in the background, throttled to protect your domain reputation.</p>
        {sent.skipped > 0 && <p className="text-[12.5px] text-muted mb-5">{sent.skipped} skipped (no email, duplicate, or unsubscribed).</p>}
        <p className="text-[12.5px] text-muted mb-6">Each send is logged in the lead's Emails tab as it goes out.</p>
        <button onClick={() => { setSent(null); setStep('audience'); setPicked(new Set()); setTemplateKey(''); }} className="btn btn-primary btn-sm mx-auto">New campaign</button>
      </div>
    );
  }

  const steps: Step[] = ['audience', 'template', 'edit', 'review'];
  const stepIdx = steps.indexOf(step);

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-16 animate-pageIn">
      <div className="flex items-center gap-2.5 mb-1"><Send className="w-5 h-5 text-indigo" /><h1 className="text-[24px] font-bold text-ink">Campaigns</h1></div>
      <p className="text-[13px] text-muted mb-6">Send a beautiful, on-brand email to many leads at once — edit before you send.</p>

      {/* Step rail */}
      <div className="flex items-center gap-1.5 mb-7">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5 flex-1">
            <div className={cn('h-1.5 rounded-full flex-1 transition-colors', i <= stepIdx ? 'bg-indigo' : 'bg-surface-2')} />
          </div>
        ))}
      </div>

      {/* STEP 1: AUDIENCE */}
      {step === 'audience' && (
        <div className="animate-fadeIn">
          <h2 className="text-[15px] font-semibold text-ink mb-3">Who should receive this?</h2>
          <div className="flex gap-2 mb-5 flex-wrap">
            {([['hot', 'Hot leads', Flame], ['cold', 'Cold leads', Snowflake], ['all', 'All leads', Users]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => { setSeg(k); setPicked(new Set()); }} className={cn('inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-[13px] font-medium transition', seg === k ? 'border-indigo bg-indigo-soft text-indigo' : 'border-border bg-surface text-muted hover:border-indigo-300')}>
                <Icon className="w-4 h-4" />{label}<span className="ml-1 text-[11px] font-bold bg-surface-2 rounded-full px-1.5 py-0.5">{k === seg ? segLeads.length : (k === 'all' ? emailable.length : emailable.filter((l) => l.stage === k).length)}</span>
              </button>
            ))}
          </div>
          <div className="panel px-4 py-3 mb-5 flex items-center gap-2 text-[12.5px] text-muted">
            <Users className="w-4 h-4 text-indigo" />
            Sending to <b className="text-ink mx-1">{recipients.length}</b> {recipients.length === 1 ? 'lead' : 'leads'}
            {picked.size > 0 && <button onClick={() => setPicked(new Set())} className="ml-2 text-indigo underline">clear selection ({picked.size})</button>}
          </div>
          {/* optional per-lead refine */}
          <div className="panel max-h-[280px] overflow-y-auto mb-6">
            {segLeads.slice(0, 200).map((l) => {
              const on = picked.size === 0 || picked.has(l.id);
              return (
                <label key={l.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 cursor-pointer hover:bg-surface-2">
                  <input type="checkbox" checked={on} onChange={() => { const n = new Set(picked.size === 0 ? segLeads.map((x) => x.id) : picked); on ? n.delete(l.id) : n.add(l.id); setPicked(n); }} className="accent-indigo w-4 h-4" />
                  <span className="text-[13px] text-ink flex-1">{l.full_name}</span>
                  <span className="text-[11.5px] text-muted">{l.email}</span>
                </label>
              );
            })}
          </div>
          <button disabled={recipients.length === 0} onClick={() => setStep('template')} className="btn btn-primary disabled:opacity-40">Choose a template →</button>
        </div>
      )}

      {/* STEP 2: TEMPLATE */}
      {step === 'template' && (
        <div className="animate-fadeIn">
          <button onClick={() => setStep('audience')} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink mb-4"><ChevronLeft className="w-4 h-4" />Back</button>
          <h2 className="text-[15px] font-semibold text-ink mb-3">Pick a template <span className="text-muted font-normal">· you can edit it next</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CAMPAIGN_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => chooseTemplate(t.key)} className="panel px-4 py-3.5 text-left hover:border-indigo hover:shadow-md transition group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-indigo bg-indigo-soft rounded px-1.5 py-0.5">{t.track}</span>
                  {t.temperature !== 'any' && <span className="text-[10px] text-muted">{t.temperature === 'hot' ? '🔥 hot' : '❄️ cold'}</span>}
                </div>
                <div className="text-[13.5px] font-semibold text-ink group-hover:text-indigo">{t.subject}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3: EDIT */}
      {step === 'edit' && tpl && (
        <div className="animate-fadeIn">
          <button onClick={() => setStep('template')} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink mb-4"><ChevronLeft className="w-4 h-4" />Back</button>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <h2 className="text-[15px] font-semibold text-ink mb-3 flex items-center gap-2"><Pencil className="w-4 h-4" />Edit</h2>
              <label className="block text-[12px] font-medium text-muted mb-1">Subject line</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-[13.5px] mb-1 focus:border-indigo outline-none" />
              <div className={cn('text-[11px] mb-4', subject.length > 50 ? 'text-amber-600' : 'text-faint')}>{subject.length} chars {subject.length > 50 && '· keep under 50 to avoid truncation'}</div>
              <label className="block text-[12px] font-medium text-muted mb-1">Preview name</label>
              <input value={previewName} onChange={(e) => setPreviewName(e.target.value)} className="w-full px-3 py-2.5 border border-border rounded-lg text-[13.5px] mb-4 focus:border-indigo outline-none" placeholder="there" />
              <div className="panel panel-pad text-[12px] text-muted leading-relaxed">
                <b className="text-ink">Body</b> uses this template's polished layout. Each email is personalised with the recipient's first name, and an unsubscribe link is added automatically.
              </div>
              <button onClick={() => setStep('review')} className="btn btn-primary mt-5">Review & send →</button>
            </div>
            <div>
              <h2 className="text-[15px] font-semibold text-ink mb-3 flex items-center gap-2"><Eye className="w-4 h-4" />Live preview</h2>
              <div className="border border-border rounded-xl overflow-hidden bg-white">
                <div className="px-4 py-2.5 border-b border-border bg-surface-2 text-[12px]"><span className="text-muted">Subject:</span> <b className="text-ink">{subject.replace(/\{\{\s*name\s*\}\}/gi, previewName)}</b></div>
                <iframe title="preview" className="w-full" style={{ height: 520, border: 0 }} srcDoc={bodyHtml.replace(/\{\{\s*UNSUB\s*\}\}/gi, 'Unsubscribe')} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: REVIEW */}
      {step === 'review' && tpl && (
        <div className="animate-fadeIn max-w-[560px]">
          <button onClick={() => setStep('edit')} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink mb-4"><ChevronLeft className="w-4 h-4" />Back to edit</button>
          <h2 className="text-[16px] font-semibold text-ink mb-4">Ready to send</h2>
          <div className="panel divide-y divide-border mb-5">
            <div className="px-4 py-3 flex justify-between text-[13px]"><span className="text-muted">Recipients</span><b className="text-ink">{recipients.length} leads</b></div>
            <div className="px-4 py-3 flex justify-between text-[13px]"><span className="text-muted">Segment</span><b className="text-ink capitalize">{seg}</b></div>
            <div className="px-4 py-3 flex justify-between gap-4 text-[13px]"><span className="text-muted flex-shrink-0">Subject</span><b className="text-ink text-right">{subject.replace(/\{\{\s*name\s*\}\}/gi, previewName)}</b></div>
            <div className="px-4 py-3 flex justify-between text-[13px]"><span className="text-muted">Template</span><b className="text-ink">{tpl.name}</b></div>
          </div>
          <div className="panel px-4 py-3 mb-5 text-[12px] text-muted leading-relaxed bg-amber-50 border-amber-200">
            Emails send gradually in the background (≈40/minute) to protect deliverability. Unsubscribed or duplicate addresses are skipped automatically.
          </div>
          <button disabled={sending} onClick={launch} className="btn btn-primary w-full justify-center py-3">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Send className="w-4 h-4" /> Send to {recipients.length} leads</>}
          </button>
        </div>
      )}
    </div>
  );
}
