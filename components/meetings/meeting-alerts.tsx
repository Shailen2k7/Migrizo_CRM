'use client';

// =============================================================================
// MEETING ALERTS — a strong in-app reminder system for scheduled meetings.
// Mounted once in the AppShell so it works on every CRM page.
//
// What it does:
//   • Checks upcoming meetings every 30 seconds (light query, next 25 hours)
//   • Fires alerts at 1 hour, 10 minutes, and at meeting start
//   • Each alert = pleasant two-tone chime → spoken voice announcement
//     ("Meeting with Rahul starts in 10 minutes") → browser notification
//     → in-app toast with a Join button
//   • Never repeats an alert (deduped in localStorage per meeting + stage)
//   • Sound requires one user interaction first (a browser rule) — any click
//     or keypress anywhere in the CRM unlocks it for the whole session.
// =============================================================================
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Upcoming = { id: string; client_name: string; starts_at: string; meet_link: string | null };

const STAGES: { key: string; minutes: number; phrase: (name: string) => string; label: (name: string) => string }[] = [
  { key: 'h1', minutes: 60, phrase: (n) => `Heads up. Your meeting with ${n} starts in one hour.`, label: (n) => `Meeting with ${n} in 1 hour` },
  { key: 'm10', minutes: 10, phrase: (n) => `Reminder. Your meeting with ${n} starts in ten minutes.`, label: (n) => `Meeting with ${n} in 10 minutes` },
  { key: 'now', minutes: 0, phrase: (n) => `Your meeting with ${n} is starting now.`, label: (n) => `Meeting with ${n} is starting now` },
];

const seenKey = (id: string, stage: string) => `mgz-mtg-alert:${id}:${stage}`;

/** A warm two-tone bell (E6 → B5) synthesized in the browser — no audio files. */
function playChime(ctx: AudioContext) {
  const notes = [
    { freq: 1318.5, at: 0.0, dur: 0.9, gain: 0.22 },   // E6
    { freq: 987.77, at: 0.18, dur: 1.2, gain: 0.18 },  // B5
  ];
  for (const n of notes) {
    const t = ctx.currentTime + n.at;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = n.freq;
    osc2.type = 'triangle'; osc2.frequency.value = n.freq * 2; // soft shimmer
    const g2 = ctx.createGain(); g2.gain.value = 0.06;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(n.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    osc.connect(g); osc2.connect(g2); g2.connect(g); g.connect(ctx.destination);
    osc.start(t); osc2.start(t);
    osc.stop(t + n.dur + 0.05); osc2.stop(t + n.dur + 0.05);
  }
}

/** Speak the announcement with the nicest available English voice. */
function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /Google UK English Female|Samantha|Karen|Serena/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith('en') && /female|natural/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith('en'));
    if (preferred) u.voice = preferred;
    u.rate = 0.98; u.pitch = 1.02; u.volume = 0.9;
    window.speechSynthesis.cancel(); // never overlap announcements
    window.speechSynthesis.speak(u);
  } catch { /* voice is best-effort */ }
}

export function MeetingAlerts({ workspaceId }: { workspaceId: string }) {
  const audioRef = useRef<AudioContext | null>(null);
  const meetingsRef = useRef<Upcoming[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    // Unlock audio + ask notification permission on the first interaction (browser rules).
    const unlock = () => {
      try {
        if (!audioRef.current) audioRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        if (audioRef.current.state === 'suspended') void audioRef.current.resume();
        if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
        if ('speechSynthesis' in window) window.speechSynthesis.getVoices(); // warm the voice list
      } catch { /* no-op */ }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });

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
          // fire window: from the moment it's due until 90s after (missed-by-a-tick tolerance)
          if (now < fireAt || now > fireAt + 90000) continue;
          const key = seenKey(m.id, st.key);
          try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch { /* still alert */ }

          // 1) chime
          try { if (audioRef.current && audioRef.current.state === 'running') playChime(audioRef.current); } catch { /* no-op */ }
          // 2) voice announcement (slightly after the chime lands)
          setTimeout(() => speak(st.phrase(m.client_name)), 900);
          // 3) browser notification (works even when the tab is in background)
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const n = new Notification(st.label(m.client_name), {
                body: new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(m.starts_at)) + (m.meet_link ? ' · Click to join' : ''),
                tag: key, requireInteraction: st.key !== 'h1',
              });
              n.onclick = () => { window.focus(); if (m.meet_link) window.open(m.meet_link, '_blank'); n.close(); };
            }
          } catch { /* no-op */ }
          // 4) in-app toast with Join
          toast(st.label(m.client_name), {
            duration: st.key === 'h1' ? 8000 : 20000,
            action: m.meet_link ? { label: 'Join', onClick: () => window.open(m.meet_link!, '_blank') } : undefined,
          });
        }
      }
      // housekeeping: drop dedupe keys older than 2 days (by meeting no longer in window)
    };

    void fetchUpcoming();
    const fetchTimer = setInterval(() => void fetchUpcoming(), 5 * 60000);
    const checkTimer = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(fetchTimer); clearInterval(checkTimer);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [workspaceId]);

  return null; // invisible — it only listens and alerts
}
