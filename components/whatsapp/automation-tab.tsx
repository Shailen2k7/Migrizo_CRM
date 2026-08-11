'use client';

// =============================================================================
// AUTOMATION TAB — the new-lead journey, tag-based, written for day one.
//
// Five numbered steps that ARE the manual. Eligibility comes from the ad tag
// (leads.industry) — there is no CV scanning. Q&A lives in its own tab.
//
// Density: Make-style compact — 12px labels, 13px body, 14–16px card padding,
// hierarchy from weight and colour, never from size.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import {
  Zap, Play, Check, X, Loader2, RefreshCw, Flame,
  FileText, Video, CalendarClock, Sparkles, BellRing, Moon,
} from 'lucide-react';
import type { WaTemplate } from '@/lib/whatsapp/types';
import { FIELD_AREA, Select, IconInput, NumField } from '@/components/whatsapp/ui';

interface AutoSettings {
  workspace_id: string; enabled: boolean; sources: string[];
  welcome_template_code: string;
  pdf_url: string | null; video_url: string | null; booking_url: string | null;
  eligible_message: string; booking_message: string;
  auto_faq: boolean; cold_sequence_id: string | null;
  reminder_hours_1: number; reminder_hours_2: number; priority_push: boolean;
}
interface SeqLite { id: string; name: string; status: string }
interface JourneyRow {
  id: string; lead_id: string; phone_e164: string; stage: string; priority: boolean;
  field: string | null; readiness: string | null; reminders_sent: number;
  updated_at: string; lead_name: string; pending_jobs: number;
  eligibility: { verdict?: string; decided_by?: string } | null;
}
interface Overview {
  settings: AutoSettings | null; counts: Record<string, number>;
  sequences: SeqLite[]; journeys: JourneyRow[];
}

const ELIGIBLE_FIELDS = ['tech', 'research', 'engineering', 'art'];

const STAGE_META: Record<string, { label: string; cls: string }> = {
  welcome_queued:  { label: 'Welcome queued',      cls: 'bg-[#F5F6F9] text-[#7A8095] border-[#DDE0E9]' },
  awaiting_reply:  { label: 'Waiting for reply',   cls: 'bg-indigo-soft text-indigo-700 border-indigo-100' },
  needs_review:    { label: 'Needs your decision', cls: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]' },
  eligible:        { label: 'Eligible ✓',          cls: 'bg-[#EDFAF1] text-[#1B7A44] border-[#D7F3E1]' },
  waiting_booking: { label: 'Booking link sent',   cls: 'bg-[#EDFAF1] text-[#1B7A44] border-[#D7F3E1]' },
  booked:          { label: 'Meeting booked 🎉',   cls: 'bg-[#1B7A44] text-white border-[#1B7A44]' },
  not_eligible:    { label: 'Not eligible → Junk', cls: 'bg-[#FDEEEE] text-[#B3423A] border-[#F6D5D2]' },
  stopped:         { label: 'Stopped',             cls: 'bg-[#F5F6F9] text-[#7A8095] border-[#DDE0E9]' },
  checking:        { label: 'Checking',            cls: 'bg-[#F5F6F9] text-[#7A8095] border-[#DDE0E9]' },
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
  const [deciding, setDeciding] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('whatsapp_automation_overview', { p_workspace_id: workspaceId });
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        toast.error('Run migration 051 in Supabase first — the automation tables are missing.');
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
      eligible_message: cfg.eligible_message,
      booking_message: cfg.booking_message,
      auto_faq: cfg.auto_faq,
      cold_sequence_id: cfg.cold_sequence_id,
      reminder_hours_1: cfg.reminder_hours_1,
      reminder_hours_2: cfg.reminder_hours_2,
      priority_push: cfg.priority_push,
    }).eq('workspace_id', workspaceId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setDirty(false); toast.success('Automation saved'); load();
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

  const decide = async (journeyId: string, eligible: boolean) => {
    setDeciding(journeyId);
    const { data, error } = await supabase.rpc('whatsapp_journey_decide', { p_journey_id: journeyId, p_eligible: eligible });
    setDeciding(null);
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !r.ok) { toast.error(error?.message || r.reason || 'Failed'); return; }
    toast.success(eligible ? 'Marked eligible — guide + booking link on their way' : 'Moved to Junk');
    load();
  };

  if (!ov || !cfg) {
    return <div className="flex items-center justify-center py-20 text-[12.5px] text-muted">
      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading automation…
    </div>;
  }

  const approvedTemplates = templates.filter((t) => t.active);
  const welcomeTpl = templates.find((t) => t.code === cfg.welcome_template_code);
  const needsReview = ov.journeys.filter((jr) => jr.stage === 'needs_review');
  const linksMissing = !cfg.pdf_url || !cfg.video_url || !cfg.booking_url;
  const inFlight = Object.entries(ov.counts)
    .filter(([s]) => !['booked', 'not_eligible', 'stopped'].includes(s))
    .reduce((a, [, n]) => a + n, 0);

  return (
    <div className="mx-auto max-w-[1380px] px-5 py-4">

      {/* master switch */}
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#E8EAF0] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,24,40,.04)]">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1]">
          <Zap className="h-4 w-4 text-[#1B7A44]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[13.5px] font-semibold tracking-[-.015em]">New-lead automation</h2>
          <p className="m-0 mt-px text-[11.8px] leading-[1.5] text-muted">
            Lead lands from Meta → welcome → reply gets the guide &amp; booking link → stops when they book. Eligibility comes from the ad&apos;s field tag. You can type in any chat at any time.
          </p>
        </div>
        <button onClick={runNow} disabled={running}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-[#DDE0E9] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9] disabled:opacity-50">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run now
        </button>
        <Toggle on={cfg.enabled} onClick={() => edit({ enabled: !cfg.enabled })} />
      </div>

      {cfg.enabled && linksMissing && (
        <div className="mb-3 rounded-lg border border-[#F8E2B8] bg-[#FEF6E6] px-3.5 py-2.5 text-[11.8px] leading-[1.5] text-[#A25D07]">
          <b>Almost on.</b> Step 3 is missing its {[
            !cfg.pdf_url && 'PDF link', !cfg.video_url && 'video link', !cfg.booking_url && 'booking link',
          ].filter(Boolean).join(', ')} — eligible leads will pause there until it&apos;s filled in.
        </div>
      )}

      {/* KPI strip — the state of the machine at a glance */}
      <div className="mb-3.5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi icon={<Zap className="h-3.5 w-3.5 text-[#1B7A44]" />} bg="bg-[#EDFAF1]" label="In journey" value={inFlight} />
        <Kpi icon={<Play className="h-3.5 w-3.5 text-indigo-700" />} bg="bg-indigo-soft" label="Waiting reply"
          value={(ov.counts['awaiting_reply'] ?? 0) + (ov.counts['welcome_queued'] ?? 0)} />
        <Kpi icon={<Flame className="h-3.5 w-3.5 text-[#D9541E]" />} bg="bg-[#FFF4EE]" label="Hot · will pay"
          value={ov.journeys.filter((x) => x.priority && !['booked','stopped','not_eligible'].includes(x.stage)).length} />
        <Kpi icon={<CalendarClock className="h-3.5 w-3.5 text-[#1B7A44]" />} bg="bg-[#EDFAF1]" label="Meetings booked"
          value={ov.counts['booked'] ?? 0} />
      </div>

      {/* config left · live operations right */}
      <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_372px]">
      <div>

      {/* the journey */}
      <div className="relative">
        <div className="absolute bottom-5 left-[17px] top-5 w-px bg-[#E8EAF0]" />

        <Step n={1} icon={<Sparkles className="h-3.5 w-3.5" />} title="A lead arrives, already sorted by the ad"
          sub="The ad tells us their field and whether they'll pay — no CV needed.">
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="text-faint">Eligible fields:</span>
            {ELIGIBLE_FIELDS.map((f) => (
              <span key={f} className="rounded border border-[#D7F3E1] bg-[#EDFAF1] px-1.5 py-0.5 font-semibold capitalize text-[#1B7A44]">{f === 'art' ? 'arts & culture' : f}</span>
            ))}
            <span className="text-faint">· anything else → welcomed, then a human reviews</span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#FFE0CC] bg-[#FFF6F0] px-3 py-2">
            <Flame className="h-3.5 w-3.5 flex-shrink-0 text-[#D9541E]" />
            <span className="flex-1 text-[11.8px] text-[#8A3A12]">
              <b>Hot lane:</b> eligible field <i>and</i> willing to pay → marked priority + instant push to your phone.
            </span>
            <Toggle small on={cfg.priority_push} onClick={() => edit({ priority_push: !cfg.priority_push })} />
          </div>
        </Step>

        <Step n={2} icon={<Zap className="h-3.5 w-3.5" />} title="The welcome goes out within a minute"
          sub="An approved template — it can reach people who never messaged us.">
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

        <Step n={3} icon={<FileText className="h-3.5 w-3.5" />} title="They reply → guide, video, then the booking link"
          sub="Eligible leads get these automatically the moment they reply. Fill the links once.">
          <div className="mb-2 grid gap-1.5">
            <LinkField icon={<FileText className="h-3 w-3" />} label="Process guide (PDF)" value={cfg.pdf_url ?? ''} onChange={(v) => edit({ pdf_url: v })} placeholder="https://…/migrizo-gtv-guide.pdf" />
            <LinkField icon={<Video className="h-3 w-3" />} label="Video link" value={cfg.video_url ?? ''} onChange={(v) => edit({ video_url: v })} placeholder="https://youtu.be/…" />
            <LinkField icon={<CalendarClock className="h-3 w-3" />} label="Booking link" value={cfg.booking_url ?? ''} onChange={(v) => edit({ booking_url: v })} placeholder="https://crm.migrizo.com/book/…" />
          </div>
          <MsgField label="Message 1 — guide + video" value={cfg.eligible_message} onChange={(v) => edit({ eligible_message: v })} />
          <MsgField label="Message 2 — booking link" value={cfg.booking_message} onChange={(v) => edit({ booking_message: v })} />
          <p className="m-0 mt-1 text-[10.8px] text-faint">Tokens: {'{{name}} {{pdf}} {{video}} {{booking}}'} — filled automatically.</p>
        </Step>

        <Step n={4} icon={<Moon className="h-3.5 w-3.5" />} title="No reply? Two gentle reminders, then the cold sequence"
          sub="The welcome template is re-sent, then silent eligible leads move to your chosen sequence.">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted">Remind after</span>
            <HoursInput value={cfg.reminder_hours_1} onChange={(v) => edit({ reminder_hours_1: v })} />
            <span className="text-muted">then</span>
            <HoursInput value={cfg.reminder_hours_2} onChange={(v) => edit({ reminder_hours_2: v })} />
            <span className="text-muted">hours · still silent →</span>
            <Select
              value={cfg.cold_sequence_id ?? ''} ariaLabel="Cold sequence"
              onChange={(v) => edit({ cold_sequence_id: v || null })}
              className="w-[250px] max-w-full"
            >
              <option value="">— no cold sequence, just stop —</option>
              {ov.sequences.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.status !== 'active' ? ` (${s.status})` : ''}</option>
              ))}
            </Select>
          </div>
          <p className="m-0 mt-1.5 text-[10.8px] text-faint">Only leads in the 4 eligible fields are enrolled — off-field silent leads simply stop.</p>
        </Step>

        <Step n={5} icon={<BellRing className="h-3.5 w-3.5" />} title="Meeting booked → everything stops" last
          sub="The journey, queued messages AND any running sequences for that number. Booked means booked.">
          <></>
        </Step>
      </div>

      {dirty && (
        <div className="sticky bottom-3 z-10 mt-3.5 flex items-center gap-3 rounded-xl border border-[#DDE0E9] bg-white px-3.5 py-2.5 shadow-[0_8px_24px_-8px_rgba(20,24,40,.22)]">
          <span className="text-[11.8px] text-muted">Unsaved changes</span>
          <button onClick={save} disabled={saving}
            className="ml-auto rounded-lg bg-[#25A25A] px-3.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save automation'}
          </button>
        </div>
      )}
      </div>

      {/* ── the operations rail: watch the machine while you configure it ── */}
      <aside className="grid gap-3 xl:sticky xl:top-4">
        {needsReview.length > 0 && (
          <section className="rounded-xl border border-[#F5E3BC] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
            <div className="flex items-center gap-2 border-b border-[#F5E3BC] px-3.5 py-2.5">
              <h3 className="m-0 text-[12.6px] font-semibold">Needs your decision</h3>
              <span className="rounded-full border border-[#F5E3BC] bg-[#FEF6E6] px-2 py-0.5 text-[10.3px] font-bold text-[#A25D07]">{needsReview.length}</span>
              <span className="ml-auto text-[10.5px] text-faint">one click decides</span>
            </div>
            <div className="px-3.5 py-2.5">
              {needsReview.map((jr) => (
                <div key={jr.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-[#F0F1F5] bg-[#FBFBFC] px-2.5 py-2 last:mb-0">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[11.8px]">{jr.lead_name}</b>
                    <span className="block text-[10.3px] capitalize text-faint">{jr.field ?? 'field unknown'}{jr.readiness ? ` · pays: ${jr.readiness}` : ''}</span>
                  </div>
                  <button onClick={() => decide(jr.id, true)} disabled={deciding === jr.id}
                    className="flex items-center gap-1 rounded-md border border-[#D7F3E1] bg-[#EDFAF1] px-2 py-1 text-[10.5px] font-bold text-[#1B7A44] transition hover:bg-[#D7F3E1] disabled:opacity-50">
                    <Check className="h-3 w-3" /> Eligible
                  </button>
                  <button onClick={() => decide(jr.id, false)} disabled={deciding === jr.id}
                    className="flex items-center gap-1 rounded-md border border-[#F6D5D2] bg-[#FDEEEE] px-2 py-1 text-[10.5px] font-bold text-[#B3423A] transition hover:bg-[#F6D5D2] disabled:opacity-50">
                    <X className="h-3 w-3" /> No
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.04)]">
          <div className="flex items-center gap-2 border-b border-[#F0F1F5] px-3.5 py-2.5">
            <h3 className="m-0 text-[12.6px] font-semibold">Live journey feed</h3>
            <span className="text-[10.5px] text-faint">auto-refreshes</span>
            <button onClick={load} className="ml-auto flex items-center gap-1 text-[10.8px] font-semibold text-muted transition hover:text-ink">
              <RefreshCw className="h-2.5 w-2.5" /> Refresh
            </button>
          </div>
          <div className="px-3.5 py-1.5">
            {ov.journeys.length === 0 ? (
              <p className="m-0 py-4 text-center text-[11.5px] text-faint">No journeys yet — the next Meta lead appears here within a minute.</p>
            ) : ov.journeys.slice(0, 14).map((jr) => {
              const meta = STAGE_META[jr.stage] ?? STAGE_META.stopped;
              return (
                <div key={jr.id} className="flex items-center gap-2 border-b border-[#F0F1F5] py-[7px] last:border-b-0">
                  {jr.priority
                    ? <Flame className="h-3 w-3 flex-shrink-0 text-[#D9541E]" />
                    : <span className="w-3 flex-shrink-0" />}
                  <b className="w-[112px] flex-shrink-0 truncate text-[11.8px]">{jr.lead_name}</b>
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
              ['Meetings booked', ov.counts['booked'] ?? 0],
              ['Booking link sent', ov.counts['waiting_booking'] ?? 0],
              ['Moved to Junk', ov.counts['not_eligible'] ?? 0],
              ['In cold sequence / stopped', ov.counts['stopped'] ?? 0],
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
    <div className={`relative flex gap-3 ${last ? '' : 'pb-4'}`}>
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
      <textarea value={value} rows={Math.min(4, Math.max(2, value.split('\n').length))}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_AREA} />
    </div>
  );
}

function HoursInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <NumField value={value} onChange={onChange} min={1} max={168} />;
}
