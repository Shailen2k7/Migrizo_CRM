// =============================================================================
// AD-FORM INTAKE — turning Meta's free-text answers into fields automation can
// read.
//
// Meta Lead Ads hand back whatever the person picked, as an ARRAY, with the
// question's own wording baked into nothing useful. "Field of expertise? Which
// area do you qualify under?" might come back as ["Technology / Digital"], or
// ["Research & Academia"], or as a single string, or empty. None of that is a
// value a queue filter, a sequence audience or a report can group by.
//
// So every intake answer is stored TWICE, on purpose:
//
//   * DERIVED  — leads.industry ('tech' | 'research' | ...) and
//                leads.investment_readiness ('yes' | 'maybe' | 'no').
//                Clean enums. This is what automation reads.
//   * RAW      — leads.intake jsonb, the answer exactly as the person gave it.
//                Nothing is ever lost to a mapping bug, the drawer shows the
//                real words to the caller, and a new form question lands here
//                with no migration at all.
//
// The SQL mirror of these two mappers lives in migration 050 as
// public.map_expertise() / public.map_readiness(). Keep the two in step — same
// arrangement as normalizePhone and whatsapp_normalize_phone.
// =============================================================================

import type { Industry } from '@/lib/types';

export type Readiness = 'yes' | 'maybe' | 'no';

/**
 * Meta sends arrays. Make sometimes flattens them to a comma-joined string, and
 * sometimes hands over the literal "[]" of an empty answer. Take all of it.
 */
export function flattenAnswer(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const joined = v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
    return joined || null;
  }
  const s = String(v).trim();
  if (!s || s === '[]' || s === '{}' || s === 'null' || s === 'undefined') return null;
  // A JSON array that arrived as text, e.g. '["Technology"]'.
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return flattenAnswer(parsed);
    } catch { /* not JSON, fall through and use the string as-is */ }
  }
  return s;
}

// ---------------------------------------------------------------------------
// EXPERTISE -> industry
//
// Order matters. The first bucket whose keywords appear wins, so the more
// specific readings are tried before the ones that would swallow them:
// "fintech" must reach finance before "tech" claims it, and "biotech" must
// reach healthcare first. Anything unrecognised returns null rather than
// 'other', because a null means "nobody has said" while 'other' means
// "someone looked and it fits nothing" — two different facts.
// ---------------------------------------------------------------------------
const EXPERTISE_RULES: [Industry, RegExp][] = [
  ['finance',     /fintech|finance|financial|banking|\bbank\b|investment|investor|accounting|accountant|actuar|insurtech|trading/],
  ['healthcare',  /biotech|healthtech|medtech|health|medical|medicine|clinical|clinician|doctor|physician|surgeon|nurse|pharma|dental|psychiat|biomed/],
  ['research',    /research|academi|academic|scientist|science|scientific|\bphd\b|post.?doc|professor|lecturer.*(univers|research)|fellowship|peer.?review|\br\s*&\s*d\b|laborator/],
  ['art',         /\barts?\b|artist|culture|cultural|creative|design(?!.*engineer)|film|cinema|music|fashion|architect|photograph|theatre|theater|dance|literature|writer|author|curator/],
  ['education',   /education|edtech|teaching|teacher|tutor|training|pedagog|school|curriculum/],
  ['engineering', /mechanical|civil engineer|electrical|aerospace|manufactur|hardware|robotic|automotive|chemical engineer|structural/],
  ['tech',        /\btech\b|technolog|digital|software|\bit\b|information technology|\bai\b|artificial intelligence|machine learning|\bml\b|data scien|data engineer|developer|programmer|\bsaas\b|cyber|security|cloud|devops|blockchain|web3|product manag|\bux\b|\bui\b|startup founder.*tech/],
  ['business',    /business|management|marketing|\bsales\b|consult|entrepreneur|founder|operations|\bhr\b|human resources|strategy|commerce|retail|logistics|supply chain/],
  ['other',       /^other$|not listed|none of|prefer not/],
];

/** Free-text expertise answer -> a clean industry key, or null when unreadable. */
export function mapExpertise(raw: unknown): Industry | null {
  const s = flattenAnswer(raw);
  if (!s) return null;
  const t = s.toLowerCase();
  for (const [industry, re] of EXPERTISE_RULES) {
    if (re.test(t)) return industry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// INVESTMENT READINESS -> yes / maybe / no
//
// Three tiers, and the order is the whole trick.
//
// An unambiguous refusal goes first, because "I cannot afford it" and "I have
// no budget" both contain words that also appear in hesitation, and those are
// settled answers, not wavering ones.
//
// MAYBE goes second, ahead of the looser NO patterns, because "not sure" and
// "not right now" both contain "not". Read those as a refusal and you retire a
// lead who was only hesitating. On a paid ad form hesitation is the biggest of
// the three groups and by far the most worth calling, so it gets first claim on
// the ambiguous wording.
// ---------------------------------------------------------------------------
const READINESS_RULES: [Readiness, RegExp][] = [
  ['no',    /not willing|not interested|not looking|unwilling|can.?t afford|cannot afford|no budget|don.?t want|do not want|never|without pay|only.*free|want.*free/],
  ['maybe', /maybe|depend|not sure|unsure|perhaps|possibly|not right now|not now|need more|more info|more detail|budget|afford|think about|thinking|consider|explore|discuss|know more|tell me more/],
  ['no',    /^no\b|^nope/],
  ['yes',   /\byes\b|willing|ready|prepared to|happy to|absolutely|definitely|of course|sure|certainly|interested|open to|will invest|can invest|agree/],
];

/** Free-text readiness answer -> 'yes' | 'maybe' | 'no', or null when unreadable. */
export function mapReadiness(raw: unknown): Readiness | null {
  const s = flattenAnswer(raw);
  if (!s) return null;
  const t = s.toLowerCase();
  for (const [readiness, re] of READINESS_RULES) {
    if (re.test(t)) return readiness;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display metadata. A traffic light, because that is how a caller reads it in
// the half second before the phone connects.
// ---------------------------------------------------------------------------
export const READINESS_META: Record<Readiness, { label: string; short: string; bg: string; fg: string; dot: string }> = {
  yes:   { label: 'Willing to invest', short: 'Yes',   bg: '#DCFCE7', fg: '#166534', dot: '#16A34A' },
  maybe: { label: 'Undecided',         short: 'Maybe', bg: '#FAEEDA', fg: '#854F0B', dot: '#F59E0B' },
  no:    { label: 'Not willing',       short: 'No',    bg: '#FCEBEB', fg: '#A32D2D', dot: '#EF4444' },
};

export const READINESS_LIST: Readiness[] = ['yes', 'maybe', 'no'];

export function getReadinessMeta(v: string | null | undefined) {
  if (!v) return null;
  return READINESS_META[v as Readiness] || null;
}

// ---------------------------------------------------------------------------
// The raw intake bag, rendered generically so a question added to the Meta form
// tomorrow shows up in the drawer without anyone touching this file.
// ---------------------------------------------------------------------------
const INTAKE_LABELS: Record<string, string> = {
  expertise: 'Field of expertise',
  investment_readiness: 'Readiness to invest',
  timeline: 'Timeline',
  country: 'Country',
  current_role: 'Current role',
};

export function intakeLabel(key: string): string {
  return INTAKE_LABELS[key] || key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface IntakeEntry { key: string; label: string; value: string }

/** leads.intake -> a printable list, empty when the lead did not come from a form. */
export function intakeEntries(intake: unknown): IntakeEntry[] {
  if (!intake || typeof intake !== 'object' || Array.isArray(intake)) return [];
  return Object.entries(intake as Record<string, unknown>)
    .map(([key, v]) => ({ key, label: intakeLabel(key), value: flattenAnswer(v) || '' }))
    .filter((e) => e.value !== '');
}
