// =============================================================================
// SIDEBAR PREFERENCES — the order of the menu, and what hides under "More".
// -----------------------------------------------------------------------------
// Stored in localStorage rather than the database, deliberately:
//
//   * it is a personal display choice, not shared workspace data
//   * it applies the instant it changes, with no round trip and no spinner
//   * it needs no migration, so nothing has to be run in Supabase to get it
//
// The trade is that it is per browser. Someone who uses the CRM on a laptop and
// a phone arranges each once. For a preference this small that is the right
// side of the trade — and it can move to the database later without changing
// anything the sidebar does, because the shape below is what would be stored.
//
// TWO RULES THAT KEEP IT SAFE
//
//   1. Stored hrefs are matched against the live menu, never trusted as a
//      list of what exists. A page that is removed simply stops appearing.
//   2. A page the preference has never seen defaults to the MAIN group. So a
//      feature shipped next month shows up on its own instead of being
//      invisible in a "More" list nobody opens.
// =============================================================================

export interface NavPrefs {
  /** hrefs, in the order they should appear. Unknown entries are ignored. */
  order: string[];
  /** hrefs that live under the "More" group instead of the main list. */
  more: string[];
}

const KEY = 'migrizo.nav.prefs.v1';

export const EMPTY_PREFS: NavPrefs = { order: [], more: [] };

export function loadNavPrefs(): NavPrefs {
  if (typeof window === 'undefined') return EMPTY_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY_PREFS;
    const p = JSON.parse(raw) as Partial<NavPrefs>;
    return {
      order: Array.isArray(p.order) ? p.order.filter((x) => typeof x === 'string') : [],
      more: Array.isArray(p.more) ? p.more.filter((x) => typeof x === 'string') : [],
    };
  } catch {
    // A private window, cleared site data, or storage the browser blocks. The
    // menu must still render, so fall back to the built-in order.
    return EMPTY_PREFS;
  }
}

export function saveNavPrefs(p: NavPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* not being able to remember the order must never break the menu */ }
}

export function clearNavPrefs(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to undo */ }
}

/**
 * Applies a preference to the menu the person is actually allowed to see.
 *
 * `items` has already been filtered by role and permission, so anything it
 * does not contain can never be resurrected by a stale preference.
 */
export function applyNavPrefs<T extends { href: string }>(
  items: T[],
  prefs: NavPrefs,
): { main: T[]; more: T[] } {
  const rank = new Map(prefs.order.map((href, i) => [href, i]));
  const inMore = new Set(prefs.more);

  const sorted = [...items].sort((a, b) => {
    // Anything the preference has never seen keeps its built-in position,
    // which for a newly shipped page means "wherever the code put it".
    const ra = rank.has(a.href) ? rank.get(a.href)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.href) ? rank.get(b.href)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return items.indexOf(a) - items.indexOf(b);
  });

  return {
    main: sorted.filter((i) => !inMore.has(i.href)),
    more: sorted.filter((i) => inMore.has(i.href)),
  };
}
