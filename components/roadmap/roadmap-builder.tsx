'use client';

// ============================================================================
// ROADMAP BUILDER — replaces the paste box.
//
// The old tab asked you to fetch a block from an AI, paste it, and hope it
// parsed. Every roadmap came out different and the knowledge lived in a prompt
// nobody owned. This is the same job as a short, structured decision:
//
//   Plan  →  tick the criteria  →  pick the activities  →  weeks  →  review
//
// THE SYSTEM NEVER DECIDES. It offers the library and remembers the choice.
// Which criteria this candidate is endorsed against, and which activities close
// their gaps, is the consultant's judgement — that is the whole point.
//
// WHAT IS DELIBERATELY UNTOUCHED
// The output path. `roadmaps.data` keeps its exact shape, so renderRoadmapEmail
// and /api/roadmap/send work with zero change. We rebuilt how a roadmap is
// BUILT, never how it is sent. The consultant's picks are stored alongside in
// `roadmaps.builder`, so any plan can be reopened and edited later — including
// after it has gone out.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, Send, Eye, Pencil, Trash2, Plus, FileDown, CheckCircle2, Save,
  Check, Library, X, GripVertical, Sparkles, ArrowLeft,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import type { RoadmapData } from '@/lib/roadmap/types';
import { renderRoadmapEmail } from '@/lib/roadmap/template';
import {
  emptyBuilder, autoSchedule, weekLabel, sortItems, PRIORITY_META, PRIORITIES,
  GRADES, DURATIONS, criteriaCopy,
  type BuilderState, type BuilderItem, type Priority,
  type RmRoute, type RmCriterion, type RmActivity, type RouteMode,
} from '@/lib/roadmap/library';
import { toast } from 'sonner';

interface RoadmapRow {
  id: string; data: RoadmapData; builder: BuilderState | null;
  status: string; sent_at: string | null; created_at: string;
}

// ── tiny building blocks, kept local so nothing global is disturbed ─────────

function Section({ n, title, hint, children, right }: {
  n: number; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <header className="flex items-center gap-2.5 mb-2.5">
        <span className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-[#0F1728] text-[11px] font-bold text-white">{n}</span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[13.5px] font-semibold leading-tight text-ink">{title}</h3>
          {hint && <p className="m-0 mt-0.5 text-[11.5px] leading-snug text-muted">{hint}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT = 'w-full rounded-lg border border-border bg-surface px-2.5 py-[7px] text-[12.5px] text-ink outline-none transition focus:border-indigo';

function PriorityPill({ value, onChange }: { value: Priority; onChange?: (p: Priority) => void }) {
  const m = PRIORITY_META[value];
  if (!onChange) {
    return <span className="rounded-full px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide" style={{ background: m.bg, color: m.fg }}>{m.label}</span>;
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Priority)}
      className="cursor-pointer rounded-full border-0 px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide outline-none"
      style={{ background: m.bg, color: m.fg }}
    >
      {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
    </select>
  );
}

// ── main ────────────────────────────────────────────────────────────────────

export function RoadmapBuilder({ leadId, clientEmail, onSent }: {
  leadId: string; clientEmail: string | null; onSent: () => void;
}) {
  const { workspace, user: appUser, leads } = useApp();
  const lead = leads.find((l) => l.id === leadId);

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<RoadmapRow | null>(null);
  const [b, setB] = useState<BuilderState>(emptyBuilder());
  const [view, setView] = useState<'build' | 'review'>('build');
  const [busy, setBusy] = useState<'' | 'save' | 'send'>('');
  const [dirty, setDirty] = useState(false);
  const [libOpen, setLibOpen] = useState(false);

  const [routes, setRoutes] = useState<RmRoute[]>([]);
  const [criteria, setCriteria] = useState<RmCriterion[]>([]);
  const [activities, setActivities] = useState<RmActivity[]>([]);

  const patch = useCallback((p: Partial<BuilderState>) => {
    setB((prev) => ({ ...prev, ...p })); setDirty(true);
  }, []);

  // ── load library + any existing roadmap ───────────────────────────────────
  useEffect(() => {
    let alive = true;
    const sb = createClient();
    (async () => {
      const [r, c, a, existing] = await Promise.all([
        sb.from('roadmap_routes').select('*').eq('workspace_id', workspace.id).eq('active', true).order('sort_order'),
        sb.from('roadmap_criteria').select('*').eq('workspace_id', workspace.id).eq('active', true).order('sort_order'),
        sb.from('roadmap_activities').select('*').eq('workspace_id', workspace.id).eq('active', true).order('sort_order'),
        sb.from('roadmaps').select('id, data, builder, status, sent_at, created_at')
          .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!alive) return;
      setRoutes((r.data ?? []) as RmRoute[]);
      setCriteria((c.data ?? []) as RmCriterion[]);
      setActivities((a.data ?? []) as RmActivity[]);

      const ex = existing.data as RoadmapRow | null;
      if (ex) {
        setRow(ex);
        // Reopening a saved plan: prefer the stored picks. A roadmap made before
        // this builder existed has no `builder`, so start a fresh one seeded
        // with the client's name rather than showing an empty screen.
        if (ex.builder) setB({ ...emptyBuilder(), ...ex.builder });
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [leadId, workspace.id]);

  // Default the route once the library is in, so the screen is never blank.
  useEffect(() => {
    if (!b.route_id && routes.length) {
      setB((prev) => ({ ...prev, route_id: routes[0].id, route_name: routes[0].name }));
    }
  }, [routes, b.route_id]);

  const routeCriteria = useMemo(
    () => criteria.filter((c) => c.route_id === b.route_id),
    [criteria, b.route_id],
  );
  const chosenCriteria = useMemo(
    () => routeCriteria.filter((c) => b.criterion_ids.includes(c.id)),
    [routeCriteria, b.criterion_ids],
  );
  const codeById = useMemo(() => {
    const m = new Map<string, string>();
    criteria.forEach((c) => m.set(c.id, c.code));
    return m;
  }, [criteria]);

  const routeMode: RouteMode = useMemo(
    () => routes.find((r) => r.id === b.route_id)?.mode ?? 'criteria',
    [routes, b.route_id],
  );
  const copy = useMemo(() => criteriaCopy(routeMode), [routeMode]);

  /**
   * Activities offered.
   *
   * When a route HAS criteria: general activities plus those tied to a ticked
   * criterion. When a route has NONE — a new route nobody has filled in yet, or
   * one that genuinely does not work on criteria — offer the whole library
   * instead of an empty list. A consultant with a real client in front of them
   * must never hit a dead screen just because the library is unfinished.
   */
  const offered = useMemo(() => {
    if (routeCriteria.length === 0) return activities;
    const ids = new Set(b.criterion_ids);
    return activities.filter((a) => a.criterion_id === null || ids.has(a.criterion_id));
  }, [activities, b.criterion_ids, routeCriteria.length]);

  const isPicked = useCallback(
    (a: RmActivity) => b.items.some((i) => i.activity_id === a.id),
    [b.items],
  );

  const toggleActivity = (a: RmActivity) => {
    if (isPicked(a)) {
      patch({ items: b.items.filter((i) => i.activity_id !== a.id) });
      return;
    }
    const item: BuilderItem = {
      activity_id: a.id,
      criterion_code: a.criterion_id ? (codeById.get(a.criterion_id) ?? '') : '',
      title: a.title, detail: a.detail ?? '', priority: a.priority,
      week_from: 1, week_to: Math.min(b.duration_weeks, 2),
    };
    patch({ items: [...b.items, item] });
  };

  const updateItem = (idx: number, p: Partial<BuilderItem>) => {
    patch({ items: b.items.map((it, i) => i === idx ? { ...it, ...p } : it) });
  };

  // ── build the client-facing document from the picks ───────────────────────
  // Same RoadmapData shape the email template already renders, so nothing
  // downstream changes.
  const compose = useCallback((): RoadmapData => {
    const ordered = sortItems(b.items);
    const codes = chosenCriteria.map((c) => c.code).join(', ');
    return {
      client_name: lead?.full_name || 'Client',
      route: b.route_name || 'Global Talent',
      profile: b.profile,
      grade: b.grade,
      assessment: b.summary,
      evidence_score: b.evidence_score || codes || '—',
      timeline: `${b.duration_weeks} weeks to submission-ready`,
      strengths: b.strengths.filter(Boolean),
      gaps: b.gaps.filter(Boolean),
      priority_actions: ordered.filter((i) => i.priority === 'ESSENTIAL').map((i) => i.title),
      roadmap: ordered.map((i) => ({
        week: weekLabel(i),
        task: i.detail ? `${i.title} — ${i.detail}` : i.title,
        why: i.criterion_code,
        priority: i.priority,
      })),
      publications: [], speaking: [], red_flags: [],
    };
  }, [b, chosenCriteria, lead?.full_name]);

  const preview = useMemo(() => compose(), [compose]);

  // ── persistence ───────────────────────────────────────────────────────────
  const persist = useCallback(async (): Promise<string | null> => {
    const sb = createClient();
    const payload = { data: compose(), builder: b, updated_at: new Date().toISOString() };
    if (row?.id) {
      const { data, error } = await sb.from('roadmaps').update(payload).eq('id', row.id).select('id');
      if (error || !data?.length) return null;
      return row.id;
    }
    const { data, error } = await sb.from('roadmaps')
      .insert({ workspace_id: workspace.id, lead_id: leadId, created_by: appUser.id, ...payload })
      .select('id').single();
    if (error || !data) return null;
    setRow({ id: data.id, data: payload.data, builder: b, status: 'draft', sent_at: null, created_at: new Date().toISOString() });
    return data.id;
  }, [compose, b, row?.id, workspace.id, leadId, appUser.id]);

  const doSave = async (silent = false) => {
    setBusy('save');
    const id = await persist();
    setBusy('');
    if (id) { setDirty(false); if (!silent) toast.success('Saved — you can reopen and edit this any time'); return true; }
    if (!silent) toast.error('Could not save');
    return false;
  };

  const doSend = async () => {
    if (!clientEmail) { toast.error('This lead has no email address'); return; }
    if (!b.items.length) { toast.error('Add at least one activity before sending'); return; }
    setBusy('send');
    try {
      const id = await persist();          // always send the very latest edits
      if (!id) throw new Error('Could not save before sending');
      const res = await fetch('/api/roadmap/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roadmapId: id }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) throw new Error(j?.reason === 'no_email' ? 'This lead has no email address' : 'Send failed');
      setRow((r) => r ? { ...r, status: 'sent', sent_at: new Date().toISOString() } : r);
      setDirty(false); onSent();
      toast.success(`Roadmap sent to ${clientEmail}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed');
    } finally { setBusy(''); }
  };

  const doPdf = () => {
    const printCss = `<style>@media print{@page{margin:0}html,body{margin:0!important;padding:0!important;background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>`;
    const html = renderRoadmapEmail(compose()).replace('</head>', `${printCss}</head>`);
    const w = window.open('', '_blank');
    if (!w) { toast.error('Popup blocked — allow popups to download the PDF'); return; }
    w.document.write(html.replace('</body>', `<script>document.title=${JSON.stringify(`Migrizo Roadmap - ${preview.client_name}`)};window.onload=function(){setTimeout(function(){window.print()},450)}<\/script></body>`));
    w.document.close();
    toast.info('Choose “Save as PDF” in the print dialog');
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>;
  }

  if (!routes.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <Library className="mx-auto mb-2 h-5 w-5 text-faint" />
        <p className="m-0 text-[13px] font-semibold text-ink">The roadmap library is empty</p>
        <p className="m-0 mt-1 text-[12px] text-muted">Run migration 067 in Supabase to create the routes, criteria and starter activities.</p>
      </div>
    );
  }

  const sent = row?.status === 'sent';

  // ══ REVIEW ════════════════════════════════════════════════════════════════
  if (view === 'review') {
    return (
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setView('build')} className="btn btn-outline btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> Back to builder</button>
          <span className="ml-auto text-[11.5px] text-muted">{dirty ? 'Unsaved changes' : sent ? `Sent ${row?.sent_at ? new Date(row.sent_at).toLocaleDateString('en-IN') : ''}` : 'Saved'}</span>
        </div>

        {/* Everything below is still editable — this is a working document, not
            a locked proof. Edits here write straight back to the same picks. */}
        <div className="mb-3 rounded-xl border border-border bg-surface p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Assessment shown to the client">
              <textarea className={`${INPUT} min-h-[68px] resize-y`} value={b.summary}
                onChange={(e) => patch({ summary: e.target.value })}
                placeholder="Two or three lines on where they stand today." />
            </Field>
            <Field label="Profile / field">
              <input className={INPUT} value={b.profile} onChange={(e) => patch({ profile: e.target.value })} placeholder="AI Engineer at Infosys" />
            </Field>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted">The plan · {b.items.length} activities</span>
              <button onClick={() => patch({ items: autoSchedule(b.items, b.duration_weeks) })}
                className="flex items-center gap-1 text-[11px] font-bold text-indigo hover:underline">
                <Sparkles className="h-3 w-3" /> Re-space evenly
              </button>
            </div>
            <div className="space-y-1.5">
              {sortItems(b.items).map((it) => {
                const idx = b.items.indexOf(it);
                return (
                  <div key={idx} className="flex items-start gap-2 rounded-lg border border-border bg-white p-2">
                    <span className="mt-[3px] flex-shrink-0 rounded-md bg-[#EEF0FF] px-2 py-[3px] text-[10.5px] font-bold text-[#3C3489]">{weekLabel(it)}</span>
                    <div className="min-w-0 flex-1">
                      <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })}
                        className="w-full border-0 p-0 text-[12.5px] font-semibold text-ink outline-none" />
                      <input value={it.detail} onChange={(e) => updateItem(idx, { detail: e.target.value })}
                        placeholder="Optional detail the client will read"
                        className="mt-0.5 w-full border-0 p-0 text-[11.5px] text-muted outline-none" />
                    </div>
                    {it.criterion_code && <span className="mt-[3px] flex-shrink-0 rounded-md bg-[#F4F5F8] px-1.5 py-[3px] text-[10px] font-bold text-ink-2">{it.criterion_code}</span>}
                    <span className="mt-[2px] flex-shrink-0"><PriorityPill value={it.priority} onChange={(p) => updateItem(idx, { priority: p })} /></span>
                    <button onClick={() => patch({ items: b.items.filter((_, i) => i !== idx) })}
                      className="mt-[2px] flex-shrink-0 rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Exactly what lands in their inbox */}
        <div className="mb-3 overflow-hidden rounded-xl border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-[#F9FAFB] px-3 py-2">
            <Eye className="h-3.5 w-3.5 text-muted" />
            <span className="text-[11.5px] font-semibold text-ink-2">Exactly what {clientEmail || 'the client'} will receive</span>
          </div>
          <iframe title="Roadmap preview" className="h-[520px] w-full bg-white" srcDoc={renderRoadmapEmail(preview)} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => doSave()} disabled={busy === 'save'} className="btn btn-outline btn-sm">
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft
          </button>
          <button onClick={doPdf} className="btn btn-outline btn-sm"><FileDown className="h-3.5 w-3.5" /> Download PDF</button>
          <button onClick={doSend} disabled={!clientEmail || busy === 'send'} className="btn btn-primary btn-sm ml-auto"
            title={clientEmail ? `Send to ${clientEmail}` : 'This lead has no email'}>
            {busy === 'send' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sent ? 'Send again' : 'Send to client'}
          </button>
        </div>
      </div>
    );
  }

  // ══ BUILD ═════════════════════════════════════════════════════════════════
  return (
    <div>
      {sent && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-3 py-2 text-[12px] text-[#1B7A44]">
          <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          Sent{row?.sent_at ? ` on ${new Date(row.sent_at).toLocaleDateString('en-IN')}` : ''}. You can still edit and send an updated version.
        </div>
      )}

      <Section n={1} title="The plan" hint="Route, grade and how long the client has.">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Route">
            <select className={INPUT} value={b.route_id ?? ''}
              onChange={(e) => {
                const r = routes.find((x) => x.id === e.target.value);
                // Changing route invalidates criteria and any activity tied to
                // them — clearing is the honest behaviour, not silently keeping
                // items that no longer belong to the route.
                patch({ route_id: r?.id ?? null, route_name: r?.name ?? '', criterion_ids: [], items: [] });
              }}>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Grade">
            <select className={INPUT} value={b.grade} onChange={(e) => patch({ grade: e.target.value })}>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Duration">
            <select className={INPUT} value={b.duration_weeks}
              onChange={(e) => patch({ duration_weeks: Number(e.target.value) })}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} weeks</option>)}
            </select>
          </Field>
          <Field label="Profile / field">
            <input className={INPUT} value={b.profile} onChange={(e) => patch({ profile: e.target.value })} placeholder="AI Engineer" />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="What do we need to build? (1–2 lines, the client reads this)">
            <textarea className={`${INPUT} min-h-[58px] resize-y`} value={b.summary}
              onChange={(e) => patch({ summary: e.target.value })}
              placeholder="Needs award nomination, speaking opportunity and recommendation letters. External recognition is currently weak." />
          </Field>
        </div>
      </Section>

      <Section
        n={2}
        title={copy.title}
        hint={routeCriteria.length ? copy.hint : copy.empty}
        right={routeCriteria.length
          ? <span className="rounded-full bg-[#F4F5F8] px-2 py-1 text-[11px] font-semibold text-ink-2">{b.criterion_ids.length} selected</span>
          : undefined}
      >
        {routeCriteria.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted">
            This route has nothing set up yet, so every activity in the library is
            offered below. Add its criteria in <b>Manage library</b> when you are ready —
            the plan you build now still works.
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {routeCriteria.map((c) => {
            const on = b.criterion_ids.includes(c.id);
            return (
              <button key={c.id} type="button"
                onClick={() => patch(
                  // A pathway is a CHOICE OF ONE — an applicant qualifies through
                  // an appointment or a fellowship or a grant, never two at once.
                  // Criteria are a multi-select. Same control, different rule.
                  copy.single
                    ? {
                        criterion_ids: on ? [] : [c.id],
                        items: b.items.filter((i) => !i.criterion_code || i.criterion_code === c.code),
                      }
                    : {
                        criterion_ids: on ? b.criterion_ids.filter((x) => x !== c.id) : [...b.criterion_ids, c.id],
                        // Un-ticking removes activities that existed only because
                        // of it, so the plan can never contradict the picks.
                        items: on ? b.items.filter((i) => i.criterion_code !== c.code) : b.items,
                      }
                )}
                className="flex items-start gap-2.5 rounded-xl border p-3 text-left transition"
                style={on
                  ? { borderColor: '#6366F1', background: '#F7F7FF', boxShadow: '0 0 0 3px rgba(99,102,241,.10)' }
                  : { borderColor: 'var(--border, #E8EAF0)', background: '#fff' }}>
                <span className="mt-[1px] flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center rounded-[5px] border transition"
                  style={on ? { background: '#6366F1', borderColor: '#6366F1' } : { borderColor: '#CBD1DD' }}>
                  {on && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="rounded bg-[#0F1728] px-1.5 py-[2px] text-[10px] font-bold text-white">{c.code}</span>
                    <span className="text-[12.5px] font-semibold text-ink">{c.title}</span>
                    {c.kind === 'mandatory' && <span className="rounded bg-[#FEECEC] px-1.5 py-[2px] text-[9.5px] font-bold uppercase text-[#B42318]">Required</span>}
                    {c.kind === 'pathway' && <span className="rounded bg-[#EEF0FF] px-1.5 py-[2px] text-[9.5px] font-bold uppercase text-[#3C3489]">Pick one</span>}
                  </span>
                  {c.description && <span className="mt-1 block text-[11.5px] leading-snug text-muted">{c.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        n={3}
        title="Activities"
        hint={b.criterion_ids.length || routeCriteria.length === 0
          ? 'Tick what this candidate will actually do. Everything is editable later.'
          : `Choose ${copy.single ? 'a pathway' : 'a criterion'} above to see the activities that evidence it.`}
        right={<button onClick={() => setLibOpen(true)} className="flex items-center gap-1 text-[11.5px] font-bold text-indigo hover:underline"><Library className="h-3.5 w-3.5" /> Manage library</button>}
      >
        {offered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-faint">
            No activities yet — {copy.single ? 'pick a pathway' : 'tick a criterion'} above, or add one to the library.
          </div>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {offered.map((a) => {
              const on = isPicked(a);
              const code = a.criterion_id ? codeById.get(a.criterion_id) : '';
              return (
                <button key={a.id} type="button" onClick={() => toggleActivity(a)}
                  className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition"
                  style={on ? { borderColor: '#6366F1', background: '#F7F7FF' } : { borderColor: 'var(--border, #E8EAF0)', background: '#fff' }}>
                  <span className="flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[5px] border"
                    style={on ? { background: '#6366F1', borderColor: '#6366F1' } : { borderColor: '#CBD1DD' }}>
                    {on && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{a.title}</span>
                    {a.detail && <span className="block truncate text-[11px] text-muted">{a.detail}</span>}
                  </span>
                  {code && <span className="flex-shrink-0 rounded bg-[#F4F5F8] px-1.5 py-[2px] text-[10px] font-bold text-ink-2">{code}</span>}
                  <PriorityPill value={a.priority} />
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => patch({
            items: [...b.items, {
              activity_id: null, criterion_code: '', title: '', detail: '',
              priority: 'IMPORTANT', week_from: 1, week_to: Math.min(b.duration_weeks, 2),
            }],
          })}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] font-semibold text-ink-2 transition hover:border-indigo hover:text-indigo">
          <Plus className="h-3.5 w-3.5" /> Add a one-off activity for this client
        </button>
      </Section>

      <Section
        n={4}
        title="Weeks"
        hint="Set when each activity happens. Re-space evenly gives you a starting layout to adjust."
        right={b.items.length > 1 ? (
          <button onClick={() => patch({ items: autoSchedule(b.items, b.duration_weeks) })}
            className="flex items-center gap-1 text-[11.5px] font-bold text-indigo hover:underline">
            <Sparkles className="h-3.5 w-3.5" /> Re-space evenly
          </button>
        ) : undefined}
      >
        {b.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-faint">
            Nothing chosen yet. Tick a few activities above.
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortItems(b.items).map((it) => {
              const idx = b.items.indexOf(it);
              return (
                <div key={idx} className="flex items-center gap-2 rounded-lg border border-border bg-white px-2.5 py-2">
                  <GripVertical className="h-3.5 w-3.5 flex-shrink-0 text-faint" />
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <input type="number" min={1} max={b.duration_weeks} value={it.week_from}
                      onChange={(e) => {
                        const from = Math.min(Math.max(1, Number(e.target.value) || 1), b.duration_weeks);
                        updateItem(idx, { week_from: from, week_to: Math.max(from, it.week_to) });
                      }}
                      className="w-[46px] rounded-md border border-border px-1.5 py-1 text-center text-[12px] font-semibold outline-none focus:border-indigo" />
                    <span className="text-[11px] text-faint">–</span>
                    <input type="number" min={1} max={b.duration_weeks} value={it.week_to}
                      onChange={(e) => {
                        const to = Math.min(Math.max(1, Number(e.target.value) || 1), b.duration_weeks);
                        updateItem(idx, { week_to: to, week_from: Math.min(it.week_from, to) });
                      }}
                      className="w-[46px] rounded-md border border-border px-1.5 py-1 text-center text-[12px] font-semibold outline-none focus:border-indigo" />
                  </div>
                  <input value={it.title} onChange={(e) => updateItem(idx, { title: e.target.value })}
                    placeholder="Activity"
                    className="min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-1 text-[12.5px] font-medium text-ink outline-none hover:border-border focus:border-indigo" />
                  {it.criterion_code && <span className="flex-shrink-0 rounded bg-[#F4F5F8] px-1.5 py-[2px] text-[10px] font-bold text-ink-2">{it.criterion_code}</span>}
                  <PriorityPill value={it.priority} onChange={(p) => updateItem(idx, { priority: p })} />
                  <button onClick={() => patch({ items: b.items.filter((_, i) => i !== idx) })}
                    className="flex-shrink-0 rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* sticky action bar */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-1 py-2.5 backdrop-blur">
        <span className="text-[11.5px] text-muted">
          {b.items.length} activities · {b.criterion_ids.length} criteria · {b.duration_weeks} weeks
          {dirty && <span className="ml-1.5 text-[#A25D07]">· unsaved</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => doSave()} disabled={busy === 'save'} className="btn btn-outline btn-sm">
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft
          </button>
          <button onClick={() => setView('review')} disabled={!b.items.length} className="btn btn-primary btn-sm">
            <Eye className="h-3.5 w-3.5" /> Review &amp; send
          </button>
        </div>
      </div>

      {libOpen && (
        <LibraryManager
          workspaceId={workspace.id}
          routeId={b.route_id}
          criteria={routeCriteria}
          activities={activities}
          onClose={() => setLibOpen(false)}
          onChanged={(next) => setActivities(next)}
        />
      )}
    </div>
  );
}

// ── library manager ─────────────────────────────────────────────────────────
// Kept inside this component's file and opened as an overlay, so nothing in
// Settings or the sidebar had to be touched to ship it.
function LibraryManager({ workspaceId, routeId, criteria, activities, onClose, onChanged }: {
  workspaceId: string; routeId: string | null;
  criteria: RmCriterion[]; activities: RmActivity[];
  onClose: () => void; onChanged: (next: RmActivity[]) => void;
}) {
  const [rows, setRows] = useState<RmActivity[]>(activities);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ title: string; detail: string; criterion_id: string; priority: Priority }>(
    { title: '', detail: '', criterion_id: '', priority: 'IMPORTANT' });

  const add = async () => {
    if (!draft.title.trim()) { toast.error('Give the activity a name'); return; }
    setSaving(true);
    const sb = createClient();
    const { data, error } = await sb.from('roadmap_activities').insert({
      workspace_id: workspaceId,
      criterion_id: draft.criterion_id || null,
      title: draft.title.trim(), detail: draft.detail.trim() || null,
      priority: draft.priority, sort_order: rows.length,
    }).select('*').single();
    setSaving(false);
    if (error || !data) { toast.error(error?.message || 'Could not add'); return; }
    const next = [...rows, data as RmActivity];
    setRows(next); onChanged(next);
    setDraft({ title: '', detail: '', criterion_id: '', priority: 'IMPORTANT' });
    toast.success('Added to the library — available for every client from now on');
  };

  const remove = async (a: RmActivity) => {
    const sb = createClient();
    // Deactivated rather than deleted: roadmaps already sent still reference it.
    const { error } = await sb.from('roadmap_activities').update({ active: false }).eq('id', a.id);
    if (error) { toast.error(error.message); return; }
    const next = rows.filter((x) => x.id !== a.id);
    setRows(next); onChanged(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F1728]/40 p-4" onClick={onClose}>
      <div className="max-h-[86vh] w-full max-w-[620px] overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,40,.4)]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="m-0 text-[13.5px] font-semibold">Roadmap library</h3>
            <p className="m-0 mt-0.5 text-[11.5px] text-muted">Add it once; it is available for every client afterwards.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-[#F4F5F8] hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-b border-[#F1F2F6] py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">{a.title}</span>
                {a.detail && <span className="block truncate text-[11px] text-muted">{a.detail}</span>}
              </span>
              {a.criterion_id && (
                <span className="flex-shrink-0 rounded bg-[#F4F5F8] px-1.5 py-[2px] text-[10px] font-bold text-ink-2">
                  {criteria.find((c) => c.id === a.criterion_id)?.code ?? '—'}
                </span>
              )}
              <PriorityPill value={a.priority} />
              <button onClick={() => remove(a)} title="Remove from the library"
                className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>

        <div className="border-t border-border bg-[#FAFBFC] px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={INPUT} placeholder="Activity name" value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <input className={INPUT} placeholder="Detail (optional)" value={draft.detail}
              onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
            <select className={INPUT} value={draft.criterion_id}
              onChange={(e) => setDraft({ ...draft, criterion_id: e.target.value })}>
              <option value="">General (no criterion)</option>
              {criteria.filter((c) => !routeId || c.route_id === routeId)
                .map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
            </select>
            <select className={INPUT} value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </div>
          <button onClick={add} disabled={saving} className="btn btn-primary btn-sm mt-2.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add to library
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoadmapBuilder;
