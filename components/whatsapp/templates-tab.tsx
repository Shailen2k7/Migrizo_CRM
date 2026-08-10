'use client';

// =============================================================================
// TEMPLATES TAB — now editable, because the CRM copy and Meta's copy MUST match.
//
// WHY THIS CHANGED
// Templates are created twice: once here (by migration) and once in Interakt (by
// hand). The moment those two texts differ, sends fail — Interakt counts the
// {{n}} placeholders in ITS body and rejects us for supplying a different
// number. That is the "Missing variable values for template's body, expected
// number of values are 1" error.
//
// Rather than shipping another migration every time a word changes in Interakt,
// this screen lets you paste the exact approved body and mark it approved. The
// variable list is DERIVED from the body on save, so the two can never drift
// apart internally either.
//
// The body stays read-only until you press Edit — an accidental keystroke in a
// template that Meta has approved should not be possible.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  Copy, Check, FileText, Clock, XCircle, CheckCircle2, PauseCircle,
  Pencil, Save, X, AlertTriangle, Loader2, ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WaTemplate, WaTemplateVar } from '@/lib/whatsapp/types';

const META_CHIP: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  approved:  { cls: 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]', icon: <CheckCircle2 className="h-[11px] w-[11px]" />, label: 'Approved' },
  submitted: { cls: 'border-[#DDE5FB] bg-[#EEF2FE] text-[#3B5BDB]', icon: <Clock className="h-[11px] w-[11px]" />,        label: 'In review' },
  draft:     { cls: 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]', icon: <Clock className="h-[11px] w-[11px]" />,        label: 'Not approved' },
  rejected:  { cls: 'border-[#F8D6D6] bg-[#FEEFEF] text-[#B02B2B]', icon: <XCircle className="h-[11px] w-[11px]" />,      label: 'Rejected' },
  paused:    { cls: 'border-[#EDEFF3] bg-[#F5F6F9] text-[#7A8095]', icon: <PauseCircle className="h-[11px] w-[11px]" />,  label: 'Paused by Meta' },
};

/** The list Meta will count. Derived from the body — the only honest source. */
function placeholderNumbers(body: string): string[] {
  const found = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => m[1]);
  return Array.from(new Set(found)).sort((a, b) => Number(a) - Number(b));
}

/** Meta rejects a body that starts or ends with a variable, or has two adjacent. */
function formatProblem(body: string): string | null {
  const t = body.trim();
  if (!t) return 'The body is empty.';
  if (/^\{\{\s*\d+\s*\}\}/.test(t)) return 'Starts with a variable — Meta rejects this.';
  if (/\{\{\s*\d+\s*\}\}$/.test(t)) return 'Ends with a variable — Meta rejects this.';
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) return 'Two variables sit next to each other — Meta rejects this.';
  if (t.length > 1024) return `${t.length} characters — Meta's limit is 1024.`;
  return null;
}

export default function TemplatesTab({
  templates, onChanged,
}: { templates: WaTemplate[]; onChanged?: () => Promise<void> | void }) {
  const supabase = useMemo(() => createClient(), []);
  const [track, setTrack] = useState<'all' | 'cold' | 'hot'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulk, setBulk] = useState(false);

  const active = useMemo(() => templates.filter((t) => t.active), [templates]);
  const shown = useMemo(
    () => active.filter((t) => track === 'all' || t.track === track),
    [active, track]
  );
  const counts = useMemo(() => ({
    approved: active.filter((t) => t.meta_status === 'approved').length,
    pending: active.filter((t) => t.meta_status === 'draft' || t.meta_status === 'submitted').length,
    rejected: active.filter((t) => t.meta_status === 'rejected').length,
  }), [active]);

  useEffect(() => { if (editId) { const t = active.find((x) => x.id === editId); if (t) setDraftBody(t.body); } }, [editId, active]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch { toast.error('Clipboard blocked by the browser — copy manually'); }
  }

  async function saveBody(t: WaTemplate) {
    const problem = formatProblem(draftBody);
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      // Rebuild the variable list from the body, preserving any labels and
      // defaults you already set. This is what stops internal drift.
      const nums = placeholderNumbers(draftBody);
      const existing = (t.variables || []) as WaTemplateVar[];
      const variables: WaTemplateVar[] = nums.map((n) => {
        const prev = existing.find((v) => String(v.n) === n);
        return prev ?? { n, label: n === '1' ? 'First name' : `Value ${n}`, default: '' };
      });

      const { error } = await supabase.from('whatsapp_templates')
        .update({ body: draftBody, variables, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (error) throw new Error(error.message);

      setEditId(null);
      await onChanged?.();
      toast.success(`Saved — ${nums.length} variable${nums.length === 1 ? '' : 's'}, matching your Interakt copy`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  }

  async function setStatus(t: WaTemplate, meta_status: string) {
    const { error } = await supabase.from('whatsapp_templates')
      .update({ meta_status, meta_reason: null, updated_at: new Date().toISOString() })
      .eq('id', t.id);
    if (error) { toast.error(error.message); return; }
    await onChanged?.();
  }

  async function markAllApproved() {
    if (!window.confirm(
      'Mark all templates as approved?\n\nOnly do this if Meta has actually approved them in Interakt. ' +
      'Sending a template Meta has not approved fails and hurts your number\'s quality rating.'
    )) return;
    setBulk(true);
    try {
      const ids = active.filter((t) => t.meta_status !== 'approved').map((t) => t.id);
      if (!ids.length) { toast('They are all approved already'); return; }
      const { error } = await supabase.from('whatsapp_templates')
        .update({ meta_status: 'approved', meta_reason: null, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw new Error(error.message);
      await onChanged?.();
      toast.success(`${ids.length} template${ids.length === 1 ? '' : 's'} marked approved — you can send them now`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBulk(false); }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-[14px]">
      {/* summary */}
      <div className="mb-[14px] flex flex-wrap items-center gap-[10px] rounded-[14px] border border-[#E8EAF0] bg-white px-[18px] py-[14px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
        <FileText className="h-[18px] w-[18px] text-[#1B7A44]" />
        <b className="text-[14px] font-semibold tracking-[-.02em]">{active.length} templates</b>
        <span className="rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[10px] py-[4px] text-[11.4px] font-semibold text-[#1B7A44]">{counts.approved} approved</span>
        {counts.pending > 0 && (
          <span className="rounded-full border border-[#F8E2B8] bg-[#FEF6E6] px-[10px] py-[4px] text-[11.4px] font-semibold text-[#A25D07]">{counts.pending} not approved</span>
        )}
        {counts.rejected > 0 && (
          <span className="rounded-full border border-[#F8D6D6] bg-[#FEEFEF] px-[10px] py-[4px] text-[11.4px] font-semibold text-[#B02B2B]">{counts.rejected} rejected</span>
        )}
        {counts.pending > 0 && (
          <button onClick={markAllApproved} disabled={bulk}
            className="ml-auto inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[14px] py-[8px] text-[12.6px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-50">
            {bulk ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <ShieldCheck className="h-[13px] w-[13px]" />}
            Mark all as approved in Meta
          </button>
        )}
      </div>

      {/* THE thing that blocks sending, said plainly */}
      {counts.pending > 0 && (
        <div className="mb-[14px] flex items-start gap-3 rounded-[14px] border border-[#F8E2B8] bg-[#FEF6E6] px-[18px] py-[14px]">
          <AlertTriangle className="mt-px h-[17px] w-[17px] flex-shrink-0 text-[#A25D07]" />
          <div className="min-w-0 text-[12.8px] leading-[1.6] text-[#8A5206]">
            <b className="font-bold text-[#A25D07]">{counts.pending} template{counts.pending === 1 ? '' : 's'} are not marked approved here,</b>{' '}
            so the CRM refuses to send them — that is why the picker looks empty and existing chats will not take a template.
            Meta approving them in Interakt does not update this automatically unless Interakt&apos;s
            template webhook is switched on. If Meta has approved them, press <b>Mark all as approved</b> above.
          </div>
        </div>
      )}

      {/* track filter */}
      <div className="mb-[12px] flex gap-[6px]">
        {([['all', 'All'], ['cold', 'Cold'], ['hot', 'Hot']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTrack(k)}
            className={cn(
              'rounded-full border px-[14px] py-[6px] text-[12.6px] font-semibold transition',
              track === k ? 'border-[#25A25A] bg-[#25A25A] text-white' : 'border-[#DDE0E9] bg-white text-ink-2 hover:bg-[#F5F6F9]'
            )}>
            {l} <span className="opacity-60">{active.filter((t) => k === 'all' || t.track === k).length}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[12px] xl:grid-cols-2">
        {shown.map((t) => {
          const meta = META_CHIP[t.meta_status] ?? META_CHIP.draft;
          const editing = editId === t.id;
          const nums = placeholderNumbers(editing ? draftBody : t.body);
          const problem = editing ? formatProblem(draftBody) : null;
          return (
            <div key={t.id} className={cn(
              'rounded-[14px] border bg-white p-[16px] shadow-[0_1px_2px_rgba(20,24,40,.06)] transition',
              editing ? 'border-[#2FB463] ring-1 ring-[#D7F3E1]' : 'border-[#E8EAF0]'
            )}>
              <div className="mb-[9px] flex items-center gap-[8px]">
                <b className="min-w-0 flex-1 truncate text-[13.8px] font-semibold tracking-[-.015em]">{t.name}</b>
                <span className={cn('inline-flex flex-shrink-0 items-center gap-[4px] rounded-full border px-[9px] py-[3px] text-[10.8px] font-bold', meta.cls)}>
                  {meta.icon}{meta.label}
                </span>
              </div>

              <div className="mb-[9px] flex flex-wrap items-center gap-[7px]">
                <code className="rounded-md bg-[#F5F6F9] px-[8px] py-[3px] text-[11.4px] text-ink-2">{t.code}</code>
                <button onClick={() => copy(t.code, `${t.id}-code`)}
                  className="inline-flex items-center gap-[4px] rounded-md border border-[#DDE0E9] px-[8px] py-[3px] text-[11px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:text-[#1B7A44]">
                  {copied === `${t.id}-code` ? <Check className="h-[11px] w-[11px]" /> : <Copy className="h-[11px] w-[11px]" />} name
                </button>
                <button onClick={() => copy(t.body, `${t.id}-body`)}
                  className="inline-flex items-center gap-[4px] rounded-md border border-[#DDE0E9] px-[8px] py-[3px] text-[11px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:text-[#1B7A44]">
                  {copied === `${t.id}-body` ? <Check className="h-[11px] w-[11px]" /> : <Copy className="h-[11px] w-[11px]" />} body
                </button>
                <span className={cn(
                  'rounded-md border px-[8px] py-[3px] text-[11px] font-semibold',
                  nums.length ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]' : 'border-[#DDE0E9] bg-[#F5F6F9] text-[#7A8095]'
                )}>
                  {nums.length} variable{nums.length === 1 ? '' : 's'}
                </span>
                {!editing && (
                  <button onClick={() => { setEditId(t.id); setDraftBody(t.body); }}
                    className="ml-auto inline-flex items-center gap-[5px] rounded-md border border-[#DDE0E9] px-[9px] py-[4px] text-[11.4px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:text-[#1B7A44]">
                    <Pencil className="h-[11px] w-[11px]" /> Edit
                  </button>
                )}
              </div>

              {editing ? (
                <>
                  <textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={9}
                    spellCheck={false}
                    className="w-full resize-y rounded-[10px] border border-[#DDE0E9] px-[12px] py-[10px] font-mono text-[12.2px] leading-[1.6] outline-none transition focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]"
                  />
                  <p className="m-0 mt-[7px] text-[11.4px] leading-[1.55] text-muted">
                    Paste the body <b>exactly</b> as it appears in Interakt, variables included.
                    The variable list is rebuilt from what you type, so the count always matches
                    what Meta expects.
                  </p>
                  {problem && (
                    <p className="m-0 mt-[7px] flex items-start gap-[6px] rounded-[8px] border border-[#F8D6D6] bg-[#FEEFEF] px-[10px] py-[7px] text-[11.6px] text-[#B02B2B]">
                      <AlertTriangle className="mt-px h-[13px] w-[13px] flex-shrink-0" />{problem}
                    </p>
                  )}
                  <div className="mt-[11px] flex items-center gap-[8px]">
                    <button onClick={() => saveBody(t)} disabled={saving || Boolean(problem)}
                      className="inline-flex items-center gap-[6px] rounded-[9px] bg-[#25A25A] px-[14px] py-[8px] text-[12.8px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40">
                      {saving ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Save className="h-[13px] w-[13px]" />} Save
                    </button>
                    <button onClick={() => setEditId(null)}
                      className="inline-flex items-center gap-[6px] rounded-[9px] border border-[#DDE0E9] bg-white px-[14px] py-[8px] text-[12.8px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9]">
                      <X className="h-[13px] w-[13px]" /> Cancel
                    </button>
                    <select
                      value={t.meta_status}
                      onChange={(e) => setStatus(t, e.target.value)}
                      className="ml-auto rounded-[9px] border border-[#DDE0E9] bg-white px-[10px] py-[7px] text-[12.4px] font-medium outline-none focus:border-[#2FB463]"
                    >
                      <option value="draft">Not approved</option>
                      <option value="submitted">In review</option>
                      <option value="approved">Approved by Meta</option>
                      <option value="rejected">Rejected</option>
                      <option value="paused">Paused by Meta</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <p className="m-0 whitespace-pre-wrap rounded-[10px] bg-[#F7F8FA] px-[12px] py-[10px] text-[12.4px] leading-[1.6] text-ink-2">
                    {t.body}
                  </p>
                  {(t.variables?.length ?? 0) > 0 && (
                    <div className="mt-[8px] flex flex-wrap gap-[6px]">
                      {t.variables.map((v) => (
                        <span key={v.n} className="rounded-md border border-[#D7F3E1] bg-[#EDFAF1] px-[7px] py-[2px] font-mono text-[10.8px] font-semibold text-[#1B7A44]">
                          {`{{${v.n}}}`} {v.label ?? ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.meta_reason && (
                    <p className="m-0 mt-[8px] text-[11.4px] text-[#B02B2B]">{t.meta_reason}</p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-[14px] rounded-[12px] border border-[#E8EAF0] bg-white px-[16px] py-[13px]">
        <b className="block text-[12.6px] font-semibold">If a send fails with “expected number of values are N”</b>
        <p className="m-0 mt-[5px] text-[11.8px] leading-[1.6] text-muted">
          Interakt counted <b>N</b> variables in its copy of the template and we sent a different
          number. Open that template in Interakt, copy its body, press <b>Edit</b> here and paste it
          in. The two copies must be identical — that is the whole cause of the error.
        </p>
      </div>
    </div>
  );
}
