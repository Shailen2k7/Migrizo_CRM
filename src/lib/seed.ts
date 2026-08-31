import {
  Business,
  BusinessId,
  CreditCard,
  Invoice,
  Loan,
  RecurringExpense,
  Transaction,
} from "./types";
import { detectPaymentMethod } from "./categorize";

export const BUSINESSES: Business[] = [
  { id: "migrizo", name: "Migrizo", tagline: "Premium Immigration Consultancy", accent: "129 140 248" },
  { id: "nutrolis", name: "Nutrolis", tagline: "AI Clinical Intelligence", accent: "45 212 191" },
];

// Deterministic PRNG so seed data is stable across reloads
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TxnSpec {
  day: number;
  desc: string;
  amount: number;
  type: "credit" | "debit";
  category: string;
  vendor?: string;
  client?: string;
  tags?: string[];
}

let counter = 0;
function sid(prefix: string) {
  counter += 1;
  return `${prefix}_seed_${counter.toString(36)}`;
}

function mk(businessId: BusinessId, month: string, spec: TxnSpec): Transaction {
  const date = `${month}-${String(spec.day).padStart(2, "0")}`;
  const created = `${date}T10:00:00.000Z`;
  return {
    id: sid("txn"),
    businessId,
    date,
    amount: Math.round(spec.amount),
    type: spec.type,
    description: spec.desc,
    category: spec.category,
    vendor: spec.vendor,
    client: spec.client,
    paymentMethod: detectPaymentMethod(spec.desc),
    bank: businessId === "migrizo" ? "HDFC Bank" : "ICICI Bank",
    tags: spec.tags ?? [],
    source: "import",
    aiConfidence: "high",
    notes: "",
    createdAt: created,
    updatedAt: created,
    audit: [{ at: created, action: "imported" }],
  };
}

const MIGRIZO_CLIENTS = [
  "Arjun Mehta", "Priya Sharma", "Rohan Kapoor", "Sneha Iyer", "Vikram Malhotra",
  "Ananya Reddy", "Karan Johar", "Deepika Nair", "Sameer Khan", "Tanvi Desai",
];
const NUTROLIS_CLIENTS = [
  "Apollo Clinics", "MedFirst Group", "Dr. Rao Practice", "CityCare Hospital",
  "HealthBridge", "Nova Diagnostics", "Wellness Partners", "Prime Ortho",
];

export function buildSeedTransactions(): Transaction[] {
  const rand = mulberry32(42);
  const txns: Transaction[] = [];
  // Trailing 15 months up to and including the current month
  const months: string[] = [];
  const now = new Date();
  for (let i = 14; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  months.forEach((m, mi) => {
    const growth = 1 + mi * 0.045; // steady growth over time
    // Anchor revenue early in the month so the current partial month is never empty
    txns.push(
      mk("migrizo", m, {
        day: 1,
        desc: `NEFT-N${String(100001 + mi)}-PRIYA SHARMA-GTV RETAINER ADVANCE`,
        amount: 175000 * growth,
        type: "credit",
        category: "Client Revenue",
        client: "Priya Sharma",
        tags: ["consulting"],
      }),
      mk("nutrolis", m, {
        day: 2,
        desc: `RAZORPAY SETTLEMENT UTR${8100000 + mi} MONTHLY SAAS SUBSCRIPTIONS`,
        amount: 210000 * growth,
        type: "credit",
        category: "Client Revenue",
        client: "Apollo Clinics",
        tags: ["saas"],
      })
    );
    // ── MIGRIZO ── revenue: 4-7 client payments (GTV/consulting packages)
    const nClients = 4 + Math.floor(rand() * 4);
    for (let i = 0; i < nClients; i++) {
      const client = MIGRIZO_CLIENTS[Math.floor(rand() * MIGRIZO_CLIENTS.length)];
      const amt = (150000 + rand() * 250000) * growth;
      txns.push(
        mk("migrizo", m, {
          day: 2 + Math.floor(rand() * 26),
          desc: `NEFT-N${String(Math.floor(rand() * 900000) + 100000)}-${client.toUpperCase()}-GTV CONSULTING FEE`,
          amount: amt,
          type: "credit",
          category: "Client Revenue",
          client,
          tags: ["consulting"],
        })
      );
    }
    // Migrizo expenses
    txns.push(
      mk("migrizo", m, { day: 1, desc: "ACH DEBIT SALARY PAYROLL RAZORPAYX", amount: 385000 * (1 + mi * 0.02), type: "debit", category: "Salary", vendor: "Team Payroll" }),
      mk("migrizo", m, { day: 3, desc: "NEFT AWFIS SPACE SOLUTIONS OFFICE RENT", amount: 68000, type: "debit", category: "Rent", vendor: "Awfis" }),
      mk("migrizo", m, { day: 5, desc: "META ADS BILL FB-ADS7791 CARD 4421", amount: (55000 + rand() * 40000) * growth, type: "debit", category: "Meta Ads", vendor: "Meta Ads", tags: ["ads"] }),
      mk("migrizo", m, { day: 8, desc: "GOOGLE ADS INDIA PVT LTD ADWORDS", amount: (42000 + rand() * 30000) * growth, type: "debit", category: "Google Ads", vendor: "Google Ads", tags: ["ads"] }),
      mk("migrizo", m, { day: 10, desc: "UPI/OPENAI/SUBSCRIPTION/PLUS TEAM", amount: 16600, type: "debit", category: "Subscription", vendor: "OpenAI" }),
      mk("migrizo", m, { day: 10, desc: "ANTHROPIC CLAUDE MAX SUBSCRIPTION CARD", amount: 8300, type: "debit", category: "Subscription", vendor: "Anthropic" }),
      mk("migrizo", m, { day: 12, desc: "ZOHO CORPORATION CRM PLUS ANNUAL", amount: 12400, type: "debit", category: "Software", vendor: "Zoho" }),
      mk("migrizo", m, { day: 14, desc: "UPI/AIRTEL BROADBAND/BILL PAYMENT", amount: 3499, type: "debit", category: "Office", vendor: "Airtel" }),
      mk("migrizo", m, { day: 15, desc: "ACH HDFC BANK LOAN EMI 88291102", amount: 84500, type: "debit", category: "Loan EMI", vendor: "HDFC Bank" }),
      mk("migrizo", m, { day: 18, desc: "GSTIN PMT-06 TAX PAYMENT CBDT", amount: (65000 + rand() * 45000) * growth, type: "debit", category: "GST" }),
      mk("migrizo", m, { day: 20, desc: "HDFC CREDIT CARD PAYMENT AUTOPAY", amount: (40000 + rand() * 35000), type: "debit", category: "Credit Card", vendor: "HDFC Bank" }),
      mk("migrizo", m, { day: 22, desc: `UPI/SWIGGY/ORDER/${Math.floor(rand() * 99999)}`, amount: 2200 + rand() * 3000, type: "debit", category: "Food", vendor: "Swiggy" }),
      mk("migrizo", m, { day: 24, desc: "MAKEMYTRIP FLIGHT BLR-DEL CLIENT VISIT", amount: 12000 + rand() * 18000, type: "debit", category: "Travel", vendor: "MakeMyTrip" })
    );
    // ── NUTROLIS ── revenue: SaaS payouts
    const payouts = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < payouts; i++) {
      const amt = (180000 + rand() * 320000) * growth;
      txns.push(
        mk("nutrolis", m, {
          day: 3 + Math.floor(rand() * 24),
          desc: `RAZORPAY SETTLEMENT UTR${Math.floor(rand() * 9000000) + 1000000} SAAS SUBSCRIPTIONS`,
          amount: amt,
          type: "credit",
          category: "Client Revenue",
          client: NUTROLIS_CLIENTS[Math.floor(rand() * NUTROLIS_CLIENTS.length)],
          tags: ["saas"],
        })
      );
    }
    if (rand() > 0.4) {
      txns.push(
        mk("nutrolis", m, {
          day: 12 + Math.floor(rand() * 10),
          desc: `STRIPE PAYOUT ST-${Math.floor(rand() * 90000)} INTERNATIONAL CLIENTS`,
          amount: (120000 + rand() * 260000) * growth,
          type: "credit",
          category: "Client Revenue",
          client: "Stripe International",
          tags: ["saas", "international"],
        })
      );
    }
    txns.push(
      mk("nutrolis", m, { day: 1, desc: "ACH DEBIT SALARY PAYROLL ENGINEERING TEAM", amount: 520000 * (1 + mi * 0.025), type: "debit", category: "Salary", vendor: "Team Payroll" }),
      mk("nutrolis", m, { day: 4, desc: "AMAZON WEB SERVICES EMEA CLOUD HOSTING", amount: (48000 + rand() * 35000) * growth, type: "debit", category: "Software", vendor: "AWS", tags: ["infra"] }),
      mk("nutrolis", m, { day: 6, desc: "OPENAI API USAGE BILL CARD 8812", amount: (28000 + rand() * 30000) * growth, type: "debit", category: "Software", vendor: "OpenAI", tags: ["ai"] }),
      mk("nutrolis", m, { day: 6, desc: "ANTHROPIC API CLAUDE USAGE", amount: (22000 + rand() * 26000) * growth, type: "debit", category: "Software", vendor: "Anthropic", tags: ["ai"] }),
      mk("nutrolis", m, { day: 7, desc: "NEFT 91SPRINGBOARD COWORKING RENT", amount: 52000, type: "debit", category: "Rent", vendor: "91Springboard" }),
      mk("nutrolis", m, { day: 9, desc: "GOOGLE CLOUD PLATFORM INVOICE", amount: 14000 + rand() * 9000, type: "debit", category: "Software", vendor: "Google" }),
      mk("nutrolis", m, { day: 11, desc: "META ADS BILL HEALTHCARE CAMPAIGN", amount: (32000 + rand() * 28000) * growth, type: "debit", category: "Meta Ads", vendor: "Meta Ads", tags: ["ads"] }),
      mk("nutrolis", m, { day: 13, desc: "VERCEL PRO TEAM SUBSCRIPTION", amount: 4200, type: "debit", category: "Software", vendor: "Vercel" }),
      mk("nutrolis", m, { day: 15, desc: "ACH BAJAJ FINSERV EQUIPMENT LOAN EMI", amount: 46200, type: "debit", category: "Loan EMI", vendor: "Bajaj Finserv" }),
      mk("nutrolis", m, { day: 18, desc: "GSTIN PMT-06 GST PAYMENT", amount: (48000 + rand() * 38000) * growth, type: "debit", category: "GST" }),
      mk("nutrolis", m, { day: 20, desc: "ICICI AMAZON PAY CARD AUTOPAY FULL", amount: 30000 + rand() * 30000, type: "debit", category: "Credit Card", vendor: "ICICI Bank" }),
      mk("nutrolis", m, { day: 23, desc: "TDS PAYMENT Q CHALLAN 281", amount: 18000 + rand() * 14000, type: "debit", category: "Tax" }),
      mk("nutrolis", m, { day: 25, desc: `UPI/ZOMATO/TEAM DINNER/${Math.floor(rand() * 99999)}`, amount: 1800 + rand() * 4200, type: "debit", category: "Food", vendor: "Zomato" })
    );
  });

  // keep only txns up to today (2026-08 partial month)
  return txns.filter((t) => t.date <= new Date().toISOString().slice(0, 10));
}

export function buildSeedLoans(): Loan[] {
  return [
    { id: sid("loan"), businessId: "migrizo", name: "Business Expansion Loan", lender: "HDFC Bank", kind: "business", principal: 3500000, outstanding: 2180000, interestRate: 11.5, emi: 84500, nextDueDate: "2026-08-15", tenureMonths: 60, paidMonths: 22 },
    { id: sid("loan"), businessId: "migrizo", name: "Founder Personal Loan", lender: "ICICI Bank", kind: "personal", principal: 800000, outstanding: 312000, interestRate: 13.2, emi: 26400, nextDueDate: "2026-08-10", tenureMonths: 36, paidMonths: 24 },
    { id: sid("loan"), businessId: "nutrolis", name: "Equipment & Infra Loan", lender: "Bajaj Finserv", kind: "business", principal: 1800000, outstanding: 1090000, interestRate: 12.0, emi: 46200, nextDueDate: "2026-08-15", tenureMonths: 48, paidMonths: 18 },
  ];
}

export function buildSeedCards(): CreditCard[] {
  return [
    { id: sid("card"), businessId: "migrizo", name: "HDFC Biz Black", bank: "HDFC Bank", last4: "4421", limit: 500000, outstanding: 182400, minDue: 9200, totalDue: 182400, dueDate: "2026-08-18" },
    { id: sid("card"), businessId: "migrizo", name: "Amex Gold Business", bank: "American Express", last4: "1005", limit: 350000, outstanding: 64100, minDue: 3300, totalDue: 64100, dueDate: "2026-08-24" },
    { id: sid("card"), businessId: "nutrolis", name: "ICICI Amazon Pay", bank: "ICICI Bank", last4: "8812", limit: 400000, outstanding: 121800, minDue: 6100, totalDue: 121800, dueDate: "2026-08-20" },
  ];
}

export function buildSeedInvoices(): Invoice[] {
  return [
    { id: sid("inv"), businessId: "migrizo", number: "MIG-2026-041", client: "Arjun Mehta", description: "UK Global Talent Visa — Full Service", amount: 285000, paidAmount: 285000, issueDate: "2026-06-12", dueDate: "2026-06-27", status: "paid" },
    { id: sid("inv"), businessId: "migrizo", number: "MIG-2026-042", client: "Sneha Iyer", description: "US EB-1 Petition — Phase 1", amount: 340000, paidAmount: 170000, issueDate: "2026-07-01", dueDate: "2026-07-21", status: "partial" },
    { id: sid("inv"), businessId: "migrizo", number: "MIG-2026-043", client: "Vikram Malhotra", description: "Innovator Founder Visa — Retainer", amount: 220000, paidAmount: 0, issueDate: "2026-07-05", dueDate: "2026-07-25", status: "overdue" },
    { id: sid("inv"), businessId: "migrizo", number: "MIG-2026-044", client: "Deepika Nair", description: "Australia NIV Assessment", amount: 165000, paidAmount: 0, issueDate: "2026-07-22", dueDate: "2026-08-12", status: "unpaid" },
    { id: sid("inv"), businessId: "nutrolis", number: "NUT-2026-118", client: "Apollo Clinics", description: "Enterprise License — Annual", amount: 960000, paidAmount: 960000, issueDate: "2026-06-01", dueDate: "2026-06-20", status: "paid" },
    { id: sid("inv"), businessId: "nutrolis", number: "NUT-2026-119", client: "CityCare Hospital", description: "AI Scribe — 25 Seats Q3", amount: 375000, paidAmount: 0, issueDate: "2026-07-10", dueDate: "2026-07-30", status: "overdue" },
    { id: sid("inv"), businessId: "nutrolis", number: "NUT-2026-120", client: "MedFirst Group", description: "Pilot Deployment + Onboarding", amount: 240000, paidAmount: 0, issueDate: "2026-07-25", dueDate: "2026-08-15", status: "unpaid" },
  ];
}

export function buildSeedRecurring(): RecurringExpense[] {
  return [
    { id: sid("rec"), businessId: "migrizo", name: "OpenAI Team", vendor: "OpenAI", category: "Subscription", amount: 16600, cadence: "monthly", nextDate: "2026-08-10", active: true },
    { id: sid("rec"), businessId: "migrizo", name: "Claude Max", vendor: "Anthropic", category: "Subscription", amount: 8300, cadence: "monthly", nextDate: "2026-08-10", active: true },
    { id: sid("rec"), businessId: "migrizo", name: "Zoho CRM Plus", vendor: "Zoho", category: "Software", amount: 12400, cadence: "monthly", nextDate: "2026-08-12", active: true },
    { id: sid("rec"), businessId: "migrizo", name: "Office Rent — Awfis", vendor: "Awfis", category: "Rent", amount: 68000, cadence: "monthly", nextDate: "2026-08-03", active: true },
    { id: sid("rec"), businessId: "migrizo", name: "Airtel Broadband", vendor: "Airtel", category: "Office", amount: 3499, cadence: "monthly", nextDate: "2026-08-14", active: true },
    { id: sid("rec"), businessId: "migrizo", name: "GoDaddy Domains", vendor: "GoDaddy", category: "Subscription", amount: 4800, cadence: "yearly", nextDate: "2026-11-02", active: true },
    { id: sid("rec"), businessId: "nutrolis", name: "AWS Cloud", vendor: "AWS", category: "Software", amount: 62000, cadence: "monthly", nextDate: "2026-08-04", active: true },
    { id: sid("rec"), businessId: "nutrolis", name: "OpenAI API", vendor: "OpenAI", category: "Software", amount: 41000, cadence: "monthly", nextDate: "2026-08-06", active: true },
    { id: sid("rec"), businessId: "nutrolis", name: "Anthropic API", vendor: "Anthropic", category: "Software", amount: 34000, cadence: "monthly", nextDate: "2026-08-06", active: true },
    { id: sid("rec"), businessId: "nutrolis", name: "Google Cloud", vendor: "Google", category: "Software", amount: 18000, cadence: "monthly", nextDate: "2026-08-09", active: true },
    { id: sid("rec"), businessId: "nutrolis", name: "Vercel Pro", vendor: "Vercel", category: "Software", amount: 4200, cadence: "monthly", nextDate: "2026-08-13", active: true },
    { id: sid("rec"), businessId: "nutrolis", name: "Coworking — 91Springboard", vendor: "91Springboard", category: "Rent", amount: 52000, cadence: "monthly", nextDate: "2026-08-07", active: true },
  ];
}
