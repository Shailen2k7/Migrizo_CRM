'use client';

// =============================================================================
// CHIME — the shared sound engine for every alert in the CRM.
//
// A struck-bell voice: a fundamental plus inharmonic partials, which is the
// same trick real bells use and why this reads as a warm chime rather than a
// beep. Everything is synthesised, so there are no audio files to host and it
// works offline.
//
// This module also owns the one AudioContext for the whole app. Browsers only
// allow audio after a user gesture, so `armAudio()` is wired to the first
// pointer or key event and every later play attempt resumes the context if the
// browser has suspended it — which Chrome does whenever a tab is backgrounded.
// That resume step is the thing whose absence silently killed meeting alerts.
// =============================================================================

let ctx: AudioContext | null = null;
let armed = false;

function makeCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx || new Ctor();
    return ctx;
  } catch { return null; }
}

/**
 * Hook the first user gesture so the browser will let us make sound later.
 * Safe to call many times; it only installs the listeners once.
 */
export function armAudio() {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const unlock = () => {
    const c = makeCtx();
    if (c && c.state === 'suspended') void c.resume();
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  // Chrome suspends audio on hidden tabs; wake it as soon as we are visible.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { const c = makeCtx(); if (c && c.state === 'suspended') void c.resume(); }
  });
}

// ── one struck bell note ────────────────────────────────────────────────────
const PARTIALS = [
  { ratio: 1.0, gain: 1.0,  decay: 1.0  },  // fundamental
  { ratio: 2.0, gain: 0.42, decay: 0.72 },  // octave
  { ratio: 3.0, gain: 0.24, decay: 0.52 },  // twelfth
  { ratio: 4.2, gain: 0.14, decay: 0.36 },  // inharmonic — the metal in the bell
  { ratio: 5.4, gain: 0.08, decay: 0.26 },  // shimmer
];

function strike(c: AudioContext, dest: AudioNode, freq: number, at: number, dur: number, vel: number) {
  for (const p of PARTIALS) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * p.ratio, at);
    osc.frequency.exponentialRampToValueAtTime(freq * p.ratio * 0.997, at + dur * p.decay);
    const peak = Math.max(0.0001, vel * p.gain);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur * p.decay);
    osc.connect(g); g.connect(dest);
    osc.start(at); osc.stop(at + dur * p.decay + 0.05);
  }
}

// Notes, in Hz.
const G5 = 783.99, A5 = 880, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, C7 = 2093.0, A4 = 440;

export type ChimeName =
  | 'followupSoon'   // a follow-up is 15 minutes away
  | 'followupNow'    // a follow-up is due
  | 'meeting60'      // meeting in an hour
  | 'meeting10'      // meeting in ten minutes
  | 'meetingNow'     // meeting starting — the double chime
  | 'message'        // a lead just wrote to us on WhatsApp
  | 'done';          // something was completed

/**
 * Play a chime. Returns false when the browser refused to make sound, which
 * lets the caller decide whether the alert should still count as delivered.
 */
export function playChime(name: ChimeName): boolean {
  const c = makeCtx();
  if (!c) return false;
  // Resume rather than give up. The old code checked for state === 'running'
  // and silently skipped, which is why backgrounded tabs went quiet forever.
  if (c.state === 'suspended') { void c.resume(); }

  try {
    const now = c.currentTime + 0.02;

    const master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, now);
    comp.knee.setValueAtTime(24, now);
    comp.ratio.setValueAtTime(9, now);
    comp.attack.setValueAtTime(0.004, now);
    comp.release.setValueAtTime(0.22, now);
    master.connect(comp); comp.connect(c.destination);

    // A short feedback tap for air — a hint of a room rather than a dry beep.
    const delay = c.createDelay(0.5);
    delay.delayTime.setValueAtTime(0.14, now);
    const fb = c.createGain(); fb.gain.setValueAtTime(0.22, now);
    const wet = c.createGain(); wet.gain.setValueAtTime(0.3, now);
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);

    const bus = c.createGain();
    bus.connect(master); bus.connect(delay);

    switch (name) {
      case 'followupSoon':
        master.gain.setValueAtTime(0.8, now);
        strike(c, bus, A5, now, 1.5, 0.42);
        strike(c, bus, D6, now + 0.16, 1.9, 0.4);
        break;
      case 'followupNow':
        master.gain.setValueAtTime(1.0, now);
        strike(c, bus, A5, now, 1.3, 0.5);
        strike(c, bus, D6, now + 0.15, 1.4, 0.48);
        strike(c, bus, E6, now + 0.3, 2.2, 0.46);
        break;
      case 'meeting60':
        master.gain.setValueAtTime(0.85, now);
        strike(c, bus, G5, now, 1.5, 0.5);
        strike(c, bus, C6, now + 0.16, 1.9, 0.45);
        break;
      case 'meeting10':
        master.gain.setValueAtTime(1.0, now);
        strike(c, bus, C6, now, 1.3, 0.55);
        strike(c, bus, E6, now + 0.14, 1.3, 0.52);
        strike(c, bus, G6, now + 0.28, 2.0, 0.5);
        break;
      case 'meetingNow': {
        master.gain.setValueAtTime(1.15, now);
        const fanfare = (t0: number) => {
          strike(c, bus, C6, t0, 1.0, 0.6);
          strike(c, bus, E6, t0 + 0.11, 1.0, 0.58);
          strike(c, bus, G6, t0 + 0.22, 1.1, 0.58);
          strike(c, bus, C7, t0 + 0.33, 2.2, 0.62);
        };
        fanfare(now);
        fanfare(now + 0.95);   // second pass — impossible to miss
        break;
      }
      case 'message':
        // A lead wrote to us. This one fires many times a day, so it has to be
        // the gentlest voice in the set: two soft notes rising a fourth, quiet
        // and short. Pleasant on the tenth hearing is the whole design brief —
        // anything brighter or longer becomes something people mute by lunch.
        master.gain.setValueAtTime(0.42, now);
        strike(c, bus, G5, now, 0.85, 0.26);
        strike(c, bus, C6, now + 0.10, 1.25, 0.24);
        break;
      case 'done':
        master.gain.setValueAtTime(0.6, now);
        strike(c, bus, A4 * 2, now, 0.9, 0.3);
        strike(c, bus, E6, now + 0.09, 1.2, 0.28);
        break;
    }
    return true;
  } catch { return false; }
}

/** True when the browser will actually let us make a sound right now. */
export function audioReady(): boolean {
  const c = makeCtx();
  return !!c && c.state !== 'closed';
}
