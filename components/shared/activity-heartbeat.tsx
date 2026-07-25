'use client';

// =============================================================================
// ACTIVITY HEARTBEAT — invisible, lightweight presence tracking.
//
// Sends one tiny ping every 30 seconds, but ONLY when the person is genuinely
// working. It stops immediately when:
//   • there's been no mouse / keyboard / scroll / touch for 5 minutes, or
//   • the browser tab is hidden (another tab, minimised, screen locked).
//
// That's what keeps the numbers fair — a CRM left open on an empty desk
// records nothing. Performance impact is negligible: one small request every
// 30s, sent with keepalive so it never blocks navigation.
// =============================================================================
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const PING_EVERY_MS = 30_000;   // one ping per 30 seconds
const IDLE_AFTER_MS = 5 * 60_000; // 5 minutes of no input = idle

/** Turn a pathname into a friendly section name for the report. */
function sectionOf(pathname: string): string {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || 'dashboard';
  return seg.toLowerCase();
}

export function ActivityHeartbeat({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname();
  const lastInputRef = useRef<number>(Date.now());
  const pathRef = useRef<string>(pathname);

  // Keep the current section fresh without restarting the timer.
  useEffect(() => { pathRef.current = pathname; }, [pathname]);

  useEffect(() => {
    const markInput = () => { lastInputRef.current = Date.now(); };

    // Any of these counts as "still working".
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
    for (const e of events) window.addEventListener(e, markInput, { passive: true });

    const send = () => {
      // Rule 1: tab must be visible.
      if (document.visibilityState !== 'visible') return;
      // Rule 2: there must have been input recently.
      if (Date.now() - lastInputRef.current > IDLE_AFTER_MS) return;

      try {
        void fetch('/api/activity/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, section: sectionOf(pathRef.current) }),
          keepalive: true,   // survives page navigation, never blocks the UI
        }).catch(() => { /* a dropped ping is harmless */ });
      } catch { /* no-op */ }
    };

    send(); // record arrival immediately
    const timer = setInterval(send, PING_EVERY_MS);

    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, markInput);
    };
  }, [workspaceId]);

  return null; // renders nothing
}
