"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  BusinessId,
  Category,
  CreditCard,
  DEFAULT_CATEGORIES,
  ImportRecord,
  Invoice,
  Loan,
  RecurringExpense,
  Transaction,
} from "./types";
import {
  buildSeedCards,
  buildSeedLoans,
  buildSeedRecurring,
  buildSeedTransactions,
} from "./seed";
import { memoryKey } from "./categorize";
import { suggestTags, smartTagTransactions } from "./tags";
import { DEFAULT_COGS_CATEGORIES } from "./metrics";
import { DEFAULT_RELATED_PARTIES, TxnClass, classifyAll } from "./classify";
import { uid } from "./format";
import { supabaseConfigured } from "./supabase";

export type TxnPatch = Partial<
  Pick<
    Transaction,
    | "date"
    | "amount"
    | "type"
    | "description"
    | "category"
    | "vendor"
    | "client"
    | "paymentMethod"
    | "bank"
    | "notes"
    | "tags"
    | "businessId"
  >
>;

interface AppState {
  activeBusiness: BusinessId;
  theme: "dark" | "light";
  transactions: Transaction[];
  loans: Loan[];
  cards: CreditCard[];
  invoices: Invoice[];
  recurring: RecurringExpense[];
  importHistory: ImportRecord[];
  customCategories: string[];
  categoryMemory: Record<string, Category>; // learned corrections
  readNotifications: string[];
  openingBalances: Record<BusinessId, number>;
  /** Categories treated as direct Cost of Goods Sold, per business — see metrics.ts. */
  cogsCategories: Record<BusinessId, string[]>;
  /**
   * Names identifying the founder's own accounts, sister companies and family.
   * Money from these is capital or an inter-company loan, never revenue.
   */
  relatedParties: Record<BusinessId, string[]>;
  /**
   * The closing balance the imported statement actually printed. Preferred
   * over any computed figure for the Cash/Bank card — a computed balance
   * silently absorbs every parsing error, whereas this is ground truth.
   */
  statementBalance: Partial<Record<BusinessId, { closing: number; asOf: string; fileName: string }>>;

  setActiveBusiness: (b: BusinessId) => void;
  setTheme: (t: "dark" | "light") => void;

  addTransaction: (t: Omit<Transaction, "id" | "createdAt" | "updatedAt" | "audit" | "source"> & { source?: Transaction["source"] }) => Transaction;
  updateTransaction: (id: string, patch: TxnPatch, opts?: { bulk?: boolean }) => void;
  deleteTransactions: (ids: string[]) => void;
  duplicateTransaction: (id: string) => void;
  bulkUpdate: (ids: string[], patch: TxnPatch) => void;
  importTransactions: (txns: Transaction[], record: Omit<ImportRecord, "id" | "importedAt">) => void;

  addCustomCategory: (c: string) => void;

  addLoan: (l: Omit<Loan, "id">) => void;
  updateLoan: (id: string, patch: Partial<Loan>) => void;
  deleteLoan: (id: string) => void;
  addCard: (c: Omit<CreditCard, "id">) => void;
  updateCard: (id: string, patch: Partial<CreditCard>) => void;
  deleteCard: (id: string) => void;

  addInvoice: (i: Omit<Invoice, "id">) => void;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  deleteInvoice: (id: string) => void;

  addRecurring: (r: Omit<RecurringExpense, "id">) => void;
  updateRecurring: (id: string, patch: Partial<RecurringExpense>) => void;
  deleteRecurring: (id: string) => void;

  markNotificationsRead: (ids: string[]) => void;
  setOpeningBalance: (b: BusinessId, amount: number) => void;
  setCogsCategories: (b: BusinessId, categories: string[]) => void;
  setRelatedParties: (b: BusinessId, names: string[]) => void;
  setStatementBalance: (b: BusinessId, info: { closing: number; asOf: string; fileName: string }) => void;
  /** Manually set (or correct) what a transaction actually is. */
  setTxnClass: (ids: string[], txnClass: TxnClass) => void;
  /** Re-run the classification rules. Returns how many transactions changed. */
  reclassify: (b: BusinessId, opts?: { overwrite?: boolean }) => number;
  resetDemoData: () => void;
  /** Danger zone: wipe every record so real data can be uploaded fresh */
  clearAllData: () => void;

  /** Retroactive smart-tag pass over one business's transactions. Returns how many gained a new tag. */
  smartTagAll: (b: BusinessId) => number;
}

/** A blank set of books — what a cloud-backed build starts from. */
const emptyState = () => ({
  transactions: [],
  loans: [],
  cards: [],
  invoices: [],
  recurring: [],
  importHistory: [],
});

/**
 * What the store holds before anything is loaded.
 *
 * Demo data exists for the local-only build, where there is nothing else to
 * show. When the app is wired to Supabase the cloud is the source of truth,
 * and seeding invented transactions is actively harmful: a fresh browser
 * renders fake figures that look real, and the sync layer will happily push
 * them into the shared database.
 */
const initialState = () => (supabaseConfigured ? emptyState() : seedState());

const seedState = () => ({
  transactions: buildSeedTransactions(),
  loans: buildSeedLoans(),
  cards: buildSeedCards(),
  invoices: [],
  recurring: buildSeedRecurring(),
  importHistory: [
    { id: uid("imp"), businessId: "migrizo" as BusinessId, fileName: "HDFC_Statement_Jun25-Jul26.csv", bank: "HDFC Bank", importedAt: new Date().toISOString(), count: 210, skippedDuplicates: 4 },
    { id: uid("imp"), businessId: "nutrolis" as BusinessId, fileName: "ICICI_Statement_Jun25-Jul26.xlsx", bank: "ICICI Bank", importedAt: new Date().toISOString(), count: 196, skippedDuplicates: 2 },
  ],
});

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeBusiness: "migrizo",
      theme: "dark",
      ...initialState(),
      customCategories: [],
      categoryMemory: {},
      readNotifications: [],
      openingBalances: { migrizo: 1250000, nutrolis: 980000 },
      cogsCategories: {
        // Migrizo is a consultancy — direct cost of a client engagement is
        // paying vendors/subcontracted professionals to help deliver it.
        migrizo: DEFAULT_COGS_CATEGORIES,
        // Nutrolis is an AI product — direct cost of serving a customer is
        // hosting and AI-API usage, which the categorizer files under
        // "Software"/"Subscription", not "Vendor Payment". Using the generic
        // default here would make Gross Profit == Revenue every month.
        nutrolis: [...DEFAULT_COGS_CATEGORIES, "Software", "Subscription"],
      },
      relatedParties: {
        migrizo: DEFAULT_RELATED_PARTIES,
        nutrolis: DEFAULT_RELATED_PARTIES,
      },
      statementBalance: {},

      setActiveBusiness: (b) => set({ activeBusiness: b }),
      setTheme: (theme) => {
        set({ theme });
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("light", theme === "light");
          document.documentElement.classList.toggle("dark", theme === "dark");
          try {
            localStorage.setItem("ffos-theme", theme);
          } catch {}
        }
      },

      addTransaction: (t) => {
        const now = new Date().toISOString();
        const txn: Transaction = {
          ...t,
          id: uid("txn"),
          source: t.source ?? "manual",
          // Auto-suggest tags when the founder didn't set any by hand.
          tags: t.tags.length > 0 ? t.tags : suggestTags(t),
          createdAt: now,
          updatedAt: now,
          audit: [{ at: now, action: "created" }],
        };
        set((s) => ({ transactions: [txn, ...s.transactions] }));
        return txn;
      },

      updateTransaction: (id, patch, opts) => {
        const now = new Date().toISOString();
        set((s) => {
          const memory = { ...s.categoryMemory };
          const transactions = s.transactions.map((t) => {
            if (t.id !== id) return t;
            const audit = [...t.audit];
            (Object.keys(patch) as (keyof TxnPatch)[]).forEach((k) => {
              const from = String(t[k] ?? "");
              const to = String(patch[k] ?? "");
              if (from !== to) {
                audit.push({ at: now, action: opts?.bulk ? "bulk-edited" : "edited", field: k, from, to });
              }
            });
            // Learn category corrections for future imports
            if (patch.category && patch.category !== t.category) {
              const key = memoryKey(t.description);
              if (key) memory[key] = patch.category;
            }
            return { ...t, ...patch, updatedAt: now, audit };
          });
          return { transactions, categoryMemory: memory };
        });
      },

      deleteTransactions: (ids) =>
        set((s) => ({ transactions: s.transactions.filter((t) => !ids.includes(t.id)) })),

      duplicateTransaction: (id) => {
        const t = get().transactions.find((x) => x.id === id);
        if (!t) return;
        const now = new Date().toISOString();
        const copy: Transaction = {
          ...t,
          id: uid("txn"),
          createdAt: now,
          updatedAt: now,
          audit: [{ at: now, action: "duplicated", from: t.id }],
        };
        set((s) => ({ transactions: [copy, ...s.transactions] }));
      },

      bulkUpdate: (ids, patch) => {
        ids.forEach((id) => get().updateTransaction(id, patch, { bulk: true }));
      },

      importTransactions: (txns, record) =>
        set((s) => {
          // Classify what each transaction *is* (sale / capital / loan /
          // transfer) before it reaches any P&L calculation.
          const parties = s.relatedParties[record.businessId] ?? DEFAULT_RELATED_PARTIES;
          const classified = classifyAll(txns, parties).transactions;
          const merged = [...classified, ...s.transactions];
          // Full smart-tag pass on the merged set: content + category tags
          // for the new rows, plus recurring-series and high-value flags
          // recomputed across old + new together (a subscription only
          // becomes visibly "recurring" once enough months of it exist).
          const { transactions } = smartTagTransactions(merged);
          return {
            transactions,
            importHistory: [
              { ...record, id: uid("imp"), importedAt: new Date().toISOString() },
              ...s.importHistory,
            ],
          };
        }),

      addCustomCategory: (c) =>
        set((s) =>
          s.customCategories.includes(c) || (DEFAULT_CATEGORIES as readonly string[]).includes(c)
            ? s
            : { ...s, customCategories: [...s.customCategories, c] }
        ),

      addLoan: (l) => set((s) => ({ loans: [...s.loans, { ...l, id: uid("loan") }] })),
      updateLoan: (id, patch) =>
        set((s) => ({ loans: s.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
      deleteLoan: (id) => set((s) => ({ loans: s.loans.filter((l) => l.id !== id) })),

      addCard: (c) => set((s) => ({ cards: [...s.cards, { ...c, id: uid("card") }] })),
      updateCard: (id, patch) =>
        set((s) => ({ cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      deleteCard: (id) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),

      addInvoice: (i) => set((s) => ({ invoices: [{ ...i, id: uid("inv") }, ...s.invoices] })),
      updateInvoice: (id, patch) =>
        set((s) => ({
          invoices: s.invoices.map((i) => {
            if (i.id !== id) return i;
            const next = { ...i, ...patch };
            // derive status from paid amount + due date
            if (patch.paidAmount !== undefined || patch.amount !== undefined || patch.dueDate) {
              if (next.paidAmount >= next.amount) next.status = "paid";
              else if (next.paidAmount > 0) next.status = "partial";
              else if (next.dueDate < new Date().toISOString().slice(0, 10)) next.status = "overdue";
              else next.status = "unpaid";
            }
            return next;
          }),
        })),
      deleteInvoice: (id) => set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) })),

      addRecurring: (r) => set((s) => ({ recurring: [...s.recurring, { ...r, id: uid("rec") }] })),
      updateRecurring: (id, patch) =>
        set((s) => ({ recurring: s.recurring.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      deleteRecurring: (id) => set((s) => ({ recurring: s.recurring.filter((r) => r.id !== id) })),

      markNotificationsRead: (ids) =>
        set((s) => ({ readNotifications: Array.from(new Set([...s.readNotifications, ...ids])) })),

      setOpeningBalance: (b, amount) =>
        set((s) => ({ openingBalances: { ...s.openingBalances, [b]: amount } })),

      setCogsCategories: (b, categories) =>
        set((s) => ({ cogsCategories: { ...s.cogsCategories, [b]: categories } })),

      setRelatedParties: (b, names) =>
        set((s) => ({ relatedParties: { ...s.relatedParties, [b]: names } })),

      setStatementBalance: (b, info) =>
        set((s) => ({ statementBalance: { ...s.statementBalance, [b]: info } })),

      setTxnClass: (ids, txnClass) => {
        const now = new Date().toISOString();
        const idSet = new Set(ids);
        set((s) => ({
          transactions: s.transactions.map((t) => {
            if (!idSet.has(t.id) || t.txnClass === txnClass) return t;
            return {
              ...t,
              txnClass,
              updatedAt: now,
              audit: [...t.audit, { at: now, action: "edited" as const, field: "txnClass", from: t.txnClass ?? "", to: txnClass }],
            };
          }),
        }));
      },

      reclassify: (b, opts) => {
        const s = get();
        const parties = s.relatedParties[b] ?? DEFAULT_RELATED_PARTIES;
        const bizTxns = s.transactions.filter((t) => t.businessId === b);
        const { transactions: updated, changed } = classifyAll(bizTxns, parties, opts);
        if (changed === 0) return 0;
        const byId = new Map(updated.map((t) => [t.id, t]));
        set({ transactions: s.transactions.map((t) => byId.get(t.id) ?? t) });
        return changed;
      },

      resetDemoData: () =>
        set({
          ...seedState(),
          categoryMemory: {},
          customCategories: [],
          readNotifications: [],
          openingBalances: { migrizo: 1250000, nutrolis: 980000 },
          cogsCategories: {
            migrizo: DEFAULT_COGS_CATEGORIES,
            nutrolis: [...DEFAULT_COGS_CATEGORIES, "Software", "Subscription"],
          },
          statementBalance: {},
        }),

      clearAllData: () =>
        set({
          transactions: [],
          loans: [],
          cards: [],
          invoices: [],
          recurring: [],
          importHistory: [],
          customCategories: [],
          categoryMemory: {},
          readNotifications: [],
          openingBalances: { migrizo: 0, nutrolis: 0 },
          statementBalance: {},
        }),

      smartTagAll: (b) => {
        const s = get();
        const bizTxns = s.transactions.filter((t) => t.businessId === b);
        const { transactions: updatedBiz, changedCount } = smartTagTransactions(bizTxns);
        if (changedCount === 0) return 0;
        const updatedById = new Map(updatedBiz.map((t) => [t.id, t]));
        set({ transactions: s.transactions.map((t) => updatedById.get(t.id) ?? t) });
        return changedCount;
      },
    }),
    {
      name: "ffos-store-v2",
      onRehydrateStorage: () => (state) => {
        state?.setTheme(state.theme);
      },
    }
  )
);

export function allCategories(custom: string[]): string[] {
  return [...DEFAULT_CATEGORIES, ...custom];
}
