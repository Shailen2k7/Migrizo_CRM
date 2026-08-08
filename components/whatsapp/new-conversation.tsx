'use client';

// =============================================================================
// NEW CONVERSATION — the screen that turns the inbox into an outbound channel.
//
// Two steps, because the two decisions are genuinely sequential: who, then what.
// Cramming both into one view would mean three columns and a lot of scrolling.
//
// DESIGN DECISION: unsendable leads are SHOWN, greyed out, with the reason.
// Hiding them would make "I searched for my client and got nothing" mean either
// "not in your CRM" or "no valid number" or "opted out" — three very different
// problems that look identical. A greyed row with "Opted out" answers it.
//
// Meta rule this screen enforces: you cannot open a cold conversation with free
// text, only with an approved template. Free text is offered only when the lead
// already replied and the 24-hour window is still open.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Search, Loader2, ArrowLeft, Users, FileText, Zap, AlertCircle,
  ShieldCheck, MessageSquare, Clock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { initials, avatarColor, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { prettyPhone } from '@/lib/whatsapp/phone';
import { windowState, formatLeft, windowLeftMs } from '@/lib/whatsapp/types';
import type { WaTemplate } from '@/lib/whatsapp/types';

/** Row shape returned by public.whatsapp_reachable_leads(). */
export interface ReachableLead {
  lead_id: string;
  full_name: string;
  phone_raw: string | null;
  phone_e164: string | null;
  email: string | null;
  stage: string | null;
  visa_type: string | null;
  score: number | null;
  conversation_id: string | null;
  last_message_at: string | null;
  suppressed: boolean;
  sendable: boolean;
  blocked_reason: string | null;
}

export interface PhoneAudit {
  total_leads: number;
  reachable: number;
  already_talking: number;
  opted_out: number;
  no_number: number;
  unusable: number;
  reachable_by_stage: Record<string, number>;
  unusable_examples: { id: string; phone: string | null }[];
}

interface Props {
  open: boolean;
  workspaceId: string;
  templates: WaTemplate[];
  /** Windows are per-conversation; the parent already knows them. */
  lastInboundByConversation: Record<string, string | null>;
  onClose: () => void;
  /** Fired after a successful send so the parent can refresh and open the thread. */
  onSent: (conversationId: string | null) => void;
}

/** Read placeholders from the body, not the metadata — Meta validates the body. */
function placeholders(body: string): string[] {
  const found = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => m[1]);
  return Array.from(new Set(found)).sort((a, b) => Number(a) - Number(b));
}

const firstName = (n: string) =>
  n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

const STAGES = ['', 'cold', 'warm', 'hot', 'client', 'junk'];

export default function NewConversation({
  open, workspaceId, templates, lastInboundByConversation, onClose, onSent,
}: Props) {
  const supabase = useMemo(() => createClient(), []);

  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [onlySendable, setOnlySendable] = useState(true);
  const [rows, setRows] = useState<ReachableLead[]>([]);
  const [audit, setAudit] = useState<PhoneAudit | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [lead, setLead] = useState<ReachableLead | null>(null);
  const [tplId, setTplId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState('');
  const [sending, setSending] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only approved templates can legally open a cold conversation. Showing the
  // draft ones as pickable would just produce a Meta rejection at send time.
  const approved = useMemo(
    () => templates.filter((t) => t.meta_status === 'approved' && t.active),
    [templates]
  );

  // ── loading ───────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setListLoading(true);
    const { data, error } = await supabase.rpc('whatsapp_reachable_leads', {
      p_workspace_id: workspaceId,
      p_query: query.trim() || null,
      p_stage: stage || null,
      p_visa: null,
      p_only_sendable: onlySendable,
      p_limit: 150,
    });
    if (error) setListError(error.message);
    else { setListError(null); setRows((data || []) as ReachableLead[]); }
    setListLoading(false);
  }, [supabase, workspaceId, query, stage, onlySendable]);

  // The audit is a full table scan over every lead — fetch it once per opening,
  // not on every keystroke alongside the list.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.rpc('whatsapp_phone_audit', { p_workspace_id: workspaceId });
      if (data) setAudit(data as PhoneAudit);
    })();
  }, [open, supabase, workspaceId]);

  // Debounced so typing a name is one query, not one per character.
  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { loadList(); }, 220);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [open, loadList]);

  // Reset on every open so you never inherit the last person's half-finished send.
  useEffect(() => {
    if (open) {
      setStep(1); setQuery(''); setStage(''); setOnlySendable(true);
      setLead(null); setTplId(null); setValues({}); setFreeText('');
      setTimeout(() => searchRef.current?.focus(), 60);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Escape steps back before it closes — losing a filled-in template because
      // you wanted to change the recipient would be maddening.
      if (step === 2) { setStep(1); setTplId(null); setValues({}); setFreeText(''); }
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step, onClose]);

  if (!open) return null;

  // ── window state for the chosen lead ──────────────────────────────────────
  const lastInbound = lead?.conversation_id
    ? lastInboundByConversation[lead.conversation_id] ?? null
    : null;
  const wState = windowState(lastInbound);
  const windowOpen = wState !== 'shut';
  const leftMs = windowLeftMs(lastInbound);

  const tpl = approved.find((t) => t.id === tplId) || null;
  const slots = tpl ? placeholders(tpl.body) : [];
  const missing = slots.filter((n) => !(values[n] ?? '').trim());

  function pickLead(r: ReachableLead) {
    if (!r.sendable) return;
    setLead(r);
    setStep(2);
    setTplId(null);
    setValues({});
    setFreeText('');
  }

  function pickTemplate(t: WaTemplate) {
    setTplId(t.id);
    const next: Record<string, string> = {};
    placeholders(t.body).forEach((n) => {
      const meta = (t.variables || []).find((v) => String(v.n) === n);
      // {{1}} is the lead's first name by convention across all 11 templates.
      next[n] = n === '1' ? firstName(lead?.full_name || '') : (meta?.default ?? '');
    });
    setValues(next);
  }

  function rendered(t: WaTemplate): string {
    let out = t.body;
    placeholders(t.body).forEach((n) => {
      out = out.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), values[n] || `{{${n}}}`);
    });
    return out;
  }

  async function doSend() {
    if (!lead || !lead.phone_e164) return;
    const usingTemplate = Boolean(tpl);
    if (!usingTemplate && !freeText.trim()) return;

    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Send by phone + leadId. The route resolves or creates the
          // conversation itself, so this screen never has to know whether a
          // thread already exists.
          phone: lead.phone_e164,
          leadId: lead.lead_id,
          ...(usingTemplate && tpl
            ? { templateCode: tpl.code, values }
            : { body: freeText.trim() }),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.detail || json.reason || 'Send failed');
        return;
      }
      toast.success(
        json.dryRun
          ? 'Logged — dry-run is on, nothing left the CRM'
          : `Sent to ${firstName(lead.full_name)}`
      );
      onSent(json.conversationId ?? null);
      onClose();
    } catch (e) {
      toast.error(`Send failed: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  const canSend = tpl ? missing.length === 0 : windowOpen && freeText.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(20,24,40,.48)] p-6 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[86vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(20,24,40,.34)]">

        {/* ── header ── */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#E8EAF0] px-[22px] py-[18px]">
          {step === 2 && (
            <button
              onClick={() => { setStep(1); setTplId(null); setValues({}); setFreeText(''); }}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#E8EAF0] text-muted transition hover:bg-[#F5F6F9] hover:text-ink"
              title="Back to leads (Esc)"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1]">
            {step === 1
              ? <Users className="h-[17px] w-[17px] text-[#1B7A44]" />
              : <MessageSquare className="h-[17px] w-[17px] text-[#1B7A44]" />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-[15.5px] font-semibold tracking-[-.025em]">
              {step === 1 ? 'Start a WhatsApp conversation' : `Message ${lead?.full_name}`}
            </h3>
            <p className="m-0 mt-[3px] truncate text-[12.4px] text-muted">
              {step === 1
                ? 'Pick a lead. Numbers are validated the same way the sender validates them.'
                : lead?.phone_e164
                  ? prettyPhone(lead.phone_e164)
                  : ''}
            </p>
          </div>
          <span className="flex-shrink-0 rounded-full border border-[#DDE0E9] bg-[#F5F6F9] px-[10px] py-[4px] text-[11px] font-semibold text-muted">
            Step {step} of 2
          </span>
          <button
            onClick={onClose}
            className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border border-[#E8EAF0] text-muted transition hover:bg-[#F5F6F9] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── STEP 1: pick a lead ── */}
        {step === 1 && (
          <>
            {audit && (
              <div className="flex flex-shrink-0 flex-wrap items-center gap-[7px] border-b border-[#E8EAF0] bg-[#F5F6F9] px-[22px] py-[11px]">
                <Stat tone="good" n={audit.reachable} label="reachable" />
                <Stat tone="plain" n={audit.already_talking} label="already talking" />
                <Stat tone="warn" n={audit.no_number} label="no number" />
                <Stat tone="warn" n={audit.unusable} label="bad number" />
                <Stat tone="bad" n={audit.opted_out} label="opted out" />
                <span className="ml-auto text-[11.4px] text-faint">
                  of {audit.total_leads.toLocaleString()} leads
                </span>
              </div>
            )}

            <div className="flex flex-shrink-0 items-center gap-[9px] border-b border-[#E8EAF0] px-[22px] py-[13px]">
              <span className="relative flex-1">
                <Search className="absolute left-[11px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, number or email…"
                  className="w-full rounded-[9px] border border-[#DDE0E9] py-[9px] pl-[34px] pr-3 text-[13px] outline-none transition focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]"
                />
              </span>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="rounded-[9px] border border-[#DDE0E9] px-[10px] py-[9px] text-[12.6px] outline-none transition focus:border-[#2FB463]"
              >
                {STAGES.map((s) => (
                  <option key={s || 'all'} value={s}>{s ? s : 'All stages'}</option>
                ))}
              </select>
              <button
                onClick={() => setOnlySendable((v) => !v)}
                className={cn(
                  'inline-flex flex-shrink-0 items-center gap-[6px] rounded-[9px] border px-[11px] py-[9px] text-[12.4px] font-semibold transition',
                  onlySendable
                    ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
                    : 'border-[#DDE0E9] bg-white text-ink-2 hover:bg-[#F5F6F9]'
                )}
                title="Hide leads that cannot be messaged"
              >
                <ShieldCheck className="h-[13px] w-[13px]" />
                Sendable only
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-[13px] py-[10px]">
              {listLoading && rows.length === 0 && (
                <div className="p-10 text-center text-muted">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </div>
              )}
              {listError && (
                <div className="m-2 rounded-xl border border-[#F8D6D6] bg-[#FEEFEF] p-[14px]">
                  <div className="mb-[6px] flex items-center gap-[7px] text-[13px] font-semibold text-[#B02B2B]">
                    <AlertCircle className="h-[15px] w-[15px]" /> Couldn&apos;t load leads
                  </div>
                  <p className="m-0 break-words text-[11.8px] leading-[1.55] text-[#8E2A2A]">{listError}</p>
                  <p className="m-0 mt-[8px] text-[11.4px] text-[#8E2A2A]">
                    If this says the function does not exist, migration 043 has not been run yet.
                  </p>
                </div>
              )}
              {!listLoading && !listError && rows.length === 0 && (
                <p className="px-4 py-12 text-center text-[13px] text-muted">
                  {query || stage
                    ? 'No leads match that.'
                    : onlySendable
                      ? 'No leads have a usable WhatsApp number yet.'
                      : 'No leads yet.'}
                </p>
              )}

              {rows.map((r) => (
                <button
                  key={r.lead_id}
                  onClick={() => pickLead(r)}
                  disabled={!r.sendable}
                  className={cn(
                    'mb-[5px] flex w-full items-center gap-3 rounded-[11px] border px-[13px] py-[10px] text-left transition',
                    r.sendable
                      ? 'border-[#DDE0E9] bg-white hover:border-[#2FB463] hover:bg-[#EDFAF1]'
                      : 'cursor-not-allowed border-transparent bg-[#F5F6F9] opacity-70'
                  )}
                >
                  <span
                    className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full text-[13.5px] font-semibold text-white"
                    style={{ background: r.sendable ? avatarColor(r.full_name) : '#B9BECB' }}
                  >
                    {initials(r.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <b className="truncate text-[13.6px] font-semibold tracking-[-.015em]">{r.full_name}</b>
                      {r.stage && (
                        <span className="flex-shrink-0 rounded-full border border-[#DDE0E9] bg-[#F5F6F9] px-[7px] py-px text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {r.stage}
                        </span>
                      )}
                      {r.conversation_id && (
                        <span className="flex-shrink-0 rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[7px] py-px text-[10px] font-semibold text-[#1B7A44]">
                          talking
                        </span>
                      )}
                    </span>
                    <span className="mt-[2px] block truncate text-[11.8px] text-muted">
                      {r.blocked_reason
                        ? r.blocked_reason
                        : `${r.phone_e164 ? prettyPhone(r.phone_e164) : ''}${r.visa_type ? ` · ${r.visa_type.toUpperCase()}` : ''}`}
                    </span>
                  </span>
                  {!r.sendable && (
                    <AlertCircle className="h-[15px] w-[15px] flex-shrink-0 text-[#A25D07]" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── STEP 2: choose what to send ── */}
        {step === 2 && lead && (
          <div className="flex min-h-0 flex-1">
            {/* templates */}
            <div className="flex w-[380px] flex-shrink-0 flex-col border-r border-[#E8EAF0] bg-[#F5F6F9]">
              <div className="flex-shrink-0 px-[16px] pb-[9px] pt-[14px]">
                <h5 className="m-0 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                  Approved templates
                </h5>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-[11px] pb-[13px]">
                {approved.length === 0 && (
                  <div className="m-2 rounded-xl border border-[#F8E2B8] bg-[#FEF6E6] p-[14px]">
                    <div className="mb-[6px] flex items-center gap-[7px] text-[12.8px] font-semibold text-[#A25D07]">
                      <Clock className="h-[14px] w-[14px]" /> No approved templates yet
                    </div>
                    <p className="m-0 text-[11.8px] leading-[1.6] text-[#8A5206]">
                      Meta has to approve a template before you can open a cold
                      conversation. Submit them in Interakt — approval usually
                      lands within a few hours.
                    </p>
                  </div>
                )}
                {approved.map((t) => {
                  const on = tplId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => pickTemplate(t)}
                      className={cn(
                        'mb-[7px] w-full rounded-[11px] border px-[14px] py-3 text-left transition',
                        on
                          ? 'border-[#25A25A] bg-[#EDFAF1] shadow-[0_0_0_2px_#D7F3E1]'
                          : 'border-[#DDE0E9] bg-white hover:border-[#2FB463] hover:bg-[#EDFAF1]'
                      )}
                    >
                      <div className="mb-[5px] flex items-center gap-2">
                        <b className="truncate text-[13px] font-semibold tracking-[-.01em]">{t.name}</b>
                        <span className={cn(
                          'ml-auto flex-shrink-0 rounded-full border px-[9px] py-[3px] text-[11px] font-semibold',
                          t.category === 'UTILITY'
                            ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
                            : 'border-indigo-100 bg-indigo-soft text-indigo-700'
                        )}>
                          {t.category}
                        </span>
                      </div>
                      <div className="line-clamp-2 text-[11.6px] leading-[1.5] text-muted">
                        {t.body.replace(/\n+/g, ' ')}
                      </div>
                    </button>
                  );
                })}

                {/* Free text is only legal inside the 24-hour window. */}
                <div className="mt-3 border-t border-[#DDE0E9] pt-3">
                  <h5 className="m-0 mb-[8px] text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                    Or type freely
                  </h5>
                  {windowOpen ? (
                    <button
                      onClick={() => { setTplId(null); setValues({}); }}
                      className={cn(
                        'w-full rounded-[11px] border px-[14px] py-3 text-left transition',
                        !tpl
                          ? 'border-[#25A25A] bg-[#EDFAF1] shadow-[0_0_0_2px_#D7F3E1]'
                          : 'border-[#DDE0E9] bg-white hover:border-[#2FB463] hover:bg-[#EDFAF1]'
                      )}
                    >
                      <b className="block text-[13px] font-semibold">Free-form message</b>
                      <span className="mt-[3px] block text-[11.6px] text-[#1B7A44]">
                        Window open · {formatLeft(leftMs)} left
                      </span>
                    </button>
                  ) : (
                    <p className="m-0 rounded-[9px] border border-[#DDE0E9] bg-white px-[12px] py-[10px] text-[11.6px] leading-[1.55] text-muted">
                      {lead.conversation_id
                        ? 'The 24-hour window has closed, so only an approved template can go out.'
                        : 'This lead has never messaged you, so Meta requires an approved template to open the conversation.'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* compose / preview */}
            <div className="min-w-0 flex-1 overflow-y-auto px-[22px] py-5">
              {tpl ? (
                <>
                  <h5 className="m-0 mb-3 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                    Variables — filled at send time, no Meta re-approval
                  </h5>
                  {slots.length === 0 && (
                    <p className="m-0 mb-4 text-[12.6px] text-muted">
                      This template has no variables. Nothing to fill in.
                    </p>
                  )}
                  {slots.map((n) => {
                    const meta = (tpl.variables || []).find((v) => String(v.n) === n);
                    return (
                      <div key={n} className="mb-[9px] flex items-center gap-[10px]">
                        <span className="min-w-[38px] flex-shrink-0 rounded-md border border-[#D7F3E1] bg-[#EDFAF1] px-[7px] py-[5px] text-center font-mono text-[11.4px] font-semibold text-[#1B7A44]">
                          {`{{${n}}}`}
                        </span>
                        <input
                          value={values[n] ?? ''}
                          placeholder={meta?.label || `Value for {{${n}}}`}
                          onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
                          className="w-full rounded-[9px] border border-[#DDE0E9] px-[10px] py-2 text-[12.8px] outline-none transition focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]"
                        />
                      </div>
                    );
                  })}

                  <h5 className="m-0 mb-3 mt-5 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                    Preview — exactly what lands on their phone
                  </h5>
                  <div className="flex justify-end rounded-xl border border-[#DDE0E9] bg-[#F7F8FA] p-4">
                    <div className="max-w-full rounded-[18px] bg-[#D7F5D3] px-[17px] py-[13px] text-[14.6px] leading-[1.6] text-[#123321]">
                      <span className="mb-2 inline-flex items-center gap-[5px] rounded bg-[rgba(27,122,68,.13)] px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[.08em] text-[#1B7A44]">
                        <Zap className="h-[11px] w-[11px]" />
                        {tpl.category} · {tpl.code}
                      </span>
                      <div className="whitespace-pre-wrap break-words">{rendered(tpl)}</div>
                    </div>
                  </div>
                </>
              ) : windowOpen ? (
                <>
                  <h5 className="m-0 mb-3 text-[10px] font-bold uppercase tracking-[.08em] text-faint">
                    Your message
                  </h5>
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    rows={7}
                    placeholder={`Write to ${firstName(lead.full_name)}…`}
                    className="w-full resize-y rounded-[11px] border border-[#DDE0E9] px-[13px] py-[11px] text-[13.6px] leading-[1.6] outline-none transition focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]"
                  />
                  <p className="m-0 mt-[9px] text-[11.6px] text-muted">
                    Free-form is allowed for another <b className="tabular-nums">{formatLeft(leftMs)}</b>,
                    because they messaged you first.
                  </p>
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-5 py-11 text-center text-faint">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#E8EAF0] bg-[#F5F6F9]">
                    <FileText className="h-5 w-5" />
                  </span>
                  <b className="text-[13.6px] font-semibold text-muted">Pick a template on the left</b>
                  <p className="m-0 max-w-[260px] text-[12.6px] leading-[1.6]">
                    {approved.length === 0
                      ? 'Once Meta approves your templates they appear here and this becomes one click.'
                      : 'Fill its variables and see the exact message that lands on their phone.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── footer ── */}
        <div className="flex flex-shrink-0 items-center gap-[11px] border-t border-[#E8EAF0] bg-[#F5F6F9] px-[22px] py-[14px]">
          <span className="min-w-0 flex-1 truncate text-[11.8px] text-muted">
            {step === 1
              ? `${rows.length} shown${onlySendable ? ' · unsendable hidden' : ''}`
              : tpl
                ? missing.length
                  ? `Fill ${missing.map((n) => `{{${n}}}`).join(', ')} before sending`
                  : tpl.category === 'UTILITY'
                    ? 'Utility — cheaper, no frequency cap'
                    : 'Marketing — subject to frequency caps'
                : windowOpen
                  ? 'Free-form message inside the open window'
                  : 'Choose an approved template to open this conversation'}
          </span>
          <div className="flex flex-shrink-0 gap-[10px]">
            <button
              onClick={onClose}
              className="rounded-[9px] border border-[#DDE0E9] bg-white px-[15px] py-[9px] text-[13.2px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9]"
            >
              Cancel
            </button>
            {step === 2 && (
              <button
                disabled={!canSend || sending}
                onClick={doSend}
                className="inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[15px] py-[9px] text-[13.2px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40"
              >
                {sending ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : null}
                {sending ? 'Sending…' : 'Send message'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: 'good' | 'warn' | 'bad' | 'plain' }) {
  const skin =
    tone === 'good' ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
      : tone === 'warn' ? 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]'
      : tone === 'bad' ? 'border-[#F8D6D6] bg-[#FEEFEF] text-[#B02B2B]'
      : 'border-[#DDE0E9] bg-white text-ink-2';
  return (
    <span className={cn('inline-flex items-baseline gap-[5px] rounded-full border px-[10px] py-[4px] text-[11.4px] font-medium', skin)}>
      <b className="text-[12.4px] font-bold tabular-nums">{n.toLocaleString()}</b>
      {label}
    </span>
  );
}
