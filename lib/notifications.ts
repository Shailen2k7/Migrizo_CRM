// =========================================
// Notification system — browser push + persistent read state
// =========================================

export type NotifPref = {
  browserEnabled: boolean;
  soundEnabled: boolean;
  overdueFollowups: boolean;
  paymentOverdue: boolean;
  followupsToday: boolean;
  hotLeadStale: boolean;
};

const PREF_KEY = 'migrizo-notif-prefs';
const READ_KEY = 'migrizo-notif-read';
const LAST_CHECK_KEY = 'migrizo-notif-last-check';

const DEFAULTS: NotifPref = {
  browserEnabled: false,
  soundEnabled: true,
  overdueFollowups: true,
  paymentOverdue: true,
  followupsToday: true,
  hotLeadStale: true,
};

export function getPrefs(): NotifPref {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function setPrefs(p: Partial<NotifPref>): NotifPref {
  const current = getPrefs();
  const next = { ...current, ...p };
  if (typeof window !== 'undefined') localStorage.setItem(PREF_KEY, JSON.stringify(next));
  return next;
}

// Read-state tracking — persists which notifications the user has dismissed
export function getReadSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function markRead(ids: string | string[]): void {
  if (typeof window === 'undefined') return;
  const set = getReadSet();
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => set.add(id));
  localStorage.setItem(READ_KEY, JSON.stringify(Array.from(set)));
}

export function markUnread(id: string): void {
  if (typeof window === 'undefined') return;
  const set = getReadSet();
  set.delete(id);
  localStorage.setItem(READ_KEY, JSON.stringify(Array.from(set)));
}

export function clearAllRead(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(READ_KEY);
}

// =========================================
// Browser permission + push
// =========================================
export function getBrowserPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestBrowserPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
  const p = await Notification.requestPermission();
  return p;
}

export function sendBrowserNotification(title: string, body: string, options: { tag?: string; onClick?: () => void } = {}) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const notif = new Notification(title, {
      body,
      tag: options.tag,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      requireInteraction: false,
    });
    if (options.onClick) {
      notif.onclick = () => {
        window.focus();
        options.onClick?.();
        notif.close();
      };
    }
  } catch {
    // Best effort — browser notifications can fail silently
  }
}

// =========================================
// Sound alert
// =========================================
let audioContext: AudioContext | null = null;

export function playAlertSound() {
  if (typeof window === 'undefined') return;
  if (!getPrefs().soundEnabled) return;
  try {
    if (!audioContext) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new Ctx();
    }
    // Two-tone chime — pleasant, not jarring
    const now = audioContext.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(audioContext!.destination);
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    // Audio can fail without user gesture — fine
  }
}

// =========================================
// Last-check tracking — for "new since last visit" detection
// =========================================
export function getLastCheck(): number {
  if (typeof window === 'undefined') return Date.now();
  const raw = localStorage.getItem(LAST_CHECK_KEY);
  return raw ? parseInt(raw, 10) : Date.now();
}

export function setLastCheck(ts: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_CHECK_KEY, String(ts));
}
