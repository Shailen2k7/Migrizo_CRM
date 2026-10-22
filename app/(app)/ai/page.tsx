'use client';

// =============================================================================
// AI COO v3 — chat over live database tools.
// The assistant streams its answer AND its work: `status` events show what it
// is searching ("Searching all notes for \"october\"…"), and ```coo-viz```
// blocks render as a mini dashboard — KPI cards, two-period comparison bars,
// tables — instead of raw markdown.
// =============================================================================
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { Sparkles, Plus, Send, Square, Trash2, MessageSquare, PanelLeftClose, PanelLeft, Loader2, Search, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Msg { role: 'user' | 'assistant'; content: string; }
interface Conv { id: string; title: string; updated_at: string; }

const SUGGESTIONS = [
  'Compare this month vs last month — leads, revenue, meetings, everything',
  'Search every note: who asked to be contacted in October?',
  'Give me a full business briefing for today',
  'Who are my hottest leads right now and what should I do with each?',
  'Which paying clients have gone quiet? Check notes and payments',
  'How many Meta leads came this week vs the week before?',
  'Which leads said "maybe" on willingness to pay but have high scores?',
  'Draft a follow-up message for everyone whose follow-up date has passed',
];

export default function AIPage() {
  const { leads } = useApp();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
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
  }, [messages, streaming, liveStatus]);

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
    setLiveStatus('');
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setSetupError('');
    setMessages((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setLiveStatus('Reading the business…');
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
        setStreaming(false); setLiveStatus('');
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
              setLiveStatus('');
              setMessages((prev) => prev.slice(0, -1).concat({ role: 'assistant', content: acc }));
            } else if (evt.type === 'status') {
              setLiveStatus(evt.text || '');
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
    setLiveStatus('');
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
            <div className="text-[11px] text-muted leading-tight">Searches the whole CRM live · {liveBadge}</div>
          </div>
          <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[10.5px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIVE DATA
          </span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {setupError && (
            <div className="max-w-[760px] mx-auto mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-900">
              <b>Setup needed:</b> {setupError}
            </div>
          )}
          {loadingConv && <div className="max-w-[760px] mx-auto text-center text-muted text-[13px] py-10"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading conversation…</div>}
          {empty ? (
            <div className="max-w-[760px] mx-auto pt-8 sm:pt-14">
              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo to-[#16294E] flex items-center justify-center mx-auto mb-4"><Sparkles className="w-7 h-7 text-white" /></div>
                <h1 className="text-[22px] font-bold text-ink mb-1.5">Ask your COO anything</h1>
                <p className="text-[13.5px] text-muted max-w-[480px] mx-auto">It searches your live database as it answers — every note on every lead, any period, any comparison — and shows its work.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => void send(s)} className="text-left panel px-4 py-3 text-[13px] text-ink hover:border-indigo hover:text-indigo transition">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-[760px] mx-auto space-y-5">
              {messages.map((m, i) => (
                <ChatMessage key={i} msg={m}
                  streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
                  status={streaming && i === messages.length - 1 ? liveStatus : ''} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-4 sm:px-6 py-3.5 flex-shrink-0">
          <div className="max-w-[760px] mx-auto flex items-end gap-2.5">
            <textarea
              ref={taRef} value={input} rows={1} placeholder="Ask anything — it can search every note, compare any periods…"
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
          <div className="max-w-[760px] mx-auto text-[10.5px] text-faint mt-1.5 px-1">Enter to send · Shift+Enter for a new line · answers query the live CRM</div>
        </div>
      </div>
    </div>
  );
}

// ---------- message rendering -------------------------------------------------

function ChatMessage({ msg, streaming, status }: { msg: Msg; streaming: boolean; status: string }) {
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
        {msg.content ? <RichText text={msg.content} streaming={streaming} /> : !status && <span className="inline-flex gap-1 items-center text-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…</span>}
        {status && (
          <div className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-full bg-indigo-soft text-indigo text-[12px] font-semibold">
            <Search className="w-3.5 h-3.5 animate-pulse" /> {status}
          </div>
        )}
        {streaming && msg.content && !status && <span className="inline-block w-1.5 h-4 bg-indigo ml-0.5 animate-pulse align-text-bottom" />}
      </div>
    </div>
  );
}

// Split the answer into markdown segments and ```coo-viz``` dashboard blocks.
function RichText({ text, streaming }: { text: string; streaming: boolean }) {
  const re = /```coo-viz\s*\n?([\s\S]*?)```/g;
  const parts: Array<{ kind: 'md' | 'viz'; body: string }> = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: 'md', body: text.slice(last, m.index) });
    parts.push({ kind: 'viz', body: m[1] });
    last = m.index + m[0].length;
  }
  let rest = text.slice(last);
  let vizPending = false;
  const open = rest.indexOf('```coo-viz');
  if (open >= 0) { vizPending = true; rest = rest.slice(0, open); } // hide a half-streamed block
  if (rest.trim()) parts.push({ kind: 'md', body: rest });

  return (
    <div className="space-y-3">
      {parts.map((p, i) => p.kind === 'viz'
        ? <VizBlock key={i} json={p.body} />
        : <MarkdownText key={i} text={p.body} />)}
      {vizPending && streaming && (
        <div className="panel px-4 py-3 text-[12.5px] text-muted inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Building the dashboard…</div>
      )}
    </div>
  );
}

// ---------- the mini dashboard ------------------------------------------------

interface Kpi { label: string; value: string; delta?: string; good?: boolean }
interface Viz {
  title?: string;
  kpis?: Kpi[];
  compare?: { a: string; b: string; rows: { label: string; a: number; b: number }[] };
  table?: { columns: string[]; rows: (string | number)[][] };
}

function VizBlock({ json }: { json: string }) {
  let viz: Viz | null = null;
  try { viz = JSON.parse(json) as Viz; } catch { return null; }
  if (!viz || typeof viz !== 'object') return null;
  const fmt = (n: number) => Math.abs(n) >= 1000 ? n.toLocaleString('en-IN') : String(Math.round(n * 100) / 100);

  return (
    <div className="panel overflow-hidden my-1">
      {viz.title && <div className="px-4 pt-3.5 pb-1 text-[13.5px] font-bold text-ink">{viz.title}</div>}

      {Array.isArray(viz.kpis) && viz.kpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-4 py-3">
          {viz.kpis.slice(0, 6).map((k, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface-2/60 px-3.5 py-3">
              <div className="text-[10.5px] font-bold uppercase tracking-wide text-faint truncate">{String(k.label ?? '')}</div>
              <div className="text-[19px] font-bold text-ink leading-tight mt-0.5">{String(k.value ?? '—')}</div>
              {k.delta && (
                <div className={cn('inline-flex items-center gap-1 text-[11px] font-bold mt-1 px-1.5 py-0.5 rounded-full',
                  k.good === false ? 'bg-red-50 text-red-600' : k.good === true ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-muted')}>
                  {k.good === false ? <TrendingDown className="w-3 h-3" /> : k.good === true ? <TrendingUp className="w-3 h-3" /> : null}
                  {String(k.delta)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {viz.compare && Array.isArray(viz.compare.rows) && viz.compare.rows.length > 0 && (
        <div className="px-4 pb-3.5 pt-1">
          <div className="flex items-center gap-4 text-[11px] font-semibold text-muted mb-2">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-indigo" /> {String(viz.compare.a)}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300" /> {String(viz.compare.b)}</span>
          </div>
          <div className="space-y-2.5">
            {viz.compare.rows.slice(0, 10).map((r, i) => {
              const a = Number(r.a) || 0; const b = Number(r.b) || 0;
              const max = Math.max(a, b, 1);
              return (
                <div key={i}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="font-medium text-ink">{String(r.label ?? '')}</span>
                    <span className="text-muted font-semibold">{fmt(a)} <span className="text-faint font-normal">vs</span> {fmt(b)}</span>
                  </div>
                  <div className="space-y-[3px]">
                    <div className="h-[9px] rounded-full bg-indigo transition-all" style={{ width: `${Math.max((a / max) * 100, 2)}%` }} />
                    <div className="h-[9px] rounded-full bg-slate-300 transition-all" style={{ width: `${Math.max((b / max) * 100, 2)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viz.table && Array.isArray(viz.table.columns) && Array.isArray(viz.table.rows) && (
        <div className="px-4 pb-4 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-faint border-b border-border">
                {viz.table.columns.slice(0, 8).map((c, i) => <th key={i} className={cn('py-1.5 pr-3', i > 0 && 'text-right')}>{String(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {viz.table.rows.slice(0, 12).map((row, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {(Array.isArray(row) ? row : [row]).slice(0, 8).map((cell, ci) => (
                    <td key={ci} className={cn('py-1.5 pr-3', ci > 0 ? 'text-right font-semibold text-ink tabular-nums' : 'text-ink font-medium')}>{String(cell ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- lightweight markdown (now with tables) -----------------------------

function MarkdownText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const tableLines = lines.filter((l) => l.trim().startsWith('|'));
        if (tableLines.length >= 2) return <MdTable key={bi} lines={tableLines} />;
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

function MdTable({ lines }: { lines: string[] }) {
  const parse = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const rows = lines.map(parse).filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
  if (!rows.length) return null;
  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto panel px-3 py-2">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-faint border-b border-border">
            {head.map((c, i) => <th key={i} className="py-1.5 pr-3">{inline(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-b border-border/50 last:border-0">
              {r.map((c, ci) => <td key={ci} className="py-1.5 pr-3 align-top">{inline(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
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
