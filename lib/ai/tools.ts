// =============================================================================
// AI COO v3 — DATABASE TOOLS
// The model no longer answers from a pre-built snapshot: it queries the live
// CRM itself through these tools. Every tool is workspace-scoped, read-only,
// and returns compact JSON. This is what makes "search every note" and
// "compare any month with any month" actually cover all 4,000+ leads instead
// of the 2-3 dossiers the old keyword matcher happened to pull.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient;
type Row = Record<string, unknown>;

// ---------- helpers ----------------------------------------------------------

/** PostgREST .or() strings split on commas/parens — strip them from user terms. */
const safeTerm = (t: string) => String(t).replace(/[,()%_\\]/g, ' ').trim();

const istDay = (d: string | Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
const istMonth = (d: string | Date) => istDay(d).slice(0, 7);

function clip(s: unknown, n: number): string {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/** Fetch every row matching a built query, 1000 at a time (PostgREST page cap). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function allPages<T extends Row>(build: (from: number, to: number) => PromiseLike<any>, cap = 6000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = (await build(from, from + 999)) as { data: T[] | null; error: { message: string } | null };
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const tally = (rows: Row[], key: (r: Row) => string): Record<string, number> => {
  const t: Record<string, number> = {};
  for (const r of rows) { const k = key(r) || '(blank)'; t[k] = (t[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
};

// ---------- lead filters shared by search_leads / count_leads ----------------

interface LeadFilters {
  stage?: string[]; visa_type?: string[]; industry?: string[]; eligibility?: string[];
  investment_readiness?: string[]; source?: string; text?: string;
  created_from?: string; created_to?: string; updated_from?: string; updated_to?: string;
  follow_up_from?: string; follow_up_to?: string; has_email?: boolean; spotlight?: boolean;
}

const LEAD_COLS = 'id, full_name, phone, email, stage, visa_type, industry, eligibility, investment_readiness, source, score, is_spotlight, created_at, updated_at, next_follow_up, amount_total, amount_paid, currency, payment_status, last_form_submitted_at';

async function fetchLeads(db: DB, ws: string, f: LeadFilters, cols = LEAD_COLS): Promise<Row[]> {
  return allPages((from, to) => {
    let q = db.from('leads').select(cols).eq('workspace_id', ws).neq('is_sample', true);
    if (f.stage?.length) q = q.in('stage', f.stage);
    if (f.visa_type?.length) q = q.in('visa_type', f.visa_type);
    if (f.industry?.length) q = q.in('industry', f.industry);
    if (f.eligibility?.length) q = q.in('eligibility', f.eligibility);
    if (f.investment_readiness?.length) q = q.in('investment_readiness', f.investment_readiness);
    if (f.source) q = q.ilike('source', `%${safeTerm(f.source)}%`);
    if (f.created_from) q = q.gte('created_at', f.created_from);
    if (f.created_to) q = q.lt('created_at', f.created_to);
    if (f.updated_from) q = q.gte('updated_at', f.updated_from);
    if (f.updated_to) q = q.lt('updated_at', f.updated_to);
    if (f.follow_up_from) q = q.gte('next_follow_up', f.follow_up_from);
    if (f.follow_up_to) q = q.lt('next_follow_up', f.follow_up_to);
    if (f.spotlight !== undefined) q = q.eq('is_spotlight', f.spotlight);
    if (f.text) {
      const t = safeTerm(f.text);
      q = q.or(`full_name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t}*`);
    }
    return q.order('created_at', { ascending: false }).range(from, to);
  });
}

// ---------- tool executors ---------------------------------------------------

async function searchNotes(db: DB, ws: string, p: Row): Promise<Row> {
  const terms = (Array.isArray(p.terms) ? p.terms : [p.terms]).map((t) => safeTerm(String(t || ''))).filter(Boolean).slice(0, 12);
  if (!terms.length) return { error: 'Provide at least one search term.' };
  const limit = Math.min(Number(p.limit) || 120, 250);
  const orExpr = terms.map((t) => `body.ilike.*${t}*`).join(',');

  let q = db.from('notes')
    .select('body, created_at, lead:leads(full_name, phone, stage, visa_type, next_follow_up)')
    .eq('workspace_id', ws).or(orExpr);
  if (p.date_from) q = q.gte('created_at', String(p.date_from));
  if (p.date_to) q = q.lt('created_at', String(p.date_to));
  const { data: notes, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) return { error: error.message };

  // Meeting notes too — they often hold the "call me next month" remarks.
  let mq = db.from('meetings')
    .select('client_name, starts_at, status, notes')
    .eq('workspace_id', ws).or(terms.map((t) => `notes.ilike.*${t}*`).join(','));
  if (p.date_from) mq = mq.gte('starts_at', String(p.date_from));
  if (p.date_to) mq = mq.lt('starts_at', String(p.date_to));
  const { data: mnotes } = await mq.limit(40);

  return {
    terms, matches: (notes || []).length, meeting_note_matches: (mnotes || []).length,
    hint: (notes || []).length >= limit ? `Capped at ${limit} — narrow the date range or terms for the rest.` : undefined,
    notes: (notes || []).map((n) => {
      const l = n.lead as unknown as Row | null;
      return { lead: l?.full_name, phone: l?.phone, stage: l?.stage, visa: l?.visa_type, next_follow_up: l?.next_follow_up, note_date: n.created_at, note: clip(n.body, 320) };
    }),
    meeting_notes: (mnotes || []).map((m) => ({ client: m.client_name, meeting_at: m.starts_at, status: m.status, note: clip(m.notes, 320) })),
  };
}

async function searchLeads(db: DB, ws: string, p: Row): Promise<Row> {
  const limit = Math.min(Number(p.limit) || 60, 200);
  let rows = await fetchLeads(db, ws, p as LeadFilters);
  if (p.has_email === true) rows = rows.filter((l) => String(l.email || '').includes('@'));
  if (p.has_email === false) rows = rows.filter((l) => !String(l.email || '').includes('@'));
  return {
    total_matching: rows.length,
    showing: Math.min(limit, rows.length),
    leads: rows.slice(0, limit).map((l) => ({
      name: l.full_name, phone: l.phone, email: l.email || null, stage: l.stage,
      visa: l.visa_type, category: l.industry, eligibility: l.eligibility, wtp: l.investment_readiness,
      source: l.source, score: l.score, spotlight: l.is_spotlight || undefined,
      created: istDay(String(l.created_at)), next_follow_up: l.next_follow_up,
      fee: l.amount_total ? `${l.currency || ''} ${l.amount_total} (paid ${l.amount_paid || 0}, ${l.payment_status})` : undefined,
    })),
  };
}

async function countLeads(db: DB, ws: string, p: Row): Promise<Row> {
  const rows = await fetchLeads(db, ws, p as LeadFilters, 'id, stage, visa_type, industry, eligibility, investment_readiness, source, created_at');
  const g = String(p.group_by || 'stage');
  const key = (r: Row): string => {
    switch (g) {
      case 'month_created': return istMonth(String(r.created_at));
      case 'day_created': return istDay(String(r.created_at));
      case 'week_created': { const d = new Date(String(r.created_at)); const day = (d.getUTCDay() + 6) % 7; const mon = new Date(d.getTime() - day * 864e5); return 'wk of ' + istDay(mon); }
      default: return String(r[g] ?? '');
    }
  };
  return { total: rows.length, group_by: g, counts: tally(rows, key) };
}

async function periodMetrics(db: DB, ws: string, p: Row): Promise<Row> {
  const from = String(p.date_from || ''); const to = String(p.date_to || '');
  if (!from || !to) return { error: 'date_from and date_to are required (ISO).' };

  const [leads, pays, meets, cases, subs, notesCount, waIn, waOut] = await Promise.all([
    fetchLeads(db, ws, { created_from: from, created_to: to }, 'id, stage, visa_type, industry, source, investment_readiness, created_at'),
    allPages<Row>((a, b) => db.from('payments').select('amount, currency, status, milestone, paid_at, created_at').eq('workspace_id', ws).range(a, b)),
    allPages<Row>((a, b) => db.from('meetings').select('status, starts_at, client_name').eq('workspace_id', ws).gte('starts_at', from).lt('starts_at', to).range(a, b), 2000),
    allPages<Row>((a, b) => db.from('cases').select('client_name, visa_type, created_at').eq('workspace_id', ws).gte('created_at', from).lt('created_at', to).range(a, b), 1000),
    db.from('form_submissions').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('submitted_at', from).lt('submitted_at', to),
    db.from('notes').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('created_at', from).lt('created_at', to),
    db.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).eq('direction', 'in').gte('created_at', from).lt('created_at', to),
    db.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).eq('direction', 'out').gte('created_at', from).lt('created_at', to),
  ]);

  const paidInRange = pays.filter((x) => { const t = String(x.paid_at || x.created_at); return x.status === 'paid' && t >= from && t < to; });
  const collected: Record<string, number> = {};
  for (const x of paidInRange) { const c = String(x.currency || 'INR'); collected[c] = (collected[c] || 0) + Number(x.amount || 0); }

  return {
    period: { from, to },
    leads_created: leads.length,
    leads_by_source: tally(leads, (r) => String(r.source ?? '')),
    leads_by_stage_now: tally(leads, (r) => String(r.stage ?? '')),
    leads_by_visa: tally(leads, (r) => String(r.visa_type ?? '')),
    leads_by_wtp: tally(leads, (r) => String(r.investment_readiness ?? '')),
    form_submissions: subs.count ?? 0,
    payments_received: { count: paidInRange.length, by_currency: collected },
    meetings_in_period: { total: meets.length, by_status: tally(meets, (r) => String(r.status ?? '')) },
    new_clients_cases_opened: cases.length,
    client_names: cases.map((c) => c.client_name),
    notes_written: notesCount.count ?? 0,
    whatsapp: waIn.error || waOut.error ? 'not tracked in this database' : { received: waIn.count ?? 0, sent: waOut.count ?? 0 },
  };
}

async function getLead(db: DB, ws: string, p: Row): Promise<Row> {
  const t = safeTerm(String(p.query || ''));
  if (!t) return { error: 'Provide a name, phone or email in query.' };
  const { data: foundRaw, error } = await db.from('leads').select(LEAD_COLS + ', tags')
    .eq('workspace_id', ws)
    .or(`full_name.ilike.*${t}*,email.ilike.*${t}*,phone.ilike.*${t}*`)
    .limit(3);
  if (error) return { error: error.message };
  const found = (foundRaw || []) as unknown as Row[];
  if (!found.length) return { matches: 0, hint: `No lead matches "${t}". Try part of the name or the phone's last digits.` };

  const dossiers = [];
  for (const l of found) {
    const [{ data: notes }, { data: acts }, { data: pays }, { data: meets }, { data: cs }, { data: subs }] = await Promise.all([
      db.from('notes').select('body, created_at').eq('lead_id', l.id).order('created_at', { ascending: false }).limit(40),
      db.from('activity').select('action, meta, created_at').eq('lead_id', l.id).order('created_at', { ascending: false }).limit(25),
      db.from('payments').select('amount, currency, status, milestone, paid_at, due_date').eq('lead_id', l.id),
      db.from('meetings').select('starts_at, status, notes').eq('lead_id', l.id).order('starts_at', { ascending: false }).limit(10),
      db.from('cases').select('case_no, delivery_stage, current_phase, owner_name, target_submission_at').eq('lead_id', l.id).maybeSingle(),
      db.from('form_submissions').select('submitted_at, ad_name, form_name, is_new_lead').eq('lead_id', l.id).order('submitted_at', { ascending: false }).limit(8),
    ]);
    dossiers.push({
      ...l,
      notes: (notes || []).map((n) => ({ at: n.created_at, note: clip(n.body, 400) })),
      payments: pays || [], meetings: meets || [], case: cs || null,
      form_submissions: subs || [],
      recent_activity: (acts || []).map((a) => ({ at: a.created_at, action: a.action, meta: a.meta })),
    });
  }
  return { matches: found.length, dossiers };
}

async function searchActivity(db: DB, ws: string, p: Row): Promise<Row> {
  const limit = Math.min(Number(p.limit) || 80, 200);
  let q = db.from('activity').select('action, meta, created_at, lead:leads(full_name, phone, stage)').eq('workspace_id', ws);
  if (Array.isArray(p.actions) && p.actions.length) q = q.in('action', p.actions.map(String));
  if (p.date_from) q = q.gte('created_at', String(p.date_from));
  if (p.date_to) q = q.lt('created_at', String(p.date_to));
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
  if (error) return { error: error.message };
  return {
    matches: (data || []).length,
    activity: (data || []).map((a) => {
      const l = a.lead as unknown as Row | null;
      return { at: a.created_at, action: a.action, lead: l?.full_name, stage: l?.stage, meta: a.meta ? clip(JSON.stringify(a.meta), 160) : undefined };
    }),
  };
}

async function paymentsReport(db: DB, ws: string, p: Row): Promise<Row> {
  const rows = await allPages<Row>((a, b) =>
    db.from('payments').select('amount, currency, status, milestone, paid_at, due_date, created_at, credit_amount, credit_currency, lead:leads(full_name, visa_type)').eq('workspace_id', ws).range(a, b));
  const from = p.date_from ? String(p.date_from) : null;
  const to = p.date_to ? String(p.date_to) : null;
  const inRange = rows.filter((r) => {
    const t = String(r.paid_at || r.created_at);
    return (!from || t >= from) && (!to || t < to);
  });
  const byCur = (list: Row[]) => {
    const o: Record<string, number> = {};
    for (const r of list) { const c = String(r.currency || 'INR'); o[c] = (o[c] || 0) + Number(r.amount || 0); }
    return o;
  };
  const paid = inRange.filter((r) => r.status === 'paid');
  return {
    period: { from, to }, payments: inRange.length,
    paid: { count: paid.length, by_currency: byCur(paid) },
    pending: { count: inRange.length - paid.length, by_currency: byCur(inRange.filter((r) => r.status !== 'paid')) },
    by_milestone: tally(inRange, (r) => String(r.milestone ?? '')),
    rows: inRange.slice(0, 80).map((r) => {
      const l = r.lead as unknown as Row | null;
      return { lead: l?.full_name, amount: `${r.currency} ${r.amount}`, status: r.status, milestone: r.milestone, paid_at: r.paid_at, due: r.due_date };
    }),
  };
}

async function searchWhatsapp(db: DB, ws: string, p: Row): Promise<Row> {
  const terms = (Array.isArray(p.terms) ? p.terms : [p.terms]).map((t) => safeTerm(String(t || ''))).filter(Boolean).slice(0, 8);
  if (!terms.length) return { error: 'Provide at least one search term.' };
  let q = db.from('whatsapp_messages')
    .select('body, direction, status, created_at, lead:leads(full_name, phone, stage)')
    .eq('workspace_id', ws).or(terms.map((t) => `body.ilike.*${t}*`).join(','));
  if (p.direction) q = q.eq('direction', String(p.direction));
  if (p.date_from) q = q.gte('created_at', String(p.date_from));
  if (p.date_to) q = q.lt('created_at', String(p.date_to));
  const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.min(Number(p.limit) || 80, 150));
  if (error) return { error: error.message };
  return {
    matches: (data || []).length,
    messages: (data || []).map((m) => {
      const l = m.lead as unknown as Row | null;
      return { at: m.created_at, dir: m.direction, lead: l?.full_name, phone: l?.phone, stage: l?.stage, text: clip(m.body, 240) };
    }),
  };
}

async function listMeetings(db: DB, ws: string, p: Row): Promise<Row> {
  let q = db.from('meetings').select('client_name, client_email, starts_at, status, notes').eq('workspace_id', ws);
  if (p.date_from) q = q.gte('starts_at', String(p.date_from));
  if (p.date_to) q = q.lt('starts_at', String(p.date_to));
  if (Array.isArray(p.status) && p.status.length) q = q.in('status', p.status.map(String));
  const { data, error } = await q.order('starts_at', { ascending: false }).limit(Math.min(Number(p.limit) || 80, 200));
  if (error) return { error: error.message };
  return {
    matches: (data || []).length,
    meetings: (data || []).map((m) => ({ at: m.starts_at, client: m.client_name, email: m.client_email || undefined, status: m.status, notes: m.notes ? clip(m.notes, 200) : undefined })),
  };
}

// ---------- registry ---------------------------------------------------------

const EXECUTORS: Record<string, (db: DB, ws: string, p: Row) => Promise<Row>> = {
  search_notes: searchNotes,
  search_leads: searchLeads,
  count_leads: countLeads,
  period_metrics: periodMetrics,
  get_lead: getLead,
  search_activity: searchActivity,
  payments_report: paymentsReport,
  search_whatsapp: searchWhatsapp,
  list_meetings: listMeetings,
};

export async function runTool(db: DB, workspaceId: string, name: string, input: unknown): Promise<string> {
  const fn = EXECUTORS[name];
  if (!fn) return JSON.stringify({ error: `Unknown tool ${name}` });
  try {
    const result = await fn(db, workspaceId, (input || {}) as Row);
    let s = JSON.stringify(result);
    if (s.length > 70000) s = s.slice(0, 70000) + '…(truncated — narrow the query)';
    return s;
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message?.slice(0, 300) || 'query failed' });
  }
}

/** A short line the UI shows while a tool runs. */
export function toolStatusLabel(name: string, input: unknown): string {
  const p = (input || {}) as Row;
  switch (name) {
    case 'search_notes': return `Searching all notes for ${(Array.isArray(p.terms) ? p.terms : [p.terms]).filter(Boolean).map((t) => `"${t}"`).join(', ')}…`;
    case 'search_leads': return 'Filtering leads…';
    case 'count_leads': return `Counting leads by ${p.group_by || 'stage'}…`;
    case 'period_metrics': return `Crunching numbers for ${String(p.date_from || '').slice(0, 10)} → ${String(p.date_to || '').slice(0, 10)}…`;
    case 'get_lead': return `Pulling the full file on "${p.query}"…`;
    case 'search_activity': return 'Scanning the activity log…';
    case 'payments_report': return 'Totalling payments…';
    case 'search_whatsapp': return 'Searching WhatsApp messages…';
    case 'list_meetings': return 'Checking meetings…';
    default: return 'Looking that up…';
  }
}

// Tool definitions (JSON Schema). Dates are ISO strings; the system prompt
// tells the model to express IST days as +05:30 offsets.
const DATE = { type: 'string', description: 'ISO timestamp, e.g. 2026-10-01T00:00:00+05:30' };
const LEAD_FILTERS = {
  stage: { type: 'array', items: { type: 'string', enum: ['cold', 'warm', 'hot', 'invoice_sent', 'mr_coming_soon', 'won', 'lost', 'junk', 'not_responding'] } },
  visa_type: { type: 'array', items: { type: 'string' }, description: "e.g. ['gtv'] or ['ifv']" },
  industry: { type: 'array', items: { type: 'string', enum: ['tech', 'research', 'art', 'other', 'business', 'engineering', 'finance', 'education', 'healthcare'] } },
  eligibility: { type: 'array', items: { type: 'string', enum: ['eligible', 'highly_eligible', 'not_eligible', 'others'] } },
  investment_readiness: { type: 'array', items: { type: 'string', enum: ['yes', 'maybe', 'no'] } },
  source: { type: 'string', description: 'substring match, e.g. "Meta"' },
  text: { type: 'string', description: 'substring of name / email / phone' },
  created_from: DATE, created_to: DATE, updated_from: DATE, updated_to: DATE,
  follow_up_from: DATE, follow_up_to: DATE,
  has_email: { type: 'boolean' }, spotlight: { type: 'boolean' },
};

export const TOOL_DEFS = [
  {
    name: 'search_notes',
    description: 'Full-text search across EVERY note on EVERY lead (plus meeting notes). Use for any question about what was said, promised, or remarked — e.g. callbacks ("oct", "next month", "after diwali"), objections, follow-up intentions. Searches note text, not lead names. Terms are OR-ed; case-insensitive substrings. date_from/date_to filter when the NOTE was written.',
    input_schema: {
      type: 'object',
      properties: {
        terms: { type: 'array', items: { type: 'string' }, description: 'Substrings to look for, e.g. ["oct", "october", "next month", "20-"]. Cast a wide net — several short variants beat one exact phrase.' },
        date_from: DATE, date_to: DATE,
        limit: { type: 'number', description: 'max matches, default 120' },
      },
      required: ['terms'],
    },
  },
  {
    name: 'search_leads',
    description: 'List leads matching any combination of filters (stage, visa, category, eligibility, WTP, source, created/updated/follow-up date ranges, name/phone/email substring). Returns the total count plus up to 200 rows.',
    input_schema: { type: 'object', properties: { ...LEAD_FILTERS, limit: { type: 'number', description: 'rows to return, default 60, max 200' } } },
  },
  {
    name: 'count_leads',
    description: 'Count leads matching the filters, grouped by one dimension. Perfect for breakdowns and trends: group_by month_created gives a month-by-month series.',
    input_schema: {
      type: 'object',
      properties: { ...LEAD_FILTERS, group_by: { type: 'string', enum: ['stage', 'visa_type', 'industry', 'source', 'eligibility', 'investment_readiness', 'month_created', 'week_created', 'day_created'] } },
      required: ['group_by'],
    },
  },
  {
    name: 'period_metrics',
    description: 'Everything that happened in a date range, in one call: leads created (by source/stage/visa/WTP), form submissions, payments collected by currency, meetings by status, new clients (cases opened), notes written, WhatsApp in/out. To COMPARE two periods, call this twice (period A, then period B).',
    input_schema: { type: 'object', properties: { date_from: DATE, date_to: DATE }, required: ['date_from', 'date_to'] },
  },
  {
    name: 'get_lead',
    description: 'The complete file on one client: every field, ALL notes, payments, meetings, case, form submissions, recent activity. query = part of a name, phone or email. Returns up to 3 matches.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'search_activity',
    description: 'The system activity log (emails sent, stage changes, payments recorded, form resubmissions…). Filter by action names and date range.',
    input_schema: {
      type: 'object',
      properties: {
        actions: { type: 'array', items: { type: 'string' }, description: "e.g. ['email_sent','stage_changed','recorded_payment','form_resubmitted']" },
        date_from: DATE, date_to: DATE, limit: { type: 'number' },
      },
    },
  },
  {
    name: 'payments_report',
    description: 'Payments in a date range (by paid date, falling back to created date): paid vs pending totals by currency, by milestone, plus individual rows with client names.',
    input_schema: { type: 'object', properties: { date_from: DATE, date_to: DATE } },
  },
  {
    name: 'search_whatsapp',
    description: 'Search the text of WhatsApp messages (both directions). If this database does not expose WhatsApp tables the tool returns an error — then tell the user WhatsApp text lives in the Relay app, and answer from notes instead.',
    input_schema: {
      type: 'object',
      properties: {
        terms: { type: 'array', items: { type: 'string' } },
        direction: { type: 'string', enum: ['in', 'out'] },
        date_from: DATE, date_to: DATE, limit: { type: 'number' },
      },
      required: ['terms'],
    },
  },
  {
    name: 'list_meetings',
    description: 'Meetings in a date range, optionally by status (upcoming, completed, cancelled, no_show…), with client, stage and meeting notes.',
    input_schema: {
      type: 'object',
      properties: { date_from: DATE, date_to: DATE, status: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } },
    },
  },
];
