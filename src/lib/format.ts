const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * Money, to the paisa.
 *
 * These figures get reconciled line-by-line against a bank statement, so they
 * are never rounded to whole rupees — a ₹1,980.89 expense must read as
 * ₹1,980.89, not ₹1,981. Rounding for display also makes columns silently
 * fail to add up, which is worse than a slightly longer number.
 */
export function fmtINR(n: number): string {
  return inr.format(round2(n));
}

/** Whole rupees — only for places where paise would be noise (chart axes). */
export function fmtINRWhole(n: number): string {
  return inrWhole.format(Math.round(n));
}

export function fmtINRPrecise(n: number): string {
  return inr.format(round2(n));
}

/**
 * Snap a money value to exact paise.
 *
 * Amounts are held as float64, so summing hundreds of them accumulates
 * representation error — a statement that should total 42983.99 comes out as
 * 42983.99000000092. Rounding at aggregation boundaries keeps totals exact
 * without a full integer-paise refactor.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Exact sum of money values — adds in integer paise to avoid float drift. */
export function sumMoney(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.round(round2(v) * 100), 0) / 100;
}

/** Compact Indian notation: ₹1.2Cr, ₹45.2L, ₹12.4k */
export function fmtCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function fmtSigned(n: number, type: "credit" | "debit"): string {
  return `${type === "credit" ? "+" : "-"}${inr.format(round2(Math.abs(n)))}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function fmtPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7); // yyyy-MM
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(iso: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  return Math.round((d.getTime() - now.getTime()) / 86400000);
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
