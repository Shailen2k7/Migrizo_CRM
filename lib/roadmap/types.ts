// ============================================================================
// ROADMAP DATA MODEL + PARSER
// The paste box accepts the JSON block produced by the fixed Claude Max
// prompt (see ROADMAP_PROMPT.txt). The parser is deliberately tolerant:
// it strips ```json fences, smart quotes, and leading commentary, then
// validates hard so a bad paste fails with a clear message — never a
// half-rendered roadmap.
// ============================================================================

export interface RoadmapWeek {
  week: string;   // "Week 1–2" — free text, fully editable
  task: string;   // what the client must do
  why: string;    // which criterion / purpose it serves (optional, may be '')
}

export interface RoadmapData {
  client_name: string;
  route: string;               // e.g. "Digital Technology (Tech Nation)"
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

/** Strip fences, smart quotes and surrounding chatter, then locate the JSON object. */
function cleanRaw(raw: string): string {
  let s = raw.trim();
  s = s.replace(/```json/gi, '').replace(/```/g, '');
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) throw new Error('No JSON object found. Paste the full block starting with { and ending with }.');
  return s.slice(first, last + 1);
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(asStr).filter(Boolean) : []);

/** Parse + validate a pasted block into RoadmapData. Throws Error with a human message. */
export function parseRoadmap(raw: string): RoadmapData {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(cleanRaw(raw));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('No JSON')) throw e;
    throw new Error('The pasted text is not valid JSON. Copy the complete block from Claude and try again.');
  }

  const data: RoadmapData = {
    client_name: asStr(obj.client_name),
    route: asStr(obj.route),
    grade: asStr(obj.grade),
    assessment: asStr(obj.assessment),
    evidence_score: asStr(obj.evidence_score),
    timeline: asStr(obj.timeline),
    strengths: asList(obj.strengths),
    gaps: asList(obj.gaps),
    priority_actions: asList(obj.priority_actions),
    publications: asList(obj.publications),
    speaking: asList(obj.speaking),
    red_flags: asList(obj.red_flags),
    roadmap: Array.isArray(obj.roadmap)
      ? (obj.roadmap as unknown[]).map((r) => {
          const row = (r || {}) as Record<string, unknown>;
          return { week: asStr(row.week), task: asStr(row.task), why: asStr(row.why) };
        }).filter((r) => r.week || r.task)
      : [],
  };

  const missing = REQUIRED_STRINGS.filter((k) => !data[k]);
  if (missing.length) throw new Error(`Missing required field(s): ${missing.join(', ')}. Use the fixed prompt so Claude returns the exact format.`);
  if (data.roadmap.length === 0) throw new Error('The "roadmap" array is empty — the block must contain at least one week with a task.');
  if (data.gaps.length === 0 && data.priority_actions.length === 0) throw new Error('Both "gaps" and "priority_actions" are empty — this looks like an incomplete analysis.');

  // Normalise obvious noise
  for (const k of LIST_FIELDS) (data[k] as string[]).splice(30); // hard cap, keeps template sane
  data.roadmap.splice(16);
  return data;
}

/** A tiny helper for showing the JSON back (edited data → block the user could re-save). */
export function roadmapToJson(data: RoadmapData): string {
  return JSON.stringify(data, null, 2);
}
