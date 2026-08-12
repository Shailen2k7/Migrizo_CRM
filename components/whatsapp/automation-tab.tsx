'use client';

// =============================================================================
// AUTOMATION TAB — manual mode (2026-08-12).
//
// The whole promise on one screen:
//   FIRST TOUCH  — every new lead gets exactly one automatic opener asking for
//                  CV + LinkedIn (template for form leads, free text for
//                  direct messages), then a human owns the chat.
//   FOLLOW-UPS   — every cold and hot lead is enrolled into your approved
//                  template sequence for that stage, automatically, backlog
//                  included. Quiet leads only; a reply pauses instantly.
//
// Density: Make-style compact — 12px labels, 13px body, hierarchy from weight
// and colour, never from size.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Zap, Play, Loader2, RefreshCw, Flame, Users, Snowflake,
  CalendarClock, Sparkles, MessageSquare, UserCheck, AlertTriangle, Clock, Check,
} from 'lucide-react';
import type { WaTemplate } from '@/lib/whatsapp/types';
import { FIELD_AREA, Select, IconInput } from '@/components/whatsapp/ui';
import { FileText, Video } from 'lucide-react';

interface AutoSettings {
  workspace_id: string; enabled: boolean; sources: string[];
  welcome_template_code: string;
  pdf_url: string | null; video_url: string | null; booking_url: string | null;
  inbound_enabled: boolean; inbound_intro_message: string;
  priority_push: boolean;
  cold_sequence_id: string | null; hot_sequence_id: string | null;
  auto_enrol_cold: boolean; auto_enrol_hot: boolean;
}
interface SeqLite { id: string; name: string; status: string }
interface JourneyRow {
  id: string; lead_id: string; phone_e164: string; stage: string; priority: boolean;
  field: string | null; readiness: string | null; entry_source: string;
  updated_at: string; lead_name: string; pending_jobs: number;
}
interface CronStatus { installed: boolean; ok: boolean; jobs: Array<{ name: string; schedule: string; active: boolean }>; last_run: string | null }
interface FailedJob { id: string; kind: string; error: string | null; updated_at: string; lead_name: string; phone: string }
interface Coverage {
  sequence_id: string | null; lane_on: boolean;
  total: number; no_phone: number; in_sequence: number;
  active: number; paused: number; completed: number; untouched: number;
}
interface Overview {
  settings: AutoSettings | null; counts: Record<string, number>; cron?: CronStatus;
  failed_jobs?: FailedJob[]; entry: Record<string, number>;
  coverage?: Record<string, Coverage>;
  sequences: SeqLite[]; journeys: JourneyRow[];
}

const STAGE_META: Record<string, { label: string; cls: string }> = {
  welcome_queued:  { label: 'Welcome queued',    cls: 'bg-[#F5F6F9] text-[#7A8095] border-[#DDE0E9]' },
  intro_queued:    { label: 'Intro queued',      cls: 'bg-indigo-soft text-indigo-700 border-indigo-100' },
  awaiting_reply:  { label: 'First touch sent',  cls: 'bg-indigo-soft text-indigo-700 border-indigo-100' },
  handed_over:     { label: 'With your team',    cls: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]' },
  booked:          { label: 'Meeting booked',    cls: 'bg-[#1B7A44] text-white border-[#1B7A44]' },
  not_eligible:    { label: 'Junked',            cls: 'bg-[#FDEEEE] text-[#B3423A] border-[#F6D5D2]' },
  stopped:         { label: 'Stopped',           cls: 'bg-[#F5F6F9] text-[#7A8095] border-[#DDE0E9]' },
  needs_review:    { label: 'With your team',    cls: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]' },
  eligible:        { label: 'With your team',    cls: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]' },
  waiting_booking: { label: 'With your team',    cls: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]' },
  checking:        { label: 'Checking',          cls: 'bg-[#F5F6F9] text-[#7A8095] border-[#DDE0E9]' },
};

const timeAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
};

export default function AutomationTab({
  workspaceId, templates,
}: { workspaceId: string; templates: WaTemplate[] }) {
  const supabase = createClient();
  const [ov, setOv] = useState<Overview | null>(null);
  const [cfg, setCfg] = useState<AutoSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('whatsapp_automation_overview', { p_workspace_id: workspaceId });
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        toast.error('Run migration 056 in Supabase first — the manual-mode functions are missing.');
      } else if (!loaded.current) toast.error(error.message);
      return;
    }
    const o = data as Overview;
    setOv(o);
    setCfg((prev) => (dirty && prev ? prev : o.settings));
    loaded.current = true;
  }, [supabase, workspaceId, dirty]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const edit = (patch: Partial<AutoSettings>) => { setCfg((c) => (c ? { ...c, ...patch } : c)); setDirty(true); };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    const { error } = await supabase.from('whatsapp_automation').update({
      enabled: cfg.enabled,
      welcome_template_code: cfg.welcome_template_code,
      pdf_url: cfg.pdf_url?.trim() || null,
      video_url: cfg.video_url?.trim() || null,
      booking_url: cfg.booking_url?.trim() || null,
      inbound_enabled: cfg.inbound_enabled,
      inbound_intro_message: cfg.inbound_intro_message,
      priority_push: cfg.priority_push,
      cold_sequence_id: cfg.cold_sequence_id,
      hot_sequence_id: cfg.hot_sequence_id,
      auto_enrol_cold: cfg.auto_enrol_cold,
      auto_enrol_hot: cfg.auto_enrol_hot,
    }).eq('workspace_id', workspaceId);
    if (error) { setSaving(false); toast.error(error.message); return; }
    setDirty(false);
    // Saving the tab sweeps immediately — picking a sequence should enrol the
    // backlog now, not in ten minutes.
    const { data } = await supabase.rpc('whatsapp_stage_autoenrol', { p_workspace_id: workspaceId });
    setSaving(false);
    const r = (data ?? {}) as { enrolled?: number };
    toast.success(r.enrolled
      ? `Saved — ${r.enrolled} lead${r.enrolled === 1 ? '' : 's'} enrolled into follow-ups`
      : 'Automation saved');
    load();
  };

  const sweepNow = async () => {
    setSweeping(true);
    const { data, error } = await supabase.rpc('whatsapp_stage_autoenrol', { p_workspace_id: workspaceId });
    setSweeping(false);
    if (error) { toast.error(error.message); return; }
    const r = (data ?? {}) as { enrolled?: number; stopped?: number };
    toast.success(`Swept — ${r.enrolled ?? 0} enrolled, ${r.stopped ?? 0} stopped (stage changed)`);
    load();
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/whatsapp/automation/drain', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) toast.error(json.reason || 'Run failed');
      else if (json.skipped) toast.info(`Nothing ran — ${String(json.skipped).replace(/_/g, ' ')}`);
      else toast.success(`Ran ${json.claimed} job${json.claimed === 1 ? '' : 's'} · ${json.sent} sent${json.dryRun ? ' (dry-run)' : ''}`);
      load();
    } finally { setRunning(false); }
  };

  const retryJob = async (jobId: string) => {
    const { data, error } = await supabase.rpc('whatsapp_job_retry', { p_job_id: jobId });
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !r.ok) { toast.error(error?.message || r.reason || 'Retry failed'); return; }
    toast.success('Back in the queue — runs within a minute');
    load();
  };

  if (!ov || !cfg) {
    return <div className="flex items-center justify-center py-20 text-[12.5px] text-muted">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading automation…
    </div>;
  }

  const approvedTemplates = templates.filter((t) => t.active);
  const welcomeTpl = templates.find((t) => t.code === cfg.welcome_template_code);
  const handedOver = (ov.counts['handed_over'] ?? 0) + (ov.counts['needs_review'] ?? 0)
    + (ov.counts['eligible'] ?? 0) + (ov.counts['waiting_booking'] ?? 0);
  const cov = ov.coverage ?? {};
  const untouchedTotal = (cov.cold?.untouched ?? 0) + (cov.hot?.untouched ?? 0);

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-4">

      {/* master switch */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#E8EAF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1]">
          <Zap className="h-4 w-4 text-[#1B7A44]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[13.5px] font-semibold tracking-[-.015em]">First touch is automatic. Everything live is human.</h2>
          <p className="m-0 mt-px text-[11.8px] leading-[1.5] text-muted">
            Every new lead gets one opener asking for CV + LinkedIn, then your team owns the chat.
            Separately, every cold &amp; hot lead runs through your approved follow-up templates — no lead untouched.
          </p>
        </div>
        <button onClick={runNow} disabled={running}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[#DDE0E9] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9] disabled:opacity-50">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run now
        </button>
        <Toggle on={cfg.enabled} onClick={() => edit({ enabled: !cfg.enabled })} />
      </div>

      {/* scheduler visibility */}
      {ov.cron && !ov.cron.ok && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#F6D5D2] bg-[#FDEEEE] px-3.5 py-2.5">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0 text-[#B3423A]" />
          <p className="m-0 text-[11.8px] leading-[1.5] text-[#8A2F28]">
            <b>Nothing is running by itself.</b>{' '}
            {ov.cron.installed
              ? 'The scheduled jobs are missing — re-run migration 056 in Supabase.'
              : 'pg_cron is not enabled on this database. Supabase → Database → Extensions → enable pg_cron and pg_net, then re-run migrations 053 and 056.'}
          </p>
        </div>
      )}
      {ov.cron?.ok && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-3.5 py-2">
          <Clock className="h-3.5 w-3.5 flex-shrink-0 text-[#1B7A44]" />
          <p className="m-0 text-[11.5px] text-[#1B7A44]">
            Running automatically — first touch every minute, follow-up sends every 10 minutes, enrol sweep every 10 minutes.
            {ov.cron.last_run && ` Last run ${timeAgo(ov.cron.last_run)} ago.`}
          </p>
        </div>
      )}

      {/* KPI strip */}
      <div className="mb-3.5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={<Sparkles className="h-3.5 w-3.5 text-[#1B7A44]" />} bg="bg-[#EDFAF1]" label="First touches sent"
          value={(ov.counts['awaiting_reply'] ?? 0) + handedOver + (ov.counts['booked'] ?? 0)} />
        <Kpi icon={<UserCheck className="h-3.5 w-3.5 text-[#A25D07]" />} bg="bg-[#FEF6E6]" label="With your team" value={handedOver} />
        <Kpi icon={<Users className="h-3.5 w-3.5 text-indigo-700" />} bg="bg-indigo-soft" label="In follow-ups"
          value={(cov.cold?.active ?? 0) + (cov.hot?.active ?? 0)} />
        <Kpi icon={untouchedTotal === 0 ? <Check className="h-3.5 w-3.5 text-[#1B7A44]" /> : <AlertTriangle className="h-3.5 w-3.5 text-[#D9541E]" />}
          bg={untouchedTotal === 0 ? 'bg-[#EDFAF1]' : 'bg-[#FFF4EE]'} label="Untouched cold/hot" value={untouchedTotal} />
      </div>

      {/* config left · live operations right */}
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_372px]">
      <div>

      <div className="relative">
        <div className="absolute bottom-5 left-[17px] top-5 w-px bg-[#E8EAF0]" />

        <Step n={1} icon={<Sparkles className="h-3.5 w-3.5" />} title="Ad-form lead → the welcome template, within a minute"
          sub="An approved template — it can reach people who never messaged us. It asks for CV + LinkedIn and that is ALL it sends.">
          <div className="mb-2 flex items-center gap-2">
            <Select
              value={cfg.welcome_template_code} ariaLabel="Welcome template"
              onChange={(v) => edit({ welcome_template_code: v })}
              className="w-[380px] max-w-full"
            >
              {approvedTemplates.map((t) => (
                <option key={t.id} value={t.code}>{t.code} — {t.name}</option>
              ))}
              {!approvedTemplates.some((t) => t.code === cfg.welcome_template_code) && (
                <option value={cfg.welcome_template_code}>{cfg.welcome_template_code}</option>
              )}
            </Select>
            {welcomeTpl && (
              <span className={[
                'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                welcomeTpl.meta_status === 'approved'
                  ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
                  : 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]',
              ].join(' ')}>
                {welcomeTpl.meta_status === 'approved' ? 'Meta approved' : `${welcomeTpl.meta_status} — held`}
              </span>
            )}
          </div>
          <div className="rounded-lg border border-[#E8EAF0] bg-[#F7F8FA] px-3 py-2.5">
            <p className="m-0 whitespace-pre-wrap text-[11.8px] leading-[1.55] text-ink-2">
              {welcomeTpl?.body ?? 'Template not found in the CRM — check the Templates tab.'}
            </p>
          </div>
        </Step>

        <Step n={2} icon={<MessageSquare className="h-3.5 w-3.5" />} title="Direct message → the intro, as free text"
          sub="Click-to-WhatsApp ads, your website button, a saved number. Their message opens the 24h window, so no template is needed. Ad answers are parsed into name, field and budget automatically.">
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#E8EAF0] bg-[#F7F8FA] px-3 py-2">
            <span className="text-[11.8px] font-semibold text-ink-2">Reply to first-time direct messages</span>
            <Toggle small on={cfg.inbound_enabled} onClick={() => edit({ inbound_enabled: !cfg.inbound_enabled })} />
          </div>
          <MsgField label="The intro they receive" value={cfg.inbound_intro_message}
            onChange={(v) => edit({ inbound_intro_message: v })} />
          <p className="m-0 mt-1 text-[10.8px] text-faint">
            Someone who opens with a file is flagged to you instead — asking a person who just sent their CV for a CV reads like a bot.
          </p>
        </Step>

        <Step n={3} icon={<UserCheck className="h-3.5 w-3.5" />} title="They reply → a human takes over. Nothing else is automatic."
          sub="No auto answers, no auto links, no reminders. The chat is flagged “Needs reply” and any follow-up sequence for that number pauses instantly.">
          <div className="flex items-center gap-2 rounded-lg border border-[#FFE0CC] bg-[#FFF6F0] px-3 py-2">
            <Flame className="h-3.5 w-3.5 flex-shrink-0 text-[#D9541E]" />
            <span className="flex-1 text-[11.8px] text-[#8A3A12]">
              <b>Hot lane:</b> eligible field <i>and</i> willing to pay → instant push to your phone the moment the first touch goes out.
            </span>
            <Toggle small on={cfg.priority_push} onClick={() => edit({ priority_push: !cfg.priority_push })} />
          </div>
        </Step>

        <Step n={4} icon={<CalendarClock className="h-3.5 w-3.5" />} title="Meeting booked → everything stops" last
          sub="The first touch, queued jobs AND any follow-up sequence for that number. Booked means booked.">
          <></>
        </Step>
      </div>

      {/* ── follow-ups: no cold or hot lead left untouched ─────────────────── */}
      <section className="mb-3.5 rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <div className="flex items-center gap-2.5 border-b border-[#F0F1F5] px-4 py-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] bg-[#EDFAF1]">
            <Users className="h-4 w-4 text-[#1B7A44]" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-[12.8px] font-semibold tracking-[-.01em]">Follow-ups — no lead left untouched</h3>
            <p className="m-0 mt-px text-[11.5px] leading-[1.5] text-muted">
              Every lead in <b>Hot</b> or <b>Cold</b> is enrolled into that stage&apos;s approved template sequence — backlog included, new entrants within 10 minutes.
              Only quiet leads (no chat activity in 24h) are enrolled; a reply pauses their follow-ups; leaving the stage stops them; each sequence reaches a number once, ever.
            </p>
          </div>
          <button onClick={sweepNow} disabled={sweeping}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[#DDE0E9] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9] disabled:opacity-50">
            {sweeping ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sweep now
          </button>
        </div>
        <div className="grid gap-0 divide-y divide-[#F0F1F5]">
          <Lane
            icon={<Flame className="h-3.5 w-3.5 text-[#D9541E]" />}
            name="Hot leads" tone="hot"
            on={cfg.auto_enrol_hot}
            onToggle={() => edit({ auto_enrol_hot: !cfg.auto_enrol_hot })}
            seqId={cfg.hot_sequence_id}
            onSeq={(v) => edit({ hot_sequence_id: v || null })}
            sequences={ov.sequences}
            cov={cov.hot}
          />
          <Lane
            icon={<Snowflake className="h-3.5 w-3.5 text-[#1E63D9]" />}
            name="Cold leads" tone="cold"
            on={cfg.auto_enrol_cold}
            onToggle={() => edit({ auto_enrol_cold: !cfg.auto_enrol_cold })}
            seqId={cfg.cold_sequence_id}
            onSeq={(v) => edit({ cold_sequence_id: v || null })}
            sequences={ov.sequences}
            cov={cov.cold}
          />
        </div>
        <p className="m-0 border-t border-[#F0F1F5] px-4 py-2 text-[10.8px] text-faint">
          Build the step lists (template + days apart) in the <b>Sequences</b> tab. Sends respect your send window and daily cap. STOP suppresses forever.
        </p>
      </section>

      {/* ── the links behind the tokens ─────────────────────────────────────── */}
      <section className="mb-3.5 rounded-xl border border-[#E8EAF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <h3 className="m-0 text-[12.8px] font-semibold tracking-[-.01em]">Your links</h3>
        <p className="m-0 mb-2 mt-0.5 text-[11.5px] leading-[1.5] text-muted">
          These fill the <code className="font-mono text-[10.5px]">{'{{pdf}} {{video}} {{booking}}'}</code> tokens in the intro and in your quick replies.
        </p>
        <div className="grid gap-1.5">
          <LinkField icon={<FileText className="h-3 w-3" />} label="Process guide (PDF)" value={cfg.pdf_url ?? ''} onChange={(v) => edit({ pdf_url: v })} placeholder="https://…/migrizo-gtv-guide.pdf" />
          <LinkField icon={<Video className="h-3 w-3" />} label="Video link" value={cfg.video_url ?? ''} onChange={(v) => edit({ video_url: v })} placeholder="https://youtu.be/…" />
          <LinkField icon={<CalendarClock className="h-3 w-3" />} label="Booking link" value={cfg.booking_url ?? ''} onChange={(v) => edit({ booking_url: v })} placeholder="https://crm.migrizo.com/book/…" />
        </div>
      </section>

      {dirty && (
        <div className="sticky bottom-3 z-10 mt-3.5 flex items-center gap-3 rounded-xl border border-[#DDE0E9] bg-white px-3.5 py-2.5 shadow-[0_8px_24px_-8px_rgba(20,24,40,.22)]">
          <span className="text-[11.8px] text-muted">Unsaved changes — saving also sweeps the enrolments immediately</span>
          <button onClick={save} disabled={saving}
            className="ml-auto rounded-lg bg-[#25A25A] px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save automation'}
          </button>
        </div>
      )}
      </div>

      {/* ── the operations rail ─────────────────────────────────────────────── */}
      <aside className="grid gap-3 xl:sticky xl:top-4">
        {(ov.failed_jobs?.length ?? 0) > 0 && (
          <section className="rounded-xl border border-[#F6D5D2] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
            <div className="flex items-center gap-2 border-b border-[#F6D5D2] px-3.5 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-[#B3423A]" />
              <h3 className="m-0 text-[12.6px] font-semibold">Failed steps</h3>
              <span className="rounded-full border border-[#F6D5D2] bg-[#FDEEEE] px-2 py-0.5 text-[10.3px] font-bold text-[#B3423A]">{ov.failed_jobs!.length}</span>
              <span className="ml-auto text-[10.5px] text-faint">why + one-click retry</span>
            </div>
            <div className="px-3.5 py-2.5">
              {ov.failed_jobs!.map((f) => (
                <div key={f.id} className="mb-1.5 rounded-lg border border-[#F0F1F5] bg-[#FBFBFC] px-2.5 py-2 last:mb-0">
                  <div className="flex items-center gap-2">
                    <b className="truncate text-[11.8px]">{f.lead_name}</b>
                    <span className="rounded border border-[#DDE0E9] bg-white px-1.5 py-px text-[9px] font-bold uppercase text-[#7A8095]">{f.kind}</span>
                    <span className="ml-auto flex-shrink-0 text-[9.8px] text-faint">{timeAgo(f.updated_at)}</span>
                  </div>
                  <p className="m-0 mt-1 text-[10.8px] leading-[1.45] text-[#8A2F28]">{f.error ?? 'unknown error'}</p>
                  <button onClick={() => retryJob(f.id)}
                    className="mt-1.5 rounded-md border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1 text-[10.5px] font-bold text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                    ↻ Retry now
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
          <div className="flex items-center gap-2 border-b border-[#F0F1F5] px-3.5 py-2.5">
            <h3 className="m-0 text-[12.6px] font-semibold">First-touch feed</h3>
            <span className="text-[10.5px] text-faint">auto-refreshes</span>
            <button onClick={load} className="ml-auto flex items-center gap-1 text-[10.8px] font-semibold text-muted transition hover:text-ink">
              <RefreshCw className="h-2.5 w-2.5" /> Refresh
            </button>
          </div>
          <div className="px-3.5 py-1.5">
            {ov.journeys.length === 0 ? (
              <p className="m-0 py-4 text-center text-[11.5px] text-faint">No first touches yet — the next lead appears here within a minute.</p>
            ) : ov.journeys.slice(0, 14).map((jr) => {
              const meta = STAGE_META[jr.stage] ?? STAGE_META.stopped;
              return (
                <div key={jr.id} className="flex items-center gap-2 border-b border-[#F0F1F5] py-[7px] last:border-b-0">
                  {jr.priority
                    ? <Flame className="h-3 w-3 flex-shrink-0 text-[#D9541E]" />
                    : <span className="w-3 flex-shrink-0" />}
                  <b className="w-[104px] flex-shrink-0 truncate text-[11.8px]">{jr.lead_name}</b>
                  {jr.entry_source === 'whatsapp_inbound' && (
                    <span className="flex-shrink-0 rounded border border-indigo-100 bg-indigo-soft px-1 py-px text-[9px] font-bold text-indigo-700"
                      title="Messaged us directly — no ad form">IN</span>
                  )}
                  <span className={`truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
                  <span className="ml-auto flex-shrink-0 text-[9.8px] text-faint">{timeAgo(jr.updated_at)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
          <div className="border-b border-[#F0F1F5] px-3.5 py-2.5">
            <h3 className="m-0 text-[12.6px] font-semibold">Totals</h3>
          </div>
          <div className="px-3.5 py-1">
            {[
              ['From the ad form', ov.entry?.['meta_form'] ?? 0],
              ['Messaged us directly', ov.entry?.['whatsapp_inbound'] ?? 0],
              ['With your team', handedOver],
              ['Meetings booked', ov.counts['booked'] ?? 0],
              ['Hot in follow-ups', cov.hot?.active ?? 0],
              ['Cold in follow-ups', cov.cold?.active ?? 0],
              ['Paused (they replied)', (cov.hot?.paused ?? 0) + (cov.cold?.paused ?? 0)],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between border-b border-[#F0F1F5] py-2 text-[11.8px] last:border-b-0">
                <span className="text-muted">{k}</span><b>{v}</b>
              </div>
            ))}
          </div>
        </section>
      </aside>
      </div>
    </div>
  );
}

// ── follow-up lane row ───────────────────────────────────────────────────────
function Lane({ icon, name, tone, on, onToggle, seqId, onSeq, sequences, cov }: {
  icon: React.ReactNode; name: string; tone: 'hot' | 'cold';
  on: boolean; onToggle: () => void;
  seqId: string | null; onSeq: (v: string) => void;
  sequences: SeqLite[]; cov?: Coverage;
}) {
  const untouched = cov?.untouched ?? 0;
  const covered = untouched === 0 && !!seqId && on;
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${tone === 'hot' ? 'bg-[#FFF4EE]' : 'bg-[#EAF1FE]'}`}>{icon}</span>
        <b className="w-[76px] flex-shrink-0 text-[12.4px] font-semibold">{name}</b>
        <Select value={seqId ?? ''} onChange={onSeq} ariaLabel={`${name} sequence`} className="w-[250px] max-w-full">
          <option value="">— choose a sequence —</option>
          {sequences.map((s) => (
            <option key={s.id} value={s.id}>{s.name}{s.status !== 'active' ? ` (${s.status})` : ''}</option>
          ))}
        </Select>
        <span className="ml-auto" />
        {covered ? (
          <span className="flex items-center gap-1 rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-2 py-0.5 text-[10.3px] font-bold text-[#1B7A44]">
            <Check className="h-3 w-3" /> Every lead covered
          </span>
        ) : untouched > 0 && (
          <span className="rounded-full border border-[#FFE0CC] bg-[#FFF6F0] px-2 py-0.5 text-[10.3px] font-bold text-[#B3541E]">
            {untouched} untouched
          </span>
        )}
        <Toggle small on={on} onClick={onToggle} />
      </div>
      {cov && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 pl-[38px] text-[10.8px] text-faint">
          <span><b className="font-semibold text-ink-2">{cov.total}</b> in stage</span>
          <span><b className="font-semibold text-ink-2">{cov.active}</b> getting follow-ups</span>
          <span><b className="font-semibold text-ink-2">{cov.paused}</b> paused (replied)</span>
          <span><b className="font-semibold text-ink-2">{cov.completed}</b> finished all steps</span>
          {cov.no_phone > 0 && <span><b className="font-semibold text-ink-2">{cov.no_phone}</b> no valid phone</span>}
        </div>
      )}
    </div>
  );
}

function Kpi({ icon, bg, label, value }: {
  icon: React.ReactNode; bg: string; label: string; value: number;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#E8EAF0] bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] ${bg}`}>{icon}</span>
      <div>
        <span className="block text-[10px] font-bold uppercase tracking-[.05em] text-faint">{label}</span>
        <b className="block text-[19px] leading-[1.15] tracking-[-.02em]">{value}</b>
      </div>
    </div>
  );
}

// ── building blocks ─────────────────────────────────────────────────────────
function Toggle({ on, onClick, small }: { on: boolean; onClick: () => void; small?: boolean }) {
  const w = small ? 'h-[20px] w-[36px]' : 'h-[24px] w-[44px]';
  const dot = small ? 'h-[14px] w-[14px]' : 'h-[18px] w-[18px]';
  const shift = small ? (on ? 'left-[19px]' : 'left-[3px]') : (on ? 'left-[23px]' : 'left-[3px]');
  return (
    <button onClick={onClick} aria-label="Toggle"
      className={`relative flex-shrink-0 rounded-full transition ${w} ${on ? 'bg-[#25A25A]' : 'bg-[#DDE0E9]'}`}>
      <span className={`absolute top-[3px] rounded-full bg-white shadow transition-all ${dot} ${shift}`} />
    </button>
  );
}

function Step({ n, icon, title, sub, children, last }: {
  n: number; icon: React.ReactNode; title: string; sub: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={`relative flex gap-3 ${last ? 'pb-4' : 'pb-4'}`}>
      <span className="relative z-10 flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border border-[#DDE0E9] bg-white text-[#1B7A44] shadow-[0_1px_2px_rgba(20,24,40,.05)]">
        {icon}
        <span className="absolute -right-0.5 -top-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[#25A25A] text-[8.5px] font-bold text-white">{n}</span>
      </span>
      <div className="min-w-0 flex-1 rounded-xl border border-[#E8EAF0] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <h4 className="m-0 text-[12.8px] font-semibold tracking-[-.01em]">{title}</h4>
        <p className="m-0 mb-2 mt-0.5 text-[11.5px] leading-[1.5] text-muted">{sub}</p>
        {children}
      </div>
    </div>
  );
}

function LinkField({ icon, label, value, onChange, placeholder }: {
  icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className="flex items-center gap-2.5">
      <span className="w-[128px] flex-shrink-0 text-[11.5px] font-semibold text-ink-2">{label}</span>
      <IconInput icon={icon} value={value} onChange={onChange} placeholder={placeholder} ariaLabel={label} />
    </label>
  );
}

function MsgField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-1.5">
      <span className="mb-0.5 block text-[9.5px] font-bold uppercase tracking-[.06em] text-faint">{label}</span>
      <textarea value={value} rows={Math.min(6, Math.max(3, value.split('\n').length))}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_AREA} />
    </div>
  );
}
