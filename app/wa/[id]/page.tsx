'use client';

// =============================================================================
// POP-OUT CHAT — double-click any conversation to open it here.
//
// Self-contained on purpose: no AppProvider, no sidebar, no 2,000-lead context
// to load. It mounts, paints the cached thread instantly, and subscribes to
// realtime. That is why it opens in a blink even as a brand-new browser window.
//
// It shares the thread cache and the message bubble with the inbox, so the two
// surfaces can never drift apart.
// =============================================================================
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Send as SendIcon, Paperclip, Smile, Loader2, Lock, ShieldCheck, Clock, X, Bot,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { initials, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MessageBubble } from '@/components/whatsapp/message-bubble';
import {
  getCachedThread, setCachedThread, patchCachedThread, fetchThread, threadsEqual,
} from '@/lib/whatsapp/thread-cache';
import {
  formatLeft, windowLeftMs, windowState,
  type WaConversation, type WaMessage, type WaSettings,
} from '@/lib/whatsapp/types';

const GROUP_MS = 5 * 60_000;
const EMOJI = ['👍','🙏','😊','🎉','✅','📄','📞','🇬🇧','🚀','💡','⏰','❤️'];

function dayLabel(iso: string) {
  const d = new Date(iso), t = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}
const firstName = (n: string) => n.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || n;

export default function PopoutChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = useMemo(() => createClient(), []);

  const [conv, setConv] = useState<WaConversation | null>(null);
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [msgs, setMsgs] = useState<WaMessage[]>(() => getCachedThread(id) ?? []);
  const [loading, setLoading] = useState(() => !getCachedThread(id));
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [, setTick] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tempSeq = useRef(0);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadConv = useCallback(async () => {
    {
      const { data: row } = await supabase
        .from('whatsapp_conversations')
        .select('*, lead:leads(full_name, visa_type, stage)')
        .eq('id', id).maybeSingle();
      if (row) {
        const r = row as Record<string, unknown>;
        const lead = (r.lead ?? null) as { full_name?: string; visa_type?: string; stage?: string } | null;
        setConv({
          id: String(r.id), lead_id: (r.lead_id as string) ?? null,
          phone_e164: String(r.phone_e164),
          lead_name: lead?.full_name || String(r.phone_e164),
          lead_stage: lead?.stage ?? null, visa_type: lead?.visa_type ?? null,
          owner_id: (r.owner_id as string) ?? null,
          status: (r.status as 'open' | 'closed') ?? 'open',
          unread_count: Number(r.unread_count ?? 0),
          needs_attention: Boolean(r.needs_attention),
          last_inbound_at: (r.last_inbound_at as string) ?? null,
          last_message_at: (r.last_message_at as string) ?? null,
          last_preview: (r.last_preview as string) ?? null,
          last_direction: (r.last_direction as 'in' | 'out') ?? null,
          window_open: false, window_expires_at: null, suppressed: false,
        });
        const { data: s } = await supabase.from('whatsapp_settings')
          .select('*').eq('workspace_id', r.workspace_id as string).maybeSingle();
        setSettings((s ?? null) as WaSettings | null);
        const { data: sup } = await supabase.from('whatsapp_suppressions')
          .select('phone_e164').eq('workspace_id', r.workspace_id as string)
          .eq('phone_e164', String(r.phone_e164)).maybeSingle();
        if (sup) setConv((c) => (c ? { ...c, suppressed: true } : c));
      }
    }
  }, [supabase, id]);

  useEffect(() => { loadConv(); }, [loadConv]);

  // Paint from cache first, refresh behind. This is why it opens instantly.
  useEffect(() => {
    let alive = true;
    const cached = getCachedThread(id);
    if (cached) { setMsgs(cached); setLoading(false); }
    fetchThread(supabase, id)
      .then((rows) => {
        if (!alive) return;
        setMsgs((prev) => (threadsEqual(prev, rows) ? prev : rows));
      })
      .catch((e) => { if (alive) toast.error(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    // Fire-and-forget: nobody should wait on a read receipt.
    supabase.rpc('whatsapp_mark_read', { p_conversation_id: id });
    return () => { alive = false; };
  }, [supabase, id]);

  // Realtime for this one conversation only — the cheapest possible channel.
  useEffect(() => {
    const ch = supabase
      .channel(`wa-pop-${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages', filter: `conversation_id=eq.${id}` },
        (payload) => {
          const row = payload.new as WaMessage | undefined;
          if (!row) return;
          setMsgs((prev) => {
            const i = prev.findIndex((m) => m.id === row.id);
            let next: WaMessage[];
            if (i >= 0) {
              if (prev[i].status === row.status && prev[i].body === row.body) return prev;
              next = [...prev]; next[i] = row;
            } else {
              const t = row.direction === 'out'
                ? prev.findIndex((m) => m.id.startsWith('tmp_') && m.direction === 'out' && m.body === row.body)
                : -1;
              if (t >= 0) { next = [...prev]; next[t] = row; }
              else next = [...prev, row];
            }
            setCachedThread(id, next);
            return next;
          });
          if (row.direction === 'in') {
            setConv((c) => (c ? { ...c, last_inbound_at: row.created_at } : c));
            supabase.rpc('whatsapp_mark_read', { p_conversation_id: id });
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, id]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const wState = conv ? windowState(conv.last_inbound_at) : 'shut';
  const wLeft = conv ? windowLeftMs(conv.last_inbound_at) : 0;
  const needSeconds = wLeft > 0 && wLeft < 3600_000;
  useEffect(() => {
    if (wLeft <= 0) return;
    const t = setInterval(() => setTick((n) => n + 1), needSeconds ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [wLeft, needSeconds]);

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

  // ── send ──────────────────────────────────────────────────────────────────
  const send = useCallback(async (
    body: string,
    media?: { path: string; mediaType: 'image' | 'document' | 'audio' | 'video'; name: string; mime: string; size: number }
  ) => {
    if (!conv) return;
    const text = body.trim();
    if (!text && !media) return;

    const tempId = `tmp_${tempSeq.current++}`;
    const optimistic: WaMessage = {
      id: tempId, workspace_id: '', conversation_id: id, lead_id: conv.lead_id,
      direction: 'out', body: text, template_code: null, template_category: null,
      variables: null, provider_msg_id: null, status: 'queued',
      error_code: null, error_detail: null, sent_by: null, sequence_step: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      media_path: media?.path ?? null, media_type: media?.mediaType ?? null,
      media_name: media?.name ?? null, media_mime: media?.mime ?? null,
      media_size: media?.size ?? null,
    };
    setMsgs((prev) => { const n = [...prev, optimistic]; setCachedThread(id, n); return n; });
    setDraft('');
    setSending(true);

    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: id, body: text, ...(media ? { media } : {}) }),
      });
      const json = await res.json();
      setMsgs((prev) => {
        const i = prev.findIndex((m) => m.id === tempId);
        if (i === -1) return prev;
        const next = [...prev];
        if (json.ok && json.messageId) {
          if (prev.some((m) => m.id === json.messageId)) { next.splice(i, 1); }
          else next[i] = { ...next[i], id: json.messageId, status: 'sent' };
        } else {
          next[i] = { ...next[i], status: 'failed', error_code: json.reason ?? 'send_failed', error_detail: json.detail ?? null };
        }
        setCachedThread(id, next);
        return next;
      });
      if (!json.ok) { toast.error(json.detail || json.reason || 'Send failed'); setDraft(text); }
      else if (json.dryRun) toast.warning('Dry-run is on — logged, not delivered');
    } catch (e) {
      patchCachedThread(id, (prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)));
      setMsgs((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed', error_detail: (e as Error).message } : m)));
      toast.error((e as Error).message);
      setDraft(text);
    } finally {
      setSending(false);
    }
  }, [conv, id]);

  async function onFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/whatsapp/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.ok) { toast.error(json.detail || json.reason || 'Upload failed'); return; }
      await send(draft, { path: json.path, mediaType: json.mediaType, name: json.name, mime: json.mime, size: json.size });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!conv) {
    return (
      <div className="flex h-full items-center justify-center text-[#7A8095]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const locked = conv.suppressed || wState === 'shut';

  return (
    <div className="flex h-full flex-col bg-white">
      {/* header */}
      <div className="flex h-[56px] flex-shrink-0 items-center justify-between border-b border-[#E8EAF0] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#E9EDFF] text-[13px] font-semibold text-[#3323cc]">
            {initials(conv.lead_name)}
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-[14.5px] font-semibold leading-tight text-[#0F1728]">{conv.lead_name}</h1>
            <span className="block truncate text-[11px] tabular-nums text-[#7A8095]">{conv.phone_e164}</span>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-[6px] rounded-full border px-[10px] py-1 text-[11.5px] font-semibold"
                style={{
                  background: wState === 'shut' ? '#F4F5F8' : '#EDFAF1',
                  borderColor: wState === 'shut' ? '#E8EAF0' : '#D7F3E1',
                  color: wState === 'shut' ? '#7A8095' : '#25A25A',
                }}>
            {wState === 'shut' ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {wState === 'shut' ? 'Closed' : formatLeft(wLeft)}
          </span>
          <button onClick={() => window.close()} title="Close window"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#7A8095] transition hover:bg-[#F4F5F8] hover:text-[#0F1728]">
            <X className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>

      {/* stream */}
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-[#FAFBFC] p-5">
        {loading && msgs.length === 0 && (
          <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-[#7A8095]" /></div>
        )}
        {groups.map((g, gi) =>
          g.kind === 'day' ? (
            <div key={`d${gi}`} className="my-1 text-center text-[11px] font-medium uppercase tracking-widest text-[#7A8095]">{g.label}</div>
          ) : (
            <div key={`g${gi}`} className={cn('flex flex-col gap-1', g.dir === 'out' ? 'items-end' : 'items-start')}>
              {g.items.map((m, i) => <MessageBubble key={m.id} m={m} last={i === g.items.length - 1} />)}
            </div>
          )
        )}
        {!loading && msgs.length === 0 && (
          <p className="py-16 text-center text-[13px] text-[#7A8095]">No messages yet.</p>
        )}
      </div>

      {/* composer */}
      <div className="flex-shrink-0 border-t border-[#E8EAF0] bg-white p-3">
        {conv.suppressed ? (
          <div className="flex items-center gap-3 rounded-lg border border-[#F8D6D6] bg-[#FEEFEF] px-4 py-3">
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-[#B02B2B]" />
            <span className="text-[12.4px] text-[#B02B2B]"><b>Opted out.</b> Nothing can be sent to this number.</span>
          </div>
        ) : wState === 'shut' ? (
          <div className="flex items-center gap-3 rounded-lg border border-[#F8E2B8] bg-[#FEF6E6] px-4 py-3">
            <Lock className="h-4 w-4 flex-shrink-0 text-[#A25D07]" />
            <span className="text-[12.4px] text-[#8A5206]">
              The 24-hour window is closed. Open the full inbox to send an approved template.
            </span>
          </div>
        ) : (
          <div className="relative rounded-lg border border-[#E8EAF0] transition focus-within:border-[#25A25A] focus-within:ring-1 focus-within:ring-[#25A25A]">
            {emojiOpen && (
              <div className="absolute bottom-full left-2 z-10 mb-2 flex flex-wrap gap-1 rounded-xl border border-[#E8EAF0] bg-white p-2 shadow-lg">
                {EMOJI.map((e) => (
                  <button key={e} onClick={() => { setDraft((d) => d + e); setEmojiOpen(false); }}
                    className="h-8 w-8 rounded-md text-[18px] transition hover:bg-[#F4F5F8]">{e}</button>
                ))}
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) send(draft); }
              }}
              placeholder={`Reply to ${firstName(conv.lead_name)}…`}
              className="block max-h-[140px] min-h-[54px] w-full resize-none border-0 bg-transparent p-3 text-[13px] leading-[1.6] outline-none placeholder:text-[#7A8095]"
            />
            <div className="flex items-center justify-between rounded-b-lg border-t border-[#E8EAF0] bg-[#FAFBFC] p-2">
              <div className="flex gap-1">
                <input ref={fileRef} type="file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} title="Attach a file"
                  className="rounded p-1.5 text-[#7A8095] transition hover:bg-[#E8EAF0] hover:text-[#0F1728] disabled:opacity-50">
                  {uploading ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Paperclip className="h-[18px] w-[18px]" />}
                </button>
                <button onClick={() => setEmojiOpen((v) => !v)} title="Emoji"
                  className="rounded p-1.5 text-[#7A8095] transition hover:bg-[#E8EAF0] hover:text-[#0F1728]">
                  <Smile className="h-[18px] w-[18px]" />
                </button>
              </div>
              <button
                disabled={!draft.trim()}
                onClick={() => send(draft)}
                className="flex items-center gap-2 rounded-md bg-[#131b2d] px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#2a3040] disabled:opacity-40"
              >
                Send <SendIcon className="h-[13px] w-[13px]" />
              </button>
            </div>
          </div>
        )}
        {settings?.dry_run && !locked && (
          <p className="m-0 mt-2 flex items-center gap-1.5 text-[11px] text-[#A25D07]">
            <Bot className="h-3 w-3" /> Dry-run is on — logged, never delivered.
          </p>
        )}
      </div>
    </div>
  );
}
