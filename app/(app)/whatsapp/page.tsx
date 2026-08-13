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
  Search, Clock, Lock, AlertCircle, Zap, Paperclip, Smile,
  FileText, PanelRight, Columns, Maximize2, Minimize2,
  ExternalLink, Loader2, Bot, Pause, Play, Square, ShieldCheck, Plus, Send as SendIcon,
  MessageSquare, Settings2, X, MoreHorizontal, Eraser, Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/components/shared/app-provider';
import { initials, avatarColor, cn } from '@/lib/utils';
import { toast } from 'sonner';
import LeadPanel, { type SeqState } from '@/components/whatsapp/lead-panel';
import TemplatePicker from '@/components/whatsapp/template-picker';
import NewConversation from '@/components/whatsapp/new-conversation';
import RepliesTab from '@/components/whatsapp/replies-tab';
import QuickReplyPalette, { filterReplies } from '@/components/whatsapp/quick-reply-palette';
import CampaignsTab, { type SeqOverviewRow } from '@/components/whatsapp/campaigns-tab';
import TemplatesTab from '@/components/whatsapp/templates-tab';
import SettingsTab from '@/components/whatsapp/settings-tab';
import { MessageBubble } from '@/components/whatsapp/message-bubble';
import {
  getCachedThread, setCachedThread, dropCachedThread, fetchThread, prefetchThreads, threadsEqual,
} from '@/lib/whatsapp/thread-cache';
import {
  formatLeft, windowLeftMs, windowState, WINDOW_META,
  type WaConversation, type WaMessage, type WaTemplate, type WaSettings, type WaStats,
  type WaSavedReply,
} from '@/lib/whatsapp/types';

const EMOJI = ['👍','🙏','😊','🎉','✅','📄','📞','🇬🇧','🚀','💡','⏰','❤️'];

type Filter = 'all' | 'unread' | 'attention' | 'open' | 'failed';
type TabKey = 'inbox' | 'replies' | 'sequences' | 'templates' | 'settings';

// 'sequences' stays as the URL key so old bookmarks keep working — the label
// is Campaigns because that is what the screen became (audience + steps +
// limits + live results). First-touch automation retired 2026-08-13: this
// number's only job is campaigns; new leads live on the separate UK line.
const SUB_TABS: Array<[TabKey, string, React.ReactNode]> = [
  ['inbox', 'Inbox', <MessageSquare key="i" className="h-[13px] w-[13px]" />],
  ['sequences', 'Campaigns', <Zap key="s" className="h-[13px] w-[13px]" />],
  ['replies', 'Quick replies', <ShieldCheck key="q" className="h-[13px] w-[13px]" />],
  ['templates', 'Templates', <FileText key="t" className="h-[13px] w-[13px]" />],
  ['settings', 'Settings', <Settings2 key="g" className="h-[13px] w-[13px]" />],
];
const FILTERS: [Filter, string][] = [
  ['all', 'All'], ['unread', 'Unread'], ['attention', 'Needs reply'], ['open', 'Open'], ['failed', 'Failed'],
];

const GROUP_MS = 5 * 60_000;

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
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [savedReplies, setSavedReplies] = useState<WaSavedReply[]>([]);
  // "/" command palette state — the parent owns it so the textarea's keydown
  // can drive ↑↓/Enter without two components fighting over the event.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  // An attachment a quick reply carries, waiting to go with the next send.
  const [pendingMedia, setPendingMedia] = useState<{
    path: string; mediaType: 'image' | 'document' | 'audio' | 'video';
    name: string; mime: string; size: number;
  } | null>(null);
  // {{pdf}} {{video}} {{booking}} live on the automation settings row.
  const [tokenLinks, setTokenLinks] = useState<{ pdf?: string; video?: string; booking?: string }>({});
  // Only true on a genuinely cold thread. A cached one paints with no spinner.
  const [threadLoading, setThreadLoading] = useState(false);
  const [chatMenu, setChatMenu] = useState(false);
  const [filterMenu, setFilterMenu] = useState(false);

  // ── sub-tabs: Inbox · Sequences · Templates · Settings ───────────────────
  // Kept in the URL (?tab=) so a refresh or a shared link lands on the same
  // screen, without useSearchParams' prerender constraints.
  const [tab, setTabState] = useState<TabKey>('inbox');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'replies' || t === 'sequences' || t === 'templates' || t === 'settings') setTabState(t);
    if (t === 'qa') setTabState('replies');        // old bookmarks land on the successor
    if (t === 'automation') setTabState('sequences'); // retired tab → Campaigns
  }, []);
  const setTab = useCallback((t: TabKey) => {
    setTabState(t);
    const u = new URL(window.location.href);
    if (t === 'inbox') u.searchParams.delete('tab'); else u.searchParams.set('tab', t);
    window.history.replaceState(null, '', u.toString());
  }, []);

  // Sequence overview backs the Sequences tab AND the lead panel's step count.
  const [overview, setOverview] = useState<SeqOverviewRow[]>([]);
  const loadOverview = useCallback(async () => {
    const { data } = await supabase.rpc('whatsapp_sequence_overview', { p_workspace_id: workspace.id });
    setOverview((data ?? []) as SeqOverviewRow[]);
  }, [supabase, workspace.id]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  // The active lead's enrollment, so Pause/Resume/Stop in the panel are real.
  const [enrollment, setEnrollment] = useState<{
    id: string; status: string; current_step: number; seq_id: string; seq_name: string;
  } | null>(null);
  const [panelTab, setPanelTab] = useState<'info' | 'activity'>('info');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  // collapse state — narrow screens start with the panel folded away
  const [hideList, setHideList] = useState(false);
  const [hidePanel, setHidePanel] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Counter for optimistic message ids. A counter, not a timestamp — two sends
  // inside the same millisecond would collide on Date.now().
  const tempSeq = useRef(0);

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
      supabase.from('whatsapp_saved_replies').select('*')
        .eq('workspace_id', workspace.id).order('sort_order')
        .then((r) => { setSavedReplies((r.data ?? []) as WaSavedReply[]); return r; }),
      supabase.from('whatsapp_automation')
        .select('pdf_url, video_url, booking_url').eq('workspace_id', workspace.id).maybeSingle()
        .then((r) => {
          const a = r.data as { pdf_url?: string | null; video_url?: string | null; booking_url?: string | null } | null;
          setTokenLinks({ pdf: a?.pdf_url ?? '', video: a?.video_url ?? '', booking: a?.booking_url ?? '' });
          return r;
        }),
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

  // ── THREAD: cache first, network second ──────────────────────────────────
  // The old version cleared the thread, showed a spinner and waited on a round
  // trip for EVERY click. Now a visited conversation paints synchronously from
  // the module-level cache and the refresh happens behind you — which is the
  // single biggest reason this now feels like WhatsApp instead of a web app.
  useEffect(() => {
    if (!activeId) { setMsgs([]); setThreadLoading(false); return; }
    let alive = true;

    const cached = getCachedThread(activeId);
    if (cached) { setMsgs(cached); setThreadLoading(false); }
    else { setMsgs([]); setThreadLoading(true); }

    fetchThread(supabase, activeId)
      .then((rows) => {
        if (!alive) return;
        // Repaint only when something actually differs — a background refresh
        // that changes nothing should not cost a render.
        setMsgs((prev) => (threadsEqual(prev, rows) ? prev : rows));
      })
      .catch((e) => { if (alive) toast.error(`Couldn't load the thread: ${(e as Error).message}`); })
      .finally(() => { if (alive) setThreadLoading(false); });

    // Fire-and-forget — but it MUST actually fire. A supabase query builder is
    // lazy: the HTTP request is issued inside .then(), so calling .rpc() and
    // ignoring the result sent nothing at all. The badge cleared locally, the
    // database never heard about it, and the next refresh brought the unread
    // count and the orange "needs reply" dot straight back. Hence .then().
    void supabase
      .rpc('whatsapp_touch_read', { p_conversation_id: activeId })
      .then(() => {}, () => {});
    setConvs((cs) => cs.map((c) => (
      c.id === activeId ? { ...c, unread_count: 0, needs_attention: false } : c
    )));

    return () => { alive = false; };
  }, [activeId, supabase]);

  // Warm the threads most likely to be opened next, so the first click on each
  // is also instant — not just the second.
  useEffect(() => {
    if (!convs.length) return;
    const t = setTimeout(() => prefetchThreads(supabase, convs.slice(0, 8).map((c) => c.id), 8), 120);
    return () => clearTimeout(t);
  }, [convs, supabase]);

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
          // Keep the cache authoritative even for threads not on screen, so
          // switching to them later shows the new message immediately.
          if (row.conversation_id !== activeIdRef.current) {
            const other = getCachedThread(row.conversation_id);
            if (other && !other.some((m) => m.id === row.id)) {
              setCachedThread(row.conversation_id, [...other, row]);
            }
          }
          if (row.conversation_id === activeIdRef.current) {
            setMsgs((prev) => {
              const i = prev.findIndex((m) => m.id === row.id);
              if (i >= 0) {
                // Same row, same status — skip the state write so React does not
                // re-render the thread for a no-op update.
                if (prev[i].status === row.status && prev[i].body === row.body) return prev;
                const next = [...prev]; next[i] = row; return next;
              }
              // Realtime can beat our own POST response back to the browser. If
              // this is the real row for a message we optimistically painted,
              // replace the placeholder — appending would show it twice.
              //
              // row.direction must be checked too: a lead replying with the same
              // word we just sent ("Hey") would otherwise swallow our own bubble.
              if (row.direction === 'out') {
                const t = prev.findIndex((m) =>
                  m.id.startsWith('tmp_') && m.direction === 'out' && m.body === row.body);
                if (t >= 0) { const next = [...prev]; next[t] = row; return next; }
              }
              return [...prev, row];
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

  // Mirror the on-screen thread into the cache so an optimistic send, a status
  // tick or a failure is still there when you come back to this conversation.
  useEffect(() => {
    if (activeId && msgs.length) setCachedThread(activeId, msgs);
  }, [activeId, msgs]);

  // stick to the bottom as the thread grows
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, activeId]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (tab !== 'inbox') return;   // layout shortcuts belong to the inbox
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
  }, [hideList, hidePanel, tab]);

  // ── actions ───────────────────────────────────────────────────────────────
  // OPTIMISTIC SEND.
  //
  // The old flow made you watch four sequential round trips before the textarea
  // even cleared: POST -> API route (plus a possible Netlify cold start) -> DB
  // insert -> Interakt HTTP call -> response, then a full 400-row thread refetch,
  // then a conversation list refresh, then a stats refresh. Every one of those
  // was in front of the human.
  //
  // Now the bubble appears the instant you hit Send, the box clears, and the
  // network work happens behind you. WhatsApp itself does exactly this — the
  // tick state, not the bubble, is what waits on the server.
  //
  // The temporary row carries status 'queued', which renders as the single grey
  // tick already handled below. When the server answers we swap the temp row for
  // the real id so the realtime channel's later status updates land on the right
  // message instead of creating a duplicate.
  const send = useCallback(async (
    body: string,
    template?: { code: string; values: Record<string, string> },
    media?: { path: string; mediaType: 'image' | 'document' | 'audio' | 'video'; name: string; mime: string; size: number },
  ) => {
    if (!active) return;
    const conversationId = active.id;
    const tempId = `tmp_${tempSeq.current++}`;
    const text = template ? body : body.trim();
    // A bare photo or PDF is a real message, and so is a template — the template
    // body lives on the server, so an empty `body` here is normal and must NOT
    // be treated as "nothing to send". Only bail when all three are absent.
    if (!text && !media && !template) return;

    const optimistic: WaMessage = {
      id: tempId,
      workspace_id: workspace.id,
      conversation_id: conversationId,
      lead_id: active.lead_id,
      direction: 'out',
      body: text,
      template_code: template?.code ?? null,
      template_category: null,
      variables: template?.values ?? null,
      provider_msg_id: null,
      status: 'queued',
      error_code: null,
      error_detail: null,
      sent_by: app.user?.id ?? null,
      sequence_step: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      media_path: media?.path ?? null,
      media_type: media?.mediaType ?? null,
      media_name: media?.name ?? null,
      media_mime: media?.mime ?? null,
      media_size: media?.size ?? null,
    };

    // 1. Paint immediately. Nothing below this line blocks the UI.
    setMsgs((prev) => [...prev, optimistic]);
    setDrafts((d) => ({ ...d, [conversationId]: '' }));
    if (textarea.current) { textarea.current.value = ''; textarea.current.style.height = 'auto'; }
    setSending(true);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          ...(template ? { templateCode: template.code, values: template.values } : { body: text }),
          ...(media ? { media } : {}),
        }),
      });
      const json = await res.json();

      // 2. Reconcile the placeholder in place. No thread refetch — the realtime
      //    channel already carries the authoritative row, and refetching 400
      //    messages to learn about one is what made the list flicker.
      setMsgs((prev) => {
        const i = prev.findIndex((m) => m.id === tempId);
        if (i === -1) return prev;                 // conversation switched, drop it
        const next = [...prev];
        if (json.ok && json.messageId) {
          // If realtime already delivered the real row, remove the placeholder
          // rather than ending up with the message twice.
          if (prev.some((m) => m.id === json.messageId)) { next.splice(i, 1); return next; }
          next[i] = { ...next[i], id: json.messageId, status: 'sent' };
        } else {
          next[i] = {
            ...next[i],
            status: 'failed',
            error_code: json.reason ?? 'send_failed',
            error_detail: json.detail ?? null,
          };
        }
        return next;
      });

      if (!json.ok) {
        toast.error(json.detail || json.reason || 'Send failed');
        // Put the text back so a failed send never silently eats what you typed.
        setDrafts((d) => ({ ...d, [conversationId]: template ? (d[conversationId] ?? '') : text }));
      } else if (json.dryRun) {
        toast.warning('Dry-run is on — this was logged but never left the CRM');
      }

      queueRefresh();
    } catch (e) {
      setMsgs((prev) => prev.map((m) => (
        m.id === tempId
          ? { ...m, status: 'failed', error_code: 'network', error_detail: (e as Error).message }
          : m
      )));
      toast.error(`Send failed: ${(e as Error).message}`);
      setDrafts((d) => ({ ...d, [conversationId]: text }));
    } finally {
      setSending(false);
    }
  }, [active, workspace.id, app.user?.id, queueRefresh]);

  // Upload first, then send. Two steps on purpose: a file the user attaches and
  // then thinks better of costs nothing and reaches nobody.
  const onPickFile = useCallback(async (file: File) => {
    if (!active) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/whatsapp/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.ok) { toast.error(json.detail || json.reason || 'Upload failed'); return; }
      const caption = (drafts[active.id] || '').trim();
      await send(caption, undefined, {
        path: json.path, mediaType: json.mediaType, name: json.name, mime: json.mime, size: json.size,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [active, drafts, send]);

  // ── quick replies ("/" palette) ───────────────────────────────────────────
  const slashResults = useMemo(() => filterReplies(savedReplies, slashQuery), [savedReplies, slashQuery]);

  // Switching chats drops palette state and any staged attachment — a file
  // meant for one person must never ride along into another conversation.
  useEffect(() => {
    setPendingMedia(null); setSlashOpen(false); setSlashQuery(''); setSlashIdx(0);
  }, [activeId]);

  /** Tokens are filled the moment a reply is inserted, so what you see in the
   *  box is exactly what the lead receives. */
  const fillReplyTokens = useCallback((body: string) => {
    const raw = active?.lead_name ?? '';
    const name = !raw || /^whatsapp\s/i.test(raw) || /^[+\d\s-]+$/.test(raw) ? 'there' : firstName(raw);
    return body
      .replace(/\{\{\s*name\s*\}\}/gi, name)
      .replace(/\{\{\s*pdf\s*\}\}/gi, tokenLinks.pdf ?? '')
      .replace(/\{\{\s*video\s*\}\}/gi, tokenLinks.video ?? '')
      .replace(/\{\{\s*booking\s*\}\}/gi, tokenLinks.booking ?? '')
      .replace(/[ \t]+\n/g, '\n').trim();
  }, [active?.lead_name, tokenLinks]);

  const pickReply = useCallback((r: WaSavedReply) => {
    if (!active) return;
    const body = fillReplyTokens(r.body);
    setDrafts((d) => ({ ...d, [active.id]: body }));
    const el = textarea.current;
    if (el) {
      el.value = body;
      el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
      el.focus();
    }
    if (r.media_path) {
      setPendingMedia({
        path: r.media_path,
        mediaType: (['image', 'document', 'audio', 'video'].includes(r.media_type ?? '')
          ? r.media_type : 'document') as 'image' | 'document' | 'audio' | 'video',
        name: r.media_name ?? 'attachment',
        mime: r.media_mime ?? 'application/octet-stream',
        size: r.media_size ?? 0,
      });
    }
    setSlashOpen(false); setSlashQuery(''); setSlashIdx(0);
    // Usage count is bookkeeping — it must never block or fail the insert.
    void supabase.rpc('whatsapp_saved_reply_used', { p_id: r.id }).then(() => {}, () => {});
  }, [active, fillReplyTokens, supabase]);

  // Open a conversation in its own window — double-click a row, or the button
  // in the header. Sized like a messaging app, not a browser tab.
  const popOut = useCallback((conversationId: string) => {
    window.open(
      `/wa/${conversationId}`,
      `wa_${conversationId}`,
      'width=520,height=760,menubar=no,toolbar=no,location=no,status=no'
    );
  }, []);

  // "Close it completely so it opens fresh." Two shapes of that, because they
  // mean different things: empty the thread, or remove the conversation.
  const clearChat = useCallback(async (hardDelete: boolean) => {
    if (!active) return;
    setChatMenu(false);
    const who = active.lead_name;
    const ok = window.confirm(
      hardDelete
        ? `Delete the whole conversation with ${who}?\n\nEvery message is removed and it disappears from the inbox. It comes back empty the next time they message you.\n\nThis cannot be undone.`
        : `Clear all messages with ${who}?\n\nThe chat is emptied but stays in your inbox.\n\nThis cannot be undone.`
    );
    if (!ok) return;

    const { data, error } = await supabase.rpc('whatsapp_clear_conversation', {
      p_conversation_id: active.id,
      p_delete: hardDelete,
    });
    if (error) { toast.error(error.message); return; }
    const r = (data ?? {}) as { ok?: boolean; reason?: string; messages_removed?: number };
    if (!r.ok) {
      toast.error(r.reason === 'not_campaign_admin'
        ? 'Only a campaign admin can clear conversations'
        : r.reason ?? 'Could not clear the chat');
      return;
    }

    // Drop it from the cache too, or the emptied thread would repaint from
    // memory the next time you clicked it.
    dropCachedThread(active.id);
    setMsgs([]);
    if (hardDelete) setActiveId(null);
    await reload();
    toast.success(hardDelete
      ? `Conversation deleted — ${r.messages_removed ?? 0} messages removed`
      : `Chat cleared — ${r.messages_removed ?? 0} messages removed`);
  }, [active, supabase, reload]);

  async function toggleClosed() {
    if (!active) return;
    const next = active.status === 'open' ? 'closed' : 'open';
    await supabase.rpc('whatsapp_set_conversation_status', { p_conversation_id: active.id, p_status: next });
    toast.success(next === 'closed' ? 'Conversation closed' : 'Conversation reopened');
    loadConvs();
  }

  // The panel's Pause/Resume/Stop act on the real enrollment. The rule stands:
  // a reply never stops anything — these three buttons are the only way.
  async function seqAction(a: 'pause' | 'resume' | 'stop') {
    if (!enrollment) {
      toast('This lead is not in a sequence — enrol them from the Sequences tab');
      return;
    }
    const { data, error } = await supabase.rpc('whatsapp_enrollment_action', {
      p_enrollment_id: enrollment.id, p_action: a,
    });
    if (error) { toast.error(error.message); return; }
    const next = String(data);
    setEnrollment({ ...enrollment, status: next });
    loadOverview();
    toast.success(
      next === 'paused' ? 'Sequence paused for this lead'
        : next === 'active' ? 'Sequence resumed — next send inside the window'
        : 'Stopped — this lead gets nothing further from the sequence'
    );
  }

  // ── derived ───────────────────────────────────────────────────────────────
  // The New Conversation picker needs to know whether a lead's 24-hour window is
  // still open, which lives on the conversation row. Pass a lookup rather than
  // making that modal re-query what this page already has.
  const lastInboundByConversation = useMemo(() => {
    const m: Record<string, string | null> = {};
    convs.forEach((c) => { m[c.id] = c.last_inbound_at; });
    return m;
  }, [convs]);

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

  // Enrollment lookup for the lead panel — one tiny query per selected lead.
  useEffect(() => {
    const leadId = activeLead?.id;
    if (!leadId) { setEnrollment(null); return; }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('whatsapp_sequence_enrollments')
        .select('id, status, current_step, sequence:whatsapp_sequences(id, name)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (!alive) return;
      const row = (data ?? [])[0] as {
        id: string; status: string; current_step: number;
        sequence: { id: string; name: string } | { id: string; name: string }[] | null;
      } | undefined;
      const seq = Array.isArray(row?.sequence) ? row?.sequence[0] : row?.sequence;
      setEnrollment(row
        ? { id: row.id, status: row.status, current_step: row.current_step,
            seq_id: seq?.id ?? '', seq_name: seq?.name ?? 'Sequence' }
        : null);
    })();
    return () => { alive = false; };
  }, [activeLead?.id, supabase]);

  const seqState: SeqState = enrollment
    ? (enrollment.status === 'active' ? 'active'
       : enrollment.status === 'paused' ? 'paused'
       : 'stopped')
    : (active?.suppressed ? 'stopped' : 'none');
  const seqSteps = overview.find((o) => o.id === enrollment?.seq_id)?.step_count ?? null;
  const seqLabel = enrollment
    ? `${enrollment.seq_name} · ${
        enrollment.status === 'completed' ? 'completed'
          : `step ${enrollment.current_step}${seqSteps ? `/${seqSteps}` : ''}`}`
    : 'No sequence';


  // ── render ────────────────────────────────────────────────────────────────
  return (
    // Full height. The 56px allowance is the MOBILE top bar only — on desktop
    // (md:) the app shell has no header, and subtracting a phantom 56px was
    // exactly the dead strip that sat under the composer.
    <div className="flex h-[calc(100dvh-56px)] flex-col bg-[#EEF0F4] md:h-[100dvh]">
      {/* top bar — the approved design: wordmark · centred segmented tabs · presence pill */}
      <div className="relative flex h-[46px] flex-shrink-0 items-center gap-2.5 border-b border-[#E8EAF0] bg-white px-[14px]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13.5px] font-bold tracking-tight text-[#0F1728]">WhatsApp</span>
          <span className="text-[#E8EAF0]">|</span>
          <span className="truncate text-[13px] font-medium text-[#7A8095]">
            {SUB_TABS.find(([k]) => k === tab)?.[1] ?? 'Inbox'}
          </span>
        </div>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-[10px] bg-[#F4F5F8] p-[3px] shadow-[inset_0_1px_2px_rgba(20,24,40,.02)] md:flex">
          {SUB_TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                'rounded-[7px] px-4 py-[6px] text-[12.5px] transition-all duration-150 ease-in-out',
                tab === k
                  ? 'bg-white font-semibold text-[#0F1728] shadow-[0_1px_2px_rgba(20,24,40,.06)]'
                  : 'font-medium text-[#7A8095] hover:text-[#0F1728]'
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-[9px]">
          {tab === 'inbox' && (
            <>
              <Toggle on={hideList} onClick={() => setHideList((v) => !v)} title="Conversation list  ([)"><Columns className="h-[18px] w-[18px]" /></Toggle>
              <Toggle on={hidePanel} onClick={() => setHidePanel((v) => !v)} title="Lead panel  (])"><PanelRight className="h-[18px] w-[18px]" /></Toggle>
              <button
                onClick={() => { const all = focusOn; setHideList(!all); setHidePanel(!all); }}
                title="Focus mode  (F)"
                className={cn(
                  'inline-flex flex-shrink-0 items-center gap-[6px] rounded-full border px-[11px] py-[5px] text-[11.8px] font-semibold transition',
                  focusOn ? 'border-ink bg-ink text-white' : 'border-[#DDE0E9] bg-white text-ink-2 hover:border-[#2FB463] hover:bg-[#EDFAF1] hover:text-[#1B7A44]'
                )}
              >
                {focusOn ? <Minimize2 className="h-[14px] w-[14px]" /> : <Maximize2 className="h-[14px] w-[14px]" />}
                {focusOn ? 'Exit focus' : 'Focus'}
              </button>
              <span className="h-[22px] w-px bg-[#E8EAF0]" />
            </>
          )}
          <ConnectionPill settings={settings} loading={loading} />
        </div>
      </div>

      {tab === 'replies' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RepliesTab workspaceId={workspace.id} onChanged={reload} />
        </div>
      )}
      {tab === 'sequences' && (
        <CampaignsTab
          workspaceId={workspace.id}
          templates={templates}
          leads={leads}
          overview={overview}
          reloadOverview={loadOverview}
        />
      )}
      {tab === 'templates' && <TemplatesTab templates={templates} onChanged={reload} />}
      {tab === 'settings' && (
        <SettingsTab
          workspaceId={workspace.id}
          settings={settings}
          stats={stats}
          onSettingsChanged={reload}
        />
      )}

      {tab === 'inbox' && (
      <div className="flex min-h-0 flex-1">
        {/* conversation list */}
        <div className={cn(
          'flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-r bg-white transition-[width,border-width] duration-200 ease-out',
          hideList ? 'w-0 border-r-0' : 'w-[340px] border-[#E8EAF0]'
        )}>
          {/* Compact header: half-width New button + filter dropdown on one
              row, search below. The old chip rows spent ~46px of every scroll
              on filters most sessions never touch. */}
          <div className="flex w-[340px] flex-shrink-0 flex-col gap-2 border-b border-[#E8EAF0] p-3">
            <div className="flex gap-2">
              <button
                onClick={() => setNewConvOpen(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#25A25A] px-2 py-[7px] text-[12.4px] font-semibold text-white transition-colors duration-150 hover:bg-[#1f874b]"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
              <span className="relative flex-1">
                <button
                  onClick={() => setFilterMenu((v) => !v)}
                  className={cn(
                    'flex w-full items-center justify-between gap-1 rounded-lg border px-2.5 py-[7px] text-[12.2px] font-semibold transition-colors',
                    filter !== 'all'
                      ? 'border-[#D7F3E1] bg-[#EDFAF1] text-[#1B7A44]'
                      : 'border-[#E3E6ED] bg-[#FAFBFC] text-[#45464c] hover:border-[#CBD1DD]'
                  )}
                >
                  <span className="truncate">{FILTERS.find(([k]) => k === filter)?.[1]}</span>
                  <span className="flex items-center gap-1">
                    <b className="text-[10.5px] tabular-nums opacity-60">{counts[filter]}</b>
                    <svg width="9" height="9" viewBox="0 0 10 10" className="flex-shrink-0 opacity-50"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </span>
                </button>
                {filterMenu && (
                  <>
                    <span className="fixed inset-0 z-10" onClick={() => setFilterMenu(false)} />
                    <span className="absolute left-0 right-0 top-[36px] z-20 block overflow-hidden rounded-xl border border-[#E8EAF0] bg-white p-1 shadow-[0_12px_28px_-12px_rgba(20,24,40,.3)]">
                      {FILTERS.map(([k, l]) => (
                        <button key={k}
                          onClick={() => { setFilter(k); setFilterMenu(false); }}
                          className={cn(
                            'flex w-full items-center justify-between rounded-lg px-2.5 py-[7px] text-[12.4px] transition-colors',
                            filter === k ? 'bg-[#EDFAF1] font-semibold text-[#1B7A44]' : 'font-medium text-[#45464c] hover:bg-[#F4F5F8]'
                          )}>
                          {l}
                          <b className="text-[10.5px] tabular-nums opacity-60">{counts[k]}</b>
                        </button>
                      ))}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A8095]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations…"
                className="w-full rounded-md border border-[#E8EAF0] py-[7px] pl-9 pr-3 text-[13px] outline-none transition-all duration-150 placeholder:text-[#7A8095] focus:border-[#25A25A] focus:ring-1 focus:ring-[#25A25A]"
              />
            </div>
          </div>

          <div className="w-[340px] flex-1 overflow-y-auto">
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
              const on = activeId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  onDoubleClick={() => popOut(c.id)}
                  // Pointing at a row starts its fetch, so the click that
                  // follows has nothing left to wait for.
                  onMouseEnter={() => prefetchThreads(supabase, [c.id], 1)}
                  title="Double-click to open in its own window"
                  className={cn(
                    'flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors duration-150',
                    on
                      ? 'border-l-[3px] border-l-[#25A25A] bg-[#EDFAF1]'
                      : 'border-l-[3px] border-l-transparent hover:bg-[#F9FAFB]'
                  )}>
                  <span
                    className="mt-[2px] flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: avatarColor(c.lead_name) }}
                  >
                    {initials(c.lead_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                  <span className="mb-1 flex items-baseline justify-between gap-2">
                    <span className={cn(
                      'flex min-w-0 items-center gap-[6px] truncate text-[12.8px] text-[#0F1728]',
                      c.unread_count ? 'font-bold' : on ? 'font-semibold' : 'font-medium'
                    )}>
                      {c.lead_name}
                      {c.suppressed && <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full bg-[#B02B2B]" title="Opted out" />}
                      {!c.suppressed && c.needs_attention && <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full bg-[#F0A020]" title="Needs reply" />}
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-[6px]">
                      {c.unread_count > 0 && (
                        <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[#25A25A] px-1 text-[9.5px] font-bold text-white">
                          {c.unread_count}
                        </span>
                      )}
                      <span className="text-[11px] text-[#7A8095]">{fmtRel(c.last_message_at)}</span>
                    </span>
                  </span>
                  <span className={cn('block truncate text-[12px]', c.unread_count ? 'text-[#45464c]' : 'text-[#7A8095]')}>
                    {c.last_direction === 'out' ? 'You: ' : ''}{c.last_preview || '—'}
                  </span>
                  {st !== 'shut' && !c.suppressed && (
                    <span className="mt-[3px] block text-[10.5px] font-medium" style={{ color: meta.colour }}>
                      Window {formatLeft(windowLeftMs(c.last_inbound_at))}
                    </span>
                  )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* conversation + panel */}
        <div className="flex min-w-0 flex-1 p-[10px]">
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
                {/* header — 56px, quiet, per the approved design */}
                <div className="flex h-[46px] flex-shrink-0 items-center justify-between border-b border-[#E8EAF0] bg-white px-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E9EDFF] text-[13px] font-semibold text-[#3323cc]">
                      {initials(active.lead_name)}
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 truncate text-[14px] font-semibold leading-tight text-[#0F1728]">{active.lead_name}</h2>
                      <span className="block truncate text-[11px] text-[#7A8095]">
                        {[active.visa_type?.toUpperCase(), memberNameById(active.owner_id)].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-full border px-[10px] py-1 text-[11.5px] font-semibold"
                          style={{
                            background: wState === 'shut' ? '#F4F5F8' : wState === 'open' ? '#EDFAF1' : wState === 'warn' ? '#FEF6E6' : '#FEEFEF',
                            borderColor: wState === 'shut' ? '#E8EAF0' : wState === 'open' ? '#D7F3E1' : wState === 'warn' ? '#F8E2B8' : '#F8D6D6',
                            color: wMeta.colour,
                          }}>
                      {wState === 'shut' ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {wState === 'shut' ? 'Window closed' : formatLeft(wLeft)}
                    </span>
                    {/* Sequence control lives here too, not only in the side
                        panel — you should be able to stop a sequence from the
                        window you noticed the problem in. */}
                    {seqState !== 'none' && (
                      <span className="flex items-center gap-1 rounded-md border border-[#E8EAF0] bg-white p-[2px]">
                        {seqState === 'active' ? (
                          <button onClick={() => seqAction('pause')} title="Pause this lead's sequence"
                            className="flex h-[26px] items-center gap-1 rounded px-2 text-[11.5px] font-semibold text-[#A25D07] transition hover:bg-[#FEF6E6]">
                            <Pause className="h-3 w-3" />Pause
                          </button>
                        ) : (
                          <button onClick={() => seqAction('resume')} disabled={seqState !== 'paused'}
                            title="Resume this lead's sequence"
                            className="flex h-[26px] items-center gap-1 rounded px-2 text-[11.5px] font-semibold text-[#1B7A44] transition hover:bg-[#EDFAF1] disabled:opacity-40">
                            <Play className="h-3 w-3" />Resume
                          </button>
                        )}
                        <button onClick={() => seqAction('stop')} disabled={seqState === 'stopped'}
                          title="Stop permanently"
                          className="flex h-[26px] items-center gap-1 rounded px-2 text-[11.5px] font-semibold text-[#45464c] transition hover:bg-[#F4F5F8] disabled:opacity-40">
                          <Square className="h-3 w-3" />Stop
                        </button>
                      </span>
                    )}
                    <button onClick={toggleClosed}
                      className="rounded-md border border-[#E8EAF0] bg-white px-3 py-[5px] text-[12px] font-medium text-[#45464c] transition-colors hover:text-[#0F1728]">
                      {active.status === 'closed' ? 'Reopen' : 'Mark as closed'}
                    </button>
                    <button onClick={() => popOut(active.id)} title="Open in its own window"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[#7A8095] transition-colors hover:bg-[#F4F5F8] hover:text-[#0F1728]">
                      <Maximize2 className="h-[16px] w-[16px]" />
                    </button>
                    <span className="relative">
                      <button onClick={() => setChatMenu((v) => !v)} title="More"
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[#7A8095] transition-colors hover:bg-[#F4F5F8] hover:text-[#0F1728]">
                        <MoreHorizontal className="h-[17px] w-[17px]" />
                      </button>
                      {chatMenu && (
                        <>
                          <span className="fixed inset-0 z-10" onClick={() => setChatMenu(false)} />
                          <span className="absolute right-0 top-[36px] z-20 block w-[248px] overflow-hidden rounded-xl border border-[#E8EAF0] bg-white p-1 shadow-[0_12px_28px_-12px_rgba(20,24,40,.3)]">
                            <button onClick={() => clearChat(false)}
                              className="flex w-full items-start gap-[9px] rounded-lg px-[10px] py-[8px] text-left transition hover:bg-[#F4F5F8]">
                              <Eraser className="mt-[2px] h-[14px] w-[14px] flex-shrink-0 text-[#7A8095]" />
                              <span>
                                <b className="block text-[12.6px] font-semibold text-[#0F1728]">Clear messages</b>
                                <span className="block text-[11px] leading-[1.45] text-[#7A8095]">Empties the chat, keeps the contact here.</span>
                              </span>
                            </button>
                            <button onClick={() => clearChat(true)}
                              className="flex w-full items-start gap-[9px] rounded-lg px-[10px] py-[8px] text-left transition hover:bg-[#FEEFEF]">
                              <Trash2 className="mt-[2px] h-[14px] w-[14px] flex-shrink-0 text-[#B02B2B]" />
                              <span>
                                <b className="block text-[12.6px] font-semibold text-[#B02B2B]">Delete conversation</b>
                                <span className="block text-[11px] leading-[1.45] text-[#8E2A2A]">Removes it from the inbox. Reopens blank on their next message.</span>
                              </span>
                            </button>
                            <span className="mt-1 block border-t border-[#F0F1F5] px-[10px] pb-1 pt-[7px] text-[10.5px] leading-[1.5] text-[#A8ADBF]">
                              Opt-outs are never undone by either action.
                            </span>
                          </span>
                        </>
                      )}
                    </span>
                    {active.lead_id && (
                      <a href={`/leads?lead=${active.lead_id}`} title="Open lead record"
                         className="flex h-8 w-8 items-center justify-center rounded-md text-[#7A8095] transition-colors hover:bg-[#F4F5F8] hover:text-[#0F1728]">
                        <ExternalLink className="h-[18px] w-[18px]" />
                      </a>
                    )}
                  </div>
                </div>

                {/* messages */}
                <div
                  ref={scroller}
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f && !active.suppressed && wState !== 'shut') onPickFile(f);
                  }}
                  className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-[#FAFBFC] p-6"
                >
                  {groups.map((g, gi) =>
                    g.kind === 'day' ? (
                      <div key={`d${gi}`} className="my-2 text-center text-[11px] font-medium uppercase tracking-widest text-[#7A8095]">
                        {g.label}
                      </div>
                    ) : (
                      <div key={`g${gi}`} className={cn('flex flex-col gap-1', g.dir === 'out' ? 'items-end' : 'items-start')}>
                        {g.items.map((m, i) => (
                          <MessageBubble key={m.id} m={m} last={i === g.items.length - 1} />
                        ))}
                      </div>
                    )
                  )}
                  {threadLoading && msgs.length === 0 && (
                    <div className="py-14 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted" /></div>
                  )}
                  {!threadLoading && msgs.length === 0 && (
                    <p className="py-14 text-center text-[13px] text-muted">No messages in this conversation yet.</p>
                  )}
                </div>

                {/* composer */}
                <div className="flex-shrink-0 border-t border-[#E8EAF0] bg-white p-4">
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
                    <div className="relative rounded-lg border border-[#E8EAF0] transition-all duration-150 focus-within:border-[#25A25A] focus-within:ring-1 focus-within:ring-[#25A25A]">
                      {emojiOpen && (
                        <div className="absolute bottom-full left-2 z-20 mb-2 flex w-[236px] flex-wrap gap-1 rounded-xl border border-[#E8EAF0] bg-white p-2 shadow-[0_12px_28px_-12px_rgba(20,24,40,.3)]">
                          {EMOJI.map((e) => (
                            <button key={e}
                              onClick={() => {
                                const el = textarea.current;
                                const v = (drafts[active.id] || '') + e;
                                setDrafts((d) => ({ ...d, [active.id]: v }));
                                if (el) { el.value = v; el.focus(); }
                                setEmojiOpen(false);
                              }}
                              className="h-8 w-8 rounded-md text-[18px] leading-none transition hover:bg-[#F4F5F8]">{e}</button>
                          ))}
                        </div>
                      )}
                      {slashOpen && (
                        <QuickReplyPalette
                          replies={slashResults}
                          query={slashQuery}
                          selectedIndex={slashIdx}
                          onPick={pickReply}
                          onHover={setSlashIdx}
                          onManage={() => { setSlashOpen(false); setTab('replies'); }}
                        />
                      )}
                      {pendingMedia && (
                        <div className="flex items-center gap-2 border-b border-[#E8EAF0] bg-[#F7FDF9] px-3 py-1.5">
                          <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-[#1B7A44]" />
                          <span className="min-w-0 truncate text-[11.8px] font-semibold text-[#1B7A44]">{pendingMedia.name}</span>
                          <span className="text-[10.5px] text-[#7A8095]">goes with this message</span>
                          <button onClick={() => setPendingMedia(null)} title="Remove attachment"
                            className="ml-auto rounded p-1 text-[#1B7A44] transition hover:bg-[#D7F3E1]">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <textarea
                        ref={textarea}
                        rows={1}
                        defaultValue={drafts[active.id] || ''}
                        placeholder={`Reply to ${firstName(active.lead_name)} — or type / for a quick reply…`}
                        onInput={(e) => {
                          const el = e.currentTarget;
                          el.style.height = 'auto';
                          el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
                          setDrafts((d) => ({ ...d, [active.id]: el.value }));
                          // "/" as the first character summons the palette;
                          // everything typed after it filters the list live.
                          if (el.value.startsWith('/')) {
                            setSlashOpen(true); setSlashQuery(el.value.slice(1)); setSlashIdx(0);
                          } else if (slashOpen) {
                            setSlashOpen(false); setSlashQuery('');
                          }
                        }}
                        onKeyDown={(e) => {
                          // Palette navigation owns the keys while it is open.
                          if (slashOpen) {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setSlashIdx((i) => Math.min(i + 1, Math.max(0, slashResults.length - 1)));
                              return;
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setSlashIdx((i) => Math.max(i - 1, 0));
                              return;
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                              e.preventDefault();
                              const r = slashResults[slashIdx];
                              if (r) pickReply(r);
                              return;
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setSlashOpen(false); setSlashQuery('');
                              return;
                            }
                          }
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            const v = e.currentTarget.value.trim();
                            if ((v || pendingMedia) && !sending) {
                              send(v, undefined, pendingMedia ?? undefined);
                              setPendingMedia(null);
                            }
                          }
                        }}
                        className="block max-h-[120px] min-h-[46px] w-full resize-none border-0 bg-transparent p-3 text-[13px] leading-[1.6] outline-none placeholder:text-[#7A8095]"
                      />
                      <div className="flex items-center justify-between rounded-b-lg border-t border-[#E8EAF0] bg-[#FAFBFC] p-2">
                        <div className="flex gap-1">
                          <button onClick={() => setPickerOpen(true)} title="Send an approved template"
                            className="rounded p-1.5 text-[#7A8095] transition-colors hover:bg-[#E8EAF0] hover:text-[#0F1728]">
                            <Zap className="h-[18px] w-[18px]" />
                          </button>
                          <input ref={fileRef} type="file" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); }} />
                          <button onClick={() => fileRef.current?.click()} disabled={uploading}
                            title="Attach a photo or document"
                            className="rounded p-1.5 text-[#7A8095] transition-colors hover:bg-[#E8EAF0] hover:text-[#0F1728] disabled:opacity-50">
                            {uploading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Paperclip className="h-[18px] w-[18px]" />}
                          </button>
                          <button onClick={() => { setEmojiOpen((v) => !v); setSlashOpen(false); }} title="Emoji"
                            className="rounded p-1.5 text-[#7A8095] transition-colors hover:bg-[#E8EAF0] hover:text-[#0F1728]">
                            <Smile className="h-[18px] w-[18px]" />
                          </button>
                          <button
                            onClick={() => {
                              setEmojiOpen(false);
                              setSlashOpen((v) => !v); setSlashQuery(''); setSlashIdx(0);
                              textarea.current?.focus();
                            }}
                            title="Quick replies  (/)"
                            className={cn(
                              'flex items-center gap-1 rounded px-1.5 py-1.5 transition-colors',
                              slashOpen ? 'bg-[#EDFAF1] text-[#1B7A44]' : 'text-[#7A8095] hover:bg-[#E8EAF0] hover:text-[#0F1728]'
                            )}>
                            <span className="font-mono text-[13px] font-bold leading-none">/</span>
                            <span className="text-[11px] font-semibold">Quick reply</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="whitespace-nowrap text-[11px] text-[#7A8095]">
                            Free-form for <b className="font-semibold tabular-nums text-[#45464c]">{formatLeft(wLeft)}</b>
                          </span>
                          {/* Not disabled while a send is in flight — the bubble is
                              already on screen; only an empty box disables it. */}
                          <button
                            disabled={!(drafts[active.id] || '').trim() && !pendingMedia}
                            onClick={() => {
                              const v = (drafts[active.id] || '').trim();
                              if (v || pendingMedia) { send(v, undefined, pendingMedia ?? undefined); setPendingMedia(null); }
                            }}
                            className="flex items-center gap-2 rounded-md bg-[#131b2d] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2a3040] disabled:opacity-40"
                          >
                            Send <SendIcon className="h-[13px] w-[13px]" />
                          </button>
                        </div>
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
              seqLabel={seqLabel}
              seqName={enrollment?.seq_name ?? null}
              seqStep={enrollment?.current_step ?? null}
              seqTotal={seqSteps}
              onSeq={seqAction}
              onMail={() => toast('Opens the email composer')}
              onCall={() => toast('Click-to-call arrives in Stage 3')}
              collapsed={hidePanel}
            />
          )}
        </div>
      </div>
      )}

      {tab === 'inbox' && (<>
      <TemplatePicker
        open={pickerOpen}
        templates={templates}
        leadFirstName={active ? firstName(active.lead_name) : ''}
        windowShut={wState === 'shut'}
        sending={sending}
        onClose={() => setPickerOpen(false)}
        // Render the body here purely so the optimistic bubble shows real words
        // instead of an empty grey box. The server re-renders from its own copy
        // of the template and that is what actually goes to Meta — this string
        // never leaves the browser as the message.
        onSend={(t, values) => {
          setPickerOpen(false);
          const preview = t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => values[n] ?? `{{${n}}}`);
          send(preview, { code: t.code, values });
        }}
      />

      <NewConversation
        open={newConvOpen}
        workspaceId={workspace.id}
        templates={templates}
        lastInboundByConversation={lastInboundByConversation}
        onClose={() => setNewConvOpen(false)}
        onSent={async (conversationId) => {
          // Refresh first, then select — selecting an id that is not in the list
          // yet would render an empty thread for a beat.
          await reload();
          if (conversationId) setActiveId(conversationId);
        }}
      />
      </>)}
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
    <span className={cn(
      'inline-flex items-center gap-2 rounded-full border bg-white px-3 py-[6px] text-[12px] font-semibold tabular-nums',
      ok ? 'border-[#E8EAF0] text-[#0F1728]' : 'border-[#F8E2B8] text-[#A25D07]'
    )}>
      <span className={cn('h-2 w-2 rounded-full', ok ? 'bg-[#25A25A]' : 'bg-[#F0A020]')} />
      {settings?.display_number || 'Not connected'}
      {settings?.sending_paused ? ' · PAUSED' : ''}
    </span>
  );
}

