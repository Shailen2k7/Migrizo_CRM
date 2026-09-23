// =============================================================================
// MASTER LEADS — the three classifications, defined once.
// -----------------------------------------------------------------------------
// The Master Leads view classifies every lead on three axes. Each one already
// had a home in the database before this file existed, and this file changes
// none of them — it names them, gives them labels and colours, and provides the
// handful of helpers that everything else reads through.
//
//   GTV Eligibility  →  leads.eligibility
//   WTP              →  leads.investment_readiness
//   Lead Status      →  leads.stage          (STAGE_META in lib/types.ts)
//
// WHY ONE MODULE
// The offer and discount rules, and the lead-movement automation, are coming
// later and will need to ask exactly these questions: is this lead eligible,
// are they willing to pay, where are they in the pipeline. When they arrive
// they import from here rather than re-deriving the answers, so there is one
// definition of "eligible" in the codebase instead of four that drift.
//
// NOTHING HERE AUTOMATES ANYTHING. No rule in this file moves a lead between
// statuses, applies a discount, or sends a message. It is vocabulary.
// =============================================================================

import type { Lead } from './types';
import { READINESS_META, type Readiness } from './intake';

/**
 * A label plus its colours. `short` is optional because STAGE_META — which
 * predates this file and is shared with the drawer, the table and the charts —
 * has no short form, and widening it here would have meant editing a type five
 * other screens depend on to gain a field only this one wanted.
 */
export interface Swatch { label: string; short?: string; bg: string; fg: string; dot: string }

// ── GTV Eligibility ─────────────────────────────────────────────────────────
// Widened from two values to four by migration 121. NULL is a real and common
// answer — 1,872 leads have never been reviewed — and it renders as a blank
// cell waiting to be filled in, never as a guess.

export type GtvEligibility = 'eligible' | 'highly_eligible' | 'not_eligible' | 'others';

export const GTV_META: Record<GtvEligibility, Swatch & { short: string }> = {
  highly_eligible: { label: 'Highly Eligible', short: 'Highly Elig.', bg: '#FCE7F3', fg: '#9D174D', dot: '#EC4899' },
  eligible:        { label: 'Eligible',        short: 'Eligible',     bg: '#CCFBF1', fg: '#0F766E', dot: '#14B8A6' },
  not_eligible:    { label: 'Not Eligible',    short: 'Not Elig.',    bg: '#FCEBEB', fg: '#A32D2D', dot: '#EF4444' },
  others:          { label: 'Others',          short: 'Others',       bg: '#F4F4F6', fg: '#6B7280', dot: '#9CA3AF' },
};

export const GTV_ORDER: GtvEligibility[] = ['highly_eligible', 'eligible', 'not_eligible', 'others'];

/**
 * Does this lead count as eligible?
 *
 * THIS IS THE WHOLE REASON THE HELPER EXISTS. Before migration 121 the answer
 * was `eligibility === 'eligible'`, written out by hand in the Leads dashboard
 * and the Meetings dashboard. The day someone promoted a lead to Highly
 * Eligible, that lead would have dropped out of the Eligible card and out of
 * the "eligible leads with no call booked" list — a promotion would have read
 * as a loss. Highly Eligible is a stronger eligible, so it counts inside.
 */
export function isGtvEligible(lead: Pick<Lead, 'eligibility'>): boolean {
  return lead.eligibility === 'eligible' || lead.eligibility === 'highly_eligible';
}

/** The verdict, or null when nobody has reviewed this lead yet. */
export function gtvOf(lead: Pick<Lead, 'eligibility'>): GtvEligibility | null {
  const v = lead.eligibility;
  return v && v in GTV_META ? (v as GtvEligibility) : null;
}

// ── WTP — willingness to pay ────────────────────────────────────────────────
// This is leads.investment_readiness, which the Meta ad form has been filling
// in since migration 050 from the "readiness to invest" question. 1,113 leads
// answered it before the Master view existed, so the column arrives populated
// rather than empty. The keys are the stored values and MUST NOT CHANGE: the
// intake mapper, the lead queue filters and the ad-form ingest all write them.

export type Wtp = Readiness;                                 // 'yes' | 'maybe' | 'no'

export const WTP_META: Record<Wtp, Swatch & { short: string }> = {
  yes:   { label: 'Willing to Pay',       short: 'WTP',   ...swatchOf('yes') },
  maybe: { label: 'Maybe Willing to Pay', short: 'M-WTP', ...swatchOf('maybe') },
  no:    { label: 'Not Willing to Pay',   short: 'N-WTP', ...swatchOf('no') },
};

export const WTP_ORDER: Wtp[] = ['yes', 'maybe', 'no'];

/** Borrows the existing readiness palette so the drawer and this view agree. */
function swatchOf(k: Readiness): { bg: string; fg: string; dot: string } {
  const m = READINESS_META[k];
  return { bg: m.bg, fg: m.fg, dot: m.dot };
}

export function wtpOf(lead: Pick<Lead, 'investment_readiness'>): Wtp | null {
  const v = lead.investment_readiness;
  return v && v in WTP_META ? (v as Wtp) : null;
}

// ── How a lead was classified ───────────────────────────────────────────────
// Used for the small "where did this come from" hint in the Master view, so a
// verdict inherited from the old bulk migration is never mistaken for one
// somebody actually made.

export function gtvSourceLabel(lead: Pick<Lead, 'eligibility_source'>): string | null {
  switch (lead.eligibility_source) {
    case 'manual':   return 'Set by hand';
    case 'whatsapp': return 'Told on WhatsApp';
    case 'ai':       return 'Read from their CV';
    case 'derived':  return 'Inherited from older data';
    default:         return null;
  }
}
