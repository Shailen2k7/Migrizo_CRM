"use client";

import { useMemo } from "react";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import { useStore } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import {
  categoryBreakdown,
  computeKPIs,
  forBusiness,
  forecast,
  healthScore,
  monthlySeries,
  topCounterparties,
} from "@/lib/metrics";
import { fmtINR } from "@/lib/format";
import { Card, Delta, Progress, cn } from "@/components/ui";
import { CHART_COLORS, ForecastChart, ProfitLine, RevenueExpenseBars } from "@/components/charts";

export default function AnalyticsPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const loans = useStore((s) => s.loans);
  const cards = useStore((s) => s.cards);
  const invoices = useStore((s) => s.invoices);
  const recurring = useStore((s) => s.recurring);
  const openingBalances = useStore((s) => s.openingBalances);
  const biz = BUSINESSES.find((b) => b.id === activeBusiness)!;

  const d = useMemo(() => {
    const txns = forBusiness(transactions, activeBusiness);
    const kpis = computeKPIs(
      txns,
      loans.filter((l) => l.businessId === activeBusiness),
      cards.filter((c) => c.businessId === activeBusiness),
      invoices.filter((i) => i.businessId === activeBusiness),
      recurring.filter((r) => r.businessId === activeBusiness),
      openingBalances[activeBusiness]
    );
    const series = monthlySeries(txns, 12);
    const yearAgoSeries = series.slice(0, 6);
    const recentSeries = series.slice(6);
    const yoyRevenue =
      yearAgoSeries.reduce((s, p) => s + p.revenue, 0) > 0
        ? ((recentSeries.reduce((s, p) => s + p.revenue, 0) - yearAgoSeries.reduce((s, p) => s + p.revenue, 0)) /
            yearAgoSeries.reduce((s, p) => s + p.revenue, 0)) *
          100
        : 0;
    return {
      kpis,
      series,
      health: healthScore(kpis),
      clients: topCounterparties(txns, "client", 12).slice(0, 6),
      vendors: topCounterparties(txns, "vendor", 12).slice(0, 6),
      cats: categoryBreakdown(txns, "debit", 3),
      fc: forecast(txns, kpis.bankBalance, 6),
      yoyRevenue,
    };
  }, [transactions, loans, cards, invoices, recurring, activeBusiness, openingBalances]);

  const { kpis, health } = d;
  const roi =
    d.cats.filter((c) => ["Marketing", "Meta Ads", "Google Ads"].includes(c.category)).reduce((s, c) => s + c.amount, 0) > 0
      ? (d.series.slice(-3).reduce((s, p) => s + p.revenue, 0) /
          d.cats.filter((c) => ["Marketing", "Meta Ads", "Google Ads"].includes(c.category)).reduce((s, c) => s + c.amount, 0))
      : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="animate-fade-up">
        <p className="label-caps mb-1">{biz.name}</p>
        <h1 className="text-3xl font-bold tracking-tight">Founder Analytics</h1>
      </div>

      {/* Health + growth row */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-positive/[0.08] blur-3xl" />
          <p className="flex items-center gap-2 text-sm font-medium text-text-2">
            <Activity size={15} className="text-text-3" /> Business Health Score
          </p>
          <div className="mt-4 flex items-center gap-6">
            <div className="relative h-28 w-28">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(var(--surface-3))" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="42" fill="none"
                  stroke={health.score >= 65 ? "rgb(var(--positive))" : health.score >= 45 ? "rgb(var(--warning))" : "rgb(var(--negative))"}
                  strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${(health.score / 100) * 264} 264`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="num text-3xl font-bold">{health.score}</span>
              </div>
            </div>
            <div className="flex-1 space-y-2.5">
              <p
                className={cn(
                  "text-sm font-bold",
                  health.score >= 65 ? "text-positive" : health.score >= 45 ? "text-warning" : "text-negative"
                )}
              >
                {health.grade}
              </p>
              {health.drivers.map((dr) => (
                <div key={dr.label}>
                  <div className="mb-1 flex justify-between text-[11px] text-text-3">
                    <span>{dr.label}</span>
                    <span className="num">{dr.value}</span>
                  </div>
                  <Progress value={dr.value / 100} tone={dr.value >= 65 ? "positive" : dr.value >= 40 ? "warning" : "negative"} />
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-sm font-medium text-text-2">Growth (Month over Month)</p>
          <div className="mt-4 space-y-4">
            <GrowthRow label="Revenue Growth" value={kpis.revenueMoM} />
            <GrowthRow label="Profit Growth" value={kpis.profitMoM} />
            <GrowthRow label="Expense Growth" value={kpis.expensesMoM} invert />
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-[13px] text-text-2">Revenue H2 vs H1</span>
              <Delta value={d.yoyRevenue} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-2">Marketing ROI (90d revenue ÷ ad spend)</span>
              <span className="num text-sm font-bold">{roi ? `${roi.toFixed(1)}×` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-2">Monthly Burn</span>
              <span className={cn("num text-sm font-bold", kpis.monthlyBurn > 0 ? "text-negative" : "text-positive")}>
                {kpis.monthlyBurn > 0 ? fmtINR(kpis.monthlyBurn) : "Cash-positive"}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-sm font-medium text-text-2">Cash Flow Forecast (6 months)</p>
          <div className="mt-2">
            <ForecastChart data={d.fc} height={200} />
          </div>
          <p className="mt-2 text-xs text-text-3">
            Projection from trailing 3-month averages with modest growth. Balance today:{" "}
            <span className="num font-semibold text-text">{fmtINR(kpis.bankBalance)}</span>
          </p>
        </Card>
      </div>

      {/* Trends */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold">Revenue vs Expenses — 12 months</p>
          <RevenueExpenseBars data={d.series} height={260} />
        </Card>
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold">Profit Trend — 12 months</p>
          <ProfitLine data={d.series} height={260} />
        </Card>
      </div>

      {/* Top lists */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RankCard title="Top Clients" items={d.clients.map((c) => ({ label: c.name, value: c.amount }))} positive />
        <RankCard title="Top Vendors" items={d.vendors.map((v) => ({ label: v.name, value: v.amount }))} />
        <RankCard
          title="Biggest Expense Categories (90d)"
          items={d.cats.slice(0, 6).map((c) => ({ label: c.category, value: c.amount }))}
        />
      </div>
    </div>
  );
}

function GrowthRow({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? value < 0 : value > 0;
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-[13px] text-text-2">
        {good ? <TrendingUp size={14} className="text-positive" /> : <TrendingDown size={14} className="text-negative" />}
        {label}
      </span>
      <Delta value={value} invert={invert} />
    </div>
  );
}

function RankCard({
  title,
  items,
  positive,
}: {
  title: string;
  items: { label: string; value: number }[];
  positive?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <Card className="p-5">
      <p className="mb-4 text-sm font-semibold">{title}</p>
      {items.length === 0 && <p className="py-6 text-center text-xs text-text-3">No data yet</p>}
      <div className="space-y-3">
        {items.map((item, i) => (
          <div key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-text-2">
                <span className="num mr-2 text-[11px] text-text-3">{i + 1}</span>
                {item.label}
              </span>
              <span className={cn("num text-[13px] font-semibold", positive && "text-positive")}>
                {fmtINR(item.value)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(item.value / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
