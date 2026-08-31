"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  Pencil,
  Scale,
  Search,
  Sparkles,
  Tags,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import { Transaction } from "@/lib/types";
import {
  fmtDate,
  fmtDateShort,
  fmtINR,
  fmtSigned,
  monthLabel,
  todayISO,
} from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Select, cn, toast } from "@/components/ui";
import { TXN_CLASSES, TxnClass, classLabel, classRole } from "@/lib/classify";
import { CategoryDonut, CHART_COLORS, RevenueSourceBars } from "@/components/charts";
import { TagEditor } from "@/components/TagEditor";
import { TransactionModal } from "@/components/TransactionModal";

type Preset = "latest" | "thisMonth" | "lastMonth" | "3m" | "6m" | "fy" | "12m" | "all" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "latest", label: "Latest Month" },
  { id: "thisMonth", label: "This Month" },
  { id: "lastMonth", label: "Last Month" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "fy", label: "This FY" },
  { id: "12m", label: "12M" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom" },
];

const endOfMonth = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};
const monthShift = (ym: string, back: number) => {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const PAGE_SIZE = 40;

export default function IncomeExpensesPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const smartTagAll = useStore((s) => s.smartTagAll);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const setTxnClass = useStore((s) => s.setTxnClass);
  const reclassify = useStore((s) => s.reclassify);
  const [onlyUnclassified, setOnlyUnclassified] = useState(false);

  const biz = BUSINESSES.find((b) => b.id === activeBusiness) ?? BUSINESSES[0];
  const [preset, setPreset] = useState<Preset>("latest");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [tagging, setTagging] = useState(false);

  const { range, rangeLabel, inPeriod } = useMemo(() => {
    const bizTxns = transactions.filter((t) => t.businessId === activeBusiness);
    let latest = "";
    bizTxns.forEach((t) => {
      if (t.date > latest) latest = t.date;
    });
    const ref = (latest || todayISO()).slice(0, 7);
    const today = todayISO();
    const curMonth = today.slice(0, 7);

    let from: string, to: string, rangeLabel: string;
    switch (preset) {
      case "thisMonth":
        from = `${curMonth}-01`; to = today; rangeLabel = monthLabel(curMonth);
        break;
      case "lastMonth": {
        const lm = monthShift(curMonth, 1);
        from = `${lm}-01`; to = endOfMonth(lm); rangeLabel = monthLabel(lm);
        break;
      }
      case "3m":
        from = `${monthShift(ref, 2)}-01`; to = endOfMonth(ref); rangeLabel = "Last 3 months";
        break;
      case "6m":
        from = `${monthShift(ref, 5)}-01`; to = endOfMonth(ref); rangeLabel = "Last 6 months";
        break;
      case "fy": {
        const y = Number(ref.slice(0, 4)), m = Number(ref.slice(5, 7));
        const fyStart = m >= 4 ? y : y - 1;
        from = `${fyStart}-04-01`; to = endOfMonth(ref); rangeLabel = `FY ${fyStart}–${String(fyStart + 1).slice(2)}`;
        break;
      }
      case "12m":
        from = `${monthShift(ref, 11)}-01`; to = endOfMonth(ref); rangeLabel = "Last 12 months";
        break;
      case "all": {
        let min = today;
        bizTxns.forEach((t) => { if (t.date < min) min = t.date; });
        from = min; to = today; rangeLabel = "All time";
        break;
      }
      case "custom":
        from = customFrom || `${ref}-01`; to = customTo || endOfMonth(ref);
        if (from > to) [from, to] = [to, from];
        rangeLabel = "Custom range";
        break;
      default:
        from = `${ref}-01`; to = endOfMonth(ref); rangeLabel = `${monthLabel(ref)} — latest month with data`;
    }

    const inPeriod = bizTxns.filter((t) => t.date >= from && t.date <= to);
    return { range: { from, to }, rangeLabel, inPeriod };
  }, [transactions, activeBusiness, preset, customFrom, customTo]);

  const { income, expenses, net, incomeByCat, expenseByCat, tagTotals, taggedPct } = useMemo(() => {
    let income = 0, expenses = 0, tagged = 0;
    const incomeMap = new Map<string, number>();
    const expenseMap = new Map<string, number>();
    const tagMap = new Map<string, number>();

    inPeriod.forEach((t) => {
      if (t.type === "credit") {
        income += t.amount;
        incomeMap.set(t.category, (incomeMap.get(t.category) ?? 0) + t.amount);
      } else {
        expenses += t.amount;
        expenseMap.set(t.category, (expenseMap.get(t.category) ?? 0) + t.amount);
      }
      if (t.tags.length > 0) tagged++;
      t.tags.forEach((tag) => tagMap.set(tag, (tagMap.get(tag) ?? 0) + t.amount));
    });

    const toSorted = (m: Map<string, number>) =>
      Array.from(m.entries()).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);

    return {
      income,
      expenses,
      net: income - expenses,
      incomeByCat: toSorted(incomeMap),
      expenseByCat: toSorted(expenseMap),
      tagTotals: Array.from(tagMap.entries())
        .map(([name, amount]) => ({ name: `#${name}`, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
      taggedPct: inPeriod.length ? Math.round((tagged / inPeriod.length) * 100) : 100,
    };
  }, [inPeriod]);

  const allTagsInPeriod = useMemo(() => {
    const s = new Set<string>();
    inPeriod.forEach((t) => t.tags.forEach((tag) => s.add(tag)));
    return Array.from(s).sort();
  }, [inPeriod]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inPeriod
      .filter((t) => {
        if (onlyUnclassified && t.txnClass && t.txnClass !== "uncategorized") return false;
        if (activeCategory && t.category !== activeCategory) return false;
        if (activeTags.size > 0 && !t.tags.some((tag) => activeTags.has(tag))) return false;
        if (q) {
          const hay = `${t.description} ${t.category} ${t.vendor ?? ""} ${t.tags.join(" ")}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [inPeriod, activeCategory, activeTags, search, onlyUnclassified]);

  const unclassifiedCount = useMemo(
    () => inPeriod.filter((t) => !t.txnClass || t.txnClass === "uncategorized").length,
    [inPeriod]
  );

  const pageRows = filtered.slice(0, (page + 1) * PAGE_SIZE);

  const toggleTag = (tag: string) => {
    setActiveTags((s) => {
      const n = new Set(s);
      if (n.has(tag)) n.delete(tag);
      else n.add(tag);
      return n;
    });
    setPage(0);
  };

  const runSmartTag = async () => {
    setTagging(true);
    await new Promise((r) => setTimeout(r, 200)); // let the spinner paint
    const count = smartTagAll(activeBusiness);
    setTagging(false);
    toast(count > 0 ? `Tagged ${count} transaction${count === 1 ? "" : "s"}` : "Everything is already tagged", count > 0 ? "success" : "info");
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <p className="label-caps mb-1">{biz.name}</p>
          <h1 className="text-3xl font-bold tracking-tight">Income &amp; Expenses</h1>
          <p className="mt-1 text-sm text-text-3">
            Every rupee in, every rupee out — categorized and tagged automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              const n = reclassify(activeBusiness, { overwrite: true });
              toast(n > 0 ? `Re-classified ${n} transactions` : "No classifications changed", n > 0 ? "success" : "info");
            }}
          >
            <Scale size={15} /> Re-classify
          </Button>
          <Button variant="primary" onClick={runSmartTag} disabled={tagging}>
            <Sparkles size={15} className={tagging ? "animate-pulse" : ""} />
            {tagging ? "Tagging…" : "Smart Tag All"}
          </Button>
        </div>
      </div>

      {unclassifiedCount > 0 && (
        <Card className="border-warning/30 p-4" hover={false}>
          <div className="flex flex-wrap items-center gap-3">
            <Scale size={16} className="flex-none text-warning" />
            <p className="min-w-0 flex-1 text-[13px] text-text-2">
              <span className="font-semibold">{unclassifiedCount} transactions</span> aren&apos;t
              classified yet, so they&apos;re held out of Revenue, Expenses and Profit rather
              than guessed at. Set &ldquo;What it is&rdquo; on each to fold it into the P&amp;L.
            </p>
            <Button
              size="sm"
              variant={onlyUnclassified ? "primary" : "secondary"}
              onClick={() => { setOnlyUnclassified((v) => !v); setPage(0); }}
            >
              {onlyUnclassified ? "Showing only these" : "Show only these"}
            </Button>
          </div>
        </Card>
      )}

      {/* Period filter */}
      <Card className="p-2.5" hover={false}>
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarRange size={15} className="mx-1.5 flex-none text-text-3" />
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setPreset(p.id); setPage(0); }}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                preset === p.id ? "bg-primary text-primary-fg shadow-card" : "text-text-2 hover:bg-surface-3/60 hover:text-text"
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="ml-1 flex items-center gap-1.5">
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 w-36 text-xs" />
              <span className="text-xs text-text-3">→</span>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 w-36 text-xs" />
            </div>
          )}
          <span className="num ml-auto hidden px-2 text-[11px] text-text-3 sm:block">
            {fmtDate(range.from)} → {fmtDate(range.to)}
          </span>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5" hover={false}>
          <p className="flex items-center gap-2 text-[13px] font-medium text-text-2">
            <ArrowDownLeft size={15} className="text-positive" /> Money In
          </p>
          <p className="num mt-2 text-2xl font-bold text-positive">{fmtINR(income)}</p>
          <p className="mt-1 text-xs text-text-3">All credits — includes capital &amp; loans</p>
        </Card>
        <Card className="p-5" hover={false}>
          <p className="flex items-center gap-2 text-[13px] font-medium text-text-2">
            <ArrowUpRight size={15} className="text-negative" /> Money Out
          </p>
          <p className="num mt-2 text-2xl font-bold text-negative">{fmtINR(expenses)}</p>
          <p className="mt-1 text-xs text-text-3">All debits — includes loan repayments</p>
        </Card>
        <Card className="p-5" hover={false}>
          <p className="flex items-center gap-2 text-[13px] font-medium text-text-2">
            <Scale size={15} className="text-text-3" /> Net Cash Movement
          </p>
          <p className={cn("num mt-2 text-2xl font-bold", net >= 0 ? "text-positive" : "text-negative")}>{fmtINR(net)}</p>
          <p className="mt-1 text-xs text-text-3">Not profit — see Dashboard for P&amp;L</p>
        </Card>
        <Card className="p-5" hover={false}>
          <p className="flex items-center gap-2 text-[13px] font-medium text-text-2">
            <Tags size={15} className="text-text-3" /> Tag Coverage
          </p>
          <p className="num mt-2 text-2xl font-bold">{taggedPct}%</p>
          <p className="mt-1 text-xs text-text-3">{inPeriod.length} transactions in period</p>
        </Card>
      </div>

      {/* Tag filter chips */}
      {allTagsInPeriod.length > 0 && (
        <Card className="p-3" hover={false}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label-caps mr-1">Filter by tag</span>
            {allTagsInPeriod.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
                  activeTags.has(tag)
                    ? "bg-primary text-primary-fg"
                    : "border border-border bg-surface-3/50 text-text-3 hover:text-text-2"
                )}
              >
                #{tag}
              </button>
            ))}
            {activeTags.size > 0 && (
              <button onClick={() => setActiveTags(new Set())} className="ml-1 flex items-center gap-1 text-[11px] font-medium text-text-3 hover:text-text">
                <X size={11} /> Clear
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Income / Expense breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownCard
          title="Income Breakdown"
          sub="By category — click to filter"
          rows={incomeByCat}
          total={income}
          tone="positive"
          activeCategory={activeCategory}
          onSelect={(c) => { setActiveCategory((cur) => (cur === c ? null : c)); setPage(0); }}
        />
        <BreakdownCard
          title="Expense Breakdown"
          sub="By category — click to filter"
          rows={expenseByCat}
          total={expenses}
          tone="negative"
          activeCategory={activeCategory}
          onSelect={(c) => { setActiveCategory((cur) => (cur === c ? null : c)); setPage(0); }}
        />
      </div>

      {/* Top tags */}
      {tagTotals.length > 0 && (
        <Card className="p-5" hover={false}>
          <h2 className="text-base font-semibold">Top Tags</h2>
          <p className="mb-3 text-xs text-text-3">
            Total money touched by each tag this period (income and expense combined)
          </p>
          <RevenueSourceBars data={tagTotals} height={Math.max(180, tagTotals.length * 32)} />
        </Card>
      )}

      {/* Reconciliation note */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2/50 px-4 py-2.5 text-xs text-text-3">
        <CheckCircle2 size={14} className="flex-none text-positive" />
        Every transaction in this period is accounted for above — income breakdown + expense
        breakdown sums to exactly {fmtINR(income)} in and {fmtINR(expenses)} out, nothing excluded.
      </div>

      {/* Transaction list */}
      <Card className="p-0" hover={false}>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-3.5">
          <h2 className="mr-auto text-sm font-semibold">
            Transactions
            <span className="num ml-2 text-xs font-normal text-text-3">{filtered.length} shown</span>
            {activeCategory && (
              <button onClick={() => setActiveCategory(null)} className="ml-2 inline-flex items-center gap-1">
                <Badge tone="info">{activeCategory} <X size={10} /></Badge>
              </button>
            )}
          </h2>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
            <Input
              placeholder="Search description, category, tags…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="h-8 w-64 pl-8 text-xs"
            />
          </div>
        </div>

        {pageRows.length === 0 ? (
          <Empty title="No transactions match" sub="Try clearing filters or widening the period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="label-caps px-5 py-2.5 font-semibold">Date</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Description &amp; Tags</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">What it is</th>
                  <th className="label-caps px-3 py-2.5 font-semibold">Category</th>
                  <th className="label-caps px-3 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr key={t.id} className="group border-b border-border/50 last:border-0 hover:bg-surface-3/30">
                    <td className="num whitespace-nowrap px-5 py-2.5 text-xs text-text-3">{fmtDateShort(t.date)}</td>
                    <td className="max-w-[360px] px-3 py-2.5">
                      <p className="truncate text-[13px]" title={t.description}>{t.description}</p>
                      <TagEditor
                        tags={t.tags}
                        onChange={(next) => updateTransaction(t.id, { tags: next })}
                        className="mt-1"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Select
                        value={t.txnClass ?? "uncategorized"}
                        onChange={(e) => setTxnClass([t.id], e.target.value as TxnClass)}
                        className={cn(
                          "h-8 w-[168px] text-xs",
                          (!t.txnClass || t.txnClass === "uncategorized") &&
                            "border-warning/50 text-warning"
                        )}
                      >
                        {TXN_CLASSES.filter(
                          (c) =>
                            c.side === "both" ||
                            (t.type === "credit" ? c.side === "in" : c.side === "out") ||
                            c.id === (t.txnClass ?? "uncategorized")
                        ).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={t.type === "credit" ? "positive" : "neutral"}>{t.category}</Badge>
                    </td>
                    <td className={cn("num whitespace-nowrap px-3 py-2.5 text-right font-semibold", t.type === "credit" ? "text-positive" : "text-text")}>
                      {fmtSigned(t.amount, t.type)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <button
                        title="Edit"
                        onClick={() => { setEditing(t); setModalOpen(true); }}
                        className="rounded p-1.5 text-text-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-text group-hover:opacity-100"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > pageRows.length && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="ghost" onClick={() => setPage((p) => p + 1)}>
              Load more ({filtered.length - pageRows.length} remaining)
            </Button>
          </div>
        )}
      </Card>

      <TransactionModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  );
}

function BreakdownCard({
  title,
  sub,
  rows,
  total,
  tone,
  activeCategory,
  onSelect,
}: {
  title: string;
  sub: string;
  rows: { category: string; amount: number }[];
  total: number;
  tone: "positive" | "negative";
  activeCategory: string | null;
  onSelect: (category: string) => void;
}) {
  return (
    <Card className="p-5" hover={false}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mb-3 text-xs text-text-3">{sub}</p>
      {rows.length === 0 ? (
        <Empty title="Nothing in this period" />
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative mx-auto w-full max-w-[180px] sm:mx-0">
            <CategoryDonut data={rows} height={180} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="num text-base font-bold">{fmtINR(total)}</p>
              <p className="label-caps">Total</p>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            {rows.map((r, i) => (
              <button
                key={r.category}
                onClick={() => onSelect(r.category)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                  activeCategory === r.category ? "bg-primary/10" : "hover:bg-surface-3/50"
                )}
              >
                <span className="h-2 w-2 flex-none rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1 truncate text-text-2">{r.category}</span>
                <span className={cn("num font-semibold", tone === "positive" ? "text-positive" : "text-text")}>
                  {fmtINR(r.amount)}
                </span>
                <span className="num w-9 text-right text-[11px] text-text-3">
                  {total ? Math.round((r.amount / total) * 100) : 0}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
