'use client';

// =============================================================================
// WHATSAPP ALERTS — the sound and the browser-tab count.
//
// Renders nothing. It lives in the app shell so it runs on EVERY page: you can
// be deep in Payments and still hear a lead reply and see the tab count move,
// exactly like WhatsApp Web sitting in a background tab.
//
// Two jobs:
//   1. A soft chime the moment an inbound message lands (realtime, not polled).
//   2. The document title becomes "(3) Migrizo CRM" while messages are unread.
//
// Deliberate choices:
//   • The chime is skipped while you are actively looking at the WhatsApp tab —
//     you can already see the message arrive; a sound would be noise.
//   • Bursts are collapsed: ten messages in one second make ONE chime, not ten.
//     A campaign reply storm should never turn into a machine-gun.
//   • Mute is remembered per browser (localStorage), so someone on a call can
//     silence it without affecting anyone else on the team.
//   • The title is restored exactly as it was when the count hits zero, so this
//     never leaves a stray "(0)" behind on other pages.
// =============================================================================

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { playChime, armAudio } from '@/lib/chime';

const MUTE_KEY = 'migrizo.wa.mute';
const BURST_MS = 2500;   // one chime per burst of arrivals

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

export function WaAlerts({ workspaceId, enabled = true }: { workspaceId: string; enabled?: boolean }) {
  // The title we were given by the page, so we can put it back untouched.
  const baseTitle = useRef<string>('');
  const lastChimeAt = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    armAudio();                       // unlock sound on the first click/keypress

    const sb = createClient();
    let alive = true;

    // Remember the clean title once, and strip any count we may have added
    // before (a hot reload during development could otherwise nest them).
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, '') || 'Migrizo CRM';

    const paint = (n: number) => {
      const clean = baseTitle.current;
      document.title = n > 0 ? `(${n}) ${clean}` : clean;
    };

    /** Read the true unread total from the server — the single source of truth. */
    const refresh = async () => {
      const { data } = await sb.rpc('whatsapp_stats', { p_workspace_id: workspaceId });
      const n = (data as { unread?: number } | null)?.unread;
      if (alive && typeof n === 'number') paint(n);
    };

    void refresh();

    const onWhatsAppScreen = () => window.location.pathname.startsWith('/whatsapp');

    const ch = sb
      .channel(`wa-alerts-${workspaceId}`)
      // A message arrived. Only inbound counts — our own sends must never
      // chime, or every campaign tick would ring the office.
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          const row = payload.new as { direction?: string };
          if (row?.direction !== 'in') return;

          const now = Date.now();
          const quiet = document.visibilityState === 'visible' && onWhatsAppScreen();
          if (!quiet && !waSoundMuted() && now - lastChimeAt.current > BURST_MS) {
            lastChimeAt.current = now;
            playChime('message');
          }
          // The count comes from the conversation rows, which the database
          // updates a moment later — re-read rather than guessing +1, so the
          // number is always the real one.
          void refresh();
        })
      // Reading a thread clears its unread count; that lands here and the tab
      // title falls back down without a page refresh.
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `workspace_id=eq.${workspaceId}` },
        () => { void refresh(); })
      .subscribe();

    // Coming back to the tab: re-sync, in case something arrived while the
    // socket was asleep on a backgrounded tab.
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      sb.removeChannel(ch);
      document.title = baseTitle.current;   // leave no "(0)" behind
    };
  }, [workspaceId, enabled]);

  return null;
}

export default WaAlerts;
