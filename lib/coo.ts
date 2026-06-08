'use client';

// AI COO preferences. Stored locally on the owner's device. The feature is
// admin-only; these toggles let the owner pause/resume the banner and the voice,
// or switch it off entirely.
export interface CooSettings {
  enabled: boolean; // master on/off (the banner + voice)
  voice: boolean;   // spoken briefing on open
}

export const COO_KEY = 'migrizo_coo_v1';
export const COO_EVENT = 'migrizo-coo-changed';

export function readCoo(): CooSettings {
  if (typeof window === 'undefined') return { enabled: true, voice: true };
  try {
    const raw = JSON.parse(localStorage.getItem(COO_KEY) || '{}');
    return { enabled: raw.enabled !== false, voice: raw.voice !== false };
  } catch {
    return { enabled: true, voice: true };
  }
}

export function writeCoo(s: CooSettings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(COO_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(COO_EVENT));
}
