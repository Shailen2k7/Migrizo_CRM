'use client';

// =============================================================================
// MEETING ALERTS — in-app reminders for scheduled meetings.
// Mounted once in the AppShell so it works on every CRM page.
//
// What it does:
//   • Checks upcoming meetings every 30 seconds (light query, next 25 hours)
//   • Fires alerts at 1 hour, 10 minutes, and at meeting start
//   • Each alert = a rich bell-arpeggio chime whose urgency escalates with the
//     stage → browser notification → in-app toast with a Join button
//   • Never repeats an alert (deduped in localStorage per meeting + stage)
//   • Sound requires one user interaction first (a browser rule) — any click
//     or keypress anywhere in the CRM unlocks it for the whole session.
//
// No speech synthesis: the chime carries the signal, quietly and elegantly.
// =============================================================================
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { armAudio, playChime, type ChimeName } from '@/lib/chime';

type Upcoming = { id: string; client_name: string; starts_at: string; meet_link: string | null };

type Stage = {
  key: string;
  minutes: number;
  label: (name: string) => string;
  /** 1 = gentle (far out) · 2 = attentive · 3 = urgent (now) */
  chime: ChimeName;
};

const STAGES: Stage[] = [
  { key: 'h1',  minutes: 60, label: (n) => `Meeting with ${n} in 1 hour`,      chime: 'meeting60' as ChimeName },
  { key: 'm10', minutes: 10, label: (n) => `Meeting with ${n} in 10 minutes`, chime: 'meeting10' as ChimeName },
  { key: 'now', minutes: 0,  label: (n) => `Meeting with ${n} is starting now`, chime: 'meetingNow' as ChimeName },
];

const seenKey = (id: string, stage: string) => `mgz-mtg-alert:${id}:${stage}`;

export function MeetingAlerts({ workspaceId }: { workspaceId: string }) {
  const meetingsRef = useRef<Upcoming[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    // Housekeeping: drop seen-flags older than a week so localStorage does not
    // grow without limit.
    try {
      const cutoff = Date.now() - 7 * 86400000;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('mgz-mtg-alert:')) continue;
        const stamp = Number(localStorage.getItem(k));
        if (Number.isFinite(stamp) && stamp > 0 && stamp < cutoff) localStorage.removeItem(k);
      }
    } catch { /* no-op */ }

    // Audio unlocking and permission prompting are handled centrally.
    armAudio();

    // Refresh the upcoming list every 5 minutes; check alert times every 30s.
    const fetchUpcoming = async () => {
      const now = Date.now();
      const { data } = await supabase
        .from('meetings')
        .select('id, client_name, starts_at, meet_link')
        .eq('workspace_id', workspaceId)
        .eq('status', 'upcoming')
        .gte('starts_at', new Date(now - 5 * 60000).toISOString())
        .lte('starts_at', new Date(now + 25 * 3600 * 1000).toISOString())
        .order('starts_at')
        .limit(50);
      if (alive) meetingsRef.current = (data as Upcoming[]) || [];
    };

    const check = () => {
      const now = Date.now();
      for (const m of meetingsRef.current) {
        const startMs = new Date(m.starts_at).getTime();
        for (const st of STAGES) {
          const fireAt = startMs - st.minutes * 60000;
          // Fire window. This used to be 90s, which a throttled background tab
          // could step straight over — browsers slow timers to a minute or more
          // when hidden. 10 minutes is wide enough to survive that, and the
          // seen-flag still guarantees the alert is delivered exactly once.
          if (now < fireAt || now > fireAt + 10 * 60000) continue;
          const key = seenKey(m.id, st.key);
          try { if (localStorage.getItem(key)) continue; } catch { /* still alert */ }

          // 1) chime — and only mark the alert as delivered if it actually
          //    made a sound. The old code wrote the seen-flag first, so any
          //    failed chime permanently silenced that alert.
          const sounded = playChime(st.chime);
          if (!sounded) continue;   // try again on the next tick
          try { localStorage.setItem(key, String(Date.now())); } catch { /* no-op */ }
          // 2) browser notification (works even when the tab is in background)
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const n = new Notification(st.label(m.client_name), {
                body: new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(m.starts_at)) + (m.meet_link ? ' · Click to join' : ''),
                tag: key, requireInteraction: st.key !== 'h1',
              });
              n.onclick = () => { window.focus(); if (m.meet_link) window.open(m.meet_link, '_blank'); n.close(); };
            }
          } catch { /* no-op */ }
          // 3) in-app toast with Join
          toast(st.label(m.client_name), {
            duration: st.key === 'h1' ? 8000 : 20000,
            action: m.meet_link ? { label: 'Join', onClick: () => window.open(m.meet_link!, '_blank') } : undefined,
          });
        }
      }
    };

    void fetchUpcoming().then(check);
    const fetchTimer = setInterval(() => void fetchUpcoming(), 5 * 60000);
    const checkTimer = setInterval(check, 15000);
    // Re-check the moment the tab becomes visible again: while hidden the
    // browser may not have run the timer at all.
    const onVisible = () => { if (!document.hidden) { void fetchUpcoming(); check(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(fetchTimer); clearInterval(checkTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [workspaceId]);

  return null; // invisible — it only listens and alerts
}
