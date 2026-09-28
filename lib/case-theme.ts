// =============================================================================
// CASE THEME — the palette of the case pages, shared.
// -----------------------------------------------------------------------------
// The case details page (design approved 28 Sep 2026) and the Cases home use
// the same light, green-on-white look: navy headings, slate secondary text,
// green for anything done or primary, soft tints for status. Both import it
// from here so a colour can never drift between the two.
//
// Always light, whatever the CRM theme — these are working documents.
// =============================================================================

export const C = {
  page: '#F3F5F7', card: '#FFFFFF', line: '#E3E8EE', lineSoft: '#EEF1F4',
  navy: '#0F1F3D', ink: '#1E293B', sub: '#5B6474', faint: '#9AA3AF',
  green: '#16A36B', greenDark: '#0E7A50', greenSoft: '#DDF3E8', greenBg: '#EEF9F3',
  field: '#FFFFFF', tableHead: '#F7F9FB', rowHover: '#F7FAF9',
} as const;

/** Status tones, in the same family as the payment and health pills. */
export const TONE = {
  green: { bg: '#DDF3E8', fg: '#0E7A50', dot: '#16A36B' },
  amber: { bg: '#FBF1DD', fg: '#8A5A12', dot: '#D99A2B' },
  red:   { bg: '#FBE7E2', fg: '#9A3B2A', dot: '#D2583F' },
  lilac: { bg: '#EDEAF6', fg: '#4A3E86', dot: '#7465AE' },
  slate: { bg: '#EEF1F4', fg: '#3D4757', dot: '#8A94A3' },
} as const;
