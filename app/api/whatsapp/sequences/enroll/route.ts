// =============================================================================
// ENROL — POST /api/whatsapp/sequences/enroll
// -----------------------------------------------------------------------------
// The "create" half of queue-and-drain for WhatsApp sequences. Validates the
// caller, then hands the whole batch to whatsapp_sequence_enroll() in Postgres,
// which applies ONE definition of eligibility (valid number, not suppressed,
// not already enrolled) — the same definition the preview uses, so the number
// you confirmed is the number that enrols.
//
// Enrolment is deliberately manual (Shailen's call): nothing enters a sequence
// unless a human presses the button that reaches this route.
//
// Body: { sequenceId, stage?, visa?, query?, limit? }
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

  let b: { sequenceId?: string; stage?: string; visa?: string; query?: string; limit?: number } = {};
  try { b = await req.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }
  if (!b.sequenceId) {
    return NextResponse.json({ ok: false, reason: 'no_sequence' }, { status: 400 });
  }

  // The RPC runs as the LOGGED-IN user: is_campaign_admin() is checked inside
  // the function against auth.uid(), so a non-admin gets a clean refusal even
  // if they hand-craft this request.
  const { data, error } = await supabase.rpc('whatsapp_sequence_enroll', {
    p_sequence_id: b.sequenceId,
    p_stage: b.stage ?? null,
    p_visa: b.visa ?? null,
    p_query: b.query ?? null,
    p_limit: typeof b.limit === 'number' && b.limit > 0 ? Math.floor(b.limit) : null,
  });

  if (error) {
    // Function missing = migration 047 not applied. Say so instead of a 500.
    const migrationMissing = /does not exist|schema cache/i.test(error.message);
    return NextResponse.json({
      ok: false,
      reason: migrationMissing ? 'migration_047_not_applied' : error.message,
    }, { status: migrationMissing ? 500 : 400 });
  }

  const r = (data ?? {}) as { ok?: boolean; reason?: string; detail?: string; enrolled?: number };
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.reason ?? 'enroll_failed', detail: r.detail });
  }
  return NextResponse.json({ ok: true, enrolled: r.enrolled ?? 0 });
}
