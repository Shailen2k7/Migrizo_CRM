// =============================================================================
// DELIVERY STAGES — the "where is this paying client" status layer for Cases.
// Sits ALONGSIDE the detailed 5-phase journey (which lives inside each case).
// Used by the Cases Board (kanban) and List (filter) views.
// =============================================================================
export type DeliveryStageKey =
  | 'onboarding' | 'profile_building' | 'submitted' | 'endorsed'
  | 'granted' | 'refused' | 'reapplying' | 'non_responsive' | 'closed';

export interface DeliveryStage {
  key: DeliveryStageKey;
  label: string;
  accent: string;   // solid colour (badge text / column header)
  tint: string;     // soft background
  group: 'active' | 'outcome' | 'holding';
}

export const DELIVERY_STAGES: DeliveryStage[] = [
  { key: 'onboarding',       label: 'Onboarding',           accent: '#506BD8', tint: '#EEF2FF', group: 'active'  },
  { key: 'profile_building', label: 'Profile Building',     accent: '#4F46E5', tint: '#EEF0FF', group: 'active'  },
  { key: 'submitted',        label: 'Application Submitted', accent: '#7C3AED', tint: '#F3EEFF', group: 'active'  },
  { key: 'endorsed',         label: 'Endorsed',             accent: '#0D9488', tint: '#E6FAF6', group: 'active'  },
  { key: 'granted',          label: 'GTV Granted',          accent: '#10B981', tint: '#E6F7EE', group: 'outcome' },
  { key: 'refused',          label: 'Refused',              accent: '#DC2626', tint: '#FDECEC', group: 'outcome' },
  { key: 'reapplying',       label: 'Reapplying',           accent: '#F59E0B', tint: '#FEF6E7', group: 'holding' },
  { key: 'non_responsive',   label: 'Non-Responsive',       accent: '#B45309', tint: '#FDF3E7', group: 'holding' },
  { key: 'closed',           label: 'Closed',               accent: '#6B7280', tint: '#F3F4F6', group: 'holding' },
];

export const DELIVERY_BY_KEY: Record<string, DeliveryStage> =
  Object.fromEntries(DELIVERY_STAGES.map((s) => [s.key, s]));

export function deliveryStageOf(c: { delivery_stage?: string | null }): DeliveryStageKey {
  const k = c.delivery_stage as DeliveryStageKey;
  return DELIVERY_BY_KEY[k] ? k : 'onboarding';
}
