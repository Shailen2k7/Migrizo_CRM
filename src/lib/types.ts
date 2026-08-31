export type BusinessId = "migrizo" | "nutrolis";

export interface Business {
  id: BusinessId;
  name: string;
  tagline: string;
  accent: string; // tailwind-compatible rgb triplet
}

export type TxnType = "credit" | "debit";

export type PaymentMethod =
  | "UPI"
  | "Card"
  | "NEFT"
  | "RTGS"
  | "IMPS"
  | "Cheque"
  | "Bank Transfer"
  | "Cash"
  | "Auto Debit"
  | "Other";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "UPI",
  "Card",
  "NEFT",
  "RTGS",
  "IMPS",
  "Cheque",
  "Bank Transfer",
  "Cash",
  "Auto Debit",
  "Other",
];

export const DEFAULT_CATEGORIES = [
  "Client Revenue",
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
  "Loan EMI",
  "Interest",
  "Credit Card",
  "GST",
  "Tax",
  "Transfer",
  "Refund",
  "Investment",
  "Miscellaneous",
] as const;

export type Category = string;

export interface AuditEntry {
  at: string; // ISO
  action: "created" | "edited" | "imported" | "bulk-edited" | "duplicated";
  field?: string;
  from?: string;
  to?: string;
}

export interface Transaction {
  id: string;
  businessId: BusinessId;
  date: string; // yyyy-MM-dd
  amount: number; // always positive
  type: TxnType;
  description: string;
  category: Category;
  vendor?: string;
  client?: string;
  paymentMethod: PaymentMethod;
  bank?: string;
  notes?: string;
  tags: string[];
  source: "manual" | "import";
  aiConfidence?: "high" | "medium" | "low";
  /**
   * What this money actually *is* (sale, capital, loan, transfer…) as opposed
   * to which category it spends into. The P&L is computed from this, never
   * from raw debit/credit direction. See classify.ts.
   */
  txnClass?: import("./classify").TxnClass;
  /** Running balance after this transaction, when the statement provides one. */
  balance?: number;
  createdAt: string;
  updatedAt: string;
  audit: AuditEntry[];
}

export interface Loan {
  id: string;
  businessId: BusinessId;
  name: string;
  lender: string;
  kind: "business" | "personal";
  principal: number;
  outstanding: number;
  interestRate: number; // annual %
  emi: number;
  nextDueDate: string;
  tenureMonths: number;
  paidMonths: number;
}

export interface CreditCard {
  id: string;
  businessId: BusinessId;
  name: string;
  bank: string;
  last4: string;
  limit: number;
  outstanding: number;
  minDue: number;
  totalDue: number;
  dueDate: string;
}

export type InvoiceStatus = "paid" | "unpaid" | "partial" | "overdue";

export interface Invoice {
  id: string;
  businessId: BusinessId;
  number: string;
  client: string;
  description: string;
  amount: number;
  paidAmount: number;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
}

export interface RecurringExpense {
  id: string;
  businessId: BusinessId;
  name: string;
  vendor: string;
  category: Category;
  amount: number;
  cadence: "monthly" | "quarterly" | "yearly";
  nextDate: string;
  active: boolean;
}

export interface ImportedRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TxnType;
  category: Category;
  paymentMethod: PaymentMethod;
  bank?: string;
  vendor?: string;
  aiConfidence: "high" | "medium" | "low";
  isDuplicate: boolean;
  include: boolean;
}

export interface ImportBatch {
  fileName: string;
  bank: string;
  rows: ImportedRow[];
}

export interface ImportRecord {
  id: string;
  businessId: BusinessId;
  fileName: string;
  bank: string;
  importedAt: string;
  count: number;
  skippedDuplicates: number;
}

export interface AppNotification {
  id: string;
  businessId: BusinessId | "all";
  kind:
    | "emi-due"
    | "card-due"
    | "gst-due"
    | "tax-due"
    | "low-cash"
    | "large-txn"
    | "duplicate"
    | "recurring-due";
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  date: string;
  read: boolean;
}
