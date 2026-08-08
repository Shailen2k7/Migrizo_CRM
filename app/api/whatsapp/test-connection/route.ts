// =============================================================================
// TEST CONNECTION — POST /api/whatsapp/test-connection
// -----------------------------------------------------------------------------
// Proves the Interakt credential works before anything else in the module is
// allowed to send. Campaign admins only. Records the outcome on
// whatsapp_settings so every screen can show connected / not connected.
//
// Optional body: { phone, displayNumber, wabaId } — saved alongside the result
// so the settings screen can persist the number in the same round trip.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { testConnection, isConfigured } from '@/lib/whatsapp/interakt';
import { normalizePhone, prettyPhone } from '@/lib/whatsapp/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const wsId = member.workspace_id as string;

  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: wsId });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  let body: { phone?: string; wabaId?: string } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  if (!isConfigured()) {
    return NextResponse.json({
      ok: false,
      reason: 'not_configured',
      detail: 'INTERAKT_API_KEY is not set. Add it in Netlify → Site settings → Environment variables, then redeploy.',
    });
  }

  const result = await testConnection();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  const phoneE164 = normalizePhone(body.phone) ?? undefined;
  await admin.from('whatsapp_settings').upsert({
    workspace_id: wsId,
    connected: result.ok,
    last_tested_at: new Date().toISOString(),
    last_test_error: result.ok ? null : `${result.code ?? 'error'}: ${result.detail ?? ''}`.slice(0, 500),
    ...(phoneE164 ? { phone_e164: phoneE164, display_number: prettyPhone(phoneE164) } : {}),
    ...(body.wabaId ? { waba_id: String(body.wabaId).trim() } : {}),
  }, { onConflict: 'workspace_id' });

  return NextResponse.json({
    ok: result.ok,
    reason: result.ok ? undefined : result.code,
    detail: result.detail,
  });
}
