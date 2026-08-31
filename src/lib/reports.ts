"use client";

import { Transaction, Loan, CreditCard, Invoice } from "./types";
import { expenseAmount, isExpense, isRevenue } from "./metrics";
import { classRole, computePL } from "./classify";
import { fmtINRPrecise, todayISO } from "./format";

export type PeriodKey = "this-month" | "last-month" | "this-quarter" | "this-fy" | "last-12" | "all";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "this-quarter", label: "This Quarter" },
  { key: "this-fy", label: "This FY (Apr–Mar)" },
  { key: "last-12", label: "Last 12 Months" },
  { key: "all", label: "All Time" },
];

export function periodRange(key: PeriodKey): { from: string; to: string; label: string } {
  const now = new Date();
  const to = todayISO();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (key) {
    case "this-month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to, label: "This Month" };
    case "last-month": {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(f), to: iso(t), label: "Last Month" };
    }
    case "this-quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { from: iso(new Date(now.getFullYear(), q * 3, 1)), to, label: "This Quarter" };
    }
    case "this-fy": {
      const fyStart = now.getMonth() >= 3 ? new Date(now.getFullYear(), 3, 1) : new Date(now.getFullYear() - 1, 3, 1);
      return { from: iso(fyStart), to, label: `FY ${fyStart.getFullYear()}-${(fyStart.getFullYear() + 1) % 100}` };
    }
    case "last-12": {
      const f = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      return { from: iso(f), to, label: "Last 12 Months" };
    }
    case "all":
      return { from: "2000-01-01", to, label: "All Time" };
  }
}

export function inPeriod(txns: Transaction[], key: PeriodKey): Transaction[] {
  const { from, to } = periodRange(key);
  return txns.filter((t) => t.date >= from && t.date <= to);
}

export interface ReportLine {
  label: string;
  amount: number;
  bold?: boolean;
  indent?: boolean;
}

/**
 * P&L built from what each transaction *is* (see classify.ts), not from its
 * debit/credit direction. Capital injections, loans and inter-company
 * transfers move cash but are not trading activity, so they never reach these
 * lines — they're reported separately as excluded movements.
 */
export function profitAndLoss(txns: Transaction[]): {
  revenue: ReportLine[];
  expenses: ReportLine[];
  summary: ReportLine[];
  excluded: ReportLine[];
} {
  const revMap = new Map<string, number>();
  const expMap = new Map<string, number>();
  txns.forEach((t) => {
    const role = classRole(t.txnClass);
    const signed = t.type === "credit" ? t.amount : -t.amount;
    if (role === "revenue") {
      revMap.set(t.category, (revMap.get(t.category) ?? 0) + signed);
    } else if (role === "cogs" || role === "opex") {
      expMap.set(t.category, (expMap.get(t.category) ?? 0) - signed);
    }
  });
  const rev = Array.from(revMap.entries()).filter(([, a]) => a !== 0).map(([label, amount]) => ({ label, amount, indent: true })).sort((a, b) => b.amount - a.amount);
  const exp = Array.from(expMap.entries()).filter(([, amount]) => amount !== 0).map(([label, amount]) => ({ label, amount, indent: true })).sort((a, b) => b.amount - a.amount);
  const totalRev = rev.reduce((s, l) => s + l.amount, 0);
  const totalExp = exp.reduce((s, l) => s + l.amount, 0);

  const pl = computePL(txns);
  const excluded: ReportLine[] = pl.excluded.map((e) => ({
    label: e.label,
    amount: e.inflow - e.outflow,
    indent: true,
  }));

  return {
    revenue: [...rev, { label: "Total Revenue", amount: totalRev, bold: true }],
    expenses: [...exp, { label: "Total Expenses", amount: totalExp, bold: true }],
    summary: [
      { label: "Net Profit / (Loss)", amount: totalRev - totalExp, bold: true },
      { label: "Profit Margin", amount: totalRev > 0 ? ((totalRev - totalExp) / totalRev) * 100 : 0 },
    ],
    excluded: excluded.length
      ? [...excluded, { label: "Net excluded cash movement", amount: pl.excludedInflow - pl.excludedOutflow, bold: true }]
      : [],
  };
}

export function cashFlowStatement(txns: Transaction[], openingBalance: number): ReportLine[] {
  let operatingIn = 0, operatingOut = 0, financing = 0, investing = 0, transfers = 0;
  txns.forEach((t) => {
    const sign = t.type === "credit" ? 1 : -1;
    if (["Loan EMI", "Interest", "Credit Card"].includes(t.category)) financing += sign * t.amount;
    else if (t.category === "Investment") investing += sign * t.amount;
    // Money moved to your own accounts still leaves *this* bank account, so it
    // has to appear here — otherwise the statement cannot reconcile to the
    // closing balance, which is the one thing a cash flow statement must do.
    else if (t.category === "Transfer") transfers += sign * t.amount;
    else if (t.type === "credit") operatingIn += t.amount;
    else operatingOut += t.amount;
  });
  const net = operatingIn - operatingOut + financing + investing + transfers;
  return [
    { label: "Opening Cash Balance", amount: openingBalance, bold: true },
    { label: "Cash from Operations (Inflows)", amount: operatingIn, indent: true },
    { label: "Cash used in Operations (Outflows)", amount: -operatingOut, indent: true },
    { label: "Net Operating Cash Flow", amount: operatingIn - operatingOut, bold: true },
    { label: "Financing Activities (EMIs, Cards, Interest)", amount: financing, indent: true },
    { label: "Investing Activities", amount: investing, indent: true },
    { label: "Transfers between own accounts", amount: transfers, indent: true },
    { label: "Net Change in Cash", amount: net, bold: true },
    { label: "Closing Cash Balance", amount: openingBalance + net, bold: true },
  ];
}

export function balanceSheet(
  txns: Transaction[],
  loans: Loan[],
  cards: CreditCard[],
  invoices: Invoice[],
  openingBalance: number
): { assets: ReportLine[]; liabilities: ReportLine[]; equity: ReportLine[] } {
  const bank = txns.reduce((s, t) => s + (t.type === "credit" ? t.amount : -t.amount), openingBalance);
  const investments = txns.filter((t) => t.category === "Investment" && t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const totalAssets = bank + investments;
  const loanL = loans.reduce((s, l) => s + l.outstanding, 0);
  const cardL = cards.reduce((s, c) => s + c.outstanding, 0);
  const totalLiab = loanL + cardL;
  return {
    assets: [
      { label: "Cash & Bank Balances", amount: bank, indent: true },
      { label: "Investments", amount: investments, indent: true },
      { label: "Total Assets", amount: totalAssets, bold: true },
    ],
    liabilities: [
      { label: "Loans Outstanding", amount: loanL, indent: true },
      { label: "Credit Card Payables", amount: cardL, indent: true },
      { label: "Total Liabilities", amount: totalLiab, bold: true },
    ],
    equity: [{ label: "Owner's Equity (Net Position)", amount: totalAssets - totalLiab, bold: true }],
  };
}

export function gstSummary(txns: Transaction[]): ReportLine[] {
  const revenue = txns.filter(isRevenue).reduce((s, t) => s + t.amount, 0);
  const expenses = txns.filter(isExpense).reduce((s, t) => s + t.amount, 0);
  const gstPaid = txns.filter((t) => t.category === "GST" && t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const outputGST = revenue * 0.18;
  const inputCredit = expenses * 0.18 * 0.35;
  return [
    { label: "Taxable Revenue (period)", amount: revenue, indent: true },
    { label: "Output GST @ 18%", amount: outputGST, indent: true },
    { label: "Estimated Input Tax Credit", amount: -inputCredit, indent: true },
    { label: "Net GST Liability (estimate)", amount: outputGST - inputCredit, bold: true },
    { label: "GST Actually Paid (period)", amount: gstPaid, indent: true },
    { label: "Balance Payable (estimate)", amount: Math.max(0, outputGST - inputCredit - gstPaid), bold: true },
  ];
}

export function counterpartyReport(txns: Transaction[], field: "vendor" | "client"): { name: string; count: number; amount: number }[] {
  const map = new Map<string, { count: number; amount: number }>();
  txns
    .filter((t) => t[field] && (field === "vendor" ? t.type === "debit" : t.type === "credit"))
    .forEach((t) => {
      const cur = map.get(t[field]!) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += t.amount;
      map.set(t[field]!, cur);
    });
  return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
}

/* ── Exports ── */

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}

export async function downloadExcel(filename: string, sheets: { name: string; rows: (string | number)[][] }[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Print-ready PDF export: opens a styled window, browser's Save-as-PDF completes it. */
export function exportPDF(title: string, subtitle: string, sections: { heading: string; lines: ReportLine[] }[]) {
  const w = window.open("", "_blank", "width=900,height=1100");
  if (!w) return;
  const fmtCell = (n: number, isPct = false) => (isPct ? `${n.toFixed(1)}%` : fmtINRPrecise(n));
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;margin:48px;max-width:800px}
    h1{font-size:22px;margin:0}
    .sub{color:#666;font-size:12px;margin-top:4px;margin-bottom:32px}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#444;border-bottom:2px solid #111;padding-bottom:6px;margin-top:32px}
    table{width:100%;border-collapse:collapse}
    td{padding:7px 4px;font-size:13px;border-bottom:1px solid #eee}
    td.num{text-align:right;font-variant-numeric:tabular-nums;font-family:Menlo,monospace;font-size:12px}
    tr.bold td{font-weight:700;border-top:2px solid #111;border-bottom:none}
    td.indent{padding-left:20px}
    .footer{margin-top:48px;font-size:10px;color:#999}
  </style></head><body>
  <h1>${title}</h1><div class="sub">${subtitle}</div>
  ${sections
    .map(
      (s) => `<h2>${s.heading}</h2><table>${s.lines
        .map(
          (l) =>
            `<tr class="${l.bold ? "bold" : ""}"><td class="${l.indent ? "indent" : ""}">${l.label}</td><td class="num">${fmtCell(l.amount, l.label === "Profit Margin")}</td></tr>`
        )
        .join("")}</table>`
    )
    .join("")}
  <div class="footer">Generated by Founder Finance OS on ${new Date().toLocaleString("en-IN")} · CA-ready statement</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
  </body></html>`);
  w.document.close();
}
