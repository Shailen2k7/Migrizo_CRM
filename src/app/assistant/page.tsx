"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Sparkles, User } from "lucide-react";
import { useStore } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import { computeKPIs, forBusiness } from "@/lib/metrics";
import { AssistantReply, answer } from "@/lib/assistant";
import { Button, Card, Input, cn } from "@/components/ui";

interface Message {
  role: "user" | "assistant";
  content: string;
  reply?: AssistantReply;
}

const SUGGESTIONS = [
  "Where did my money go this month?",
  "Biggest expenses?",
  "Show all marketing spend",
  "Compare this month vs last month",
  "Predict next month's cash flow",
  "Top clients this year?",
  "Upcoming liabilities?",
  "Which subscriptions should I cancel?",
  "How can I improve profitability?",
];

export default function AssistantPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const loans = useStore((s) => s.loans);
  const cards = useStore((s) => s.cards);
  const invoices = useStore((s) => s.invoices);
  const recurring = useStore((s) => s.recurring);
  const openingBalances = useStore((s) => s.openingBalances);
  const biz = BUSINESSES.find((b) => b.id === activeBusiness)!;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ctx = useMemo(() => {
    const txns = forBusiness(transactions, activeBusiness);
    const bl = loans.filter((l) => l.businessId === activeBusiness);
    const bc = cards.filter((c) => c.businessId === activeBusiness);
    const bi = invoices.filter((i) => i.businessId === activeBusiness);
    const br = recurring.filter((r) => r.businessId === activeBusiness);
    return {
      txns,
      loans: bl,
      cards: bc,
      invoices: bi,
      recurring: br,
      kpis: computeKPIs(txns, bl, bc, bi, br, openingBalances[activeBusiness]),
      businessName: biz.name,
    };
  }, [transactions, loans, cards, invoices, recurring, activeBusiness, openingBalances, biz.name]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const ask = (q: string) => {
    const query = q.trim();
    if (!query) return;
    setMessages((m) => [...m, { role: "user", content: query }]);
    setInput("");
    setThinking(true);
    // Small delay for a natural feel
    setTimeout(() => {
      const reply = answer(query, ctx);
      setMessages((m) => [...m, { role: "assistant", content: reply.text, reply }]);
      setThinking(false);
    }, 450);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-[900px] flex-col">
      <div className="animate-fade-up pb-4">
        <p className="label-caps mb-1">{biz.name} · Powered by your live data</p>
        <h1 className="text-3xl font-bold tracking-tight">AI Finance Assistant</h1>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col p-0" hover={false}>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles size={26} />
              </div>
              <div>
                <p className="text-lg font-semibold">Ask anything about {biz.name}&apos;s finances</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-text-3">
                  I analyze your live transactions, cards, loans and subscriptions to answer in
                  plain language.
                </p>
              </div>
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-xs font-medium text-text-2 transition-all hover:border-primary/50 hover:text-text"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && (
                <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles size={15} />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-4 py-3",
                  m.role === "user"
                    ? "bg-primary text-primary-fg"
                    : "border border-border bg-surface-2/70"
                )}
              >
                <p className="text-sm leading-relaxed">{m.content}</p>
                {m.reply?.bullets && (
                  <ul className="mt-2.5 space-y-1.5">
                    {m.reply.bullets.map((b, j) => (
                      <li key={j} className="flex gap-2 text-[13px] leading-relaxed text-text-2">
                        <span className="mt-1.5 h-1 w-1 flex-none rounded-full bg-primary" />
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
                {m.reply?.table && (
                  <div className="mt-3 overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-surface-3/50 text-left">
                          {m.reply.table.headers.map((h) => (
                            <th key={h} className="label-caps px-3 py-2 !text-[10px] font-semibold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {m.reply.table.rows.map((r, ri) => (
                          <tr key={ri} className="border-b border-border/40 last:border-0">
                            {r.map((c, ci) => (
                              <td key={ci} className={cn("px-3 py-2", ci > 0 && String(c).startsWith("₹") && "num")}>
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-surface-3 text-text-2">
                  <User size={15} />
                </div>
              )}
            </div>
          ))}

          {thinking && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                <Sparkles size={15} className="animate-pulse" />
              </div>
              <div className="rounded-lg border border-border bg-surface-2/70 px-4 py-3">
                <span className="flex gap-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-3"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border p-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${biz.name}'s money — revenue, spend, runway, subscriptions…`}
              className="flex-1"
            />
            <Button variant="primary" type="submit" disabled={!input.trim() || thinking}>
              <Send size={15} />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
