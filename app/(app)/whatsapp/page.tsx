'use client';

// =============================================================================
// WHATSAPP INBOX — Stage 1.
//
// One screen, three collapsible columns:
//   conversation list  ·  conversation  ·  lead panel
// Each hides independently; Focus (F) hides all of them so the conversation
// gets the whole screen.
//
// Behaviour matches migration 040:
//   • a reply FLAGS the conversation, it never stops the sequence
//   • STOP / NO suppresses the number and junks the lead, permanently
//   • free-form is only possible inside the 24-hour window; the server
//     enforces it too, this UI just makes the rule visible
//
// Messages arrive over Supabase realtime, so nobody has to refresh.
// =============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Clock, Lock, Check, CheckCheck, AlertCircle, Zap, Paperclip, Smile,
  FileText, ChevronDown, PanelLeft, PanelRight, Columns, Maximize2, Minimize2,
  ExternalLink, Crown, Loader2, Bot, Pause, Play, Square, ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { initials, avatarColor, cn } from '@/lib/utils';
import { toast } from 'sonner';
import LeadPanel, { type SeqState } from '@/components/whatsapp/lead-panel';
import TemplatePicker from '@/components/whatsapp/template-picker';
import {
  formatLeft, windowLeftMs, windowState, WINDOW_META,
  type WaConversation, type WaMessage, type WaTemplate, type WaSettings, type WaStats,
} from '@/lib/whatsapp/types';

type Filter = 'all' | 'unread' | 'attention' | 'open' | 'failed';
const FILTERS: [Filter, string][] = [
  ['all', 'All'], ['unread', 'Unread'], ['attention', 'Needs reply'], ['open', 'Open'], ['failed', 'Failed'],
];

const GROUP_MS = 5 * 60_000;

function fmtTime(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ap}`;
}
function fmtRel(iso: string | null) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function dayLabel(iso: string) {
  const d = new Date(iso), t = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}
const firstName = (n: string) => n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

export default function WhatsAppPage() {
  const app = useApp();
  const { workspace, leads, memberNameById } = app;
  const supabase = useMemo(() => createClient(), []);

  const [convs, setConvs] = useState<WaConversation[]>([]);
  const [msgs, setMsgs] = useState<WaMessage[]>([]);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [stats, setStats] = useState<WaStats | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'info' | 'activity'>('info');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  // collapse state — narrow screens start with the panel folded away
  const [hideList, setHideList] = useState(false);
  const [hidePanel, setHidePanel] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const active = convs.find((c) => c.id === activeId) || null;
  const activeLead = active?.lead_id ? leads.find((l) => l.id === active.lead_id) : undefined;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1440) setHidePanel(true);
  }, []);

  // The window countdown has to move on its own — but a blanket 1-second
  // setState re-rendered the entire page (up to 300 list rows plus the whole
  // thread) once a second, forever, on an idle screen. That was the sluggishness.
  //
  // Now the clock only runs when something is actually counting down, and only
  // as fast as the display needs: seconds are visible below one hour, so tick
  // every second there and every 30 seconds otherwise. Nothing open, no timer.
  const needSeconds = convs.some((c) => {
    const left = windowLeftMs(c.last_inbound_at);
    return left > 0 && left < 3600_000;
  });
  const anyOpen = convs.some((c) => windowLeftMs(c.last_inbound_at) > 0);
  useEffect(() => {
    if (!anyOpen) return;
    const t = setInterval(() => setTick((n) => n + 1), needSeconds ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [anyOpen, needSeconds]);

  // ── data ──────────────────────────────────────────────────────────────────
  // loadError is deliberately separate from `loading`. A spinner that never
  // resolves, or an empty state that says "no conversations yet" when the query
  // actually failed, is worse than an error — it sends you looking in the wrong
  // place. Every failure path below sets this and the list renders it.
  const loadConvs = useCallback(async () => {
    const { data, error } = await supabase.rpc('whatsapp_conversations_list', {
      p_workspace_id: workspace.id, p_limit: 300,
    });
    if (error) { setLoadError(error.message); return; }
    setLoadError(null);
    setConvs((data || []) as WaConversation[]);
  }, [supabase, workspace.id]);

  const loadStats = useCallback(async () => {
    const { data } = await supabase.rpc('whatsapp_stats', { p_workspace_id: workspace.id });
    if (data) setStats(data as WaStats);
  }, [supabase, workspace.id]);

  // One parallel batch, not two sequential ones. The old code awaited templates
  // and settings, THEN awaited conversations and stats — two full round trips to
  // Supabase before the first pixel of real data. On a Netlify cold start that
  // is why the connection pill sat on "Not connected" for seconds before
  // snapping into place. Four requests, one wait.
  const reload = useCallback(async () => {
    const [tRes, sRes] = await Promise.all([
      supabase.from('whatsapp_templates').select('*')
        .eq('workspace_id', workspace.id).eq('active', true).order('track').order('step_no'),
      supabase.from('whatsapp_settings').select('*').eq('workspace_id', workspace.id).maybeSingle(),
      loadConvs(),
      loadStats(),
    ]);
    setTemplates((tRes.data || []) as WaTemplate[]);
    setSettings((sRes.data || null) as WaSettings | null);
    if (sRes.error) setLoadError(sRes.error.message);
  }, [supabase, workspace.id, loadConvs, loadStats]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await reload();
      } catch (e) {
        // A thrown error here used to leave the spinner turning forever.
        if (alive) setLoadError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reload]);

  // first conversation once the list arrives
  useEffect(() => {
    if (!activeId && convs.length) setActiveId(convs[0].id);
  }, [convs, activeId]);

  // thread for the selected conversation
  useEffect(() => {
    if (!activeId) { setMsgs([]); return; }
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc('whatsapp_thread', {
        p_conversation_id: activeId, p_limit: 400,
      });
      if (!alive) return;
      if (error) { toast.error(`Couldn't load the thread: ${error.message}`); return; }
      setMsgs((data || []) as WaMessage[]);
      await supabase.rpc('whatsapp_mark_read', { p_conversation_id: activeId });
      setConvs((cs) => cs.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c)));
    })();
    return () => { alive = false; };
  }, [activeId, supabase]);

  // Read the selected conversation through a ref so the realtime channel does
  // not need activeId in its dependency list. It previously did, which meant
  // every click in the list tore down the websocket and opened a new one —
  // slow, and events landing during the swap were lost.
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // A burst of delivery receipts used to fire two queries per receipt. Sending
  // to 50 leads meant 100 round trips in a few seconds and a list that visibly
  // thrashed. Coalesce into one refresh per 250ms instead.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { loadConvs(); loadStats(); }, 250);
  }, [loadConvs, loadStats]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // realtime: new messages and status changes, no refresh required
  useEffect(() => {
    const ch = supabase
      .channel(`wa-${workspace.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages', filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const row = payload.new as WaMessage | undefined;
          if (!row) return;
          if (row.conversation_id === activeIdRef.current) {
            setMsgs((prev) => {
              const i = prev.findIndex((m) => m.id === row.id);
              if (i === -1) return [...prev, row];
              // Same row, same status — skip the state write so React does not
              // re-render the thread for a no-op update.
              if (prev[i].status === row.status && prev[i].body === row.body) return prev;
              const next = [...prev]; next[i] = row; return next;
            });
          }
          queueRefresh();
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `workspace_id=eq.${workspace.id}` },
        () => queueRefresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, workspace.id, queueRefresh]);

  // stick to the bottom as the thread grows
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, activeId]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '[') { e.preventDefault(); setHideList((v) => !v); }
      if (e.key === ']') { e.preventDefault(); setHidePanel((v) => !v); }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const all = hideList && hidePanel;
        setHideList(!all); setHidePanel(!all);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hideList, hidePanel]);

  // ── actions ───────────────────────────────────────────────────────────────
  async function send(body: string, template?: { code: string; values: Record<string, string> }) {
    if (!active) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: active.id,
          ...(template ? { templateCode: template.code, values: template.values } : { body }),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.detail || json.reason || 'Send failed');
      } else {
        toast.success(json.dryRun ? 'Sent — dry-run, nothing left the CRM' : 'Sent');
        setDrafts((d) => ({ ...d, [active.id]: '' }));
        if (textarea.current) { textarea.current.value = ''; textarea.current.style.height = 'auto'; }
      }
      const { data } = await supabase.rpc('whatsapp_thread', { p_conversation_id: active.id, p_limit: 400 });
      setMsgs((data || []) as WaMessage[]);
      loadConvs(); loadStats();
    } catch (e) {
      toast.error(`Send failed: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  async function toggleClosed() {
    if (!active) return;
    const next = active.status === 'open' ? 'closed' : 'open';
    await supabase.rpc('whatsapp_set_conversation_status', { p_conversation_id: active.id, p_status: next });
    toast.success(next === 'closed' ? 'Conversation closed' : 'Conversation reopened');
    loadConvs();
  }

  function seqAction(a: 'pause' | 'resume' | 'stop') {
    // Sequences land in 041. The control is here now so the rule — a reply never
    // stops anything, a human does — is visible from day one.
    toast(`Sequence ${a === 'pause' ? 'pause' : a === 'resume' ? 'resume' : 'stop'} arrives with sequences (041)`);
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return convs.filter((c) => {
      if (filter === 'unread' && !c.unread_count) return false;
      if (filter === 'attention' && !c.needs_attention) return false;
      if (filter === 'open' && !c.window_open) return false;
      if (filter === 'failed' && !c.suppressed) return false;
      if (!q) return true;
      return c.lead_name.toLowerCase().includes(q)
        || c.phone_e164.includes(q.replace(/\D/g, ''))
        || (c.last_preview || '').toLowerCase().includes(q);
    });
  }, [convs, filter, query]);

  const counts = useMemo(() => ({
    all: convs.length,
    unread: convs.filter((c) => c.unread_count > 0).length,
    attention: convs.filter((c) => c.needs_attention).length,
    open: convs.filter((c) => c.window_open).length,
    failed: convs.filter((c) => c.suppressed).length,
  }), [convs]);

  const groups = useMemo(() => {
    const out: Array<{ kind: 'day'; label: string } | { kind: 'grp'; dir: 'in' | 'out'; items: WaMessage[] }> = [];
    let lastDay = '';
    let cur: { kind: 'grp'; dir: 'in' | 'out'; items: WaMessage[] } | null = null;
    for (const m of msgs) {
      const d = dayLabel(m.created_at);
      if (d !== lastDay) { out.push({ kind: 'day', label: d }); lastDay = d; cur = null; }
      const prev = cur?.items[cur.items.length - 1];
      const near = prev && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() <= GROUP_MS;
      if (cur && cur.dir === m.direction && near) { cur.items.push(m); continue; }
      cur = { kind: 'grp', dir: m.direction, items: [m] };
      out.push(cur);
    }
    return out;
  }, [msgs]);

  const wState = active ? windowState(active.last_inbound_at) : 'shut';
  const wMeta = WINDOW_META[wState];
  const wLeft = active ? windowLeftMs(active.last_inbound_at) : 0;
  const focusOn = hideList && hidePanel;

  const seqState: SeqState = active?.suppressed ? 'stopped' : 'none';

  // memberNameById returns "You" for the signed-in user — correct as a label, but
  // it makes a nonsense avatar ("YO"), so fall back to the real name.
  const senderName = useCallback((id: string | null) => {
    if (!id) return 'Migrizo';
    const n = memberNameById(id);
    return !n || n === 'You' ? (app.user.name || 'Migrizo') : n;
  }, [memberNameById, app.user.name]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-56px)] flex-col bg-[#EEF0F4]">
      {/* top bar */}
      <div className="flex h-[58px] flex-shrink-0 items-center gap-3 border-b border-[#E8EAF0] bg-white px-5">
        <h1 className="m-0 text-[16px] font-semibold tracking-[-.025em]">WhatsApp</h1>
        <span className="text-[12.6px] text-muted">
          {stats ? `${stats.conversations} conversations · ${stats.unread} unread` : '—'}
        </span>
        <div className="ml-auto flex items-center gap-[9px]">
          <Toggle on={hideList} onClick={() => setHideList((v) => !v)} title="Conversation list  ([)"><Columns className="h-[18px] w-[18px]" /></Toggle>
          <Toggle on={hidePanel} onClick={() => setHidePanel((v) => !v)} title="Lead panel  (])"><PanelRight className="h-[18px] w-[18px]" /></Toggle>
          <button
            onClick={() => { const all = focusOn; setHideList(!all); setHidePanel(!all); }}
            title="Focus mode  (F)"
            className={cn(
              'inline-flex flex-shrink-0 items-center gap-[7px] rounded-full border px-[13px] py-[7px] text-[12.4px] font-semibold transition',
              focusOn ? 'border-ink bg-ink text-white' : 'border-[#DDE0E9] bg-white text-ink-2 hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44]'
            )}
          >
            {focusOn ? <Minimize2 className="h-[14px] w-[14px]" /> : <Maximize2 className="h-[14px] w-[14px]" />}
            {focusOn ? 'Exit focus' : 'Focus'}
          </button>
          <span className="h-[22px] w-px bg-[#E8EAF0]" />
          <ConnectionPill settings={settings} loading={loading} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* conversation list */}
        <div className={cn(
          'flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-r bg-white transition-[width,border-width] duration-200 ease-out',
          hideList ? 'w-0 border-r-0' : 'w-[330px] border-[#E8EAF0]'
        )}>
          <div className="w-[330px] flex-shrink-0 border-b border-[#E8EAF0] px-[14px] pb-[11px] pt-[14px]">
            <div className="relative mb-[10px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, number or message…"
                className="w-full rounded-[10px] border border-[#DDE0E9] bg-[#F5F6F9] py-[9.5px] pl-[35px] pr-3 text-[13.2px] outline-none transition focus:border-[#2FB463] focus:bg-white focus:shadow-[0_0_0_3px_#EDFAF1]"
              />
            </div>
            <div className="flex flex-wrap gap-[6px]">
              {FILTERS.map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={cn(
                    'inline-flex items-center gap-[5px] rounded-full border px-[10px] py-[5px] text-[11.6px] font-medium transition',
                    filter === k ? 'border-[#25A25A] bg-[#25A25A] text-white' : 'border-[#DDE0E9] bg-[#F5F6F9] text-ink-2 hover:bg-[#EDEFF3]'
                  )}>
                  {l}<b className="text-[10.4px] font-bold opacity-60">{counts[k]}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="w-[330px] flex-1 overflow-y-auto p-[6px]">
            {loading && <div className="p-8 text-center text-[13px] text-muted"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>}

            {/* A failed query must never be dressed up as an empty inbox. */}
            {!loading && loadError && (
              <div className="m-[10px] rounded-xl border border-[#F8D6D6] bg-[#FEEFEF] p-[14px]">
                <div className="mb-[7px] flex items-center gap-[7px] text-[13px] font-semibold text-[#B02B2B]">
                  <AlertCircle className="h-[15px] w-[15px] flex-shrink-0" />
                  Couldn&apos;t load conversations
                </div>
                <p className="m-0 mb-[11px] break-words text-[11.8px] leading-[1.55] text-[#8E2A2A]">
                  {loadError}
                </p>
                <button
                  onClick={async () => {
                    setRetrying(true);
                    try { await reload(); } finally { setRetrying(false); }
                  }}
                  disabled={retrying}
                  className="w-full rounded-lg border border-[#E8B4B4] bg-white px-3 py-2 text-[12.4px] font-semibold text-[#B02B2B] transition hover:bg-[#FEEFEF] disabled:opacity-50"
                >
                  {retrying ? 'Retrying…' : 'Try again'}
                </button>
                <a
                  href="/api/whatsapp/diagnose"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-[7px] block text-center text-[11.4px] font-medium text-[#8E2A2A] underline"
                >
                  Run the full diagnostic
                </a>
              </div>
            )}

            {!loading && !loadError && filtered.length === 0 && (
              <p className="px-[18px] py-10 text-center text-[13px] text-muted">
                {convs.length === 0 ? 'No conversations yet. They appear here the moment a lead replies.' : 'Nothing matches that filter.'}
              </p>
            )}
            {filtered.map((c) => {
              const st = windowState(c.last_inbound_at);
              const meta = WINDOW_META[st];
              return (
                <button key={c.id} onClick={() => setActiveId(c.id)}
                  className={cn(
                    'relative mb-px flex w-full gap-3 rounded-xl border p-[12px_11px] text-left transition',
                    activeId === c.id ? 'border-[#D7F3E1] bg-[#EDFAF1]' : 'border-transparent hover:bg-[#F5F6F9]'
                  )}>
                  <span className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
                        style={{ background: avatarColor(c.lead_name) }}>
                    {initials(c.lead_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn('truncate text-[13.8px] tracking-[-.015em]', c.unread_count ? 'font-bold' : 'font-semibold')}>
                        {c.lead_name}
                      </span>
                      <span className="ml-auto flex-shrink-0 text-[10.6px] font-medium text-faint">{fmtRel(c.last_message_at)}</span>
                    </span>
                    <span className="mt-[3px] flex items-center gap-2">
                      <span className={cn('flex-1 truncate text-[12.4px] leading-[1.4]', c.unread_count ? 'text-ink-2' : 'text-muted')}>
                        {c.last_direction === 'out' ? 'You: ' : ''}{c.last_preview || '—'}
                      </span>
                      {c.unread_count > 0 && (
                        <span className="flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-[#25A25A] px-[5px] text-[10px] font-bold text-white">
                          {c.unread_count}
                        </span>
                      )}
                    </span>
                    <span className="mt-[7px] flex items-center gap-[7px] text-[10.8px] font-medium text-faint">
                      {c.needs_attention && <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full bg-[#F0A020]" />}
                      <span className="inline-flex items-center gap-[5px]" style={{ color: meta.colour }}>
                        <span className="h-[6px] w-[6px] rounded-full" style={{ background: meta.colour }} />
                        {c.suppressed ? 'Opted out' : meta.label}
                      </span>
                      <span className="opacity-40">·</span>
                      <span>{memberNameById(c.owner_id)}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* conversation + panel */}
        <div className="flex min-w-0 flex-1 p-[14px]">
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#E8EAF0] bg-white shadow-[0_1px_2px_rgba(20,24,40,.06)]">
            {!active ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
                <FileText className="h-8 w-8 text-faint" />
                <b className="text-[14.5px] font-semibold text-ink-2">No conversation selected</b>
                <p className="m-0 max-w-[280px] text-center text-[12.8px] leading-[1.6]">
                  Pick someone on the left, or wait for the first reply to land.
                </p>
              </div>
            ) : (
              <>
                {/* header */}
                <div className="flex flex-shrink-0 items-center gap-[13px] border-b border-[#E8EAF0] bg-white px-[18px] py-[15px]">
                  <span className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
                        style={{ background: avatarColor(active.lead_name) }}>
                    {initials(active.lead_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold leading-[1.25] tracking-[-.02em]">{active.lead_name}</div>
                    <div className="mt-[3px] flex items-center gap-[6px] text-[12.8px] text-ink-2">
                      <Crown className="h-[14px] w-[14px] text-[#EAB308]" />
                      {memberNameById(active.owner_id)}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-[9px]">
                    <span className="inline-flex flex-shrink-0 items-center gap-[7px] whitespace-nowrap rounded-full border px-3 py-[6px] text-[11.8px] font-semibold"
                          style={{
                            background: wState === 'shut' ? '#EDEFF3' : wState === 'open' ? '#EDFAF1' : wState === 'warn' ? '#FEF6E6' : '#FEEFEF',
                            borderColor: wState === 'shut' ? '#DDE0E9' : wState === 'open' ? '#D7F3E1' : wState === 'warn' ? '#F8E2B8' : '#F8D6D6',
                            color: wMeta.colour,
                          }}>
                      {wState === 'shut' ? <Lock className="h-[13px] w-[13px]" /> : <Clock className="h-[13px] w-[13px]" />}
                      {wState === 'shut' ? 'Window shut' : `Window ${wMeta.label.toLowerCase()}`}
                      {wState !== 'shut' && <span className="min-w-[52px] text-right tabular-nums">{formatLeft(wLeft)}</span>}
                    </span>
                    <button onClick={toggleClosed}
                      className={cn('rounded-full border px-3 py-[7px] text-[12.4px] font-semibold transition',
                        active.status === 'closed'
                          ? 'border-[#DDE0E9] bg-white text-ink-2 hover:bg-[#F5F6F9]'
                          : 'border-[#2FB463] bg-white text-[#1B7A44] hover:bg-[#EDFAF1]')}>
                      {active.status === 'closed' ? 'Reopen' : 'Mark as Closed'}
                    </button>
                    {active.lead_id && (
                      <a href={`/leads?lead=${active.lead_id}`} title="Open lead record"
                         className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#E8EAF0] text-muted transition hover:bg-[#F5F6F9] hover:text-ink">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                {/* messages */}
                <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-[#F7F8FA] px-[26px] pb-4 pt-2">
                  {groups.map((g, gi) =>
                    g.kind === 'day' ? (
                      <div key={`d${gi}`} className="my-[18px] flex items-center gap-[14px]">
                        <span className="flex-1 border-t border-dashed border-[#DDE0E9]" />
                        <span className="rounded-full bg-[#EDEFF3] px-[15px] py-[5px] text-[11.5px] font-semibold text-ink-2">{g.label}</span>
                        <span className="flex-1 border-t border-dashed border-[#DDE0E9]" />
                      </div>
                    ) : (
                      <div key={`g${gi}`} className="mb-5">
                        {g.items.map((m, i) => (
                          <MessageLine
                            key={m.id}
                            m={m}
                            first={i === 0}
                            who={m.direction === 'in' ? active.lead_name : senderName(m.sent_by)}
                            colour={m.direction === 'in' ? avatarColor(active.lead_name) : '#4F46E5'}
                          />
                        ))}
                      </div>
                    )
                  )}
                  {msgs.length === 0 && (
                    <p className="py-14 text-center text-[13px] text-muted">No messages in this conversation yet.</p>
                  )}
                </div>

                {/* composer */}
                <div className="flex-shrink-0 bg-white px-[18px] pb-4 pt-[14px]">
                  {active.suppressed ? (
                    <div className="flex items-center gap-3 rounded-xl border border-[#F8D6D6] bg-[#FEEFEF] px-4 py-[15px]">
                      <ShieldCheck className="h-5 w-5 flex-shrink-0 text-[#B02B2B]" />
                      <div className="text-[12.6px] leading-[1.55] text-[#B02B2B]">
                        <b className="font-bold">This number opted out.</b> It is suppressed permanently and the lead sits in Junk.
                        Nothing can be sent here again.
                      </div>
                    </div>
                  ) : wState === 'shut' ? (
                    <div className="relative flex items-center gap-[14px] overflow-hidden rounded-xl border border-[#DDE0E9] bg-[#F5F6F9] px-[17px] py-[15px] before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:bg-[#F0A020] before:content-['']">
                      <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] border border-[#F8E2B8] bg-[#FEF6E6]">
                        <Lock className="h-[18px] w-[18px] text-[#A25D07]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <b className="mb-[3px] block text-[13.4px] font-semibold">Free-form messages are locked</b>
                        <p className="m-0 text-[12.4px] leading-[1.55] text-muted">
                          <em className="font-semibold not-italic text-ink-2">{firstName(active.lead_name)}</em>
                          {active.last_inbound_at ? ' last replied more than 24 hours ago' : ' has never replied'}, so WhatsApp
                          only allows a <em className="font-semibold not-italic text-ink-2">Meta-approved template</em>. The moment
                          they reply, the window reopens for 24 hours.
                        </p>
                      </div>
                      <button onClick={() => setPickerOpen(true)}
                        className="flex flex-shrink-0 items-center gap-2 rounded-[9px] bg-[#25A25A] px-[15px] py-[9px] text-[13.2px] font-semibold text-white transition hover:bg-[#1B7A44]">
                        <FileText className="h-[15px] w-[15px]" /> Choose a template
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-[#DDE0E9] bg-white transition focus-within:border-[#2FB463] focus-within:shadow-[0_0_0_3px_#EDFAF1]">
                      <textarea
                        ref={textarea}
                        rows={1}
                        defaultValue={drafts[active.id] || ''}
                        placeholder="Type a message here…"
                        onInput={(e) => {
                          const el = e.currentTarget;
                          el.style.height = 'auto';
                          el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
                          setDrafts((d) => ({ ...d, [active.id]: el.value }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            const v = e.currentTarget.value.trim();
                            if (v && !sending) send(v);
                          }
                        }}
                        className="block max-h-[130px] w-full resize-none border-0 px-[17px] pb-2 pt-[14px] text-[14.4px] leading-[1.6] outline-none"
                      />
                      <div className="flex items-center gap-[3px] px-3 pb-[10px] pt-2">
                        <button onClick={() => setPickerOpen(true)}
                          className="inline-flex items-center gap-[6px] rounded-lg px-[10px] py-[7px] text-[12.4px] font-semibold text-muted transition hover:bg-[#F5F6F9] hover:text-ink-2">
                          <Zap className="h-[17px] w-[17px]" /> Template
                        </button>
                        <button onClick={() => toast('Attachments arrive in Stage 2')}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-[#F5F6F9] hover:text-ink-2">
                          <Paperclip className="h-[17px] w-[17px]" />
                        </button>
                        <button onClick={() => toast('Emoji picker arrives in Stage 2')}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-[#F5F6F9] hover:text-ink-2">
                          <Smile className="h-[17px] w-[17px]" />
                        </button>
                        <span className="ml-auto whitespace-nowrap pr-3 text-[11.4px] text-faint">
                          Free-form allowed for <b className="tabular-nums text-muted">{formatLeft(wLeft)}</b>
                        </span>
                        <button
                          disabled={sending || !(drafts[active.id] || '').trim()}
                          onClick={() => { const v = (drafts[active.id] || '').trim(); if (v) send(v); }}
                          className="inline-flex flex-shrink-0 items-center gap-[7px] rounded-full bg-[#25A25A] px-[22px] py-[9px] text-[13.2px] font-semibold text-white transition hover:bg-[#1B7A44] disabled:bg-[#A8D9BC]"
                        >
                          {sending ? <Loader2 className="h-[15px] w-[15px] animate-spin" /> : null}
                          Send
                        </button>
                      </div>
                    </div>
                  )}
                  {settings?.dry_run && (
                    <p className="m-0 mt-[10px] flex items-center gap-[6px] text-[11.4px] text-[#A25D07]">
                      <Bot className="h-[13px] w-[13px]" />
                      Dry-run mode is on — messages are logged but never reach WhatsApp.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {active && (
            <LeadPanel
              conv={active}
              lead={activeLead}
              ownerName={memberNameById(active.owner_id)}
              tab={panelTab}
              onTab={setPanelTab}
              seqState={seqState}
              seqLabel="WhatsApp sequence"
              onSeq={seqAction}
              onMail={() => toast('Opens the email composer')}
              onCall={() => toast('Click-to-call arrives in Stage 3')}
              collapsed={hidePanel}
            />
          )}
        </div>
      </div>

      <TemplatePicker
        open={pickerOpen}
        templates={templates}
        leadFirstName={active ? firstName(active.lead_name) : ''}
        windowShut={wState === 'shut'}
        sending={sending}
        onClose={() => setPickerOpen(false)}
        onSend={(t, values) => { setPickerOpen(false); send('', { code: t.code, values }); }}
      />
    </div>
  );
}

// ── bits ────────────────────────────────────────────────────────────────────
function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className={cn('flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] border transition',
        on ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]' : 'border-transparent text-muted hover:border-[#E8EAF0] hover:bg-[#F5F6F9] hover:text-ink')}>
      {children}
    </button>
  );
}

// While settings are in flight this used to render "Not connected", which reads
// as a real failure rather than "we don't know yet". A neutral checking state
// costs one prop and stops the pill lying during a cold start.
function ConnectionPill({ settings, loading }: { settings: WaSettings | null; loading: boolean }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-[7px] rounded-full border border-[#DDE0E9] bg-[#F5F6F9] px-3 py-[6px] text-[11.6px] font-semibold text-muted">
        <Loader2 className="h-[11px] w-[11px] animate-spin" />
        Checking…
      </span>
    );
  }
  const ok = settings?.connected && !settings?.sending_paused;
  return (
    <span className={cn('inline-flex items-center gap-[7px] rounded-full border px-3 py-[6px] text-[11.6px] font-semibold',
      ok ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]' : 'border-[#F8E2B8] bg-[#FEF6E6] text-[#A25D07]')}>
      <span className={cn('h-[6px] w-[6px] rounded-full', ok ? 'bg-[#2FB463]' : 'bg-[#F0A020]')} />
      {settings?.display_number || 'Not connected'}
      {settings?.quality_rating ? ` · ${settings.quality_rating}` : ''}
      {settings?.sending_paused ? ' · PAUSED' : ''}
    </span>
  );
}

function StatusTick({ status }: { status: WaMessage['status'] }) {
  if (status === 'queued') return <Clock className="h-[13px] w-[13px] text-[#BFC3D2]" />;
  if (status === 'sent') return <Check className="h-[17px] w-[17px] text-[#A6ABBD]" />;
  if (status === 'delivered') return <CheckCheck className="h-[17px] w-[17px] text-[#A6ABBD]" />;
  if (status === 'read') return <CheckCheck className="h-[17px] w-[17px] text-[#2E90FA]" />;
  if (status === 'failed') return <AlertCircle className="h-[14px] w-[14px] text-[#E85555]" />;
  return null;
}

function MessageLine({ m, first, who, colour }: { m: WaMessage; first: boolean; who: string; colour: string }) {
  const out = m.direction === 'out';
  const bad = m.status === 'failed';
  return (
    <div className={cn('mb-[6px] flex', out && 'flex-row-reverse')}>
      <div className="flex w-[76px] flex-shrink-0 flex-col items-center gap-[7px] pt-[2px]">
        {first && (
          <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full text-[13.5px] font-semibold text-white"
                style={{ background: colour }}>
            {initials(who)}
          </span>
        )}
        {out && <span className="flex items-center justify-center"><StatusTick status={m.status} /></span>}
        <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-faint">{fmtTime(m.created_at)}</span>
      </div>
      <div className={cn('flex min-w-0 flex-1 flex-col gap-2', out && 'items-end')}>
        {first && <div className="text-[14.5px] font-semibold tracking-[-.015em] text-ink">{who}</div>}
        <div className={cn(
          'max-w-[min(640px,74%)] rounded-[18px] px-[17px] py-[13px] text-[14.6px] leading-[1.6]',
          out
            ? bad
              ? 'bg-[#FEEFEF] text-[#5A1919] shadow-[0_0_0_1px_rgba(232,85,85,.25)]'
              : 'bg-[#D7F5D3] text-[#123321]'
            : 'bg-white text-ink shadow-[0_1px_2px_rgba(20,24,40,.07),0_0_0_1px_rgba(20,24,40,.03)]'
        )}>
          {m.template_code && (
            <span className="mb-2 inline-flex items-center gap-[5px] rounded bg-[rgba(27,122,68,.13)] px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[.08em] text-[#1B7A44]">
              <Zap className="h-[11px] w-[11px]" />
              {m.template_category} · {m.template_code}
            </span>
          )}
          <div className="whitespace-pre-wrap break-words">{m.body}</div>
          {bad && (
            <div className="mt-[11px] flex items-start gap-2 border-t border-[rgba(232,85,85,.25)] pt-[11px] text-[12px] text-[#B02B2B]">
              <AlertCircle className="mt-px h-[14px] w-[14px] flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <b className="font-bold">Not delivered.</b> {m.error_detail || m.error_code || 'Unknown error'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
