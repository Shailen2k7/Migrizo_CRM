'use client';

// =============================================================================
// MY QUEUE — what each rep sees every morning.
//
// Cold leads are handed out oldest-untouched-first, so nothing is ever
// forgotten. Hot leads (for whoever owns them) sit above in their own row.
// Working a lead means: contact them, then record an outcome — that outcome
// is what routes the lead onward and keeps the rotation honest.
// =============================================================================
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { createClient } from '@/lib/supabase/client';
import { initials, avatarColor, cn } from '@/lib/utils';
import { STAGE_META, type Lead } from '@/lib/types';
import { toast } from 'sonner';
import {
  Loader2, Phone, MessageCircle, Mail, X, Flame, Pause, PhoneOff,
  Ban, Sparkles, ArrowRight, Inbox, RefreshCw, Check,
} from 'lucide-react';

interface QueueRow {
  id: string;
  lead_id: string;
  status: 'pending' | 'done';
  outcome: string | null;
  rolled_over: boolean;
  lead: Lead & { ai_score?: number | null; ai_brief?: string | null; attempt_count?: number | null; last_touched_at?: string | null };
}

const OUTCOMES = [
  { key: 'interested_hot', label: 'Interested \u2014 Hot', desc: 'Ready to move. Becomes a hot lead, handed to the hot-lead owner', Icon: Flame, tone: '#059669', bg: '#ECFDF5' },
  { key: 'interested_cold', label: 'Interested \u2014 Cold', desc: 'Keen but still deciding. Stays cold and keeps its place in the rotation', Icon: Flame, tone: '#4F46E5', bg: '#EEF0FF' },
  { key: 'not_now', label: 'Not right now', desc: 'Sleeps 30 days, then returns', Icon: Pause, tone: '#B45309', bg: '#FFF8EC' },
  { key: 'no_answer', label: 'No answer', desc: 'Back in pool for next rotation', Icon: PhoneOff, tone: '#6B7280', bg: '#F4F6FA' },
  { key: 'dead', label: 'Not interested / wrong number', desc: 'Retired from the pool', Icon: Ban, tone: '#E11D48', bg: '#FFF1F3' },
] as const;

const daysSince = (d?: string | null) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
const scoreTone = (s?: number | null) =>
  s == null ? { bg: '#F4F6FA', fg: '#6B7280' }
  : s >= 70 ? { bg: '#FFF1F3', fg: '#B91C1C' }
  : s >= 40 ? { bg: '#FFF8EC', fg: '#B45309' }
  : { bg: '#F4F6FA', fg: '#6B7280' };

export default function MyQueuePage() {
  const app = useApp() as ReturnType<typeof useApp> & {
    workspace: { id: string }; user: { id: string; name: string }; role: string;
    updateLead: (id: string, patch: Partial<Lead>) => Promise<void>;
  };
  const { workspace, user, updateLead } = app;

  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [hot, setHot] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<'all' | 'best' | 'rolled'>('all');
  const [active, setActive] = useState<QueueRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // The queue's day is the INDIAN calendar date. Using the browser's UTC date
  // would ask for the wrong day between midnight and 5:30 AM IST.
  const today = useMemo(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()), []);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lead_queue')
      .select('id, lead_id, status, outcome, rolled_over, leads!inner(*)')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .eq('day', today)
      .order('rolled_over', { ascending: false });

    const mapped: QueueRow[] = (data || []).map((r) => {
      const rec = r as unknown as QueueRow & { leads: QueueRow['lead'] };
      return { id: rec.id, lead_id: rec.lead_id, status: rec.status, outcome: rec.outcome, rolled_over: rec.rolled_over, lead: rec.leads };
    });
    setRows(mapped);

    // Hot leads owned by this person.
    const { data: h } = await supabase
      .from('leads')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('owner_id', user.id)
      .eq('stage', 'hot')   // the CRM's only hot stage
      .order('last_touched_at', { ascending: true, nullsFirst: true })
      .limit(20);
    setHot((h as Lead[]) || []);
  }, [workspace.id, user.id, today]);

  // Morning routine: make sure today's queue exists, then score it, then show it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // Build today's queue if it doesn't exist yet. Surface any problem
      // instead of silently showing an empty screen.
      const { error: genErr } = await supabase.rpc('generate_daily_queue', { p_workspace_id: workspace.id });
      if (genErr) toast.error(`Could not build today's queue: ${genErr.message}`);
      if (cancelled) return;
      await load();
      // Scoring runs in the background — the queue is usable without it.
      fetch('/api/queue/score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id }),
      }).then((r) => r.json()).then((d) => { if (!cancelled && d?.scored > 0) void load(); }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [workspace.id, load]);

  const pending = useMemo(() => (rows || []).filter((r) => r.status === 'pending'), [rows]);
  const doneCount = (rows || []).length - pending.length;
  const total = (rows || []).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const promoted = (rows || []).filter((r) => r.outcome === 'interested_hot').length;
  const rolled = (rows || []).filter((r) => r.rolled_over).length;

  const visible = useMemo(() => {
    let list = [...(rows || [])];
    if (filter === 'best') list.sort((a, b) => (b.lead.ai_score ?? -1) - (a.lead.ai_score ?? -1));
    if (filter === 'rolled') list = list.filter((r) => r.rolled_over);
    return list;
  }, [rows, filter]);

  const openLead = (r: QueueRow) => { if (r.status === 'done') return; setActive(r); setDraft(null); setNote(''); };

  const submitOutcome = async (outcome: string) => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/queue/outcome', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: active.id, outcome, note }),
      });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || 'Could not save'); return; }

      if (outcome === 'not_now' || outcome === 'interested_cold') {
        // Offer Claude's follow-up before closing. A keen-but-cold lead is
        // exactly who benefits from a prompt, personal follow-up note.
        const dr = await fetch('/api/queue/draft', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: active.lead_id }),
        }).then((r) => r.json()).catch(() => null);
        if (dr?.ok && dr.message) { setDraft(dr.message); await load(); setBusy(false); return; }
      }

      toast.success(
        outcome === 'interested_hot' ? 'Marked hot — handed to the hot-lead owner'
        : outcome === 'interested_cold' ? 'Interest noted — stays cold, still in rotation'
        : outcome === 'not_now' ? 'Sleeping for 30 days'
        : d.retired ? 'Retired from the pool'
        : 'Back in the pool'
      );
      setActive(null);
      await load();
    } finally { setBusy(false); }
  };

  // Stage changes go through the shared updateLead, so the Leads page,
  // Pipeline and every other view update at the same time.
  const changeStage = async (leadId: string, stage: string) => {
    await updateLead(leadId, { stage: stage as Lead['stage'], last_touched_at: new Date().toISOString() } as Partial<Lead>);
    toast.success('Status updated everywhere');
    await load();
    setActive((a) => a ? { ...a, lead: { ...a.lead, stage: stage as Lead['stage'] } } : a);
  };

  const manualRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* hero */}
      <div className="rounded-[20px] p-5 sm:p-6 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(140deg,#312E81,#4F46E5 70%)' }}>
        <div className="absolute -right-12 -top-16 w-56 h-56 rounded-full" style={{ background: 'rgba(255,255,255,.07)' }} />
        <div className="relative flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[12px] font-extrabold"
            style={{ background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)' }}>
            {initials(user.name)}
          </div>
          <div>
            <div className="text-[15px] font-bold">{user.name}</div>
            <div className="text-[10.5px] opacity-80">Today&rsquo;s lead queue</div>
          </div>
          <button onClick={manualRefresh} className="ml-auto p-2 rounded-lg" style={{ background: 'rgba(255,255,255,.14)' }} title="Refresh">
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
        </div>
        <div className="relative flex items-end gap-6 flex-wrap">
          <div>
            <div className="text-[30px] font-black leading-none tracking-tight">{doneCount}<span className="text-[14px] opacity-70 font-bold">/{total}</span></div>
            <div className="text-[10.5px] opacity-80 mt-1">worked today</div>
          </div>
          <div className="pl-6 border-l" style={{ borderColor: 'rgba(255,255,255,.22)' }}>
            <div className="text-[30px] font-black leading-none tracking-tight">{promoted}</div>
            <div className="text-[10.5px] opacity-80 mt-1">turned hot</div>
          </div>
          {rolled > 0 && (
            <div className="pl-6 border-l" style={{ borderColor: 'rgba(255,255,255,.22)' }}>
              <div className="text-[30px] font-black leading-none tracking-tight">{rolled}</div>
              <div className="text-[10.5px] opacity-80 mt-1">rolled over</div>
            </div>
          )}
          <div className="ml-auto relative w-[60px] h-[60px]">
            <svg width="60" height="60" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="30" cy="30" r="25" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="5.5" />
              <circle cx="30" cy="30" r="25" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round"
                strokeDasharray="157" strokeDashoffset={157 * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .4s' }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[13.5px] font-extrabold">{pct}%</div>
          </div>
        </div>
      </div>

      {/* hot leads */}
      {hot.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-6 mb-3">
            <span className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-faint">Hot leads — yours</span>
            <span className="text-[10.5px] font-bold text-muted bg-surface border border-border px-2 py-0.5 rounded-full">{hot.length}</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {hot.map((l) => {
              const d = daysSince(l.last_touched_at as string | null);
              const quiet = d != null && d >= 5;
              return (
                <div key={l.id} className="min-w-[210px] flex-shrink-0 rounded-[15px] p-3.5 cursor-pointer transition-transform hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(180deg,#FFF8F9,#fff)', border: '1px solid #FBD0D9' }}>
                  <div className="flex items-center gap-2.5">
                    <div className="av" style={{ background: avatarColor(l.id), width: 32, height: 32, borderRadius: 9, fontSize: 11 }}>{initials(l.full_name)}</div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold truncate">{l.full_name}</div>
                      <div className="text-[10.5px] text-faint">{STAGE_META[l.stage]?.label || l.stage}</div>
                    </div>
                  </div>
                  <div className="text-[10.5px] text-muted mt-2.5">{d == null ? 'Never contacted' : `${d}d since contact`}</div>
                  {quiet && <div className="text-[10px] font-bold mt-1.5" style={{ color: '#E11D48' }}>Going quiet — call today</div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* queue */}
      <div className="flex items-center gap-2 mt-6 mb-3 flex-wrap">
        <span className="text-[11px] font-extrabold tracking-[0.09em] uppercase text-faint">Cold queue</span>
        <span className="text-[10.5px] font-bold text-muted bg-surface border border-border px-2 py-0.5 rounded-full">{pending.length} left</span>
        <div className="ml-auto flex gap-1.5">
          {([['all', 'All'], ['best', 'Best first'], ['rolled', 'Rolled over']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn('text-[11px] font-bold px-3 py-1.5 rounded-full border-[1.5px] transition-colors',
                filter === k ? 'bg-ink border-ink text-white' : 'bg-surface border-border text-muted hover:text-ink-2')}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {rows === null ? (
        <div className="py-16 text-center text-[13px] text-muted"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Building today&rsquo;s queue…</div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center">
          <Inbox className="w-8 h-8 mx-auto text-faint mb-3" />
          <div className="text-[14px] font-semibold">{total === 0 ? 'No queue for today' : 'All done — queue cleared'}</div>
          <div className="text-[12.5px] text-muted mt-1">
            {total === 0 ? 'No leads have been assigned to you today. An admin needs to set your daily quota in Lead Engine and press Generate.' : 'Everything assigned to you today has been worked.'}
          </div>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
          {visible.map((r) => {
            const l = r.lead;
            const d = daysSince(l.last_touched_at as string | null);
            const st = scoreTone(l.ai_score);
            const temp = (l.ai_score ?? 0) >= 70 ? '#E11D48' : (l.ai_score ?? 0) >= 40 ? '#F59E0B' : 'transparent';
            const done = r.status === 'done';
            return (
              <div key={r.id} onClick={() => openLead(r)}
                className={cn('relative rounded-[15px] border border-border bg-surface p-3.5 transition-all',
                  done ? 'opacity-45' : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg')}
                style={{ boxShadow: done ? undefined : undefined }}>
                <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r" style={{ background: done ? 'transparent' : temp }} />
                <div className="flex items-center gap-2.5">
                  <div className="av flex-shrink-0" style={{ background: avatarColor(l.id), width: 32, height: 32, borderRadius: 9, fontSize: 11 }}>{initials(l.full_name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-[13px] font-bold leading-tight truncate', done && 'line-through text-faint')}>{l.full_name}</div>
                    <div className="text-[10.5px] text-faint truncate">{(l.visa_type || 'Visa').toUpperCase()} · {l.source || 'unknown'}</div>
                  </div>
                  {!done && l.ai_score != null && (
                    <div className="flex-shrink-0 w-[30px] h-[30px] rounded-[9px] flex flex-col items-center justify-center" style={{ background: st.bg, color: st.fg }}>
                      <span className="text-[12px] font-black leading-none">{l.ai_score}</span>
                      <span className="text-[6.5px] font-extrabold tracking-wider opacity-70">AI</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-3">
                  <span className="text-[10px] font-extrabold px-2 py-[3px] rounded-md"
                    style={d != null && d >= 15 ? { background: '#FFF1F3', color: '#E11D48' } : { background: 'hsl(var(--surface-2))', color: 'hsl(var(--muted))' }}>
                    {d == null ? 'New' : `${d}d`}
                  </span>
                  {r.rolled_over && !done && (
                    <span className="text-[9px] font-extrabold px-[7px] py-[3px] rounded-md" style={{ background: '#FFF8EC', color: '#B45309' }}>ROLLED</span>
                  )}
                  {done ? (
                    <span className="ml-auto text-[9.5px] font-extrabold px-2 py-[3px] rounded-md" style={{ background: '#ECFDF5', color: '#059669' }}>
                      <Check className="w-2.5 h-2.5 inline mr-0.5" strokeWidth={3} />DONE
                    </span>
                  ) : (
                    <span className="ml-auto text-[11px] text-faint flex items-center gap-1">Work <ArrowRight className="w-3 h-3" /></span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── work drawer ── */}
      {active && (
        <>
          <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(15,17,21,.45)', backdropFilter: 'blur(3px)' }} onClick={() => setActive(null)} />
          <aside className="fixed top-0 right-0 bottom-0 z-[70] bg-surface border-l border-border flex flex-col" style={{ width: 'min(440px,94vw)' }}>
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="av" style={{ background: avatarColor(active.lead.id), width: 36, height: 36, borderRadius: 11, fontSize: 12 }}>{initials(active.lead.full_name)}</div>
              <div className="min-w-0">
                <div className="text-[15px] font-bold truncate">{active.lead.full_name}</div>
                <div className="text-[11.5px] text-faint">{(active.lead.visa_type || 'Visa').toUpperCase()} · {active.lead.attempt_count || 0} previous attempts</div>
              </div>
              <button onClick={() => setActive(null)} className="ml-auto p-1.5 text-faint hover:text-ink"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* contact */}
              <div className="flex gap-2">
                {active.lead.phone && (
                  <a href={`tel:${active.lead.phone}`} className="flex-1 text-[12.5px] font-bold py-2.5 rounded-xl border border-border text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                    <Phone className="w-3.5 h-3.5 inline mr-1.5" />Call
                  </a>
                )}
                {active.lead.phone && (
                  <a href={`https://wa.me/${active.lead.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer"
                    className="flex-1 text-[12.5px] font-bold py-2.5 rounded-xl border border-border text-center hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
                    <MessageCircle className="w-3.5 h-3.5 inline mr-1.5" />WhatsApp
                  </a>
                )}
                {active.lead.email && (
                  <a href={`mailto:${active.lead.email}`} className="flex-1 text-[12.5px] font-bold py-2.5 rounded-xl border border-border text-center hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                    <Mail className="w-3.5 h-3.5 inline mr-1.5" />Email
                  </a>
                )}
              </div>

              {/* AI brief */}
              {active.lead.ai_brief && (
                <>
                  <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mt-5 mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" style={{ color: '#7C3AED' }} />
                    Claude&rsquo;s brief {active.lead.ai_score != null && `· scored ${active.lead.ai_score}/100`}
                  </div>
                  <div className="rounded-xl px-3.5 py-3 text-[12.5px] leading-relaxed" style={{ background: '#F5F3FF', border: '1px solid #E5DEFF', color: '#4C1D95' }}>
                    {active.lead.ai_brief}
                  </div>
                </>
              )}

              {/* status — applies everywhere */}
              <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mt-5 mb-2">Status</div>
              <select value={active.lead.stage} onChange={(e) => changeStage(active.lead_id, e.target.value)}
                className="w-full text-[13px] font-medium border border-border rounded-xl px-3 py-2.5 bg-surface outline-none focus:border-indigo-400">
                {Object.entries(STAGE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
              <div className="text-[10.5px] text-faint mt-1.5">Changing this updates the lead everywhere in the CRM.</div>

              {/* details */}
              <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mt-5 mb-2">Details</div>
              <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[12.5px] leading-[1.8] text-ink-2">
                <div><span className="text-faint inline-block min-w-[78px]">Source</span>{active.lead.source || '—'}</div>
                <div><span className="text-faint inline-block min-w-[78px]">Phone</span>{active.lead.phone || '—'}</div>
                <div><span className="text-faint inline-block min-w-[78px]">Last note</span>{active.lead.last_note || '—'}</div>
              </div>

              {/* note */}
              <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mt-5 mb-2">Add a note (optional)</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened on this call?"
                className="w-full text-[12.5px] border border-border rounded-xl px-3 py-2.5 bg-surface resize-none outline-none focus:border-indigo-400" />

              {/* outcomes */}
              <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-faint mt-5 mb-2">Outcome — required to finish</div>
              <div className="flex flex-col gap-2">
                {OUTCOMES.map(({ key, label, desc, Icon, tone, bg }) => (
                  <button key={key} disabled={busy} onClick={() => submitOutcome(key)}
                    className="text-left text-[13px] font-semibold px-3.5 py-3 rounded-xl border-[1.5px] border-border bg-surface hover:translate-x-0.5 transition-all disabled:opacity-50 flex items-center gap-2.5"
                    style={{ borderColor: undefined }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = tone; e.currentTarget.style.background = bg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; }}>
                    <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: tone }} />
                    </span>
                    <span>
                      <span className="block">{label}</span>
                      <span className="block text-[10.5px] text-faint font-medium">{desc}</span>
                    </span>
                  </button>
                ))}
              </div>

              {/* Claude's draft after "not now" */}
              {draft && (
                <div className="mt-4 rounded-xl px-3.5 py-3" style={{ background: '#F5F3FF', border: '1px solid #E5DEFF' }}>
                  <div className="text-[9.5px] font-extrabold tracking-[0.08em] mb-2 flex items-center gap-1.5" style={{ color: '#7C3AED' }}>
                    <Sparkles className="w-3 h-3" /> CLAUDE DRAFTED A FOLLOW-UP
                  </div>
                  <div className="text-[12.5px] leading-relaxed bg-surface rounded-lg px-3 py-2.5" style={{ border: '1px solid #E5DEFF', color: '#4C1D95' }}>{draft}</div>
                  <div className="flex gap-2 mt-2.5">
                    {active.lead.phone && (
                      <a href={`https://wa.me/${active.lead.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(draft)}`} target="_blank" rel="noreferrer"
                        className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: '#7C3AED' }}>Send on WhatsApp</a>
                    )}
                    <button onClick={() => { setActive(null); setDraft(null); void load(); }}
                      className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg bg-surface" style={{ color: '#7C3AED', border: '1px solid #E5DEFF' }}>Done</button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
