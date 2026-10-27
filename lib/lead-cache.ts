// =============================================================================
// FAST BOOT — slim lead loading + on-device cache (27 Oct 2026)
// -----------------------------------------------------------------------------
// THE PROBLEM. Every page load fetched every column of every lead twice — once
// on the server (into the page payload) and once in the browser. 4,100 leads ×
// 60 columns ≈ 10 MB of JSON per load, 40% of it `profile_text` (full saved
// CVs) that no list screen ever shows. On mobile that was seconds of spinner.
//
// THE FIX, three layers:
//   1. LEAD_LIST_COLS — list screens load every column EXCEPT the heavy CV
//      fields. The drawer hydrates the full row for one lead when it opens.
//   2. The server layout sends only the ~400 most recently touched leads
//      (enough to paint every screen instantly) plus the exact total count.
//   3. This file's IndexedDB cache: the full slim list is stored on the
//      device after the first load. Every later visit renders from the cache
//      in milliseconds and fetches only the rows that changed since
//      (delta sync in app-provider), plus an id sweep to drop deletions.
//
// The cache is per workspace + user (no cross-account leakage on a shared
// machine), and every call is wrapped so private browsing / blocked storage
// simply falls back to a normal network load.
// =============================================================================
import type { Lead, Payment } from '@/lib/types';

// Every production column except profile_text / profile_ai (the per-lead CV
// text and its AI analysis — drawer-only, hydrated on open via refreshLead).
export const LEAD_LIST_COLS: string = [
  'id', 'workspace_id', 'full_name', 'phone', 'email', 'visa_type', 'stage', 'source', 'score',
  'next_follow_up', 'payment_status', 'amount_paid', 'amount_total', 'last_note', 'last_note_author_id',
  'last_note_at', 'tags', 'created_at', 'created_by', 'updated_at', 'is_sample', 'hidden_from_payments',
  'industry', 'amount_overdue', 'is_spotlight', 'won_at', 'currency', 'pipeline_id', 'discount',
  'owner_id', 'last_touched_at', 'attempt_count', 'snooze_until', 'retired_at', 'ai_score', 'ai_scored_at',
  'investment_readiness', 'intake', 'offer_type', 'offer_amount', 'offer_currency', 'offer_note',
  'offer_at', 'offer_by', 'first_response_at', 'profile_received', 'profile_received_at',
  'eligibility', 'eligibility_at', 'eligibility_by', 'eligibility_source', 'cv_path', 'cv_name',
  'last_form_submitted_at', 'form_submission_count', 'gstin', 'billing_address',
].join(', ');

export interface CachedSnapshot { leads: Lead[]; payments: Payment[]; savedAt: number }

const DB_NAME = 'migrizo-fast-boot';
const STORE = 'snapshots';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || !('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

const cacheKey = (workspaceId: string, userId: string) => `snap:${workspaceId}:${userId}`;

export async function cacheRead(workspaceId: string, userId: string): Promise<CachedSnapshot | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(cacheKey(workspaceId, userId));
      req.onsuccess = () => {
        const v = req.result as CachedSnapshot | undefined;
        db.close();
        resolve(v && Array.isArray(v.leads) && typeof v.savedAt === 'number' ? v : null);
      };
      req.onerror = () => { db.close(); resolve(null); };
    } catch { db.close(); resolve(null); }
  });
}

export async function cacheWrite(workspaceId: string, userId: string, snap: CachedSnapshot): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snap, cacheKey(workspaceId, userId));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); resolve(); };
    } catch { db.close(); resolve(); }
  });
}

/** Keep the cache slim even when realtime/drawer hydration injected CV text. */
export function stripHeavy(leads: Lead[]): Lead[] {
  return leads.map((l) => {
    if (!(l as unknown as Record<string, unknown>).profile_text && !(l as unknown as Record<string, unknown>).profile_ai) return l;
    const copy = { ...l } as Record<string, unknown>;
    delete copy.profile_text;
    delete copy.profile_ai;
    return copy as unknown as Lead;
  });
}

/**
 * Merge two lead lists: for ids present in both, the newer `updated_at` wins —
 * except that a row carrying hydrated CV fields keeps them when timestamps tie.
 * Output sorted by updated_at desc (the order every screen expects).
 */
export function mergeLeads(incoming: Lead[], existing: Lead[]): Lead[] {
  const byId = new Map<string, Lead>();
  for (const l of existing) byId.set(l.id, l);
  for (const l of incoming) {
    const prev = byId.get(l.id);
    if (!prev) { byId.set(l.id, l); continue; }
    const a = Date.parse(l.updated_at || '') || 0;
    const b = Date.parse(prev.updated_at || '') || 0;
    if (a > b) byId.set(l.id, l);
    else if (a === b) {
      // Same version: prefer whichever copy has the hydrated CV fields.
      const rich = (prev as unknown as Record<string, unknown>).profile_text ? prev : l;
      byId.set(l.id, rich === prev ? prev : l);
    }
  }
  return Array.from(byId.values()).sort((x, y) => (Date.parse(y.updated_at || '') || 0) - (Date.parse(x.updated_at || '') || 0));
}
