"use client";

import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useStore } from "@/lib/store";
import { BUSINESSES } from "@/lib/seed";
import {
  PERIODS,
  PeriodKey,
  ReportLine,
  balanceSheet,
  cashFlowStatement,
  counterpartyReport,
  downloadCSV,
  downloadExcel,
  exportPDF,
  gstSummary,
  inPeriod,
  periodRange,
  profitAndLoss,
} from "@/lib/reports";
import { monthlySeries } from "@/lib/metrics";
import { fmtINR, fmtINRPrecise, monthLabel } from "@/lib/format";
import { Button, Card, Select, cn, toast } from "@/components/ui";

type Tab = "pl" | "bs" | "cf" | "gst" | "vendors" | "clients" | "monthly";

const TABS: { key: Tab; label: string }[] = [
  { key: "pl", label: "Profit & Loss" },
  { key: "bs", label: "Balance Sheet" },
  { key: "cf", label: "Cash Flow" },
  { key: "gst", label: "GST Summary" },
  { key: "vendors", label: "Vendor Report" },
  { key: "clients", label: "Client Report" },
  { key: "monthly", label: "Monthly Summary" },
];

export default function AccountingPage() {
  const activeBusiness = useStore((s) => s.activeBusiness);
  const transactions = useStore((s) => s.transactions);
  const loans = useStore((s) => s.loans);
  const cards = useStore((s) => s.cards);
  const invoices = useStore((s) => s.invoices);
  const openingBalances = useStore((s) => s.openingBalances);

  const [tab, setTab] = useState<Tab>("pl");
  // null means "let the data decide"; picking a period from the dropdown pins it.
  const [chosenPeriod, setChosenPeriod] = useState<PeriodKey | null>(null);

  // Statements uploaded for a past financial year would leave every report at
  // zero on the default "This FY". Derive the sensible default rather than
  // correcting it after render — a state update here would fight React.
  const autoPeriod: PeriodKey = useMemo(() => {
    const mine = transactions.filter((t) => t.businessId === activeBusiness);
    if (mine.length > 0 && inPeriod(mine, "this-fy").length === 0) return "all";
    return "this-fy";
  }, [transactions, activeBusiness]);

  const period = chosenPeriod ?? autoPeriod;
  const choosePeriod = (p: PeriodKey) => setChosenPeriod(p);

  const biz = BUSINESSES.find((b) => b.id === activeBusiness) ?? BUSINESSES[0];
  const range = periodRange(period);

  const data = useMemo(() => {
    const all = transactions.filter((t) => t.businessId === activeBusiness);
    const txns = inPeriod(all, period);
    const bl = loans.filter((l) => l.businessId === activeBusiness);
    const bc = cards.filter((c) => c.businessId === activeBusiness);
    const bi = invoices.filter((i) => i.businessId === activeBusiness);
    return {
      all,
      txns,
      pl: profitAndLoss(txns),
      bs: balanceSheet(all, bl, bc, bi, openingBalances[activeBusiness]),
      cf: cashFlowStatement(txns, openingBalances[activeBusiness]),
      gst: gstSummary(txns),
      vendors: counterpartyReport(txns, "vendor"),
      clients: counterpartyReport(txns, "client"),
      monthly: monthlySeries(all, 12),
    };
  }, [transactions, loans, cards, invoices, activeBusiness, period, openingBalances]);

  const currentSections = (): { heading: string; lines: ReportLine[] }[] => {
    switch (tab) {
      case "pl":
        return [
          { heading: "Revenue", lines: data.pl.revenue },
          { heading: "Expenses", lines: data.pl.expenses },
          { heading: "Summary", lines: data.pl.summary },
        ];
      case "bs":
        return [
          { heading: "Assets", lines: data.bs.assets },
          { heading: "Liabilities", lines: data.bs.liabilities },
          { heading: "Equity", lines: data.bs.equity },
        ];
      case "cf":
        return [{ heading: "Cash Flow Statement", lines: data.cf }];
      case "gst":
        return [{ heading: "GST Summary (estimates)", lines: data.gst }];
      case "vendors":
        return [
          {
            heading: "Vendor Payments",
            lines: data.vendors.map((v) => ({ label: `${v.name} (${v.count} txns)`, amount: v.amount, indent: true })),
          },
        ];
      case "clients":
        return [
          {
            heading: "Client Revenue",
            lines: data.clients.map((v) => ({ label: `${v.name} (${v.count} txns)`, amount: v.amount, indent: true })),
          },
        ];
      case "monthly":
        return [
          {
            heading: "Monthly Summary",
            lines: data.monthly.map((m) => ({
              label: `${monthLabel(m.month)} — Rev ${fmtINR(m.revenue)} / Exp ${fmtINR(m.expenses)}`,
              amount: m.profit,
              indent: true,
            })),
          },
        ];
    }
  };

  const tabLabel = TABS.find((t) => t.key === tab)!.label;
  const fileBase = `${biz.name}_${tabLabel.replace(/\s+/g, "")}_${range.label.replace(/[\s–]/g, "")}`;

  const toRows = (): (string | number)[][] => {
    if (tab === "monthly") {
      return [
        ["Month", "Revenue", "Expenses", "Profit", "Cash In", "Cash Out", "Net Cash"],
        ...data.monthly.map((m) => [monthLabel(m.month), m.revenue, m.expenses, m.profit, m.cashIn, m.cashOut, m.net]),
      ];
    }
    if (tab === "vendors" || tab === "clients") {
      const list = tab === "vendors" ? data.vendors : data.clients;
      return [["Name", "Transactions", "Total Amount"], ...list.map((v) => [v.name, v.count, v.amount])];
    }
    const rows: (string | number)[][] = [["Line Item", "Amount (INR)"]];
    currentSections().forEach((s) => {
      rows.push([`— ${s.heading} —`, ""]);
      s.lines.forEach((l) => rows.push([l.label, Math.round(l.amount * 100) / 100]));
    });
    return rows;
  };

  const subtitle = `${biz.name} · ${range.label} (${range.from} → ${range.to})`;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 animate-fade-up">
        <div>
          <p className="label-caps mb-1">{biz.name}</p>
          <h1 className="text-3xl font-bold tracking-tight">Accounting Center</h1>
          <p className="mt-1 text-sm text-text-3">
            Auto-generated, CA-ready statements. Every edit anywhere updates these instantly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={period} onChange={(e) => choosePeriod(e.target.value as PeriodKey)} className="w-44">
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </Select>
          <Button onClick={() => { downloadCSV(`${fileBase}.csv`, toRows()); toast("CSV downloaded"); }}>
            <Download size={14} /> CSV
          </Button>
          <Button onClick={() => { downloadExcel(`${fileBase}.xlsx`, [{ name: tabLabel, rows: toRows() }]); toast("Excel downloaded"); }}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
          <Button variant="primary" onClick={() => exportPDF(`${biz.name} — ${tabLabel}`, subtitle, currentSections())}>
            <Printer size={14} /> One-Click CA Export
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-md border border-border bg-surface-2/60 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded px-3.5 py-2 text-[13px] font-semibold transition-all",
              tab === t.key ? "bg-primary text-primary-fg shadow-card" : "text-text-3 hover:text-text"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Report body */}
      {tab === "monthly" ? (
        <Card className="p-0" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {["Month", "Revenue", "Expenses", "Profit", "Cash In", "Cash Out", "Net Cash"].map((h, i) => (
                    <th key={h} className={cn("label-caps px-4 py-3 font-semibold", i > 0 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={m.month} className="border-b border-border/50 last:border-0 hover:bg-surface-3/30">
                    <td className="px-4 py-3 font-medium">{monthLabel(m.month)}</td>
                    <td className="num px-4 py-3 text-right text-positive">{fmtINR(m.revenue)}</td>
                    <td className="num px-4 py-3 text-right text-negative">{fmtINR(m.expenses)}</td>
                    <td className={cn("num px-4 py-3 text-right font-semibold", m.profit >= 0 ? "text-positive" : "text-negative")}>
                      {fmtINR(m.profit)}
                    </td>
                    <td className="num px-4 py-3 text-right">{fmtINR(m.cashIn)}</td>
                    <td className="num px-4 py-3 text-right">{fmtINR(m.cashOut)}</td>
                    <td className={cn("num px-4 py-3 text-right font-semibold", m.net >= 0 ? "text-positive" : "text-negative")}>
                      {fmtINR(m.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : tab === "vendors" || tab === "clients" ? (
        <Card className="p-0" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="label-caps px-4 py-3 font-semibold">{tab === "vendors" ? "Vendor" : "Client"}</th>
                  <th className="label-caps px-4 py-3 text-right font-semibold">Transactions</th>
                  <th className="label-caps px-4 py-3 text-right font-semibold">Total</th>
                  <th className="label-caps px-4 py-3 text-right font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {(tab === "vendors" ? data.vendors : data.clients).map((v, _, arr) => {
                  const total = arr.reduce((s, x) => s + x.amount, 0);
                  return (
                    <tr key={v.name} className="border-b border-border/50 last:border-0 hover:bg-surface-3/30">
                      <td className="px-4 py-3 font-medium">{v.name}</td>
                      <td className="num px-4 py-3 text-right text-text-3">{v.count}</td>
                      <td className="num px-4 py-3 text-right font-semibold">{fmtINR(v.amount)}</td>
                      <td className="num px-4 py-3 text-right text-text-3">
                        {total ? ((v.amount / total) * 100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  );
                })}
                {(tab === "vendors" ? data.vendors : data.clients).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-text-3">No data in this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {currentSections().map((s) => (
            <Card key={s.heading} className={cn("p-5", currentSections().length === 1 && "lg:col-span-2")} hover={false}>
              <h2 className="label-caps mb-4 border-b border-border pb-2.5 !text-xs">{s.heading}</h2>
              <div className="space-y-0.5">
                {s.lines.map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-baseline justify-between gap-4 rounded px-2 py-2",
                      l.bold && "mt-1.5 border-t border-border-strong/50 pt-3 font-bold",
                      !l.bold && "text-[13.5px] hover:bg-surface-3/30"
                    )}
                  >
                    <span className={cn(l.indent && "pl-3", !l.bold && "text-text-2")}>{l.label}</span>
                    <span
                      className={cn(
                        "num whitespace-nowrap",
                        l.bold ? "text-base" : "text-[13px]",
                        l.amount < 0 && "text-negative",
                        l.bold && l.amount > 0 && "text-positive"
                      )}
                    >
                      {l.label === "Profit Margin" ? `${l.amount.toFixed(1)}%` : fmtINRPrecise(l.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="flex items-center gap-2 px-1 text-xs text-text-3">
        <FileText size={12} />
        GST and tax figures are estimates for planning — final filings should be verified by your CA.
      </p>
    </div>
  );
}
