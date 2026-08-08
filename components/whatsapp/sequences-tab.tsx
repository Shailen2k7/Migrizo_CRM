'use client';

// =============================================================================
// SEQUENCES TAB — build automation like a playlist, not a flowchart.
//
// The design bet: a numbered step list is the most complex thing a 1-day-old
// employee can operate without training. So there are exactly three ideas on
// screen — WHICH message (template dropdown), WHEN (days after the previous
// one), and WHO (the enrol modal). Everything else the engine does — window,
// caps, suppression, opt-out — is deliberately invisible here because no human
// should have to remember to apply safety rules.
//
// Reordering: drag the handle, or use the arrows. Steps renumber on save; the
// engine reads "next step = steps already received + 1" from the live list, so
// edits apply to everyone going forward — the agreed semantics.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, GripVertical, Trash2, ChevronUp, ChevronDown, Play, Pause, Users,
  Loader2, X, Search, AlertCircle, CheckCircle2, Clock, MessageSquare, Zap,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn, initials, avatarColor } from '@/lib/utils';
import { toast } from 'sonner';
import type { WaTemplate } from '@/lib/whatsapp/types';
import type { Lead } from '@/lib/types';

// ── shapes ──────────────────────────────────────────────────────────────────
export interface SeqOverviewRow {
  id: string; name: string; description: string | null; status: string;
  daily_limit: number | null; step_count: number;
  enrolled_active: number; enrolled_paused: number;
  enrolled_completed: number; enrolled_stopped: number; replied: number;
  sent_today: number; next_due_at: string | null; updated_at: string;
}

interface StepDraft {
  key: string;              // stable client key for drag/animation
  template_id: string;
  wait_days: number;
}

interface EnrollmentRow {
  id: string; status: string; current_step: number; next_send_at: string | null;
  has_replied: boolean; phone_e164: string; sent_count: number;
  last_error: string | null;
  lead: { full_name: string } | null;
}

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
  stopped: 'bg-[#EDEFF3] text-[#7A8095] border-[#DDE0E9]',
  completed: 'bg-[#EEF2FE] text-[#3B5BDB] border-[#DDE5FB]',
};

const firstNamePreview = (body: string) =>
  body.replace(/\{\{\s*1\s*\}\}/g, 'Vikram').replace(/\{\{\s*(\d+)\s*\}\}/g, '…');

let keySeed = 0;
const newKey = () => `k${++keySeed}`;

export default function SequencesTab({ workspaceId, templates, leads, overview, reloadOverview }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates]);

  const [selId, setSelId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [dailyLimit, setDailyLimit] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [enrLoading, setEnrLoading] = useState(false);
  const dragIndex = useRef<number | null>(null);

  const sel = overview.find((s) => s.id === selId) || null;

  // ── load the selected sequence's steps + enrollments ─────────────────────
  const loadSequence = useCallback(async (id: string) => {
    const [stepsRes, enrRes] = await Promise.all([
      supabase.from('whatsapp_sequence_steps')
        .select('template_id, wait_days, step_no')
        .eq('sequence_id', id).order('step_no'),
      supabase.from('whatsapp_sequence_enrollments')
        .select('id, status, current_step, next_send_at, has_replied, phone_e164, sent_count, last_error, lead:leads(full_name)')
        .eq('sequence_id', id).order('created_at', { ascending: false }).limit(200),
    ]);
    setSteps(((stepsRes.data ?? []) as Array<{ template_id: string; wait_days: number }>)
      .map((s) => ({ key: newKey(), template_id: s.template_id, wait_days: s.wait_days })));
    setEnrollments((enrRes.data ?? []) as unknown as EnrollmentRow[]);
    setDirty(false);
  }, [supabase]);

  useEffect(() => {
    if (!selId) return;
    const row = overview.find((s) => s.id === selId);
    if (row) { setName(row.name); setDailyLimit(row.daily_limit ? String(row.daily_limit) : ''); }
    setEnrLoading(true);
    loadSequence(selId).finally(() => setEnrLoading(false));
  }, [selId, loadSequence]); // eslint-disable-line react-hooks/exhaustive-deps

  // auto-select the first sequence once the overview lands
  useEffect(() => {
    if (!selId && overview.length) setSelId(overview[0].id);
  }, [overview, selId]);

  // ── actions ───────────────────────────────────────────────────────────────
  async function createSequence() {
    setCreating(true);
    const { data, error } = await supabase.from('whatsapp_sequences')
      .insert({ workspace_id: workspaceId, name: 'New sequence', status: 'draft' })
      .select('id').single();
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    await reloadOverview();
    setSelId(data.id);
    toast.success('Sequence created — add your first step');
  }

  async function saveAll() {
    if (!selId) return;
    setSaving(true);
    try {
      const lim = dailyLimit.trim() === '' ? null : Math.max(1, parseInt(dailyLimit, 10) || 1);
      const { error: metaErr } = await supabase.from('whatsapp_sequences')
        .update({ name: name.trim() || 'Untitled sequence', daily_limit: lim })
        .eq('id', selId);
      if (metaErr) throw new Error(metaErr.message);

      const { data: n, error } = await supabase.rpc('whatsapp_sequence_save_steps', {
        p_sequence_id: selId,
        p_steps: steps.map((s) => ({ template_id: s.template_id, wait_days: s.wait_days })),
      });
      if (error) throw new Error(error.message);
      if (n === -1) throw new Error('Only campaign admins can edit sequences');
      setDirty(false);
      await reloadOverview();
      toast.success(`Saved — ${n} step${n === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!sel) return;
    if (sel.status !== 'active' && steps.length === 0) {
      toast.error('Add at least one step before activating'); return;
    }
    if (sel.status !== 'active' && dirty) {
      toast.error('Save your steps first, then activate'); return;
    }
    const next = sel.status === 'active' ? 'paused' : 'active';
    const { error } = await supabase.from('whatsapp_sequences')
      .update({ status: next }).eq('id', sel.id);
    if (error) { toast.error(error.message); return; }
    await reloadOverview();
    toast.success(next === 'active' ? 'Sequence is live — the engine will pick it up' : 'Sequence paused — nothing more sends until you resume');
  }

  async function deleteSequence() {
    if (!sel) return;
    const total = sel.enrolled_active + sel.enrolled_paused;
    if (!window.confirm(
      total > 0
        ? `Delete "${sel.name}"? ${total} enrolled lead${total === 1 ? '' : 's'} will stop receiving messages. This cannot be undone.`
        : `Delete "${sel.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('whatsapp_sequences').delete().eq('id', sel.id);
    if (error) { toast.error(error.message); return; }
    setSelId(null);
    await reloadOverview();
    toast.success('Sequence deleted');
  }

  async function rowAction(id: string, action: 'pause' | 'resume' | 'stop') {
    const { data, error } = await supabase.rpc('whatsapp_enrollment_action', {
      p_enrollment_id: id, p_action: action,
    });
    if (error) { toast.error(error.message); return; }
    setEnrollments((prev) => prev.map((e) => (e.id === id ? { ...e, status: String(data) } : e)));
    reloadOverview();
  }

  // ── step list edits (all local until Save) ────────────────────────────────
  const mark = (fn: (prev: StepDraft[]) => StepDraft[]) => { setSteps(fn); setDirty(true); };
  const addStep = () => {
    const used = new Set(steps.map((s) => s.template_id));
    const next = activeTemplates.find((t) => !used.has(t.id)) ?? activeTemplates[0];
    if (!next) { toast.error('No active templates to add'); return; }
    mark((prev) => [...prev, { key: newKey(), template_id: next.id, wait_days: prev.length === 0 ? 0 : 3 }]);
  };
  const move = (i: number, dir: -1 | 1) => {
    mark((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const onDrop = (target: number) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === target) return;
    mark((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const cumulativeDay = (idx: number) =>
    steps.slice(1, idx + 1).reduce((acc, s) => acc + s.wait_days, 0);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 gap-[14px] p-[14px]">
      {/* ── left: sequence list ── */}
      <div className="flex w-[300px] flex-shrink-0 flex-col rounded-[14px] border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.06)]">
        <div className="flex-shrink-0 border-b border-[#E8EAF0] p-[14px]">
          <button
            onClick={createSequence} disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#25A25A] px-3 py-[10px] text-[13.4px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-60"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New sequence
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[8px]">
          {overview.length === 0 && (
            <div className="px-4 py-10 text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 text-faint" />
              <p className="m-0 text-[13px] leading-[1.6] text-muted">
                No sequences yet. Create one, add steps from your approved
                templates, then enrol a batch of leads.
              </p>
            </div>
          )}
          {overview.map((s) => (
            <button
              key={s.id} onClick={() => setSelId(s.id)}
              className={cn(
                'mb-[6px] w-full rounded-[11px] border px-[13px] py-[11px] text-left transition',
                selId === s.id
                  ? 'border-[#D7F3E1] bg-[#EDFAF1]'
                  : 'border-transparent hover:bg-[#F5F6F9]'
              )}
            >
              <div className="mb-[5px] flex items-center gap-2">
                <b className="min-w-0 flex-1 truncate text-[13.6px] font-semibold tracking-[-.015em]">{s.name}</b>
                <span className={cn('flex-shrink-0 rounded-full border px-[8px] py-[2px] text-[10.4px] font-semibold', STATUS_CHIP[s.status] ?? STATUS_CHIP.draft)}>
                  {s.status}
                </span>
              </div>
              <div className="flex items-center gap-[10px] text-[11.4px] text-muted">
                <span>{s.step_count} step{s.step_count === 1 ? '' : 's'}</span>
                <span>·</span>
                <span>{s.enrolled_active} active</span>
                {s.sent_today > 0 && (<><span>·</span><span className="text-[#1B7A44]">{s.sent_today} today</span></>)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── main: editor ── */}
      {!sel ? (
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-[14px] border border-[#E8EAF0] bg-white text-center shadow-[0_1px_2px_rgba(20,24,40,.06)]">
          <div className="px-6 py-16 text-faint">
            <Zap className="mx-auto mb-3 h-9 w-9" />
            <b className="block text-[14px] font-semibold text-muted">Pick a sequence, or create one</b>
            <p className="m-0 mt-2 max-w-[300px] text-[12.6px] leading-[1.6]">
              A sequence is just a numbered list: which message, then how many
              days until the next one.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-[14px] overflow-y-auto">
          {/* header card */}
          <div className="flex-shrink-0 rounded-[14px] border border-[#E8EAF0] bg-white p-[18px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); setDirty(true); }}
                className="min-w-[220px] flex-1 rounded-[9px] border border-transparent px-2 py-[6px] text-[17px] font-semibold tracking-[-.02em] outline-none transition hover:border-[#DDE0E9] focus:border-[#2FB463] focus:shadow-[0_0_0_3px_#EDFAF1]"
              />
              <span className={cn('rounded-full border px-[10px] py-[4px] text-[11.4px] font-semibold', STATUS_CHIP[sel.status] ?? STATUS_CHIP.draft)}>
                {sel.status}
              </span>
              <button
                onClick={toggleStatus}
                className={cn(
                  'inline-flex items-center gap-[7px] rounded-[9px] px-[14px] py-[8px] text-[13px] font-semibold transition',
                  sel.status === 'active'
                    ? 'border border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07] hover:bg-[#FDEBC8]'
                    : 'bg-[#25A25A] text-white hover:bg-[#1B7A44]'
                )}
              >
                {sel.status === 'active'
                  ? (<><Pause className="h-[14px] w-[14px]" />Pause sequence</>)
                  : (<><Play className="h-[14px] w-[14px]" />Activate</>)}
              </button>
              <button
                onClick={deleteSequence}
                title="Delete sequence"
                className="flex h-[36px] w-[36px] items-center justify-center rounded-[9px] border border-[#E8EAF0] text-muted transition hover:border-[#F8D6D6] hover:bg-[#FEEFEF] hover:text-[#B02B2B]"
              >
                <Trash2 className="h-[15px] w-[15px]" />
              </button>
            </div>

            <div className="mt-[14px] flex flex-wrap gap-[8px]">
              <Stat label="active" n={sel.enrolled_active} tone="good" />
              <Stat label="replied" n={sel.replied} tone="info" />
              <Stat label="completed" n={sel.enrolled_completed} tone="info" />
              <Stat label="paused" n={sel.enrolled_paused} tone="warn" />
              <Stat label="opted out / stopped" n={sel.enrolled_stopped} tone="bad" />
              <Stat label="sent today" n={sel.sent_today} tone="plain" />
            </div>
          </div>

          {/* steps card */}
          <div className="flex-shrink-0 rounded-[14px] border border-[#E8EAF0] bg-white p-[18px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
            <div className="mb-[14px] flex items-center gap-3">
              <h3 className="m-0 text-[14.5px] font-bold tracking-[-.02em]">Steps</h3>
              <span className="text-[12px] text-muted">
                Drag to reorder · changes apply to everyone from their next message
              </span>
              {dirty && (
                <span className="ml-auto rounded-full border border-[#F8E2B8] bg-[#FEF6E6] px-[9px] py-[3px] text-[11px] font-semibold text-[#A25D07]">
                  Unsaved changes
                </span>
              )}
            </div>

            {steps.length === 0 && (
              <p className="m-0 mb-3 rounded-[11px] border border-dashed border-[#DDE0E9] bg-[#F9FAFB] px-4 py-6 text-center text-[13px] text-muted">
                No steps yet. Add the first message below.
              </p>
            )}

            {steps.map((s, i) => {
              const tpl = templates.find((t) => t.id === s.template_id);
              return (
                <div
                  key={s.key}
                  draggable
                  onDragStart={() => { dragIndex.current = i; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                  className="mb-[8px] flex items-start gap-[12px] rounded-[12px] border border-[#E8EAF0] bg-white p-[13px] transition hover:border-[#C9CDD9]"
                >
                  <span className="mt-[7px] cursor-grab text-faint active:cursor-grabbing"><GripVertical className="h-[16px] w-[16px]" /></span>
                  <span className="mt-[3px] flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-[#EDFAF1] text-[12.6px] font-bold text-[#1B7A44]">
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-[9px]">
                      <select
                        value={s.template_id}
                        onChange={(e) => mark((prev) => prev.map((x, xi) => (xi === i ? { ...x, template_id: e.target.value } : x)))}
                        className="min-w-[240px] rounded-[9px] border border-[#DDE0E9] bg-white px-[10px] py-[7px] text-[13px] font-medium outline-none transition focus:border-[#2FB463]"
                      >
                        {activeTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}{t.meta_status !== 'approved' ? ` — ${t.meta_status}` : ''}
                          </option>
                        ))}
                      </select>

                      {i === 0 ? (
                        <span className="inline-flex items-center gap-[5px] rounded-full border border-[#D7F3E1] bg-[#EDFAF1] px-[10px] py-[5px] text-[11.6px] font-semibold text-[#1B7A44]">
                          <Zap className="h-[11px] w-[11px]" /> Sends on enrol
                        </span>
                      ) : (
                        <label className="inline-flex items-center gap-[7px] text-[12.6px] text-ink-2">
                          wait
                          <input
                            type="number" min={0} max={365} value={s.wait_days}
                            onChange={(e) => mark((prev) => prev.map((x, xi) =>
                              (xi === i ? { ...x, wait_days: Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0)) } : x)))}
                            className="w-[62px] rounded-[8px] border border-[#DDE0E9] px-[8px] py-[6px] text-center text-[13px] font-semibold tabular-nums outline-none transition focus:border-[#2FB463]"
                          />
                          day{s.wait_days === 1 ? '' : 's'} after step {i}
                          <span className="text-faint">· lands day {cumulativeDay(i)}</span>
                        </label>
                      )}

                      {tpl && tpl.meta_status !== 'approved' && (
                        <span className="inline-flex items-center gap-[4px] rounded-full border border-[#F8E2B8] bg-[#FEF6E6] px-[8px] py-[3px] text-[10.6px] font-bold uppercase tracking-wide text-[#A25D07]">
                          <Clock className="h-[10px] w-[10px]" />{tpl.meta_status}
                        </span>
                      )}
                    </div>

                    {tpl && (
                      <p className="m-0 mt-[8px] line-clamp-2 rounded-[9px] bg-[#F7F8FA] px-[11px] py-[8px] text-[12.2px] leading-[1.55] text-ink-2">
                        {firstNamePreview(tpl.body)}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-shrink-0 flex-col gap-[3px]">
                    <IconBtn onClick={() => move(i, -1)} disabled={i === 0} title="Move up"><ChevronUp className="h-[14px] w-[14px]" /></IconBtn>
                    <IconBtn onClick={() => move(i, 1)} disabled={i === steps.length - 1} title="Move down"><ChevronDown className="h-[14px] w-[14px]" /></IconBtn>
                    <IconBtn danger onClick={() => mark((prev) => prev.filter((_, xi) => xi !== i))} title="Remove step"><X className="h-[14px] w-[14px]" /></IconBtn>
                  </div>
                </div>
              );
            })}

            <button
              onClick={addStep}
              className="mt-[4px] flex w-full items-center justify-center gap-2 rounded-[11px] border border-dashed border-[#C9CDD9] px-3 py-[11px] text-[13px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44]"
            >
              <Plus className="h-4 w-4" /> Add step
            </button>

            <div className="mt-[16px] flex flex-wrap items-center gap-[12px] border-t border-[#E8EAF0] pt-[14px]">
              <label className="inline-flex items-center gap-[8px] text-[12.8px] text-ink-2">
                Daily limit for this sequence
                <input
                  type="number" min={1} placeholder="global cap"
                  value={dailyLimit}
                  onChange={(e) => { setDailyLimit(e.target.value); setDirty(true); }}
                  className="w-[92px] rounded-[8px] border border-[#DDE0E9] px-[9px] py-[7px] text-center text-[13px] tabular-nums outline-none transition focus:border-[#2FB463]"
                />
                <span className="text-faint">blank = use the global cap; can only lower it, never raise it</span>
              </label>
              <div className="ml-auto flex gap-[10px]">
                <button
                  onClick={saveAll} disabled={saving || !dirty}
                  className="inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[16px] py-[9px] text-[13.2px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <CheckCircle2 className="h-[14px] w-[14px]" />}
                  Save
                </button>
                <button
                  onClick={() => { if (dirty) { toast.error('Save your steps first'); return; } setEnrolOpen(true); }}
                  className="inline-flex items-center gap-[7px] rounded-[9px] border border-[#DDE0E9] bg-white px-[16px] py-[9px] text-[13.2px] font-semibold text-ink-2 transition hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44]"
                >
                  <Users className="h-[14px] w-[14px]" /> Enrol leads
                </button>
              </div>
            </div>
          </div>

          {/* enrolled card */}
          <div className="flex-shrink-0 rounded-[14px] border border-[#E8EAF0] bg-white p-[18px] shadow-[0_1px_2px_rgba(20,24,40,.06)]">
            <div className="mb-[12px] flex items-center gap-3">
              <h3 className="m-0 text-[14.5px] font-bold tracking-[-.02em]">Enrolled leads</h3>
              <span className="text-[12px] text-muted">most recent 200 · a reply flags, it never stops — you decide</span>
            </div>
            {enrLoading && <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted" /></div>}
            {!enrLoading && enrollments.length === 0 && (
              <p className="m-0 rounded-[11px] bg-[#F9FAFB] px-4 py-6 text-center text-[13px] text-muted">
                Nobody enrolled yet. Save your steps, then press Enrol leads.
              </p>
            )}
            {!enrLoading && enrollments.map((e) => (
              <div key={e.id} className="flex items-center gap-[12px] border-b border-[#F0F1F5] py-[9px] last:border-b-0">
                <span
                  className="flex h-[32px] w-[32px] flex-shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                  style={{ background: avatarColor(e.lead?.full_name || e.phone_e164) }}
                >
                  {initials(e.lead?.full_name || '#')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <b className="truncate text-[13.2px] font-semibold">{e.lead?.full_name || e.phone_e164}</b>
                    {e.has_replied && (
                      <span className="flex-shrink-0 rounded-full border border-[#DDE5FB] bg-[#EEF2FE] px-[7px] py-px text-[10px] font-bold text-[#3B5BDB]">
                        replied
                      </span>
                    )}
                  </span>
                  <span className="mt-[1px] block text-[11.4px] text-muted">
                    step {e.current_step}/{sel.step_count}
                    {e.status === 'active' && e.next_send_at
                      ? ` · next ${new Date(e.next_send_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                      : ''}
                    {e.last_error ? ` · ${e.last_error.slice(0, 60)}` : ''}
                  </span>
                </span>
                <span className={cn('flex-shrink-0 rounded-full border px-[9px] py-[3px] text-[10.8px] font-semibold', STATUS_CHIP[e.status] ?? STATUS_CHIP.draft)}>
                  {e.status}
                </span>
                <span className="flex flex-shrink-0 gap-[4px]">
                  {e.status === 'active' && (
                    <IconBtn onClick={() => rowAction(e.id, 'pause')} title="Pause this lead"><Pause className="h-[13px] w-[13px]" /></IconBtn>
                  )}
                  {e.status === 'paused' && (
                    <IconBtn onClick={() => rowAction(e.id, 'resume')} title="Resume this lead"><Play className="h-[13px] w-[13px]" /></IconBtn>
                  )}
                  {(e.status === 'active' || e.status === 'paused') && (
                    <IconBtn danger onClick={() => rowAction(e.id, 'stop')} title="Stop permanently"><X className="h-[13px] w-[13px]" /></IconBtn>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sel && (
        <EnrolModal
          open={enrolOpen}
          sequence={sel}
          leads={leads}
          onClose={() => setEnrolOpen(false)}
          onEnrolled={async () => {
            setEnrolOpen(false);
            await Promise.all([reloadOverview(), selId ? loadSequence(selId) : Promise.resolve()]);
          }}
        />
      )}
    </div>
  );
}

// ── ENROL MODAL — who gets this sequence, with the maths up front ───────────
function EnrolModal({ open, sequence, leads, onClose, onEnrolled }: {
  open: boolean; sequence: SeqOverviewRow; leads: Lead[];
  onClose: () => void; onEnrolled: () => Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [stage, setStage] = useState('');
  const [visa, setVisa] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState('');
  const [preview, setPreview] = useState<{ eligible: number; already_enrolled: number; suppressed: number; bad_phone: number; steps: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stages = useMemo(() => Array.from(new Set(leads.map((l) => l.stage).filter(Boolean))).sort(), [leads]);
  const visas = useMemo(() => Array.from(new Set(leads.map((l) => l.visa_type).filter(Boolean) as string[])).sort(), [leads]);

  useEffect(() => {
    if (!open) { setStage(''); setVisa(''); setQuery(''); setLimit(''); setPreview(null); return; }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.rpc('whatsapp_sequence_enroll_preview', {
        p_sequence_id: sequence.id, p_stage: stage || null, p_visa: visa || null, p_query: query || null,
      });
      const p = data as Record<string, number> & { ok?: boolean } | null;
      setPreview(p?.ok ? {
        eligible: p.eligible, already_enrolled: p.already_enrolled,
        suppressed: p.suppressed, bad_phone: p.bad_phone, steps: p.steps,
      } : null);
      setLoading(false);
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [open, stage, visa, query, sequence.id, supabase]);

  if (!open) return null;

  const lim = limit.trim() === '' ? null : Math.max(1, parseInt(limit, 10) || 1);
  const willEnrol = preview ? (lim ? Math.min(lim, preview.eligible) : preview.eligible) : 0;
  const totalMsgs = preview ? willEnrol * preview.steps : 0;

  async function enrol() {
    setEnrolling(true);
    try {
      const res = await fetch('/api/whatsapp/sequences/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequenceId: sequence.id,
          stage: stage || undefined, visa: visa || undefined,
          query: query || undefined, limit: lim ?? undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.detail || json.reason || 'Enrol failed'); return; }
      toast.success(`${json.enrolled} lead${json.enrolled === 1 ? '' : 's'} enrolled — first sends go out inside the next window`);
      await onEnrolled();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(20,24,40,.48)] p-6 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[84vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_60px_-20px_rgba(20,24,40,.34)]">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-[#E8EAF0] px-[20px] py-[16px]">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#D7F3E1] bg-[#EDFAF1]">
            <Users className="h-[16px] w-[16px] text-[#1B7A44]" />
          </span>
          <div className="flex-1">
            <h3 className="m-0 text-[15px] font-semibold tracking-[-.02em]">Enrol leads into “{sequence.name}”</h3>
            <p className="m-0 mt-[2px] text-[12px] text-muted">Filter, check the maths, confirm. Nothing sends outside 10:00–19:00 or over the cap.</p>
          </div>
          <button onClick={onClose} className="flex h-[32px] w-[32px] items-center justify-center rounded-full border border-[#E8EAF0] text-muted transition hover:bg-[#F5F6F9]"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[20px] py-[16px]">
          <div className="mb-[12px] grid grid-cols-2 gap-[10px]">
            <label className="text-[11.6px] font-semibold text-muted">
              Stage
              <select value={stage} onChange={(e) => setStage(e.target.value)}
                className="mt-[5px] w-full rounded-[9px] border border-[#DDE0E9] px-[10px] py-[8px] text-[13px] font-normal text-ink outline-none focus:border-[#2FB463]">
                <option value="">All stages</option>
                {stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-[11.6px] font-semibold text-muted">
              Visa type
              <select value={visa} onChange={(e) => setVisa(e.target.value)}
                className="mt-[5px] w-full rounded-[9px] border border-[#DDE0E9] px-[10px] py-[8px] text-[13px] font-normal text-ink outline-none focus:border-[#2FB463]">
                <option value="">All visas</option>
                {visas.map((v) => <option key={v} value={v}>{v.toUpperCase()}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[11.6px] font-semibold text-muted">
            Search (optional)
            <span className="relative mt-[5px] block">
              <Search className="pointer-events-none absolute left-[10px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, number or email…"
                className="w-full rounded-[9px] border border-[#DDE0E9] py-[8px] pl-[32px] pr-3 text-[13px] font-normal text-ink outline-none focus:border-[#2FB463]" />
            </span>
          </label>
          <label className="mt-[12px] block text-[11.6px] font-semibold text-muted">
            Only enrol the first
            <span className="mt-[5px] flex items-center gap-[8px]">
              <input type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="all"
                className="w-[100px] rounded-[9px] border border-[#DDE0E9] px-[10px] py-[8px] text-center text-[13px] font-normal tabular-nums text-ink outline-none focus:border-[#2FB463]" />
              <span className="font-normal text-faint">leads — useful for a pilot batch of 20–30 before going wide</span>
            </span>
          </label>

          {/* the maths */}
          <div className="mt-[16px] rounded-[12px] border border-[#E8EAF0] bg-[#F9FAFB] p-[14px]">
            {loading && !preview ? (
              <div className="py-3 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted" /></div>
            ) : preview ? (
              <>
                <div className="flex flex-wrap gap-[7px]">
                  <Stat label="will enrol" n={willEnrol} tone="good" />
                  <Stat label="already in" n={preview.already_enrolled} tone="plain" />
                  <Stat label="opted out" n={preview.suppressed} tone="bad" />
                  <Stat label="bad number" n={preview.bad_phone} tone="warn" />
                </div>
                <p className="m-0 mt-[11px] text-[12.6px] leading-[1.6] text-ink-2">
                  <b className="tabular-nums">{willEnrol.toLocaleString()}</b> leads ×{' '}
                  <b className="tabular-nums">{preview.steps}</b> steps ={' '}
                  <b className="tabular-nums">{totalMsgs.toLocaleString()}</b> messages over the coming weeks
                  {sequence.daily_limit ? <> · at {sequence.daily_limit}/day this batch alone takes ~<b className="tabular-nums">{Math.ceil(willEnrol / Math.max(1, sequence.daily_limit))}</b> days per step</> : null}.
                  Every one is a paid marketing conversation.
                </p>
              </>
            ) : (
              <p className="m-0 flex items-center gap-2 text-[12.6px] text-[#A25D07]">
                <AlertCircle className="h-4 w-4" /> Could not load the preview — is migration 047 applied?
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-[10px] border-t border-[#E8EAF0] bg-[#F5F6F9] px-[20px] py-[13px]">
          <span className="flex-1 text-[11.6px] text-muted">Enrolment is one-way per lead — re-running skips anyone already in.</span>
          <button onClick={onClose} className="rounded-[9px] border border-[#DDE0E9] bg-white px-[14px] py-[8px] text-[13px] font-semibold text-ink-2 transition hover:bg-[#F5F6F9]">Cancel</button>
          <button
            onClick={enrol} disabled={enrolling || !preview || willEnrol === 0}
            className="inline-flex items-center gap-[7px] rounded-[9px] bg-[#25A25A] px-[14px] py-[8px] text-[13px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:opacity-40"
          >
            {enrolling ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : null}
            Enrol {willEnrol.toLocaleString()} lead{willEnrol === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function Stat({ n, label, tone }: { n: number; label: string; tone: 'good' | 'warn' | 'bad' | 'plain' | 'info' }) {
  const skin =
    tone === 'good' ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
      : tone === 'warn' ? 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]'
      : tone === 'bad' ? 'border-[#F8D6D6] bg-[#FEEFEF] text-[#B02B2B]'
      : tone === 'info' ? 'border-[#DDE5FB] bg-[#EEF2FE] text-[#3B5BDB]'
      : 'border-[#DDE0E9] bg-white text-ink-2';
  return (
    <span className={cn('inline-flex items-baseline gap-[5px] rounded-full border px-[10px] py-[4px] text-[11.2px] font-medium', skin)}>
      <b className="text-[12.2px] font-bold tabular-nums">{n.toLocaleString()}</b>{label}
    </span>
  );
}

function IconBtn({ children, onClick, disabled, title, danger }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; title: string; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={cn(
        'flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-transparent text-muted transition disabled:opacity-30',
        danger ? 'hover:border-[#F8D6D6] hover:bg-[#FEEFEF] hover:text-[#B02B2B]'
               : 'hover:border-[#DDE0E9] hover:bg-[#F5F6F9] hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}
