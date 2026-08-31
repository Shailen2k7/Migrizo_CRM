import {
  AppNotification,
  BusinessId,
  CreditCard,
  Invoice,
  Loan,
  RecurringExpense,
  Transaction,
} from "./types";
import { daysUntil, fmtINR, monthKey, round2, todayISO } from "./format";
import { PLBreakdown, classRole, computePL } from "./classify";

export interface MonthPoint {
  month: string; // yyyy-MM
  label: string;
  cashIn: number;
  cashOut: number;
  revenue: number;
  expenses: number;
  profit: number;
  net: number;
}

const NON_PL_CATS = new Set(["Transfer", "Investment", "Loan EMI", "Credit Card"]);

/**
 * Categories that are inherently costs. A *credit* in one of these is a refund
 * of that cost (a contra-expense that reduces spend) — never income. Without
 * this, an ad-platform reversal shows up as revenue in the P&L.
 */
const EXPENSE_CATS = new Set([
  "Salary",
  "Rent",
  "Marketing",
  "Meta Ads",
  "Google Ads",
  "Software",
  "Office",
  "Travel",
  "Food",
  "Subscription",
  "Reimbursement",
  "Professional Fees",
  "Vendor Payment",
  "GST",
  "Tax",
]);

export function isRevenue(t: Transaction): boolean {
  return t.type === "credit" && !NON_PL_CATS.has(t.category) && !EXPENSE_CATS.has(t.category);
}

export function isExpense(t: Transaction): boolean {
  return t.type === "debit" && !NON_PL_CATS.has(t.category);
}

/** Signed contribution to expenses: debits add, refunds of a cost subtract. */
export function expenseAmount(t: Transaction): number {
  if (NON_PL_CATS.has(t.category)) return 0;
  if (t.type === "debit") return t.amount;
  return EXPENSE_CATS.has(t.category) ? -t.amount : 0;
}

/**
 * Direct cost of delivering revenue — what sits above the Gross Profit line.
 * Which categories actually belong here is genuinely business-specific: a
 * consultancy's COGS is subcontractor/professional payments, while a SaaS
 * product's COGS is hosting and API costs that a flat category scheme files
 * under "Software". There is no single default that's right for every
 * business, so this is a per-business, user-editable set (see store.ts
 * `cogsCategories`) rather than a hardcoded constant — treating it as fixed
 * silently produces "Gross Profit == Revenue" for any business whose real
 * infrastructure costs don't happen to land in these categories.
 */
export const DEFAULT_COGS_CATEGORIES = ["Vendor Payment", "Professional Fees"];

export function cogsAmount(t: Transaction, cogsCategories: readonly string[]): number {
  if (!cogsCategories.includes(t.category)) return 0;
  if (t.type === "debit") return t.amount;
  return t.type === "credit" ? -t.amount : 0;
}

export function forBusiness(txns: Transaction[], b: BusinessId): Transaction[] {
  return txns.filter((t) => t.businessId === b);
}

/**
 * The reference month for "this month" KPIs: the latest month that actually
 * has transactions (capped at the current calendar month). A founder who
 * uploads a statement ending in July should see July's numbers on Aug 1,
 * not a wall of zeros.
 */
export function referenceMonth(txns: Transaction[]): string {
  const current = todayISO().slice(0, 7);
  const counts = new Map<string, number>();
  txns.forEach((t) => {
    const mk = monthKey(t.date);
    if (mk <= current) counts.set(mk, (counts.get(mk) ?? 0) + 1);
  });
  const months = Array.from(counts.keys()).sort();
  if (months.length === 0) return current;
  const latest = months[months.length - 1];
  // A few days into a new month there may be one or two stray entries. Anchoring
  // on that reads as "revenue ₹0"; fall back to the last month with real activity.
  if (latest === current && (counts.get(latest) ?? 0) < 3 && months.length > 1) {
    return months[months.length - 2];
  }
  return latest;
}

export function monthlySeries(
  txns: Transaction[],
  monthsBack = 12,
  anchorMonth?: string // yyyy-MM; defaults to the current calendar month
): MonthPoint[] {
  const map = new Map<string, MonthPoint>();
  const now = anchorMonth
    ? new Date(Number(anchorMonth.slice(0, 4)), Number(anchorMonth.slice(5, 7)) - 1, 15)
    : new Date();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, {
      month: key,
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      cashIn: 0,
      cashOut: 0,
      revenue: 0,
      expenses: 0,
      profit: 0,
      net: 0,
    });
  }
  txns.forEach((t) => {
    const p = map.get(monthKey(t.date));
    if (!p) return;
    // Cash flow is raw direction — that IS what moved through the bank.
    if (t.type === "credit") p.cashIn += t.amount;
    else p.cashOut += t.amount;
    // Revenue and expenses come from what the money *is*, so these bars agree
    // with the P&L cards instead of contradicting them.
    const role = classRole(t.txnClass);
    if (role === "revenue") p.revenue += t.type === "credit" ? t.amount : -t.amount;
    else if (role === "cogs" || role === "opex") p.expenses += t.type === "debit" ? t.amount : -t.amount;
  });
  map.forEach((p) => {
    p.profit = p.revenue - p.expenses;
    p.net = p.cashIn - p.cashOut;
  });
  return Array.from(map.values());
}

export function categoryBreakdown(
  txns: Transaction[],
  kind: "debit" | "credit",
  monthsBack = 1
): { category: string; amount: number }[] {
  // Anchor the window at the latest transaction date (not today) so
  // historical statements still produce a meaningful breakdown.
  let anchorISO = todayISO();
  let latest = "";
  txns.forEach((t) => {
    if (t.date > latest && t.date <= anchorISO) latest = t.date;
  });
  if (latest) anchorISO = latest;
  const cutoff = new Date(anchorISO + "T00:00:00");
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const map = new Map<string, number>();
  txns
    .filter(
      (t) =>
        t.type === kind &&
        t.date >= cutoffISO &&
        t.date <= anchorISO &&
        !NON_PL_CATS.has(t.category)
    )
    .forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amount));
  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/* ── Arbitrary date-range stats for dashboard filters ── */
export interface RangeStats {
  from: string;
  to: string;
  /** Genuine sales only — excludes capital, loans and inter-company money. */
  revenue: number;
  cogs: number;
  grossProfit: number;
  /** COGS + operating expenses. Excludes loan repayments and owner drawings. */
  expenses: number;
  opex: number;
  /** Revenue − COGS − OpEx. Never "credits minus debits". */
  profit: number;
  /** Raw cash movement, for reconciling against the bank statement. */
  cashIn: number;
  cashOut: number;
  /** Money that moved but sits outside the P&L, split by what it actually is. */
  excluded: PLBreakdown["excluded"];
  excludedInflow: number;
  excludedOutflow: number;
  uncategorizedInflow: number;
  uncategorizedOutflow: number;
  gstEstimate: number;
  revenueDelta: number | null;
  grossProfitDelta: number | null;
  expensesDelta: number | null;
  profitDelta: number | null;
}

/**
 * A transaction is a direct cost if the classifier said so, or if the founder
 * marked its spend category as COGS in Settings. Both routes exist because
 * they answer slightly different questions — "what is this money" versus
 * "which of our spend categories are direct costs" — and either is a valid
 * way to say the same thing.
 */
function isCogs(t: Transaction, cogsCategories: readonly string[]): boolean {
  return t.txnClass === "cogs" || cogsCategories.includes(t.category);
}

function collectRange(txns: Transaction[], from: string, to: string, cogsCategories: readonly string[]) {
  const inRange = txns.filter((t) => t.date >= from && t.date <= to);
  // Route category-flagged COGS through the classifier's `cogs` bucket so the
  // two mechanisms produce one consistent P&L.
  const normalized = inRange.map((t) =>
    isCogs(t, cogsCategories) && t.txnClass !== "cogs" ? { ...t, txnClass: "cogs" as const } : t
  );
  const pl = computePL(normalized);
  return {
    revenue: pl.revenue,
    cogs: pl.cogs,
    opex: pl.opex,
    expenses: round2(pl.cogs + pl.opex),
    profit: pl.netProfit,
    grossProfit: pl.grossProfit,
    cashIn: pl.totalInflow,
    cashOut: pl.totalOutflow,
    excluded: pl.excluded,
    excludedInflow: pl.excludedInflow,
    excludedOutflow: pl.excludedOutflow,
    uncategorizedInflow: pl.uncategorizedInflow,
    uncategorizedOutflow: pl.uncategorizedOutflow,
  };
}

/**
 * Stats over [from, to] inclusive, with deltas vs the equal-length window
 * immediately before it. Pass withDeltas=false (e.g. for "All time") to skip.
 */
export function rangeStats(
  txns: Transaction[],
  from: string,
  to: string,
  cogsCategories: readonly string[] = DEFAULT_COGS_CATEGORIES,
  withDeltas = true
): RangeStats {
  const cur = collectRange(txns, from, to, cogsCategories);
  const pct = (c: number, p: number) => (p === 0 ? 0 : ((c - p) / Math.abs(p)) * 100);
  let revenueDelta: number | null = null;
  let grossProfitDelta: number | null = null;
  let expensesDelta: number | null = null;
  let profitDelta: number | null = null;
  if (withDeltas) {
    const f = new Date(from + "T00:00:00");
    const t = new Date(to + "T00:00:00");
    const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
    const pf = new Date(f);
    pf.setDate(pf.getDate() - days);
    const pt = new Date(f);
    pt.setDate(pt.getDate() - 1);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const prev = collectRange(txns, iso(pf), iso(pt), cogsCategories);
    revenueDelta = pct(cur.revenue, prev.revenue);
    grossProfitDelta = pct(cur.grossProfit, prev.grossProfit);
    expensesDelta = pct(cur.expenses, prev.expenses);
    profitDelta = pct(cur.profit, prev.profit);
  }
  return {
    from,
    to,
    ...cur,
    gstEstimate: Math.max(0, cur.revenue * 0.18 - cur.expenses * 0.18 * 0.35),
    revenueDelta,
    grossProfitDelta,
    expensesDelta,
    profitDelta,
  };
}

/**
 * Revenue grouped by who paid you — the `client` field when set manually, or
 * the counterparty the importer extracted from the bank narration otherwise.
 * This is the practical stand-in for "revenue by product/service" in a
 * transaction ledger that has no separate line-item/product catalogue.
 */
export function revenueBySourceRange(
  txns: Transaction[],
  from: string,
  to: string,
  limit = 8
): { name: string; amount: number }[] {
  const map = new Map<string, number>();
  txns.forEach((t) => {
    if (!isRevenue(t) || t.date < from || t.date > to) return;
    const name = (t.client || t.vendor || "").trim() || "Other";
    map.set(name, (map.get(name) ?? 0) + t.amount);
  });
  const sorted = Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  if (sorted.length <= limit) return sorted;
  const top = sorted.slice(0, limit - 1);
  const restTotal = sorted.slice(limit - 1).reduce((s, x) => s + x.amount, 0);
  return [...top, { name: "Other", amount: restTotal }];
}

/**
 * Spend (or income) by category, restricted to money that actually belongs in
 * the P&L. Without the role filter this would total every debit — including
 * loan repayments and owner transfers — and visibly contradict the Total
 * Expenses card sitting next to it.
 */
export function categoryBreakdownRange(
  txns: Transaction[],
  kind: "debit" | "credit",
  from: string,
  to: string
): { category: string; amount: number }[] {
  // The class already decides what belongs in the P&L, so no category filter
  // here — adding one would drop rows the Total Expenses card still counts.
  const wantedRoles = kind === "debit" ? ["cogs", "opex"] : ["revenue"];
  const map = new Map<string, number>();
  txns
    .filter(
      (t) =>
        t.type === kind &&
        t.date >= from &&
        t.date <= to &&
        wantedRoles.includes(classRole(t.txnClass))
    )
    .forEach((t) => map.set(t.category, (map.get(t.category) ?? 0) + t.amount));
  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export interface KPIs {
  /** yyyy-MM month all "month" figures refer to (latest month with data) */
  refMonth: string;
  /** true when refMonth is the current calendar month */
  isCurrentMonth: boolean;
  bankBalance: number;
  cashInMonth: number;
  cashOutMonth: number;
  revenueMonth: number;
  expensesMonth: number;
  profitMonth: number;
  revenueMoM: number;
  profitMoM: number;
  expensesMoM: number;
  pendingReceivables: number;
  upcomingPayments30d: number;
  loanOutstanding: number;
  cardOutstanding: number;
  gstEstimate: number;
  monthlyBurn: number;
  runwayMonths: number | null;
}

export function computeKPIs(
  txns: Transaction[],
  loans: Loan[],
  cards: CreditCard[],
  invoices: Invoice[],
  recurring: RecurringExpense[],
  openingBalance: number
): KPIs {
  const today = todayISO();
  const thisMonth = referenceMonth(txns);
  const isCurrentMonth = thisMonth === today.slice(0, 7);
  // For the current (partial) month compare like-for-like month-to-date;
  // for a historical reference month compare the full month.
  const dayOfMonth = isCurrentMonth ? Number(today.slice(8, 10)) : 31;
  const lastMonthDate = new Date(
    Number(thisMonth.slice(0, 4)),
    Number(thisMonth.slice(5, 7)) - 2,
    15
  );
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

  let bankBalance = openingBalance;
  let cashInMonth = 0,
    cashOutMonth = 0,
    revenueMonth = 0,
    expensesMonth = 0,
    revenueLast = 0,
    expensesLast = 0;

  txns.forEach((t) => {
    bankBalance += t.type === "credit" ? t.amount : -t.amount;
    const mk = monthKey(t.date);
    if (mk === thisMonth) {
      if (t.type === "credit") cashInMonth += t.amount;
      else cashOutMonth += t.amount;
      if (isRevenue(t)) revenueMonth += t.amount;
      expensesMonth += expenseAmount(t);
    } else if (mk === lastMonth && Number(t.date.slice(8, 10)) <= dayOfMonth) {
      // Month-to-date comparison: same day-window of last month, like-for-like
      if (isRevenue(t)) revenueLast += t.amount;
      expensesLast += expenseAmount(t);
    }
  });

  const profitMonth = revenueMonth - expensesMonth;
  const profitLast = revenueLast - expensesLast;

  const pct = (cur: number, prev: number) => (prev === 0 ? 0 : ((cur - prev) / Math.abs(prev)) * 100);

  const pendingReceivables = invoices
    .filter((i) => i.status !== "paid")
    .reduce((s, i) => s + (i.amount - i.paidAmount), 0);

  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30ISO = in30.toISOString().slice(0, 10);
  const upcomingPayments30d =
    loans.filter((l) => l.nextDueDate <= in30ISO).reduce((s, l) => s + l.emi, 0) +
    cards.filter((c) => c.dueDate <= in30ISO).reduce((s, c) => s + c.totalDue, 0) +
    recurring
      .filter((r) => r.active && r.nextDate <= in30ISO)
      .reduce((s, r) => s + r.amount, 0);

  // GST estimate: 18% of this month's revenue minus input credit approximation
  const gstEstimate = Math.max(0, revenueMonth * 0.18 - expensesMonth * 0.18 * 0.35);

  // Burn = avg net outflow over the 3 full months before the reference month
  const series = monthlySeries(txns, 4, thisMonth).slice(0, 3);
  const avgNet = series.reduce((s, p) => s + p.net, 0) / Math.max(1, series.length);
  const monthlyBurn = -avgNet;
  const runwayMonths = monthlyBurn > 0 ? bankBalance / monthlyBurn : null;

  return {
    refMonth: thisMonth,
    isCurrentMonth,
    bankBalance,
    cashInMonth,
    cashOutMonth,
    revenueMonth,
    expensesMonth,
    profitMonth,
    revenueMoM: pct(revenueMonth, revenueLast),
    profitMoM: pct(profitMonth, profitLast),
    expensesMoM: pct(expensesMonth, expensesLast),
    pendingReceivables,
    upcomingPayments30d,
    loanOutstanding: loans.reduce((s, l) => s + l.outstanding, 0),
    cardOutstanding: cards.reduce((s, c) => s + c.outstanding, 0),
    gstEstimate,
    monthlyBurn,
    runwayMonths,
  };
}

export function topCounterparties(
  txns: Transaction[],
  field: "client" | "vendor",
  monthsBack = 12
): { name: string; amount: number; count: number }[] {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  const cutoffISO = cutoff.toISOString().slice(0, 10);
  const map = new Map<string, { amount: number; count: number }>();
  txns
    .filter(
      (t) =>
        t.date >= cutoffISO &&
        t[field] &&
        (field === "client" ? t.type === "credit" : t.type === "debit")
    )
    .forEach((t) => {
      const key = t[field]!;
      const cur = map.get(key) ?? { amount: 0, count: 0 };
      cur.amount += t.amount;
      cur.count += 1;
      map.set(key, cur);
    });
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

export function healthScore(k: KPIs): { score: number; grade: string; drivers: { label: string; value: number }[] } {
  const margin = k.revenueMonth > 0 ? k.profitMonth / k.revenueMonth : 0;
  const marginScore = Math.max(0, Math.min(100, 50 + margin * 150));
  const runwayScore =
    k.runwayMonths === null ? 95 : Math.max(0, Math.min(100, (k.runwayMonths / 12) * 100));
  const debtRatio =
    k.bankBalance > 0 ? (k.loanOutstanding + k.cardOutstanding) / (k.bankBalance * 3) : 1;
  const debtScore = Math.max(0, Math.min(100, 100 - debtRatio * 60));
  const growthScore = Math.max(0, Math.min(100, 50 + k.revenueMoM * 2));
  const score = Math.round(marginScore * 0.3 + runwayScore * 0.3 + debtScore * 0.2 + growthScore * 0.2);
  const grade = score >= 80 ? "Excellent" : score >= 65 ? "Strong" : score >= 45 ? "Fair" : "At Risk";
  return {
    score,
    grade,
    drivers: [
      { label: "Profit Margin", value: Math.round(marginScore) },
      { label: "Cash Runway", value: Math.round(runwayScore) },
      { label: "Debt Load", value: Math.round(debtScore) },
      { label: "Revenue Growth", value: Math.round(growthScore) },
    ],
  };
}

/** Cash-flow forecast: trailing-3-month average net, projected forward. */
export function forecast(txns: Transaction[], balance: number, months = 6) {
  const hist = monthlySeries(txns, 6);
  const trailing = hist.slice(-3);
  const avgIn = trailing.reduce((s, p) => s + p.cashIn, 0) / 3;
  const avgOut = trailing.reduce((s, p) => s + p.cashOut, 0) / 3;
  const growth = 1.02;
  const out: { label: string; projected: number }[] = [];
  let bal = balance;
  const now = new Date();
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    bal += avgIn * Math.pow(growth, i) - avgOut * Math.pow(1.01, i);
    out.push({
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      projected: Math.round(bal),
    });
  }
  return out;
}

export function buildNotifications(
  business: BusinessId,
  txns: Transaction[],
  loans: Loan[],
  cards: CreditCard[],
  invoices: Invoice[],
  recurring: RecurringExpense[],
  kpis: KPIs
): AppNotification[] {
  const out: AppNotification[] = [];
  const today = todayISO();
  const push = (n: Omit<AppNotification, "id" | "read" | "businessId">) =>
    out.push({ ...n, id: `${n.kind}-${n.title}`.replace(/\s+/g, "-").toLowerCase(), read: false, businessId: business });

  loans.forEach((l) => {
    const d = daysUntil(l.nextDueDate);
    if (d >= 0 && d <= 10)
      push({
        kind: "emi-due",
        title: `EMI due in ${d} day${d === 1 ? "" : "s"} — ${l.name}`,
        body: `${fmtINR(l.emi)} to ${l.lender} on ${l.nextDueDate}`,
        severity: d <= 3 ? "critical" : "warning",
        date: today,
      });
  });
  cards.forEach((c) => {
    const d = daysUntil(c.dueDate);
    if (d >= 0 && d <= 12)
      push({
        kind: "card-due",
        title: `${c.name} payment due in ${d} day${d === 1 ? "" : "s"}`,
        body: `Total due ${fmtINR(c.totalDue)} (min ${fmtINR(c.minDue)})`,
        severity: d <= 3 ? "critical" : "warning",
        date: today,
      });
    if (c.limit > 0 && c.outstanding / c.limit > 0.6)
      push({
        kind: "card-due",
        title: `High utilization on ${c.name}`,
        body: `${Math.round((c.outstanding / c.limit) * 100)}% of ${fmtINR(c.limit)} limit used`,
        severity: "warning",
        date: today,
      });
  });
  // GST due on the 20th
  const day = new Date().getDate();
  if (day >= 12 && day <= 20)
    push({
      kind: "gst-due",
      title: `GSTR-3B filing due on the 20th`,
      body: `Estimated liability ${fmtINR(kpis.gstEstimate)}`,
      severity: day >= 18 ? "critical" : "info",
      date: today,
    });
  if (kpis.runwayMonths !== null && kpis.runwayMonths < 6)
    push({
      kind: "low-cash",
      title: `Cash runway below 6 months`,
      body: `${kpis.runwayMonths.toFixed(1)} months at current burn of ${fmtINR(kpis.monthlyBurn)}/mo`,
      severity: kpis.runwayMonths < 3 ? "critical" : "warning",
      date: today,
    });
  // Large transactions in last 7 days (> 2x p90 of trailing amounts)
  const recent = txns.filter((t) => daysUntil(t.date) >= -7);
  const amounts = txns.map((t) => t.amount).sort((a, b) => a - b);
  const p90 = amounts[Math.floor(amounts.length * 0.9)] ?? 0;
  recent
    .filter((t) => t.amount > p90 * 1.5 && t.amount > 100000)
    .slice(0, 3)
    .forEach((t) =>
      push({
        kind: "large-txn",
        title: `Large ${t.type === "credit" ? "inflow" : "outflow"}: ${fmtINR(t.amount)}`,
        body: t.description.slice(0, 80),
        severity: "info",
        date: t.date,
      })
    );
  recurring
    .filter((r) => r.active && daysUntil(r.nextDate) >= 0 && daysUntil(r.nextDate) <= 5)
    .forEach((r) =>
      push({
        kind: "recurring-due",
        title: `${r.name} renews in ${daysUntil(r.nextDate)} day${daysUntil(r.nextDate) === 1 ? "" : "s"}`,
        body: `${fmtINR(r.amount)} to ${r.vendor}`,
        severity: "info",
        date: today,
      })
    );
  return out;
}
