'use client';

// =============================================================================
// WHATSAPP ALERTS — the sound, the browser-tab count, and the sidebar badge.
//
// ONE subscription and ONE cheap query serve all three. That matters: the first
// version of this file added a second copy of the sidebar's existing watcher,
// and both called whatsapp_stats() — SEVEN count queries, two of them across
// the whole messages table — on every conversation change. While the campaign
// engine was sending, every outbound message set off a storm of counting in
// every open tab. That is what made the WhatsApp screen crawl.
//
// The rules now:
//   • ONE realtime channel for the whole app, owned by <WaAlerts>.
//   • whatsapp_unread_count() — a single index-only count (migration 065).
//   • Refreshes are DEBOUNCED, so a burst of sends causes one query, not fifty.
//   • The sidebar reads the number from here instead of fetching its own.
//
// Behaviour of the alert itself:
//   • Only INBOUND messages chime; our own sends never make a sound.
//   • Silent while you are looking at the WhatsApp screen — you can see it land.
//   • A burst of arrivals makes ONE chime, never a machine-gun.
//   • Mute is per-browser, so silencing during a call does not mute the team.
// =============================================================================

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { playChime, armAudio } from '@/lib/chime';

const MUTE_KEY = 'migrizo.wa.mute';
const BURST_MS = 2500;    // one chime per burst of arrivals
const DEBOUNCE_MS = 1200; // coalesce a flurry of row changes into one query

// ── the shared count, so nothing queries this twice ─────────────────────────
let unread = 0;
const listeners = new Set<() => void>();

function setUnread(n: number) {
  if (n === unread) return;          // no state change, no re-render
  unread = n;
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The live unread-conversation count. Free to call from anywhere — it reads the
 * value <WaAlerts> already maintains and never issues a query of its own.
 */
export function useWaUnread(): number {
  return useSyncExternalStore(subscribe, () => unread, () => 0);
}

/** Is the message sound muted in this browser? */
export function waSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

/** Mute or unmute the message sound for this browser. Returns the new state. */
export function setWaSoundMuted(muted: boolean): boolean {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* private mode */ }
  return muted;
}

/** Push a known count in immediately — used after "mark all read" so the badge
 *  and tab title drop the instant you click, without waiting for a round trip. */
export function setWaUnreadLocal(n: number) { setUnread(n); }

export function WaAlerts({ workspaceId, enabled = true }: { workspaceId: string; enabled?: boolean }) {
  const baseTitle = useRef('');
  const lastChimeAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    armAudio();

    const sb = createClient();
    let alive = true;

    // Remember the clean title, stripping any count we may have added before
    // (a hot reload in development could otherwise nest them).
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, '') || 'Migrizo CRM';

    const paint = (n: number) => {
      document.title = n > 0 ? `(${n}) ${baseTitle.current}` : baseTitle.current;
    };

    /** One cheap count. Never whatsapp_stats() — see the note at the top. */
    const readNow = async () => {
      const { data, error } = await sb.rpc('whatsapp_unread_count', { p_workspace_id: workspaceId });
      if (!alive) return;
      // Before migration 065 lands the function does not exist; fall back to
      // zero rather than throwing a red error over a badge.
      if (error) return;
      const n = typeof data === 'number' ? data : 0;
      setUnread(n);
      paint(n);
    };

    /** Coalesce bursts: fifty row changes in a second cause ONE query. */
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void readNow(); }, DEBOUNCE_MS);
    };

    void readNow();

    const onWhatsAppScreen = () => window.location.pathname.startsWith('/whatsapp');

    const ch = sb
      .channel(`wa-alerts-${workspaceId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const row = payload.new as { direction?: string };
          if (row?.direction !== 'in') return;   // our own sends never chime

          const now = Date.now();
          const quiet = document.visibilityState === 'visible' && onWhatsAppScreen();
          if (!quiet && !waSoundMuted() && now - lastChimeAt.current > BURST_MS) {
            lastChimeAt.current = now;
            playChime('message');
          }
          refresh();
        })
      // Only UPDATEs matter for the count (reading a thread zeroes it). Listening
      // to '*' meant every INSERT and every outbound touch re-queried too.
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'whatsapp_conversations', filter: `workspace_id=eq.${workspaceId}` },
        () => { refresh(); })
      .subscribe();

    // Returning to the tab: re-sync, in case the socket slept while hidden.
    const onVisible = () => { if (!document.hidden) void readNow(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      sb.removeChannel(ch);
      document.title = baseTitle.current;   // leave no "(0)" behind
    };
  }, [workspaceId, enabled]);

  return null;
}

export default WaAlerts;
