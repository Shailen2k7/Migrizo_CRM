'use client';

// =============================================================================
// CAMPAIGNS TAB — choose who, choose what, press start.
//
// A campaign is a sequence that owns its audience. Four ideas, top to bottom,
// on one page:
//   1  AUDIENCE — filter chips; a live count card driven by the SAME SQL
//      function that later sends, so the number can never lie.
//   2  MESSAGES — the step list (template + days apart), unchanged mechanics.
//   3  LIMITS   — total reach and daily pace.
//   4  LIVE     — per-step funnel, the actual replies, failures with retry.
//
// Everything dangerous is enforced in Postgres: opt-outs, invalid phones,
// meeting-booked, once-per-campaign-ever, the 24h quiet rule, window + caps.
// This screen only ever ASKS; it never decides.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, GripVertical, Trash2, Play, Pause, Loader2, Zap, Clock, Users,
  MessageSquare, RefreshCw, AlertTriangle, CornerDownRight, Megaphone,
  CheckCircle2, ShieldOff, CalendarX2, UserX, PhoneOff,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WaTemplate } from '@/lib/whatsapp/types';
import { INDUSTRY_LIST, INDUSTRY_META, type Lead } from '@/lib/types';

// ── shapes (SeqOverviewRow keeps its name — page.tsx and the lead panel use it)
export interface SeqOverviewRow {
  id: string; name: string; description: string | null; status: string;
  daily_limit: number | null; step_count: number;
  enrolled_active: number; enrolled_paused: number;
  enrolled_completed: number; enrolled_stopped: number; replied: number;
  sent_today: number; next_due_at: string | null; updated_at: string;
}

interface Audience {
  stages: string[];
  industries: string[];
  readiness: string[];
  visa: string[];
  added_days: number | null;
  quiet_days: number | null;
}
// Simplest thing that is also safe: one stage, everyone in it. The 24-hour
// "don't talk over a live chat" rule is always on regardless, so an empty
// quiet_days is not a foot-gun — it just means "don't add a second rule".
const EMPTY_AUDIENCE: Audience = {
  stages: ['cold'], industries: [], readiness: [], visa: [], added_days: null, quiet_days: null,
};

interface Preview {
  ok: boolean; matched: number; suppressed: number; meeting_booked: number;
  already_in: number; eligible: number; steps: number; total_messages: number;
}
interface Facets {
  ok: boolean; total: number;
  stage: Record<string, number>;
  industry: Record<string, number>;
  readiness: Record<string, number>;
  visa: Record<string, number>;
  blockers: Array<{ key: string; label: string; would_reach: number }>;
}
const NONE = '__none__';   // the "No tag" bucket, a real option with a real count
interface StepStat { step_no: number; template: string; sent: number; failed: number }
interface ReplyRow { enrollment_id: string; lead_name: string; phone: string; replied_at: string | null; body: string | null; conversation_id: string | null }
interface FailRow { enrollment_id: string; lead_name: string; phone: string; error: string | null; status: string; at_step: number }
interface Stats {
  ok: boolean; steps: StepStat[]; enrolled: number; active: number; paused: number;
  completed: number; replied: number; opted_out: number; sent_today: number;
  replies: ReplyRow[]; failures: FailRow[];
}
interface StepDraft { key: string; template_id: string; wait_days: number }

interface Props {
  workspaceId: string;
  templates: WaTemplate[];
  leads: Lead[];
  overview: SeqOverviewRow[];
  reloadOverview: () => Promise<void>;
}

const STATUS_CHIP: Record<string, string> = {
  active: 'bg-[#EDFAF1] text-[#1B7A44] border-[#D7F3E1]',
  draft: 'bg-[#EDEFF3] text-[#7A8095] border-[#DDE0E9]',
  paused: 'bg-[#FEF6E6] text-[#A25D07] border-[#F8E2B8]',
};
const STATUS_LABEL: Record<string, string> = { active: 'Live', draft: 'Draft', paused: 'Paused' };

const previewBody = (body: string) =>
  body.replace(/\{\{\s*1\s*\}\}/g, 'Vikram').replace(/\{\{\s*(\d+)\s*\}\}/g, '…');

const timeAgo = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
};

let keySeed = 0;
const newKey = () => `k${++keySeed}`;

export default function CampaignsTab({ workspaceId, templates, overview, reloadOverview }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates]);

  const [selId, setSelId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<Audience>(EMPTY_AUDIENCE);
  const [maxPeople, setMaxPeople] = useState<string>('');
  const [dailyLimit, setDailyLimit] = useState<string>('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [dirty, setDirty] = useState(false);          // steps / name
  const [audDirty, setAudDirty] = useState(false);    // audience / limits
  const [preview, setPreview] = useState<Preview | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [creating, setCreating] = useState(false);
  const dragIndex = useRef<number | null>(null);

  const sel = overview.find((s) => s.id === selId) || null;

  // ── load a campaign: steps + saved audience + live stats ──────────────────
  const loadCampaign = useCallback(async (id: string) => {
    const [stepsRes, seqRes, statsRes] = await Promise.all([
      supabase.from('whatsapp_sequence_steps')
        .select('template_id, wait_days, step_no').eq('sequence_id', id).order('step_no'),
      supabase.from('whatsapp_sequences')
        .select('name, audience, max_people, daily_limit').eq('id', id).maybeSingle(),
      supabase.rpc('whatsapp_campaign_stats', { p_sequence_id: id }),
    ]);
    setSteps(((stepsRes.data ?? []) as Array<{ template_id: string; wait_days: number }>)
      .map((s) => ({ key: newKey(), template_id: s.template_id, wait_days: s.wait_days })));
    const row = seqRes.data as { name: string; audience: Audience | null; max_people: number | null; daily_limit: number | null } | null;
    if (row) {
      setName(row.name);
      setAudience(row.audience ?? EMPTY_AUDIENCE);
      setMaxPeople(row.max_people ? String(row.max_people) : '');
      setDailyLimit(row.daily_limit ? String(row.daily_limit) : '');
    }
    setStats((statsRes.data ?? null) as Stats | null);
    setDirty(false); setAudDirty(false);
  }, [supabase]);

  useEffect(() => { if (selId) loadCampaign(selId); }, [selId, loadCampaign]);
  useEffect(() => { if (!selId && overview.length) setSelId(overview[0].id); }, [overview, selId]);

  // Live stats refresh while a campaign is running.
  useEffect(() => {
    if (!selId || sel?.status !== 'active') return;
    const t = setInterval(async () => {
      const { data } = await supabase.rpc('whatsapp_campaign_stats', { p_sequence_id: selId });
      if (data) setStats(data as Stats);
    }, 30_000);
    return () => clearInterval(t);
  }, [selId, sel?.status, supabase]);

  // ── the live count AND every chip's own count, in one debounced pass ──────
  // Both come from the same SQL family that later sends, so a number on screen
  // is always the number you get.
  useEffect(() => {
    if (!selId) return;
    setPreviewing(true);
    const t = setTimeout(async () => {
      const aud = audience as unknown as Record<string, unknown>;
      const [pRes, fRes] = await Promise.all([
        supabase.rpc('whatsapp_campaign_preview', {
          p_workspace_id: workspaceId, p_audience: aud, p_sequence_id: selId,
        }),
        supabase.rpc('whatsapp_audience_facets', { p_ws: workspaceId, p_audience: aud }),
      ]);
      setPreviewing(false);
      if (pRes.error) {
        if (/does not exist|schema cache/i.test(pRes.error.message)) {
          toast.error('Run migrations 058 and 061 in Supabase first — the campaign functions are missing.');
        }
        return;
      }
      setPreview(pRes.data as Preview);
      if (!fRes.error) setFacets(fRes.data as Facets);
    }, 350);
    return () => clearTimeout(t);
  }, [audience, selId, workspaceId, supabase]);

  // ── actions ───────────────────────────────────────────────────────────────
  async function createCampaign() {
    setCreating(true);
    const { data, error } = await supabase.from('whatsapp_sequences')
      .insert({ workspace_id: workspaceId, name: 'New campaign', status: 'draft', audience: EMPTY_AUDIENCE })
      .select('id').single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    await reloadOverview();
    setSelId(data.id);
    toast.success('Campaign created — pick the audience and add messages');
  }

  async function saveSteps(): Promise<boolean> {
    if (!selId) return false;
    setSaving(true);
    try {
      const { error: metaErr } = await supabase.from('whatsapp_sequences')
        .update({ name: name.trim() || 'Untitled campaign' }).eq('id', selId);
      if (metaErr) throw new Error(metaErr.message);
      const { data: n, error } = await supabase.rpc('whatsapp_sequence_save_steps', {
        p_sequence_id: selId,
        p_steps: steps.map((s) => ({ template_id: s.template_id, wait_days: s.wait_days })),
      });
      if (error) throw new Error(error.message);
      if (n === -1) throw new Error('Only campaign admins can edit campaigns');
      setDirty(false);
      await reloadOverview();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally { setSaving(false); }
  }

  /** Start (draft/paused) or push audience changes into a live campaign. */
  async function launch() {
    if (!sel) return;
    if (steps.length === 0) { toast.error('Add at least one message first'); return; }
    if (audience.stages.length === 0) { toast.error('Pick at least one stage for the audience'); return; }
    setLaunching(true);
    try {
      if (dirty && !(await saveSteps())) return;
      const { data, error } = await supabase.rpc('whatsapp_campaign_launch', {
        p_sequence_id: sel.id,
        p_audience: audience as unknown as Record<string, unknown>,
        p_max_people: maxPeople.trim() === '' ? null : Math.max(1, parseInt(maxPeople, 10) || 1),
        p_daily_limit: dailyLimit.trim() === '' ? null : Math.max(1, parseInt(dailyLimit, 10) || 1),
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { ok?: boolean; reason?: string; detail?: string; enrolled?: number };
      if (!r.ok) throw new Error(r.detail || r.reason || 'Could not start');
      setAudDirty(false);
      await Promise.all([reloadOverview(), loadCampaign(sel.id)]);
      toast.success(sel.status === 'active'
        ? `Audience updated — ${r.enrolled ?? 0} newly added`
        : `Campaign is live — ${r.enrolled ?? 0} enrolled, first sends inside your hours`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setLaunching(false); }
  }

  async function pauseResume() {
    if (!sel) return;
    if (sel.status !== 'active') { launch(); return; }
    const { error } = await supabase.from('whatsapp_sequences').update({ status: 'paused' }).eq('id', sel.id);
    if (error) { toast.error(error.message); return; }
    await reloadOverview();
    toast.success('Paused — nothing more sends until you resume');
  }

  async function deleteCampaign() {
    if (!sel) return;
    const busy = sel.enrolled_active + sel.enrolled_paused;
    if (!window.confirm(busy > 0
      ? `Delete "${sel.name}"? ${busy} enrolled lead${busy === 1 ? '' : 's'} will stop receiving messages. This cannot be undone.`
      : `Delete "${sel.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('whatsapp_sequences').delete().eq('id', sel.id);
    if (error) { toast.error(error.message); return; }
    setSelId(null);
    await reloadOverview();
    toast.success('Campaign deleted');
  }

  async function retryFail(enrollmentId: string) {
    const { data, error } = await supabase.rpc('whatsapp_enrollment_retry', { p_enrollment_id: enrollmentId });
    const r = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !r.ok) { toast.error(error?.message || r.reason || 'Retry failed'); return; }
    toast.success('Back in the queue');
    if (selId) loadCampaign(selId);
  }

  // ── audience edits ────────────────────────────────────────────────────────
  const editAud = (patch: Partial<Audience>) => { setAudience((a) => ({ ...a, ...patch })); setAudDirty(true); };
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  /** Everyone in the chosen stage. The safe default, and the way back from any mess. */
  const reachEveryone = () => {
    setAudience((a) => ({
      stages: a.stages.length ? a.stages : ['cold'],
      industries: [], readiness: [], visa: [], added_days: null, quiet_days: null,
    }));
    setAudDirty(true);
    setAdvanced(false);
  };

  /** One click removes whichever filter is emptying the audience. */
  const clearBlocker = (key: string) => {
    const patch: Partial<Audience> =
      key === 'industries' ? { industries: [] }
      : key === 'readiness' ? { readiness: [] }
      : key === 'visa' ? { visa: [] }
      : key === 'quiet_days' ? { quiet_days: null }
      : key === 'added_days' ? { added_days: null }
      : { stages: [] };
    editAud(patch);
  };

  const isNarrowed = audience.industries.length > 0 || audience.readiness.length > 0
    || audience.visa.length > 0 || audience.added_days !== null || audience.quiet_days !== null;

  // ── step edits (local until Save) ────────────────────────────────────────
  const mark = (fn: (prev: StepDraft[]) => StepDraft[]) => { setSteps(fn); setDirty(true); };
  const addStep = () => {
    const used = new Set(steps.map((s) => s.template_id));
    const next = activeTemplates.find((t) => !used.has(t.id)) ?? activeTemplates[0];
    if (!next) { toast.error('No active templates to add'); return; }
    mark((prev) => [...prev, { key: newKey(), template_id: next.id, wait_days: prev.length === 0 ? 0 : 3 }]);
  };
  const onDrop = (target: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === target) return;
    mark((prev) => { const n = [...prev]; const [it] = n.splice(from, 1); n.splice(target, 0, it); return n; });
  };
  const cumulativeDay = (idx: number) => steps.slice(1, idx + 1).reduce((a, s) => a + s.wait_days, 0);

  const estDays = useMemo(() => {
    if (!preview || preview.total_messages === 0) return null;
    const perDay = dailyLimit.trim() ? parseInt(dailyLimit, 10) : null;
    if (!perDay) return null;
    return Math.ceil(preview.total_messages / perDay);
  }, [preview, dailyLimit]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 gap-[10px] p-[10px]">

      {/* ══ left rail: campaign list ══ */}
      <div className="flex w-[290px] flex-shrink-0 flex-col rounded-[14px] border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.06)]">
        <div className="flex-shrink-0 border-b border-[#E8EAF0] p-[12px]">
          <button onClick={createCampaign} disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#25A25A] px-3 py-[9px] text-[13px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-60">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New campaign
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
          {overview.length === 0 && (
            <div className="px-4 py-10 text-center">
              <Megaphone className="mx-auto mb-3 h-8 w-8 text-faint" />
              <p className="m-0 text-[12.8px] leading-[1.6] text-muted">
                No campaigns yet. Create one, choose who should hear from you, add your approved messages, press start.
              </p>
            </div>
          )}
          {overview.map((s) => (
            <button key={s.id} onClick={() => setSelId(s.id)}
              className={cn('mb-[6px] w-full rounded-[11px] border px-[12px] py-[10px] text-left transition',
                selId === s.id ? 'border-[#D7F3E1] bg-[#EDFAF1]' : 'border-transparent hover:bg-[#F5F6F9]')}>
              <div className="mb-[4px] flex items-center gap-2">
                <b className="min-w-0 flex-1 truncate text-[13.2px] font-semibold tracking-[-.015em]">{s.name}</b>
                <span className={cn('flex-shrink-0 rounded-full border px-[8px] py-[2px] text-[10.2px] font-bold', STATUS_CHIP[s.status] ?? STATUS_CHIP.draft)}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </span>
              </div>
              <div className="flex items-center gap-[8px] text-[11.2px] text-muted">
                <span>{s.step_count} msg{s.step_count === 1 ? '' : 's'}</span>
                <span>·</span><span>{s.enrolled_active} in flight</span>
                {s.replied > 0 && (<><span>·</span><span className="font-semibold text-indigo-700">{s.replied} replied</span></>)}
                {s.sent_today > 0 && (<><span>·</span><span className="text-[#1B7A44]">{s.sent_today} today</span></>)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ══ main ══ */}
      {!sel ? (
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-[14px] border border-[#E8EAF0] bg-white text-center shadow-[0_1px_2px_rgba(20,24,40,.06)]">
          <div className="px-6 py-16 text-faint">
            <Megaphone className="mx-auto mb-3 h-9 w-9" />
            <b className="block text-[14px] font-semibold text-muted">Pick a campaign, or create one</b>
            <p className="m-0 mt-2 max-w-[320px] text-[12.6px] leading-[1.6]">
              Choose the audience, line up your approved messages, set the pace, press start. It keeps itself topped up after that.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-[12px] overflow-y-auto pb-16">

          {/* ── header ── */}
          <div className="flex-shrink-0 rounded-[14px] border border-[#E8EAF0] bg-white p-[16px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
            <div className="flex flex-wrap items-center gap-3">
              <input value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
                className="min-w-[200px] flex-1 rounded-[9px] border border-transparent px-2 py-[5px] text-[16.5px] font-semibold tracking-[-.02em] outline-none transition hover:border-[#DDE0E9] focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]" />
              <span className={cn('rounded-full border px-[10px] py-[4px] text-[11.2px] font-bold', STATUS_CHIP[sel.status] ?? STATUS_CHIP.draft)}>
                {STATUS_LABEL[sel.status] ?? sel.status}
              </span>
              {sel.status === 'active' ? (
                <button onClick={pauseResume}
                  className="inline-flex items-center gap-[7px] rounded-[9px] border border-[#F8E2B8] bg-[#FEF6E6] px-[13px] py-[8px] text-[12.8px] font-semibold text-[#A25D07] transition hover:bg-[#FDEBC8]">
                  <Pause className="h-[13px] w-[13px]" />Pause
                </button>
              ) : (
                <button onClick={launch} disabled={launching}
                  className="inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[15px] py-[8px] text-[12.8px] font-semibold text-white shadow-[0_2px_8px_-2px_rgba(37,162,90,.5)] transition hover:bg-[#1B7A44] disabled:opacity-60">
                  {launching ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Play className="h-[13px] w-[13px]" />}
                  {sel.status === 'paused' ? 'Resume campaign' : 'Start campaign'}
                </button>
              )}
              <button onClick={deleteCampaign} title="Delete campaign"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-[#E8EAF0] text-muted transition hover:border-[#F8D6D6] hover:bg-[#FEEFEF] hover:text-[#B02B2B]">
                <Trash2 className="h-[14px] w-[14px]" />
              </button>
            </div>
            {sel.status === 'active' && audDirty && (
              <div className="mt-3 flex items-center gap-3 rounded-[10px] border border-[#DDE5FB] bg-[#F5F8FF] px-3 py-2">
                <span className="text-[12px] text-[#3B5BDB]">Audience or limits changed — apply to add newly-matching people. Nobody already enrolled is removed.</span>
                <button onClick={launch} disabled={launching}
                  className="ml-auto rounded-lg bg-[#3B5BDB] px-3 py-1.5 text-[11.8px] font-semibold text-white transition hover:bg-[#3049B5] disabled:opacity-60">
                  {launching ? 'Applying…' : 'Apply changes'}
                </button>
              </div>
            )}
          </div>

          {/* ── 1 · AUDIENCE ── */}
          <Section n={1} title="Who gets this" hint="every option shows how many people are in it">
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_264px]">
              <div>
                {/* STEP ONE, and for most campaigns the only step. */}
                <div className="mb-3">
                  <span className="mb-1.5 block text-[11.4px] font-semibold text-[#697086]">Pick the stage</span>
                  <div className="flex flex-wrap gap-[6px]">
                    {[['hot', 'Hot leads'], ['cold', 'Cold leads'], ['not_responding', 'Not responding']].map(([v, l]) => (
                      <Chip key={v} on={audience.stages.includes(v)} tone="green" big
                        count={facets?.stage?.[v]}
                        onClick={() => editAud({ stages: toggleIn(audience.stages, v) })}>{l}</Chip>
                    ))}
                  </div>
                </div>

                {/* Everything below is optional. Say so, loudly. */}
                {!advanced ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-[11px] border border-[#E8EAF0] bg-[#FBFBFC] px-3 py-2.5">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-[#1B7A44]" />
                    <span className="text-[12px] text-ink-2">
                      {isNarrowed
                        ? <>Narrowed by <b>{[
                            audience.industries.length && 'field',
                            audience.readiness.length && 'can invest',
                            audience.visa.length && 'visa',
                            audience.added_days !== null && 'added',
                            audience.quiet_days !== null && 'recency',
                          ].filter(Boolean).join(', ')}</b></>
                        : <>Reaching <b>everyone</b> in the stage above — nobody is left out.</>}
                    </span>
                    <button onClick={() => setAdvanced(true)}
                      className="ml-auto rounded-lg border border-[#DDE0E9] bg-white px-2.5 py-1 text-[11.4px] font-semibold text-ink-2 transition hover:bg-[#F4F5F8]">
                      {isNarrowed ? 'Edit filters' : 'Narrow it down'}
                    </button>
                    {isNarrowed && (
                      <button onClick={reachEveryone}
                        className="rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1 text-[11.4px] font-semibold text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                        Reach everyone
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-[11px] border border-[#E8EAF0] bg-[#FBFBFC] p-3">
                    <div className="mb-2.5 flex items-center gap-2">
                      <b className="text-[12px] font-semibold">Narrow it down</b>
                      <span className="text-[11px] text-faint">optional · leave a row untouched to include everyone</span>
                      <button onClick={reachEveryone}
                        className="ml-auto rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1 text-[11px] font-semibold text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                        Clear all
                      </button>
                      <button onClick={() => setAdvanced(false)}
                        className="rounded-lg border border-[#DDE0E9] bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition hover:bg-[#F4F5F8]">
                        Done
                      </button>
                    </div>
                    <div className="grid gap-[9px]">
                      <FilterRow label="Field">
                        {INDUSTRY_LIST.map((k) => (
                          <Chip key={k} on={audience.industries.includes(k)} count={facets?.industry?.[k]}
                            onClick={() => editAud({ industries: toggleIn(audience.industries, k) })}>
                            {INDUSTRY_META[k].label}
                          </Chip>
                        ))}
                        <Chip on={audience.industries.includes(NONE)} count={facets?.industry?.[NONE]}
                          onClick={() => editAud({ industries: toggleIn(audience.industries, NONE) })}>No tag</Chip>
                      </FilterRow>
                      <FilterRow label="Can invest">
                        {[['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']].map(([v, l]) => (
                          <Chip key={v} on={audience.readiness.includes(v)} count={facets?.readiness?.[v]}
                            onClick={() => editAud({ readiness: toggleIn(audience.readiness, v) })}>{l}</Chip>
                        ))}
                        <Chip on={audience.readiness.includes(NONE)} count={facets?.readiness?.[NONE]}
                          onClick={() => editAud({ readiness: toggleIn(audience.readiness, NONE) })}>Never asked</Chip>
                      </FilterRow>
                      <FilterRow label="Visa">
                        {[['gtv', 'GTV'], ['ifv', 'IFV']].map(([v, l]) => (
                          <Chip key={v} on={audience.visa.includes(v)} count={facets?.visa?.[v]}
                            onClick={() => editAud({ visa: toggleIn(audience.visa, v) })}>{l}</Chip>
                        ))}
                        <Chip on={audience.visa.includes(NONE)} count={facets?.visa?.[NONE]}
                          onClick={() => editAud({ visa: toggleIn(audience.visa, NONE) })}>No route set</Chip>
                      </FilterRow>
                      <FilterRow label="Added">
                        {[[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [null, 'Any time']].map(([v, l]) => (
                          <Chip key={String(v)} on={audience.added_days === v}
                            onClick={() => editAud({ added_days: v as number | null })}>{l as string}</Chip>
                        ))}
                      </FilterRow>
                      <FilterRow label="Not messaged">
                        {[[14, 'in 14 days'], [30, 'in 30 days'], [null, "doesn't matter"]].map(([v, l]) => (
                          <Chip key={String(v)} on={audience.quiet_days === v}
                            onClick={() => editAud({ quiet_days: v as number | null })}>{l as string}</Chip>
                        ))}
                      </FilterRow>
                    </div>
                  </div>
                )}

                {/* Nobody should ever see a bare zero. Name the culprit, offer the fix. */}
                {preview && preview.eligible === 0 && (facets?.blockers?.length ?? 0) > 0 && (
                  <div className="mt-2.5 rounded-[11px] border border-[#F8E2B8] bg-[#FEF6E6] px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-[#A25D07]" />
                      <b className="text-[12.2px] text-[#A25D07]">This reaches nobody — here is why</b>
                    </div>
                    {facets!.blockers.map((b) => (
                      <div key={b.key} className="mb-1 flex flex-wrap items-center gap-2 last:mb-0">
                        <span className="text-[11.8px] leading-[1.5] text-[#7A4A06]">
                          Your <b>{b.label}</b> filter is removing everyone. Without it you reach <b>{b.would_reach}</b>.
                        </span>
                        <button onClick={() => clearBlocker(b.key)}
                          className="rounded-lg border border-[#E8C98C] bg-white px-2.5 py-1 text-[11.2px] font-bold text-[#A25D07] transition hover:bg-[#FDEBC8]">
                          Remove {b.label} filter
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-[6px] border-t border-dashed border-[#EDEFF4] pt-[10px]">
                  <span className="w-[92px] flex-shrink-0 text-[11px] font-semibold text-faint">Always off</span>
                  <Locked icon={<ShieldOff className="h-[10px] w-[10px]" />}>Opted out</Locked>
                  <Locked icon={<PhoneOff className="h-[10px] w-[10px]" />}>No valid number</Locked>
                  <Locked icon={<UserX className="h-[10px] w-[10px]" />}>Already in this campaign</Locked>
                  <Locked icon={<CalendarX2 className="h-[10px] w-[10px]" />}>Meeting booked</Locked>
                  <Locked icon={<Clock className="h-[10px] w-[10px]" />}>Chatted in last 24h</Locked>
                </div>
              </div>

              {/* live count card */}
              <div className="rounded-[13px] border border-[#CBEBD7] bg-gradient-to-b from-[#F4FBF6] to-white p-[14px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[32px] font-bold leading-none tracking-[-.03em] tabular-nums">
                    {previewing || !preview ? '…' : preview.eligible}
                  </span>
                  <span className="text-[12px] font-semibold text-[#1B7A44]">will receive this</span>
                </div>
                {preview && (
                  <>
                    <div className="mt-3 border-t border-[#E3EFE7] pt-2">
                      {[
                        ['Matched your filters', preview.matched, ''],
                        ['Opted out — never again', preview.suppressed, '−'],
                        ['Meeting already booked', preview.meeting_booked, '−'],
                        ['Already in this campaign', preview.already_in, '−'],
                      ].map(([l, v, sign]) => (
                        <div key={String(l)} className="flex items-center justify-between py-[2px] text-[11.2px] text-muted">
                          <span>{l}</span><b className="tabular-nums text-ink-2">{sign}{v}</b>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 border-t border-[#E3EFE7] pt-2">
                      <div className="flex items-center justify-between py-[2px] text-[11.2px] text-muted">
                        <span>Messages this will send</span>
                        <b className="tabular-nums text-ink-2">{preview.total_messages.toLocaleString()}</b>
                      </div>
                      {estDays !== null && (
                        <div className="flex items-center justify-between py-[2px] text-[11.2px] text-muted">
                          <span>At {dailyLimit}/day, roughly</span>
                          <b className="tabular-nums text-ink-2">{estDays} day{estDays === 1 ? '' : 's'}</b>
                        </div>
                      )}
                    </div>
                  </>
                )}
                <p className="m-0 mt-3 text-[10.4px] leading-[1.5] text-faint">
                  This exact query does the sending — and re-runs every 10 minutes, so leads that match tomorrow join by themselves.
                </p>
              </div>
            </div>
          </Section>

          {/* ── 2 · MESSAGES ── */}
          <Section n={2} title="Messages" hint="drag to reorder · previewed with a real name"
            right={dirty && (
              <button onClick={saveSteps} disabled={saving}
                className="rounded-lg bg-[#25A25A] px-3 py-1.5 text-[11.8px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-60">
                {saving ? 'Saving…' : 'Save messages'}
              </button>
            )}>
            {steps.length === 0 && (
              <p className="m-0 mb-3 rounded-[11px] border border-dashed border-[#DDE0E9] bg-[#F9FAFB] px-4 py-6 text-center text-[12.8px] text-muted">
                No messages yet. Add the first one below — it sends the moment someone is enrolled.
              </p>
            )}
            {steps.map((s, i) => {
              const tpl = templates.find((t) => t.id === s.template_id);
              return (
                <div key={s.key} draggable
                  onDragStart={() => { dragIndex.current = i; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                  className="mb-[8px] flex items-start gap-[11px] rounded-[12px] border border-[#E8EAF0] bg-white p-[12px] transition hover:border-[#C9CDD9]">
                  <span className="mt-[7px] cursor-grab text-faint active:cursor-grabbing"><GripVertical className="h-[15px] w-[15px]" /></span>
                  <span className="mt-[3px] flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-full bg-[#EDFAF1] text-[12px] font-bold text-[#1B7A44]">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[8px]">
                      <select value={s.template_id}
                        onChange={(e) => mark((prev) => prev.map((x, xi) => (xi === i ? { ...x, template_id: e.target.value } : x)))}
                        className="min-w-[230px] rounded-[9px] border border-[#DDE0E9] bg-white px-[10px] py-[6px] text-[12.6px] font-medium outline-none transition focus:border-[#2FB463]">
                        {activeTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}{t.meta_status !== 'approved' ? ` — ${t.meta_status}` : ''}</option>
                        ))}
                      </select>
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-[5px] rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[9px] py-[4px] text-[11.2px] font-semibold text-[#1B7A44]">
                          <Zap className="h-[10px] w-[10px]" /> Sends on enrol
                        </span>
                      ) : (
                        <label className="inline-flex items-center gap-[6px] text-[12.2px] text-ink-2">
                          wait
                          <input type="number" min={0} max={365} value={s.wait_days}
                            onChange={(e) => mark((prev) => prev.map((x, xi) =>
                              (xi === i ? { ...x, wait_days: Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)) } : x)))}
                            className="w-[56px] rounded-[8px] border border-[#DDE0E9] px-[6px] py-[5px] text-center text-[12.6px] font-semibold tabular-nums outline-none transition focus:border-[#2FB463]" />
                          day{s.wait_days === 1 ? '' : 's'}
                          <span className="text-faint">· lands day {cumulativeDay(i)}</span>
                        </label>
                      )}
                      {tpl && tpl.meta_status !== 'approved' && (
                        <span className="inline-flex items-center gap-[4px] rounded-full border border-[#F8E2B8] bg-[#FEF6E6] px-[7px] py-[2px] text-[10.2px] font-bold uppercase text-[#A25D07]">
                          <Clock className="h-[9px] w-[9px]" />{tpl.meta_status}
                        </span>
                      )}
                    </div>
                    {tpl && (
                      <p className="m-0 mt-[7px] line-clamp-2 rounded-[4px_11px_11px_11px] border border-[#DCF0E3] bg-[#EDFAF1] px-[10px] py-[7px] text-[11.6px] leading-[1.5] text-[#2C3444]">
                        {previewBody(tpl.body)}
                      </p>
                    )}
                  </div>
                  <button onClick={() => mark((prev) => prev.filter((_, xi) => xi !== i))} title="Remove"
                    className="mt-[4px] flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[8px] text-faint transition hover:bg-[#FEEFEF] hover:text-[#B02B2B]">
                    <Trash2 className="h-[13px] w-[13px]" />
                  </button>
                </div>
              );
            })}
            <button onClick={addStep}
              className="flex w-full items-center justify-center gap-2 rounded-[11px] border border-dashed border-[#CBD1DD] py-[10px] text-[12.6px] font-semibold text-muted transition hover:border-[#25A25A] hover:text-[#1B7A44]">
              <Plus className="h-[14px] w-[14px]" /> Add message
            </button>
          </Section>

          {/* ── 3 · LIMITS ── */}
          <Section n={3} title="Limits" hint="you decide the pace">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Send to at most">
                <input type="number" min={1} value={maxPeople} placeholder="everyone"
                  onChange={(e) => { setMaxPeople(e.target.value); setAudDirty(true); }}
                  className="w-[110px] rounded-[9px] border border-[#DDE0E9] px-[10px] py-[7px] text-[13px] font-semibold tabular-nums outline-none transition focus:border-[#2FB463]" />
                <span className="text-[11.6px] text-muted">people, ever</span>
              </Field>
              <Field label="Per day">
                <input type="number" min={1} value={dailyLimit} placeholder="global cap"
                  onChange={(e) => { setDailyLimit(e.target.value); setAudDirty(true); }}
                  className="w-[110px] rounded-[9px] border border-[#DDE0E9] px-[10px] py-[7px] text-[13px] font-semibold tabular-nums outline-none transition focus:border-[#2FB463]" />
                <span className="text-[11.6px] text-muted">messages</span>
              </Field>
              <p className="m-0 max-w-[340px] text-[11px] leading-[1.55] text-faint">
                Sends happen inside your sending hours and under the global daily cap (Settings tab). A blank per-day uses the global cap; it can only lower it, never raise it.
              </p>
            </div>
          </Section>

          {/* ── 4 · LIVE ── */}
          {(sel.status !== 'draft' || (stats?.enrolled ?? 0) > 0) && stats && (
            <Section n={4} title="Live" hint="step by step, refreshes every 30s"
              right={
                <button onClick={() => selId && loadCampaign(selId)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-muted transition hover:text-ink">
                  <RefreshCw className="h-2.5 w-2.5" /> Refresh
                </button>
              }>
              {/* funnel */}
              <div className="grid gap-[6px]">
                {stats.steps.map((st) => {
                  const max = Math.max(stats.enrolled, 1);
                  return (
                    <FunnelBar key={st.step_no} label={`Step ${st.step_no} · sent`} value={st.sent} max={max} />
                  );
                })}
                <FunnelBar label="Replied" value={stats.replied} max={Math.max(stats.enrolled, 1)} tone="indigo" />
                <FunnelBar label="Opted out" value={stats.opted_out} max={Math.max(stats.enrolled, 1)} tone="red" />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#F0F1F5] pt-2.5 text-[11.4px] text-muted">
                <span><b className="text-ink-2">{stats.enrolled}</b> enrolled</span>
                <span><b className="text-ink-2">{stats.active}</b> in flight</span>
                <span><b className="text-ink-2">{stats.paused}</b> paused (replied)</span>
                <span><b className="text-ink-2">{stats.completed}</b> finished all steps</span>
                <span><b className="text-[#1B7A44]">{stats.sent_today}</b> sent today</span>
              </div>

              {/* replies — the entire point of the campaign */}
              {stats.replies.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-indigo-700" />
                    <b className="text-[12.4px] font-semibold">Replies — answer, then send /uk</b>
                  </div>
                  {stats.replies.map((r) => (
                    <div key={r.enrollment_id} className="mb-[6px] flex items-start gap-2.5 rounded-[11px] border border-[#E8EAF0] bg-[#FBFBFC] px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <b className="truncate text-[12.2px]">{r.lead_name}</b>
                          <span className="flex-shrink-0 text-[10.2px] text-faint">{timeAgo(r.replied_at)}</span>
                        </div>
                        {r.body && (
                          <p className="m-0 mt-[3px] flex items-start gap-1.5 text-[11.6px] leading-[1.5] text-[#45464c]">
                            <CornerDownRight className="mt-[2px] h-3 w-3 flex-shrink-0 text-faint" />
                            <span className="line-clamp-2">{r.body}</span>
                          </p>
                        )}
                      </div>
                      <a href="/whatsapp"
                        className="flex-shrink-0 rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1.5 text-[11px] font-bold text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                        Open chat
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {/* failures */}
              {stats.failures.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-[#B3423A]" />
                    <b className="text-[12.4px] font-semibold">Needs attention</b>
                  </div>
                  {stats.failures.map((f) => (
                    <div key={f.enrollment_id} className="mb-[6px] flex items-center gap-2.5 rounded-[11px] border border-[#F6D5D2] bg-[#FDF7F6] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-[12px]">{f.lead_name} <span className="font-normal text-faint">· step {f.at_step}</span></b>
                        <span className="block truncate text-[10.8px] text-[#8A2F28]">{f.error ?? 'send failed'}</span>
                      </div>
                      <button onClick={() => retryFail(f.enrollment_id)}
                        className="flex-shrink-0 rounded-lg border border-[#D7F3E1] bg-[#EDFAF1] px-2.5 py-1 text-[10.8px] font-bold text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                        ↻ Retry
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {stats.replies.length === 0 && stats.failures.length === 0 && stats.enrolled > 0 && (
                <p className="m-0 mt-3 flex items-center gap-1.5 text-[11.4px] text-faint">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#1B7A44]" /> Running clean — replies and any failures appear here the moment they happen.
                </p>
              )}
            </Section>
          )}

          {/* first-run helper */}
          {sel.status === 'draft' && (
            <div className="rounded-[13px] border border-[#DDE5FB] bg-[#F8FAFF] px-4 py-3 text-[12px] leading-[1.6] text-[#3B5BDB]">
              <b className="font-semibold">Ready when you are.</b> Check the audience count, make sure the messages read right, then press
              <b className="font-semibold"> Start campaign</b>. First sends go out inside your sending hours; after that it tops itself up every 10 minutes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function Section({ n, title, hint, right, children }: {
  n: number; title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="flex-shrink-0 rounded-[14px] border border-[#E8EAF0] bg-white p-[16px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
      <div className="mb-[13px] flex items-center gap-2.5">
        <span className="flex h-[19px] w-[19px] items-center justify-center rounded-[6px] bg-[#EEF1FD] text-[10px] font-extrabold text-[#3A48A8]">{n}</span>
        <h3 className="m-0 text-[13.6px] font-bold tracking-[-.015em]">{title}</h3>
        {hint && <span className="text-[11.2px] text-faint">{hint}</span>}
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </section>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      <span className="w-[92px] flex-shrink-0 text-[11.4px] font-semibold text-[#697086]">{label}</span>
      {children}
    </div>
  );
}

/**
 * A chip carries its own count. That single decision is what removes the
 * arithmetic: you can see that "Never asked" holds 82 people and "Yes" holds
 * none, so you never tick a combination that silently reaches nobody.
 * A count of 0 is dimmed — visibly a dead end before you click it.
 */
function Chip({ on, tone, big, count, onClick, children }: {
  on: boolean; tone?: 'green'; big?: boolean; count?: number;
  onClick: () => void; children: React.ReactNode;
}) {
  const empty = count === 0 && !on;
  return (
    <button onClick={onClick}
      className={cn(
        'inline-flex items-center gap-[6px] rounded-[8px] border font-semibold transition',
        big ? 'px-[13px] py-[7px] text-[12.6px]' : 'px-[10px] py-[4px] text-[11.6px]',
        on
          ? tone === 'green'
            ? 'border-[#BFE7CD] bg-[#EDFAF1] text-[#1B7A44]'
            : 'border-[#CBD3F5] bg-[#EEF1FD] text-[#3A48A8]'
          : empty
            ? 'border-[#EDEFF4] bg-[#FBFBFC] text-[#BFC4D2]'
            : 'border-[#E3E6ED] bg-[#FAFBFC] text-[#697086] hover:border-[#CBD1DD]'
      )}>
      {children}
      {count !== undefined && (
        <span className={cn('rounded-[5px] px-[5px] py-px text-[10px] font-bold tabular-nums',
          on ? 'bg-white/70' : empty ? 'bg-[#F4F5F8] text-[#C6CAD6]' : 'bg-[#EDEFF4] text-[#8A90A5]')}>
          {count}
        </span>
      )}
    </button>
  );
}

function Locked({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-[8px] border border-[#EDEFF4] bg-[#F7F8FA] px-[9px] py-[4px] text-[11px] font-medium text-[#A6ACBF]">
      {icon}{children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.8px] font-extrabold uppercase tracking-[.07em] text-faint">{label}</span>
      <span className="flex items-center gap-2">{children}</span>
    </label>
  );
}

function FunnelBar({ label, value, max, tone }: {
  label: string; value: number; max: number; tone?: 'indigo' | 'red';
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[110px] flex-shrink-0 text-[11.2px] text-[#697086]">{label}</span>
      <span className="h-[18px] flex-1 overflow-hidden rounded-[6px] bg-[#F1F2F6]">
        <span className={cn('block h-full rounded-[6px] transition-all',
          tone === 'indigo' ? 'bg-gradient-to-r from-[#7C8BF0] to-[#5566D8]'
            : tone === 'red' ? 'bg-[#D9534F]'
            : 'bg-gradient-to-r from-[#34B36B] to-[#25A25A]')}
          style={{ width: `${pct}%` }} />
      </span>
      <b className="w-[42px] flex-shrink-0 text-right text-[11.6px] tabular-nums">{value}</b>
    </div>
  );
}

// Users icon referenced in imports for future use — keep tree-shake friendly.
void Users;
