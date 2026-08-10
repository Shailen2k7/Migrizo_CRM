// =============================================================================
// THREAD CACHE — why the inbox feels instant.
//
// THE PROBLEM
// Clicking a conversation used to mean: clear the thread, show a spinner, wait
// for a round trip to Supabase, then paint. Every single click. On a cold
// Netlify function that is half a second of blank screen, and it is the main
// reason the module felt slow next to WhatsApp itself.
//
// THE FIX — stale-while-revalidate
// Threads live in a module-level Map that survives component remounts and tab
// switches. Clicking paints the cached thread SYNCHRONOUSLY (zero frames of
// blank), then refreshes in the background and repaints only if something
// actually changed. The second visit to any conversation is free.
//
// Plus three things that stop you ever seeing a cold fetch:
//   • prefetch  — the top conversations are fetched right after the list lands
//   • hover     — pointing at a row starts its fetch before you click
//   • in-flight dedupe — hover + click + realtime all share ONE request
//
// The Map is bounded so a long session cannot grow it without limit.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WaMessage } from './types';

const THREADS = new Map<string, WaMessage[]>();
const INFLIGHT = new Map<string, Promise<WaMessage[]>>();

/** ~60 threads of 400 messages is a few MB at worst — well within budget. */
const MAX_THREADS = 60;

function remember(id: string, rows: WaMessage[]) {
  // Re-inserting moves the key to the end, so delete-oldest is a true LRU.
  THREADS.delete(id);
  THREADS.set(id, rows);
  while (THREADS.size > MAX_THREADS) {
    const oldest = THREADS.keys().next().value;
    if (oldest === undefined) break;
    THREADS.delete(oldest);
  }
}

export function getCachedThread(id: string | null): WaMessage[] | undefined {
  return id ? THREADS.get(id) : undefined;
}

export function setCachedThread(id: string, rows: WaMessage[]): void {
  remember(id, rows);
}

/** Keep the cache in step with an optimistic send or a realtime row. */
export function patchCachedThread(
  id: string,
  fn: (prev: WaMessage[]) => WaMessage[]
): void {
  remember(id, fn(THREADS.get(id) ?? []));
}

export function dropCachedThread(id: string): void {
  THREADS.delete(id);
}

/**
 * Fetch a thread, sharing any request already in flight for the same id.
 * Without the dedupe, hovering then clicking would fire two identical queries
 * and the slower one could overwrite the fresher result.
 */
export function fetchThread(
  supabase: SupabaseClient,
  id: string,
  limit = 400
): Promise<WaMessage[]> {
  const existing = INFLIGHT.get(id);
  if (existing) return existing;

  const p = (async () => {
    const { data, error } = await supabase.rpc('whatsapp_thread', {
      p_conversation_id: id,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    const rows = (data || []) as WaMessage[];
    remember(id, rows);
    return rows;
  })();

  INFLIGHT.set(id, p);
  // Clear the slot whether it resolved or threw, so a failure can be retried.
  p.catch(() => undefined).finally(() => INFLIGHT.delete(id));
  return p;
}

/**
 * Warm the cache for conversations the user is likely to open next.
 * Deliberately silent: a prefetch that fails is a non-event, and it must never
 * surface an error toast for a thread nobody asked to see.
 */
export function prefetchThreads(
  supabase: SupabaseClient,
  ids: string[],
  max = 8
): void {
  let started = 0;
  for (const id of ids) {
    if (started >= max) break;
    if (THREADS.has(id) || INFLIGHT.has(id)) continue;
    started++;
    fetchThread(supabase, id).catch(() => undefined);
  }
}

/** True when a thread can be painted with no network wait at all. */
export function isThreadWarm(id: string | null): boolean {
  return Boolean(id && THREADS.has(id));
}

/**
 * Cheap equality for deciding whether a background refresh should repaint.
 * Comparing id+status+body catches every change we render without the cost of
 * a deep compare on a 400-message array.
 */
export function threadsEqual(a: WaMessage[], b: WaMessage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.status !== y.status || x.body !== y.body) return false;
  }
  return true;
}
