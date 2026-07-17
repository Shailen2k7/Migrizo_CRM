'use client';

// AI COO preferences. Stored locally on the owner's device. The feature is
// admin-only; this toggle lets the owner show or hide the briefing banner.
// The briefing is silent — the only sound in the CRM is the meeting alert.
export interface CooSettings {
  enabled: boolean; // master on/off for the briefing banner
}

export const COO_KEY = 'migrizo_coo_v1';
export const COO_EVENT = 'migrizo-coo-changed';

export function readCoo(): CooSettings {
  if (typeof window === 'undefined') return { enabled: true };
  try {
    const raw = JSON.parse(localStorage.getItem(COO_KEY) || '{}');
    return { enabled: raw.enabled !== false };
  } catch {
    return { enabled: true };
  }
}

export function writeCoo(s: CooSettings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(COO_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(COO_EVENT));
}
