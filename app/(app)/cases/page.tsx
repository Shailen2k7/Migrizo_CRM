'use client';

// =============================================================================
// CASES — the operation at a glance (Case Management v2, design 27 Sep 2026).
// -----------------------------------------------------------------------------
// Top to bottom, the way a delivery lead reads their book of work:
//
//   KPIs      Active · New (24h) · On track · At risk · Overdue · Waiting
//   ARRIVAL   a case born in the last 24 hours flashes here, beautifully,
//             until it is a day old — conversion should feel like an event
//   PIPELINE  the ten stages with live counts; click one to filter
//   TABLE     every case: number, client, visa, stage, progress, waiting-for,
//             next action, deadline, days left, owner, health
//
// The table is plain rows, not a windowed sheet — there are 28 cases, not
// 3,000 — and every row opens the full-page Case Workspace. Data comes from
// the provider's cases state plus ONE extra query for "next action" (the
// first open checklist item per case). Nothing here writes.
// =============================================================================

import { Suspense, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { AddCaseDialog } from '@/components/cases/add-case-dialog';
import { CaseWorkspace } from '@/components/cases/case-workspace';
import {
  stageOf, progressOf, healthOf, HEALTH_META,
  PIPELINE, PIPELINE_BY_KEY, pipelineOf, DEFAULT_CASE_OWNER, type PipelineKey,
  waitingOf, WAITING_META, caseNoLabel, targetDateOf, daysLeftOf, isNewCase,
  outcomeOf, OUTCOME_META, OUTCOME_ORDER, type Outcome,
  type CaseStageKey, type CaseHealth,
} from '@/lib/case-stages';
import { getVisaMeta, isIfvVisa, type Case } from '@/lib/types';
import { hydrateDetails, progressFor, closeReasonLabel } from '@/lib/case-details';
import { C, TONE } from '@/lib/case-theme';
import { initials, avatarColor } from '@/lib/utils';
import { Plus, Search, X, Download, ArrowRight, Sparkles, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The case form (journey.details) is the source of truth once someone has
 * filled it in: its "N of 24 tasks" drives the progress bar and its Next
 * action wins over the old checklist. Cases never opened in the new page
 * fall back to stage position and the first open checklist item.
 */
// Bookkeeping the case page keeps in details without anyone filling the form.
const FORM_META_KEYS = ['stage_entered_at', 'photo_path', 'closed_reason', 'closed_note', 'closed_at'];
function formOf(c: Case) {
  const raw = (c.journey as { details?: Record<string, unknown> } | null)?.details;
  if (!raw || !Object.keys(raw).some((k) => !FORM_META_KEYS.includes(k))) return null;
  return hydrateDetails(raw);
}
function pctOfCase(c: Case, stage: CaseStageKey): number {
  const f = formOf(c);
  return f ? progressFor(f, isIfvVisa(c.visa_type)).pct : progressOf(stage);
}
function nextOfCase(c: Case, fallback: Map<string, string>): string | undefined {
  return formOf(c)?.next_action?.trim() || fallback.get(c.id);
}

const fmtD = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function CasesInner() {
  const { cases, leads, memberNameById, members, user } = useApp();
  const supabase = createClient();

  const [q, setQ] = useState('');
  const [fStage, setFStage] = useState<PipelineKey | 'all'>('all');
  const [fOwner, setFOwner] = useState('all');
  const [fHealth, setFHealth] = useState<CaseHealth | 'all'>('all');
  const [fVisa, setFVisa] = useState<'all' | 'gtv' | 'ifv'>('all');
  const [fOutcome, setFOutcome] = useState<Outcome | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nextAction, setNextAction] = useState<Map<string, string>>(new Map());
  const [view, setView] = useState<'active' | 'paused' | 'closed'>('active');

  // Three books: Active (the work), Paused (status on_hold — client on a
  // break) and Closed (archived_at — backed out, refunded, refused…). The
  // numbers and the pipeline always describe the Active book; the table
  // shows whichever book is selected.
  const live = useMemo(() => cases.filter((c) => !c.archived_at && c.status !== 'on_hold'), [cases]);
  const paused = useMemo(() => cases.filter((c) => !c.archived_at && c.status === 'on_hold'), [cases]);
  const closed = useMemo(() => cases.filter((c) => !!c.archived_at), [cases]);
  const book = view === 'active' ? live : view === 'paused' ? paused : closed;

  // One query for every case's next open task — 558 small rows, grouped here.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('case_checklist_items')
        .select('case_id, title, status, display_order')
        .neq('status', 'completed').neq('status', 'not_applicable')
        .order('display_order', { ascending: true })
        .limit(3000);
      if (!alive || !data) return;
      const m = new Map<string, string>();
      for (const r of data as { case_id: string; title: string }[]) if (!m.has(r.case_id)) m.set(r.case_id, r.title);
      setNextAction(m);
    })();
    return () => { alive = false; };
  }, [supabase, cases.length]);

  const enrich = (list: Case[]) => list.map((c) => ({
    c,
    stage: stageOf(c),
    step: pipelineOf(stageOf(c)),
    health: healthOf(c),
    fresh: isNewCase(c),
    outcome: outcomeOf(c),
    visa: (getVisaMeta(c.visa_type)?.short || '').toLowerCase().includes('innovator') ? 'ifv' as const : 'gtv' as const,
  }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enriched = useMemo(() => enrich(live), [live]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enrichedBook = useMemo(() => (view === 'active' ? enriched : enrich(book)), [view, enriched, book]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enrichedBook.filter((e) => {
      if (needle && !`${e.c.client_name} ${caseNoLabel(e.c, cases)} ${e.c.client_email ?? ''}`.toLowerCase().includes(needle)) return false;
      if (fStage !== 'all' && e.step !== fStage) return false;
      if (fOwner !== 'all' && (e.c.owner_id ?? '') !== fOwner) return false;
      if (fHealth !== 'all' && e.health !== fHealth) return false;
      if (fVisa !== 'all' && e.visa !== fVisa) return false;
      if (fOutcome !== 'all' && e.outcome !== fOutcome) return false;
      return true;
    }).sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.c.created_at.localeCompare(a.c.created_at));
  }, [enrichedBook, q, fStage, fOwner, fHealth, fVisa, fOutcome, cases]);

  const kpi = useMemo(() => ({
    active: enriched.length,
    fresh: enriched.filter((e) => e.fresh).length,
    onTrack: enriched.filter((e) => e.health === 'on_track').length,
    atRisk: enriched.filter((e) => e.health === 'at_risk').length,
    overdue: enriched.filter((e) => e.health === 'overdue').length,
    waiting: enriched.filter((e) => waitingOf(e.c) === 'client' && e.health !== 'done').length,
  }), [enriched]);

  const stageCounts = useMemo(() => {
    const m = new Map<PipelineKey, number>();
    for (const e of enriched) m.set(e.step, (m.get(e.step) ?? 0) + 1);
    return m;
  }, [enriched]);

  const newest = enriched.filter((e) => e.fresh).sort((a, b) => b.c.created_at.localeCompare(a.c.created_at))[0];
  const anyFilter = fStage !== 'all' || fOwner !== 'all' || fHealth !== 'all' || fVisa !== 'all' || fOutcome !== 'all' || !!q;

  const exportCsv = () => {
    if (rows.length === 0) { toast.error('Nothing to export'); return; }
    const head = ['Case', 'Client', 'Visa', 'Stage', 'Progress', 'Waiting for', 'Next action', 'Deadline', 'Days left', 'Owner', 'Status'];
    const body = rows.map(({ c, stage, health }) => [
      caseNoLabel(c, cases), c.client_name, getVisaMeta(c.visa_type)?.short || c.visa_type,
      PIPELINE_BY_KEY[pipelineOf(stage)].label, `${pctOfCase(c, stage)}%`, WAITING_META[waitingOf(c)].label,
      nextOfCase(c, nextAction) ?? '', fmtD(targetDateOf(c)), String(daysLeftOf(c)),
      c.owner_id ? memberNameById(c.owner_id) : '', HEALTH_META[health].label,
    ]);
    const csv = [head, ...body].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `migrizo-cases-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Status pill tones, the same family as the case page's payment pills.
  const HEALTH_TONE: Record<CaseHealth, { bg: string; fg: string; dot: string }> = {
    on_track: TONE.green, at_risk: TONE.amber, overdue: TONE.red, done: TONE.slate,
  };

  return (
    // The Cases home is drawn in the case page's own light palette, whatever
    // the CRM theme, so the list and the case you open from it read as one.
    <div className="min-h-screen animate-pageIn" style={{ background: C.page, color: C.ink, colorScheme: 'light' }}>
      <div className="mx-auto max-w-[1480px] px-4 pb-10 pt-6 sm:px-6 lg:px-8">

        {/* ── Title row ─────────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: C.faint }}>
              <span>Operations</span><span>/</span><span style={{ color: C.sub }}>Cases</span>
            </div>
            <h1 className="m-0 mt-1.5 text-[28px] font-extrabold leading-tight tracking-[-0.02em]" style={{ color: C.navy }}>Case Management</h1>
            <p className="m-0 mt-1 text-[14.5px]" style={{ color: C.sub }}>Every client after conversion — from case created to completed.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={exportCsv}
              className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[13px] font-semibold transition hover:shadow-sm"
              style={{ background: C.card, borderColor: '#D5DBE3', color: C.navy }}>
              <Download className="h-4 w-4" /> Export
            </button>
            <button onClick={() => setAddOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold text-white transition hover:brightness-95"
              style={{ background: C.green }}>
              <Plus className="h-4 w-4" /> New case
            </button>
          </div>
        </div>

        {/* ── Overview: one calm strip, health as a single bar ───────────── */}
        <div className="mb-3 grid overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-[1fr_2.1fr_1fr_1fr]"
          style={{ background: C.card, borderColor: C.line }}>
          <Stat label="Active cases" value={kpi.active} note="in delivery right now" />
          <div className="border-t px-5 py-5 sm:border-l sm:border-t-0" style={{ borderColor: C.lineSoft }}>
            <div className="flex items-baseline">
              <span className="text-[13px] font-semibold" style={{ color: C.sub }}>Case health</span>
              {fHealth !== 'all' && (
                <button onClick={() => setFHealth('all')} className="ml-auto text-[12px] font-semibold hover:underline" style={{ color: C.greenDark }}>Show all</button>
              )}
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full" style={{ background: '#E6EBF0' }}>
              {([['on_track', kpi.onTrack], ['at_risk', kpi.atRisk], ['overdue', kpi.overdue]] as const).map(([h, n]) => {
                const total = kpi.onTrack + kpi.atRisk + kpi.overdue;
                return n > 0 ? <span key={h} className="h-full transition-all first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(n / Math.max(1, total)) * 100}%`, background: HEALTH_TONE[h].dot, marginRight: 2 }} /> : null;
              })}
            </div>
            <div className="mt-3 flex flex-nowrap gap-x-6 whitespace-nowrap">
              {([['on_track', kpi.onTrack], ['at_risk', kpi.atRisk], ['overdue', kpi.overdue]] as const).map(([h, n]) => {
                const on = fHealth === h;
                return (
                  <button key={h} onClick={() => { setView('active'); setFHealth(on ? 'all' : h); }}
                    className="flex items-center gap-2 rounded-md px-1.5 py-0.5 -mx-1.5 transition hover:bg-[#F4F6F8]"
                    style={on ? { background: HEALTH_TONE[h].bg } : undefined}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: HEALTH_TONE[h].dot }} />
                    <span className="text-[20px] font-extrabold leading-none tabular-nums" style={{ color: C.navy }}>{n}</span>
                    <span className="text-[13px]" style={{ color: on ? HEALTH_TONE[h].fg : C.sub }}>{HEALTH_META[h].label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Stat label="New in last 24h" value={kpi.fresh} note={kpi.fresh ? 'just converted' : 'no new conversions'} accent={kpi.fresh > 0} bordered />
          <Stat label="Waiting on client" value={kpi.waiting} note={kpi.waiting ? 'need a nudge' : 'nobody blocked'} bordered />
        </div>

        {/* ── New-case arrival: flashes until it is 24 hours old ─────────── */}
        {newest && (
          <button onClick={() => setOpenId(newest.c.id)}
            className="mb-3 flex w-full items-center gap-4 rounded-xl border px-5 py-3.5 text-left transition hover:-translate-y-px"
            style={{ background: C.card, borderColor: C.green, animation: 'casePulse 2.4s ease infinite' }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
              style={{ background: avatarColor(newest.c.client_name) }}>{initials(newest.c.client_name)}</span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold" style={{ color: C.navy }}>
                <Sparkles className="h-4 w-4" style={{ color: C.green }} />
                New case arrived — {newest.c.client_name} just converted
              </span>
              <span className="block text-[13px]" style={{ color: C.sub }}>
                {getVisaMeta(newest.c.visa_type)?.full || newest.c.visa_type} · opened automatically from the Converted lead
                {kpi.fresh > 1 ? ` · +${kpi.fresh - 1} more new` : ''}
              </span>
            </span>
            <span className="ml-auto hidden items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-[0.08em] sm:inline-flex"
              style={{ background: C.greenSoft, color: C.greenDark }}>
              <span className="h-1.5 w-1.5 animate-ping rounded-full" style={{ background: C.green }} /> NEW CASE
            </span>
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold text-white" style={{ background: C.green }}>
              Open <ArrowRight className="h-4 w-4" />
            </span>
          </button>
        )}
        <style>{`@keyframes casePulse{0%,100%{box-shadow:0 0 0 1px ${C.green},0 10px 26px -14px rgba(22,163,107,.55)}50%{box-shadow:0 0 0 4px rgba(22,163,107,.28),0 10px 30px -10px rgba(22,163,107,.7)}}`}</style>

        {/* ── Pipeline: seven steps, counts inside the nodes ──────────────── */}
        <div className="mb-3 rounded-xl border px-6 pb-5 pt-5" style={{ background: C.card, borderColor: C.line }}>
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="m-0 text-[17px] font-bold" style={{ color: C.navy }}>Case pipeline</h2>
            <span className="hidden text-[13px] sm:inline" style={{ color: C.sub }}>Click a step to see only those cases</span>
            {fStage !== 'all' && (
              <button onClick={() => setFStage('all')} className="ml-auto text-[13px] font-semibold hover:underline" style={{ color: C.greenDark }}>
                Show all steps
              </button>
            )}
          </div>
          <div className="no-scrollbar overflow-x-auto">
            <div className="grid min-w-[860px] grid-cols-7">
              {PIPELINE.map((g, i) => {
                const n = stageCounts.get(g.key) ?? 0;
                const on = fStage === g.key;
                const has = n > 0;
                const last = i === PIPELINE.length - 1;
                const granted = g.key === 'decision' ? enriched.filter((e) => e.step === 'decision' && e.outcome === 'visa_granted').length : 0;
                const refused = g.key === 'decision' ? enriched.filter((e) => e.step === 'decision' && (e.outcome === 'endorsement_refused' || e.outcome === 'visa_refused')).length : 0;
                return (
                  <button key={g.key} onClick={() => { setView('active'); setFStage(on ? 'all' : g.key); }}
                    aria-pressed={on}
                    className="group relative flex flex-col items-center rounded-xl px-2 pb-3 pt-2 text-center transition-colors hover:bg-[#F7FAF9]"
                    style={on ? { background: C.greenBg } : undefined}>
                    <span className="relative flex h-12 w-full items-center justify-center">
                      {i > 0 && <span className="absolute left-0 right-1/2 top-1/2 h-[2px] -translate-y-1/2" style={{ background: C.line }} />}
                      {!last && <span className="absolute left-1/2 right-0 top-1/2 h-[2px] -translate-y-1/2" style={{ background: C.line }} />}
                      <span className="relative flex h-12 w-12 items-center justify-center rounded-full text-[17px] font-extrabold tabular-nums transition group-hover:scale-105"
                        style={has
                          ? { background: C.green, color: '#fff', boxShadow: `0 0 0 5px ${on ? C.greenBg : C.card}, 0 6px 14px -6px rgba(22,163,107,.6)` }
                          : { background: C.card, color: '#B4BCC7', border: '2px solid #DCE1E7', boxShadow: `0 0 0 5px ${on ? C.greenBg : C.card}` }}>
                        {n}
                      </span>
                    </span>
                    <span className="mt-3 text-[10.5px] font-semibold tracking-[0.08em]" style={{ color: C.faint }}>STEP {i + 1}</span>
                    <span className="mt-0.5 min-h-[36px] text-balance text-[13.5px] font-semibold leading-snug"
                      style={{ color: on ? C.greenDark : has ? C.navy : C.sub }}>{g.label}</span>
                    {g.key === 'decision' && has && (
                      <span className="mt-0.5 text-[11.5px] font-medium" style={{ color: C.sub }}>
                        <span style={{ color: C.greenDark }}>{granted} granted</span> · <span style={{ color: refused ? '#9A3B2A' : C.sub }}>{refused} refused</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Cases: toolbar · table · footer, one card ───────────────────── */}
        <div className="overflow-hidden rounded-xl border" style={{ background: C.card, borderColor: C.line }}>
          <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
            <div className="inline-flex rounded-lg p-1" style={{ background: '#F1F4F7' }} role="tablist" aria-label="Which cases">
              {([['active', 'Active', live.length], ['paused', 'Paused', paused.length], ['closed', 'Closed', closed.length]] as const).map(([k, label, n]) => {
                const on = view === k;
                return (
                  <button key={k} role="tab" aria-selected={on} onClick={() => setView(k)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition"
                    style={on ? { background: C.card, color: C.navy, boxShadow: '0 1px 2px rgba(15,31,61,.08), 0 1px 3px rgba(15,31,61,.06)' } : { color: C.sub }}>
                    {label}<span className="tabular-nums" style={{ color: on ? C.sub : C.faint }}>{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="relative min-w-[180px] flex-1 sm:max-w-[230px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.faint }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client or case number"
                className="h-9 w-full rounded-lg border pl-9 pr-8 text-[13px] outline-none transition placeholder:text-[#A8B0BB] focus:border-[#16A36B] focus:ring-4 focus:ring-[#16A36B]/10"
                style={{ background: C.field, borderColor: C.line, color: C.ink }} />
              {q && <button onClick={() => setQ('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5" style={{ color: C.sub }}><X className="h-3.5 w-3.5" /></button>}
            </div>
            <Filter value={fVisa} onChange={(v) => setFVisa(v as typeof fVisa)} label="visas"
              options={[{ v: 'gtv', l: 'Global Talent' }, { v: 'ifv', l: 'Innovator Founder' }]} />
            <Filter value={fOwner} onChange={setFOwner} label="owners"
              options={members.map((m) => ({ v: m.user_id, l: m.user_id === DEFAULT_CASE_OWNER.id ? DEFAULT_CASE_OWNER.name : m.user_id === user.id ? (user.name || 'You') : memberNameById(m.user_id) }))} />
            <Filter value={fOutcome} onChange={(v) => setFOutcome(v as Outcome | 'all')} label="decisions"
              options={OUTCOME_ORDER.map((o) => ({ v: o, l: o === 'awaiting' ? 'Awaiting' : o === 'endorsed' ? 'Endorsed' : OUTCOME_META[o].label }))} />
            {fHealth !== 'all' && (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border pl-3 pr-2 text-[13px] font-semibold"
                style={{ background: HEALTH_TONE[fHealth].bg, borderColor: HEALTH_TONE[fHealth].dot, color: HEALTH_TONE[fHealth].fg }}>
                Status: {HEALTH_META[fHealth].label}
                <button onClick={() => setFHealth('all')} aria-label="Clear status" className="rounded p-0.5 hover:bg-white/60"><X className="h-3.5 w-3.5" /></button>
              </span>
            )}
            {fStage !== 'all' && (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border pl-3 pr-2 text-[13px] font-semibold"
                style={{ background: C.greenBg, borderColor: C.green, color: C.greenDark }}>
                Stage: {PIPELINE_BY_KEY[fStage].label}
                <button onClick={() => setFStage('all')} aria-label="Clear stage" className="rounded p-0.5 hover:bg-white/60"><X className="h-3.5 w-3.5" /></button>
              </span>
            )}
            {anyFilter && (
              <button onClick={() => { setQ(''); setFStage('all'); setFOwner('all'); setFHealth('all'); setFVisa('all'); setFOutcome('all'); }}
                className="h-9 px-2 text-[13px] font-semibold hover:underline" style={{ color: C.greenDark }}>Clear all</button>
            )}
          </div>

          <div className="overflow-x-auto border-t" style={{ borderColor: C.line }}>
            <table className="w-full border-collapse text-left" style={{ minWidth: 840 }}>
              <thead>
                <tr style={{ background: C.tableHead }}>
                  {['Client', 'Current stage', 'Progress', 'Next action', 'Target filing', 'Owner', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2.5 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] first:pl-4 last:pr-4"
                      style={{ color: C.sub, borderBottom: `1px solid ${C.line}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ c, stage, health, fresh, outcome }) => {
                  const st = PIPELINE_BY_KEY[pipelineOf(stage)]; const h = HEALTH_TONE[health];
                  const w = waitingOf(c); const left = daysLeftOf(c);
                  const pct = pctOfCase(c, stage);
                  const owner = !c.owner_id ? '' : c.owner_id === DEFAULT_CASE_OWNER.id ? DEFAULT_CASE_OWNER.name : c.owner_id === user.id ? (user.name || 'You') : memberNameById(c.owner_id);
                  return (
                    <tr key={c.id} onClick={() => setOpenId(c.id)}
                      className="group cursor-pointer transition-colors hover:bg-[#F7FAF9]"
                      style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                      <td className="px-2.5 py-3.5 pl-4">
                        <span className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                            style={{ background: avatarColor(c.client_name) }}>{initials(c.client_name)}</span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="max-w-[150px] truncate text-[14px] font-semibold group-hover:underline xl:max-w-[200px]" style={{ color: C.navy }}>{c.client_name}</span>
                              {fresh && (
                                <span className="animate-pulse rounded-full px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.06em]"
                                  style={{ background: C.greenSoft, color: C.greenDark }}>NEW</span>
                              )}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px]" style={{ color: C.sub }}>
                              <span className="tabular-nums">{caseNoLabel(c, cases)}</span>
                              <span style={{ color: '#CBD2DB' }}>•</span>
                              <span>{getVisaMeta(c.visa_type)?.short || c.visa_type}</span>
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-2.5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[11.5px] font-semibold"
                          style={{ background: st.bg, color: st.ink }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.accent }} />{st.label}
                        </span>
                        {outcome && outcome !== 'awaiting' ? (
                          <span className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: OUTCOME_META[outcome].fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: OUTCOME_META[outcome].dot }} />{OUTCOME_META[outcome].label}
                          </span>
                        ) : (
                          <span className="mt-1 block text-[11.5px]" style={{ color: C.faint }}>Step {PIPELINE.indexOf(st) + 1} of {PIPELINE.length}</span>
                        )}
                      </td>
                      <td className="px-2.5 py-3.5">
                        <span className="flex items-center gap-2">
                          <span className="hidden h-[6px] w-[56px] overflow-hidden rounded-full xl:block" style={{ background: '#E6EBF0' }}>
                            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: C.green }} />
                          </span>
                          <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: C.navy }}>{pct}%</span>
                        </span>
                      </td>
                      <td className="w-full max-w-0 px-2.5 py-3.5">
                        <span className="block truncate text-[13px]" style={{ color: nextOfCase(c, nextAction) ? C.ink : C.faint }}>
                          {nextOfCase(c, nextAction) ?? 'Not set'}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px]" style={{ color: C.faint }}>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: WAITING_META[w].dot }} /><span className="truncate">Waiting on {WAITING_META[w].label.toLowerCase()}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3.5">
                        <span className="block text-[13px]" style={{ color: C.ink }}>{fmtD(targetDateOf(c))}</span>
                        <span className="mt-0.5 block text-[11.5px] font-semibold tabular-nums"
                          style={{ color: health === 'done' ? C.greenDark : left < 0 ? TONE.red.fg : left <= 14 ? TONE.amber.fg : C.faint }}>
                          {health === 'done' ? 'Case complete' : left < 0 ? `${-left} days overdue` : left === 0 ? 'Due today' : `${left} days left`}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3.5">
                        {owner ? (
                          <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: C.ink }} title={owner}>
                            <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10.5px] font-bold text-white"
                              style={{ background: avatarColor(owner) }}>{initials(owner)}</span>
                            <span className="hidden xl:inline">{owner.split(' ')[0]}</span>
                          </span>
                        ) : <span className="text-[13px]" style={{ color: C.faint }}>Unassigned</span>}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3.5 pr-4">
                        {c.archived_at ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-semibold" style={{ background: TONE.red.bg, color: TONE.red.fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE.red.dot }} />
                            {closeReasonLabel((c.journey as { details?: { closed_reason?: string | null } } | null)?.details?.closed_reason)}
                          </span>
                        ) : c.status === 'on_hold' ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-semibold" style={{ background: TONE.amber.bg, color: TONE.amber.fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE.amber.dot }} />Paused
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-semibold" style={{ background: h.bg, color: h.fg }}>
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} />{HEALTH_META[health].label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-16 text-center">
                    <div className="text-[15px] font-semibold" style={{ color: C.navy }}>
                      {book.length > 0 ? 'No cases match these filters'
                        : view === 'paused' ? 'No paused cases' : view === 'closed' ? 'No closed cases' : 'No cases yet'}
                    </div>
                    <div className="mt-1 text-[13px]" style={{ color: C.sub }}>
                      {book.length > 0 ? 'Try clearing a filter or searching a different name.'
                        : view === 'active' ? 'Mark a lead Converted and its case appears here by itself.'
                        : 'Open a case and use the status menu next to the client’s name.'}
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center border-t px-5 py-3 text-[12.5px]" style={{ borderColor: C.line, color: C.sub }}>
            Showing <b className="mx-1" style={{ color: C.navy }}>{rows.length}</b> of {book.length} {view} cases
            <span className="ml-auto hidden sm:inline" style={{ color: C.faint }}>Click any row to open the case</span>
          </div>
        </div>

        <AddCaseDialog open={addOpen} onClose={() => setAddOpen(false)} leads={leads}
          onCreated={(id) => { setAddOpen(false); setOpenId(id); }} />
        <CaseWorkspace caseId={openId} onClose={() => setOpenId(null)} />
      </div>
    </div>
  );
}

function Stat({ label, value, note, accent, bordered }: {
  label: string; value: number; note: string; accent?: boolean; bordered?: boolean;
}) {
  return (
    <div className={`min-w-0 px-5 py-5 ${bordered ? 'border-t sm:border-t-0 lg:border-l' : ''}`} style={{ borderColor: C.lineSoft }}>
      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: C.sub }}>
        {label}
        {accent && <span className="h-2 w-2 animate-ping rounded-full" style={{ background: C.green }} />}
      </div>
      <div className="mt-2 text-[34px] font-extrabold leading-none tabular-nums" style={{ color: accent ? C.greenDark : C.navy }}>{value}</div>
      <div className="mt-1.5 truncate text-[12.5px]" style={{ color: C.faint }}>{note}</div>
    </div>
  );
}

function Filter({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string; options: { v: string; l: string }[];
}) {
  const on = value !== 'all';
  return (
    <span className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="h-9 cursor-pointer appearance-none rounded-lg border pl-3 pr-8 text-[13px] font-medium outline-none transition focus:border-[#16A36B]"
        style={on
          ? { background: C.greenBg, borderColor: C.green, color: C.greenDark, fontWeight: 600 }
          : { background: C.field, borderColor: C.line, color: C.ink }}>
        <option value="all">All {label}</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: on ? C.greenDark : C.sub }} />
    </span>
  );
}

export default function CasesPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm" style={{ color: C.sub }}>Loading…</div>}>
      <CasesInner />
    </Suspense>
  );
}
