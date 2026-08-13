'use client';

// =============================================================================
// CAMPAIGN CENTER — two machines, one glance, zero training.
//
// Written for the employee who joins tomorrow. The screen answers, in order,
// the only four questions that matter:
//   IS IT WORKING?   → the pipeline strip: Engine · Sending hours · WhatsApp,
//                      each green or explained in one plain sentence.
//   WHO GETS WHAT?   → one card per campaign: every Hot/Cold lead, the message
//                      list, live counts, a ring showing progress.
//   PROVE IT.        → "Send message 1 to my phone" — the exact code path the
//                      engine uses, verdict on screen in seconds.
//   WHO ANSWERED?    → replies (open the chat) and failures (one-click retry).
//
// Design: no native browser controls anywhere. Custom switches, steppers,
// popover pickers, progress rings, pulse dots — Linear/Attio-grade, on the
// module's existing green.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Flame, Snowflake, Play, Loader2, RefreshCw, Check, X, ChevronDown,
  Minus, Plus, MessageSquare, AlertTriangle, Zap, Send, CornerDownRight,
  Trash2, GripVertical, HeartPulse, Clock, Smartphone, PauseCircle,
} from 'lucide-react';
import type { WaTemplate } from '@/lib/whatsapp/types';

// ── shapes (mirror wa_home) ──────────────────────────────────────────────────
interface StepRow {
  step_no: number; template_id: string; template_name: string; template_body: string;
  wait_days: number; meta_status: string; sent: number;
}
interface Campaign {
  id: string; name: string; stage: string; status: 'running' | 'paused';
  steps: StepRow[];
  waiting: number; replied: number; done: number; paused: number;
  stopped: number; failed: number; total: number; due_now: number;
  next_send_at: string | null; in_stage: number;
}
interface Home {
  ok: boolean;
  settings: {
    connected: boolean; dry_run: boolean; paused: boolean; cap: number;
    window_start: string; window_end: string;
    engine_last_run_at: string | null;
    engine_last_result: { sent?: number; claimed?: number; skipped?: string; error?: string } | null;
  } | null;
  in_window: boolean; sent_today: number;
  cron: Array<{ name: string; schedule: string; active: boolean }>;
  last_http: { status: number; body: string; at: string } | null;
  campaigns: Campaign[];
  replies: Array<{ person_id: string; lead_name: string; campaign: string; replied_at: string | null; body: string | null }>;
  failures: Array<{ person_id: string; lead_name: string; campaign: string; error: string | null; at_step: number }>;
}
interface DraftStep { key: string; template_id: string; wait_days: number }

let seed = 0;
const nk = () => `k${++seed}`;
const ago = (iso: string | null) => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};
const at = (iso: string | null) => iso
  ? new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso))
  : '—';
const preview = (b: string) => b.replace(/\{\{\s*1\s*\}\}/g, 'Vikram').replace(/\{\{\s*\d+\s*\}\}/g, '…');

export default function CampaignCenter({ workspaceId, templates }: {
  workspaceId: string; templates: WaTemplate[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates]);

  const [home, setHome] = useState<Home | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);       // expanded campaign
  const [draft, setDraft] = useState<DraftStep[] | null>(null);    // step edits
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testBusy, setTestBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('wa_home', { p_workspace_id: workspaceId });
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        toast.error('Run migration 062 in Supabase first — the new campaign tables are missing.');
      } else if (!loaded.current) toast.error(error.message);
      return;
    }
    setHome(data as Home);
    loaded.current = true;
  }, [supabase, workspaceId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // ── actions ────────────────────────────────────────────────────────────────
  const toggleCampaign = async (c: Campaign) => {
    const next = c.status === 'running' ? 'paused' : 'running';
    const { error } = await supabase.from('wa_campaigns').update({ status: next }).eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    if (next === 'running') await supabase.rpc('wa_sync', { p_workspace_id: workspaceId });
    toast.success(next === 'running'
      ? `${c.name} is ON — everyone in the stage is in, sends resume inside your hours`
      : `${c.name} is paused — nothing sends until you switch it back on`);
    load();
  };

  const runEngine = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/whatsapp/campaigns/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await res.json();
      if (!j.ok) toast.error(j.reason || 'Engine run failed');
      else if (j.skipped) toast.info(`Engine ran but skipped: ${String(j.skipped).replace(/_/g, ' ')}`);
      else toast.success(`Engine ran — ${j.sent} sent, ${j.failed} failed, ${j.claimed} claimed${j.dryRun ? ' (dry-run)' : ''}`);
      load();
    } finally { setRunning(false); }
  };

  const sendTest = async (campaignId: string) => {
    if (!testPhone.trim()) { toast.error('Type the phone number first'); return; }
    setTestBusy(campaignId); setTestResult(null);
    try {
      const res = await fetch('/api/whatsapp/campaigns/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: { campaignId, phone: testPhone.trim() } }),
      });
      const j = await res.json();
      setTestResult({ ok: !!j.ok, detail: j.detail || (j.ok ? 'Sent.' : 'Failed.') });
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message });
    } finally { setTestBusy(null); }
  };

  const openEditor = (c: Campaign) => {
    setOpenId(openId === c.id ? null : c.id);
    setDraft(c.steps.map((s) => ({ key: nk(), template_id: s.template_id, wait_days: s.wait_days })));
    setTestResult(null);
  };

  const saveSteps = async (campaignId: string) => {
    if (!draft) return;
    setSaving(true);
    const { data, error } = await supabase.rpc('wa_save_steps', {
      p_campaign_id: campaignId,
      p_steps: draft.map((d) => ({ template_id: d.template_id, wait_days: d.wait_days })),
    });
    setSaving(false);
    if (error || data === -1) { toast.error(error?.message || 'Only campaign admins can edit'); return; }
    toast.success(`Saved — ${data} message${data === 1 ? '' : 's'}`);
    load();
  };

  const personAction = async (id: string, action: 'resume' | 'stop') => {
    const { data, error } = await supabase.rpc('wa_person_action', { p_person_id: id, p_action: action });
    if (error || data === 'not_campaign_admin') { toast.error(error?.message || 'Admins only'); return; }
    toast.success(action === 'resume' ? 'Back in the queue' : 'Stopped for good');
    load();
  };

  if (!home || !home.settings) {
    return <div className="flex items-center justify-center py-24 text-[13px] text-muted">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading campaigns…
    </div>;
  }

  const s = home.settings;
  // Plain-English problems, worst first. An empty list = the strip is green.
  const problems: Array<{ text: string; fix: string }> = [];
  if (s.paused) problems.push({ text: 'Sending is paused for everything.', fix: 'Settings tab → turn "Pause all sending" off.' });
  if (!s.connected && !s.dry_run) problems.push({ text: 'WhatsApp is not connected.', fix: 'Settings tab → Test connection.' });
  if (s.dry_run) problems.push({ text: 'Dry-run is ON — messages are logged but never actually sent.', fix: 'Settings tab → switch dry-run off when you are ready to go live.' });
  if (home.cron.length < 2) problems.push({ text: 'The scheduler jobs are missing — nothing runs by itself.', fix: 'Run migration 062 again in Supabase.' });
  if (home.last_http && home.last_http.status >= 400) problems.push({
    text: `The scheduler's last call to the website was rejected (HTTP ${home.last_http.status}).`,
    fix: 'Tell your developer this exact number — the engine cannot run until the website accepts the call.',
  });
  const engineFresh = s.engine_last_run_at
    && Date.now() - new Date(s.engine_last_run_at).getTime() < 12 * 60_000;
  if (!engineFresh && problems.length === 0 && home.in_window) {
    problems.push({ text: 'The engine has not reported in the last 10 minutes.', fix: 'Press "Run engine now" — if numbers move, the scheduler will catch up on its own.' });
  }
  const allGood = problems.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1220px] px-5 pb-20 pt-5">

        {/* ══ THE PIPELINE — is it working? ══════════════════════════════════ */}
        <section className="relative mb-5 overflow-hidden rounded-[20px] bg-[#0C1424] p-5 text-white shadow-[0_18px_50px_-20px_rgba(12,20,36,.55)]">
          <div className="pointer-events-none absolute -right-24 -top-32 h-[300px] w-[300px] rounded-full bg-[#22C55E]/15 blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-40 left-1/3 h-[280px] w-[280px] rounded-full bg-[#6366F1]/10 blur-[90px]" />

          <div className="relative flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <span className={cn('relative flex h-11 w-11 items-center justify-center rounded-2xl',
                allGood ? 'bg-[#22C55E]/15' : 'bg-[#F59E0B]/15')}>
                <HeartPulse className={cn('h-5 w-5', allGood ? 'text-[#4ADE80]' : 'text-[#FBBF24]')} />
                {allGood && <span className="absolute inset-0 animate-ping rounded-2xl bg-[#22C55E]/20" />}
              </span>
              <div>
                <h2 className="text-[15.5px] font-semibold tracking-[-.015em]">
                  {allGood ? 'Everything is running' : 'Needs your attention'}
                </h2>
                <p className="text-[12px] text-white/55">
                  Engine checks in every 5 minutes · members refresh every 10 · sends {s.window_start.slice(0, 5)}–{s.window_end.slice(0, 5)} IST
                </p>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2.5">
              <Vital label="Engine" ok={!!engineFresh}
                value={s.engine_last_run_at ? ago(s.engine_last_run_at) : 'never ran'} />
              <Vital label="Sent today" ok={home.sent_today < s.cap}
                value={`${home.sent_today} / ${s.cap}`} />
              <Vital label="Sending hours" ok={home.in_window}
                value={home.in_window ? 'open now' : `opens ${s.window_start.slice(0, 5)}`} />
              <Vital label="WhatsApp" ok={s.connected && !s.dry_run}
                value={s.dry_run ? 'dry-run' : s.connected ? 'connected' : 'offline'} />
              <button onClick={runEngine} disabled={running}
                className="flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[12.5px] font-semibold text-[#0C1424] transition hover:bg-[#E9FBEF] disabled:opacity-60">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Run engine now
              </button>
            </div>
          </div>

          {problems.length > 0 && (
            <div className="relative mt-4 grid gap-2">
              {problems.map((p, i) => (
                <div key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-xl bg-white/[.06] px-3.5 py-2.5 text-[12.3px] leading-[1.55] backdrop-blur">
                  <AlertTriangle className="h-3.5 w-3.5 translate-y-[2px] text-[#FBBF24]" />
                  <b className="font-semibold text-white/90">{p.text}</b>
                  <span className="text-white/55">Fix: {p.fix}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ══ THE TWO MACHINES ═══════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {home.campaigns.map((c) => {
            const hot = c.stage === 'hot';
            const finished = c.done + c.replied + c.stopped;
            const pct = c.total > 0 ? Math.round((finished / c.total) * 100) : 0;
            const isOpen = openId === c.id;
            return (
              <section key={c.id}
                className={cn('overflow-hidden rounded-[20px] border bg-white shadow-[0_2px_10px_-4px_rgba(15,23,40,.08)] transition-shadow hover:shadow-[0_10px_30px_-12px_rgba(15,23,40,.16)]',
                  c.status === 'running' ? 'border-[#DCEAE2]' : 'border-[#E8EAF0]')}>

                {/* header */}
                <div className={cn('relative overflow-hidden px-5 pb-4 pt-5',
                  hot ? 'bg-gradient-to-br from-[#FFF7F2] to-white' : 'bg-gradient-to-br from-[#F3F7FF] to-white')}>
                  <div className={cn('pointer-events-none absolute -right-10 -top-14 h-[140px] w-[140px] rounded-full blur-[50px]',
                    hot ? 'bg-[#F97316]/15' : 'bg-[#3B82F6]/12')} />
                  <div className="relative flex items-start gap-3">
                    <span className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl',
                      hot ? 'bg-[#FFEDD5]' : 'bg-[#DBEAFE]')}>
                      {hot ? <Flame className="h-5 w-5 text-[#EA580C]" /> : <Snowflake className="h-5 w-5 text-[#2563EB]" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="truncate text-[15.5px] font-semibold tracking-[-.015em]">{c.name}</h3>
                        {c.status === 'running' ? (
                          <span className="relative flex h-2 w-2 flex-shrink-0">
                            <span className="absolute h-full w-full animate-ping rounded-full bg-[#22C55E]/50" />
                            <span className="relative h-2 w-2 rounded-full bg-[#22C55E]" />
                          </span>
                        ) : (
                          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#CBD1DD]" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">
                        Every <b className="font-semibold text-ink-2">{hot ? 'Hot' : 'Cold'}</b> lead gets these {c.steps.length} messages, spaced over days.
                        New ones join by themselves. A reply stops their messages instantly.
                      </p>
                    </div>
                    <Switch on={c.status === 'running'} onClick={() => toggleCampaign(c)} />
                  </div>
                </div>

                {/* body: ring + numbers */}
                <div className="flex items-center gap-5 px-5 py-4">
                  <Ring pct={pct} tone={hot ? '#F97316' : '#3B82F6'} label={`${c.total}`} sub="people" />
                  <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2">
                    <Stat n={c.waiting} label="getting messages" dot="#22C55E" />
                    <Stat n={c.replied} label="replied — talk to them" dot="#6366F1" strong={c.replied > 0} />
                    <Stat n={c.done} label="finished all messages" dot="#94A3B8" />
                    <Stat n={c.failed} label="failed — needs a look" dot="#EF4444" strong={c.failed > 0} />
                  </div>
                </div>

                {/* footer strip: next send + expand */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[#F0F1F5] px-5 py-3">
                  <span className="flex items-center gap-1.5 text-[11.6px] text-muted">
                    <Clock className="h-3.5 w-3.5 text-faint" />
                    {c.status !== 'running' ? 'Paused — nothing will send'
                      : c.due_now > 0 && home.in_window ? <b className="font-semibold text-[#1B7A44]">{c.due_now} due — sending on the next engine tick (≤5 min)</b>
                      : c.next_send_at ? `Next send ${home.in_window ? `at ${at(c.next_send_at)}` : `when hours open at ${s.window_start.slice(0, 5)}`}`
                      : c.waiting === 0 ? 'Everyone is up to date'
                      : 'Scheduling…'}
                  </span>
                  <button onClick={() => openEditor(c)}
                    className={cn('ml-auto flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-semibold transition',
                      isOpen ? 'border-[#BFE7CD] bg-[#EDFAF1] text-[#1B7A44]'
                             : 'border-[#E3E6ED] bg-white text-ink-2 hover:border-[#CBD1DD]')}>
                    {isOpen ? 'Close' : 'Messages & test'}
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
                  </button>
                </div>

                {/* ── expanded: the message list + test ── */}
                {isOpen && draft && (
                  <div className="border-t border-[#F0F1F5] bg-[#FAFBFC] px-5 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <MessageSquare className="h-3.5 w-3.5 text-[#1B7A44]" />
                      <b className="text-[12.6px] font-semibold">The messages, in order</b>
                      <span className="text-[11px] text-faint">message 1 goes the moment someone joins</span>
                    </div>

                    {draft.map((d, i) => {
                      const tpl = templates.find((t) => t.id === d.template_id);
                      const landDay = draft.slice(1, i + 1).reduce((a, x) => a + x.wait_days, 0);
                      const live = c.steps.find((st) => st.step_no === i + 1);
                      return (
                        <div key={d.key} className="mb-2 rounded-2xl border border-[#E8EAF0] bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <GripVertical className="h-3.5 w-3.5 cursor-grab text-faint" />
                            <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                              hot ? 'bg-[#FFEDD5] text-[#C2410C]' : 'bg-[#DBEAFE] text-[#1D4ED8]')}>{i + 1}</span>
                            <Picker
                              value={d.template_id}
                              options={activeTemplates}
                              onPick={(id) => setDraft((p) => p!.map((x, xi) => xi === i ? { ...x, template_id: id } : x))}
                            />
                            {i === 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#EDFAF1] px-2.5 py-1 text-[10.6px] font-bold text-[#1B7A44]">
                                <Zap className="h-3 w-3" /> On joining
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[11.8px] text-muted">
                                <Stepper value={d.wait_days}
                                  onChange={(v) => setDraft((p) => p!.map((x, xi) => xi === i ? { ...x, wait_days: v } : x))} />
                                days later <span className="text-faint">· day {landDay}</span>
                              </span>
                            )}
                            {live && live.sent > 0 && (
                              <span className="ml-auto rounded-full bg-[#F1F2F6] px-2 py-0.5 text-[10.3px] font-bold tabular-nums text-[#697086]">
                                sent {live.sent}×
                              </span>
                            )}
                            <button onClick={() => setDraft((p) => p!.filter((_, xi) => xi !== i))}
                              className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-faint transition hover:bg-[#FDEEEE] hover:text-[#B3423A]', live && live.sent > 0 ? '' : 'ml-auto')}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {tpl && (
                            <p className="m-0 ml-[46px] mt-2 line-clamp-2 rounded-[4px_12px_12px_12px] bg-[#EDFAF1] px-3 py-2 text-[11.6px] leading-[1.55] text-[#2C3444]">
                              {preview(tpl.body)}
                            </p>
                          )}
                        </div>
                      );
                    })}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button onClick={() => {
                        const used = new Set(draft.map((x) => x.template_id));
                        const next = activeTemplates.find((t) => !used.has(t.id)) ?? activeTemplates[0];
                        if (!next) { toast.error('No templates available'); return; }
                        setDraft((p) => [...p!, { key: nk(), template_id: next.id, wait_days: 7 }]);
                      }}
                        className="flex items-center gap-1.5 rounded-xl border border-dashed border-[#CBD1DD] px-3.5 py-2 text-[12px] font-semibold text-muted transition hover:border-[#25A25A] hover:text-[#1B7A44]">
                        <Plus className="h-3.5 w-3.5" /> Add message
                      </button>
                      <button onClick={() => saveSteps(c.id)} disabled={saving}
                        className="ml-auto flex items-center gap-1.5 rounded-xl bg-[#25A25A] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_3px_10px_-3px_rgba(37,162,90,.5)] transition hover:bg-[#1B7A44] disabled:opacity-60">
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Save messages
                      </button>
                    </div>

                    {/* prove it works, right here */}
                    <div className="mt-4 rounded-2xl border border-[#DDE5FB] bg-white p-3.5">
                      <div className="mb-2 flex items-center gap-2">
                        <Smartphone className="h-3.5 w-3.5 text-[#3A48A8]" />
                        <b className="text-[12.4px] font-semibold">Prove it works — send message 1 to any phone</b>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)}
                          placeholder="+91 98…"
                          className="w-[190px] rounded-xl border border-[#E3E6ED] bg-[#FAFBFC] px-3.5 py-2 text-[12.8px] font-medium outline-none transition placeholder:text-[#A6ACBF] focus:border-[#25A25A] focus:bg-white focus:shadow-[0_0_0_3px_rgba(37,162,90,.12)]" />
                        <button onClick={() => sendTest(c.id)} disabled={testBusy === c.id}
                          className="flex items-center gap-1.5 rounded-xl bg-[#0C1424] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[#1B2841] disabled:opacity-60">
                          {testBusy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          Send test
                        </button>
                        {testResult && (
                          <span className={cn('flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11.8px] font-semibold',
                            testResult.ok ? 'bg-[#EDFAF1] text-[#1B7A44]' : 'bg-[#FDEEEE] text-[#B3423A]')}>
                            {testResult.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                            {testResult.detail}
                          </span>
                        )}
                      </div>
                      <p className="m-0 mt-2 text-[10.8px] leading-[1.5] text-faint">
                        Uses the exact same code the engine uses — if this arrives, the campaign sends. It does not enrol the number.
                      </p>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* ══ REPLIES + NEEDS ATTENTION ══════════════════════════════════════ */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-[20px] border border-[#E8EAF0] bg-white p-4 shadow-[0_2px_10px_-4px_rgba(15,23,40,.08)]">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EEF1FD]">
                <MessageSquare className="h-4 w-4 text-[#3A48A8]" />
              </span>
              <b className="text-[13px] font-semibold">They replied — go talk to them</b>
              <span className="ml-auto text-[11px] text-faint">their messages stopped automatically</span>
            </div>
            {home.replies.length === 0 ? (
              <p className="m-0 py-6 text-center text-[12px] text-faint">No replies yet — they appear here the moment someone answers.</p>
            ) : home.replies.map((r) => (
              <div key={r.person_id} className="mb-1.5 flex items-start gap-2.5 rounded-2xl border border-[#F0F1F5] bg-[#FBFBFC] px-3 py-2.5 last:mb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <b className="truncate text-[12.4px]">{r.lead_name}</b>
                    <span className="flex-shrink-0 text-[10.2px] text-faint">{ago(r.replied_at)}</span>
                  </div>
                  {r.body && (
                    <p className="m-0 mt-0.5 flex items-start gap-1.5 text-[11.6px] leading-[1.5] text-[#45464C]">
                      <CornerDownRight className="mt-[2px] h-3 w-3 flex-shrink-0 text-faint" />
                      <span className="line-clamp-2">{r.body}</span>
                    </p>
                  )}
                </div>
                <a href="/whatsapp"
                  className="flex-shrink-0 rounded-xl bg-[#25A25A] px-3 py-1.5 text-[11.4px] font-bold text-white transition hover:bg-[#1B7A44]">
                  Open chat
                </a>
              </div>
            ))}
          </section>

          <section className="rounded-[20px] border border-[#E8EAF0] bg-white p-4 shadow-[0_2px_10px_-4px_rgba(15,23,40,.08)]">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#FDEEEE]">
                <AlertTriangle className="h-4 w-4 text-[#B3423A]" />
              </span>
              <b className="text-[13px] font-semibold">Needs a look</b>
              <span className="ml-auto text-[11px] text-faint">why it failed + one-click retry</span>
            </div>
            {home.failures.length === 0 ? (
              <p className="m-0 flex items-center justify-center gap-1.5 py-6 text-center text-[12px] text-faint">
                <Check className="h-3.5 w-3.5 text-[#1B7A44]" /> Nothing failing right now.
              </p>
            ) : home.failures.map((f) => (
              <div key={f.person_id} className="mb-1.5 flex items-center gap-2.5 rounded-2xl border border-[#F6D5D2]/60 bg-[#FDF9F8] px-3 py-2.5 last:mb-0">
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[12.2px]">{f.lead_name} <span className="font-normal text-faint">· message {f.at_step}</span></b>
                  <span className="block truncate text-[10.8px] text-[#8A2F28]">{f.error ?? 'send failed'}</span>
                </div>
                <button onClick={() => personAction(f.person_id, 'resume')}
                  className="flex-shrink-0 rounded-xl border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1.5 text-[10.8px] font-bold text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                  ↻ Retry
                </button>
                <button onClick={() => personAction(f.person_id, 'stop')} title="Stop this person"
                  className="flex-shrink-0 rounded-xl p-1.5 text-faint transition hover:bg-[#FDEEEE] hover:text-[#B3423A]">
                  <PauseCircle className="h-4 w-4" />
                </button>
              </div>
            ))}
          </section>
        </div>

        {/* ══ HOW IT WORKS — for whoever joins tomorrow ══════════════════════ */}
        <section className="mt-4 rounded-[20px] border border-dashed border-[#DDE0E9] bg-white/60 px-5 py-4">
          <div className="grid gap-2 text-[12.2px] leading-[1.6] text-muted sm:grid-cols-3">
            <p className="m-0"><b className="text-ink-2">1 · It fills itself.</b> Every lead in Hot or Cold joins the matching campaign automatically — including new leads, within 10 minutes.</p>
            <p className="m-0"><b className="text-ink-2">2 · It paces itself.</b> Messages go out only {s.window_start.slice(0, 5)}–{s.window_end.slice(0, 5)} IST, at most {s.cap} a day, spaced by the day gaps you set above.</p>
            <p className="m-0"><b className="text-ink-2">3 · It stops itself.</b> A reply, an opt-out, a booked meeting, or leaving the stage — any of these stops that person's messages instantly.</p>
          </div>
        </section>
      </div>
    </div>
  );
}

// ═════ pieces ════════════════════════════════════════════════════════════════
function Vital({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <span className="flex items-center gap-2 rounded-xl bg-white/[.07] px-3 py-2 backdrop-blur">
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-[#4ADE80]' : 'bg-[#FBBF24]')} />
      <span className="text-[10px] font-bold uppercase tracking-[.06em] text-white/45">{label}</span>
      <b className="text-[11.8px] font-semibold text-white/90">{value}</b>
    </span>
  );
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={on ? 'Pause campaign' : 'Start campaign'}
      className={cn('relative h-[30px] w-[54px] flex-shrink-0 rounded-full transition-colors duration-200',
        on ? 'bg-[#22C55E] shadow-[inset_0_1px_3px_rgba(0,0,0,.15)]' : 'bg-[#DDE0E9]')}>
      <span className={cn('absolute top-[3px] flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.2)] transition-all duration-200',
        on ? 'left-[27px]' : 'left-[3px]')}>
        {on ? <Check className="h-3 w-3 text-[#16A34A]" /> : <Minus className="h-3 w-3 text-[#A6ACBF]" />}
      </span>
    </button>
  );
}

function Ring({ pct, tone, label, sub }: { pct: number; tone: string; label: string; sub: string }) {
  const R = 30, C = 2 * Math.PI * R;
  return (
    <span className="relative inline-flex h-[86px] w-[86px] flex-shrink-0 items-center justify-center">
      <svg width="86" height="86" viewBox="0 0 86 86" className="-rotate-90">
        <circle cx="43" cy="43" r={R} fill="none" stroke="#F1F2F6" strokeWidth="9" />
        <circle cx="43" cy="43" r={R} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="text-[17px] font-bold leading-none tracking-[-.02em] tabular-nums">{label}</b>
        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[.06em] text-faint">{sub}</span>
      </span>
    </span>
  );
}

function Stat({ n, label, dot, strong }: { n: number; label: string; dot: string; strong?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: dot }} />
      <b className={cn('text-[14px] tabular-nums leading-none', strong ? 'text-ink' : 'text-ink-2')}>{n}</b>
      <span className="text-[11.2px] leading-tight text-muted">{label}</span>
    </span>
  );
}

/** Template picker — a popover list, never a native <select>. */
function Picker({ value, options, onPick }: {
  value: string; options: WaTemplate[]; onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((t) => t.id === value);
  return (
    <span className="relative min-w-0">
      <button onClick={() => setOpen((v) => !v)}
        className="flex max-w-[260px] items-center gap-2 rounded-xl border border-[#E3E6ED] bg-[#FAFBFC] px-3 py-[7px] text-[12.4px] font-semibold text-ink transition hover:border-[#CBD1DD]">
        <span className="truncate">{current?.name ?? 'Pick a message'}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-faint" />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <span className="absolute left-0 top-[38px] z-30 block max-h-[260px] w-[300px] overflow-y-auto rounded-2xl border border-[#E8EAF0] bg-white p-1.5 shadow-[0_18px_40px_-14px_rgba(15,23,40,.28)]">
            {options.map((t) => (
              <button key={t.id}
                onClick={() => { onPick(t.id); setOpen(false); }}
                className={cn('mb-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition last:mb-0',
                  t.id === value ? 'bg-[#EDFAF1]' : 'hover:bg-[#F7F8FA]')}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[12.2px] font-semibold">{t.name}</b>
                  <span className="block truncate text-[10.8px] text-faint">{preview(t.body)}</span>
                </span>
                {t.id === value && <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#1B7A44]" />}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

/** Day-gap stepper — tap −/+, no spinners, no typing required. */
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-xl border border-[#E3E6ED] bg-white">
      <button onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-[30px] w-[26px] items-center justify-center text-muted transition hover:bg-[#F4F5F8]">
        <Minus className="h-3 w-3" />
      </button>
      <b className="w-[30px] text-center text-[12.6px] font-bold tabular-nums">{value}</b>
      <button onClick={() => onChange(Math.min(365, value + 1))}
        className="flex h-[30px] w-[26px] items-center justify-center text-muted transition hover:bg-[#F4F5F8]">
        <Plus className="h-3 w-3" />
      </button>
    </span>
  );
}
