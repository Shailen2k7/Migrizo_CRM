// =============================================================================
// BOUNCE CAPTURE — POST /api/email/bounce?key=INBOUND_WEBHOOK_SECRET
// -----------------------------------------------------------------------------
// Target for a Resend webhook on `email.bounced` and `email.complained`.
// A bounced or complained address goes straight onto the suppression list, so
// no campaign or sequence can ever email it again; the next sequence tick then
// exits any live enrolment as Do Not Contact.
//
// Setup (one time, in Resend → Webhooks):
//   URL:    https://crm.migrizo.com/api/email/bounce?key=<INBOUND_WEBHOOK_SECRET>
//   Events: email.bounced, email.complained
// Reuses the existing INBOUND_WEBHOOK_SECRET — no new env var needed.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret || req.nextUrl.searchParams.get('key') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const type = String(payload.type ?? '');
  if (type !== 'email.bounced' && type !== 'email.complained') {
    return NextResponse.json({ ok: true, ignored: type || 'unknown' });
  }

  // data.to is string | string[] depending on payload version — read defensively.
  const data = (payload.data || {}) as Record<string, unknown>;
  const rawTo = data.to;
  const emails = (Array.isArray(rawTo) ? rawTo : [rawTo])
    .map((e) => String(e ?? '').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase())
    .filter((e) => e.includes('@'));
  if (emails.length === 0) return NextResponse.json({ ok: true, skipped: 'no_recipient' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const reason = type === 'email.bounced' ? 'bounce' : 'complaint';
  let suppressed = 0;

  for (const email of emails) {
    // Attribute to the lead's workspace; single-tenant fallback = first workspace.
    const { data: lead } = await admin
      .from('leads').select('workspace_id')
      .ilike('email', email)
      .order('updated_at', { ascending: false })
      .limit(1).maybeSingle();

    let wsId = lead?.workspace_id as string | undefined;
    if (!wsId) {
      const { data: ws } = await admin
        .from('workspaces').select('id')
        .order('created_at', { ascending: true })
        .limit(1).maybeSingle();
      wsId = ws?.id;
    }
    if (!wsId) continue;

    await admin.from('email_suppressions').upsert(
      { workspace_id: wsId, email, reason },
      { onConflict: 'workspace_id,email' }
    );
    suppressed++;
  }

  return NextResponse.json({ ok: true, suppressed, reason });
}
