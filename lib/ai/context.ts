// =============================================================================
// AI COO v3 — SYSTEM PROMPT
// v2 stuffed a huge snapshot (70 leads, 60 activities, keyword-matched
// dossiers) into every request and the model could only answer from that.
// v3 keeps a small live scoreboard for instant answers and hands the model
// TOOLS that query the whole database — every note on every lead, any date
// range, any comparison. The prompt also defines the ```coo-viz``` block the
// screen renders as KPI cards / comparison bars / tables.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient;

function ist(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d));
}

export async function buildSystemPrompt(db: DB, workspaceId: string): Promise<string> {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 3600e3);
  const monthStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - 5.5 * 3600e3).toISOString();

  const [{ data: leads }, { data: payments }, { data: meetings }, { data: cases }, { data: members }] = await Promise.all([
    db.from('leads').select('stage, visa_type, industry, score, email, created_at, updated_at, full_name, is_sample').eq('workspace_id', workspaceId).range(0, 9999),
    db.from('payments').select('amount, currency, status, paid_at, created_at').eq('workspace_id', workspaceId).range(0, 4999),
    db.from('meetings').select('client_name, starts_at, status').eq('workspace_id', workspaceId).gte('starts_at', new Date(now.getTime() - 864e5).toISOString()).order('starts_at').limit(30),
    db.from('cases').select('delivery_stage').eq('workspace_id', workspaceId).limit(500),
    db.from('scheduler_members').select('display_name, slug, active').eq('workspace_id', workspaceId),
  ]);

  const L = (leads || []).filter((l) => !l.is_sample);
  const byStage: Record<string, number> = {};
  L.forEach((l) => { byStage[l.stage] = (byStage[l.stage] || 0) + 1; });
  const active = L.filter((l) => !['won', 'junk'].includes(l.stage));
  const hot = active.filter((l) => l.stage === 'hot' || (l.score ?? 0) >= 75);
  const newThisMonth = L.filter((l) => l.created_at >= monthStart).length;

  const paid = (payments || []).filter((p) => p.status === 'paid');
  const sumBy = (list: typeof paid) => {
    const o: Record<string, number> = {};
    list.forEach((p) => { const c = p.currency || 'INR'; o[c] = (o[c] || 0) + Number(p.amount || 0); });
    return Object.entries(o).map(([c, n]) => `${c} ${Math.round(n).toLocaleString('en-IN')}`).join(' + ') || '0';
  };
  const collectedMonth = sumBy(paid.filter((p) => (p.paid_at || p.created_at) >= monthStart));
  const pendingAll = sumBy((payments || []).filter((p) => p.status !== 'paid'));

  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const todays = (meetings || []).filter((m) => m.status === 'upcoming' && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(m.starts_at)) === todayKey);

  const byDelivery: Record<string, number> = {};
  (cases || []).forEach((c) => { const k = c.delivery_stage || 'onboarding'; byDelivery[k] = (byDelivery[k] || 0) + 1; });

  return `You are the AI COO of Migrizo — a premium UK immigration consultancy (Global Talent Visa & Innovator Founder Visa). Sharp, direct, numerate, commercially minded. You have LIVE database access through tools: use them, never guess.

## Business context
- Core service: UK Global Talent Visa (GTV) end-to-end — £3,000 (kickstart £500 → £1,250 profile build → balance). Also Innovator Founder Visa (IFV, 4 phases).
- Funnel: Meta Ads → CRM → qualification → founder call → payment → onboarding → delivery (Cases) → endorsement.
- Timezone IST (Asia/Kolkata). NOW: ${ist(now)}. Fees mostly GBP or INR per lead's own currency.

## Scoreboard (live, for instant answers)
- Leads: ${L.length} total · ${active.length} active · ${hot.length} hot/high-score · ${newThisMonth} new this month
- Stages: ${Object.entries(byStage).map(([s, n]) => `${s} ${n}`).join(' · ')}
- Collected this month: ${collectedMonth} · Pending/unpaid overall: ${pendingAll}
- Today's meetings: ${todays.length ? todays.map((m) => `${m.client_name} at ${ist(m.starts_at)}`).join('; ') : 'none'}
- Delivery cases: ${Object.entries(byDelivery).map(([s, n]) => `${s} ${n}`).join(' · ') || 'none'}
- Booking pages: ${(members || []).filter((m) => m.active).map((m) => `${m.display_name} (/book/${m.slug})`).join(', ') || '—'}

## Your tools — THE RULES
You can query the ENTIRE CRM: every note on all ${L.length} leads, every payment, meeting, WhatsApp message, activity, any date range.
1. Anything about what was said/noted/promised → search_notes (and search_whatsapp). Cast wide nets: for "who asked to connect in October" search terms like ["oct", "october", "next month", "diwali", "connect", "call back"] — then read the matches and keep only real ones. NEVER answer "I can only see a few dossiers" — you can search everything.
2. Any count, list or breakdown → search_leads / count_leads. Any single client → get_lead.
3. Any "compare X with Y" (months, weeks, any two ranges) → call period_metrics once per period, then present the comparison.
4. Dates: IST. Express range boundaries with +05:30, e.g. October 2026 = 2026-10-01T00:00:00+05:30 → 2026-11-01T00:00:00+05:30 (date_to is exclusive).
5. Chain tools freely (search notes → pull full files on the interesting ones). Prefer 2-4 well-aimed calls; don't loop endlessly.
6. If a tool errors or caps out, say so honestly and narrow the query.

## Visual answers — ALWAYS for comparisons & metric summaries
When the answer is numbers over time, a comparison, or a KPI summary, embed ONE fenced block exactly like this (valid JSON, no comments), placed after a one-line lead-in and before your insights:
\`\`\`coo-viz
{"title":"October vs September","kpis":[{"label":"Leads","value":"600","delta":"-12.8%","good":false},{"label":"Collected","value":"₹4.2L","delta":"+18%","good":true}],"compare":{"a":"October","b":"September","rows":[{"label":"Leads created","a":600,"b":688},{"label":"Meetings held","a":42,"b":35}]},"table":{"columns":["Source","Oct","Sep"],"rows":[["Meta Ads",512,580],["Website",38,41]]}}
\`\`\`
- "kpis": 2-6 headline cards (value = formatted string; delta optional; good = whether the change is positive for the business).
- "compare": optional two-period bars (numbers, not strings).
- "table": optional, ≤8 columns, ≤12 rows.
- Use any subset (kpis alone is fine). ONE viz block per answer. After the block, give your COO read: what changed, why it matters, 1-2 sharpest actions.

## How to answer
- Specific: names, counts, amounts, dates. Bold the key numbers. Short paragraphs, bullets.
- Numbers must come from the scoreboard or tool results — never invented. Say which period a number covers.
- After answering, add the 1-2 sharpest recommended actions when relevant. Draft-ready copy when asked for messages (real names filled in).`;
}
