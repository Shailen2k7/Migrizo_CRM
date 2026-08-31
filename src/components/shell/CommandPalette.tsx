"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  BookOpenText,
  FileUp,
  Landmark,
  LayoutDashboard,
  LineChart,
  RefreshCcw,
  Search,
  Sparkles,
  Tags,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { fmtSigned } from "@/lib/format";
import { cn } from "@/components/ui";
import { BUSINESSES } from "@/lib/seed";

const PAGES = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/import", label: "Import Statements", icon: FileUp },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/income-expenses", label: "Income & Expenses", icon: Tags },
  { href: "/loans", label: "Loans & Credit", icon: Landmark },
  { href: "/accounting", label: "Accounting Reports", icon: BookOpenText },
  { href: "/recurring", label: "Recurring Expenses", icon: RefreshCcw },
  { href: "/analytics", label: "Founder Analytics", icon: LineChart },
  { href: "/assistant", label: "AI Finance Assistant", icon: Sparkles },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const transactions = useStore((s) => s.transactions);
  const loans = useStore((s) => s.loans);
  const setActiveBusiness = useStore((s) => s.setActiveBusiness);

  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return { pages: PAGES, txns: [], invs: [], lns: [] };
    const pages = PAGES.filter((p) => p.label.toLowerCase().includes(query));
    const txns = transactions
      .filter(
        (t) =>
          t.description.toLowerCase().includes(query) ||
          t.category.toLowerCase().includes(query) ||
          (t.vendor ?? "").toLowerCase().includes(query) ||
          (t.client ?? "").toLowerCase().includes(query) ||
          String(t.amount).includes(query)
      )
      .slice(0, 8);
    const lns = loans
      .filter(
        (l) => l.name.toLowerCase().includes(query) || l.lender.toLowerCase().includes(query)
      )
      .slice(0, 3);
    return { pages, txns, lns };
  }, [q, transactions, loans]);

  if (!open) return null;

  const go = (href: string, businessId?: string) => {
    if (businessId) setActiveBusiness(businessId as "migrizo" | "nutrolis");
    router.push(href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border-strong/40 shadow-float animate-scale-in"
        style={{ background: "var(--glass-bg)", backdropFilter: "blur(32px)" }}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={16} className="text-text-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything — transactions, clients, vendors, loans…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-text-3"
          />
          <kbd className="rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-text-3">
            ESC
          </kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.pages.length > 0 && (
            <Section title="Navigate">
              {results.pages.map((p) => (
                <Row key={p.href} onClick={() => go(p.href)}>
                  <p.icon size={15} className="text-text-3" />
                  <span className="text-sm font-medium">{p.label}</span>
                </Row>
              ))}
            </Section>
          )}
          {results.txns.length > 0 && (
            <Section title="Transactions">
              {results.txns.map((t) => (
                <Row key={t.id} onClick={() => go("/transactions", t.businessId)}>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      t.type === "credit" ? "bg-positive" : "bg-negative"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.description}</span>
                  <span className="text-[10px] uppercase text-text-3">
                    {BUSINESSES.find((b) => b.id === t.businessId)?.name}
                  </span>
                  <span
                    className={cn(
                      "num text-xs font-semibold",
                      t.type === "credit" ? "text-positive" : "text-negative"
                    )}
                  >
                    {fmtSigned(t.amount, t.type)}
                  </span>
                </Row>
              ))}
            </Section>
          )}
          {results.lns.length > 0 && (
            <Section title="Loans">
              {results.lns.map((l) => (
                <Row key={l.id} onClick={() => go("/loans", l.businessId)}>
                  <Landmark size={14} className="text-text-3" />
                  <span className="flex-1 truncate text-sm">
                    {l.name} — {l.lender}
                  </span>
                </Row>
              ))}
            </Section>
          )}
          {q &&
            results.pages.length === 0 &&
            results.txns.length === 0 &&
            results.lns.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-text-3">
                No results for “{q}”
              </p>
            )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="label-caps px-3 pb-1 pt-2">{title}</p>
      {children}
    </div>
  );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-3/70"
    >
      {children}
    </button>
  );
}
