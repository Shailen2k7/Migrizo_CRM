import { Category, PaymentMethod, TxnType } from "./types";
import { SALES_RE } from "./classify";

interface Rule {
  pattern: RegExp;
  category: Category;
  vendor?: string;
  confidence: "high" | "medium";
}

const RULES: Rule[] = [
  // Ads & marketing
  { pattern: /\b(meta|facebook|fb)\s*(ads?|adverts?|bill)?/i, category: "Meta Ads", vendor: "Meta Ads", confidence: "high" },
  { pattern: /\bgoogle\s*(ads?|adwords)/i, category: "Google Ads", vendor: "Google Ads", confidence: "high" },
  { pattern: /\b(linkedin|instagram|twitter|x corp).*ads?/i, category: "Marketing", confidence: "high" },
  { pattern: /\b(marketing|campaign|seo|influencer|agency|branding)\b/i, category: "Marketing", confidence: "medium" },
  // Software & subscriptions
  { pattern: /\b(openai|chatgpt)\b/i, category: "Subscription", vendor: "OpenAI", confidence: "high" },
  { pattern: /\b(anthropic|claude)\b/i, category: "Subscription", vendor: "Anthropic", confidence: "high" },
  { pattern: /\baws|amazon web services\b/i, category: "Software", vendor: "AWS", confidence: "high" },
  { pattern: /\b(google cloud|gcp|google workspace|gsuite)\b/i, category: "Software", vendor: "Google", confidence: "high" },
  { pattern: /\b(microsoft|azure|office ?365)\b/i, category: "Software", vendor: "Microsoft", confidence: "high" },
  { pattern: /\b(zoho|freshworks|notion|slack|figma|canva|adobe|github|vercel|supabase|heroku|digitalocean)\b/i, category: "Software", confidence: "high" },
  // No word boundaries — these appear glued to other words in UPI/IMPS remarks
  // (e.g. "writehumanandti", "WritehumanAi").
  { pattern: /(quillbot|turnitin|writehuman|grammarly|perplexity|midjourney|elevenlabs)/i, category: "Software", confidence: "high" },
  { pattern: /(mygate|societymaint|amazonin|wwwamazon|amazon\s*in)/i, category: "Office", confidence: "medium" },
  { pattern: /(eportal\.?incomet|incometax|tin\s*nsdl)/i, category: "Tax", confidence: "high" },
  { pattern: /\b(godaddy|namecheap|hostinger|bigrock|domain|hosting)\b/i, category: "Subscription", confidence: "high" },
  { pattern: /\b(netflix|spotify|prime|subscription|renewal)\b/i, category: "Subscription", confidence: "medium" },
  // Payroll
  { pattern: /\b(salary|payroll|wages|stipend|gusto|razorpayx payroll)\b/i, category: "Salary", confidence: "high" },
  // Rent & office
  { pattern: /\b(rent|lease|wework|awfis|coworking|91springboard)\b/i, category: "Rent", confidence: "high" },
  { pattern: /\b(electricity|internet|broadband|airtel|jio|act fibernet|wifi|stationery|office)\b/i, category: "Office", confidence: "medium" },
  // Travel & food
  { pattern: /\b(uber|ola|rapido|indigo|air india|vistara|makemytrip|irctc|flight|hotel|oyo|taxi)\b/i, category: "Travel", confidence: "high" },
  { pattern: /\b(swiggy|zomato|restaurant|cafe|starbucks|food|lunch|dinner)\b/i, category: "Food", confidence: "high" },
  // Finance
  { pattern: /\b(emi|equated monthly)\b/i, category: "Loan EMI", confidence: "high" },
  { pattern: /\bach.*(loan|bajaj|hdfc ltd)|loan (repay|installment)/i, category: "Loan EMI", confidence: "high" },
  { pattern: /\binterest\b/i, category: "Interest", confidence: "medium" },
  { pattern: /\b(credit card|cc payment|card payment|amex|hdfc card|icici card)\b/i, category: "Credit Card", confidence: "high" },
  { pattern: /\bgst(in)?\b|goods and service/i, category: "GST", confidence: "high" },
  { pattern: /\b(tds|income tax|advance tax|itr)\b/i, category: "Tax", confidence: "high" },
  { pattern: /\b(transfer|trf|internal|self|sweep)\b/i, category: "Transfer", confidence: "medium" },
  { pattern: /\b(refund|reversal|chargeback)\b/i, category: "Refund", confidence: "high" },
  { pattern: /\b(mutual fund|zerodha|groww|fd |fixed deposit|investment|sip)\b/i, category: "Investment", confidence: "high" },
  // Revenue
  { pattern: /\b(stripe|razorpay|payu|cashfree|paypal).*(payout|settlement)/i, category: "Client Revenue", confidence: "high" },
  { pattern: /\b(invoice|inv[- ]?\d+|client payment|consulting fee|retainer|payment received)\b/i, category: "Client Revenue", confidence: "medium" },
  // Vendors
  { pattern: /\b(vendor|supplier|purchase|procurement)\b/i, category: "Vendor Payment", confidence: "medium" },
];

/* ──────────────────────────────────────────────────────────────
   Indian bank narration parser

   Indian statements pack a free-text *purpose* the payer typed plus the
   counterparty into a slash-delimited narration. Reading those fields is
   far more reliable than pattern-matching the whole string:

     MMT/IMPS/601413741561/Salary/ShailenIDF/IDFB002127
                            ^purpose ^counterparty
     UPI/109256260673/Interest/monamankhand162//ICIbf3f
     INF/INFT/042939566251/Own acc/GROWN3860
     VIN/CLAUDE AIS/202603241921/608313100139/
     NEFT-AXISCN1207939630-RAZORPAYSOFTWAREPRIVATE LI
   ────────────────────────────────────────────────────────────── */
export interface Narration {
  purpose?: string;
  counterparty?: string;
}

/** Trailing bank/IFSC fragments that pollute payee names. */
const BANK_TAIL = /(idfc?|hdfc?|icici?|sbin?|axis|kotak|yesb|utib|barb|pytm|ybl|okaxis|oksbi)\d*$/i;

function cleanName(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\d{4,}.*$/, "").replace(BANK_TAIL, "").replace(/[^A-Za-z\s.&-]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 3) return undefined;
  return titleCase(t);
}

export function parseNarration(description: string): Narration {
  const s = description.trim();
  const seg = s.split("/");

  // MMT/IMPS|NEFT|RTGS/<ref>/<purpose>/<payee>/<ifsc>
  if (/^(MMT|IMPS|NEFT|RTGS)\//i.test(s) && seg.length >= 5) {
    return { purpose: seg[3]?.trim(), counterparty: cleanName(seg[4]) };
  }
  // UPI/<ref>/<purpose>/<vpa>/<bank>
  if (/^UPI\//i.test(s)) {
    const vpa = (seg[3] ?? "").split("@")[0];
    return { purpose: seg[2]?.trim(), counterparty: cleanName(vpa) };
  }
  // INF/INFT/<ref>/<purpose>/<account>
  if (/^INF\//i.test(s) && seg.length >= 4) {
    return { purpose: seg[3]?.trim(), counterparty: cleanName(seg[4]) };
  }
  // Card rails: VIN/VSI/POS/<merchant>/<date>/<ref>
  if (/^(VIN|VSI|POS)\//i.test(s) && seg.length >= 2) {
    return { purpose: seg[1]?.trim(), counterparty: cleanName(seg[1]) };
  }
  // NEFT-<ref>-<counterparty name>
  const neft = s.match(/^NEFT-[A-Z0-9]+-(.+)$/i);
  if (neft) return { counterparty: cleanName(neft[1]) };

  return {};
}

/**
 * What the payer *said* the money was for. Checked before the generic
 * description rules because it is an explicit, human-entered signal.
 */
const PURPOSE_RULES: [RegExp, Category][] = [
  [/(salary|payroll|wages|stipend|incentive|bonus)/i, "Salary"],
  [/reim/i, "Reimbursement"],
  [/(interest|intdec|interst|^int$|^int[a-z]{0,4}\d*$|int\s*on\s*loan|intonloan|loanint)/i, "Interest"],
  [/(return\s*of\s*loan|loan\s*(return|repay)|repayloan|^emi)/i, "Loan EMI"],
  [/(ca\s*fee|cafee|audit|legal|consult|advocate|professional|^fee|patent|trademark|\broc\b|registration)/i, "Professional Fees"],
  [/(own\s*acc|ownacc|^own$|self\s*trf|funding|sweep)/i, "Transfer"],
  [/^rent|houserent|officerent|maintenance/i, "Office"],
  [/(income\s*tax|incometax|advance\s*tax|\btds\b)/i, "Tax"],
  [/\bgst\b/i, "GST"],
];

export interface CategorySuggestion {
  category: Category;
  vendor?: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Categorize a transaction description.
 * `memory` maps normalized description keys -> category, learned from the
 * founder's manual corrections; it always wins over static rules.
 */
export function categorize(
  description: string,
  type: TxnType,
  memory: Record<string, Category>
): CategorySuggestion {
  const key = memoryKey(description);
  if (memory[key]) {
    return { category: memory[key], confidence: "high" };
  }
  // Partial memory match on significant words
  for (const [k, cat] of Object.entries(memory)) {
    if (k.length >= 5 && key.includes(k)) {
      return { category: cat, confidence: "high" };
    }
  }
  // The payer's own purpose note beats generic string matching
  const { purpose, counterparty } = parseNarration(description);
  if (purpose) {
    for (const [re, cat] of PURPOSE_RULES) {
      if (re.test(purpose)) {
        // A credit labelled "salary"/"rent" is money coming back to you
        if (type === "credit" && ["Salary", "Rent", "Reimbursement"].includes(cat)) {
          return { category: "Refund", vendor: counterparty, confidence: "medium" };
        }
        return { category: cat, vendor: counterparty, confidence: "high" };
      }
    }
  }

  // A credit from a settlement rail is a sale, and that beats the generic word
  // rules below — "Flipkart Internet Pvt Ltd" is the seller's legal name, not
  // a broadband bill, and the Office rule would otherwise claim it on the word
  // "Internet". SALES_RE is deliberately narrow (marketplace and gateway
  // settlements only), so it does not fire on POS refunds, salary or interest.
  if (type === "credit" && SALES_RE.test(description)) {
    return { category: "Client Revenue", vendor: counterparty, confidence: "high" };
  }

  for (const rule of RULES) {
    if (rule.pattern.test(description)) {
      // A credit landing on a cost rule is money coming back, not money earned.
      if (type === "credit" && ["Salary", "Rent", "Vendor Payment"].includes(rule.category)) {
        return { category: "Refund", confidence: "low" };
      }
      return { category: rule.category, vendor: rule.vendor ?? counterparty, confidence: rule.confidence };
    }
  }
  // An unrecognised credit is NOT a sale.
  //
  // This used to return "Client Revenue" for EVERY unmatched credit, which put
  // a green revenue badge and a #revenue tag on any unidentified deposit — a
  // transfer from your own account, a friend repaying you, bank interest. That
  // is the same "credits are revenue" mistake the P&L layer exists to prevent,
  // and leaving it here made the UI contradict the P&L: rows badged Client
  // Revenue that Revenue itself excluded.
  return { category: "Miscellaneous", vendor: counterparty, confidence: "low" };
}

/**
 * Fingerprint used to spot duplicate imports.
 *
 * Bank and card narrations carry a unique auth/UTR reference. Use it when
 * present, so two genuinely separate purchases of the same value on the same
 * day (two bus fares, two coffees) are not mistaken for one another. Only when
 * there is no reference do we fall back to the fuzzy description key.
 */
export function txnFingerprint(date: string, amount: number, description: string): string {
  const ref = description.match(/\b\d{8,}\b/)?.[0];
  return `${date}|${amount.toFixed(2)}|${ref ?? memoryKey(description)}`;
}

/** Normalize a description into a stable memory key (drops refs/numbers/dates). */
export function memoryKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\b(upi|neft|rtgs|imps|ach|pos|ref|txn|utr)\b[:/]?\s*/g, "")
    .replace(/[0-9]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join(" ");
}

/** Detect payment method from an Indian bank statement narration. */
export function detectPaymentMethod(description: string): PaymentMethod {
  const d = description.toUpperCase();
  if (/\bUPI\b|@ok|@ybl|@paytm|@axl|@ibl/i.test(description)) return "UPI";
  if (/\bNEFT\b/.test(d)) return "NEFT";
  if (/\bRTGS\b/.test(d)) return "RTGS";
  if (/\bIMPS\b/.test(d)) return "IMPS";
  if (/\bCHQ|CHEQUE\b/.test(d)) return "Cheque";
  if (/\bPOS\b|CARD|VISA|MASTERCARD|RUPAY|AMEX/.test(d)) return "Card";
  if (/\bACH\b|AUTO ?DEBIT|E-?MANDATE|NACH/.test(d)) return "Auto Debit";
  if (/\bATM|CASH\b/.test(d)) return "Cash";
  if (/\bTRF|TRANSFER|FT\b/.test(d)) return "Bank Transfer";
  return "Other";
}

/**
 * Detect the issuing bank. The filename and header win over the body, because
 * narrations are full of *counterparty* IFSC codes (an ICICI statement is
 * littered with HDFC0009228 payee codes). Ties in the body are broken by
 * frequency rather than by listing order.
 */
export function detectBank(text: string, fileName = ""): string {
  const banks = BANK_PATTERNS;
  // Underscores and dots are word characters, so "SBI_stmt.csv" defeats \b —
  // flatten separators to spaces before matching.
  const cleanName = fileName.replace(/[^A-Za-z0-9]+/g, " ");
  for (const [re, name] of banks) if (re.test(cleanName)) return name;
  // Statement headers appear in the first ~600 chars
  const head = text.slice(0, 600);
  for (const [re, name] of banks) if (re.test(head)) return name;
  let best = "Unknown Bank";
  let bestCount = 0;
  for (const [re, name] of banks) {
    const count = (text.match(new RegExp(re.source, "gi")) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = name;
    }
  }
  return best;
}

const BANK_PATTERNS: [RegExp, string][] = [
  [/hdfc/i, "HDFC Bank"],
  [/icici/i, "ICICI Bank"],
  [/state bank|sbin?\b/i, "SBI"],
  [/axis|utib/i, "Axis Bank"],
  [/kotak/i, "Kotak Mahindra"],
  [/yes bank|yesb/i, "Yes Bank"],
  [/idfc/i, "IDFC First"],
  [/indusind/i, "IndusInd"],
  [/canara/i, "Canara Bank"],
  [/punjab national|pnb/i, "PNB"],
  [/bank of baroda|barb/i, "Bank of Baroda"],
  [/federal/i, "Federal Bank"],
  [/rbl/i, "RBL Bank"],
  [/citi/i, "Citibank"],
  [/hsbc/i, "HSBC"],
];

/** Extract a human vendor/counterparty name from a bank narration. */
export function extractVendor(description: string): string | undefined {
  const known0 = description.match(
    /\b(openai|anthropic|claude|aws|google|microsoft|zoho|razorpay|stripe|quillbot|turnitin|writehuman)\b/i
  );
  if (known0) return titleCase(known0[1]);
  const fromNarration = parseNarration(description).counterparty;
  if (fromNarration) return fromNarration;
  // UPI/xxx/Name/... or NEFT-XXXX-Name patterns
  const upi = description.match(/UPI[\/-]([A-Za-z][A-Za-z\s.&]{2,30})[\/-]/i);
  if (upi) return titleCase(upi[1].trim());
  const neft = description.match(/(?:NEFT|IMPS|RTGS)[\/-][A-Z0-9]*[\/-]?([A-Za-z][A-Za-z\s.&]{2,30})/i);
  if (neft) return titleCase(neft[1].trim());
  const known = description.match(
    /\b(openai|anthropic|aws|google|microsoft|zoho|notion|slack|figma|canva|adobe|github|vercel|supabase|swiggy|zomato|uber|ola|meta|stripe|razorpay|godaddy|namecheap|wework|awfis)\b/i
  );
  if (known) return titleCase(known[1]);
  return undefined;
}

/**
 * Extract a clean merchant name from a credit-card statement line.
 * CC narrations look like "AMAZON PAY INDIA PVT MUMBAI IN" or
 * "SWIGGY*ORDER BANGALORE IND" — strip location/noise, keep the brand.
 */
export function extractMerchant(description: string): string {
  const CITIES =
    /\b(mumbai|delhi|new delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|gurgaon|gurugram|noida|ahmedabad|jaipur|in|ind|india|usa|us|sg|singapore|ie|nl|gb|uk)\b/gi;
  const NOISE = /\b(pvt|ltd|limited|private|payments?|technologies|solutions|services|india)\b/gi;
  const s = description
    .replace(/\*/g, " ")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\d{4,}/g, "")
    .replace(/\b[x*#]{2,}\w*\b/gi, "")
    .replace(CITIES, "")
    .replace(NOISE, "")
    .replace(/[^A-Za-z&.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = s.split(" ").filter(Boolean).slice(0, 3);
  if (words.length === 0) return titleCase(description.split(/\s+/).slice(0, 2).join(" "));
  return titleCase(words.join(" "));
}

function titleCase(s: string): string {
  const upper: Record<string, string> = { aws: "AWS", openai: "OpenAI", github: "GitHub", godaddy: "GoDaddy" };
  const low = s.toLowerCase();
  if (upper[low]) return upper[low];
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}
