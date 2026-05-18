'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@/components/shared/app-provider';
import { useUI } from '@/components/shared/app-shell';
import { Sparkles, Send, RotateCcw, AlertTriangle, Zap, Target, TrendingUp, Clock, MessageSquare, Bot, User as UserIcon } from 'lucide-react';
import { formatINR } from '@/lib/utils';
import { toast } from 'sonner';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const STARTER_PROMPTS = [
  { icon: Clock,       text: 'Who should I call today and why?' },
  { icon: Target,      text: 'Audit my pipeline — where am I losing deals?' },
  { icon: MessageSquare, text: 'Draft a follow-up for my most overdue lead' },
  { icon: TrendingUp,  text: 'What\u2019s my single biggest revenue risk this week?' },
  { icon: Zap,         text: 'Which 3 hot leads should I prioritize? Give me a tactical plan.' },
  { icon: AlertTriangle, text: 'Why is my proposal-to-won conversion not better? Be honest.' },
];

export default function AIPage() {
  const { leads, payments, user } = useApp();
  const ui = useUI();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Quick insight cards (live computed)
  const insights = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const overdueFu = leads.filter((l) => l.next_follow_up && new Date(l.next_follow_up).getTime() < now && !['won', 'lost'].includes(l.stage));
    const hot = leads.filter((l) => l.score >= 75 && !['won', 'lost'].includes(l.stage));
    const proposals = leads.filter((l) => l.stage === 'proposal');
    const overduePay = payments.filter((p) => p.status === 'overdue' || (p.status === 'pending' && p.due_date && new Date(p.due_date).getTime() < now));
    const overduePayAmt = overduePay.reduce((s, p) => s + p.amount, 0);
    return [
      { label: 'Overdue follow-ups', value: overdueFu.length, color: '#B91C1C', bg: 'hsl(var(--rose-soft))', icon: Clock },
      { label: 'Hot in pipeline',   value: hot.length,       color: '#B45309', bg: 'hsl(var(--amber-soft))', icon: Zap },
      { label: 'At proposal',       value: proposals.length, color: '#4338CA', bg: 'hsl(var(--indigo-soft))', icon: Target },
      { label: 'Overdue ₹',         value: formatINR(overduePayAmt), color: '#B91C1C', bg: 'hsl(var(--rose-soft))', icon: AlertTriangle },
    ];
  }, [leads, payments]);

  const autoResize = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || streaming) return;

    const newMessages: Msg[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    // Reset textarea height
    if (taRef.current) taRef.current.style.height = 'auto';

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Only send the chat turns, not the empty placeholder
          messages: newMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        let parsed = errText;
        try { parsed = JSON.parse(errText).error || errText; } catch {}
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: `⚠ ${parsed || 'Request failed'}` };
          return next;
        });
        toast.error(parsed.length < 120 ? parsed : 'AI request failed');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: buf };
          return next;
        });
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // User cancelled — keep partial content
      } else {
        const errMsg = e instanceof Error ? e.message : 'Network error';
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: `⚠ ${errMsg}` };
          return next;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming]);

  const stop = () => abortRef.current?.abort();
  const reset = () => { stop(); setMessages([]); };

  return (
    <div className="max-w-[1080px] mx-auto px-6 md:px-8 pt-7 pb-4 h-screen flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] md:text-[28px] font-bold tracking-tight leading-[1.1] flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366F1,#7C3AED)', color: '#fff' }}>
              <Sparkles className="w-[18px] h-[18px]" />
            </span>
            AI COO
          </h1>
          <p className="text-[13px] text-muted mt-1.5">Live access to your workspace · ground-truth advice, not generic tips</p>
        </div>
        {messages.length > 0 && (
          <button onClick={reset} className="btn btn-ghost btn-sm" title="Clear conversation">
            <RotateCcw className="w-3.5 h-3.5" /> New chat
          </button>
        )}
      </div>

      {/* Compact KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {insights.map((i) => {
          const Icon = i.icon;
          return (
            <div key={i.label} className="bg-surface border border-border rounded-xl p-3 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: i.bg, color: i.color }}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-wider text-muted font-semibold truncate">{i.label}</div>
                <div className="num text-[16px] font-bold leading-tight">{i.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Chat area */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-surface border border-border rounded-2xl p-4 md:p-5 mb-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg,#6366F1,#7C3AED)', color: '#fff' }}>
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-[18px] font-semibold mb-2">Ask anything about your pipeline</h2>
            <p className="text-[13px] text-muted mb-6 max-w-md leading-relaxed">
              I have live access to every lead, payment, and activity in your workspace. Try one of these, or type your own question:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-2xl">
              {STARTER_PROMPTS.map((p, i) => {
                const Icon = p.icon;
                return (
                  <button key={i} onClick={() => send(p.text)} className="text-left flex items-start gap-3 p-3 rounded-xl border border-border bg-surface hover:border-indigo hover:bg-indigo-soft transition-all group">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-all" style={{ background: 'hsl(var(--indigo-soft))', color: '#4338CA' }}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[12.5px] text-ink-2 group-hover:text-ink leading-snug pt-0.5">{p.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-w-3xl mx-auto">
            {messages.map((m, i) => <ChatMessage key={i} msg={m} streaming={streaming && i === messages.length - 1} />)}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="bg-surface border border-border rounded-2xl p-2.5 flex items-end gap-2 mb-2">
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); autoResize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask the AI COO… (Shift+Enter for new line)"
          rows={1}
          className="flex-1 resize-none bg-transparent border-0 outline-none px-3 py-2 text-[13.5px] text-ink placeholder:text-muted"
          style={{ maxHeight: 200 }}
          disabled={streaming}
        />
        {streaming ? (
          <button onClick={stop} className="btn btn-outline btn-sm">Stop</button>
        ) : (
          <button onClick={() => send()} disabled={!input.trim()} className="btn btn-primary disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted text-center">AI responses can be wrong. Verify before acting on financial or legal advice.</p>
    </div>
  );
}

function ChatMessage({ msg, streaming }: { msg: Msg; streaming: boolean }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{
          background: isUser ? '#0F1115' : 'linear-gradient(135deg,#6366F1,#7C3AED)', color: '#fff'
        }}>
          {isUser ? <UserIcon className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
        </div>
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'flex justify-end' : ''}`}>
        <div className={`inline-block max-w-full ${isUser ? 'bg-ink text-surface px-4 py-2.5 rounded-2xl rounded-tr-md text-[13.5px]' : 'text-[13.5px] text-ink-2 leading-relaxed'}`}>
          {isUser ? msg.content : <MarkdownText text={msg.content} streaming={streaming} />}
        </div>
      </div>
    </div>
  );
}

// Lightweight markdown renderer — handles **bold**, *italic*, `code`, bullets, numbered lists, headers, paragraphs
function MarkdownText({ text, streaming }: { text: string; streaming: boolean }) {
  if (!text && streaming) {
    return <span className="inline-flex items-center gap-1.5 text-muted">
      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" style={{ animationDelay: '0.15s' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" style={{ animationDelay: '0.3s' }} />
    </span>;
  }

  // Split into blocks by blank lines
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        // Headers
        if (/^###\s/.test(trimmed)) {
          return <h4 key={bi} className="font-semibold text-[14px] mt-3 mb-1.5 text-ink">{inline(trimmed.replace(/^###\s/, ''))}</h4>;
        }
        if (/^##\s/.test(trimmed)) {
          return <h3 key={bi} className="font-semibold text-[15px] mt-4 mb-2 text-ink">{inline(trimmed.replace(/^##\s/, ''))}</h3>;
        }
        if (/^#\s/.test(trimmed)) {
          return <h2 key={bi} className="font-bold text-[16px] mt-4 mb-2 text-ink">{inline(trimmed.replace(/^#\s/, ''))}</h2>;
        }

        // Unordered list
        if (trimmed.split('\n').every((l) => /^[-*•]\s/.test(l.trim()))) {
          return (
            <ul key={bi} className="space-y-1 my-2 pl-1">
              {trimmed.split('\n').map((line, li) => (
                <li key={li} className="flex gap-2"><span className="text-muted flex-shrink-0">•</span><span>{inline(line.replace(/^[-*•]\s/, ''))}</span></li>
              ))}
            </ul>
          );
        }

        // Ordered list
        if (trimmed.split('\n').every((l) => /^\d+\.\s/.test(l.trim()))) {
          return (
            <ol key={bi} className="space-y-1 my-2 pl-1 list-decimal list-inside">
              {trimmed.split('\n').map((line, li) => (
                <li key={li}>{inline(line.replace(/^\d+\.\s/, ''))}</li>
              ))}
            </ol>
          );
        }

        // Paragraph
        return <p key={bi} className="my-2 first:mt-0 last:mb-0">{inline(trimmed)}</p>;
      })}
      {streaming && <span className="inline-block w-1.5 h-3.5 bg-indigo-600 ml-0.5 align-middle animate-pulse" />}
    </>
  );
}

// Inline markdown: bold, italic, code
function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const patterns: { re: RegExp; render: (m: RegExpMatchArray) => React.ReactNode }[] = [
    { re: /\*\*([^*]+)\*\*/, render: (m) => <strong key={key} className="font-semibold text-ink">{m[1]}</strong> },
    { re: /`([^`]+)`/,       render: (m) => <code key={key} className="px-1.5 py-0.5 rounded bg-surface-2 text-[12.5px] font-mono text-ink">{m[1]}</code> },
    { re: /\*([^*]+)\*/,     render: (m) => <em key={key} className="italic">{m[1]}</em> },
  ];

  while (remaining.length > 0) {
    let earliest: { idx: number; len: number; node: React.ReactNode } | null = null;
    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && m.index !== undefined && (earliest === null || m.index < earliest.idx)) {
        earliest = { idx: m.index, len: m[0].length, node: p.render(m) };
      }
    }
    if (!earliest) { parts.push(remaining); break; }
    if (earliest.idx > 0) parts.push(remaining.slice(0, earliest.idx));
    parts.push(earliest.node);
    remaining = remaining.slice(earliest.idx + earliest.len);
    key++;
  }
  return <>{parts}</>;
}
