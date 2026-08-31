import { Category, Transaction } from "./types";
import { memoryKey } from "./categorize";

/**
 * Smart tagging engine.
 *
 * Every transaction already gets one category from the AI import pipeline.
 * Tags are a second, richer layer on top — a transaction can carry several
 * at once (e.g. a Google Ads charge might be tagged "marketing",
 * "google-ads" and "recurring" simultaneously), which is what makes them
 * useful for slicing "every rupee" a dozen different ways on the Income &
 * Expenses page. Tagging here is strictly additive: it only ever adds tags
 * a transaction doesn't already have, never removes a tag the founder set
 * by hand.
 */

/** Baseline semantic tag(s) implied by a transaction's category. */
const CATEGORY_TAGS: Record<string, string[]> = {
  "Client Revenue": ["revenue"],
  Salary: ["payroll"],
  Rent: ["rent"],
  Marketing: ["marketing"],
  "Meta Ads": ["marketing", "meta-ads"],
  "Google Ads": ["marketing", "google-ads"],
  Software: ["software"],
  Office: ["office"],
  Travel: ["travel"],
  Food: ["food"],
  Subscription: ["subscription"],
  Reimbursement: ["reimbursement"],
  "Professional Fees": ["professional-fees"],
  "Vendor Payment": ["vendor"],
  "Loan EMI": ["debt"],
  Interest: ["debt", "interest"],
  "Credit Card": ["credit-card"],
  GST: ["tax", "gst"],
  Tax: ["tax"],
  Transfer: ["transfer"],
  Refund: ["refund"],
  Investment: ["investment"],
  Miscellaneous: ["review"],
};

const INTERNATIONAL_RE = /\b(USD|GBP|EUR|SGD|AED|JPY|CAD|AUD|CHF)\b/;
const SAAS_TOOL_RE =
  /\b(openai|chatgpt|anthropic|claude|aws|amazon web services|google cloud|gcp|azure|notion|slack|figma|canva|adobe|github|vercel|supabase|zoho|quillbot|turnitin|writehuman|grammarly|midjourney|elevenlabs)\b/i;

/** Content-derived tags that don't depend on the rest of the dataset. */
export function contentTags(t: Pick<Transaction, "description" | "vendor" | "category">): string[] {
  const hay = `${t.description} ${t.vendor ?? ""}`;
  const tags: string[] = [];
  if (INTERNATIONAL_RE.test(hay)) tags.push("international");
  if (SAAS_TOOL_RE.test(hay)) tags.push("saas-tool");
  return tags;
}

/** Category baseline + content signals — no cross-transaction context needed. */
export function suggestTags(
  t: Pick<Transaction, "description" | "vendor" | "category">
): string[] {
  const fromCategory = CATEGORY_TAGS[t.category as Category] ?? [];
  return Array.from(new Set([...fromCategory, ...contentTags(t)]));
}

/**
 * Fingerprint of "same recurring series" — same business, same direction,
 * same normalized description. A series counts as recurring once at least 3
 * occurrences land in at least 3 distinct months with amounts that agree
 * within 20% of the median (catches subscriptions/EMIs/rent even when the
 * amount drifts slightly with FX or a price change).
 */
function seriesKey(t: Transaction): string {
  return `${t.businessId}|${t.type}|${memoryKey(t.description)}`;
}

export function findRecurringSeries(transactions: Transaction[]): Set<string> {
  const groups = new Map<string, Transaction[]>();
  transactions.forEach((t) => {
    const k = seriesKey(t);
    if (!k.split("|")[2]) return; // memoryKey came back empty — too little signal
    const arr = groups.get(k);
    if (arr) arr.push(t);
    else groups.set(k, [t]);
  });
  const recurring = new Set<string>();
  groups.forEach((txns, k) => {
    if (txns.length < 3) return;
    const months = new Set(txns.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) return;
    const amounts = [...txns.map((t) => t.amount)].sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const consistent = txns.filter((t) => Math.abs(t.amount - median) <= median * 0.2).length;
    if (consistent >= 3) recurring.add(k);
  });
  return recurring;
}

/** Debit amount above which a transaction is worth flagging as high-value. */
function highValueThreshold(transactions: Transaction[]): number {
  const debits = transactions.filter((t) => t.type === "debit").map((t) => t.amount).sort((a, b) => a - b);
  if (debits.length < 10) return Infinity;
  const p90 = debits[Math.floor(debits.length * 0.9)];
  return Math.max(50_000, p90);
}

export interface SmartTagResult {
  transactions: Transaction[];
  changedCount: number;
}

/**
 * Full smart-tag pass: category + content + recurring-series + high-value,
 * unioned onto whatever tags a transaction already carries. Returns a new
 * array with only the changed transactions getting new object references,
 * so callers can cheaply tell what changed.
 */
export function smartTagTransactions(transactions: Transaction[]): SmartTagResult {
  const recurring = findRecurringSeries(transactions);
  const hvThreshold = highValueThreshold(transactions);
  let changedCount = 0;

  const next = transactions.map((t) => {
    const suggested = new Set(suggestTags(t));
    if (recurring.has(seriesKey(t))) suggested.add("recurring");
    if (t.type === "debit" && t.amount >= hvThreshold) suggested.add("high-value");

    const existing = new Set(t.tags);
    let changed = false;
    suggested.forEach((tag) => {
      if (!existing.has(tag)) {
        existing.add(tag);
        changed = true;
      }
    });
    if (!changed) return t;
    changedCount++;
    return { ...t, tags: Array.from(existing) };
  });

  return { transactions: next, changedCount };
}
