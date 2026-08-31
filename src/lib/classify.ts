import { Transaction, TxnType } from "./types";
import { round2, sumMoney } from "./format";

/* ──────────────────────────────────────────────────────────────
   Transaction classification layer

   A bank statement is a CASH LEDGER, not a profit & loss account. Money
   landing in the account can be a genuine sale, the owner injecting capital,
   a loan from a relative, or cash shuffled in from a sister company — and
   only the first of those is revenue. Likewise a debit can be an operating
   cost, stock purchase, loan repayment or an owner drawing, and only some of
   those belong in a P&L.

   Summing raw credits as "revenue" overstates the top line by however much
   capital and debt the founder moved through the account — in a real
   statement tested against this module, ₹56.4L of credits contained only
   ₹9.5L of actual sales.

   So every transaction carries a class, and the P&L is computed from the
   classes rather than from the debit/credit direction. Anything the rules
   cannot identify becomes `uncategorized` and is EXCLUDED from the P&L
   entirely — never silently counted as revenue or expense. An unclassified
   rupee shows up as a visible gap for the founder to resolve, which is a far
   better failure mode than a confident wrong number.
   ────────────────────────────────────────────────────────────── */

export type TxnClass =
  | "sales"
  | "capital-injection"
  | "loan-received"
  | "loan-repaid"
  | "loan-given"
  | "inter-company"
  | "owner-drawing"
  | "refund"
  | "cogs"
  | "salary"
  | "marketing"
  | "fees-gst"
  | "other-expense"
  | "uncategorized";

/** Where a class sits in the P&L — or that it sits outside it entirely. */
export type PLRole = "revenue" | "cogs" | "opex" | "excluded";

export interface ClassMeta {
  id: TxnClass;
  label: string;
  role: PLRole;
  /** Which side of the ledger this class can legitimately appear on. */
  side: "in" | "out" | "both";
  /** Short reason shown in the UI when money is excluded from the P&L. */
  note?: string;
}

export const TXN_CLASSES: ClassMeta[] = [
  { id: "sales", label: "Sales / Revenue", role: "revenue", side: "in" },
  { id: "cogs", label: "COGS / Stock", role: "cogs", side: "out" },
  { id: "salary", label: "Salary", role: "opex", side: "out" },
  { id: "marketing", label: "Marketing", role: "opex", side: "out" },
  { id: "fees-gst", label: "Fees / GST / Tax", role: "opex", side: "out" },
  { id: "other-expense", label: "Other Expense", role: "opex", side: "out" },
  { id: "capital-injection", label: "Capital Injection", role: "excluded", side: "in", note: "Owner's money in — funding, not earnings" },
  { id: "loan-received", label: "Loan Received", role: "excluded", side: "in", note: "Borrowed money — a liability, not income" },
  { id: "loan-repaid", label: "Loan Repaid", role: "excluded", side: "out", note: "Repaying principal — balance-sheet movement" },
  { id: "loan-given", label: "Loan Given", role: "excluded", side: "out", note: "Money lent out — an asset, not a cost" },
  { id: "inter-company", label: "Inter-company Transfer", role: "excluded", side: "both", note: "Moving money between your own entities" },
  { id: "owner-drawing", label: "Owner Drawing", role: "excluded", side: "out", note: "Owner taking money out — not a business cost" },
  { id: "refund", label: "Refund / Reversal", role: "excluded", side: "both", note: "Money returned — nets against the original entry" },
  { id: "uncategorized", label: "Uncategorized", role: "excluded", side: "both", note: "Not yet classified — excluded from P&L until you tag it" },
];

export const CLASS_BY_ID = new Map(TXN_CLASSES.map((c) => [c.id, c]));

export function classRole(c: TxnClass | undefined): PLRole {
  if (!c) return "excluded";
  return CLASS_BY_ID.get(c)?.role ?? "excluded";
}

export function classLabel(c: TxnClass | undefined): string {
  if (!c) return "Uncategorized";
  return CLASS_BY_ID.get(c)?.label ?? "Uncategorized";
}

/* ── Rule patterns ─────────────────────────────────────────── */

/**
 * Genuine sales channels: marketplace settlements, payment gateways and POS.
 * `DEUT0797BGL` is Deutsche Bank's IFSC that Flipkart settles from — real
 * statements often carry only the settling bank code, not the brand name.
 */
export const SALES_RE =
  /(amazon\s*seller|amazonseller|amazon\s*pay\s*india\s*settle|flipkart|deut0797bgl|easebuzz|ebgpp|razorpay|payu|cashfree|instamojo|billdesk|ccavenue|pine\s*labs|paytm\s*merchant|merchant\s*settle|marketplace|settlement|\bpos\s*(credit|collection|settle))/i;

const LOAN_RE = /\bloan\b|\bborrow/i;
const CAPITAL_RE = /(business\s*funding|\bfunding\b|fund\s*to|capital\s*(intro|inject|infusion)?|equity\s*infusion|owner\s*contribution)/i;
const DRAWING_RE = /(drawing|self\s*withdrawal|personal\s*withdrawal|own\s*use)/i;
const REFUND_RE = /\b(refund|reversal|rvsl|charge\s*back|chargeback|cashback)\b/i;
const SALARY_RE = /\b(salary|salaries|payroll|wages|stipend|incentive|bonus)\b/i;
const MARKETING_RE = /\b(google\s*ads|adwords|meta\s*ads|facebook|fb\s*ads|instagram|linkedin|marketing|campaign|influencer|seo|advertis)/i;
const FEES_GST_RE =
  /\b(gst|igst|cgst|sgst|tds|income\s*tax|advance\s*tax|professional\s*tax|bank\s*charge|chrg|charges|processing\s*fee|annual\s*fee|penalty|late\s*fee|nach|ecs\s*return)\b/i;
const COGS_RE =
  /\b(stock|inventory|purchase|procure|manufactur|packag|raw\s*material|bottle|label|carton|ingredient|blend|contract\s*manufact|cmo|supplier|vendor\s*payment)\b/i;

/* ── Counterparty map ──────────────────────────────────────── */

/**
 * Names that identify a *related party* — the founder's own accounts, sister
 * companies, family members. Money from these is capital or an inter-company
 * loan, never revenue, no matter how large. Seeded with the entities this
 * product already knows about; the founder maintains the rest in Settings
 * because only they know which personal names are related parties.
 */
export const DEFAULT_RELATED_PARTIES = [
  "nutrolis",
  "grownmind",
  "grown mind",
  "migrizo",
  "live right",
  "liverightfit",
  "lrf",
];

function matchesRelatedParty(text: string, parties: readonly string[]): boolean {
  const hay = text.toLowerCase();
  return parties.some((p) => p.trim().length > 1 && hay.includes(p.trim().toLowerCase()));
}

export interface Classification {
  txnClass: TxnClass;
  /** How the rule engine decided — surfaced in the UI so it can be audited. */
  reason: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Classify one transaction from its narration and direction.
 *
 * Order matters: related-party and explicit loan/capital wording are checked
 * before the sales patterns, because a ₹5L transfer from a sister company
 * must never be read as a marketplace settlement just because the narration
 * happens to mention a payment rail.
 */
export function classifyTransaction(
  description: string,
  type: TxnType,
  relatedParties: readonly string[] = DEFAULT_RELATED_PARTIES
): Classification {
  const d = description ?? "";
  const isIn = type === "credit";
  const related = matchesRelatedParty(d, relatedParties);

  if (REFUND_RE.test(d)) {
    return { txnClass: "refund", reason: "Narration mentions a refund or reversal", confidence: "high" };
  }

  // Explicit loan wording wins over everything except refunds.
  if (LOAN_RE.test(d)) {
    if (isIn) return { txnClass: "loan-received", reason: "Inbound money described as a loan", confidence: "high" };
    // An outbound "loan to X" is money lent, not repayment of your own debt.
    const lending = /loan\s*(to|for)\b|fund\s*to\b/i.test(d);
    return lending
      ? { txnClass: "loan-given", reason: "Outbound money described as lending to someone", confidence: "high" }
      : { txnClass: "loan-repaid", reason: "Outbound money described as loan repayment", confidence: "medium" };
  }

  if (CAPITAL_RE.test(d)) {
    return isIn
      ? { txnClass: "capital-injection", reason: "Narration describes funding or capital", confidence: "high" }
      : { txnClass: "inter-company", reason: "Outbound funding to another entity", confidence: "medium" };
  }

  if (related) {
    return {
      txnClass: "inter-company",
      reason: "Counterparty is on your related-party list",
      confidence: "high",
    };
  }

  if (isIn) {
    if (SALES_RE.test(d)) {
      return { txnClass: "sales", reason: "Marketplace, gateway or POS settlement", confidence: "high" };
    }
    // Deliberately NOT defaulting inbound money to revenue.
    return {
      txnClass: "uncategorized",
      reason: "Inbound money with no recognised sales channel — tag it to include in revenue",
      confidence: "low",
    };
  }

  if (DRAWING_RE.test(d)) {
    return { txnClass: "owner-drawing", reason: "Narration describes an owner withdrawal", confidence: "medium" };
  }
  if (SALARY_RE.test(d)) {
    return { txnClass: "salary", reason: "Narration mentions salary or payroll", confidence: "high" };
  }
  if (MARKETING_RE.test(d)) {
    return { txnClass: "marketing", reason: "Ad platform or marketing spend", confidence: "high" };
  }
  if (COGS_RE.test(d)) {
    return { txnClass: "cogs", reason: "Stock, packaging or manufacturing purchase", confidence: "medium" };
  }
  if (FEES_GST_RE.test(d)) {
    return { txnClass: "fees-gst", reason: "Tax, bank charge or statutory fee", confidence: "high" };
  }

  return {
    txnClass: "uncategorized",
    reason: "Outbound money with no matching rule — tag it to include in expenses",
    confidence: "low",
  };
}

/** Apply classification to any transactions that don't already have one. */
/** What the payer typed as the reason — an explicit, human signal of a sale. */
const CLIENT_FEE_RE =
  /\b(fees?|consultanc|consulting|professional\s*charge|service\s*charge|course|admission|tuition|enrol|registration\s*fee|invoice|towards\s*payment|payment\s*for|advance\s*payment|part\s*payment|installment|instalment)\b/i;

/** Below this, a repeated amount is noise (₹1.94 test pings), not a price point. */
const PRICE_POINT_FLOOR = 1000;
const PRICE_POINT_MIN_PAYERS = 3;

/**
 * Find the amounts that behave like a published price.
 *
 * A consultancy selling a fixed-fee service shows up in the bank as the SAME
 * amount arriving over and over from DIFFERENT people — ₹64,500 from fourteen
 * separate payers is a product, not a coincidence. No single one of those rows
 * says "revenue" anywhere in its narration, so per-transaction rules can never
 * catch them; it only becomes visible across the whole batch.
 *
 * Requiring several DISTINCT payers is what keeps this safe: repeated
 * same-amount transfers from one counterparty are far more likely to be loan
 * tranches or capital top-ups, and those must never be booked as revenue.
 */
function detectPricePoints(
  txns: Transaction[],
  relatedParties: readonly string[]
): Set<number> {
  const payersByAmount = new Map<number, Set<string>>();

  for (const t of txns) {
    if (t.type !== "credit" || t.amount < PRICE_POINT_FLOOR) continue;
    // Only consider money not already explained as something other than a sale.
    const { txnClass } = classifyTransaction(t.description, t.type, relatedParties);
    if (txnClass !== "uncategorized" && txnClass !== "sales") continue;

    const payer = (payerKey(t.description) ?? "").trim();
    if (!payer) continue;
    const cents = Math.round(t.amount * 100);
    if (!payersByAmount.has(cents)) payersByAmount.set(cents, new Set());
    payersByAmount.get(cents)!.add(payer);
  }

  const points = new Set<number>();
  payersByAmount.forEach((payers, cents) => {
    if (payers.size >= PRICE_POINT_MIN_PAYERS) points.add(cents);
  });
  return points;
}

/**
 * Who sent the money, roughly — enough to tell two payers apart.
 *
 * Indian narrations bury the payer between slashes after the reference number.
 * Stripping digits avoids counting the same person twice just because each
 * transfer carries a different UPI reference.
 */
function payerKey(description: string): string | null {
  const segments = (description ?? "").split("/").map((s) => s.trim());
  const candidates = segments
    .slice(1)
    .map((s) => s.replace(/\d+/g, "").replace(/[^a-z\s.]/gi, "").trim().toLowerCase())
    .filter((s) => s.length >= 4 && !RAIL_TOKEN_RE.test(s));
  if (candidates.length === 0) return null;
  // The longest remaining fragment is almost always the name or VPA.
  return candidates.sort((a, b) => b.length - a.length)[0];
}

/**
 * Scheme names and boilerplate, not people.
 *
 * Returning null when only these remain is deliberate: a narration like
 * `BIL/INFT/FDJ0467312/` names no payer, and INFT is an internal transfer
 * anyway. Falling back to the reference number would make every row look like
 * a distinct payer and turn any repeated amount into a "price point", which is
 * exactly the silent over-recognition of revenue this whole layer exists to
 * prevent. An unidentifiable payer counts toward nothing.
 */
const RAIL_TOKEN_RE =
  /^(payment from|sent using|sent us|upi|imps|neft|rtgs|mmt|ift|inft|bil|trfr|tpt|nach|ach|clg|chq|cms|india|null|na)$/i;

export function classifyAll(
  txns: Transaction[],
  relatedParties: readonly string[],
  { overwrite = false }: { overwrite?: boolean } = {}
): { transactions: Transaction[]; changed: number } {
  const pricePoints = detectPricePoints(txns, relatedParties);
  let changed = 0;

  const transactions = txns.map((t) => {
    if (t.txnClass && !overwrite) return t;
    let { txnClass } = classifyTransaction(t.description, t.type, relatedParties);

    if (txnClass === "uncategorized" && t.type === "credit") {
      const isPricePoint = pricePoints.has(Math.round(t.amount * 100));
      const saysFee = CLIENT_FEE_RE.test(t.description ?? "");
      if (isPricePoint || saysFee) txnClass = "sales";
    }

    if (t.txnClass === txnClass) return t;
    changed++;
    return { ...t, txnClass };
  });

  return { transactions, changed };
}

/* ── P&L aggregation ───────────────────────────────────────── */

export interface PLBreakdown {
  revenue: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  netProfit: number;
  /** Money that moved but is deliberately outside the P&L, by class. */
  excluded: { txnClass: TxnClass; label: string; inflow: number; outflow: number }[];
  excludedInflow: number;
  excludedOutflow: number;
  uncategorizedInflow: number;
  uncategorizedOutflow: number;
  /** Raw cash movement, for reconciling back to the bank statement. */
  totalInflow: number;
  totalOutflow: number;
}

export function computePL(txns: Transaction[]): PLBreakdown {
  let revenue = 0, cogs = 0, opex = 0, totalInflow = 0, totalOutflow = 0;
  const excludedMap = new Map<TxnClass, { inflow: number; outflow: number }>();

  txns.forEach((t) => {
    const cls = (t.txnClass ?? "uncategorized") as TxnClass;
    const role = classRole(cls);
    if (t.type === "credit") totalInflow += t.amount;
    else totalOutflow += t.amount;

    if (role === "revenue") {
      revenue += t.type === "credit" ? t.amount : -t.amount;
    } else if (role === "cogs") {
      cogs += t.type === "debit" ? t.amount : -t.amount;
    } else if (role === "opex") {
      opex += t.type === "debit" ? t.amount : -t.amount;
    } else {
      const cur = excludedMap.get(cls) ?? { inflow: 0, outflow: 0 };
      if (t.type === "credit") cur.inflow += t.amount;
      else cur.outflow += t.amount;
      excludedMap.set(cls, cur);
    }
  });

  const excluded = Array.from(excludedMap.entries())
    .map(([txnClass, v]) => ({
      txnClass,
      label: classLabel(txnClass),
      inflow: round2(v.inflow),
      outflow: round2(v.outflow),
    }))
    .sort((a, b) => b.inflow + b.outflow - (a.inflow + a.outflow));

  const unc = excludedMap.get("uncategorized") ?? { inflow: 0, outflow: 0 };

  // Every figure is snapped to exact paise: these totals are reconciled
  // against a bank statement, so accumulated float error is not acceptable.
  return {
    revenue: round2(revenue),
    cogs: round2(cogs),
    grossProfit: round2(revenue - cogs),
    opex: round2(opex),
    netProfit: round2(revenue - cogs - opex),
    excluded,
    excludedInflow: sumMoney(excluded.map((e) => e.inflow)),
    excludedOutflow: sumMoney(excluded.map((e) => e.outflow)),
    uncategorizedInflow: round2(unc.inflow),
    uncategorizedOutflow: round2(unc.outflow),
    totalInflow: round2(totalInflow),
    totalOutflow: round2(totalOutflow),
  };
}
