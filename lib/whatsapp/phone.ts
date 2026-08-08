// =============================================================================
// PHONE NORMALISATION — TypeScript mirror of public.whatsapp_normalize_phone().
//
// Keep the two in step. The SQL version is the source of truth for stored data
// and for matching leads on inbound; this one exists so the UI can validate
// before we bother the API, and so the adapter can split into the two fields
// Interakt actually wants.
//
// Interakt takes countryCode and phoneNumber SEPARATELY:
//   { countryCode: "+91", phoneNumber: "9820144518" }
// It does NOT take a single E.164 string, and the national part must have no
// leading zero. This is the single most common way the integration breaks.
// =============================================================================

/** Free-text phone -> E.164 digits, no "+". Returns null when unusable. */
export function normalizePhone(raw: string | null | undefined, defaultCc = '91'): string | null {
  if (!raw) return null;
  const s = String(raw).trim();

  let d = s.replace(/[^0-9]/g, '');
  if (!d) return null;

  // Did the writer already tell us this is international? A leading "+" or a
  // "00" trunk prefix means the country code is ALREADY on the front, so we
  // must not add one. Without this a Singapore number (+65 8123 4567 -> ten
  // digits) gets read as an Indian national number and silently becomes
  // 916581234567 — a real number belonging to someone else.
  const international = s.startsWith('+') || d.startsWith('00');

  if (d.startsWith('00')) d = d.slice(2);
  while (d.startsWith('0')) d = d.slice(1);
  if (!d) return null;

  // Only a bare national number gets the default country code.
  if (!international && d.length === 10) d = defaultCc + d;

  if (d.length < 8 || d.length > 15) return null;
  return d;
}

// Country codes we realistically see. Longest-prefix match wins, so 1 must be
// tried after 1xxx-style NANP-adjacent codes are ruled out — hence the sort.
const CC = [
  '91',   // India
  '44',   // UK
  '1',    // US / Canada
  '971',  // UAE
  '65',   // Singapore
  '61',   // Australia
  '49',   // Germany
  '33',   // France
  '31',   // Netherlands
  '353',  // Ireland
  '41',   // Switzerland
  '46',   // Sweden
  '47',   // Norway
  '45',   // Denmark
  '351',  // Portugal
  '34',   // Spain
  '39',   // Italy
  '81',   // Japan
  '82',   // South Korea
  '86',   // China
  '852',  // Hong Kong
  '60',   // Malaysia
  '66',   // Thailand
  '64',   // New Zealand
  '27',   // South Africa
  '234',  // Nigeria
  '254',  // Kenya
  '20',   // Egypt
  '966',  // Saudi Arabia
  '974',  // Qatar
  '973',  // Bahrain
  '968',  // Oman
  '880',  // Bangladesh
  '94',   // Sri Lanka
  '977',  // Nepal
  '92',   // Pakistan
].sort((a, b) => b.length - a.length);

export interface SplitPhone {
  /** With the leading plus, e.g. "+91" — Interakt's countryCode field. */
  countryCode: string;
  /** National number, no leading zero, e.g. "9820144518". */
  phoneNumber: string;
  /** Full E.164 digits with no plus, e.g. "919820144518" — what we store. */
  e164: string;
}

/**
 * Split stored E.164 digits into the two fields Interakt wants.
 * Falls back to the default country code when no known prefix matches, which
 * keeps Indian numbers working even if the list above misses something.
 */
export function splitPhone(
  e164OrRaw: string | null | undefined,
  defaultCc = '91'
): SplitPhone | null {
  const e164 = normalizePhone(e164OrRaw, defaultCc);
  if (!e164) return null;

  for (const cc of CC) {
    if (e164.startsWith(cc) && e164.length - cc.length >= 6) {
      return { countryCode: `+${cc}`, phoneNumber: e164.slice(cc.length), e164 };
    }
  }

  // Unknown prefix: assume the default CC is already on the front if it fits,
  // otherwise hand the whole thing over as the national part.
  if (e164.startsWith(defaultCc)) {
    return {
      countryCode: `+${defaultCc}`,
      phoneNumber: e164.slice(defaultCc.length),
      e164,
    };
  }
  return { countryCode: `+${defaultCc}`, phoneNumber: e164, e164 };
}

/** "919820144518" -> "+91 98201 44518" for display. */
export function prettyPhone(e164: string | null | undefined): string {
  const s = splitPhone(e164);
  if (!s) return e164 || '—';
  const n = s.phoneNumber;
  if (s.countryCode === '+91' && n.length === 10) {
    return `${s.countryCode} ${n.slice(0, 5)} ${n.slice(5)}`;
  }
  return `${s.countryCode} ${n}`;
}
