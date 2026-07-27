// ============================================================================
// QUEUE AI SCORING — POST /api/queue/score
//
// Once a morning, Claude reads today's queue and returns, for each lead, a
// 0-100 likelihood score and a one-line brief telling the rep what they're
// walking into ("Replied once about timelines, then never followed up").
//
// Cost control: ONE batched call for the whole queue, results cached on the
// lead (ai_score / ai_brief / ai_scored_at) and re-used for 7 days. Scoring
// 160 leads costs a single request, not 160.
//
// If the API key is missing or the call fails, the queue still works — leads
// simply show no score. The AI is an enhancement, never a dependency.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CACHE_DAYS = 7;
const BATCH_MAX = 60;

interface Scored { id: string; score: number; brief: string }

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!apiKey) return NextResponse.json({ ok: true, scored: 0, reason: 'no_api_key' });

  let body: { workspaceId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }
  if (!body.workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - CACHE_DAYS);

  // Today's pending queue for this user, only leads not scored recently.
  const { data: rows } = await supabase
    .from('lead_queue')
    .select('lead_id, leads!inner(id, full_name, stage, source, visa_type, last_note, attempt_count, last_touched_at, created_at, ai_scored_at)')
    .eq('workspace_id', body.workspaceId)
    .eq('user_id', user.id)
    .eq('day', new Date().toISOString().slice(0, 10))
    .eq('status', 'pending')
    .limit(BATCH_MAX);

  type LeadRow = {
    id: string; full_name: string; stage: string; source: string | null;
    visa_type: string | null; last_note: string | null; attempt_count: number | null;
    last_touched_at: string | null; created_at: string | null; ai_scored_at: string | null;
  };
  const leads: LeadRow[] = (rows || [])
    .map((r) => (r as unknown as { leads: LeadRow }).leads)
    .filter((l): l is LeadRow => !!l)
    .filter((l) => !l.ai_scored_at || new Date(l.ai_scored_at) < cutoff);

  if (leads.length === 0) return NextResponse.json({ ok: true, scored: 0 });

  const daysSince = (d: string | null) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;

  const payload = leads.map((l) => ({
    id: l.id,
    name: l.full_name,
    stage: l.stage,
    source: l.source || 'unknown',
    interest: l.visa_type || 'unspecified',
    attempts: l.attempt_count || 0,
    days_since_contact: daysSince(l.last_touched_at),
    days_since_enquiry: daysSince(l.created_at),
    last_note: l.last_note || null,
  }));

  const system = `You score cold immigration-consultancy leads for a UK visa firm and write a one-line brief for the sales rep who is about to call them.

For each lead return:
- "score": 0-100, the likelihood this lead converts if contacted well today. Weigh: prior engagement (a lead who ever replied or left a note is far more promising than one who never responded), source quality (referral and LinkedIn outperform paid social), how many attempts have already failed (more failures = lower), how long since enquiry (very old with no engagement = lower), and stage.
- "brief": ONE sentence, max 25 words, telling the rep what they're walking into and what to try. Be concrete and use the lead's actual history. No greetings, no filler, never invent facts that aren't in the data.

Return ONLY a JSON array like [{"id":"...","score":72,"brief":"..."}]. No markdown, no prose, no code fences.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    });
    if (!res.ok) return NextResponse.json({ ok: true, scored: 0, reason: 'api_error' });

    const data = await res.json();
    const text = (data.content || [])
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text).join('');
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed: Scored[];
    try { parsed = JSON.parse(clean); } catch { return NextResponse.json({ ok: true, scored: 0, reason: 'parse_failed' }); }
    if (!Array.isArray(parsed)) return NextResponse.json({ ok: true, scored: 0, reason: 'bad_shape' });

    const now = new Date().toISOString();
    const valid = new Set(leads.map((l) => l.id));
    let n = 0;
    for (const s of parsed) {
      if (!s?.id || !valid.has(s.id)) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(s.score) || 0)));
      await supabase.from('leads').update({
        ai_score: score,
        ai_brief: typeof s.brief === 'string' ? s.brief.slice(0, 300) : null,
        ai_scored_at: now,
      }).eq('id', s.id);
      n++;
    }
    return NextResponse.json({ ok: true, scored: n });
  } catch {
    return NextResponse.json({ ok: true, scored: 0, reason: 'exception' });
  }
}
