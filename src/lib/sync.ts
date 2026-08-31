"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { useSession } from "./session";
import { useStore } from "./store";
import type {
  BusinessId,
  CreditCard,
  ImportRecord,
  Invoice,
  Loan,
  PaymentMethod,
  RecurringExpense,
  Transaction,
} from "./types";
import type { TxnClass } from "./classify";

/**
 * Cloud sync for the Zustand store.
 *
 * The store stays the single source of truth the UI reads from; this module
 * mirrors it to Postgres. That choice keeps every existing action, selector and
 * component untouched — the alternative (making each screen query Supabase
 * directly) would have meant rewriting the entire app.
 *
 * Pushes are computed by DIFFING against a snapshot of what the server last
 * confirmed, so we only send rows that actually changed. Without the diff,
 * every keystroke would re-upload thousands of transactions.
 */

type Row = Record<string, unknown>;

/* ── Row mappers ─────────────────────────────────────────────────────────── */

const nullIfBlank = (v: string | undefined | null) => (v && v.length > 0 ? v : null);
/** Postgres `date` rejects ""; the store uses "" for "not set". */
const dateOrNull = (v: string | undefined | null) => (v && v.length >= 10 ? v.slice(0, 10) : null);
const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v));

const txnToRow = (t: Transaction, workspace: string): Row => ({
  id: t.id,
  workspace_id: workspace,
  business_id: t.businessId,
  date: t.date,
  amount: t.amount,
  type: t.type,
  description: t.description ?? "",
  category: t.category ?? "Miscellaneous",
  vendor: nullIfBlank(t.vendor),
  client: nullIfBlank(t.client),
  payment_method: nullIfBlank(t.paymentMethod),
  bank: nullIfBlank(t.bank),
  notes: nullIfBlank(t.notes),
  tags: t.tags ?? [],
  source: t.source ?? "manual",
  ai_confidence: nullIfBlank(t.aiConfidence),
  txn_class: nullIfBlank(t.txnClass),
  balance: t.balance ?? null,
  created_at: t.createdAt,
  updated_at: t.updatedAt,
  audit: t.audit ?? [],
});

const rowToTxn = (r: Row): Transaction => ({
  id: String(r.id),
  businessId: r.business_id as BusinessId,
  date: String(r.date),
  amount: num(r.amount),
  type: r.type as Transaction["type"],
  description: (r.description as string) ?? "",
  category: (r.category as string) ?? "Miscellaneous",
  vendor: (r.vendor as string) ?? undefined,
  client: (r.client as string) ?? undefined,
  paymentMethod: ((r.payment_method as PaymentMethod) ?? "Other") as PaymentMethod,
  bank: (r.bank as string) ?? undefined,
  notes: (r.notes as string) ?? undefined,
  tags: (r.tags as string[]) ?? [],
  source: ((r.source as string) ?? "manual") as Transaction["source"],
  aiConfidence: (r.ai_confidence as Transaction["aiConfidence"]) ?? undefined,
  txnClass: (r.txn_class as TxnClass) ?? undefined,
  balance: r.balance == null ? undefined : num(r.balance),
  createdAt: String(r.created_at ?? new Date().toISOString()),
  updatedAt: String(r.updated_at ?? new Date().toISOString()),
  audit: (r.audit as Transaction["audit"]) ?? [],
});

const loanToRow = (l: Loan, w: string): Row => ({
  id: l.id, workspace_id: w, business_id: l.businessId, name: l.name,
  lender: l.lender, kind: l.kind, principal: l.principal, outstanding: l.outstanding,
  interest_rate: l.interestRate, emi: l.emi, next_due_date: dateOrNull(l.nextDueDate),
  tenure_months: l.tenureMonths, paid_months: l.paidMonths,
});
const rowToLoan = (r: Row): Loan => ({
  id: String(r.id), businessId: r.business_id as BusinessId, name: String(r.name ?? ""),
  lender: (r.lender as string) ?? "", kind: ((r.kind as string) ?? "business") as Loan["kind"],
  principal: num(r.principal), outstanding: num(r.outstanding),
  interestRate: num(r.interest_rate), emi: num(r.emi),
  nextDueDate: (r.next_due_date as string) ?? "", tenureMonths: num(r.tenure_months),
  paidMonths: num(r.paid_months),
});

const cardToRow = (c: CreditCard, w: string): Row => ({
  id: c.id, workspace_id: w, business_id: c.businessId, name: c.name, bank: c.bank,
  last4: c.last4, limit: c.limit, outstanding: c.outstanding, min_due: c.minDue,
  total_due: c.totalDue, due_date: dateOrNull(c.dueDate),
});
const rowToCard = (r: Row): CreditCard => ({
  id: String(r.id), businessId: r.business_id as BusinessId, name: String(r.name ?? ""),
  bank: (r.bank as string) ?? "", last4: (r.last4 as string) ?? "",
  limit: num(r.limit), outstanding: num(r.outstanding), minDue: num(r.min_due),
  totalDue: num(r.total_due), dueDate: (r.due_date as string) ?? "",
});

const invoiceToRow = (i: Invoice, w: string): Row => ({
  id: i.id, workspace_id: w, business_id: i.businessId, number: i.number, client: i.client,
  description: i.description, amount: i.amount, paid_amount: i.paidAmount,
  issue_date: dateOrNull(i.issueDate), due_date: dateOrNull(i.dueDate), status: i.status,
});
const rowToInvoice = (r: Row): Invoice => ({
  id: String(r.id), businessId: r.business_id as BusinessId, number: (r.number as string) ?? "",
  client: (r.client as string) ?? "", description: (r.description as string) ?? "",
  amount: num(r.amount), paidAmount: num(r.paid_amount),
  issueDate: (r.issue_date as string) ?? "", dueDate: (r.due_date as string) ?? "",
  status: ((r.status as string) ?? "unpaid") as Invoice["status"],
});

const recurringToRow = (r: RecurringExpense, w: string): Row => ({
  id: r.id, workspace_id: w, business_id: r.businessId, name: r.name, vendor: r.vendor,
  category: r.category, amount: r.amount, cadence: r.cadence,
  next_date: dateOrNull(r.nextDate), active: r.active,
});
const rowToRecurring = (r: Row): RecurringExpense => ({
  id: String(r.id), businessId: r.business_id as BusinessId, name: String(r.name ?? ""),
  vendor: (r.vendor as string) ?? "", category: (r.category as string) ?? "Miscellaneous",
  amount: num(r.amount), cadence: ((r.cadence as string) ?? "monthly") as RecurringExpense["cadence"],
  nextDate: (r.next_date as string) ?? "", active: r.active !== false,
});

const importToRow = (i: ImportRecord, w: string): Row => ({
  id: i.id, workspace_id: w, business_id: i.businessId, file_name: i.fileName, bank: i.bank,
  imported_at: i.importedAt, count: i.count, skipped_duplicates: i.skippedDuplicates,
});
const rowToImport = (r: Row): ImportRecord => ({
  id: String(r.id), businessId: r.business_id as BusinessId,
  fileName: String(r.file_name ?? ""), bank: (r.bank as string) ?? "",
  importedAt: String(r.imported_at ?? new Date().toISOString()),
  count: num(r.count), skippedDuplicates: num(r.skipped_duplicates),
});

/* ── Table registry ──────────────────────────────────────────────────────── */

type State = ReturnType<typeof useStore.getState>;

interface TableSpec {
  table: string;
  /** Every row the store currently holds for this table, as [id, row]. */
  entries: (s: State, workspace: string) => Array<[string, Row]>;
  fromRow: (r: Row) => unknown;
}

/**
 * Erases the item type at the registry boundary.
 *
 * `select` and `toRow` are paired here while `T` is still known, so the
 * registry can stay a plain homogeneous array without an unsound cast.
 */
const entriesOf =
  <T extends { id: string }>(select: (s: State) => T[], toRow: (item: T, w: string) => Row) =>
  (s: State, w: string): Array<[string, Row]> =>
    select(s).map((item) => [item.id, toRow(item, w)]);

const TABLES: TableSpec[] = [
  { table: "ffos_transactions", entries: entriesOf((s) => s.transactions, txnToRow), fromRow: rowToTxn },
  { table: "ffos_loans", entries: entriesOf((s) => s.loans, loanToRow), fromRow: rowToLoan },
  { table: "ffos_credit_cards", entries: entriesOf((s) => s.cards, cardToRow), fromRow: rowToCard },
  { table: "ffos_invoices", entries: entriesOf((s) => s.invoices, invoiceToRow), fromRow: rowToInvoice },
  { table: "ffos_recurring_expenses", entries: entriesOf((s) => s.recurring, recurringToRow), fromRow: rowToRecurring },
  { table: "ffos_import_history", entries: entriesOf((s) => s.importHistory, importToRow), fromRow: rowToImport },
];

/* ── Engine ──────────────────────────────────────────────────────────────── */

/** Serialised copy of what the server is believed to hold, keyed by row id. */
type Snapshot = Map<string, Map<string, string>>;

let snapshot: Snapshot = new Map();
let settingsSnapshot = "";
let applyingRemote = false;
let unsubscribeStore: (() => void) | null = null;
let channel: ReturnType<SupabaseClient["channel"]> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastLocalPush = 0;
let activeWorkspace: string | null = null;

const CHUNK = 500;

async function chunkedUpsert(sb: SupabaseClient, table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await sb
      .from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "workspace_id,id" });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function chunkedDelete(sb: SupabaseClient, table: string, ids: string[], workspace: string) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await sb
      .from(table)
      .delete()
      .eq("workspace_id", workspace)
      .in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Pull everything for the workspace into the store. */
export async function hydrateFromCloud(workspace: string): Promise<{ empty: boolean }> {
  const sb = getSupabase();
  if (!sb) return { empty: true };

  const results = await Promise.all(
    TABLES.map(async (t) => {
      const rows: Row[] = [];
      // Supabase caps a single response at 1000 rows; page until exhausted.
      for (let page = 0; ; page++) {
        const { data, error } = await sb
          .from(t.table)
          .select("*")
          .eq("workspace_id", workspace)
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(`${t.table}: ${error.message}`);
        rows.push(...((data ?? []) as Row[]));
        if (!data || data.length < 1000) break;
      }
      return rows;
    })
  );

  const [{ data: settingsRow }, { data: memoryRows }] = await Promise.all([
    sb.from("ffos_app_settings").select("*").eq("workspace_id", workspace).maybeSingle(),
    sb.from("ffos_category_memory").select("key, category").eq("workspace_id", workspace),
  ]);

  const totalRows = results.reduce((n, r) => n + r.length, 0);
  if (totalRows === 0 && !settingsRow) {
    // Nothing to pull. Snapshot the server as empty so the automatic diff-push
    // cannot silently upload whatever this browser is holding — that is how
    // leftover demo data ends up in the shared database, where it then looks
    // authoritative to everyone else. Seeding the cloud is an explicit act;
    // see uploadLocalToCloud.
    snapshot = new Map(TABLES.map((t) => [t.table, new Map<string, string>()]));
    settingsSnapshot = "";
    return { empty: true };
  }

  const categoryMemory: Record<string, string> = {};
  (memoryRows ?? []).forEach((r) => {
    categoryMemory[String((r as Row).key)] = String((r as Row).category);
  });

  applyingRemote = true;
  try {
    const s = settingsRow as Row | null;
    useStore.setState({
      transactions: results[0].map(TABLES[0].fromRow) as Transaction[],
      loans: results[1].map(TABLES[1].fromRow) as unknown as Loan[],
      cards: results[2].map(TABLES[2].fromRow) as unknown as CreditCard[],
      invoices: results[3].map(TABLES[3].fromRow) as unknown as Invoice[],
      recurring: results[4].map(TABLES[4].fromRow) as unknown as RecurringExpense[],
      importHistory: results[5].map(TABLES[5].fromRow) as unknown as ImportRecord[],
      categoryMemory,
      ...(s
        ? {
            openingBalances: (s.opening_balances as Record<BusinessId, number>) ?? undefined,
            customCategories: (s.custom_categories as string[]) ?? [],
            cogsCategories: (s.cogs_categories as Record<BusinessId, string[]>) ?? undefined,
            relatedParties: (s.related_parties as Record<BusinessId, string[]>) ?? undefined,
            statementBalance: (s.statement_balance as never) ?? {},
          }
        : {}),
    });
  } finally {
    applyingRemote = false;
  }

  takeSnapshot(workspace);
  return { empty: false };
}

/** Record current store contents as "what the server holds". */
function takeSnapshot(workspace: string) {
  const s = useStore.getState();
  snapshot = new Map();
  TABLES.forEach((t) => {
    const m = new Map<string, string>();
    t.entries(s, workspace).forEach(([id, row]) => m.set(id, JSON.stringify(row)));
    snapshot.set(t.table, m);
  });
  settingsSnapshot = JSON.stringify({ ...settingsRow(s, workspace), updated_at: null });
}

function settingsRow(s: State, workspace: string): Row {
  return {
    workspace_id: workspace,
    opening_balances: s.openingBalances,
    custom_categories: s.customCategories,
    cogs_categories: s.cogsCategories,
    related_parties: s.relatedParties,
    statement_balance: s.statementBalance,
    updated_at: new Date().toISOString(),
  };
}

/** Push everything that differs from the snapshot. */
async function push(workspace: string) {
  const sb = getSupabase();
  if (!sb) return;
  const session = useSession.getState();
  const s = useStore.getState();

  const work: { table: string; upserts: Row[]; deletes: string[] }[] = [];

  TABLES.forEach((t) => {
    const previous = snapshot.get(t.table) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const upserts: Row[] = [];

    t.entries(s, workspace).forEach(([id, row]) => {
      const json = JSON.stringify(row);
      next.set(id, json);
      if (previous.get(id) !== json) upserts.push(row);
    });

    const deletes: string[] = [];
    previous.forEach((_v, id) => {
      if (!next.has(id)) deletes.push(id);
    });

    if (upserts.length || deletes.length) work.push({ table: t.table, upserts, deletes });
    snapshot.set(t.table, next);
  });

  const nextSettings = settingsRow(s, workspace);
  // updated_at changes every call, so compare without it.
  const comparable = JSON.stringify({ ...nextSettings, updated_at: null });
  const settingsChanged = comparable !== settingsSnapshot;
  settingsSnapshot = comparable;

  const memoryEntries = Object.entries(s.categoryMemory);

  if (work.length === 0 && !settingsChanged) return;

  session.setSyncing(true);
  try {
    for (const w of work) {
      if (w.upserts.length) await chunkedUpsert(sb, w.table, w.upserts);
      if (w.deletes.length) await chunkedDelete(sb, w.table, w.deletes, workspace);
    }

    if (settingsChanged) {
      const { error } = await sb
        .from("ffos_app_settings")
        .upsert(nextSettings, { onConflict: "workspace_id" });
      if (error) throw new Error(`ffos_app_settings: ${error.message}`);

      if (memoryEntries.length) {
        const { error: memErr } = await sb.from("ffos_category_memory").upsert(
          memoryEntries.map(([key, category]) => ({ workspace_id: workspace, key, category })),
          { onConflict: "workspace_id,key" }
        );
        if (memErr) throw new Error(`ffos_category_memory: ${memErr.message}`);
      }
    }

    lastLocalPush = Date.now();
    session.markSynced();
  } catch (e) {
    session.setSyncing(false);
    // Force a full re-send next time rather than leaving the snapshot claiming
    // rows reached the server when they did not.
    snapshot = new Map();
    settingsSnapshot = "";
    console.error("[sync] push failed:", (e as Error).message);
  }
}

function schedulePush(workspace: string) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(workspace), 800);
}

/** Upload whatever is in this browser into an empty workspace. */
export async function uploadLocalToCloud(workspace: string) {
  snapshot = new Map();
  settingsSnapshot = "";
  await push(workspace);
  takeSnapshot(workspace);
}

/** Begin mirroring the store to `workspace`, and watching for others' edits. */
export function startSync(workspace: string) {
  stopSync();
  activeWorkspace = workspace;

  unsubscribeStore = useStore.subscribe(() => {
    if (applyingRemote || activeWorkspace !== workspace) return;
    schedulePush(workspace);
  });

  const sb = getSupabase();
  if (!sb) return;

  channel = sb
    .channel(`ffos:${workspace}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", filter: `workspace_id=eq.${workspace}` },
      () => {
        // Our own writes echo back; ignore anything right after a local push.
        if (Date.now() - lastLocalPush < 2500) return;
        void hydrateFromCloud(workspace).catch((e) =>
          console.error("[sync] realtime refresh failed:", (e as Error).message)
        );
      }
    )
    .subscribe();
}

export function stopSync() {
  activeWorkspace = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (channel) {
    void getSupabase()?.removeChannel(channel);
    channel = null;
  }
  snapshot = new Map();
  settingsSnapshot = "";
}

/** Flush any pending write immediately (used before signing out). */
export async function flushSync() {
  if (!activeWorkspace) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  await push(activeWorkspace);
}
