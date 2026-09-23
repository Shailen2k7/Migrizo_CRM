// =============================================================================
// PLAYBOOK — which bucket every lead falls into, and what to do about it.
// -----------------------------------------------------------------------------
// The Master Leads sheet answers one question: is every lead being worked, and
// if not, why not. The unit of that answer is the BUCKET — a segment with a
// defined play, decided from four facts the CRM already stores:
//
//   stage · eligibility · investment_readiness · is_spotlight
//
// plus, for Response Status, the WhatsApp conversation history.
//
// EVERYTHING HERE IS A PURE FUNCTION. Nothing in this file writes, sends,
// prices, enrols or moves anything — buckets are a lens, and the rules were
// dictated by the owner on 23 Sep 2026 (the "cards" spec), not invented here.
//
// THE FIRST MATCHING RULE WINS, so a lead is in exactly one bucket and the
// bucket counts always sum to the lead count. Order is deliberate:
// assessment starves every other rule (they all need both answers), grooming
// outranks re-engagement, and the chicken rules mop up whatever holds a
// verdict but no longer holds a pipeline claim.
// =============================================================================

import type { Lead } from './types';
import { getVisaMeta } from './types';

export interface Chip { label: string; short?: string; bg: string; fg: string; dot: string }

const OPEN_STAGES = ['cold', 'not_responding', 'hot', 'invoice_sent', 'mr_coming_soon'];
const ELIG = ['eligible', 'highly_eligible'];
const NOT_ELIG = ['not_eligible', 'others'];

// ── Visa track ───────────────────────────────────────────────────────────────
// leads.visa_type is free text with a dozen spellings of two products.
// getVisaMeta already knows how to read them all; this narrows its answer to
// the two tracks the playbook cares about. WRITES go through canonical keys
// ('gtv' | 'ifv') so the mess stops growing, while every old spelling keeps
// rendering correctly.

export type VisaTrack = 'gtv' | 'ifv';

export const VISA_TRACK_META: Record<VisaTrack, Chip> = {
  gtv: { label: 'GTV', bg: '#E0E7FF', fg: '#3730A3', dot: '#6366F1' },
  ifv: { label: 'IFV', bg: '#FEF9C3', fg: '#854D0E', dot: '#EAB308' },
};

export function visaTrackOf(lead: Pick<Lead, 'visa_type'>): VisaTrack | null {
  const m = getVisaMeta(lead.visa_type);
  if (!m) return null;
  return m.short.toLowerCase().includes('ifv') || m.short.toLowerCase().includes('innovator')
    ? 'ifv'
    : 'gtv';
}

// ── Buckets ──────────────────────────────────────────────────────────────────

export type BucketId =
  | 'needs_assessment'
  | 'hot_groom'
  | 'spotlight_groom'
  | 'nr_wtp'
  | 'nr_mwtp'
  | 'cold_wtp'
  | 'cold_mwtp'
  | 'cold_nwtp'
  | 'good_chicken'
  | 'bad_chicken'
  | 'converted'
  | 'uncovered';

export interface BucketMeta extends Chip {
  /** The play, in the owner's words. Displayed, never executed. */
  action: string;
  /** One line of why the lead is here, for the card. */
  hint: string;
}

export const BUCKET_META: Record<BucketId, BucketMeta> = {
  needs_assessment: {
    label: 'Needs assessment', short: 'Assess',
    bg: '#FEF3C7', fg: '#78350F', dot: '#F59E0B',
    action: 'Get eligibility and WTP before anything else',
    hint: 'Open lead missing eligibility, WTP, or both',
  },
  hot_groom: {
    label: 'Hot — groom', short: 'Hot',
    bg: '#FCE7F3', fg: '#831843', dot: '#EC4899',
    action: 'Groom to conversion. No offer change',
    hint: 'Assessed and in active conversation',
  },
  spotlight_groom: {
    label: 'Spotlight — groom', short: 'Spotlight',
    bg: '#FFEDD5', fg: '#7C2D12', dot: '#F97316',
    action: 'Groom to conversion. No offer change',
    hint: 'Starred by hand and fully assessed',
  },
  nr_wtp: {
    label: 'Not Responding · WTP', short: 'NR · WTP',
    bg: '#EDE9FE', fg: '#4C1D95', dot: '#7C3AED',
    action: 'Offer £1,000 discount',
    hint: 'Went quiet after Hot/Spotlight; eligible and willing to pay',
  },
  nr_mwtp: {
    label: 'Not Responding · M-WTP', short: 'NR · M-WTP',
    bg: '#EDE9FE', fg: '#4C1D95', dot: '#8B5CF6',
    action: 'Kickstart before endorsement, rest later',
    hint: 'Went quiet; Highly Eligible, unsure about paying',
  },
  cold_wtp: {
    label: 'Cold · WTP', short: 'Cold · WTP',
    bg: '#CCFBF1', fg: '#134E4A', dot: '#14B8A6',
    action: '50% before endorsement, 50% after',
    hint: 'Eligible and willing to pay, not yet warmed up',
  },
  cold_mwtp: {
    label: 'Cold · M-WTP', short: 'Cold · M-WTP',
    bg: '#CCFBF1', fg: '#134E4A', dot: '#2DD4BF',
    action: 'Kickstart before endorsement, rest later',
    hint: 'Eligible, unsure about paying',
  },
  cold_nwtp: {
    label: 'Cold · N-WTP', short: 'Cold · N-WTP',
    bg: '#DCFCE7', fg: '#14532D', dot: '#22C55E',
    action: 'Nurture. No offer yet',
    hint: 'Eligible, but says they will not pay',
  },
  good_chicken: {
    label: 'Good chicken', short: 'Good chicken',
    bg: '#DBEAFE', fg: '#1E3A8A', dot: '#3B82F6',
    action: 'Offer Innovator Founder Visa',
    hint: 'Not eligible for GTV (or Others), but willing to pay',
  },
  bad_chicken: {
    label: 'Bad chicken', short: 'Bad chicken',
    bg: '#F4F4F5', fg: '#3F3F46', dot: '#A1A1AA',
    action: 'Leave entirely. No further outreach',
    hint: 'Not eligible (or Others), and not willing to pay',
  },
  converted: {
    label: 'Converted', short: 'Converted',
    bg: '#E6F7EE', fg: '#047857', dot: '#10B981',
    action: 'Won. No action',
    hint: 'Already a client',
  },
  uncovered: {
    label: 'Not in any bucket', short: 'No bucket',
    bg: '#FFE4E6', fg: '#881337', dot: '#F43F5E',
    action: 'No rule reaches this lead — decide what to do',
    hint: 'Mostly junk that was never assessed',
  },
};

export const BUCKET_ORDER: BucketId[] = [
  'needs_assessment', 'hot_groom', 'spotlight_groom',
  'nr_wtp', 'nr_mwtp',
  'cold_wtp', 'cold_mwtp', 'cold_nwtp',
  'good_chicken', 'bad_chicken', 'converted', 'uncovered',
];

type BucketFacts = Pick<Lead, 'stage' | 'eligibility' | 'investment_readiness' | 'is_spotlight'>;

export function bucketOf(l: BucketFacts): BucketId {
  const e = l.eligibility ?? null;
  const w = l.investment_readiness ?? null;
  const s = l.stage as string;

  if (OPEN_STAGES.includes(s) && (!e || !w)) return 'needs_assessment';
  if (s === 'hot') return 'hot_groom';
  if (l.is_spotlight) return 'spotlight_groom';
  if (s === 'not_responding' && w === 'yes' && ELIG.includes(e!)) return 'nr_wtp';
  if (s === 'not_responding' && w === 'maybe' && e === 'highly_eligible') return 'nr_mwtp';
  if (s === 'cold' && ELIG.includes(e!) && w === 'yes') return 'cold_wtp';
  if (s === 'cold' && ELIG.includes(e!) && w === 'maybe') return 'cold_mwtp';
  if (s === 'cold' && ELIG.includes(e!) && w === 'no') return 'cold_nwtp';
  if (NOT_ELIG.includes(e!) && (w === 'yes' || w === 'maybe')) return 'good_chicken';
  if (NOT_ELIG.includes(e!) && w === 'no') return 'bad_chicken';
  if (s === 'won') return 'converted';
  return 'uncovered';
}

// ── Response status ──────────────────────────────────────────────────────────
// Derived from the WhatsApp conversations table, which the CRM user can read
// because both apps share one workspace. The two sets are built once per page
// load; a lead's id in `replied` beats everything except an explicit
// Not Responding stage, which is a human saying "they stopped".

export type ResponseStatus = 'replied' | 'no_reply' | 'went_quiet' | 'never_contacted';

export const RESPONSE_META: Record<ResponseStatus, Chip> = {
  replied:         { label: 'Replied',            bg: '#DCFCE7', fg: '#166534', dot: '#22C55E' },
  no_reply:        { label: 'Messaged, no reply', bg: '#FEF3C7', fg: '#92400E', dot: '#F59E0B' },
  went_quiet:      { label: 'Went quiet',         bg: '#FFEDD5', fg: '#9A3412', dot: '#F97316' },
  never_contacted: { label: 'Never contacted',    bg: '#F4F4F5', fg: '#52525B', dot: '#A1A1AA' },
};

export const RESPONSE_ORDER: ResponseStatus[] = ['replied', 'no_reply', 'went_quiet', 'never_contacted'];

export function responseOf(
  lead: Pick<Lead, 'id' | 'stage'>,
  replied: ReadonlySet<string>,
  messaged: ReadonlySet<string>,
): ResponseStatus {
  if (lead.stage === 'not_responding') return 'went_quiet';
  if (replied.has(lead.id)) return 'replied';
  if (messaged.has(lead.id)) return 'no_reply';
  return 'never_contacted';
}
