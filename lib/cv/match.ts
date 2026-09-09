// =============================================================================
// CV → LEAD MATCHING — whose CV is this?
// -----------------------------------------------------------------------------
// The parsing is the easy half. A folder of forty PDFs says nothing about who
// each one belongs to, and guessing wrong writes one person's career onto
// another person's record. So every match carries HOW it was made and how sure
// we are, and only the exact ones are allowed to save without a human looking.
//
//   email     the address in the CV equals the lead's address       → exact
//   phone     last ten digits equal                                  → exact
//   name      the CV's name line, or the filename, matches full_name → fuzzy
//
// Fuzzy never auto-saves. It is a suggestion with a dropdown next to it.
// =============================================================================

export interface LeadLite {
  id: string; full_name: string; email: string | null; phone: string | null; stage?: string | null;
}

export interface Match {
  leadId: string | null;
  leadName: string | null;
  /** 'exact' can be saved unattended; 'fuzzy' needs a person; 'none' has nobody. */
  confidence: 'exact' | 'fuzzy' | 'none';
  how: 'email' | 'phone' | 'name' | 'filename' | null;
  /** Other plausible people, for the dropdown, best first. */
  candidates: { id: string; name: string; why: string }[];
}

const last10 = (p: string | null | undefined) => {
  const d = (p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

const norm = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Filename → probable name: "Rahul_Sharma_CV_2026.pdf" → "rahul sharma". */
export function nameFromFilename(filename: string): string {
  return norm(
    filename
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\b(cv|resume|résumé|curriculum|vitae|final|new|updated|latest|copy|v\d+|20\d\d|\d+)\b/gi, ' '),
  );
}

/** Token overlap in [0,1]: how much of the shorter name appears in the longer. */
function nameScore(a: string, b: string): number {
  const ta = norm(a).split(' ').filter((t) => t.length > 1);
  const tb = norm(b).split(' ').filter((t) => t.length > 1);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const hit = short.filter((t) => long.includes(t)).length;
  return hit / short.length;
}

export function matchLead(
  leads: LeadLite[],
  found: { emails: string[]; phones: string[]; nameGuess: string | null },
  filename: string,
): Match {
  const none: Match = { leadId: null, leadName: null, confidence: 'none', how: null, candidates: [] };

  // 1. email — the strongest signal there is.
  for (const e of found.emails) {
    const hit = leads.find((l) => (l.email || '').toLowerCase() === e);
    if (hit) return { leadId: hit.id, leadName: hit.full_name, confidence: 'exact', how: 'email', candidates: [] };
  }

  // 2. phone — last ten digits, so "+91 98108 27787" and "9810827787" agree.
  for (const p of found.phones) {
    const want = last10(p);
    if (!want) continue;
    const hit = leads.find((l) => last10(l.phone) === want);
    if (hit) return { leadId: hit.id, leadName: hit.full_name, confidence: 'exact', how: 'phone', candidates: [] };
  }

  // 3. name — from the CV's own first line, then the filename. Never exact.
  const guesses: { text: string; how: 'name' | 'filename' }[] = [];
  if (found.nameGuess) guesses.push({ text: found.nameGuess, how: 'name' });
  const fromFile = nameFromFilename(filename);
  if (fromFile.split(' ').length >= 2) guesses.push({ text: fromFile, how: 'filename' });

  const scored: { lead: LeadLite; score: number; how: 'name' | 'filename' }[] = [];
  for (const g of guesses) {
    for (const l of leads) {
      const s = nameScore(g.text, l.full_name);
      if (s >= 0.5) scored.push({ lead: l, score: s, how: g.how });
    }
  }
  if (!scored.length) return none;

  // Best per lead, then best overall.
  const best = new Map<string, { lead: LeadLite; score: number; how: 'name' | 'filename' }>();
  for (const s of scored) {
    const cur = best.get(s.lead.id);
    if (!cur || s.score > cur.score) best.set(s.lead.id, s);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  const top = ranked[0];

  return {
    leadId: top.lead.id,
    leadName: top.lead.full_name,
    confidence: 'fuzzy',
    how: top.how,
    candidates: ranked.map((r) => ({
      id: r.lead.id, name: r.lead.full_name,
      why: `${Math.round(r.score * 100)}% name match${r.lead.stage ? ` · ${r.lead.stage}` : ''}`,
    })),
  };
}
