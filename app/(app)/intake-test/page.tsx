'use client';

// =============================================================================
// INTAKE TEST BENCH — /intake-test
//
// Paste the exact JSON body the Make.com scenario sends, press Run, and watch
// every stage of the pipeline narrate itself: where each answer was found,
// what it flattened to, which rule fired, and what the lead WOULD become.
// Nothing is written — this is the wind tunnel, not the runway.
//
// Below the bench: the last Meta leads as they actually landed, so a mapping
// gap is a red chip on this screen instead of a surprise in a report — and one
// button that re-derives tags for every untagged lead after a mapper fix.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { toast } from 'sonner';
import {
  FlaskConical, Play, Loader2, CheckCircle2, AlertTriangle, XCircle,
  Wand2, RefreshCw, ArrowRight,
} from 'lucide-react';
import { getIndustryMeta } from '@/lib/types';
import { getReadinessMeta } from '@/lib/intake';

const SAMPLE = JSON.stringify({
  full_name: 'Test Person',
  phone: '+919999900001',
  email: 'test@example.com',
  expertise: ['Engineering'],
  investment_readiness: ['Yes, I am willing to invest in professional guidance'],
}, null, 2);

interface Trace {
  ok: boolean; reason?: string; detail?: string;
  fields: Array<{ key: string; raw: string; flattened: string | null }>;
  expertise: { found_under: string | null; raw: string | null; value: string | null; rule: string | null };
  readiness: { found_under: string | null; raw: string | null; value: string | null; rule: string | null };
  would: { action: string; industry: string | null; investment_readiness: string | null;
           existing: { id: string; full_name: string } | null };
  problems: string[];
}
interface RecentLead {
  id: string; full_name: string; created_at: string;
  industry: string | null; investment_readiness: string | null;
  intake: Record<string, string> | null;
}

export default function IntakeTestPage() {
  const app = useApp();
  const supabase = useMemo(() => createClient(), []);
  const [payload, setPayload] = useState(SAMPLE);
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [recent, setRecent] = useState<RecentLead[]>([]);
  const [fixing, setFixing] = useState(false);

  const loadRecent = useCallback(async () => {
    const { data } = await supabase.from('leads')
      .select('id, full_name, created_at, industry, investment_readiness, intake')
      .eq('workspace_id', app.workspace.id)
      .contains('tags', ['meta-lead'])
      .order('created_at', { ascending: false }).limit(12);
    setRecent((data ?? []) as RecentLead[]);
  }, [supabase, app.workspace.id]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  async function run() {
    setRunning(true); setTrace(null);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(payload); } catch { toast.error('That is not valid JSON'); return; }
      const res = await fetch('/api/ingest/meta-lead/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const json = (await res.json()) as Trace;
      if (!json.ok) { toast.error(json.detail || json.reason || 'Test failed'); return; }
      setTrace(json);
    } finally { setRunning(false); }
  }

  async function fixUntagged() {
    setFixing(true);
    const { data, error } = await supabase.rpc('intake_rederive', { p_workspace_id: app.workspace.id });
    setFixing(false);
    if (error) { toast.error(error.message); return; }
    const r = (Array.isArray(data) ? data[0] : data) as { updated_industry?: number; updated_readiness?: number } | null;
    toast.success(`Re-derived — ${r?.updated_industry ?? 0} industries and ${r?.updated_readiness ?? 0} readiness tags fixed`);
    loadRecent();
  }

  const untagged = recent.filter((l) => l.intake && Object.keys(l.intake).length > 0 && (!l.industry || !l.investment_readiness)).length;

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-5">
      {/* header */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#E8EAF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#DDE5FB] bg-[#EEF1FD]">
          <FlaskConical className="h-4 w-4 text-[#3A48A8]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[15px] font-bold tracking-[-.015em]">Intake test bench</h1>
          <p className="m-0 mt-px text-[12px] leading-[1.5] text-muted">
            Paste exactly what Make sends, press Run — see where each answer is found, which rule reads it, and what the lead becomes. Nothing is saved.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* left: input */}
        <div className="rounded-xl border border-[#E8EAF0] bg-white p-4 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-[12.6px] font-semibold">The body Make sends</b>
            <button onClick={() => setPayload(SAMPLE)} className="text-[11px] font-semibold text-muted hover:text-ink">Reset sample</button>
          </div>
          <textarea value={payload} onChange={(e) => setPayload(e.target.value)} spellCheck={false} rows={14}
            className="w-full resize-y rounded-[10px] border border-[#E3E6ED] bg-[#0F1728] px-3 py-2.5 font-mono text-[11.8px] leading-[1.6] text-[#D7F3E1] outline-none transition focus:border-[#25A25A]" />
          <button onClick={run} disabled={running}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#25A25A] py-2 text-[13px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-60">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run test — nothing is saved
          </button>
        </div>

        {/* right: the trace */}
        <div className="rounded-xl border border-[#E8EAF0] bg-white p-4 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
          {!trace ? (
            <p className="m-0 py-14 text-center text-[12.6px] text-faint">The verdict appears here.</p>
          ) : (
            <>
              {/* verdict banner */}
              {trace.problems.length === 0 ? (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-3 py-2.5">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-[#1B7A44]" />
                  <b className="text-[12.6px] text-[#1B7A44]">Perfect — this lead would arrive fully tagged.</b>
                </div>
              ) : (
                <div className="mb-3 rounded-lg border border-[#F8E2B8] bg-[#FEF6E6] px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-[#A25D07]" />
                    <b className="text-[12.6px] text-[#A25D07]">{trace.problems.length} problem{trace.problems.length === 1 ? '' : 's'} found</b>
                  </div>
                  {trace.problems.map((p, i) => (
                    <p key={i} className="m-0 mt-1 text-[11.8px] leading-[1.55] text-[#7A4A06]">· {p}</p>
                  ))}
                </div>
              )}

              <TraceRow label="Field of expertise" t={trace.expertise} kind="industry" />
              <TraceRow label="Readiness to invest" t={trace.readiness} kind="readiness" />

              <div className="mt-3 rounded-lg border border-[#E8EAF0] bg-[#F9FAFB] px-3 py-2.5">
                <span className="block text-[9.8px] font-extrabold uppercase tracking-[.07em] text-faint">The result</span>
                <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[12.4px]">
                  <b>{trace.would.action}</b>
                  {trace.would.existing && <span className="text-muted">→ {trace.would.existing.full_name}</span>}
                  <ArrowRight className="h-3 w-3 text-faint" />
                  <Tag kind="industry" v={trace.would.industry} />
                  <Tag kind="readiness" v={trace.would.investment_readiness} />
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* recent landings */}
      <div className="mt-4 rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <div className="flex items-center gap-2 border-b border-[#F0F1F5] px-4 py-3">
          <b className="text-[13px] font-semibold">Last Meta leads, as they actually landed</b>
          <button onClick={loadRecent} className="ml-1 flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-ink">
            <RefreshCw className="h-2.5 w-2.5" /> Refresh
          </button>
          <button onClick={fixUntagged} disabled={fixing}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#DDE5FB] bg-[#EEF1FD] px-3 py-1.5 text-[11.6px] font-semibold text-[#3A48A8] transition hover:bg-[#DDE5FB] disabled:opacity-60"
            title="Re-reads every lead's saved raw answers with the current rules and fills the missing tags">
            {fixing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Fix untagged leads{untagged > 0 ? ` (${untagged} here)` : ''}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.2px]">
            <thead>
              <tr className="text-left text-[9.8px] font-extrabold uppercase tracking-[.07em] text-faint">
                <th className="px-4 py-2.5">Lead</th>
                <th className="px-4 py-2.5">They answered (raw)</th>
                <th className="px-4 py-2.5">Industry</th>
                <th className="px-4 py-2.5">Can invest</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-[12.2px] text-faint">No Meta leads yet.</td></tr>
              )}
              {recent.map((l) => (
                <tr key={l.id} className="border-t border-[#F3F4F8]">
                  <td className="px-4 py-2.5"><b className="font-semibold">{l.full_name}</b></td>
                  <td className="max-w-[300px] truncate px-4 py-2.5 text-muted">
                    {l.intake?.expertise ?? <span className="text-faint">— no expertise answer stored</span>}
                  </td>
                  <td className="px-4 py-2.5"><Tag kind="industry" v={l.industry} /></td>
                  <td className="px-4 py-2.5"><Tag kind="readiness" v={l.investment_readiness} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 border-t border-[#F0F1F5] px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
          A red “Not set” next to a real answer means the wording matched no rule — run it through the bench above, then send me the wording.
          “No expertise answer stored” means Make never sent it for that lead — that ad form’s mapping needs fixing in Make.
        </p>
      </div>
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function TraceRow({ label, t, kind }: {
  label: string;
  t: { found_under: string | null; raw: string | null; value: string | null; rule: string | null };
  kind: 'industry' | 'readiness';
}) {
  return (
    <div className="mb-2 rounded-lg border border-[#E8EAF0] px-3 py-2.5">
      <span className="block text-[9.8px] font-extrabold uppercase tracking-[.07em] text-faint">{label}</span>
      {!t.raw ? (
        <p className="m-0 mt-1 flex items-center gap-1.5 text-[12.2px] text-[#B02B2B]">
          <XCircle className="h-3.5 w-3.5 flex-shrink-0" /> Not found under any key or field_data entry.
        </p>
      ) : (
        <div className="mt-1 grid gap-0.5 text-[12px]">
          <span className="text-muted">Found under <code className="rounded bg-[#F4F5F8] px-1 font-mono text-[11px] font-bold text-[#697086]">{t.found_under}</code></span>
          <span className="text-muted">They answered: <b className="text-ink">“{t.raw}”</b></span>
          <span className="flex items-center gap-1.5 text-muted">
            Read as: <Tag kind={kind} v={t.value} />
            {t.rule
              ? <code className="max-w-[260px] truncate rounded bg-[#F4F5F8] px-1 font-mono text-[10px] text-[#A6ACBF]" title={t.rule}>{t.rule}</code>
              : <span className="text-[11px] font-semibold text-[#B02B2B]">no rule matched</span>}
          </span>
        </div>
      )}
    </div>
  );
}

function Tag({ kind, v }: { kind: 'industry' | 'readiness'; v: string | null }) {
  if (!v) {
    return <span className="rounded-md bg-[#FCEBEB] px-1.5 py-0.5 text-[10.6px] font-bold text-[#A32D2D]">Not set</span>;
  }
  const m = kind === 'industry' ? getIndustryMeta(v) : getReadinessMeta(v);
  if (!m) return <span className="rounded-md bg-[#F4F4F6] px-1.5 py-0.5 text-[10.6px] font-bold text-[#6B7280]">{v}</span>;
  const meta = m as { label?: string; short?: string; bg: string; fg: string };
  return (
    <span className="rounded-md px-1.5 py-0.5 text-[10.6px] font-bold" style={{ background: meta.bg, color: meta.fg }}>
      {('short' in meta && meta.short) || meta.label || v}
    </span>
  );
}
