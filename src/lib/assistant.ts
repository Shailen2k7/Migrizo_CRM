import { CreditCard, Invoice, Loan, RecurringExpense, Transaction } from "./types";
import {
  KPIs,
  categoryBreakdown,
  forecast,
  isExpense,
  isRevenue,
  monthlySeries,
  topCounterparties,
} from "./metrics";
import { daysUntil, fmtINR, monthKey } from "./format";

export interface AssistantContext {
  txns: Transaction[];
  loans: Loan[];
  cards: CreditCard[];
  invoices: Invoice[];
  recurring: RecurringExpense[];
  kpis: KPIs;
  businessName: string;
}

export interface AssistantReply {
  text: string;
  bullets?: string[];
  table?: { headers: string[]; rows: (string | number)[][] };
}

export function answer(query: string, ctx: AssistantContext): AssistantReply {
  const q = query.toLowerCase();
  const { txns, kpis, businessName } = ctx;

  /* Where did my money go */
  if (/(where.*money|where did|spend.*this month|money go)/.test(q)) {
    const cats = categoryBreakdown(txns, "debit", 1);
    const total = cats.reduce((s, c) => s + c.amount, 0);
    return {
      text: `In the last 30 days ${businessName} spent ${fmtINR(total)}. Here's where it went:`,
      table: {
        headers: ["Category", "Amount", "Share"],
        rows: cats.slice(0, 8).map((c) => [c.category, fmtINR(c.amount), `${((c.amount / total) * 100).toFixed(1)}%`]),
      },
    };
  }

  /* Biggest expenses */
  if (/(biggest|largest|top).*(expense|spend|cost)/.test(q)) {
    const biggest = txns
      .filter((t) => isExpense(t))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
    return {
      text: "Your biggest individual expenses (all time in view):",
      table: {
        headers: ["Date", "Description", "Category", "Amount"],
        rows: biggest.map((t) => [t.date, t.description.slice(0, 44), t.category, fmtINR(t.amount)]),
      },
    };
  }

  /* Marketing spend */
  if (/marketing|ads|advertis/.test(q)) {
    const mkt = txns.filter(
      (t) => t.type === "debit" && ["Marketing", "Meta Ads", "Google Ads"].includes(t.category)
    );
    const total = mkt.reduce((s, t) => s + t.amount, 0);
    const thisMonth = mkt.filter((t) => monthKey(t.date) === monthKey(new Date().toISOString())).reduce((s, t) => s + t.amount, 0);
    const byCat = new Map<string, number>();
    mkt.forEach((t) => byCat.set(t.category, (byCat.get(t.category) ?? 0) + t.amount));
    return {
      text: `Total marketing spend: ${fmtINR(total)} (${fmtINR(thisMonth)} this month).`,
      table: {
        headers: ["Channel", "Total Spend"],
        rows: Array.from(byCat.entries()).map(([c, a]) => [c, fmtINR(a)]),
      },
    };
  }

  /* Compare months */
  if (/compare|vs last|versus|month over month|mom/.test(q)) {
    const series = monthlySeries(txns, 2);
    const [prev, cur] = series;
    if (!prev || !cur) return { text: "Not enough history to compare months yet." };
    const d = (a: number, b: number) => (b === 0 ? "—" : `${a >= b ? "+" : ""}${(((a - b) / Math.abs(b)) * 100).toFixed(1)}%`);
    return {
      text: `This month vs last month for ${businessName}:`,
      table: {
        headers: ["Metric", "Last Month", "This Month", "Change"],
        rows: [
          ["Revenue", fmtINR(prev.revenue), fmtINR(cur.revenue), d(cur.revenue, prev.revenue)],
          ["Expenses", fmtINR(prev.expenses), fmtINR(cur.expenses), d(cur.expenses, prev.expenses)],
          ["Profit", fmtINR(prev.profit), fmtINR(cur.profit), d(cur.profit, prev.profit)],
          ["Net Cash", fmtINR(prev.net), fmtINR(cur.net), d(cur.net, prev.net)],
        ],
      },
    };
  }

  /* Cash-flow prediction */
  if (/predict|forecast|next month|projection|runway/.test(q)) {
    const fc = forecast(txns, kpis.bankBalance, 6);
    const runway =
      kpis.runwayMonths === null
        ? "you're cash-flow positive, so runway is effectively unlimited"
        : `${kpis.runwayMonths.toFixed(1)} months of runway at the current burn of ${fmtINR(kpis.monthlyBurn)}/month`;
    return {
      text: `Based on your trailing 3-month average, ${runway}. Projected bank balance:`,
      table: {
        headers: ["Month", "Projected Balance"],
        rows: fc.map((f) => [f.label, fmtINR(f.projected)]),
      },
    };
  }

  /* Upcoming liabilities */
  if (/upcoming|liabilit|due soon|payments due|what.*due/.test(q)) {
    const items: { label: string; date: string; amount: number }[] = [
      ...ctx.loans.map((l) => ({ label: `${l.name} EMI`, date: l.nextDueDate, amount: l.emi })),
      ...ctx.cards.map((c) => ({ label: `${c.name} card due`, date: c.dueDate, amount: c.totalDue })),
      ...ctx.recurring.filter((r) => r.active).map((r) => ({ label: r.name, date: r.nextDate, amount: r.amount })),
    ]
      .filter((i) => daysUntil(i.date) >= -5 && daysUntil(i.date) <= 45)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      text: `Upcoming liabilities in the next 45 days total ${fmtINR(items.reduce((s, i) => s + i.amount, 0))}:`,
      table: {
        headers: ["Payment", "Date", "Amount"],
        rows: items.map((i) => [i.label, i.date, fmtINR(i.amount)]),
      },
    };
  }

  /* Subscriptions to cancel */
  if (/subscription|cancel|saas|cut cost|reduce spend/.test(q)) {
    const subs = ctx.recurring.filter((r) => r.active);
    const monthly = subs.reduce((s, r) => s + (r.cadence === "monthly" ? r.amount : r.cadence === "quarterly" ? r.amount / 3 : r.amount / 12), 0);
    const sorted = [...subs].sort((a, b) => b.amount - a.amount);
    return {
      text: `You have ${subs.length} active recurring expenses ≈ ${fmtINR(monthly)}/month (${fmtINR(monthly * 12)}/yr). Review the priciest first:`,
      bullets: sorted.slice(0, 5).map((r) => `${r.name} — ${fmtINR(r.amount)} ${r.cadence}. ${r.category === "Software" ? "Check seat count & usage." : "Confirm it's still needed."}`),
    };
  }

  /* Profitability advice */
  if (/profitab|improve|advice|margin|grow profit/.test(q)) {
    const cats = categoryBreakdown(txns, "debit", 3);
    const top = cats[0];
    const margin = kpis.revenueMonth > 0 ? ((kpis.profitMonth / kpis.revenueMonth) * 100).toFixed(1) : "0";
    const bullets = [
      `Current profit margin is ${margin}% (${fmtINR(kpis.profitMonth)} on ${fmtINR(kpis.revenueMonth)} revenue this month).`,
    ];
    if (top) bullets.push(`Largest cost center over 90 days: ${top.category} at ${fmtINR(top.amount)} — negotiate or optimize here first.`);
    if (kpis.cardOutstanding > 0) bullets.push(`Clear ${fmtINR(kpis.cardOutstanding)} of credit card debt to avoid 36-42% APR interest.`);
    bullets.push(`Revenue is ${kpis.revenueMoM >= 0 ? "up" : "down"} ${Math.abs(kpis.revenueMoM).toFixed(1)}% MoM — ${kpis.revenueMoM >= 0 ? "double down on what's working" : "investigate the dip before cutting costs"}.`);
    return { text: "Here's my read on improving profitability:", bullets };
  }

  /* Top clients / vendors */
  if (/top client|best client|top vendor|who pays/.test(q)) {
    const field = q.includes("vendor") ? "vendor" : "client";
    const list = topCounterparties(txns, field as "client" | "vendor", 12);
    return {
      text: `Top ${field}s over the last 12 months:`,
      table: {
        headers: [field === "client" ? "Client" : "Vendor", "Transactions", "Total"],
        rows: list.slice(0, 8).map((c) => [c.name, c.count, fmtINR(c.amount)]),
      },
    };
  }

  /* Revenue overview */
  if (/revenue|income|earning|sales/.test(q)) {
    const rev = txns.filter(isRevenue);
    const total = rev.reduce((s, t) => s + t.amount, 0);
    const series = monthlySeries(txns, 6);
    return {
      text: `Total revenue in view: ${fmtINR(total)}. This month: ${fmtINR(kpis.revenueMonth)} (${kpis.revenueMoM >= 0 ? "+" : ""}${kpis.revenueMoM.toFixed(1)}% MoM).`,
      table: {
        headers: ["Month", "Revenue", "Profit"],
        rows: series.map((s) => [s.label, fmtINR(s.revenue), fmtINR(s.profit)]),
      },
    };
  }

  /* Balance / overview fallback */
  if (/balance|overview|summary|health|how.*doing/.test(q)) {
    return {
      text: `${businessName} snapshot right now:`,
      bullets: [
        `Bank balance: ${fmtINR(kpis.bankBalance)}`,
        `This month: ${fmtINR(kpis.revenueMonth)} revenue, ${fmtINR(kpis.expensesMonth)} expenses → ${fmtINR(kpis.profitMonth)} profit`,
        `Debt: ${fmtINR(kpis.loanOutstanding)} loans + ${fmtINR(kpis.cardOutstanding)} cards`,
        `Runway: ${kpis.runwayMonths === null ? "∞ (cash-flow positive)" : `${kpis.runwayMonths.toFixed(1)} months`}`,
      ],
    };
  }

  return {
    text: "I can answer questions about your finances. Try one of these:",
    bullets: [
      "Where did my money go this month?",
      "What are my biggest expenses?",
      "Show all marketing spend",
      "Compare this month vs last month",
      "Predict next month's cash flow",
      "Outstanding client payments?",
      "Which subscriptions should I cancel?",
      "How can I improve profitability?",
    ],
  };
}
