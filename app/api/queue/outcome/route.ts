// ============================================================================
// QUEUE OUTCOME — POST /api/queue/outcome
//
// Recording an outcome is what keeps the whole engine turning. Each choice
// routes the lead somewhere different:
//
//   interested_hot  → becomes a hot lead, handed to whoever takes hot leads
//   interested_cold → keen but still deciding; stays cold, keeps its place in
//                     the rotation so the rep keeps following up
//   not_now    → sleeps 30 days, then rejoins the rotation
//   no_answer  → attempt counter rises, back in the pool for its next turn
//   dead       → retired permanently, stops clogging the queue
//
// A lead that has failed 6 attempts retires itself, so unreachable numbers
// don't eat the team's day forever.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SNOOZE_DAYS = 30;
const MAX_ATTEMPTS = 6;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { queueId?: string; outcome?: string; note?: string; stage?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  const { queueId, outcome, note, stage } = body;
  if (!queueId || !outcome) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  if (!['interested_hot', 'interested_cold', 'not_now', 'no_answer', 'dead'].includes(outcome)) {
    return NextResponse.json({ error: 'Unknown outcome' }, { status: 400 });
  }

  // Load the queue row (RLS guarantees it belongs to this user).
  const { data: q, error: qErr } = await supabase
    .from('lead_queue')
    .select('id, lead_id, workspace_id, user_id')
    .eq('id', queueId)
    .single();
  if (qErr || !q) return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });

  const { data: lead } = await supabase
    .from('leads')
    .select('id, stage, attempt_count')
    .eq('id', q.lead_id)
    .single();
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const now = new Date().toISOString();
  const attempts = (lead.attempt_count || 0) + 1;

  // Every outcome counts as a touch — this is what drives the rotation.
  const patch: Record<string, unknown> = { last_touched_at: now, attempt_count: attempts };

  if (outcome === 'interested_hot') {
    // Ready to move. Promote to hot and hand to whoever takes hot leads. This
    // CRM's stages are hot/cold/mr_coming_soon/invoice_sent/won/junk — 'hot'
    // is the only valid promotion target here, whatever the client sends.
    void stage;
    patch.stage = 'hot';
    patch.snooze_until = null;
    const { data: hotOwner } = await supabase
      .from('lead_queue_rules')
      .select('user_id')
      .eq('workspace_id', q.workspace_id)
      .eq('takes_hot', true)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    patch.owner_id = hotOwner?.user_id || q.user_id;
  } else if (outcome === 'interested_cold') {
    // Keen but still deciding. The discussion is live, so the lead STAYS cold
    // and keeps its place in the rotation — recording the touch (already in
    // patch) is enough to move it to the back of the queue for a natural
    // follow-up on its next turn. Stage unchanged, not retired, not snoozed,
    // and it stays with the same rep who is having the conversation.
    void stage;
    patch.owner_id = q.user_id;
  } else if (outcome === 'not_now') {
    const wake = new Date(); wake.setDate(wake.getDate() + SNOOZE_DAYS);
    patch.snooze_until = wake.toISOString();
    patch.owner_id = q.user_id;
  } else if (outcome === 'no_answer') {
    // Straight back into the pool. Auto-retire once it's clearly unreachable.
    // (Retirement alone removes it from rotation; the stage stays 'cold'.)
    if (attempts >= MAX_ATTEMPTS) {
      patch.retired_at = now;
    }
  } else if (outcome === 'dead') {
    // Not interested / wrong number — retire permanently and mark junk, which
    // is this CRM's real stage for exactly that.
    patch.retired_at = now;
    patch.stage = 'junk';
  }

  const { error: upErr } = await supabase.from('leads').update(patch).eq('id', q.lead_id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error: qUpErr } = await supabase
    .from('lead_queue')
    .update({ status: 'done', outcome, note: note?.trim() || null, completed_at: now })
    .eq('id', queueId);
  if (qUpErr) return NextResponse.json({ error: qUpErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    promoted: outcome === 'interested_hot',
    retired: !!patch.retired_at,
    attempts,
  });
}
