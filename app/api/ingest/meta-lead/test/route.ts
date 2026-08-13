// =============================================================================
// INTAKE TEST BENCH — POST /api/ingest/meta-lead/test
//
// The dry-run twin of the real ingest. A logged-in campaign admin pastes the
// exact body Make would send (no token needed — the session is the auth) and
// gets back the full trace: which key each answer was found under, what it
// flattened to, which rule fired, what the lead WOULD be tagged, and whether
// it would create or enrich. NOTHING is written, ever.
//
// This exists because "works for some leads, not others" was diagnosed in a
// SQL editor twice. Now it is a screen: /intake-test.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { flattenAnswer, traceExpertise, traceReadiness, detectAnswers } from '@/lib/intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORE_KEYS = new Set(['token', 'full_name', 'phone', 'email', 'visa_type', 'source']);

export async function POST(req: Request) {
  // ---- auth: a logged-in campaign admin, not the ingest token ---------------
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  const { data: member } = await supabase.from('workspace_members')
    .select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: member.workspace_id });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json', detail: 'That is not valid JSON — paste the body exactly as Make sends it.' }, { status: 400 });
  }

  // ---- the same pipeline the real ingest runs, narrated ---------------------
  const fields = Object.entries(body)
    .filter(([k]) => k !== 'token')
    .map(([k, v]) => ({ key: k, raw: typeof v === 'string' ? v : JSON.stringify(v), flattened: flattenAnswer(v) }));

  const detected = detectAnswers(body, CORE_KEYS);
  const exp = traceExpertise(detected.expertiseRaw);
  const rdy = traceReadiness(detected.readinessRaw);

  const fullName = String(body.full_name ?? '').trim();
  const phone = String(body.phone ?? '').trim() || null;

  // Would this create a new lead, or enrich an existing one?
  let dedupe: { duplicate: boolean; existing?: { id: string; full_name: string; industry: string | null; investment_readiness: string | null } } = { duplicate: false };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (phone && url && key) {
    const admin = createAdmin(url, key, { auth: { persistSession: false } });
    const { data: existing } = await admin.from('leads')
      .select('id, full_name, industry, investment_readiness')
      .eq('workspace_id', member.workspace_id).eq('phone', phone).limit(1);
    if (existing?.length) dedupe = { duplicate: true, existing: existing[0] };
  }

  const problems: string[] = [];
  if (!fullName) problems.push('full_name is missing — the real endpoint would reject this with 400 missing_name.');
  if (!detected.expertiseRaw) problems.push('No expertise answer found under ANY key — check the Make mapping for this ad form.');
  else if (!exp.value) problems.push(`Expertise "${exp.raw}" matched no rule — the lead would arrive with Industry "Not set". Send me this exact wording and I will add it.`);
  if (!detected.readinessRaw) problems.push('No readiness answer found under any key — check the Make mapping.');
  else if (!rdy.value) problems.push(`Readiness "${rdy.raw}" matched no rule — Can invest would stay unset.`);

  return NextResponse.json({
    ok: true,
    dry_run: true,
    fields,
    expertise: { found_under: detected.expertiseFrom, ...exp },
    readiness: { found_under: detected.readinessFrom, ...rdy },
    would: {
      action: !fullName ? 'reject (missing_name)' : dedupe.duplicate ? 'enrich existing lead' : 'create new lead',
      stage: 'cold',
      industry: exp.value,
      investment_readiness: rdy.value,
      existing: dedupe.existing ?? null,
    },
    problems,
  });
}
