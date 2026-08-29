// =============================================================================
// AI COO — CONTEXT ENGINE
// Assembles a complete, current snapshot of the ENTIRE system for the model:
// pipeline, revenue, meetings, campaigns, cases, delivery stages, activity —
// plus deep "dossiers" on any lead the user's question mentions (matched by
// name / email / phone), so answers about specific clients are precise.
// =============================================================================
import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient;

const GBP = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

function ist(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d));
}

/** Words worth matching against lead names/emails/phones. */
function entityTokens(question: string): string[] {
  const stop = new Set(['the','and','for','with','this','that','what','who','when','where','how','why','tell','about','show','give','list','all','any','can','you','please','lead','leads','client','clients','meeting','meetings','email','emails','campaign','pipeline','today','week','month','status','update','details','everything','info','information']);
  return Array.from(new Set(
    (question.match(/[A-Za-z@.+0-9]{3,}/g) || [])
      .map((w) => w.toLowerCase())
      .filter((w) => !stop.has(w) && w.length >= 3)
  )).slice(0, 12);
}

export async function buildSystemPrompt(db: DB, workspaceId: string, question: string): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { data: leads }, { data: payments }, { data: meetings }, { data: members },
    { data: cases }, { data: campaigns }, { data: activity },
  ] = await Promise.all([
    db.from('leads').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).range(0, 9999),
    db.from('payments').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).range(0, 4999),
    db.from('meetings').select('*').eq('workspace_id', workspaceId).order('starts_at', { ascending: true }).limit(400),
    db.from('scheduler_members').select('id, display_name, slug, title, active').eq('workspace_id', workspaceId),
    db.from('cases').select('*').eq('workspace_id', workspaceId).limit(500),
    db.from('campaigns').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(30),
    db.from('activity').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(120),
  ]);

  const L = leads || [];
  const P = (payments || []).filter((p) => !L.find((l) => l.id === p.lead_id)?.hidden_from_payments);
  const M = meetings || [];
  const C = cases || [];

  // ---- pipeline & leads ----
  const byStage: Record<string, number> = {};
  L.forEach((l) => { byStage[l.stage] = (byStage[l.stage] || 0) + 1; });
  const active = L.filter((l) => !['won', 'junk'].includes(l.stage));
  const hot = active.filter((l) => l.stage === 'hot' || (l.score ?? 0) >= 75);
  const noEmail = active.filter((l) => !l.email || !l.email.includes('@')).length;
  const stale = active.filter((l) => now.getTime() - new Date(l.updated_at).getTime() > 7 * 864e5);
  const newThisMonth = L.filter((l) => l.created_at >= monthStart).length;

  // ---- revenue ----
  const paid = P.filter((p) => p.status === 'paid');
  const collected = paid.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const collectedThisMonth = paid.filter((p) => (p.paid_at || p.created_at) >= monthStart).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const pendingPay = P.filter((p) => p.status !== 'paid').reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // ---- meetings ----
  const upcoming = M.filter((m) => m.status === 'upcoming' && new Date(m.starts_at) >= now);
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const todays = upcoming.filter((m) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(m.starts_at)) === todayKey);
  const mStatus: Record<string, number> = {};
  M.forEach((m) => { mStatus[m.status] = (mStatus[m.status] || 0) + 1; });

  // ---- cases / delivery ----
  const byDelivery: Record<string, number> = {};
  C.forEach((c) => { const k = (c as { delivery_stage?: string }).delivery_stage || 'onboarding'; byDelivery[k] = (byDelivery[k] || 0) + 1; });

  // ---- campaigns ----
  const campLines = (campaigns || []).slice(0, 12).map((c) =>
    `- "${c.name}" (${ist(c.created_at)}): ${c.sent_count ?? 0} sent, ${c.failed_count ?? 0} failed, ${c.total_recipients ?? 0} recipients, status ${c.status}`
  ).join('\n');

  // ---- recent activity ----
  const leadName = (id: string | null) => L.find((l) => l.id === id)?.full_name || '';
  const actLines = (activity || []).slice(0, 60).map((a) =>
    `- ${ist(a.created_at)}: ${a.action}${a.lead_id ? ` — ${leadName(a.lead_id)}` : ''}${a.meta?.email_type ? ` (${a.meta.email_type})` : ''}`
  ).join('\n');

  // ---- compact lead board (recent 70) ----
  const leadLines = L.slice(0, 70).map((l) => {
    const bits = [l.stage, l.visa_type || '', l.email ? '✉' : 'no-email', l.phone || '', `upd ${ist(l.updated_at)}`];
    return `- ${l.full_name} [${bits.filter(Boolean).join(' · ')}]`;
  }).join('\n');

  // ---- entity dossiers: deep data for anyone the question mentions ----
  const tokens = entityTokens(question);
  let dossiers = '';
  if (tokens.length) {
    const matches = L.filter((l) => {
      const hay = `${l.full_name} ${l.email || ''} ${l.phone || ''}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    }).slice(0, 3);
    for (const l of matches) {
      const [{ data: notes }, { data: acts }] = await Promise.all([
        db.from('notes').select('body, created_at').eq('lead_id', l.id).order('created_at', { ascending: false }).limit(10),
        db.from('activity').select('action, meta, created_at').eq('lead_id', l.id).order('created_at', { ascending: false }).limit(15),
      ]);
      const pays = P.filter((p) => p.lead_id === l.id);
      const mtgs = M.filter((m) => m.lead_id === l.id);
      const cs = C.find((c) => c.lead_id === l.id);
      dossiers += `\n### DOSSIER: ${l.full_name}
- Stage: ${l.stage} · Visa: ${l.visa_type || '—'} · Score: ${l.score ?? '—'} · Source: ${l.source || '—'}
- Email: ${l.email || '—'} · Phone: ${l.phone || '—'}
- Created: ${ist(l.created_at)} · Last update: ${ist(l.updated_at)}${l.next_follow_up ? ` · Next follow-up: ${ist(l.next_follow_up)}` : ''}
${l.discount ? `- Deal: £${l.discount} discount, £${l.amount_total ?? 3000 - l.discount} final\n` : ''}${pays.length ? `- Payments: ${pays.map((p) => `${GBP(Number(p.amount))} ${p.status}${p.milestone ? ` (${p.milestone})` : ''}`).join('; ')}\n` : ''}${mtgs.length ? `- Meetings: ${mtgs.map((m) => `${ist(m.starts_at)} [${m.status}]${m.notes ? ` notes: ${String(m.notes).slice(0, 120)}` : ''}`).join('; ')}\n` : ''}${cs ? `- Case: delivery stage ${(cs as { delivery_stage?: string }).delivery_stage || 'onboarding'}\n` : ''}${(notes || []).length ? `- Notes:\n${(notes || []).map((n) => `  · ${ist(n.created_at)}: ${String(n.body).slice(0, 200)}`).join('\n')}\n` : ''}${(acts || []).length ? `- Recent activity:\n${(acts || []).map((a) => `  · ${ist(a.created_at)}: ${a.action}${(a.meta as { email_type?: string })?.email_type ? ` (${(a.meta as { email_type?: string }).email_type})` : ''}`).join('\n')}` : ''}\n`;
    }
  }

  return `You are the AI COO of Migrizo — a premium UK immigration consultancy (Global Talent Visa & Innovator Founder Visa). You are sharp, direct, numerate, and commercially minded: a true chief operating officer who knows every corner of the business, spots risks and opportunities, and gives specific, actionable answers.

## Business context
- Core service: UK Global Talent Visa (GTV) end-to-end — profile building, PR/media sprint, endorsement application. Standard fee £3,000 (kickstart £500 → £1,250 profile build → balance). Also Innovator Founder Visa (IFV).
- Funnel: Meta Ads → CRM → qualification → founder call → payment → onboarding → delivery (Cases board) → endorsement.
- Currency: fees in GBP unless data says otherwise. Timezone: IST (Asia/Kolkata). Now: ${ist(now)}.

## LIVE SYSTEM SNAPSHOT (real data, current as of now)
### Pipeline (${L.length} total leads · ${active.length} active · ${newThisMonth} new this month)
${Object.entries(byStage).map(([s, n]) => `- ${s}: ${n}`).join('\n')}
- Hot/high-score active: ${hot.length} · Stale >7 days: ${stale.length} · Active without email: ${noEmail}

### Revenue
- Collected all-time: ${GBP(collected)} · This month: ${GBP(collectedThisMonth)} · Pending/unpaid: ${GBP(pendingPay)}

### Meetings (${M.length} on record)
- Status: ${Object.entries(mStatus).map(([s, n]) => `${s}: ${n}`).join(', ') || 'none'}
- Today (IST): ${todays.length ? todays.map((m) => `${m.client_name} at ${ist(m.starts_at)}`).join('; ') : 'none'}
- Next upcoming: ${upcoming.slice(0, 8).map((m) => `${m.client_name} — ${ist(m.starts_at)}`).join('; ') || 'none'}
- Booking pages: ${(members || []).map((m) => `${m.display_name} (/book/${m.slug}${m.active ? '' : ', off'})`).join(', ') || 'none set up'}

### Delivery — Cases (${C.length})
${Object.entries(byDelivery).map(([s, n]) => `- ${s}: ${n}`).join('\n') || '- none'}

### Email campaigns
${campLines || '- none sent yet'}

### Recent leads (latest 70 of ${L.length})
${leadLines || '- none'}

### Recent activity (latest 60)
${actLines || '- none'}
${dossiers ? `\n## CLIENT DOSSIERS (deep data matched to this question)${dossiers}` : ''}

## How to answer
- Use the real numbers above. Never invent data. If something isn't in the snapshot, say so and suggest where to look in the CRM.
- Be specific: names, counts, amounts, dates. ("5 hot leads have no email — X, Y, Z…" beats "several leads lack emails".)
- Think like a COO: after answering, add the sharpest 1-2 recommended actions when relevant.
- When asked to draft emails or messages, produce ready-to-send copy with real names filled in.
- Format with markdown: short paragraphs, bold key numbers, bullets for lists. Keep it tight — no fluff.`;
}
