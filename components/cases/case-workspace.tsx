'use client';

// =============================================================================
// CASE DETAILS PAGE — one client's GTV case, as a single editable page.
// -----------------------------------------------------------------------------
// Built to the design approved on 28 Sep 2026: eight numbered sections,
// white cards, green accents, one Save. Everything on the page is a draft
// until "Save changes"; Cancel (or Back) discards, and closing with unsaved
// edits asks first.
//
// WHERE THINGS LIVE
//   form            cases.journey.details  (no migration — see lib/case-details)
//   owner           cases.owner_id / owner_name
//   stage           cases.delivery_stage + current_phase (kept in sync so the
//                   client-update email still knows where the case is)
//   case notes      the lead's notes table — the same history the lead drawer
//                   shows, so pre-conversion notes are one click away
//   timeline        case_activity: each save logs exactly what was ticked,
//                   which is what "Updates here feed into the case timeline"
//                   promises
//
// AFTER A MEANINGFUL SAVE — something newly completed, the stage moved, or the
// case marked ready to file — the "tell the client?" popup offers the branded
// progress email. Nothing is ever sent without that click.
//
// The page is always drawn in its own light palette (the approved design),
// whatever the CRM's theme, because it is a document you fill in.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { CASE_STAGES, STAGE_BY_KEY, stageOf, stageIndex, stageEnteredAt, outcomeOf, OUTCOME_META, DEFAULT_CASE_OWNER, type CaseStageKey } from '@/lib/case-stages';
import {
  hydrateDetails, safeUrl, GTV_ROUTES, OC_OPTIONS,
  CLOSE_REASONS, closeReasonLabel, withDecisions, type CaseDetails, type CloseReason, type Verdict,
  tasksFor, progressFor, hydrateIfv, IFV_DOCS, IFV_CRITERIA, ENDORSING_BODIES,
  type IfvDetails, type IfvDocKey, type IfvCriterionKey,
} from '@/lib/case-details';
import { normalizeJourney } from '@/lib/journey';
import { getVisaMeta, MILESTONE_META, IFV_MILESTONE_META, isIfvVisa, milestoneLabel, type Case, type Milestone, type Note, type Payment } from '@/lib/types';
import { useUI } from '@/components/shared/app-shell';
import { initials, avatarColor, formatMoney, paymentCredit } from '@/lib/utils';
import { ArrowLeft, Calendar, Link2, Check, Send, ChevronDown, X, ExternalLink, Camera, Mail, Phone, MapPin, Plus, Download, Trash2, PauseCircle, PlayCircle, Archive, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { C } from '@/lib/case-theme';

// ── The approved palette — shared with the Cases home (lib/case-theme) ──────

// ── Small controls, drawn to the design ─────────────────────────────────────

function Box({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[5px] border transition"
      style={checked
        ? { background: C.green, borderColor: C.green, color: '#fff' }
        : { background: '#fff', borderColor: '#C6CDD6' }}>
      {checked && <Check className="h-[14px] w-[14px]" strokeWidth={3} />}
    </button>
  );
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="flex select-none items-center gap-3 text-[13.5px]" style={{ color: C.ink }}>
      <Box checked={checked} onChange={onChange} />
      <span className="cursor-pointer" onClick={() => onChange(!checked)}>{children}</span>
    </div>
  );
}

function TextField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="h-9 w-full rounded-md border px-3 text-[13px] outline-none transition placeholder:text-[#A8B0BB] focus:border-[#16A36B] focus:ring-2 focus:ring-[#16A36B]/15"
      style={{ background: C.field, borderColor: C.line, color: C.ink }} />
  );
}

/** A link field: paste a link; the icon opens it once it is a real URL. */
function LinkField({ value, onChange, placeholder = 'Paste link…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const url = safeUrl(value);
  return (
    <div className="relative w-full">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-9 w-full rounded-md border pl-3 pr-9 text-[13px] outline-none transition placeholder:text-[#A8B0BB] focus:border-[#16A36B] focus:ring-2 focus:ring-[#16A36B]/15"
        style={{ background: C.field, borderColor: C.line, color: C.ink }} />
      <button type="button" disabled={!url} onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
        title={url ? 'Open link' : 'Paste a link first'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 transition hover:bg-[#EEF9F3] disabled:cursor-default disabled:hover:bg-transparent"
        style={{ color: url ? C.greenDark : C.faint }}>
        <Link2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Icon-only link control for evidence rows — opens a small editor. */
function LinkButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const url = safeUrl(value);
  return (
    <div className="relative">
      <button type="button" onClick={() => { setDraft(value); setOpen((v) => !v); }}
        title={url ? value : 'Add a link'} aria-label="Evidence link"
        className="flex h-9 w-9 items-center justify-center rounded-md border transition hover:bg-[#EEF9F3]"
        style={{ borderColor: url ? '#A7DCC2' : C.line, color: url ? C.greenDark : C.sub, background: url ? C.greenBg : '#fff' }}>
        <Link2 className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[91] mt-1.5 w-[300px] rounded-lg border p-2.5 shadow-xl" style={{ background: '#fff', borderColor: C.line }}>
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Paste link…"
              onKeyDown={(e) => { if (e.key === 'Enter') { onChange(draft.trim()); setOpen(false); } if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
              className="h-8 w-full rounded-md border px-2.5 text-[12.5px] outline-none focus:border-[#16A36B]"
              style={{ borderColor: C.line, color: C.ink }} />
            <div className="mt-2 flex items-center gap-2">
              {url && (
                <button type="button" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: C.greenDark }}>
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </button>
              )}
              {value && (
                <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="text-[12px]" style={{ color: C.sub }}>Remove</button>
              )}
              <button type="button" onClick={() => { onChange(draft.trim()); setOpen(false); }}
                className="ml-auto h-7 rounded-md px-3 text-[12px] font-semibold text-white" style={{ background: C.green }}>Save</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DateField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="relative">
      <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
        className="h-9 w-full rounded-md border pl-3 pr-9 text-[13px] outline-none transition focus:border-[#16A36B] [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
        style={{ background: C.field, borderColor: C.line, color: value ? C.ink : C.faint }} />
      <Calendar className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.sub }} />
    </div>
  );
}

function SelectField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-md border pl-3 pr-8 text-[13px] outline-none transition focus:border-[#16A36B]"
        style={{ background: C.field, borderColor: C.line, color: C.ink }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.sub }} />
    </div>
  );
}

function Section({ n, title, hint, badge, children }: { n: number; title: string; hint?: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border px-5 py-4 sm:px-6" style={{ background: C.card, borderColor: C.line }}>
      <div className="flex items-start gap-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-bold"
          style={{ background: C.greenSoft, color: C.greenDark }}>{n}</span>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="m-0 text-[17px] font-bold" style={{ color: C.navy }}>{title}</h3>
            {hint && <span className="text-[12px]" style={{ color: C.sub }}>{hint}</span>}
            {badge && <span className="ml-auto">{badge}</span>}
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

const VERDICT_TONE: Record<Verdict, { bg: string; fg: string; border: string }> = {
  pending:  { bg: '#EEF1F4', fg: '#3D4757', border: '#C9D0D9' },
  approved: { bg: '#DDF3E8', fg: '#0E7A50', border: '#16A36B' },
  rejected: { bg: '#FBE7E2', fg: '#9A3B2A', border: '#D2583F' },
};

function DecisionCard({ title, sub, value, onChange, labels, children }: {
  title: string; sub: string; value: Verdict; onChange: (v: Verdict) => void;
  labels: Record<Verdict, string>; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: C.line, background: value === 'pending' ? C.card : VERDICT_TONE[value].bg + '66' }}>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-[14.5px] font-bold" style={{ color: C.navy }}>{title}</div>
          <div className="text-[12px]" style={{ color: C.sub }}>{sub}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg p-1" style={{ background: '#F1F4F7' }} role="radiogroup" aria-label={`${title} decision`}>
        {(['pending', 'approved', 'rejected'] as Verdict[]).map((v) => {
          const on = value === v;
          return (
            <button key={v} type="button" role="radio" aria-checked={on} onClick={() => onChange(v)}
              className="h-8 rounded-md text-[12.5px] font-semibold transition"
              style={on
                ? { background: v === 'pending' ? C.card : VERDICT_TONE[v].bg, color: VERDICT_TONE[v].fg, boxShadow: `0 0 0 1px ${VERDICT_TONE[v].border}` }
                : { color: C.sub }}>
              {v === 'approved' ? '✓ ' : v === 'rejected' ? '✕ ' : ''}{labels[v]}
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function FieldBox({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-[12px] font-semibold" style={{ color: C.sub }}>{label}</span>
      {children}
    </label>
  );
}

function Dialog({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 animate-fadeIn" onClick={onClose} />
      <div className="relative w-full max-w-[480px] rounded-2xl border bg-white p-6 shadow-2xl animate-pageIn" style={{ borderColor: C.line, colorScheme: 'light' }}>
        {children}
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, note, on, danger, onClick }: {
  icon: typeof Check; label: string; note: string; on?: boolean; danger?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left transition hover:bg-[#F4F6F8]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: danger ? '#9A3B2A' : C.sub }} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold" style={{ color: danger ? '#9A3B2A' : C.navy }}>{label}</span>
        <span className="block text-[11.5px]" style={{ color: C.faint }}>{note}</span>
      </span>
      {on && <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: C.green }} strokeWidth={2.5} />}
    </button>
  );
}

function NoteLine({ n, name }: { n: Note; name: string }) {
  return (
    <div className="mb-3 text-[13px] leading-relaxed">
      <b style={{ color: C.navy }}>{name}</b>
      <span style={{ color: C.faint }}> · {new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
      <div className="mt-0.5 whitespace-pre-wrap" style={{ color: C.sub }}>{n.body}</div>
    </div>
  );
}

/** 'YYYY-MM-DD' → an ISO timestamp at midday UTC, so the day never shifts by timezone. */
const isoDay = (day: string | null | undefined) => (day ? new Date(`${day}T12:00:00Z`).toISOString() : null);

/** Country from the dialling code — enough for the header's location line. */
const DIAL: [string, string][] = [
  ['+971', 'United Arab Emirates'], ['+966', 'Saudi Arabia'], ['+974', 'Qatar'], ['+965', 'Kuwait'],
  ['+968', 'Oman'], ['+973', 'Bahrain'], ['+880', 'Bangladesh'], ['+977', 'Nepal'], ['+94', 'Sri Lanka'],
  ['+92', 'Pakistan'], ['+91', 'India'], ['+44', 'United Kingdom'], ['+61', 'Australia'], ['+65', 'Singapore'],
  ['+60', 'Malaysia'], ['+49', 'Germany'], ['+33', 'France'], ['+31', 'Netherlands'], ['+353', 'Ireland'],
  ['+27', 'South Africa'], ['+234', 'Nigeria'], ['+254', 'Kenya'], ['+1', 'United States / Canada'],
];
function countryOf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const p = phone.replace(/[^\d+]/g, '');
  const e = p.startsWith('+') ? p : p.length === 10 ? `+91${p}` : `+${p}`;
  return DIAL.find(([code]) => e.startsWith(code))?.[1] ?? null;
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 first:pl-0 lg:first:pl-5">
      <div className="text-[12px]" style={{ color: C.sub }}>{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Innovator Founder fee phase shown on the section where it falls due, with
 * its live status from the client's payments: Paid · Invoiced · Overdue, or
 * "Due at this stage" when nothing has been raised yet.
 */
function PhaseChip({ m, pays }: { m: Milestone; pays: Payment[] }) {
  const meta = IFV_MILESTONE_META[m];
  const p = pays.find((x) => x.milestone === m);
  const tone = p?.status === 'paid' ? { bg: C.greenSoft, fg: C.greenDark, txt: 'Paid ✓' }
    : p?.status === 'overdue' ? { bg: '#FBE7E2', fg: '#9A3B2A', txt: 'Overdue' }
    : p ? { bg: '#FBF1DD', fg: '#8A5A12', txt: 'Invoiced' }
    : { bg: '#EEF1F4', fg: '#3D4757', txt: 'Due at this stage' };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
      style={{ background: tone.bg, color: tone.fg }} title={`${meta.long} · £${meta.gbp.toLocaleString('en-GB')}`}>
      £{meta.gbp.toLocaleString('en-GB')} · {meta.label}<span style={{ opacity: 0.75 }}>· {tone.txt}</span>
    </span>
  );
}

function PaymentLine({ p, currency, visa }: { p: Payment; currency: string; visa: string | null }) {
  const tone = p.status === 'paid'
    ? { bg: C.greenSoft, fg: C.greenDark, label: 'Paid' }
    : p.status === 'overdue'
      ? { bg: '#FBE7E2', fg: '#9A3B2A', label: 'Overdue' }
      : { bg: '#FBF1DD', fg: '#8A5A12', label: 'Pending' };
  const when = p.paid_at || p.due_date;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 last:border-0" style={{ borderColor: C.lineSoft }}>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold" style={{ color: C.navy }}>{milestoneLabel(p.milestone, visa, p.created_at)}</div>
        <div className="text-[12px]" style={{ color: C.sub }}>
          {p.status === 'paid' ? 'Paid' : 'Due'} {when ? new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
          {p.note ? ` · ${p.note}` : ''}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-bold tabular-nums" style={{ color: C.navy }}>{formatMoney(p.amount, p.currency || currency)}</div>
        {(p.currency || currency) !== currency && (
          <div className="text-[11px] tabular-nums" style={{ color: C.sub }}>counts as {formatMoney(Math.round(paymentCredit(p, currency)), currency)}</div>
        )}
      </div>
      <span className="rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span>
      <a href={`/api/invoice/pdf?paymentId=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener noreferrer"
        title={p.status === 'paid' ? 'Receipt PDF' : 'Invoice PDF'}
        className="rounded-md p-1.5 transition hover:bg-[#EEF9F3]" style={{ color: C.greenDark }}>
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export function CaseWorkspace({ caseId, onClose }: { caseId: string | null; onClose: () => void }) {
  const {
    cases, leads, payments, members, memberNameById, user,
    updateCaseJourney, updateCase, sendClientUpdate, getNotes, addNote,
  } = useApp();
  // The signed-in user reads as "You" elsewhere in the CRM; here the owner is a real person.
  const personName = (id: string) => (id === DEFAULT_CASE_OWNER.id ? DEFAULT_CASE_OWNER.name
    : id === user.id ? user.name || memberNameById(id) : memberNameById(id));
  const ui = useUI();
  const supabase = createClient();

  const c = cases.find((x) => x.id === caseId) || null;
  const lead = c?.lead_id ? leads.find((l) => l.id === c.lead_id) || null : null;

  // ALL hooks sit above the early return below, so the hook count never
  // changes between "no case open" and "case open" (the crash of 28 Sep).
  const saved = useMemo(() => {
    const base = hydrateDetails((c?.journey as { details?: unknown } | null | undefined)?.details);
    return c ? withDecisions(base, c) : base;
  }, [c]);
  const [d, setD] = useState<CaseDetails>(saved);
  const [owner, setOwner] = useState<string>(c?.owner_id ?? '');
  const [stage, setStage] = useState<CaseStageKey>(c ? stageOf(c) : 'case_created');
  // The case's visa can be switched on the page (Route box). Innovator Founder
  // cases get their own checklist — it follows the selection immediately.
  const [caseVisa, setCaseVisa] = useState<string>(c?.visa_type ?? '');
  const ifvCase = isIfvVisa(caseVisa);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [askDiscard, setAskDiscard] = useState(false);
  const [emailAsk, setEmailAsk] = useState<{ summary: string; note: string } | null>(null);
  const [sending, setSending] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoBroken, setPhotoBroken] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [statusMenu, setStatusMenu] = useState(false);
  const [closeAsk, setCloseAsk] = useState<{ reason: CloseReason | null; note: string } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const menuRef = useRef(false);
  menuRef.current = statusMenu;

  // Re-seed the working copy whenever a different case opens.
  useEffect(() => {
    if (!c) { loadedFor.current = null; return; }
    if (loadedFor.current === c.id) return;
    loadedFor.current = c.id;
    setD(withDecisions(hydrateDetails((c.journey as { details?: unknown } | null)?.details), c));
    setOwner(c.owner_id ?? '');
    setStage(stageOf(c));
    setCaseVisa(c.visa_type ?? '');
    setNoteDraft(''); setEmailAsk(null); setAskDiscard(false); setPhotoBroken(false);
    setStatusMenu(false); setCloseAsk(null);
  }, [c]);

  useEffect(() => {
    if (!c?.lead_id) { setNotes([]); return; }
    void getNotes(c.lead_id).then(setNotes);
  }, [c?.lead_id, getNotes]);

  const progress = useMemo(() => progressFor(d, ifvCase), [d, ifvCase]);
  const dirty = useMemo(() => {
    if (!c) return false;
    return JSON.stringify(d) !== JSON.stringify(saved) || owner !== (c.owner_id ?? '') || stage !== stageOf(c)
      || caseVisa !== (c.visa_type ?? '');
  }, [c, d, saved, owner, stage, caseVisa]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blockedRef = useRef(false);
  blockedRef.current = !!emailAsk || askDiscard || !!closeAsk;

  useEffect(() => {
    if (!caseId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || blockedRef.current) return;
      if (menuRef.current) { setStatusMenu(false); return; }
      // Something is open ON TOP of this page (Record payment, or any other
      // CRM dialog): Esc belongs to it. Closing the case underneath as well
      // would throw the person out of the case they were working in.
      if (document.querySelector('.z-\\[80\\]')) return;
      if (dirtyRef.current) setAskDiscard(true); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [caseId, onClose]);

  if (!caseId || !c) return null;

  const requestClose = () => { if (dirty) setAskDiscard(true); else onClose(); };

  const set = <K extends keyof CaseDetails>(k: K, v: CaseDetails[K]) => setD((p) => ({ ...p, [k]: v }));
  const setLor = (i: number, patch: Partial<CaseDetails['lors'][number]>) =>
    setD((p) => ({ ...p, lors: p.lors.map((l, j) => (j === i ? { ...l, ...patch } : l)) as CaseDetails['lors'] }));
  const setMc = (i: number, patch: Partial<CaseDetails['mc'][number]>) =>
    setD((p) => ({ ...p, mc: p.mc.map((m, j) => (j === i ? { ...m, ...patch } : m)) as CaseDetails['mc'] }));
  const setOc = (i: number, patch: Partial<CaseDetails['oc'][number]>) =>
    setD((p) => ({ ...p, oc: p.oc.map((o, j) => (j === i ? { ...o, ...patch } : o)) as CaseDetails['oc'] }));
  const setEv = (i: number, e: number, patch: Partial<CaseDetails['oc'][number]['evidence'][number]>) =>
    setD((p) => ({
      ...p,
      oc: p.oc.map((o, j) => (j === i
        ? { ...o, evidence: o.evidence.map((x, k) => (k === e ? { ...x, ...patch } : x)) as CaseDetails['oc'][number]['evidence'] }
        : o)) as CaseDetails['oc'],
    }));
  const pickOc = (i: number, code: string) => {
    const prev = OC_OPTIONS.find((o) => o.code === d.oc[i].code);
    const next = OC_OPTIONS.find((o) => o.code === code);
    // Keep a hand-written title; replace only the default one.
    const keepTitle = d.oc[i].title && d.oc[i].title !== prev?.title;
    setOc(i, { code, title: keepTitle ? d.oc[i].title : next?.title ?? '' });
  };

  const allDone = progress.done === progress.total;
  const driveUrl = safeUrl(d.drive_url);
  const canvaUrl = safeUrl(d.canva_url);
  const visa = getVisaMeta(c.visa_type);
  const isIfv = ifvCase;
  const iv = hydrateIfv(d.ifv);
  const setIfv = (patch: Partial<IfvDetails>) => setD((p) => ({ ...p, ifv: { ...hydrateIfv(p.ifv), ...patch } }));
  const setIfvDoc = (k: IfvDocKey, patch: Partial<IfvDetails['docs'][IfvDocKey]>) =>
    setD((p) => { const v = hydrateIfv(p.ifv); return { ...p, ifv: { ...v, docs: { ...v.docs, [k]: { ...v.docs[k], ...patch } } } }; });
  const setIfvCrit = (k: IfvCriterionKey, patch: Partial<IfvDetails['criteria'][IfvCriterionKey]>) =>
    setD((p) => { const v = hydrateIfv(p.ifv); return { ...p, ifv: { ...v, criteria: { ...v.criteria, [k]: { ...v.criteria[k], ...patch } } } }; });
  // Visa must be applied for within 3 months of the endorsement letter.
  const visaDeadline = isIfv && d.endorsement === 'approved' && d.endorsement_decided_on && (d.visa ?? 'pending') === 'pending' && !d.visa_applied_on
    ? (() => { const x = new Date(`${d.endorsement_decided_on}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 3); return x; })()
    : null;

  // Every write moves cases.updated_at, which "days in stage" falls back to
  // until migration 124 adds its own column. Pinning the real stage start in
  // the form first keeps health (On track / At risk / Overdue) truthful.
  const pinStage = (x: CaseDetails): CaseDetails => ({ ...x, stage_entered_at: x.stage_entered_at || stageEnteredAt(c) });

  const save = async (opts?: { readyToFile?: boolean }) => {
    setSaving(true);
    const nowIso = new Date().toISOString();
    const before = tasksFor(saved, ifvCase);
    let next: CaseDetails = { ...d };
    let nextStage = stage;
    if (opts?.readyToFile) {
      next = { ...next, ready_to_file_at: nowIso };
      nextStage = 'submission';
    }
    // Decisions (section 9). A decision without a date gets today's; going
    // back to pending clears it. A granted visa completes the case, and a
    // first submission date moves an earlier case to Awaiting Decision.
    const today = nowIso.slice(0, 10);
    const endChanged = (next.endorsement ?? 'pending') !== (saved.endorsement ?? 'pending');
    const visaChanged = (next.visa ?? 'pending') !== (saved.visa ?? 'pending');
    if (endChanged) next = { ...next, endorsement_decided_on: next.endorsement === 'pending' ? null : next.endorsement_decided_on || today };
    if (visaChanged) next = { ...next, visa_decided_on: next.visa === 'pending' ? null : next.visa_decided_on || today };
    if (visaChanged && next.visa === 'approved') nextStage = 'completed';
    else if (next.endorsement_submitted_on && !saved.endorsement_submitted_on && stageIndex(nextStage) < stageIndex('awaiting_decision')) {
      nextStage = 'awaiting_decision';
    }
    const stageMoved = nextStage !== stageOf(c);
    if (stageMoved) next = { ...next, stage_entered_at: nowIso };
    else next = pinStage(next);

    const newlyDone = tasksFor(next, ifvCase)
      .filter((t) => t.done && !before.find((b) => b.key === t.key)?.done)
      .map((t) => t.label);
    const target = STAGE_BY_KEY[nextStage];
    const journey = { ...normalizeJourney(c.journey), details: next };

    const extra = {
      visa_type: caseVisa || c.visa_type,
      owner_id: owner || null,
      owner_name: owner ? personName(owner) : null,
      delivery_stage: nextStage,
      current_phase: target.phase,
      // A paused case stays paused when its form is saved.
      status: nextStage === 'completed' ? 'completed' : c.status === 'on_hold' ? 'on_hold' : 'active',
      completed_at: nextStage === 'completed' ? (c.completed_at || nowIso) : null,
      endorsement_status: next.endorsement ?? 'pending',
      submission_ref: next.endorsement_ref?.trim() || null,
      endorsement_submitted_at: isoDay(next.endorsement_submitted_on),
      endorsement_approved_at: next.endorsement === 'approved' ? isoDay(next.endorsement_decided_on) : null,
      visa_status: next.visa ?? 'pending',
      visa_submitted_at: isoDay(next.visa_applied_on),
      visa_approved_at: next.visa === 'approved' ? isoDay(next.visa_decided_on) : null,
    } as Partial<Case>;

    await updateCaseJourney(c.id, journey, extra);

    // Timeline: exactly what changed, in words.
    const summary: string[] = [];
    if (newlyDone.length) summary.push(`Completed: ${newlyDone.join(', ')}`);
    if (stageMoved) summary.push(`Stage → ${target.label}`);
    const visaSwitched = isIfvVisa(caseVisa) !== isIfvVisa(c.visa_type);
    if (visaSwitched) summary.push(`Visa → ${isIfvVisa(caseVisa) ? 'Innovator Founder Visa' : 'Global Talent Visa'}`);
    if (opts?.readyToFile) summary.push('Marked ready to file the endorsement application');
    if (endChanged && next.endorsement !== 'pending') summary.push(next.endorsement === 'approved' ? 'Endorsement approved' : 'Endorsement refused');
    if (visaChanged && next.visa !== 'pending') summary.push(next.visa === 'approved' ? 'Visa granted' : 'Visa refused');
    if (summary.length || JSON.stringify(d) !== JSON.stringify(saved)) {
      await supabase.from('case_activity').insert({
        workspace_id: c.workspace_id, case_id: c.id, user_id: user.id, action: 'details_updated',
        meta: {
          completed: newlyDone, stage_from: stageOf(c), stage_to: nextStage,
          ready_to_file: !!opts?.readyToFile, progress: progressFor(next, ifvCase).pct,
          endorsement: next.endorsement ?? 'pending', visa: next.visa ?? 'pending',
        },
      });
    }

    setD(next);
    setStage(nextStage);
    setSaving(false);
    toast.success('Case saved');

    if (newlyDone.length || stageMoved || opts?.readyToFile || (endChanged && next.endorsement !== 'pending') || (visaChanged && next.visa !== 'pending')) {
      setEmailAsk({ summary: summary.join(' · '), note: '' });
    }
  };

  // ── Case status: Active · Paused · Closed ────────────────────────────────
  // Paused is cases.status = 'on_hold'. Closed is cases.archived_at, with the
  // reason kept in the case form. Neither deletes anything or contacts the
  // client; both are one click to undo, and both land on the timeline.
  const isClosed = !!c.archived_at;
  const logStatus = (action: string, meta: Record<string, unknown>) =>
    supabase.from('case_activity').insert({ workspace_id: c.workspace_id, case_id: c.id, user_id: user.id, action, meta });

  const setPaused = async (paused: boolean) => {
    setStatusMenu(false);
    if (paused === (c.status === 'on_hold')) return;
    setStatusBusy(true);
    // updateCase already writes a status_changed entry to the timeline.
    await updateCase(c.id, { status: paused ? 'on_hold' : 'active' } as Partial<Case>);
    setStatusBusy(false);
    toast.success(paused ? `${c.client_name}'s case is paused` : `${c.client_name}'s case is active again`);
  };

  const closeCase = async () => {
    if (!closeAsk?.reason) return;
    if (dirty) { toast.error('Save or discard your changes first'); return; }
    setStatusBusy(true);
    const nowIso = new Date().toISOString();
    const journey = {
      ...normalizeJourney(c.journey),
      details: pinStage({ ...saved, closed_reason: closeAsk.reason, closed_note: closeAsk.note.trim() || null, closed_at: nowIso }),
    };
    await updateCaseJourney(c.id, journey, { archived_at: nowIso } as Partial<Case>);
    await logStatus('case_closed', { reason: closeAsk.reason, note: closeAsk.note.trim() || null });
    setStatusBusy(false);
    setCloseAsk(null);
    toast.success(`${c.client_name} moved to Closed cases`);
    onClose();
  };

  const reopenCase = async () => {
    setStatusMenu(false);
    setStatusBusy(true);
    const journey = { ...normalizeJourney(c.journey), details: pinStage({ ...saved, closed_reason: null, closed_note: null, closed_at: null }) };
    await updateCaseJourney(c.id, journey, { archived_at: null, status: 'active' } as Partial<Case>);
    await logStatus('case_reopened', { was: saved.closed_reason ?? null });
    setD((p) => ({ ...p, closed_reason: null, closed_note: null, closed_at: null }));
    setStatusBusy(false);
    toast.success(`${c.client_name}'s case is open again`);
  };

  const pill = isClosed
    ? { label: `Closed · ${closeReasonLabel(saved.closed_reason)}`, bg: '#FBE7E2', fg: '#9A3B2A' }
    : stage === 'completed'
      ? { label: 'Completed', bg: '#E8EEDD', fg: '#2E4115' }
      : c.status === 'on_hold'
        ? { label: 'Paused', bg: '#FBF1DD', fg: '#8A5A12' }
        : { label: 'Active Case', bg: C.greenSoft, fg: C.greenDark };

  // A photo is saved the moment it is chosen — waiting for "Save changes"
  // would leave an uploaded file the case does not point at. The draft gets
  // the same path, so a later Save cannot write the old value back.
  const recordPhoto = async (path: string | null) => {
    const journey = { ...normalizeJourney(c.journey), details: pinStage({ ...saved, photo_path: path }) };
    await updateCaseJourney(c.id, journey);
    setD((p) => ({ ...p, photo_path: path }));
    setPhotoBroken(false);
  };

  const uploadPhoto = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.error('Use a JPG, PNG or WebP image'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image is larger than 5 MB'); return; }
    setPhotoBusy(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch(`/api/case/photo/${c.id}`, { method: 'POST', body: fd });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { toast.error(j?.reason || 'Upload failed'); return; }
      await recordPhoto(j.path);
      toast.success('Photo updated');
    } finally { setPhotoBusy(false); }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await fetch(`/api/case/photo/${c.id}`, { method: 'DELETE' });
      await recordPhoto(null);
      toast.success('Photo removed');
    } finally { setPhotoBusy(false); }
  };

  // Notes save on their own, straight into the lead's note history.
  const saveNote = async () => {
    const body = noteDraft.trim();
    if (!body || !c.lead_id) return;
    setSavingNote(true);
    await addNote(c.lead_id, body);
    setNotes(await getNotes(c.lead_id));
    setNoteDraft('');
    setSavingNote(false);
  };

  const sendUpdate = async () => {
    if (!emailAsk) return;
    setSending(true);
    const ok = await sendClientUpdate(c.id, emailAsk.note.trim() || undefined);
    setSending(false);
    if (ok) setEmailAsk(null);
  };

  const preCut = c.created_at;
  const email = c.client_email || lead?.email || null;
  const phoneNo = c.client_phone || lead?.phone || null;
  const country = countryOf(phoneNo);
  const targetLeft = d.target_date
    ? Math.ceil((new Date(d.target_date).getTime() - Date.now()) / 86_400_000)
    : null;
  const leadPayments = c.lead_id
    ? payments.filter((p) => p.lead_id === c.lead_id)
        .sort((a, b) => (MILESTONE_META[a.milestone]?.order ?? 9) - (MILESTONE_META[b.milestone]?.order ?? 9))
    : [];
  const currency = lead?.currency || 'INR';
  // In the client's billing currency — each payment converted (migration 126).
  const collected = Math.round(leadPayments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + paymentCredit(p, currency), 0));
  const billed = Math.round(leadPayments.reduce((sum, p) => sum + paymentCredit(p, currency), 0));

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div onClick={requestClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-fadeIn" />
      <div className="relative flex h-full w-full max-w-[1120px] flex-col shadow-2xl animate-pageIn"
        style={{ background: C.page, color: C.ink, colorScheme: 'light' }}>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1000px] px-4 pb-6 pt-5 sm:px-8">

            {/* ── Brand · back · Drive / Canva ─────────────────────────────── */}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-extrabold tracking-[0.08em]" style={{ color: C.navy }}>MIGRIZO</div>
                <button type="button" onClick={requestClose}
                  className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium hover:underline" style={{ color: C.greenDark }}>
                  <ArrowLeft className="h-4 w-4" /> Back to case timeline
                </button>
              </div>
              <a href={driveUrl ?? undefined} target="_blank" rel="noopener noreferrer"
                onClick={(e) => { if (!driveUrl) { e.preventDefault(); toast.info('Paste the Drive folder link in section 2 first'); } }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[13px] font-semibold transition hover:shadow-sm"
                style={{ background: '#fff', borderColor: '#D5DBE3', color: C.navy, opacity: driveUrl ? 1 : 0.65 }}>
                <svg viewBox="0 0 87.3 78" className="h-[16px] w-[18px]" aria-hidden>
                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                  <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 0 0 0 53h27.5z" fill="#00ac47"/>
                  <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335"/>
                  <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                  <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                  <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                </svg>
                <span className="hidden sm:inline">Open Drive</span>
              </a>
              <a href={canvaUrl ?? undefined} target="_blank" rel="noopener noreferrer"
                onClick={(e) => { if (!canvaUrl) { e.preventDefault(); toast.info('Paste the Canva link in section 7 first'); } }}
                className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[13px] font-semibold transition hover:shadow-sm"
                style={{ background: '#fff', borderColor: '#D5DBE3', color: C.navy, opacity: canvaUrl ? 1 : 0.65 }}>
                <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full text-[11px] font-bold italic text-white"
                  style={{ background: 'linear-gradient(135deg,#00C4CC,#7D2AE8)' }}>C</span>
                <span className="hidden sm:inline">Open Canva</span>
              </a>
              <button type="button" onClick={requestClose} aria-label="Close"
                className="rounded-lg p-2 transition hover:bg-black/5" style={{ color: C.sub }}><X className="h-5 w-5" /></button>
            </div>

            {isClosed && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3" style={{ background: '#FDF4F1', borderColor: '#F0CFC5' }}>
                <Archive className="h-4 w-4 shrink-0" style={{ color: '#9A3B2A' }} />
                <div className="min-w-0 flex-1 text-[13px]" style={{ color: C.ink }}>
                  <b style={{ color: '#9A3B2A' }}>Closed · {closeReasonLabel(saved.closed_reason)}</b>
                  {saved.closed_at && <span style={{ color: C.sub }}> on {new Date(saved.closed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  {saved.closed_note && <span className="block" style={{ color: C.sub }}>{saved.closed_note}</span>}
                </div>
                <button type="button" onClick={() => void reopenCase()} disabled={statusBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-[13px] font-semibold" style={{ borderColor: '#D5DBE3', color: C.navy }}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reopen case
                </button>
              </div>
            )}

            {/* ── Client header card ──────────────────────────────────────── */}
            <div className="mt-4 flex flex-col gap-4 rounded-2xl border px-5 py-4 sm:px-6 lg:flex-row lg:items-center"
              style={{ background: C.card, borderColor: C.line, boxShadow: '0 1px 2px rgba(15,31,61,0.04)' }}>
              <div className="flex min-w-0 flex-1 items-center gap-4">
                {/* Photo — or initials — with upload on hover / tap */}
                <div className="group relative shrink-0">
                  <div className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full text-[25px] font-bold text-white"
                    style={{ background: avatarColor(c.client_name), boxShadow: '0 0 0 4px #fff, 0 0 0 5px ' + C.line }}>
                    {d.photo_path && !photoBroken ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/case/photo/${c.id}?v=${encodeURIComponent(d.photo_path)}`} alt={c.client_name}
                        onError={() => setPhotoBroken(true)} className="h-full w-full object-cover" />
                    ) : initials(c.client_name)}
                  </div>
                  <button type="button" disabled={photoBusy} onClick={() => fileRef.current?.click()}
                    aria-label={d.photo_path ? 'Change photo' : 'Upload photo'}
                    className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/45 text-[10.5px] font-semibold text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100">
                    <Camera className="mb-0.5 h-4 w-4" />{photoBusy ? 'Uploading…' : d.photo_path ? 'Change' : 'Upload'}
                  </button>
                  <button type="button" disabled={photoBusy} onClick={() => fileRef.current?.click()}
                    aria-label="Upload photo"
                    className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-white shadow"
                    style={{ background: C.green }}>
                    <Camera className="h-3 w-3" />
                  </button>
                  {d.photo_path && (
                    <button type="button" disabled={photoBusy} onClick={() => void removePhoto()} aria-label="Remove photo" title="Remove photo"
                      className="absolute -top-1 right-0 hidden h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white text-[#9A3B2A] shadow group-hover:flex">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadPhoto(f); }} />
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h1 className="m-0 break-words text-[22px] font-extrabold leading-tight tracking-tight sm:text-[25px]" style={{ color: C.navy }}>{c.client_name}</h1>
                    <span className="relative shrink-0">
                      <button type="button" onClick={() => setStatusMenu((v) => !v)} disabled={statusBusy}
                        aria-haspopup="menu" aria-expanded={statusMenu} title="Change case status"
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full py-[3px] pl-2.5 pr-1.5 text-[11.5px] font-semibold transition hover:brightness-95"
                        style={{ background: pill.bg, color: pill.fg }}>
                        {pill.label}<ChevronDown className="h-3.5 w-3.5 opacity-70" />
                      </button>
                      {statusMenu && (
                        <>
                          <span className="fixed inset-0 z-10" onClick={() => setStatusMenu(false)} />
                          <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-20 w-[244px] overflow-hidden rounded-xl border bg-white py-1.5 shadow-xl"
                            style={{ borderColor: C.line }}>
                            {isClosed ? (
                              <MenuItem icon={RotateCcw} label="Reopen case" note="Back to the active list" onClick={() => void reopenCase()} />
                            ) : (
                              <>
                                <MenuItem icon={PlayCircle} label="Active" note="Work in progress" on={c.status !== 'on_hold'} onClick={() => void setPaused(false)} />
                                <MenuItem icon={PauseCircle} label="Paused" note="Client on a break — resumes later" on={c.status === 'on_hold'} onClick={() => void setPaused(true)} />
                                <div className="my-1.5 border-t" style={{ borderColor: C.lineSoft }} />
                                <MenuItem icon={Archive} label="Close case…" note="Backed out, refunded, refused" danger
                                  onClick={() => { setStatusMenu(false); setCloseAsk({ reason: null, note: '' }); }} />
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </span>
                    {(() => {
                      const o = outcomeOf(c);
                      if (!o || o === 'awaiting') return null;
                      const m = OUTCOME_META[o];
                      return (
                        <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
                          style={{ background: m.bg, color: m.fg }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />{m.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.8px]" style={{ color: C.ink }}>
                    {email && <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 hover:underline"><Mail className="h-3.5 w-3.5" style={{ color: C.sub }} />{email}</a>}
                    {phoneNo && <a href={`tel:${phoneNo.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5" style={{ color: C.sub }} />{phoneNo}</a>}
                    {country && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" style={{ color: C.sub }} />{country}</span>}
                  </div>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-3 border-t pt-3 lg:border-l lg:border-t-0 lg:pt-0"
                style={{ borderColor: C.line }}>
                <MetaCell label="Case Owner">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: owner ? avatarColor(personName(owner)) : '#C3CAD3' }}>{owner ? initials(personName(owner)) : '?'}</span>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-semibold" style={{ color: C.navy }}>{owner ? personName(owner) : 'Unassigned'}</div>
                      <div className="text-[11.5px]" style={{ color: C.sub }}>Case Manager</div>
                    </div>
                  </div>
                </MetaCell>
                <MetaCell label="Created On">
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[13.5px] font-semibold" style={{ color: C.navy }}>
                    <Calendar className="h-4 w-4" style={{ color: C.sub }} />
                    {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </MetaCell>
                <MetaCell label="Target Submission">
                  {d.target_date ? (
                    <>
                      <div className="flex items-center gap-1.5 whitespace-nowrap text-[13.5px] font-semibold" style={{ color: C.navy }}>
                        <Calendar className="h-4 w-4" style={{ color: C.sub }} />
                        {new Date(d.target_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                      <span className="mt-1 inline-block rounded-md px-2 py-[2px] text-[12px] font-semibold"
                        style={targetLeft! < 0 ? { background: '#FBE7E2', color: '#9A3B2A' }
                          : targetLeft! <= 14 ? { background: '#FBF1DD', color: '#8A5A12' }
                          : { background: C.greenSoft, color: C.greenDark }}>
                        {targetLeft! < 0 ? `${-targetLeft!} days overdue` : `${targetLeft} days left`}
                      </span>
                    </>
                  ) : (
                    <div className="text-[13px]" style={{ color: C.faint }}>Set below</div>
                  )}
                </MetaCell>
              </div>
            </div>

            {/* ── Route · owner · stage · target filing date ───────────────── */}
            <div className="mt-5 grid gap-3 rounded-xl border px-5 py-4 sm:grid-cols-2 lg:grid-cols-4"
              style={{ background: C.card, borderColor: C.line }}>
              <div className="flex items-center gap-3 text-[13px] font-semibold" style={{ color: C.navy }}>
                <span className="shrink-0">Route:</span>
                <div className="min-w-0 flex-1">
                  {/* One box for the visa and its route: the three GTV routes,
                      or Innovator Founder — which switches the checklist. */}
                  <SelectField value={isIfv ? 'ifv' : d.route}
                    onChange={(v) => {
                      if (v === 'ifv') { setCaseVisa('Innovator Founder Visa'); return; }
                      if (isIfv) setCaseVisa('Global Talent Visa');
                      set('route', v);
                    }}
                    options={[...GTV_ROUTES.map((r) => ({ value: r.value, label: `GTV · ${r.label}` })), { value: 'ifv', label: 'Innovator Founder Visa' }]} />
                </div>
              </div>
              <div className="flex items-center gap-3 text-[13px] font-semibold" style={{ color: C.navy }}>
                <span className="shrink-0">Case owner:</span>
                <div className="min-w-0 flex-1">
                  <SelectField value={owner} onChange={setOwner}
                    options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.user_id, label: personName(m.user_id) }))]} />
                </div>
              </div>
              <div className="flex items-center gap-3 text-[13px] font-semibold" style={{ color: C.navy }}>
                <span className="shrink-0">Stage:</span>
                <div className="min-w-0 flex-1">
                  <SelectField value={stage} onChange={(v) => setStage(v as CaseStageKey)}
                    options={CASE_STAGES.map((s, i) => ({ value: s.key, label: `${i + 1}. ${s.label}` }))} />
                </div>
              </div>
              <div className="flex items-center gap-3 text-[13px] font-semibold" style={{ color: C.navy }}>
                <span className="shrink-0">Target filing date:</span>
                <div className="min-w-0 flex-1"><DateField value={d.target_date} onChange={(v) => set('target_date', v)} /></div>
              </div>
            </div>

            {/* ── Progress ────────────────────────────────────────────────── */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-5 py-3.5"
              style={{ background: C.card, borderColor: C.line }}>
              <div className="text-[15px]" style={{ color: C.navy }}>
                <b className="text-[16px]">{progress.pct}% complete</b>
                <span style={{ color: C.sub }}> · {progress.done} of {progress.total} tasks</span>
              </div>
              <div className="h-2.5 min-w-[160px] flex-1 overflow-hidden rounded-full" style={{ background: '#E6EBF0' }}>
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${progress.pct}%`, background: C.green }} />
              </div>
              <div className="text-[12px]" style={{ color: C.sub }}>Updates here feed into the case timeline.</div>
            </div>

            <div className="mt-3 flex flex-col gap-3">

              {/* 1 · Onboarding */}
              <Section n={1} title="Onboarding" badge={isIfv ? <PhaseChip m="kickstart" pays={leadPayments} /> : undefined}>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <CheckRow checked={d.onboarded} onChange={(v) => set('onboarded', v)}>Client onboarded</CheckRow>
                  <div className="ml-auto flex items-center gap-3 text-[13px]" style={{ color: C.ink }}>
                    Onboarding date (optional)
                    <div className="w-[170px]"><DateField value={d.onboarded_at} onChange={(v) => set('onboarded_at', v)} /></div>
                  </div>
                </div>
              </Section>

              {/* IFV 2 · Founder & business idea */}
              {isIfv && (
                <Section n={2} title="Founder & business idea" hint="We develop the business idea with the founder.">
                  <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                    <CheckRow checked={iv.founder_reviewed} onChange={(v) => setIfv({ founder_reviewed: v })}>Founder profile reviewed</CheckRow>
                    <CheckRow checked={iv.idea_developed} onChange={(v) => setIfv({ idea_developed: v })}>Business idea developed with the founder</CheckRow>
                    <CheckRow checked={iv.english_b2} onChange={(v) => setIfv({ english_b2: v })}>English (B2) evidence confirmed</CheckRow>
                    <CheckRow checked={iv.funds_checked} onChange={(v) => setIfv({ funds_checked: v })}>Maintenance funds checked</CheckRow>
                  </div>
                  <div className="mt-3.5 flex flex-wrap items-center gap-3 text-[13px]" style={{ color: C.ink }}>
                    <span className="shrink-0 font-semibold" style={{ color: C.navy }}>Business idea</span>
                    <div className="min-w-[260px] flex-1">
                      <TextField value={iv.idea_title} onChange={(v) => setIfv({ idea_title: v })} placeholder="One line — e.g. AI compliance platform for UK care homes" />
                    </div>
                  </div>
                </Section>
              )}

              {/* 2 · Documents in Drive (IFV: 3) */}
              <Section n={isIfv ? 3 : 2} title="Documents in Drive">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                  <CheckRow checked={d.docs_received} onChange={(v) => set('docs_received', v)}>All required documents received and checked</CheckRow>
                  <div className="ml-auto flex min-w-[280px] flex-1 items-center gap-3 text-[13px] sm:max-w-[520px]" style={{ color: C.ink }}>
                    <span className="shrink-0">Drive folder link</span>
                    <LinkField value={d.drive_url} onChange={(v) => set('drive_url', v)} placeholder="Paste Drive folder link…" />
                  </div>
                </div>
              </Section>

              {!isIfv && (<>
              {/* 3 · Letters of recommendation */}
              <Section n={3} title="Letters of recommendation">
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: C.line }}>
                  <table className="w-full border-collapse text-[13px]" style={{ minWidth: 640 }}>
                    <thead>
                      <tr style={{ background: C.tableHead }}>
                        {['Letter', 'Recommender', 'Identified', 'Drafted', 'Signed', 'Document link'].map((h, i) => (
                          <th key={h} className="px-3 py-2 text-[12px] font-bold"
                            style={{ color: C.navy, borderBottom: `1px solid ${C.line}`, textAlign: i >= 2 && i <= 4 ? 'center' : 'left', borderLeft: i ? `1px solid ${C.lineSoft}` : undefined }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.lors.map((l, i) => (
                        <tr key={i} style={{ borderTop: i ? `1px solid ${C.lineSoft}` : undefined }}>
                          <td className="px-3 py-2 font-medium" style={{ color: C.ink, width: 70 }}>LoR {i + 1}</td>
                          <td className="px-3 py-2" style={{ borderLeft: `1px solid ${C.lineSoft}` }}>
                            <TextField value={l.name} onChange={(v) => setLor(i, { name: v })} placeholder={`Recommender ${'ABC'[i]}`} />
                          </td>
                          {(['identified', 'drafted', 'signed'] as const).map((k) => (
                            <td key={k} className="px-3 py-2" style={{ borderLeft: `1px solid ${C.lineSoft}`, width: 92 }}>
                              <div className="flex justify-center"><Box checked={l[k]} onChange={(v) => setLor(i, { [k]: v })} label={`LoR ${i + 1} ${k}`} /></div>
                            </td>
                          ))}
                          <td className="px-3 py-2" style={{ borderLeft: `1px solid ${C.lineSoft}`, width: 230 }}>
                            <LinkField value={l.link} onChange={(v) => setLor(i, { link: v })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* 4 · Criteria & evidence */}
              <Section n={4} title="Criteria & evidence" hint="Edit evidence descriptions. Criterion number and title are editable.">
                <div className="overflow-x-auto rounded-lg border p-4" style={{ borderColor: C.line }}>
                  <div className="grid min-w-[560px] grid-cols-[56px_1fr_80px_220px] items-center gap-x-3 gap-y-2.5">
                    <div className="col-span-2 text-[13.5px] font-bold" style={{ color: C.navy }}>Mandatory criteria</div>
                    <div className="text-center text-[12px] font-bold" style={{ color: C.navy }}>Complete</div>
                    <div className="text-[12px] font-bold" style={{ color: C.navy }}>Document link</div>
                    {d.mc.map((m, i) => (
                      <div key={i} className="contents">
                        <div className="text-[13px] font-bold" style={{ color: C.navy }}>MC{i + 1}</div>
                        <TextField value={m.title} onChange={(v) => setMc(i, { title: v })} />
                        <div className="flex justify-center"><Box checked={m.done} onChange={(v) => setMc(i, { done: v })} label={`MC${i + 1} complete`} /></div>
                        <LinkField value={m.link} onChange={(v) => setMc(i, { link: v })} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {d.oc.map((o, i) => (
                    <div key={i} className="rounded-lg border p-4" style={{ borderColor: C.line }}>
                      <div className="text-[13.5px] font-bold" style={{ color: C.navy }}>Optional criterion {i + 1}</div>
                      <div className="mt-2.5 flex gap-2.5">
                        <div className="w-[96px] shrink-0">
                          <SelectField value={o.code} onChange={(v) => pickOc(i, v)} options={OC_OPTIONS.map((x) => ({ value: x.code, label: x.code }))} />
                        </div>
                        <TextField value={o.title} onChange={(v) => setOc(i, { title: v })} />
                      </div>
                      {o.evidence.map((e, j) => (
                        <div key={j} className="mt-2.5 grid grid-cols-[72px_1fr_24px_36px] items-center gap-2.5">
                          <span className="text-[13px]" style={{ color: C.ink }}>Evidence {j + 1}</span>
                          <TextField value={e.text} onChange={(v) => setEv(i, j, { text: v })} placeholder="Describe evidence…" />
                          <Box checked={e.done} onChange={(v) => setEv(i, j, { done: v })} label={`${o.code} evidence ${j + 1} done`} />
                          <LinkButton value={e.link} onChange={(v) => setEv(i, j, { link: v })} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </Section>

              {/* 5 · CV & personal statement */}
              <Section n={5} title="CV & personal statement">
                <div className="flex flex-col gap-2.5">
                  {([['cv_done', 'cv_link', 'CV finalised'], ['ps_done', 'ps_link', 'Personal statement finalised']] as const).map(([done, link, label]) => (
                    <div key={done} className="flex flex-wrap items-center gap-x-6 gap-y-2">
                      <CheckRow checked={d[done]} onChange={(v) => set(done, v)}>{label}</CheckRow>
                      <div className="ml-auto flex min-w-[280px] flex-1 items-center gap-3 text-[13px] sm:max-w-[430px]" style={{ color: C.ink }}>
                        <span className="shrink-0">Document link</span>
                        <LinkField value={d[link]} onChange={(v) => set(link, v)} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {/* 6 · LinkedIn */}
              <Section n={6} title="LinkedIn update">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <CheckRow checked={d.linkedin_done} onChange={(v) => set('linkedin_done', v)}>LinkedIn updated</CheckRow>
                  <div className="ml-auto flex min-w-[280px] flex-1 items-center gap-3 text-[13px] sm:max-w-[470px]" style={{ color: C.ink }}>
                    <span className="shrink-0">LinkedIn profile link</span>
                    <LinkField value={d.linkedin_url} onChange={(v) => set('linkedin_url', v)} placeholder="Paste LinkedIn profile link…" />
                  </div>
                </div>
              </Section>

              {/* 7 · Canva */}
              <Section n={7} title="Canva link creation">
                <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                  <div className="flex flex-col gap-2.5">
                    <CheckRow checked={d.canva_created} onChange={(v) => set('canva_created', v)}>Canva link created</CheckRow>
                    <CheckRow checked={d.canva_updated} onChange={(v) => set('canva_updated', v)}>All documents updated in Canva</CheckRow>
                  </div>
                  <div className="ml-auto flex min-w-[280px] flex-1 items-center gap-3 text-[13px] sm:max-w-[450px]" style={{ color: C.ink }}>
                    <span className="shrink-0">Canva URL</span>
                    <LinkField value={d.canva_url} onChange={(v) => set('canva_url', v)} placeholder="Paste Canva link…" />
                  </div>
                </div>
              </Section>

              {/* 8 · Client review & filing readiness */}
              <Section n={8} title="Client review & filing readiness">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <div className="flex flex-col gap-2.5">
                    <CheckRow checked={d.review_discussed} onChange={(v) => set('review_discussed', v)}>Discuss Canva link and evidence with client</CheckRow>
                    <CheckRow checked={d.review_final} onChange={(v) => set('review_final', v)}>Final changes completed</CheckRow>
                  </div>
                  <div className="ml-auto flex flex-col items-end gap-1.5">
                    {d.ready_to_file_at ? (
                      <div className="rounded-lg px-4 py-2.5 text-[13px] font-semibold" style={{ background: C.greenSoft, color: C.greenDark }}>
                        ✓ Ready to file — marked {new Date(d.ready_to_file_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    ) : (
                      <>
                        <span className="text-[12px]" style={{ color: C.sub }}>
                          {allDone ? 'Everything is complete — ready when you are.' : `Complete all required tasks before marking ready to file (${progress.total - progress.done} left).`}
                        </span>
                        <button type="button" disabled={!allDone || saving} onClick={() => void save({ readyToFile: true })}
                          className="h-10 rounded-lg px-6 text-[13px] font-semibold transition disabled:cursor-not-allowed"
                          style={allDone
                            ? { background: C.green, color: '#fff' }
                            : { background: '#E9EDF1', color: '#8C95A1', border: `1px solid ${C.line}` }}>
                          Ready to file endorsement application
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </Section>

              </>)}

              {isIfv && (<>
              {/* IFV 4 · Business plan pack */}
              <Section n={4} title="Business plan pack" hint="Each document drafted, then final." badge={<PhaseChip m="profile_building" pays={leadPayments} />}>
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: C.line }}>
                  <table className="w-full border-collapse text-[13px]" style={{ minWidth: 640 }}>
                    <thead>
                      <tr style={{ background: C.tableHead }}>
                        {['Document', 'Drafted', 'Final', 'Document link'].map((h, i) => (
                          <th key={h} className="px-3 py-2 text-[12px] font-bold"
                            style={{ color: C.navy, borderBottom: `1px solid ${C.line}`, textAlign: i === 1 || i === 2 ? 'center' : 'left', borderLeft: i ? `1px solid ${C.lineSoft}` : undefined }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {IFV_DOCS.map((doc, i) => (
                        <tr key={doc.key} style={{ borderTop: i ? `1px solid ${C.lineSoft}` : undefined }}>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold" style={{ color: C.navy }}>{doc.label}</div>
                            <div className="text-[11.5px]" style={{ color: C.sub }}>{doc.hint}</div>
                          </td>
                          {(['drafted', 'final'] as const).map((k) => (
                            <td key={k} className="px-3 py-2" style={{ borderLeft: `1px solid ${C.lineSoft}`, width: 92 }}>
                              <div className="flex justify-center"><Box checked={iv.docs[doc.key][k]} onChange={(v) => setIfvDoc(doc.key, { [k]: v })} label={`${doc.label} ${k}`} /></div>
                            </td>
                          ))}
                          <td className="px-3 py-2" style={{ borderLeft: `1px solid ${C.lineSoft}`, width: 260 }}>
                            <LinkField value={iv.docs[doc.key].link} onChange={(v) => setIfvDoc(doc.key, { link: v })} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* IFV 5 · Endorsement criteria */}
              <Section n={5} title="Endorsement criteria" hint="What the endorsing body assesses — show where the plan proves each one.">
                <div className="grid gap-3 lg:grid-cols-3">
                  {IFV_CRITERIA.map((cr) => {
                    const v = iv.criteria[cr.key];
                    return (
                      <div key={cr.key} className="flex flex-col rounded-lg border p-4"
                        style={{ borderColor: v.done ? '#A7DCC2' : C.line, background: v.done ? C.greenBg : C.card }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[15px] font-bold" style={{ color: C.navy }}>{cr.label}</span>
                          <Box checked={v.done} onChange={(x) => setIfvCrit(cr.key, { done: x })} label={`${cr.label} evidence covered`} />
                        </div>
                        <p className="m-0 mt-1.5 text-[12px] leading-relaxed" style={{ color: C.sub }}>{cr.question}</p>
                        <div className="mt-auto flex items-center gap-2 pt-3">
                          <div className="min-w-0 flex-1">
                            <TextField value={v.note} onChange={(x) => setIfvCrit(cr.key, { note: x })} placeholder="Where the plan shows it…" />
                          </div>
                          <LinkButton value={v.link} onChange={(x) => setIfvCrit(cr.key, { link: x })} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* IFV 6 · Client review & sign-off */}
              <Section n={6} title="Client review & sign-off" badge={<PhaseChip m="endorsement" pays={leadPayments} />}>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                  <div className="flex flex-col gap-2.5">
                    <CheckRow checked={iv.review_discussed} onChange={(v) => setIfv({ review_discussed: v })}>Complete document pack delivered and discussed with the client</CheckRow>
                    <CheckRow checked={iv.review_final} onChange={(v) => setIfv({ review_final: v })}>Client signed off the final pack</CheckRow>
                  </div>
                  <div className="ml-auto flex flex-col items-end gap-1.5">
                    {d.ready_to_file_at ? (
                      <div className="rounded-lg px-4 py-2.5 text-[13px] font-semibold" style={{ background: C.greenSoft, color: C.greenDark }}>
                        ✓ Ready to submit — marked {new Date(d.ready_to_file_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    ) : (
                      <>
                        <span className="text-[12px]" style={{ color: C.sub }}>
                          {allDone ? 'Everything is complete — ready when you are.' : `Complete all tasks before submitting (${progress.total - progress.done} left).`}
                        </span>
                        <button type="button" disabled={!allDone || saving} onClick={() => void save({ readyToFile: true })}
                          className="h-10 rounded-lg px-6 text-[13px] font-semibold transition disabled:cursor-not-allowed"
                          style={allDone
                            ? { background: C.green, color: '#fff' }
                            : { background: '#E9EDF1', color: '#8C95A1', border: `1px solid ${C.line}` }}>
                          Ready to submit to the endorsing body
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </Section>

              {/* IFV 7 · Endorsing body & interview */}
              <Section n={7} title="Endorsing body & interview" badge={<PhaseChip m="post_approval" pays={leadPayments} />}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FieldBox label="Endorsing body">
                    <SelectField value={iv.endorsing_body} onChange={(v) => setIfv({ endorsing_body: v })} options={ENDORSING_BODIES} />
                  </FieldBox>
                  {iv.endorsing_body === 'other' && (
                    <FieldBox label="Name of endorsing body">
                      <TextField value={iv.endorsing_body_other} onChange={(v) => setIfv({ endorsing_body_other: v })} placeholder="Endorsing body name" />
                    </FieldBox>
                  )}
                  <FieldBox label="Interview date">
                    <DateField value={iv.interview_date} onChange={(v) => setIfv({ interview_date: v })} />
                  </FieldBox>
                </div>
                <div className="mt-3.5 flex flex-wrap gap-x-8 gap-y-2.5">
                  <CheckRow checked={iv.interview_prep} onChange={(v) => setIfv({ interview_prep: v })}>Interview prepared (pitch deck walkthrough, Q&amp;A rehearsal)</CheckRow>
                  <CheckRow checked={iv.interview_done} onChange={(v) => setIfv({ interview_done: v })}>Interview attended</CheckRow>
                </div>
              </Section>
              </>)}

              {/* 9 · Endorsement & visa decision */}
              <Section n={isIfv ? 8 : 9} title="Endorsement & visa decision" hint="Record each outcome when it arrives. Visa granted completes the case.">
                <div className="grid gap-3 md:grid-cols-2">
                  <DecisionCard title="Endorsement" sub={isIfv ? 'Endorsing body decision' : 'Tech Nation / endorsing body decision'}
                    value={d.endorsement ?? 'pending'} onChange={(v) => set('endorsement', v)}
                    labels={{ pending: 'Awaiting', approved: 'Approved', rejected: 'Refused' }}>
                    <FieldBox label="Reference no." wide>
                      <TextField value={d.endorsement_ref ?? ''} onChange={(v) => set('endorsement_ref', v)} placeholder="e.g. GTE-2026-01234" />
                    </FieldBox>
                    <FieldBox label="Submitted on"><DateField value={d.endorsement_submitted_on ?? null} onChange={(v) => set('endorsement_submitted_on', v)} /></FieldBox>
                    <FieldBox label="Decision on">
                      {(d.endorsement ?? 'pending') === 'pending'
                        ? <div className="flex h-9 items-center text-[12.5px]" style={{ color: C.faint }}>Once decided</div>
                        : <DateField value={d.endorsement_decided_on ?? null} onChange={(v) => set('endorsement_decided_on', v)} />}
                    </FieldBox>
                  </DecisionCard>
                  <DecisionCard title="Visa" sub="Home Office decision on the visa application"
                    value={d.visa ?? 'pending'} onChange={(v) => set('visa', v)}
                    labels={{ pending: 'Pending', approved: 'Granted', rejected: 'Refused' }}>
                    <FieldBox label="Applied on"><DateField value={d.visa_applied_on ?? null} onChange={(v) => set('visa_applied_on', v)} /></FieldBox>
                    <FieldBox label="Decision on">
                      {(d.visa ?? 'pending') === 'pending'
                        ? <div className="flex h-9 items-center text-[12.5px]" style={{ color: C.faint }}>Once decided</div>
                        : <DateField value={d.visa_decided_on ?? null} onChange={(v) => set('visa_decided_on', v)} />}
                    </FieldBox>
                  </DecisionCard>
                </div>
                {visaDeadline && (() => {
                  const left = Math.ceil((visaDeadline.getTime() - Date.now()) / 86_400_000);
                  const tone = left < 0 ? { bg: '#FBE7E2', fg: '#9A3B2A' } : left <= 21 ? { bg: '#FBF1DD', fg: '#8A5A12' } : { bg: C.greenBg, fg: C.greenDark };
                  return (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-4 py-3 text-[13px]" style={{ background: tone.bg, color: tone.fg }}>
                      <b>Apply for the visa by {visaDeadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</b>
                      <span>· {left < 0 ? `${-left} days past the deadline` : `${left} days left`} — the endorsement letter is valid for 3 months.</span>
                    </div>
                  );
                })()}
              </Section>

              {/* Next action */}
              <div className="rounded-xl border px-5 py-4 sm:px-6" style={{ background: C.card, borderColor: C.line }}>
                <div className="mb-1.5 text-[13px] font-bold" style={{ color: C.navy }}>Next action</div>
                <TextField value={d.next_action} onChange={(v) => set('next_action', v)} placeholder="e.g. Draft LoR 3 and follow up on LoR 2 signature" />
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
                {/* Notes — the client's full history, every note since the first enquiry */}
                <section className="flex min-w-0 flex-col rounded-xl border px-5 py-4 sm:px-6" style={{ background: C.card, borderColor: C.line }}>
                  <div className="flex items-baseline gap-2">
                    <h3 className="m-0 text-[17px] font-bold" style={{ color: C.navy }}>Notes</h3>
                    <span className="text-[12px]" style={{ color: C.sub }}>{notes.length} total · saved instantly</span>
                  </div>
                  {c.lead_id ? (
                    <>
                      <div className="mt-3 flex flex-col gap-2">
                        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveNote(); } }}
                          rows={2} placeholder="Write a note… (⌘↵ to add)"
                          className="w-full resize-none rounded-lg border px-3 py-2 text-[13px] leading-relaxed outline-none transition placeholder:text-[#A8B0BB] focus:border-[#16A36B] focus:ring-2 focus:ring-[#16A36B]/15"
                          style={{ borderColor: C.line, color: C.ink }} />
                        <button type="button" onClick={() => void saveNote()} disabled={!noteDraft.trim() || savingNote}
                          className="inline-flex h-8 items-center gap-1.5 self-end rounded-lg px-3.5 text-[12.5px] font-semibold text-white transition disabled:opacity-40"
                          style={{ background: C.green }}>
                          <Plus className="h-3.5 w-3.5" /> {savingNote ? 'Adding…' : 'Add note'}
                        </button>
                      </div>
                      <div className="mt-2 max-h-[440px] overflow-y-auto pr-1">
                        {notes.filter((n) => n.created_at >= preCut).map((n) => <NoteLine key={n.id} n={n} name={memberNameById(n.author_id)} />)}
                        {notes.some((n) => n.created_at < preCut) && (
                          <div className="my-3 flex items-center gap-3">
                            <div className="h-px flex-1" style={{ background: C.line }} />
                            <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ background: '#F1F4F7', color: C.sub }}>
                              Before conversion — {notes.filter((n) => n.created_at < preCut).length} from the lead
                            </span>
                            <div className="h-px flex-1" style={{ background: C.line }} />
                          </div>
                        )}
                        {notes.filter((n) => n.created_at < preCut).map((n) => <NoteLine key={n.id} n={n} name={memberNameById(n.author_id)} />)}
                        {notes.length === 0 && <div className="py-6 text-center text-[13px]" style={{ color: C.faint }}>No notes yet — the first one starts the history.</div>}
                      </div>
                    </>
                  ) : (
                    <div className="py-6 text-center text-[13px]" style={{ color: C.faint }}>This case isn't linked to a lead, so it has no note history.</div>
                  )}
                </section>

                {/* Payments — this client's milestone payments, invoices one click away */}
                <section className="flex min-w-0 flex-col rounded-xl border px-5 py-4 sm:px-6" style={{ background: C.card, borderColor: C.line }}>
                  <div className="flex items-center gap-2">
                    <h3 className="m-0 text-[17px] font-bold" style={{ color: C.navy }}>Payments</h3>
                    {c.lead_id && (
                      <button type="button" onClick={() => ui.openRecordPayment(c.lead_id!)}
                        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition hover:bg-[#EEF9F3]"
                        style={{ borderColor: '#A7DCC2', color: C.greenDark }}>
                        <Plus className="h-3.5 w-3.5" /> Record payment
                      </button>
                    )}
                  </div>
                  {billed > 0 && (
                    <div className="mt-3 rounded-lg px-4 py-3" style={{ background: C.greenBg }}>
                      <div className="flex items-baseline justify-between text-[13px]" style={{ color: C.sub }}>
                        <span>Collected</span>
                        <span><b className="text-[16px] tabular-nums" style={{ color: C.greenDark }}>{formatMoney(collected, currency)}</b> of {formatMoney(billed, currency)}</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: '#D4ECE0' }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.round((collected / billed) * 100)}%`, background: C.green }} />
                      </div>
                    </div>
                  )}
                  <div className="mt-1">
                    {leadPayments.map((p) => <PaymentLine key={p.id} p={p} currency={currency} visa={c.visa_type} />)}
                    {leadPayments.length === 0 && (
                      <div className="py-6 text-center text-[13px]" style={{ color: C.faint }}>No payments recorded for this client yet.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 border-t px-4 py-3 sm:px-8" style={{ background: C.card, borderColor: C.line }}>
          <span className="truncate text-[12px]" style={{ color: dirty ? C.greenDark : C.faint }}>
            {dirty ? '● Unsaved changes' : `${c.client_name} · ${visa?.full || c.visa_type}`}
          </span>
          <button type="button" onClick={requestClose}
            className="ml-auto h-10 shrink-0 rounded-lg border px-6 text-[13px] font-semibold transition hover:bg-black/[0.03]"
            style={{ background: '#fff', borderColor: '#CDD4DC', color: C.navy }}>Cancel</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || saving}
            className="h-10 shrink-0 rounded-lg px-7 text-[13px] font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
            style={{ background: C.green }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* ── Discard changes? ──────────────────────────────────────────────── */}
      {closeAsk && (
        <Dialog onClose={() => !statusBusy && setCloseAsk(null)}>
          <h3 className="m-0 text-[18px] font-extrabold" style={{ color: C.navy }}>Close {c.client_name.split(' ')[0]}&apos;s case?</h3>
          <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed" style={{ color: C.sub }}>
            It leaves the active list and moves to <b style={{ color: C.navy }}>Closed cases</b>. Nothing is deleted and
            nothing is sent to the client — you can reopen it any time.
          </p>
          <div className="mt-4 text-[13px] font-semibold" style={{ color: C.navy }}>Reason</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {CLOSE_REASONS.map((r) => {
              const on = closeAsk.reason === r.value;
              return (
                <button key={r.value} type="button" onClick={() => setCloseAsk((p) => p && { ...p, reason: r.value })}
                  className="rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition"
                  style={on ? { borderColor: '#D2583F', background: '#FBE7E2', color: '#9A3B2A', fontWeight: 600 } : { borderColor: C.line, color: C.ink }}>
                  {r.label}
                </button>
              );
            })}
          </div>
          <div className="mt-4 text-[13px] font-semibold" style={{ color: C.navy }}>Note <span className="font-normal" style={{ color: C.faint }}>(optional)</span></div>
          <textarea value={closeAsk.note} onChange={(e) => { const note = e.target.value; setCloseAsk((p) => p && { ...p, note }); }} rows={3}
            placeholder="e.g. Decided to apply next year; refund of £500 processed"
            className="mt-2 w-full resize-none rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-[#16A36B]"
            style={{ borderColor: C.line, color: C.ink }} />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setCloseAsk(null)} disabled={statusBusy}
              className="h-10 rounded-lg border px-4 text-[13.5px] font-semibold" style={{ borderColor: '#D5DBE3', color: C.navy }}>Cancel</button>
            <button type="button" onClick={() => void closeCase()} disabled={!closeAsk.reason || statusBusy}
              className="h-10 rounded-lg px-4 text-[13.5px] font-semibold text-white transition disabled:cursor-not-allowed"
              style={{ background: closeAsk.reason ? '#B8452E' : '#E3B4A8' }}>
              {statusBusy ? 'Closing…' : 'Close case'}
            </button>
          </div>
        </Dialog>
      )}

      {askDiscard && (
        <Dialog onClose={() => setAskDiscard(false)}>
          <div className="text-[16px] font-bold" style={{ color: C.navy }}>Discard your changes?</div>
          <div className="mt-2 text-[13px] leading-relaxed" style={{ color: C.sub }}>You have edits on this case that haven't been saved.</div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setAskDiscard(false)}
              className="h-9 rounded-lg border px-4 text-[13px] font-semibold" style={{ borderColor: '#CDD4DC', color: C.navy }}>Keep editing</button>
            <button type="button" onClick={() => { setAskDiscard(false); loadedFor.current = null; onClose(); }}
              className="h-9 rounded-lg px-4 text-[13px] font-semibold text-white" style={{ background: '#B45342' }}>Discard</button>
          </div>
        </Dialog>
      )}

      {/* ── Tell the client? ──────────────────────────────────────────────── */}
      {emailAsk && (
        <Dialog onClose={() => setEmailAsk(null)}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: C.greenSoft, color: C.greenDark }}><Send className="h-[18px] w-[18px]" /></span>
            <div>
              <div className="text-[16px] font-bold" style={{ color: C.navy }}>Tell {c.client_name.split(' ')[0]} about this progress?</div>
              <div className="text-[12px]" style={{ color: C.sub }}>Saved ✓</div>
            </div>
          </div>
          <div className="mt-4 rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed" style={{ borderColor: C.line, background: '#F8FAFB', color: C.sub }}>
            {emailAsk.summary}
            <div className="mt-2" style={{ color: C.ink }}>
              The client receives the branded progress email{c.client_email ? <> at <b>{c.client_email}</b>.</> : <>. <b style={{ color: '#B45342' }}>This case has no email address.</b></>}
            </div>
          </div>
          <textarea value={emailAsk.note} onChange={(e) => setEmailAsk({ ...emailAsk, note: e.target.value })}
            rows={2} placeholder="Add a personal line (optional)…"
            className="mt-3 w-full resize-none rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-[#16A36B]"
            style={{ borderColor: C.line, color: C.ink }} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEmailAsk(null)}
              className="h-9 rounded-lg border px-4 text-[13px] font-semibold" style={{ borderColor: '#CDD4DC', color: C.navy }}>Not now</button>
            <button type="button" onClick={() => void sendUpdate()} disabled={sending || !c.client_email}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: C.green }}>
              <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send to client'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
