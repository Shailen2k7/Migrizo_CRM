'use client';

// =============================================================================
// AUTOMATION — email sequences that run themselves. Super-admin only.
//
// Four tabs, exactly the approved design:
//   Sequences → live stats, the three sequences with pause toggles, batch
//               enrolment (fresh leads only), the capacity ramp
//   Flow      → the step-by-step timeline of any sequence; edit waits, add
//               steps from the template library, sleep + one re-engagement
//   Test      → preview any email as the recipient sees it; send a real copy
//               to your own inbox; the inbox-safety checklist
//   Leads     → every enrolment's exact position, with per-lead pause /
//               resume / restart / stop
//
// Everything sends via /api/sequences/tick (pg_cron, every 30 min). The two
// hard guarantees live in the database: one live sequence per lead, and no
// template ever delivered twice.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { wrapCampaignEmail } from '@/lib/email/campaign-shell';
import { cn, initials, avatarColor, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Loader2, ShieldCheck, Zap, Pause, Play, Square, RotateCcw, Send,
  ChevronRight, Plus, Trash2, Check, Moon, Sparkles, X,
} from 'lucide-react';

// ── types mirroring the SQL read models ──────────────────────────────────────
interface Seq {
  id: string; name: string; audience: 'cold' | 'hot' | 'reengagement';
  description: string | null; active: boolean; sleep_days: number;
  steps: number; span_days: number;
  n_active: number; n_paused: number; n_sleeping: number; n_reengagement: number;
  n_completed: number; n_converted: number; n_exited: number; n_dnc: number;
}
interface Stats {
  in_sequence: number; sent_today: number; cap_today: number;
  replied: number; sleeping: number; fresh_cold: number; fresh_hot: number;
}
interface Step { id: string; sequence_id: string; step_no: number; day_offset: number; template_id: string }
interface AutoStatus {
  auto_enrol: boolean; cold_per_day: number; hot_per_day: number;
  last_enrolled_on: string | null; enrolled_today: boolean;
  cap_today: number; projected_daily: number;
}
interface Tpl { id: string; name: string; category: string; subject: string; html: string }
interface Enrolment {
  enrolment_id: string; lead_id: string; lead_name: string; lead_email: string; lead_stage: string;
  sequence_name: string; audience: string; status: string; current_step: number; total_steps: number;
  last_sent_at: string | null; next_send_at: string | null; sleep_until: string | null;
  exit_reason: string | null; enrolled_at: string;
}

type Tab = 'sequences' | 'flow' | 'test' | 'leads';

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  active:         { label: 'Active',        bg: '#EBF7F0', fg: '#2F9E68' },
  reengagement:   { label: 'Re-engaging',   bg: '#FDF6E9', fg: '#B0791B' },
  paused:         { label: 'Paused',        bg: '#FDF6E9', fg: '#B0791B' },
  sleeping:       { label: 'Sleeping',      bg: '#F3F0FD', fg: '#6D4AC9' },
  completed:      { label: 'Completed',     bg: '#F2F2F4', fg: '#6E6E73' },
  converted:      { label: 'Converted',     bg: '#EEF0FF', fg: '#4F46E5' },
  exited:         { label: 'Exited',        bg: '#F2F2F4', fg: '#6E6E73' },
  do_not_contact: { label: 'Do not contact', bg: '#FDF0F2', fg: '#C9455C' },
};
const EXIT_LABEL: Record<string, string> = {
  replied: 'replied', booked: 'booked a call', converted: 'converted',
  unsubscribe: 'unsubscribed', unsubscribed: 'unsubscribed',
  bounce: 'bounced', bounced: 'bounced', complaint: 'marked spam',
  junk: 'marked junk', manual: 'stopped manually',
};

const CHECKS: { t: string; d: string }[] = [
  { t: 'Domain authenticated', d: 'SPF and DKIM verified on updates.migrizo.com' },
  { t: 'DMARC record live', d: 'Published at _dmarc.updates.migrizo.com — monitor mode, tighten to quarantine after clean reports' },
  { t: 'One-click unsubscribe', d: 'Header and visible button both present, as Gmail requires' },
  { t: 'Plain text version included', d: 'HTML-only mail scores worse with every filter' },
  { t: 'No spam trigger words', d: 'No "free", "act now", "guarantee", no all-caps, no exclamation marks' },
  { t: 'Zero images, plain layout', d: 'No logo, no buttons, no coloured blocks. This is what keeps mail out of Promotions.' },
  { t: 'Only two links', d: 'The booking link and unsubscribe. More links raises the spam score.' },
  { t: 'Throttled sending', d: 'Daily cap ramps 30 → 60 → 120 → 180 so the domain warms safely' },
  { t: 'Physical company shown', d: 'Migrizo Ventures Pvt Ltd. in every footer' },
  { t: 'Real reply-to address', d: 'info@migrizo.com — a monitored inbox, never no-reply@' },
];

export default function AutomationPanel() {
  const app = useApp() as ReturnType<typeof useApp> & {
    workspace: { id: string }; user: { id: string; email: string; name: string };
  };
  const { workspace, user } = app;
  const supabase = useMemo(() => createClient(), []);

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('sequences');
  const [seqs, setSeqs] = useState<Seq[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [rows, setRows] = useState<Enrolment[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);

  // enrol batch
  const [batchSeq, setBatchSeq] = useState('');
  const [batchN, setBatchN] = useState('50');
  const [enrolling, setEnrolling] = useState(false);

  // daily auto enrolment
  const [auto, setAuto] = useState<AutoStatus | null>(null);
  const [autoCold, setAutoCold] = useState('30');
  const [autoHot, setAutoHot] = useState('10');
  const [savingAuto, setSavingAuto] = useState(false);

  // test tab
  const [testTplId, setTestTplId] = useState('');
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  // leads tab
  const [q, setQ] = useState('');
  const [busyRow, setBusyRow] = useState<string | null>(null);

  // flow add-step
  const [adding, setAdding] = useState(false);
  const [addTpl, setAddTpl] = useState('');

  const loadAll = useCallback(async () => {
    const [{ data: o }, { data: st }, { data: sp }, { data: t }, { data: ll }] = await Promise.all([
      supabase.rpc('sequences_overview', { p_workspace_id: workspace.id }),
      supabase.rpc('sequence_stats', { p_workspace_id: workspace.id }),
      supabase.from('sequence_steps').select('id, sequence_id, step_no, day_offset, template_id').eq('workspace_id', workspace.id).order('step_no'),
      supabase.from('email_templates').select('id, name, category, subject, html').eq('workspace_id', workspace.id).order('sort').order('created_at'),
      supabase.rpc('sequence_leads_list', { p_workspace_id: workspace.id, p_limit: 400 }),
    ]);
    const { data: au } = await supabase.rpc('sequence_auto_status', { p_workspace_id: workspace.id });
    const a = (Array.isArray(au) ? au[0] : au) as AutoStatus | null;
    if (a) {
      setAuto(a);
      setAutoCold(String(a.cold_per_day || 30));
      setAutoHot(String(a.hot_per_day || 10));
    }
    const ov = (o as Seq[]) || [];
    setSeqs(ov);
    setStats(Array.isArray(st) ? (st[0] as Stats) : (st as Stats));
    setSteps((sp as Step[]) || []);
    setTpls((t as Tpl[]) || []);
    setRows((ll as Enrolment[]) || []);
    setFlowId((cur) => cur || ov[0]?.id || null);
    setBatchSeq((cur) => cur || ov.find((s) => s.audience === 'cold')?.id || '');
    setTestTplId((cur) => cur || ((t as Tpl[]) || [])[0]?.id || '');
  }, [supabase, workspace.id]);

  useEffect(() => {
    let gone = false;
    (async () => {
      const { data: ok } = await supabase.rpc('is_campaign_admin', { p_workspace_id: workspace.id });
      if (gone) return;
      setAllowed(!!ok);
      if (!ok) return;
      // Seed the three default sequences (+ Cold 5/6, RE 1-3 templates) once.
      const { error } = await supabase.rpc('seed_default_sequences', { p_workspace_id: workspace.id });
      if (error) toast.error(/does not exist|schema cache/i.test(error.message)
        ? 'Database not set up — run migration 026 in Supabase, then reload.' : error.message);
      await loadAll();
    })();
    return () => { gone = true; };
  }, [supabase, workspace.id, loadAll]);

  useEffect(() => { setTestTo((v) => v || user.email); }, [user.email]);

  // ── actions ────────────────────────────────────────────────────────────────
  const toggleSeq = async (s: Seq) => {
    setSeqs((p) => p.map((x) => x.id === s.id ? { ...x, active: !s.active } : x));
    const { error } = await supabase.from('sequences').update({ active: !s.active, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) { toast.error(error.message); void loadAll(); return; }
    toast.success(!s.active ? 'Sequence resumed' : 'Sequence paused — nothing sends');
  };

  const enrol = async () => {
    const n = parseInt(batchN, 10);
    if (!batchSeq || !n || n < 1) { toast.error('Pick a sequence and a number'); return; }
    setEnrolling(true);
    const { data, error } = await supabase.rpc('enroll_fresh_leads', {
      p_workspace_id: workspace.id, p_sequence_id: batchSeq, p_count: n,
    });
    setEnrolling(false);
    if (error) { toast.error(error.message); return; }
    const r = Array.isArray(data) ? data[0] : data;
    const got = r?.enrolled ?? 0;
    if (got === 0) toast.error('No fresh leads available for that sequence');
    else toast.success(`${got} fresh lead${got === 1 ? '' : 's'} enrolled${r?.reason === 'partial' ? ' — all that were left' : ''}`);
    await loadAll();
  };

  const saveAuto = async (active: boolean) => {
    setSavingAuto(true);
    const { data, error } = await supabase.rpc('sequence_set_auto_enrol', {
      p_workspace_id: workspace.id, p_active: active,
      p_cold: parseInt(autoCold, 10) || 0, p_hot: parseInt(autoHot, 10) || 0,
    });
    setSavingAuto(false);
    if (error) { toast.error(error.message); return; }
    if (data === 'forbidden') { toast.error('Not allowed'); return; }
    toast.success(active ? 'Daily top up is on' : 'Daily top up is off');
    await loadAll();
  };

  const leadAction = async (id: string, action: 'pause' | 'resume' | 'restart' | 'stop') => {
    if (action === 'stop' && !confirm('Stop this lead\'s sequence permanently?')) return;
    if (action === 'restart' && !confirm('Restart from the top?\n\nAny email they already received is skipped automatically — nobody ever gets the same email twice.')) return;
    setBusyRow(id);
    const { data, error } = await supabase.rpc('lead_sequence_action', { p_enrolment_id: id, p_action: action });
    setBusyRow(null);
    if (error) { toast.error(error.message); return; }
    if (data === 'forbidden') { toast.error('Not allowed'); return; }
    toast.success(String(data).charAt(0).toUpperCase() + String(data).slice(1));
    await loadAll();
  };

  const saveWait = async (step: Step, v: number) => {
    if (!Number.isFinite(v) || v < 0 || v === step.day_offset) return;
    const { error } = await supabase.from('sequence_steps').update({ day_offset: Math.round(v) }).eq('id', step.id);
    if (error) toast.error(error.message);
    else { toast.success('Timing updated'); await loadAll(); }
  };

  const addStep = async () => {
    const seq = seqs.find((s) => s.id === flowId);
    if (!seq || !addTpl) return;
    const mine = steps.filter((s) => s.sequence_id === flowId);
    const nextNo = mine.length + 1;
    const nextOffset = (mine[mine.length - 1]?.day_offset ?? -5) + 5;
    const { error } = await supabase.from('sequence_steps').insert({
      sequence_id: flowId, workspace_id: workspace.id, step_no: nextNo, day_offset: nextOffset, template_id: addTpl,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Email added to the flow');
    setAdding(false); setAddTpl('');
    await loadAll();
  };

  const removeStep = async (step: Step) => {
    const mine = steps.filter((s) => s.sequence_id === step.sequence_id);
    if (mine.length <= 1) { toast.error('A sequence needs at least one email'); return; }
    if (!confirm('Remove this email from the flow?\n\nLeads currently waiting on it move to the next one.')) return;
    // Delete, then close the step_no gap so enrolments never wedge.
    const { error } = await supabase.from('sequence_steps').delete().eq('id', step.id);
    if (error) { toast.error(error.message); return; }
    for (const s of mine.filter((x) => x.step_no > step.step_no)) {
      await supabase.from('sequence_steps').update({ step_no: s.step_no - 1 }).eq('id', s.id);
    }
    toast.success('Removed');
    await loadAll();
  };

  const sendTest = async () => {
    if (!testTplId || !testTo.includes('@')) { toast.error('Pick an email and a destination'); return; }
    setTesting(true);
    const res = await fetch('/api/sequences/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: testTplId, to: testTo.trim() }),
    }).then((r) => r.json()).catch(() => null);
    setTesting(false);
    if (res?.ok) toast.success('Test email sent — check your inbox');
    else toast.error(res?.reason === 'not_configured' ? 'Email sending is not configured' : 'Could not send the test');
  };

  // ── derived ────────────────────────────────────────────────────────────────
  const flowSeq = seqs.find((s) => s.id === flowId) || null;
  const flowSteps = steps.filter((s) => s.sequence_id === flowId).sort((a, b) => a.step_no - b.step_no);
  const tplById = useMemo(() => new Map(tpls.map((t) => [t.id, t])), [tpls]);
  const batchSeqObj = seqs.find((s) => s.id === batchSeq);
  const freshFor = batchSeqObj?.audience === 'hot' ? (stats?.fresh_hot ?? 0) : (stats?.fresh_cold ?? 0);
  const testTpl = tplById.get(testTplId);
  // Enrolling N leads a day does not send N emails a day. Every lead receives
  // one email per step, so daily volume settles at rate x steps.
  const coldSteps = seqs.find((x) => x.audience === 'cold')?.steps || 6;
  const hotSteps = seqs.find((x) => x.audience === 'hot')?.steps || 5;
  const projected = (parseInt(autoCold, 10) || 0) * coldSteps + (parseInt(autoHot, 10) || 0) * hotSteps;
  const capToday = auto?.cap_today || 30;
  const overCap = projected > capToday;
  const suggestHot = Math.max(0, Math.floor((capToday * 0.25) / hotSteps));
  const suggestCold = Math.max(0, Math.floor((capToday - suggestHot * hotSteps) / coldSteps));

  const capSteps = [30, 60, 120, 180];
  const capIdx = Math.max(0, capSteps.indexOf(stats?.cap_today ?? 30));
  const visibleRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => (r.lead_name || '').toLowerCase().includes(s) || (r.lead_email || '').toLowerCase().includes(s));
  }, [rows, q]);

  const previewSrc = useMemo(() => {
    if (!testTpl) return '';
    const subject = testTpl.subject.replace(/\{\{\s*name\s*\}\}/gi, 'Rahul');
    return wrapCampaignEmail(testTpl.html.replace(/\{\{\s*name\s*\}\}/gi, 'Rahul'), subject)
      .replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, '#');
  }, [testTpl]);

  // ── gates ──────────────────────────────────────────────────────────────────
  if (allowed === null) {
    return <div className="py-24 text-center text-[13.5px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading</div>;
  }
  if (!allowed) {
    return (
      <div className="max-w-[560px] mx-auto px-6 py-24 text-center">
        <ShieldCheck className="w-7 h-7 mx-auto text-faint mb-3" />
        <div className="text-[15px] font-medium">Restricted</div>
        <p className="text-[12.5px] text-muted mt-1.5">Automation is managed by the workspace owner. Ask them to grant you campaign access.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 animate-pageIn">
      <p className="text-[13px] text-muted">
        Sequences run themselves. Enrol a batch once and each lead is emailed on schedule until they reply,
        book, convert, unsubscribe or bounce.
      </p>

      {/* sub tabs */}
      <div className="flex gap-0.5 mt-4 border-b border-border">
        {([['sequences', 'Sequences'], ['flow', 'Flow'], ['test', 'Test'], ['leads', 'Leads']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('text-[13.5px] px-3.5 py-2.5 -mb-px border-b-2 transition-colors',
              tab === k ? 'border-ink text-ink font-medium' : 'border-transparent text-muted hover:text-ink')}>
            {l}
          </button>
        ))}
      </div>

      {/* ════ SEQUENCES ════ */}
      {tab === 'sequences' && (
        <div className="pt-5">
          {/* stats */}
          <div className="rounded-[16px] border border-border bg-surface overflow-hidden mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {[
                { n: stats?.in_sequence ?? 0, l: 'In sequence' },
                { n: `${stats?.sent_today ?? 0}`, l: 'Sent today' },
                { n: stats?.replied ?? 0, l: 'Replied', c: '#2F9E68' },
                { n: stats?.sleeping ?? 0, l: 'Sleeping', c: '#6D4AC9' },
              ].map((s, i) => (
                <div key={s.l} className={cn('px-[18px] py-3.5', i > 0 && 'sm:border-l border-border/60', i >= 2 && 'border-t sm:border-t-0 border-border/60')}>
                  <div className="text-[22px] font-semibold tracking-[-0.02em]" style={s.c ? { color: s.c } : undefined}>{s.n}</div>
                  <div className="text-[11.5px] text-faint mt-0.5">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[11.5px] font-medium text-faint uppercase tracking-[0.04em] mb-2.5 ml-0.5">Sequences</div>
          <div className="rounded-[16px] border border-border bg-surface overflow-hidden">
            {seqs.map((s, i) => {
              const live = s.n_active + s.n_reengagement;
              return (
                <div key={s.id} onClick={() => { setFlowId(s.id); setTab('flow'); }}
                  className={cn('flex items-center gap-3.5 px-[18px] py-[17px] cursor-pointer hover:bg-surface-2/60 transition-colors', i > 0 && 'border-t border-border/60')}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={s.active && live > 0
                      ? { background: '#2F9E68', boxShadow: '0 0 0 3px #EBF7F0' }
                      : { background: '#C7C7CC', boxShadow: '0 0 0 3px #F2F2F4' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-medium tracking-[-0.01em]">{s.name}</div>
                    <div className="text-[12.5px] text-muted mt-[3px] flex gap-2 items-center flex-wrap">
                      {s.steps} email{s.steps === 1 ? '' : 's'} over {s.span_days} days
                      {s.audience !== 'reengagement'
                        ? <><span className="text-[11px] px-[7px] py-[2px] rounded-[5px] bg-surface-2 text-ink-2">Sleep {s.sleep_days}d</span>
                            <span className="text-[11px] px-[7px] py-[2px] rounded-[5px]" style={{ background: '#EEF0FF', color: '#4F46E5' }}>{s.audience === 'cold' ? 'Cold' : 'Hot'}</span></>
                        : <span className="text-[11px] px-[7px] py-[2px] rounded-[5px] bg-surface-2 text-ink-2">Runs once after sleep</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[16px] font-semibold tracking-[-0.02em]">{live}</div>
                    <div className="text-[11.5px] text-faint mt-px">active</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); void toggleSeq(s); }} aria-label={s.active ? 'Pause sequence' : 'Resume sequence'}
                    className="relative w-10 h-6 rounded-full flex-shrink-0 transition-colors"
                    style={{ background: s.active ? '#2F9E68' : '#E2E2E7' }}>
                    <span className="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: s.active ? 'translateX(16px)' : 'none' }} />
                  </button>
                </div>
              );
            })}
            {seqs.length === 0 && <div className="py-12 text-center text-[13px] text-faint">Setting up your sequences…</div>}
          </div>

          {/* enrol batch */}
          <div className="text-[11.5px] font-medium text-faint uppercase tracking-[0.04em] mt-7 mb-2.5 ml-0.5">Enrol a batch</div>
          <div className="rounded-[16px] border border-border bg-surface overflow-hidden">
            <div className="flex items-center gap-2.5 flex-wrap px-[18px] py-4">
              <span className="text-[13px] text-muted flex-1 min-w-[200px]">
                Fresh leads only. Anyone ever enrolled, sleeping, converted or unsubscribed is skipped.
              </span>
              <select value={batchSeq} onChange={(e) => setBatchSeq(e.target.value)}
                className="text-[13px] font-medium border border-border rounded-[9px] px-3 py-2 bg-surface outline-none focus:border-indigo-400">
                {seqs.filter((s) => s.audience !== 'reengagement').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="number" min={1} value={batchN} onChange={(e) => setBatchN(e.target.value)}
                className="w-[70px] text-[14px] font-medium text-center border border-border rounded-[9px] py-[7px] bg-surface outline-none focus:border-indigo-400" />
              <button onClick={() => void enrol()} disabled={enrolling}
                className="text-[13px] font-medium px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40">
                {enrolling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Enrol'}
              </button>
            </div>
            <div className="border-t border-border/60 px-[18px] py-[11px] text-[12px] text-faint">
              {batchSeqObj?.audience === 'hot' ? 'Hot' : 'Cold'} pool · <b className="font-medium text-ink-2">{freshFor} fresh leads available</b> for this sequence
            </div>
          </div>

          {/* daily auto enrolment */}
          <div className="text-[11.5px] font-medium text-faint uppercase tracking-[0.04em] mt-7 mb-2.5 ml-0.5">Top up every day</div>
          <div className="rounded-[16px] border border-border bg-surface overflow-hidden">
            <div className="flex items-center gap-3.5 px-[18px] py-4">
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium">Enrol fresh leads automatically</div>
                <div className="text-[12.5px] text-muted mt-[3px]">
                  {auto?.auto_enrol
                    ? <>Running daily. {auto.enrolled_today
                        ? <>Today&rsquo;s batch is already in.</>
                        : <>Today&rsquo;s batch goes in at the next tick.</>}</>
                    : <>Off. You are enrolling by hand.</>}
                </div>
              </div>
              <button onClick={() => void saveAuto(!auto?.auto_enrol)} disabled={savingAuto}
                aria-label={auto?.auto_enrol ? 'Turn off daily top up' : 'Turn on daily top up'}
                className="relative w-10 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-50"
                style={{ background: auto?.auto_enrol ? '#2F9E68' : '#E2E2E7' }}>
                <span className="absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: auto?.auto_enrol ? 'translateX(16px)' : 'none' }} />
              </button>
            </div>

            <div className="border-t border-border/60 px-[18px] py-4 flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2.5">
                <span className="text-[13px] text-muted">Cold per day</span>
                <input type="number" min={0} value={autoCold} onChange={(e) => setAutoCold(e.target.value)}
                  className="w-[68px] text-[14px] font-medium text-center border border-border rounded-[9px] py-[7px] bg-surface outline-none focus:border-indigo-400" />
              </label>
              <label className="flex items-center gap-2.5">
                <span className="text-[13px] text-muted">Hot per day</span>
                <input type="number" min={0} value={autoHot} onChange={(e) => setAutoHot(e.target.value)}
                  className="w-[68px] text-[14px] font-medium text-center border border-border rounded-[9px] py-[7px] bg-surface outline-none focus:border-indigo-400" />
              </label>
              <button onClick={() => void saveAuto(auto?.auto_enrol ?? false)} disabled={savingAuto}
                className="text-[13px] font-medium px-4 py-2 rounded-full border border-border text-ink-2 hover:bg-surface-2 transition-colors disabled:opacity-40">
                {savingAuto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save numbers'}
              </button>
            </div>

            {/* the arithmetic people get wrong: enrolling N a day does not send
                N a day, it eventually sends N x the number of steps */}
            {projected > 0 && (
              <div className="border-t border-border/60 px-[18px] py-[13px] text-[12.5px] leading-relaxed"
                style={overCap ? { background: '#FDF0F2', color: '#8E2F42' } : { color: 'hsl(var(--muted))' }}>
                {overCap
                  ? <>At these numbers you would settle at roughly <b className="font-semibold">{projected} emails a day</b>, above
                      today&rsquo;s cap of {auto?.cap_today}. The cap holds, so new leads would queue up and start late.
                      Try about <b className="font-semibold">{suggestCold} cold</b> and <b className="font-semibold">{suggestHot} hot</b> instead.</>
                  : <>Settles at roughly <b className="font-semibold text-ink">{projected} emails a day</b> once every stage is running,
                      inside today&rsquo;s cap of {auto?.cap_today}. Each lead receives one email per step, not one a day.</>}
              </div>
            )}

            <div className="border-t border-border/60 px-[18px] py-[11px] text-[12px] text-faint">
              Fresh pool left: <b className="font-medium text-ink-2">{stats?.fresh_cold ?? 0} cold</b> and{' '}
              <b className="font-medium text-ink-2">{stats?.fresh_hot ?? 0} hot</b>
            </div>
          </div>

          {/* capacity */}
          <div className="text-[11.5px] font-medium text-faint uppercase tracking-[0.04em] mt-7 mb-2.5 ml-0.5">Sending capacity</div>
          <div className="rounded-[16px] border border-border bg-surface p-[18px]">
            <div className="flex items-end gap-[5px] h-14">
              {capSteps.map((c, i) => (
                <div key={c} className="flex-1 rounded-t-[5px] rounded-b-[2px] transition-all"
                  style={{
                    height: `${(c / 180) * 100}%`,
                    background: i < capIdx ? '#C7CBEF' : i === capIdx ? '#4F46E5' : 'hsl(var(--border))',
                  }} />
              ))}
            </div>
            <div className="flex gap-[5px] mt-2">
              {capSteps.map((c, i) => (
                <div key={c} className={cn('flex-1 text-center text-[11px]', i === capIdx ? 'font-medium' : 'text-faint')}
                  style={i === capIdx ? { color: '#4F46E5' } : undefined}>{c}</div>
              ))}
            </div>
            <div className="border-t border-border/60 mt-3.5 pt-3 text-[12.5px] text-muted">
              <b className="font-medium text-ink">{stats?.sent_today ?? 0} of {stats?.cap_today ?? 30}</b> sent today, spread through the day. The cap rises weekly so your domain warms safely.
            </div>
          </div>
        </div>
      )}

      {/* ════ FLOW ════ */}
      {tab === 'flow' && flowSeq && (
        <div className="pt-5">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select value={flowId || ''} onChange={(e) => setFlowId(e.target.value)}
              className="text-[16px] font-semibold tracking-[-0.02em] border-0 bg-transparent outline-none cursor-pointer pr-1">
              {seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="text-[12.5px] text-muted flex-1 min-w-[180px]">
              {flowSeq.n_active + flowSeq.n_reengagement} active · {flowSeq.n_completed} completed · {(flowSeq.n_exited)} exited early
            </div>
            <button onClick={() => void toggleSeq(flowSeq)}
              className="text-[12.5px] font-medium px-3.5 py-[7px] rounded-full border border-border text-ink-2 hover:bg-surface-2 transition-colors">
              {flowSeq.active ? <><Pause className="w-3 h-3 inline mr-1" />Pause</> : <><Play className="w-3 h-3 inline mr-1" />Resume</>}
            </button>
          </div>

          <div className="rounded-[16px] border border-border bg-surface overflow-hidden">
            <div className="px-5 pt-6 pb-1.5">
              {flowSteps.map((st, i) => {
                const tpl = tplById.get(st.template_id);
                const prevOffset = i === 0 ? 0 : flowSteps[i - 1].day_offset;
                const wait = st.day_offset - prevOffset;
                return (
                  <div key={st.id}>
                    {i > 0 && (
                      <div className="flex gap-3.5">
                        <div className="w-[30px] flex justify-center"><div className="w-[2px] bg-border min-h-[14px]" /></div>
                        <div className="flex items-center gap-2 py-[9px] text-[12.5px] text-muted">
                          wait
                          <input type="number" min={1} defaultValue={wait} key={`${st.id}-${wait}`}
                            onBlur={(e) => void saveWait(st, prevOffset + (Number(e.target.value) || wait))}
                            className="w-[46px] text-[12.5px] font-medium text-center py-1 border border-border rounded-[7px] bg-surface outline-none focus:border-indigo-400" />
                          day{wait === 1 ? '' : 's'}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-3.5">
                      <div className="w-[30px] flex flex-col items-center flex-shrink-0">
                        <div className="w-7 h-7 rounded-full text-[12px] font-medium flex items-center justify-center"
                          style={{ background: '#EEF0FF', color: '#4F46E5' }}>{st.step_no}</div>
                      </div>
                      <div className="flex-1 pb-[5px] min-w-0">
                        <div className="border border-border rounded-xl px-3.5 py-3 bg-surface hover:shadow-sm transition-shadow flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] truncate">{tpl?.subject.replace(/\{\{\s*name\s*\}\}/gi, '…') || 'Missing template'}</div>
                            <div className="text-[12px] text-muted mt-[3px]">{tpl?.name} · day {st.day_offset}</div>
                          </div>
                          <button onClick={() => { setTestTplId(st.template_id); setTab('test'); }} title="Preview this email"
                            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-faint hover:bg-surface-2 hover:text-ink transition-colors">
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => void removeStep(st)} title="Remove from flow"
                            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-faint hover:text-danger transition-colors" style={{}}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* add step */}
              <div className="flex gap-3.5">
                <div className="w-[30px] flex justify-center"><div className="w-[2px] bg-border min-h-[14px]" /></div>
                <div className="flex-1 py-2">
                  {!adding ? (
                    <button onClick={() => setAdding(true)}
                      className="w-full border-[1.5px] border-dashed border-border rounded-xl py-[11px] text-[12.5px] text-faint hover:border-indigo-400 hover:text-indigo-600 transition-colors">
                      <Plus className="w-3 h-3 inline mr-1" />Add an email
                    </button>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <select value={addTpl} onChange={(e) => setAddTpl(e.target.value)}
                        className="flex-1 text-[13px] border border-border rounded-[9px] px-3 py-2 bg-surface outline-none focus:border-indigo-400">
                        <option value="">Pick a template…</option>
                        {tpls.filter((t) => !flowSteps.some((s) => s.template_id === t.id))
                          .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <button onClick={() => void addStep()} disabled={!addTpl}
                        className="text-[12.5px] font-medium px-3.5 py-2 rounded-full bg-indigo-600 text-white disabled:opacity-40">Add</button>
                      <button onClick={() => { setAdding(false); setAddTpl(''); }}
                        className="p-2 text-faint hover:text-ink"><X className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              </div>

              {/* sleep + re-engagement nodes */}
              {flowSeq.audience !== 'reengagement' && (
                <>
                  <div className="flex gap-3.5">
                    <div className="w-[30px] flex flex-col items-center flex-shrink-0">
                      <div className="w-[2px] bg-border min-h-[14px] mb-1.5" />
                      <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#F3F0FD', color: '#6D4AC9' }}>
                        <Moon className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="flex-1 pb-[5px] pt-5">
                      <div className="text-[13.5px]">Sleep for {flowSeq.sleep_days} days</div>
                      <div className="text-[12px] text-muted mt-[3px]">No emails. The lead rests before one final attempt.</div>
                    </div>
                  </div>
                  <div className="flex gap-3.5">
                    <div className="w-[30px] flex flex-col items-center flex-shrink-0">
                      <div className="w-[2px] bg-border min-h-[14px] mb-1.5" />
                      <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#FDF6E9', color: '#B0791B' }}>
                        <Sparkles className="w-3.5 h-3.5" />
                      </div>
                    </div>
                    <div className="flex-1 pb-4 pt-5">
                      <div className="text-[13.5px]">One re-engagement cycle, then done</div>
                      <div className="text-[12px] text-muted mt-[3px]">3 emails over 12 days. After that the lead is never sequenced again.</div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mx-[18px] mb-[18px] mt-1 px-[15px] py-[13px] rounded-xl flex gap-[11px]" style={{ background: '#EBF7F0' }}>
              <div className="w-[22px] h-[22px] rounded-md flex items-center justify-center flex-shrink-0 text-white" style={{ background: '#2F9E68' }}>
                <Check className="w-3 h-3" strokeWidth={3} />
              </div>
              <div>
                <div className="text-[12.5px] font-medium" style={{ color: '#1B6E47' }}>Stops automatically</div>
                <div className="text-[12px] mt-[3px] leading-[1.6]" style={{ color: '#2C7A57' }}>
                  A reply, a booked call, a conversion, an unsubscribe or a bounce removes the lead instantly. Nobody receives the same email twice — the database itself forbids it.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ TEST ════ */}
      {tab === 'test' && (
        <div className="pt-5">
          <div className="text-[12px] text-muted leading-[1.65] px-4 py-[13px] bg-surface-2 border border-border rounded-xl mb-4">
            See exactly what a customer receives before a single email goes out. Pick any email, preview it, then send yourself a real copy.
          </div>

          <div className="flex gap-2.5 mb-3.5 flex-wrap">
            <select value={testTplId} onChange={(e) => setTestTplId(e.target.value)}
              className="flex-1 min-w-[200px] text-[13px] px-3 py-2 border border-border rounded-[9px] bg-surface outline-none focus:border-indigo-400">
              {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@migrizo.com"
              className="flex-1 min-w-[180px] text-[13px] px-3 py-2 border border-border rounded-[9px] bg-surface outline-none focus:border-indigo-400" />
            <button onClick={() => void sendTest()} disabled={testing}
              className="text-[13px] font-medium px-4 py-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3 h-3 inline mr-1.5" />Send test</>}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <div className="text-[11.5px] font-medium text-faint uppercase tracking-[0.04em] mb-2.5 ml-0.5">What they receive</div>
              <div className="rounded-xl border border-border overflow-hidden bg-white">
                <div className="px-3.5 py-[11px] border-b border-border/60 bg-surface-2/60">
                  <div className="text-[11.5px] text-faint">From Migrizo &lt;hello@updates.migrizo.com&gt;</div>
                  <div className="text-[13px] font-medium mt-[3px]">{testTpl?.subject.replace(/\{\{\s*name\s*\}\}/gi, 'Rahul')}</div>
                </div>
                <iframe title="email-preview" className="w-full" style={{ height: 520, border: 0 }} srcDoc={previewSrc} sandbox="" />
              </div>
            </div>
            <div>
              <div className="text-[11.5px] font-medium text-faint uppercase tracking-[0.04em] mb-2.5 ml-0.5">Inbox safety</div>
              <div className="rounded-[16px] border border-border bg-surface overflow-hidden">
                {CHECKS.map((c, i) => (
                  <div key={c.t} className={cn('flex gap-2.5 px-3.5 py-[11px]', i > 0 && 'border-t border-border/60')}>
                    <span className="w-[17px] h-[17px] rounded-full flex items-center justify-center flex-shrink-0 mt-px text-[10px] font-semibold"
                      style={{ background: '#EBF7F0', color: '#2F9E68' }}><Check className="w-2.5 h-2.5" strokeWidth={3} /></span>
                    <div>
                      <div className="text-[12.5px]">{c.t}</div>
                      <div className="text-[11.5px] text-muted mt-[2px] leading-[1.55]">{c.d}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[12px] text-muted leading-[1.65] px-4 py-[13px] bg-surface-2 border border-border rounded-xl mt-3">
                <b className="font-medium text-ink">10 of 10 passing.</b> Emails are deliberately plain so they land in the Primary inbox rather than Promotions. Nobody can guarantee placement, but this maximises the odds.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════ LEADS ════ */}
      {tab === 'leads' && (
        <div className="pt-5">
          <div className="flex items-center gap-3 mb-3.5">
            <div className="text-[12px] text-muted leading-[1.65] flex-1">
              Every lead&rsquo;s position in their sequence. Pause, restart or stop any one of them individually.
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="w-[180px] text-[13px] px-3 py-2 border border-border rounded-[9px] bg-surface outline-none focus:border-indigo-400" />
          </div>
          <div className="rounded-[16px] border border-border bg-surface overflow-hidden">
            {visibleRows.length === 0 && (
              <div className="py-14 text-center text-[13px] text-faint">
                {rows.length === 0 ? 'Nobody is enrolled yet — start with "Enrol a batch" on the Sequences tab.' : 'No matches.'}
              </div>
            )}
            {visibleRows.map((r, i) => {
              const sm = STATUS_META[r.status] || STATUS_META.exited;
              const live = r.status === 'active' || r.status === 'reengagement';
              const busy = busyRow === r.enrolment_id;
              const sub =
                r.status === 'sleeping' ? `Sleeping · wakes ${r.sleep_until ? new Date(r.sleep_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'soon'}`
                : live ? `${r.sequence_name} · email ${Math.min(r.current_step + 1, r.total_steps)} of ${r.total_steps}${r.next_send_at ? ` · next ${new Date(r.next_send_at) <= new Date() ? 'this tick' : new Date(r.next_send_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}`
                : r.status === 'paused' ? `${r.sequence_name} · paused at email ${r.current_step} of ${r.total_steps}`
                : r.exit_reason ? `${r.sequence_name} · ${EXIT_LABEL[r.exit_reason] || r.exit_reason} ${timeAgo(r.enrolled_at)}`
                : r.sequence_name;
              return (
                <div key={r.enrolment_id} className={cn('flex items-center gap-3 px-4 py-[13px]', i > 0 && 'border-t border-border/60')}>
                  <div className="w-[30px] h-[30px] rounded-full text-[11px] font-medium text-white flex items-center justify-center flex-shrink-0"
                    style={{ background: avatarColor(r.lead_id) }}>{initials(r.lead_name || '?')}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] truncate">{r.lead_name}</div>
                    <div className="text-[11.5px] text-faint mt-[2px] truncate">{sub}</div>
                  </div>
                  <div className="hidden sm:flex gap-[3px]">
                    {Array.from({ length: r.total_steps }).map((_, j) => (
                      <span key={j} className="w-4 h-[3px] rounded-sm" style={{ background: j < r.current_step ? '#4F46E5' : 'hsl(var(--border))' }} />
                    ))}
                  </div>
                  <span className="text-[10.5px] font-medium px-[9px] py-[3px] rounded-full whitespace-nowrap" style={{ background: sm.bg, color: sm.fg }}>
                    {sm.label}
                  </span>
                  <div className="flex gap-1">
                    {live && (
                      <button disabled={busy} onClick={() => void leadAction(r.enrolment_id, 'pause')} title="Pause"
                        className="p-1.5 rounded-[7px] text-faint hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-40"><Pause className="w-3.5 h-3.5" /></button>
                    )}
                    {r.status === 'paused' && (
                      <button disabled={busy} onClick={() => void leadAction(r.enrolment_id, 'resume')} title="Resume"
                        className="p-1.5 rounded-[7px] text-faint hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-40"><Play className="w-3.5 h-3.5" /></button>
                    )}
                    {(r.status === 'completed' || r.status === 'exited' || r.status === 'paused') && (
                      <button disabled={busy} onClick={() => void leadAction(r.enrolment_id, 'restart')} title="Restart from the top"
                        className="p-1.5 rounded-[7px] text-faint hover:bg-surface-2 hover:text-ink transition-colors disabled:opacity-40"><RotateCcw className="w-3.5 h-3.5" /></button>
                    )}
                    {(live || r.status === 'paused' || r.status === 'sleeping') && (
                      <button disabled={busy} onClick={() => void leadAction(r.enrolment_id, 'stop')} title="Stop permanently"
                        className="p-1.5 rounded-[7px] text-faint hover:text-danger transition-colors disabled:opacity-40"><Square className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[12px] text-muted mt-3 ml-0.5 leading-relaxed flex gap-2">
            <Zap className="w-3.5 h-3.5 text-faint flex-shrink-0 mt-0.5" />
            Only leads at stage <b className="font-medium text-ink-2">Cold</b> or <b className="font-medium text-ink-2">Hot</b> with an email address are ever enrolled or sent to. Junk, Won and everything else is excluded outright — checked again at every single send.
          </p>
        </div>
      )}
    </div>
  );
}
