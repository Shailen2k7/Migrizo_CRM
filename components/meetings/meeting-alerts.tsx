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

type Upcoming = { id: string; client_name: string; starts_at: string; meet_link: string | null };

type Stage = {
  key: string;
  minutes: number;
  label: (name: string) => string;
  /** 1 = gentle (far out) · 2 = attentive · 3 = urgent (now) */
  intensity: 1 | 2 | 3;
};

const STAGES: Stage[] = [
  { key: 'h1', minutes: 60, label: (n) => `Meeting with ${n} in 1 hour`, intensity: 1 },
  { key: 'm10', minutes: 10, label: (n) => `Meeting with ${n} in 10 minutes`, intensity: 2 },
  { key: 'now', minutes: 0, label: (n) => `Meeting with ${n} is starting now`, intensity: 3 },
];

const seenKey = (id: string, stage: string) => `mgz-mtg-alert:${id}:${stage}`;

// ── Sound engine ────────────────────────────────────────────────────────────
// A struck-bell voice built from a fundamental plus inharmonic partials — the
// same trick real bells use, which is why this reads as "premium chime" rather
// than "beep". Each note gets its own gain envelope with a fast attack and a
// long exponential tail.

const BELL_PARTIALS: { ratio: number; gain: number; decay: number }[] = [
  { ratio: 1.0, gain: 1.0, decay: 1.0 },    // fundamental
  { ratio: 2.0, gain: 0.42, decay: 0.72 },  // octave
  { ratio: 3.0, gain: 0.24, decay: 0.52 },  // twelfth
  { ratio: 4.2, gain: 0.14, decay: 0.36 },  // inharmonic — the "metal" in the bell
  { ratio: 5.4, gain: 0.08, decay: 0.26 },  // shimmer
];

/** One struck bell note. */
function strike(ctx: AudioContext, dest: AudioNode, freq: number, at: number, dur: number, vel: number) {
  for (const p of BELL_PARTIALS) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * p.ratio, at);
    // Real bells drop in pitch a touch as they ring out.
    osc.frequency.exponentialRampToValueAtTime(freq * p.ratio * 0.997, at + dur * p.decay);

    const peak = Math.max(0.0001, vel * p.gain);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);          // fast strike
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur * p.decay); // long tail

    osc.connect(g);
    g.connect(dest);
    osc.start(at);
    osc.stop(at + dur * p.decay + 0.05);
  }
}

/**
 * Play the alert chime. Intensity shapes the melody:
 *   1 → two soft notes (a polite "heads up")
 *   2 → rising three-note arpeggio (attention)
 *   3 → four-note fanfare, played twice (it's starting NOW)
 */
function playChime(ctx: AudioContext, intensity: 1 | 2 | 3) {
  const now = ctx.currentTime + 0.02;

  // Master bus — generous headroom, then a limiter so it stays loud but never harsh.
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.setValueAtTime(-14, now);
  comp.knee.setValueAtTime(24, now);
  comp.ratio.setValueAtTime(9, now);
  comp.attack.setValueAtTime(0.004, now);
  comp.release.setValueAtTime(0.22, now);
  master.connect(comp);
  comp.connect(ctx.destination);

  // A short delay tap adds air/space — a hint of a concert hall.
  const delay = ctx.createDelay(0.5);
  delay.delayTime.setValueAtTime(0.14, now);
  const fb = ctx.createGain();
  fb.gain.setValueAtTime(0.22, now);
  const wet = ctx.createGain();
  wet.gain.setValueAtTime(0.3, now);
  delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);

  const bus = ctx.createGain();
  bus.connect(master);
  bus.connect(delay);

  // Notes (Hz): C6 E6 G6 C7 — a bright, unambiguous major arpeggio.
  const C6 = 1046.5, E6 = 1318.51, G6 = 1567.98, C7 = 2093.0, G5 = 783.99;

  if (intensity === 1) {
    master.gain.setValueAtTime(0.85, now);
    strike(ctx, bus, G5, now, 1.5, 0.5);
    strike(ctx, bus, C6, now + 0.16, 1.9, 0.45);
  } else if (intensity === 2) {
    master.gain.setValueAtTime(1.0, now);
    strike(ctx, bus, C6, now, 1.3, 0.55);
    strike(ctx, bus, E6, now + 0.14, 1.3, 0.52);
    strike(ctx, bus, G6, now + 0.28, 2.0, 0.5);
  } else {
    master.gain.setValueAtTime(1.15, now);
    const fanfare = (t0: number) => {
      strike(ctx, bus, C6, t0, 1.0, 0.6);
      strike(ctx, bus, E6, t0 + 0.11, 1.0, 0.58);
      strike(ctx, bus, G6, t0 + 0.22, 1.1, 0.58);
      strike(ctx, bus, C7, t0 + 0.33, 2.2, 0.62);
    };
    fanfare(now);
    fanfare(now + 0.95); // second pass — impossible to miss
  }
}

export function MeetingAlerts({ workspaceId }: { workspaceId: string }) {
  const audioRef = useRef<AudioContext | null>(null);
  const meetingsRef = useRef<Upcoming[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    // Unlock audio + ask notification permission on the first interaction
    // (browsers block sound until the user has interacted with the page).
    const unlock = () => {
      try {
        if (!audioRef.current) {
          audioRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        }
        if (audioRef.current.state === 'suspended') void audioRef.current.resume();
        if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
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
          // fire window: from the moment it's due until 90s after (tick tolerance)
          if (now < fireAt || now > fireAt + 90000) continue;
          const key = seenKey(m.id, st.key);
          try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch { /* still alert */ }

          // 1) chime
          try {
            if (audioRef.current && audioRef.current.state === 'running') playChime(audioRef.current, st.intensity);
          } catch { /* no-op */ }
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
