"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CalendarRange,
  Layers,
  Percent,
  PiggyBank,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import {
  categoryBreakdownRange,
  computeKPIs,
  forBusiness,
  monthlySeries,
  rangeStats,
  referenceMonth,
  revenueBySourceRange,
} from "@/lib/metrics";
import { fmtINR, fmtDate, fmtPct, monthLabel, todayISO } from "@/lib/format";
import { Card, Delta, Input, cn } from "@/components/ui";
import {
  CashFlowChart,
  CategoryDonut,
  CHART_COLORS,
  ProfitLine,
  RevenueExpenseBars,
  RevenueSourceBars,
} from "@/components/charts";

/* ── Period filter ── */
type Preset =
  | "latest"
  | "thisMonth"
  | "lastMonth"
  | "3m"
  | "6m"
  | "fy"
  | "12m"
  | "all"
  | "custom";

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

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) +
  1;

export default function DashboardPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const loans = useStore((s) => s.loans);
  const cards = useStore((s) => s.cards);
  const invoices = useStore((s) => s.invoices);
  const recurring = useStore((s) => s.recurring);
  const openingBalances = useStore((s) => s.openingBalances);
  const cogsCategories = useStore((s) => s.cogsCategories);
  const statementBalance = useStore((s) => s.statementBalance);

  const stmtBalance = statementBalance[activeBusiness];
  const biz = BUSINESSES.find((b) => b.id === activeBusiness) ?? BUSINESSES[0];
  const [preset, setPreset] = useState<Preset>("latest");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { kpis, stats, series, breakdown, sources, range, rangeLabel } = useMemo(() => {
    const txns = forBusiness(transactions, activeBusiness);
    const kpis = computeKPIs(
      txns,
      loans.filter((l) => l.businessId === activeBusiness),
      cards.filter((c) => c.businessId === activeBusiness),
      invoices.filter((i) => i.businessId === activeBusiness),
      recurring.filter((r) => r.businessId === activeBusiness),
      openingBalances[activeBusiness]
    );
    const ref = referenceMonth(txns);
    const today = todayISO();
    const curMonth = today.slice(0, 7);

    let from: string;
    let to: string;
    let rangeLabel: string;
    switch (preset) {
      case "thisMonth":
        from = `${curMonth}-01`;
        to = today;
        rangeLabel = monthLabel(curMonth);
        break;
      case "lastMonth": {
        const lm = monthShift(curMonth, 1);
        from = `${lm}-01`;
        to = endOfMonth(lm);
        rangeLabel = monthLabel(lm);
        break;
      }
      case "3m":
        from = `${monthShift(ref, 2)}-01`;
        to = endOfMonth(ref);
        rangeLabel = "Last 3 months";
        break;
      case "6m":
        from = `${monthShift(ref, 5)}-01`;
        to = endOfMonth(ref);
        rangeLabel = "Last 6 months";
        break;
      case "fy": {
        const y = Number(ref.slice(0, 4));
        const m = Number(ref.slice(5, 7));
        const fyStart = m >= 4 ? y : y - 1;
        from = `${fyStart}-04-01`;
        to = endOfMonth(ref);
        rangeLabel = `FY ${fyStart}–${String(fyStart + 1).slice(2)}`;
        break;
      }
      case "12m":
        from = `${monthShift(ref, 11)}-01`;
        to = endOfMonth(ref);
        rangeLabel = "Last 12 months";
        break;
      case "all": {
        let min = today;
        txns.forEach((t) => {
          if (t.date < min) min = t.date;
        });
        from = min;
        to = today;
        rangeLabel = "All time";
        break;
      }
      case "custom":
        from = customFrom || `${ref}-01`;
        to = customTo || endOfMonth(ref);
        if (from > to) [from, to] = [to, from];
        rangeLabel = "Custom range";
        break;
      default:
        from = `${ref}-01`;
        to = endOfMonth(ref);
        rangeLabel = `${monthLabel(ref)} — latest month with data`;
    }

    const stats = rangeStats(txns, from, to, cogsCategories[activeBusiness], preset !== "all");
    const span = Math.min(24, Math.max(6, monthsBetween(from.slice(0, 7), to.slice(0, 7))));
    const series = monthlySeries(txns, span, to.slice(0, 7));
    const breakdown = categoryBreakdownRange(txns, "debit", from, to);
    const sources = revenueBySourceRange(txns, from, to);
    return { kpis, stats, series, breakdown, sources, range: { from, to }, rangeLabel };
  }, [
    transactions,
    loans,
    cards,
    invoices,
    recurring,
    activeBusiness,
    openingBalances,
    cogsCategories,
    preset,
    customFrom,
    customTo,
  ]);

  const totalBreakdown = breakdown.reduce((s, b) => s + b.amount, 0);
  const profitMargin = stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Header */}
      <div className="animate-fade-up">
        <p className="label-caps mb-1">Live Analytics</p>
        <h1 className="text-3xl font-bold tracking-tight">{biz.name} Performance</h1>
      </div>

      {/* Period filter bar */}
      <Card className="p-2.5" hover={false}>
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarRange size={15} className="mx-1.5 flex-none text-text-3" />
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                preset === p.id
                  ? "bg-primary text-primary-fg shadow-card"
                  : "text-text-2 hover:bg-surface-3/60 hover:text-text"
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="ml-1 flex items-center gap-1.5">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-36 text-xs"
              />
              <span className="text-xs text-text-3">→</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-36 text-xs"
              />
            </div>
          )}
          <span className="num ml-auto hidden px-2 text-[11px] text-text-3 sm:block">
            {fmtDate(range.from)} → {fmtDate(range.to)}
          </span>
        </div>
      </Card>

      {/* Top KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <HeroKpi
          icon={<Wallet size={16} />}
          label="Cash / Bank Balance"
          value={stmtBalance ? stmtBalance.closing : kpis.bankBalance}
          sub={
            stmtBalance
              ? `Statement closing balance, ${fmtDate(stmtBalance.asOf)}`
              : "Computed from opening balance + transactions"
          }
          delay={0}
        />
        <HeroKpi
          icon={<TrendingUp size={16} />}
          label="Revenue"
          value={stats.revenue}
          chip={stats.revenueDelta !== null ? <Delta value={stats.revenueDelta} /> : undefined}
          sub="Genuine sales only — excludes capital & loans"
          delay={1}
        />
        <HeroKpi
          icon={<Layers size={16} />}
          label="Gross Profit"
          value={stats.grossProfit}
          chip={
            stats.grossProfitDelta !== null ? <Delta value={stats.grossProfitDelta} /> : undefined
          }
          sub={
            stats.cogs > 0
              ? `Revenue minus ${fmtINR(stats.cogs)} direct costs`
              : "No direct costs identified yet — tag COGS below"
          }
          tone={stats.grossProfit >= 0 ? "positive" : "negative"}
          delay={2}
        />
        <HeroKpi
          icon={<PiggyBank size={16} />}
          label="Net Profit"
          value={stats.profit}
          chip={stats.profitDelta !== null ? <Delta value={stats.profitDelta} /> : undefined}
          sub={rangeLabel}
          tone={stats.profit >= 0 ? "positive" : "negative"}
          delay={3}
        />
        <HeroKpi
          icon={<Percent size={16} />}
          label="Profit Margin"
          value={null}
          display={fmtPct(profitMargin)}
          sub="Net profit ÷ revenue"
          tone={profitMargin >= 0 ? "positive" : "negative"}
          delay={4}
        />
        <HeroKpi
          icon={<Banknote size={16} />}
          label="Total Expenses"
          value={stats.expenses}
          chip={
            stats.expensesDelta !== null ? (
              <Delta value={stats.expensesDelta} invert />
            ) : undefined
          }
          sub={rangeLabel}
          delay={5}
        />
      </div>

      {/* Reconciliation — where the cash actually came from and went */}
      <Card className="p-5" hover={false}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Scale size={16} className="text-text-3" /> Cash Reconciliation
          </h2>
          <Link href="/income-expenses" className="text-xs font-semibold text-primary hover:underline">
            Review &amp; tag transactions →
          </Link>
        </div>
        <p className="mb-4 text-xs text-text-3">
          A bank statement is a cash ledger, not a P&amp;L. Only genuine sales
          count as revenue — capital, loans and inter-company transfers moved
          through the account but are not income.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <FlowSplit
            title="Money In"
            total={stats.cashIn}
            headline={{ label: "Sales (Revenue)", amount: stats.revenue, tone: "positive" }}
            rows={stats.excluded.filter((e) => e.inflow > 0).map((e) => ({ label: e.label, amount: e.inflow }))}
          />
          <FlowSplit
            title="Money Out"
            total={stats.cashOut}
            headline={{ label: "P&L Expenses (COGS + OpEx)", amount: stats.expenses, tone: "negative" }}
            rows={stats.excluded.filter((e) => e.outflow > 0).map((e) => ({ label: e.label, amount: e.outflow }))}
          />
        </div>

        {(stats.uncategorizedInflow > 0 || stats.uncategorizedOutflow > 0) && (
          <div className="mt-4 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/[0.07] px-4 py-3">
            <AlertTriangle size={15} className="mt-0.5 flex-none text-warning" />
            <p className="text-[13px] leading-relaxed text-text-2">
              <span className="font-semibold">
                {fmtINR(stats.uncategorizedInflow)} in and {fmtINR(stats.uncategorizedOutflow)} out
              </span>{" "}
              is still uncategorized, and is deliberately excluded from every
              figure above rather than guessed at. Tag those transactions to
              fold them into revenue or expenses.
            </p>
          </div>
        )}
      </Card>

      {/* Main charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <h2 className="text-base font-semibold">Revenue vs Expenses</h2>
          <p className="mb-3 text-xs text-text-3">
            Monthly — {series.length} months ending {monthLabel(range.to.slice(0, 7))}
          </p>
          <RevenueExpenseBars data={series} height={280} />
        </Card>

        <Card className="p-5 animate-fade-up" style={{ animationDelay: "180ms" }}>
          <h2 className="text-base font-semibold">Profit Trend</h2>
          <p className="mb-3 text-xs text-text-3">Monthly net profit</p>
          <ProfitLine data={series} height={280} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2 animate-fade-up" style={{ animationDelay: "240ms" }}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Cash Flow</h2>
              <p className="text-xs text-text-3">Money in vs out, monthly</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-positive" /> Inflow
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-negative" /> Outflow
              </span>
            </div>
          </div>
          <CashFlowChart data={series} />
        </Card>

        <Card className="p-5 animate-fade-up" style={{ animationDelay: "300ms" }}>
          <h2 className="text-base font-semibold">Expense Breakdown</h2>
          <p className="mb-2 text-xs text-text-3">
            By category — {rangeLabel}
          </p>
          <div className="relative">
            <CategoryDonut data={breakdown} height={210} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="num text-xl font-bold">{fmtINR(totalBreakdown)}</p>
              <p className="label-caps">Total</p>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {breakdown.slice(0, 5).map((b, i) => (
              <div key={b.category} className="flex items-center gap-2.5 text-[13px]">
                <span
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="flex-1 truncate text-text-2">{b.category}</span>
                <span className="num font-semibold">
                  {totalBreakdown ? Math.round((b.amount / totalBreakdown) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5 animate-fade-up" style={{ animationDelay: "360ms" }}>
        <h2 className="text-base font-semibold">Revenue by Client</h2>
        <p className="mb-3 text-xs text-text-3">
          Top payers — {rangeLabel}. Grouped by client where set, otherwise the
          counterparty detected from the bank narration.
        </p>
        {sources.length === 0 ? (
          <p className="py-10 text-center text-sm text-text-3">No revenue in this period.</p>
        ) : (
          <RevenueSourceBars data={sources} height={Math.max(220, sources.length * 34)} />
        )}
      </Card>
    </div>
  );
}

/** One side of the cash reconciliation: the P&L slice, then what's excluded. */
function FlowSplit({
  title,
  total,
  headline,
  rows,
}: {
  title: string;
  total: number;
  headline: { label: string; amount: number; tone: "positive" | "negative" };
  rows: { label: string; amount: number }[];
}) {
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return (
    <div className="rounded-md border border-border bg-surface-2/50 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="label-caps">{title}</p>
        <p className="num text-sm font-bold">{fmtINR(total)}</p>
      </div>

      <div className="mb-2 flex items-center gap-2.5 rounded-md bg-surface-3/60 px-2.5 py-2">
        <span
          className={cn(
            "h-2 w-2 flex-none rounded-full",
            headline.tone === "positive" ? "bg-positive" : "bg-negative"
          )}
        />
        <span className="flex-1 text-[13px] font-semibold">{headline.label}</span>
        <span
          className={cn(
            "num text-[13px] font-bold",
            headline.tone === "positive" ? "text-positive" : "text-text"
          )}
        >
          {fmtINR(headline.amount)}
        </span>
        <span className="num w-9 text-right text-[11px] text-text-3">{pct(headline.amount)}%</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-2.5 py-1 text-[12px] text-text-3">Nothing excluded — all of it is in the P&amp;L.</p>
      ) : (
        rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2.5 px-2.5 py-1 text-[13px]">
            <span className="h-2 w-2 flex-none rounded-full bg-text-3/40" />
            <span className="flex-1 truncate text-text-3">{r.label}</span>
            <span className="num text-text-2">{fmtINR(r.amount)}</span>
            <span className="num w-9 text-right text-[11px] text-text-3">{pct(r.amount)}%</span>
          </div>
        ))
      )}
    </div>
  );
}

function HeroKpi({
  icon,
  label,
  value,
  display,
  sub,
  chip,
  tone,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  display?: string;
  sub?: string;
  chip?: React.ReactNode;
  tone?: "positive" | "negative";
  delay?: number;
}) {
  return (
    <Card
      className="relative overflow-hidden p-5 animate-fade-up"
      style={{ animationDelay: `${delay * 60}ms` }}
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/[0.06] blur-2xl" />
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium text-text-2">
          <span className="text-text-3">{icon}</span>
          {label}
        </span>
        {chip}
      </div>
      <p
        className={cn(
          "num mt-3 text-[26px] font-bold leading-none tracking-tight",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative"
        )}
      >
        {display ?? fmtINR(value ?? 0)}
      </p>
      {sub && <p className="mt-2 text-xs text-text-3">{sub}</p>}
    </Card>
  );
}
