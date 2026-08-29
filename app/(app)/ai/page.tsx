'use client';

// =============================================================================
// AI COO v2 — persistent, full-system-aware chat.
// Left rail: conversation history (stored in DB). Main: streaming chat over a
// live snapshot of the ENTIRE CRM — pipeline, revenue, meetings, campaigns,
// cases, activity — with deep dossiers for any client you mention.
// =============================================================================
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { Sparkles, Plus, Send, Square, Trash2, MessageSquare, PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Msg { role: 'user' | 'assistant'; content: string; }
interface Conv { id: string; title: string; updated_at: string; }

const SUGGESTIONS = [
  'Give me a full business briefing for today',
  'Who are my hottest leads right now and what should I do with each?',
  'How is revenue tracking this month vs pending payments?',
  'Which leads have gone stale and need reviving?',
  'What meetings do I have coming up, and any no-shows to chase?',
  'How did my last email campaign perform?',
  'Draft a follow-up message for my most recent hot lead',
  'Where are my delivery cases stuck?',
];

export default function AIPage() {
  const { leads } = useApp();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [setupError, setSetupError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const liveBadge = useMemo(() => `${leads.length.toLocaleString()} leads live`, [leads.length]);

  const loadConvs = useCallback(async () => {
    try {
      const r = await fetch('/api/ai/conversations');
      const d = await r.json();
      if (d.ok) setConvs(d.conversations);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { void loadConvs(); }, [loadConvs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  async function openConv(id: string) {
    if (streaming) stop();
    setActiveConv(id); setLoadingConv(true); setMessages([]);
    try {
      const r = await fetch(`/api/ai/conversations?id=${id}`);
      const d = await r.json();
      if (d.ok) setMessages(d.messages.map((m: Msg) => ({ role: m.role, content: m.content })));
    } catch { /* ignore */ }
    setLoadingConv(false);
  }

  async function deleteConv(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    await fetch(`/api/ai/conversations?id=${id}`, { method: 'DELETE' });
    setConvs((prev) => prev.filter((c) => c.id !== id));
    if (activeConv === id) { setActiveConv(null); setMessages([]); }
  }

  function newChat() {
    if (streaming) stop();
    setActiveConv(null); setMessages([]); setInput('');
    taRef.current?.focus();
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setSetupError('');
    setMessages((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConv, message: q }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        if (res.status === 501) setSetupError(d.error);
        setMessages((prev) => prev.slice(0, -1).concat({ role: 'assistant', content: `⚠️ ${d.error || 'Something went wrong.'}` }));
        setStreaming(false);
        return;
      }
      const convId = res.headers.get('x-conversation-id');
      if (convId && !activeConv) setActiveConv(convId);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              acc += evt.delta.text;
              setMessages((prev) => prev.slice(0, -1).concat({ role: 'assistant', content: acc }));
            }
          } catch { /* partial */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages((prev) => prev.slice(0, -1).concat({ role: 'assistant', content: '⚠️ Network error — please try again.' }));
      }
    }
    setStreaming(false);
    abortRef.current = null;
    void loadConvs();
  }

  const empty = messages.length === 0 && !loadingConv;

  return (
    <div className="flex h-[calc(100dvh-56px)] md:h-screen overflow-hidden animate-pageIn">
      {/* Conversation rail */}
      <div className={cn('flex-shrink-0 border-r border-border bg-surface-2/50 transition-all overflow-hidden flex flex-col', railOpen ? 'w-[240px]' : 'w-0')}>
        <div className="p-3 flex-shrink-0">
          <button onClick={newChat} className="btn btn-primary w-full justify-center"><Plus className="w-4 h-4" /> New chat</button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint px-2 mb-1.5">History</div>
          {convs.length === 0 && <div className="text-[12px] text-faint px-2 py-3">Your conversations will appear here.</div>}
          {convs.map((c) => (
            <div key={c.id} onClick={() => void openConv(c.id)}
              className={cn('group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer mb-0.5 transition', activeConv === c.id ? 'bg-indigo-soft text-indigo' : 'hover:bg-surface-2 text-ink')}>
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
              <span className="text-[12.5px] font-medium truncate flex-1">{c.title}</span>
              <button onClick={(e) => void deleteConv(c.id, e)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-muted hover:text-red-600 transition"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border flex-shrink-0">
          <button onClick={() => setRailOpen((v) => !v)} className="p-1.5 rounded-md hover:bg-surface-2 text-muted" title="Toggle history">
            {railOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>
          <div className="w-8 h-8 rounded-[9px] bg-gradient-to-br from-indigo to-[#16294E] flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-white" /></div>
          <div className="min-w-0">
            <div className="text-[15px] font-bold text-ink leading-tight">AI COO</div>
            <div className="text-[11px] text-muted leading-tight">Knows your whole business · {liveBadge}</div>
          </div>
          <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE DATA
          </span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {setupError && (
            <div className="max-w-[720px] mx-auto mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-900">
              <b>Setup needed:</b> {setupError}
            </div>
          )}
          {loadingConv && <div className="max-w-[720px] mx-auto text-center text-muted text-[13px] py-10"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading conversation…</div>}
          {empty ? (
            <div className="max-w-[720px] mx-auto pt-8 sm:pt-14">
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo to-[#16294E] flex items-center justify-center mx-auto mb-4"><Sparkles className="w-7 h-7 text-white" /></div>
                <h1 className="text-[22px] font-bold text-ink mb-1.5">Ask your COO anything</h1>
                <p className="text-[13.5px] text-muted max-w-[440px] mx-auto">Every answer draws on your live pipeline, revenue, meetings, campaigns, cases and full activity history — mention any client by name for a deep dive.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => void send(s)} className="text-left panel px-4 py-3 text-[13px] text-ink hover:border-indigo hover:text-indigo transition">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-[720px] mx-auto space-y-5">
              {messages.map((m, i) => (
                <ChatMessage key={i} msg={m} streaming={streaming && i === messages.length - 1 && m.role === 'assistant'} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-4 sm:px-6 py-3.5 flex-shrink-0">
          <div className="max-w-[720px] mx-auto flex items-end gap-2.5">
            <textarea
              ref={taRef} value={input} rows={1} placeholder="Ask about your pipeline, a client, revenue, meetings, campaigns…"
              onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              className="flex-1 px-4 py-3 border border-border rounded-2xl text-[13.5px] focus:border-indigo outline-none resize-none leading-relaxed"
            />
            {streaming ? (
              <button onClick={stop} className="w-11 h-11 rounded-full bg-ink text-white flex items-center justify-center flex-shrink-0" title="Stop"><Square className="w-4 h-4" /></button>
            ) : (
              <button onClick={() => void send()} disabled={!input.trim()} className="w-11 h-11 rounded-full bg-indigo text-white flex items-center justify-center flex-shrink-0 disabled:opacity-35" title="Send"><Send className="w-[18px] h-[18px]" /></button>
            )}
          </div>
          <div className="max-w-[720px] mx-auto text-[10.5px] text-faint mt-1.5 px-1">Enter to send · Shift+Enter for a new line · answers use live CRM data</div>
        </div>
      </div>
    </div>
  );
}

// ---------- message rendering (lightweight markdown) ----------
function ChatMessage({ msg, streaming }: { msg: Msg; streaming: boolean }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-indigo text-white rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%] text-[13.5px] leading-relaxed whitespace-pre-wrap">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo to-[#16294E] flex items-center justify-center flex-shrink-0 mt-0.5"><Sparkles className="w-3.5 h-3.5 text-white" /></div>
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink">
        {msg.content ? <MarkdownText text={msg.content} /> : <span className="inline-flex gap-1 items-center text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the business…</span>}
        {streaming && msg.content && <span className="inline-block w-1.5 h-4 bg-indigo ml-0.5 animate-pulse align-text-bottom" />}
      </div>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l) || !l.trim())) {
          return (
            <ul key={bi} className="space-y-1 pl-1">
              {lines.filter((l) => l.trim()).map((l, li) => (
                <li key={li} className="flex gap-2"><span className="text-indigo mt-[1px]">•</span><span>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</span></li>
              ))}
            </ul>
          );
        }
        if (/^#{1,4}\s/.test(lines[0])) {
          const h = lines[0].replace(/^#{1,4}\s+/, '');
          const rest = lines.slice(1).join('\n');
          return (
            <div key={bi}>
              <div className="font-bold text-ink text-[14px] mb-1">{inline(h)}</div>
              {rest.trim() && <div className="whitespace-pre-wrap">{inline(rest)}</div>}
            </div>
          );
        }
        return <p key={bi} className="whitespace-pre-wrap">{inline(block)}</p>;
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <b key={i} className="font-bold text-ink">{p.slice(2, -2)}</b>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="bg-surface-2 rounded px-1 py-0.5 text-[12px] font-mono">{p.slice(1, -1)}</code>;
    return p;
  });
}
