"use client";

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { detectBank } from "./categorize";
import { round2, sumMoney } from "./format";

export interface RawRow {
  date: string; // yyyy-MM-dd
  description: string;
  amount: number;
  type: "credit" | "debit";
  /** Running balance after this row, when the statement prints one. */
  balance?: number;
}

/** Control totals the statement declares about itself, when it prints them. */
export interface StatementSummary {
  openingBalance?: number;
  closingBalance?: number;
  totalCredit?: number;
  totalDebit?: number;
  /** True when the figure was implied by the balance column, not printed as a label. */
  openingBalanceDerived?: boolean;
  closingBalanceDerived?: boolean;
}

/**
 * Whether the parsed rows actually add up to the statement's own closing
 * balance. This is the difference between "we read some numbers off a PDF"
 * and "we read this statement correctly" — without it, a dropped or
 * misclassified row silently corrupts every downstream figure.
 */
export interface Reconciliation {
  /** False when the statement declared balances and we failed to match them. */
  ok: boolean;
  /** False when the statement printed no control totals to check against. */
  checked: boolean;
  openingBalance?: number;
  closingBalance?: number;
  computedClosing?: number;
  difference?: number;
  message: string;
}

export interface ParseResult {
  rows: RawRow[];
  bank: string;
  warnings: string[];
  summary: StatementSummary;
  reconciliation: Reconciliation;
}

/* ── Date parsing: all common Indian bank formats ── */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function parseDate(raw: string | number | Date): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // Spreadsheet readers reconstruct dates from floats and can land a few
    // seconds either side of midnight (e.g. 31 Dec 23:59:50 for 1 Jan).
    // Snap to the nearest midnight so a transaction never falls into the
    // previous day — and therefore never into the previous month.
    const d = new Date(raw.getTime());
    const secsIntoDay = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    if (secsIntoDay >= 86400 - 120) d.setTime(d.getTime() + (86400 - secsIntoDay) * 1000);
    else if (secsIntoDay <= 120) d.setTime(d.getTime() - secsIntoDay * 1000);
    return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (typeof raw === "number") {
    // Excel serial date
    if (raw > 20000 && raw < 60000) {
      // Absorb float error (46023.9999998 → 46024) before taking the day.
      const snapped = Math.abs(raw - Math.round(raw)) < 1e-3 ? Math.round(raw) : raw;
      const d = new Date(Math.round((Math.floor(snapped) - 25569) * 86400 * 1000));
      return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // yyyy-MM-dd
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return toISO(+m[1], +m[2], +m[3]);
  // dd/MM/yyyy or dd-MM-yyyy or dd.MM.yyyy
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const yr = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return toISO(yr, +m[2], +m[1]);
  }
  // dd MMM yyyy / dd-MMM-yyyy / dd MMM yy
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]*(\d{2,4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const yr = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return toISO(yr, mo, +m[1]);
    }
  }
  // MMM dd, yyyy
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return toISO(+m[3], mo, +m[2]);
  }
  return null;
}

function toISO(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s || s === "-" || s === "--") return null;
  const isNegative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[₹$€£,()\s]/g, "").replace(/(cr|dr|inr)\.?$/i, "");
  const n = parseFloat(s);
  if (!isFinite(n) || n === 0) return null;
  return isNegative ? -Math.abs(n) : Math.abs(n);
}

/* ── Statement control totals & reconciliation ─────────────── */

/** Only the numeric control totals — not the "was this derived?" flags. */
type SummaryFigure = "openingBalance" | "closingBalance" | "totalCredit" | "totalDebit";

const SUMMARY_LABELS: [SummaryFigure, RegExp][] = [
  ["openingBalance", /opening\s*(bal|balance)|b\/?f\s*balance|balance\s*b\/?f/i],
  ["closingBalance", /closing\s*(bal|balance)|c\/?f\s*balance|balance\s*c\/?f/i],
  ["totalCredit", /total\s*(credit|deposit)s?|credit\s*total/i],
  ["totalDebit", /total\s*(debit|withdrawal)s?|debit\s*total/i],
];

const MONEY_TOKEN = /-?[\d,]+\.\d{2}/g;

/**
 * Pull the statement's own control totals out of its header.
 *
 * Two layouts are common and both appear in real Indian statements:
 *   inline   — "Opening Balance: 1,92,920.00"
 *   tabular  — a row of labels, then a row of figures underneath, which is
 *              how a PDF renders a summary strip.
 */
export function extractStatementSummary(lines: string[]): StatementSummary {
  const summary: StatementSummary = {};
  const head = lines.slice(0, 80);

  head.forEach((line, i) => {
    // Inline: label and number on the same line.
    SUMMARY_LABELS.forEach(([key, re]) => {
      if (summary[key] !== undefined) return;
      const m = line.match(re);
      if (!m) return;
      const after = line.slice((m.index ?? 0) + m[0].length);
      const n = after.match(MONEY_TOKEN);
      if (n && n.length === 1) {
        const v = parseAmount(n[0]);
        if (v !== null) summary[key] = Math.abs(v);
      }
    });

    // Tabular: this line is labels only, the next holds the figures. Match
    // them up positionally by the order the labels appear.
    const labelsHere = SUMMARY_LABELS.filter(([, re]) => re.test(line))
      .map(([key, re]) => ({ key, at: line.search(re) }))
      .sort((a, b) => a.at - b.at);
    if (labelsHere.length < 2) return;
    if (line.match(MONEY_TOKEN)) return; // figures already on this line
    const next = head[i + 1] ?? "";
    const figures = next.match(MONEY_TOKEN);
    if (!figures || figures.length < labelsHere.length) return;
    labelsHere.forEach((l, idx) => {
      if (summary[l.key] !== undefined) return;
      const v = parseAmount(figures[idx]);
      if (v !== null) summary[l.key] = Math.abs(v);
    });
  });

  return summary;
}

const PAISA = 0.011; // tolerance: a rupee statement is exact to the paisa

/**
 * Re-derive debit/credit from the running-balance column.
 *
 * Column position is unreliable in PDFs — text wraps, columns merge, and a
 * debit can land where the parser expected a credit. The balance column is
 * self-checking: if balance rose, money came in. Seeding the chain with the
 * statement's opening balance also resolves the very first row, which is
 * otherwise ambiguous.
 */
function deriveDirectionFromBalances(
  rows: RawRow[],
  openingBalance?: number
): { rows: RawRow[]; applied: boolean; mismatches: number } {
  const haveBalance = rows.filter((r) => typeof r.balance === "number").length;
  if (rows.length === 0 || haveBalance < rows.length * 0.9) {
    return { rows, applied: false, mismatches: 0 };
  }

  let mismatches = 0;
  let prev = openingBalance;
  const next = rows.map((r, i) => {
    const bal = r.balance;
    if (typeof bal !== "number") return r;
    if (typeof prev !== "number") {
      // No anchor yet (statement printed no opening balance): the first row's
      // direction stays as the column-based guess, and the chain starts here.
      prev = bal;
      return r;
    }
    const delta = bal - prev;
    prev = bal;
    if (Math.abs(delta - r.amount) < PAISA) return r.type === "credit" ? r : { ...r, type: "credit" as const };
    if (Math.abs(delta + r.amount) < PAISA) return r.type === "debit" ? r : { ...r, type: "debit" as const };
    // Balance moved by something other than this row's amount — the row is
    // suspect, but leave its direction alone and let reconciliation catch it.
    if (i > 0) mismatches++;
    return r;
  });

  return { rows: next, applied: true, mismatches };
}

/** opening + Σcredits − Σdebits must equal the statement's closing balance. */
export function reconcile(rows: RawRow[], summary: StatementSummary): Reconciliation {
  // Summed in integer paise — a float sum of several hundred rows drifts, and
  // this check is supposed to be exact.
  const credits = sumMoney(rows.filter((r) => r.type === "credit").map((r) => r.amount));
  const debits = sumMoney(rows.filter((r) => r.type === "debit").map((r) => r.amount));

  const { openingBalance, closingBalance } = summary;
  if (openingBalance === undefined || closingBalance === undefined) {
    return {
      ok: true,
      checked: false,
      openingBalance,
      closingBalance,
      message:
        "This statement doesn't print an opening and closing balance, so the import could not be checked against it. Verify the totals before relying on them.",
    };
  }

  const computedClosing = round2(openingBalance + credits - debits);
  const difference = round2(computedClosing - closingBalance);
  if (Math.abs(difference) < PAISA) {
    return {
      ok: true,
      checked: true,
      openingBalance,
      closingBalance,
      computedClosing,
      difference: 0,
      // Say which check actually ran. When the statement printed no control
      // totals and both ends came from its running-balance column, this
      // verifies the chain is unbroken — it is not an independent check
      // against figures the bank declared, and claiming otherwise would
      // overstate how much has been proven.
      message:
        summary.openingBalanceDerived || summary.closingBalanceDerived
          ? `${rows.length} transactions read, and every row agrees with the running balance column (closing ₹${closingBalance.toFixed(2)}). This statement prints no opening/closing totals of its own, so that column is the only check available.`
          : `Reconciled: ${rows.length} transactions tie exactly to the statement's closing balance.`,
    };
  }
  return {
    ok: false,
    checked: true,
    openingBalance,
    closingBalance,
    computedClosing,
    difference,
    message:
      `Does not reconcile. Opening ₹${openingBalance.toFixed(2)} + credits − debits = ₹${computedClosing.toFixed(2)}, ` +
      `but the statement's closing balance is ₹${closingBalance.toFixed(2)} — a difference of ₹${Math.abs(difference).toFixed(2)}. ` +
      `Some transactions were misread, so the figures are not safe to import.`,
  };
}

/** Shared tail for every parser: fix directions, then check the totals. */
/**
 * Fill in opening/closing balances a statement never labelled.
 *
 * Plenty of statements print no "Opening Balance" / "Closing Balance" rows at
 * all — ICICI's current-account PDF just runs an Available Balance column. The
 * figures are still there, implied by the chain: the closing balance is the
 * last row's balance, and the opening is the first row's balance backed out by
 * its own amount.
 *
 * Without this the import has no control total to check against, so the
 * reconciliation is skipped AND the Cash/Bank card silently falls back to
 * "opening balance from Settings + transactions" — which is wrong by exactly
 * however stale that setting is.
 */
function inferBalancesFromChain(rows: RawRow[], summary: StatementSummary): StatementSummary {
  const withBalance = rows.filter((r) => r.balance !== undefined);
  if (withBalance.length < 2) return summary;

  const next: StatementSummary = { ...summary };

  if (next.closingBalance === undefined) {
    next.closingBalance = withBalance[withBalance.length - 1].balance;
    next.closingBalanceDerived = true;
  }

  if (next.openingBalance === undefined) {
    const first = withBalance[0];
    const delta = first.type === "credit" ? -first.amount : first.amount;
    next.openingBalance = round2((first.balance as number) + delta);
    next.openingBalanceDerived = true;
  }

  return next;
}

function finalize(rows: RawRow[], bank: string, warnings: string[], summary: StatementSummary): ParseResult {
  const derived = deriveDirectionFromBalances(rows, summary.openingBalance);
  // Direction has to be settled first — backing the opening balance out of the
  // first row depends on knowing whether that row was a credit or a debit.
  const fullSummary = inferBalancesFromChain(derived.rows, summary);
  const reconciliation = reconcile(derived.rows, fullSummary);
  const allWarnings = [...warnings];
  if (derived.mismatches > 0) {
    allWarnings.push(
      `${derived.mismatches} row${derived.mismatches === 1 ? "" : "s"} disagree with the running balance column.`
    );
  }
  return { rows: derived.rows, bank, warnings: allWarnings, summary: fullSummary, reconciliation };
}

/* ── Header detection for tabular files ── */
const DATE_HEADERS = /^(txn\s*date|tran\s*date|transaction\s*date|value\s*date|date|posting\s*date)/i;
const DESC_HEADERS = /(narration|description|particulars|remarks|details|transaction\s*remarks)/i;
const DEBIT_HEADERS = /(withdrawal|debit|dr\b|paid\s*out)/i;
const CREDIT_HEADERS = /(deposit|credit|cr\b|paid\s*in)/i;
const AMOUNT_HEADERS = /^(amount|txn\s*amount|transaction\s*amount)/i;
const TYPE_HEADERS = /^(type|dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit|credit\s*\/\s*debit|transaction\s*type)/i;
const BALANCE_HEADERS = /(balance|bal\b)/i;

interface ColMap {
  date: number;
  desc: number;
  debit?: number;
  credit?: number;
  amount?: number;
  type?: number;
  balance?: number;
}

function findHeader(grid: unknown[][]): { map: ColMap; headerIdx: number } | null {
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const row = grid[i];
    if (!row) continue;
    const cells = row.map((c) => String(c ?? "").trim());
    const map: Partial<ColMap> = {};
    cells.forEach((c, j) => {
      if (!c) return;
      const isBalance = BALANCE_HEADERS.test(c);
      const looksDebit = DEBIT_HEADERS.test(c) && !isBalance;
      const looksCredit = CREDIT_HEADERS.test(c) && !isBalance;
      // A single column naming *both* sides ("Dr/Cr", "Debit/Credit") is a
      // direction flag, not a money column. Claim it as the type column first,
      // otherwise it gets mistaken for the debit amount and every row is
      // classified by fallback guesswork.
      if (map.type === undefined && (TYPE_HEADERS.test(c) || (looksDebit && looksCredit))) {
        map.type = j;
      } else if (map.date === undefined && DATE_HEADERS.test(c)) map.date = j;
      else if (map.desc === undefined && DESC_HEADERS.test(c)) map.desc = j;
      else if (map.debit === undefined && looksDebit) map.debit = j;
      else if (map.credit === undefined && looksCredit) map.credit = j;
      else if (map.amount === undefined && AMOUNT_HEADERS.test(c)) map.amount = j;
      else if (map.balance === undefined && isBalance) map.balance = j;
    });
    if (map.date !== undefined && map.desc !== undefined && (map.debit !== undefined || map.credit !== undefined || map.amount !== undefined)) {
      return { map: map as ColMap, headerIdx: i };
    }
  }
  return null;
}

function rowsFromGrid(grid: unknown[][], fileText: string, fileName = ""): ParseResult {
  const warnings: string[] = [];
  const found = findHeader(grid);
  const rows: RawRow[] = [];
  // Control totals usually sit in the rows above the transaction header.
  const summary = extractStatementSummary(
    grid.slice(0, 80).map((r) => (r ?? []).map((c) => String(c ?? "").trim()).filter(Boolean).join(" "))
  );

  if (!found) {
    // Headerless fallback: try [date, desc, amount] per row
    grid.forEach((row) => {
      if (!row || row.length < 3) return;
      const date = parseDate(row[0] as string);
      if (!date) return;
      const desc = String(row[1] ?? "").trim();
      const amt = parseAmount(row[2]);
      if (!desc || amt === null) return;
      rows.push({ date, description: desc, amount: Math.abs(amt), type: amt < 0 ? "debit" : "credit" });
    });
    if (rows.length === 0) warnings.push("Could not detect column headers — please check the file format.");
    return finalize(rows, detectBank(fileText, fileName), warnings, summary);
  }

  const { map, headerIdx } = found;
  let prevBalance: number | null = null;
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    const date = parseDate(row[map.date] as string);
    const desc = String(row[map.desc] ?? "").trim();
    if (!date || !desc) continue;
    let amount: number | null = null;
    let type: "credit" | "debit" | null = null;

    if (map.debit !== undefined || map.credit !== undefined) {
      const dr = map.debit !== undefined ? parseAmount(row[map.debit]) : null;
      const cr = map.credit !== undefined ? parseAmount(row[map.credit]) : null;
      if (dr !== null && dr !== 0) { amount = Math.abs(dr); type = "debit"; }
      else if (cr !== null && cr !== 0) { amount = Math.abs(cr); type = "credit"; }
    }
    if (amount === null && map.amount !== undefined) {
      const rawCell = String(row[map.amount] ?? "");
      const a = parseAmount(rawCell);
      if (a !== null) {
        amount = Math.abs(a);
        // Direction, in order of how explicit the statement is being:
        // 1. a dedicated Dr/Cr column
        if (map.type !== undefined) {
          const t = String(row[map.type] ?? "").toLowerCase();
          if (/\b(cr|credit)\b/.test(t)) type = "credit";
          else if (/\b(dr|debit|withdrawal)\b/.test(t)) type = "debit";
        }
        // 2. a Dr/Cr marker inside the amount cell itself ("5,000.00 Dr")
        if (type === null) {
          const marker = rawCell.match(/\b(cr|dr)\b/i)?.[1]?.toLowerCase();
          if (marker) type = marker === "cr" ? "credit" : "debit";
        }
        // 3. which way the running balance moved
        if (type === null && map.balance !== undefined) {
          const bal = parseAmount(row[map.balance]);
          if (bal !== null && prevBalance !== null) type = bal > prevBalance ? "credit" : "debit";
        }
        // 4. the sign on the number
        if (type === null) type = a < 0 ? "debit" : "credit";
      }
    }
    let rowBalance: number | undefined;
    if (map.balance !== undefined) {
      const bal = parseAmount(row[map.balance]);
      if (bal !== null) {
        prevBalance = bal;
        rowBalance = bal;
      }
    }
    if (amount !== null && type !== null) {
      rows.push({ date, description: desc.replace(/\s+/g, " "), amount, type, balance: rowBalance });
    }
  }
  if (rows.length === 0) warnings.push("Headers detected but no valid transaction rows were parsed.");
  return finalize(rows, detectBank(fileText, fileName), warnings, summary);
}

/* ── CSV ── */
export async function parseCSV(file: File): Promise<ParseResult> {
  const text = await file.text();
  return new Promise((resolve) => {
    Papa.parse<string[]>(text, {
      skipEmptyLines: "greedy",
      complete: (res) => resolve(rowsFromGrid(res.data as unknown[][], text.slice(0, 4000), file.name)),
    });
  });
}

/* ── Excel ── */
export async function parseExcel(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  // Read dates as raw serial numbers rather than reconstructed Date objects —
  // the numeric path below is exact, the Date path is subject to float drift.
  const wb = XLSX.read(buf, { type: "array" });
  let best: ParseResult | null = null;
  // Workbooks often park the control totals on a separate "Summary" sheet, so
  // gather them across every sheet rather than only the one holding the rows.
  const summary: StatementSummary = {};
  const grids: { grid: unknown[][]; flat: string }[] = [];

  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    const flat = grid.slice(0, 40).flat().join(" ");
    grids.push({ grid, flat });
    const s = extractStatementSummary(
      grid.slice(0, 80).map((r) => (r ?? []).map((c) => String(c ?? "").trim()).filter(Boolean).join(" "))
    );
    (["openingBalance", "closingBalance", "totalCredit", "totalDebit"] as SummaryFigure[]).forEach(
      (k) => {
        if (summary[k] === undefined && s[k] !== undefined) summary[k] = s[k];
      }
    );
  }

  for (const { grid, flat } of grids) {
    const res = rowsFromGrid(grid, flat, file.name);
    if (!best || res.rows.length > best.rows.length) best = res;
  }

  if (!best) {
    return {
      rows: [],
      bank: detectBank("", file.name),
      warnings: ["No sheets found in this workbook."],
      summary,
      reconciliation: { ok: true, checked: false, message: "Nothing to reconcile." },
    };
  }
  if (best.rows.length === 0) best.warnings.push("No transaction table found in any sheet.");
  // Re-run the check with the merged, workbook-wide control totals.
  return finalize(best.rows, best.bank, best.warnings, summary);
}

/**
 * Safari does not implement async iteration over ReadableStream, but pdf.js
 * relies on it inside getTextContent() (`for await (const v of readableStream)`).
 * Without this the whole PDF path dies with
 * "undefined is not a function (near '...value of readableStream...')".
 */
function ensureStreamAsyncIteration(): void {
  const proto = (globalThis as { ReadableStream?: { prototype: object } }).ReadableStream?.prototype as
    | (ReadableStream & { [Symbol.asyncIterator]?: unknown })
    | undefined;
  if (!proto || proto[Symbol.asyncIterator]) return;
  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function (this: ReadableStream) {
      const reader = this.getReader();
      return {
        next: () => reader.read(),
        async return(value?: unknown) {
          await reader.cancel();
          return { done: true, value };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  });
}

/* ── PDF ── */
export async function parsePDF(file: File): Promise<ParseResult> {
  ensureStreamAsyncIteration();
  const pdfjs = await import("pdfjs-dist");
  // Worker is served from /public (copied by the postinstall script) —
  // bundling it via new URL() breaks Next's production build.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages: PdfLine[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(buildPageLines(content.items as { str: string; transform: number[] }[]));
  }

  const allLines = pages.flat().map((l) => l.text);
  const fullText = allLines.join("\n");
  // The summary strip is part of the page furniture, so read it before the
  // boilerplate filter strips those lines out of the transaction rows.
  const summary = extractStatementSummary(allLines);
  const boilerplate = findBoilerplate(pages);
  const cands = pages.flatMap((page) => reconstructRows(page, boilerplate));
  const rows = resolveAmountsAndTypes(cands);

  const warnings: string[] = [];
  if (rows.length === 0)
    warnings.push("No transactions found in PDF. If this is a scanned statement, export CSV/Excel from netbanking instead.");
  return finalize(rows, detectBank(fullText, file.name), warnings, summary);
}

const PDF_NUM_RE = /-?[\d,]+\.\d{2}\s*(?:Cr|Dr)?/gi;

interface PdfCandidate {
  date: string;
  rest: string;
  nums: string[];
  /** Horizontal position of each entry in `nums`, for reading Dr/Cr columns. */
  numXs: number[];
}

/**
 * Does the final numeric column behave like a running balance?
 *
 * Bank statements print `... <amount> <balance>`, where the balance moves by
 * the amount on every row. Credit-card statements print
 * `... <foreign-currency amount> <INR amount>` with no balance at all — and
 * the FX column is 0.00 for domestic spends. Guessing wrong silently drops
 * most of the file, so decide from the numbers themselves.
 */
function hasRunningBalance(cands: PdfCandidate[]): boolean {
  const rows = cands.filter((c) => c.nums.length >= 2);
  if (rows.length < 4) return false;
  let agree = 0;
  let tested = 0;
  let prev: number | null = null;
  for (const c of rows) {
    const amt = Math.abs(parseAmount(c.nums[c.nums.length - 2]) ?? 0);
    const bal = parseAmount(c.nums[c.nums.length - 1]);
    if (bal === null) continue;
    if (prev !== null && amt > 0) {
      tested++;
      if (Math.abs(Math.abs(bal - prev) - amt) < 0.05) agree++;
    }
    prev = bal;
  }
  return tested >= 3 && agree / tested >= 0.6;
}

/**
 * Where the debit and credit columns sit, when the statement uses two.
 *
 * Every row after the first gets its direction from the running balance, which
 * is self-checking. The FIRST row has no previous balance to compare against,
 * and defaulting it to "debit" is a coin flip that silently books a sale as an
 * expense and throws the derived opening balance out by twice the amount.
 * Clustering the amount column x-positions recovers the answer: on a two-column
 * layout the debits and credits form two distinct vertical bands.
 */
function amountColumnSplit(cands: PdfCandidate[]): number | null {
  const xs: number[] = [];
  for (const c of cands) {
    if (c.nums.length >= 2 && c.numXs.length === c.nums.length) xs.push(c.numXs[c.nums.length - 2]);
  }
  if (xs.length < 8) return null;

  const sorted = [...xs].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  // One column: every amount lands in essentially the same place.
  if (max - min < 12) return null;

  // Widest gap between consecutive positions separates the two columns.
  let split = 0;
  let widest = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > widest) {
      widest = gap;
      split = (sorted[i] + sorted[i - 1]) / 2;
    }
  }
  // A real column break is a big share of the total spread; anything less is
  // just jitter from differing number widths.
  return widest > (max - min) * 0.4 ? split : null;
}

function resolveAmountsAndTypes(cands: PdfCandidate[]): RawRow[] {
  const balanceLayout = hasRunningBalance(cands);
  const columnSplit = balanceLayout ? amountColumnSplit(cands) : null;
  const rows: RawRow[] = [];
  let prevBalance: number | null = null;

  for (const { date, rest, nums, numXs } of cands) {
    let amount: number | null = null;
    let type: "credit" | "debit" | null = null;
    let rowBalance: number | undefined;

    if (balanceLayout && nums.length >= 2) {
      const amtRaw = nums[nums.length - 2];
      const amt = parseAmount(amtRaw);
      const balance = parseAmount(nums[nums.length - 1]);
      if (amt !== null) {
        amount = Math.abs(amt);
        const marker = amtRaw.match(/(cr|dr)/i)?.[1]?.toLowerCase();
        const amountX = numXs.length === nums.length ? numXs[nums.length - 2] : null;
        if (marker) type = marker === "cr" ? "credit" : "debit";
        else if (balance !== null && prevBalance !== null) type = balance > prevBalance ? "credit" : "debit";
        // No previous balance yet (the first row): read the column instead of
        // guessing. Debits sit to the left of credits on a two-column layout.
        else if (columnSplit !== null && amountX !== null) type = amountX < columnSplit ? "debit" : "credit";
        else if (/\b(credit|deposit|received|refund|reversal|cr)\b/i.test(rest)) type = "credit";
        else type = "debit";
      }
      if (balance !== null) {
        prevBalance = balance;
        rowBalance = balance;
      }
    } else {
      // Single money column: the last figure is the charge. A negative value
      // (or a Cr marker) is money coming back — a payment, refund or reversal.
      const raw = nums[nums.length - 1];
      const amt = parseAmount(raw);
      if (amt !== null) {
        amount = Math.abs(amt);
        const marker = raw.match(/(cr|dr)/i)?.[1]?.toLowerCase();
        if (marker) type = marker === "cr" ? "credit" : "debit";
        else type = amt < 0 ? "credit" : "debit";
      }
    }

    if (amount === null || type === null || amount <= 0) continue;
    const description = rest.replace(/\s+[A-Z]{3}$/, "").replace(/[\s|]+$/, "").trim();
    if (!description) continue;
    rows.push({ date, description, amount, type, balance: rowBalance });
  }
  return rows;
}

/* ── Geometry-aware row reconstruction ────────────────────────────────────
 * Many bank e-statements lay out one transaction across several visual
 * lines: the description cell wraps, and its wrapped fragments can render
 * ABOVE or BELOW the single date/amount/balance line depending on how the
 * PDF generator vertically aligns the cell. A page-order, line-by-line scan
 * either misses these rows entirely (when the date itself is split across
 * lines) or silently glues the wrong fragments onto the wrong row.
 *
 * Instead: find every line that legitimately opens a new transaction (an
 * "anchor"), assign every other line on the page to whichever anchor is
 * nearest by vertical position — reuniting a wrapped cell with its own row
 * regardless of which side it rendered on — then classify every text item
 * in the reconstructed row as a date fragment, a money figure, or
 * description prose. Item-level classification (rather than a whole-line
 * regex) survives numbers and dates landing in the middle of the row's text
 * instead of neatly at the end. ──────────────────────────────────────── */

interface PdfItem {
  x: number;
  str: string;
}
interface PdfLine {
  y: number;
  items: PdfItem[];
  text: string;
}

function buildPageLines(items: { str: string; transform: number[] }[]): PdfLine[] {
  const lineMap = new Map<number, PdfItem[]>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5]);
    let key = y;
    for (const k of Array.from(lineMap.keys())) {
      if (Math.abs(k - y) <= 2) {
        key = k;
        break;
      }
    }
    const arr = lineMap.get(key) ?? [];
    arr.push({ x: item.transform[4], str: item.str });
    lineMap.set(key, arr);
  }
  return Array.from(lineMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([y, its]) => {
      const sorted = its.sort((a, b) => a.x - b.x);
      return {
        y,
        items: sorted,
        text: sorted.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((l) => l.text);
}

const ANCHOR_RE =
  /^(?:\d{1,5}\s+[A-Za-z]{0,4}\d{4,}[A-Za-z0-9]*\s+)?(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s-][A-Za-z]{3,9}[\s.,-]{0,4}\d{0,4})/;
const BOILERPLATE_RE =
  /^(page\s+\d+\s+of\s+\d+|generated\s+on|statement\s+of\s+transactions|statement\s+of\s+account|registered\s+office|s\.?\s*no\.?\s+transaction|opening\s+balance$)/i;

const ROWNUM_ITEM_RE = /^\d{1,5}$/;
const MONEY_ITEM_RE = /^\(?-?[\d,]+\.\d{2}\)?\s*(cr|dr)?$/i;
const DATE_NUMERIC_ITEM_RE = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
const DATE_ISO_ITEM_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ALPHA_ITEM_RE = /^(\d{1,2})[-\s]?([A-Za-z]{3,9})[-\s,]*(\d{2,4})?$/;
const YEAR_ITEM_RE = /^\d{2,4}$/;

/**
 * Lines that repeat near-verbatim on almost every page are running
 * headers/footers (account name, IFSC, "Page N of M", column titles).
 *
 * The threshold has to sit well above how often a genuinely common bit of
 * *narration* can repeat — "NEFT/", "PRIVATE LIMITED/" and similar fragments
 * showed up on 60-85% of pages in a real 95-page statement (most transfers
 * on the account happened to route through a handful of counterparties).
 * A lower bar strips those from the affected rows' descriptions, and if a
 * row's entire narration happens to land on lines that get stripped this
 * way, the row itself would otherwise be silently discarded further down —
 * turning a merely-incomplete description into a missing transaction. True
 * structural boilerplate appears on essentially every page without
 * exception, so 90% has a comfortable margin above that risk.
 */
function findBoilerplate(pages: PdfLine[][]): Set<string> {
  if (pages.length < 2) return new Set();
  const freq = new Map<string, number>();
  for (const page of pages) {
    new Set(page.map((l) => l.text)).forEach((t) => freq.set(t, (freq.get(t) ?? 0) + 1));
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.9));
  const boiler = new Set<string>();
  freq.forEach((count, text) => {
    if (count >= threshold) boiler.add(text);
  });
  return boiler;
}

/** Narration schemes Indian statements lead with — see reconstructRows. */
const SCHEME_HEAD_RE =
  /^(?:UPI|IMPS|NEFT|RTGS|IFT|MMT|ACH|NACH|POS|ATM|INF|CHQ|CLG|BIL|EMI|TPT|MB|IB|REF|SI)\b/i;

/**
 * Fraction of rows whose narration starts with a recognisable scheme token.
 *
 * Used only to choose between two candidate fragment attributions: the one
 * that leaves more narrations starting where a bank narration actually starts
 * is the one that grouped the fragments correctly.
 */
function narrationScore(buckets: PdfItem[][]): number {
  let wellFormed = 0;
  let counted = 0;
  for (const items of buckets) {
    const desc = items
      .map((it) => it.str.trim())
      .filter(
        (s) =>
          s &&
          !MONEY_ITEM_RE.test(s) &&
          !DATE_NUMERIC_ITEM_RE.test(s) &&
          !DATE_ISO_ITEM_RE.test(s) &&
          !DATE_ALPHA_ITEM_RE.test(s)
      )
      .join(" ")
      .trim();
    if (!desc) continue;
    counted++;
    if (SCHEME_HEAD_RE.test(desc)) wellFormed++;
  }
  return counted ? wellFormed / counted : 0;
}

function reconstructRows(lines: PdfLine[], boilerplate: Set<string>): PdfCandidate[] {
  const isNoise = (l: PdfLine) => BOILERPLATE_RE.test(l.text) || boilerplate.has(l.text);
  const kept = lines.filter((l) => !isNoise(l));
  const anchorIdx: number[] = [];
  kept.forEach((l, i) => {
    if (ANCHOR_RE.test(l.text)) anchorIdx.push(i);
  });
  if (anchorIdx.length === 0) return [];

  // A wrapped description cell renders one of two ways, and they need
  // OPPOSITE attribution rules:
  //
  //   top-aligned  anchor line first, continuation lines below it
  //   centered     continuation lines straddle the anchor, above and below
  //
  // Attributing a fragment to the wrong neighbour used to be cosmetic. It is
  // not any more: classify.ts reads the narration to decide whether money is
  // a sale, capital, a loan or an inter-company transfer, so a misattributed
  // fragment can move revenue onto the wrong transaction. On a centered
  // layout the old "most recent anchor above" rule dropped each row's own
  // leading reference and appended the NEXT row's instead.
  //
  // Rather than guess the layout, build both attributions and keep whichever
  // yields better-formed narrations. Indian bank narrations begin with a
  // scheme token (UPI/, IMPS/, NEFT/, IFT/…), which makes that measurable.
  const attributeTopAligned = (): PdfItem[][] => {
    const out: PdfItem[][] = anchorIdx.map(() => []);
    let current = -1;
    kept.forEach((l, i) => {
      if (anchorIdx[current + 1] === i) current++;
      if (current >= 0) out[current].push(...l.items);
    });
    return out;
  };

  const attributeNearest = (): PdfItem[][] => {
    const out: PdfItem[][] = anchorIdx.map(() => []);
    const bucketOfLine = new Map<number, number>();
    anchorIdx.forEach((lineIdx, bucket) => bucketOfLine.set(lineIdx, bucket));
    const firstAnchor = anchorIdx[0];
    let prevBucket = -1;

    kept.forEach((l, i) => {
      const own = bucketOfLine.get(i);
      if (own !== undefined) {
        out[own].push(...l.items);
        prevBucket = own;
        return;
      }
      // Everything above the first anchor is the account/customer header,
      // except the single adjacent line, which on a centered layout is that
      // first transaction's own opening narration fragment.
      if (i < firstAnchor && i !== firstAnchor - 1) return;

      // Only the anchors either side of this fragment can own it. A global
      // nearest-y search would be wrong: y is page-relative, so it happily
      // matches an anchor on a different page.
      const nextBucket = prevBucket + 1 < anchorIdx.length ? prevBucket + 1 : -1;
      if (prevBucket < 0) {
        if (nextBucket >= 0) out[nextBucket].push(...l.items);
        return;
      }
      if (nextBucket < 0) {
        out[prevBucket].push(...l.items);
        return;
      }

      // y descends down a page, so a gap is only meaningful when positive;
      // a negative one means the neighbour is on another page.
      const gapAbove = kept[anchorIdx[prevBucket]].y - l.y;
      const gapBelow = l.y - kept[anchorIdx[nextBucket]].y;
      const aboveValid = gapAbove > 0;
      const belowValid = gapBelow > 0;

      let target = prevBucket;
      if (aboveValid && belowValid) target = gapBelow < gapAbove ? nextBucket : prevBucket;
      else if (belowValid) target = nextBucket;
      out[target].push(...l.items);
    });
    return out;
  };

  const buckets =
    narrationScore(attributeNearest()) > narrationScore(attributeTopAligned()) + 0.05
      ? attributeNearest()
      : attributeTopAligned();

  const cands: PdfCandidate[] = [];
  for (const items of buckets) {
    const dateParts: string[] = [];
    const nums: string[] = [];
    const numXs: number[] = [];
    const descParts: string[] = [];
    let sawDate = false;
    let pendingAlpha: { day: string; mon: string } | null = null;

    for (const it of items) {
      const s = it.str.trim();
      if (!s) continue;

      // Bare row-number column ("1", "23"), only before the date is found.
      if (!sawDate && dateParts.length === 0 && ROWNUM_ITEM_RE.test(s)) continue;

      if (MONEY_ITEM_RE.test(s)) {
        nums.push(s);
        numXs.push(it.x);
        continue;
      }

      if (dateParts.length < 2) {
        if (DATE_NUMERIC_ITEM_RE.test(s) || DATE_ISO_ITEM_RE.test(s)) {
          dateParts.push(s);
          sawDate = true;
          continue;
        }
        const am = s.match(DATE_ALPHA_ITEM_RE);
        if (am && Number(am[1]) >= 1 && Number(am[1]) <= 31) {
          if (am[3]) {
            dateParts.push(`${am[1]}-${am[2]}-${am[3]}`);
          } else {
            pendingAlpha = { day: am[1], mon: am[2] };
          }
          sawDate = true;
          continue;
        }
        if (pendingAlpha && YEAR_ITEM_RE.test(s)) {
          dateParts.push(`${pendingAlpha.day}-${pendingAlpha.mon}-${s}`);
          pendingAlpha = null;
          continue;
        }
      }
      descParts.push(s);
    }

    // Date and a money figure are what make this a real transaction. A
    // description is nice to have, but a row whose narration happened to
    // wrap entirely onto boilerplate-filtered or neighbour-claimed lines
    // still has a real amount attached to it — silently dropping it would
    // throw away money, which is worse than showing an unlabelled row the
    // founder can fill in during review.
    if (dateParts.length === 0 || nums.length === 0) continue;
    const date = parseDate(dateParts[0]);
    if (!date) continue;
    const description = descParts.join(" ").replace(/\s+/g, " ").trim() || "Bank transaction";
    cands.push({ date, rest: description, nums, numXs });
  }
  return cands;
}

export async function parseStatementFile(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseCSV(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) return parseExcel(file);
  if (name.endsWith(".pdf")) return parsePDF(file);
  throw new Error(`Unsupported file type: ${file.name}. Use PDF, CSV, XLS or XLSX.`);
}
