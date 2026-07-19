// ============================================================================
// ROADMAP DATA MODEL + DUAL-FORMAT PARSER
// The paste box accepts EITHER format Claude produces:
//   1. The simple plain-text block (the Project's default — human-readable)
//   2. A JSON object (legacy / power users)
// The parser detects which one was pasted, is tolerant of small formatting
// noise, and validates hard so a bad paste fails with a clear message —
// never a half-rendered roadmap.
// ============================================================================

export interface RoadmapWeek {
  week: string;   // "Week 1–2" — free text, fully editable
  task: string;   // what the client must do
  why: string;    // which criterion / purpose it serves (optional, may be '')
  priority: string; // ESSENTIAL / IMPORTANT / GOOD TO HAVE (optional, may be '')
}

export interface RoadmapData {
  client_name: string;
  route: string;               // e.g. "Digital Technology (Tech Nation)"
  profile: string;              // e.g. "Employee at Infosys" or "Founder of X"
  grade: string;               // e.g. "Exceptional Talent"
  assessment: string;          // 2–4 sentence overall read
  evidence_score: string;      // e.g. "62/100"
  timeline: string;            // e.g. "8 weeks to submission-ready"
  strengths: string[];
  gaps: string[];
  priority_actions: string[];
  roadmap: RoadmapWeek[];
  publications: string[];      // optional, may be []
  speaking: string[];          // optional, may be []
  red_flags: string[];         // optional, may be []
}

const REQUIRED_STRINGS: (keyof RoadmapData)[] = ['client_name', 'route', 'grade', 'assessment', 'evidence_score', 'timeline'];
const LIST_FIELDS: (keyof RoadmapData)[] = ['strengths', 'gaps', 'priority_actions', 'publications', 'speaking', 'red_flags'];

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(asStr).filter(Boolean) : []);

// ── shared validation ───────────────────────────────────────────────────────
function validate(data: RoadmapData): RoadmapData {
  const missing = REQUIRED_STRINGS.filter((k) => !data[k]);
  if (missing.length) throw new Error(`Missing: ${missing.map((m) => m.replace('_', ' ')).join(', ')}. Paste the complete block from Claude.`);
  if (data.roadmap.length === 0) throw new Error('No roadmap weeks found — the block must contain at least one "WEEK …:" line.');
  for (const k of LIST_FIELDS) (data[k] as string[]).splice(30);
  data.roadmap.splice(16);
  return data;
}

// ── JSON path ───────────────────────────────────────────────────────────────
function parseJsonBlock(raw: string): RoadmapData {
  let s = raw.replace(/```json/gi, '').replace(/```/g, '').replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  s = s.slice(first, last + 1);
  const obj = JSON.parse(s) as Record<string, unknown>;
  return {
    client_name: asStr(obj.client_name),
    route: asStr(obj.route),
    profile: asStr(obj.profile),
    grade: asStr(obj.grade),
    assessment: asStr(obj.assessment),
    evidence_score: asStr(obj.evidence_score ?? obj.score),
    timeline: asStr(obj.timeline),
    strengths: asList(obj.strengths),
    gaps: asList(obj.gaps),
    priority_actions: asList(obj.priority_actions),
    publications: asList(obj.publications),
    speaking: asList(obj.speaking),
    red_flags: asList(obj.red_flags ?? obj.watch_outs),
    roadmap: Array.isArray(obj.roadmap)
      ? (obj.roadmap as unknown[]).map((r) => {
          const row = (r || {}) as Record<string, unknown>;
          return { week: asStr(row.week), task: asStr(row.task), why: asStr(row.why), priority: asStr(row.priority) };
        }).filter((r) => r.week || r.task)
      : [],
  };
}

// ── plain-text path ─────────────────────────────────────────────────────────
// Format (case-insensitive headers; "None" items ignored):
//   CLIENT: name              ROUTE: …    GRADE: …    SCORE: NN/100    TIMELINE: …
//   ASSESSMENT:  (lines until the next header)
//   STRENGTHS: / GAPS: / PRIORITY ACTIONS: / PUBLICATIONS: / SPEAKING: / WATCH-OUTS:
//     - bullet items ("-", "•", "*", or "1." prefixes)
//   ROADMAP:
//     WEEK 1-2: task | why      (also accepts MONTH …)
const SECTION_KEYS: Record<string, keyof RoadmapData> = {
  'STRENGTHS': 'strengths',
  'GAPS': 'gaps',
  'PRIORITY ACTIONS': 'priority_actions',
  'PRIORITIES': 'priority_actions',
  'PUBLICATIONS': 'publications',
  'RECOMMENDED PUBLICATIONS': 'publications',
  'SPEAKING': 'speaking',
  'RECOMMENDED SPEAKING': 'speaking',
  'WATCH-OUTS': 'red_flags',
  'WATCHOUTS': 'red_flags',
  'RED FLAGS': 'red_flags',
};
const SCALAR_KEYS: Record<string, keyof RoadmapData> = {
  'CLIENT': 'client_name',
  'CLIENT NAME': 'client_name',
  'ROUTE': 'route',
  'GRADE': 'grade',
  'TRACK': 'grade',
  'PROFILE': 'profile',
  'SCORE': 'evidence_score',
  'EVIDENCE SCORE': 'evidence_score',
  'TIMELINE': 'timeline',
};
const NONE_RE = /^(none|n\/a|nil|-|—)\.?$/i;
const BULLET_RE = /^\s*(?:[-•*]|\d+[.)])\s+/;
const WEEK_RE = /^\s*((?:WEEK|MONTH|DAY|PHASE)\s*[\d–\-—&,\s]+[a-z]*)\s*:\s*(.+)$/i;

function parsePlainText(raw: string): RoadmapData {
  const data: RoadmapData = {
    client_name: '', route: '', grade: '', profile: '', assessment: '', evidence_score: '', timeline: '',
    strengths: [], gaps: [], priority_actions: [], roadmap: [], publications: [], speaking: [], red_flags: [],
  };
  let section: keyof RoadmapData | 'assessment' | 'roadmap' | null = null;

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // week rows win over everything (they contain ':' too)
    const wk = line.match(WEEK_RE);
    if (wk) {
      const parts = wk[2].split('|').map((p) => p.trim());
      const task = parts[0] || '';
      const why = parts.length > 2 ? parts[1] : (parts[1] || '');
      const priority = parts.length > 2 ? parts[2] : '';
      if (task) data.roadmap.push({ week: wk[1].replace(/\s+/g, ' ').trim(), task, why, priority });
      section = 'roadmap';
      continue;
    }

    // header lines: "KEY:" or "KEY: value"
    const m = line.match(/^([A-Za-z][A-Za-z \-/]{1,28}):\s*(.*)$/);
    if (m) {
      const key = m[1].trim().toUpperCase();
      const val = m[2].trim();
      if (key in SCALAR_KEYS) { (data[SCALAR_KEYS[key]] as string) = val; section = null; continue; }
      if (key === 'ASSESSMENT') { data.assessment = val; section = 'assessment'; continue; }
      if (key in SECTION_KEYS) {
        section = SECTION_KEYS[key];
        if (val && !NONE_RE.test(val)) (data[section] as string[]).push(val.replace(BULLET_RE, ''));
        continue;
      }
      if (key === 'ROADMAP' || key === 'WEEK-BY-WEEK ROADMAP') { section = 'roadmap'; continue; }
      // Unknown "Key:" line — fall through and treat as content of the current section.
    }

    // content lines
    if (section === 'assessment') {
      data.assessment = data.assessment ? `${data.assessment} ${line}` : line;
    } else if (section && section !== 'roadmap' && Array.isArray(data[section])) {
      const item = line.replace(BULLET_RE, '').trim();
      if (item && !NONE_RE.test(item)) (data[section] as string[]).push(item);
    }
  }
  return data;
}

// ── entry point ─────────────────────────────────────────────────────────────
/** Parse a pasted block (plain text or JSON) into RoadmapData. Throws with a human message. */
export function parseRoadmap(raw: string): RoadmapData {
  const s = raw.trim();
  if (!s) throw new Error('Nothing pasted yet.');

  // JSON if it plausibly is one
  if (s.includes('{') && s.includes('}') && /"\s*client_name\s*"|"\s*roadmap\s*"/.test(s)) {
    try { return validate(parseJsonBlock(s)); }
    catch (e) { if (e instanceof Error && e.message.startsWith('Missing')) throw e; /* else fall through to text */ }
  }
  try {
    return validate(parsePlainText(s));
  } catch (e) {
    throw e instanceof Error ? e : new Error('Could not read the pasted text. Copy Claude\u2019s complete reply and paste it as-is.');
  }
}

/** Edited data → pretty JSON (for debugging / re-saving). */
export function roadmapToJson(data: RoadmapData): string {
  return JSON.stringify(data, null, 2);
}
