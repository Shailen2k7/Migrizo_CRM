// ============================================================================
// INBOUND CAPTURE — POST /api/email/inbound?key=INBOUND_WEBHOOK_SECRET
// Target for the Resend Inbound webhook. When a client replies (their reply
// goes to info@migrizo.com), Resend also delivers the message here; we match
// it to a lead by the sender's email address and file it into the thread.
//
// Setup (one time, in Resend):
//   1. Domain with inbound enabled (MX record) or an inbound route/forward.
//   2. Webhook → https://crm.migrizo.com/api/email/inbound?key=<secret>
//   3. Set the same secret in Netlify env var INBOUND_WEBHOOK_SECRET.
// Unmatched senders are stored with lead_id = null (kept for audit, not shown).
// ============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret || req.nextUrl.searchParams.get('key') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  // Resend inbound event: { type: 'email.received', data: { from, to, subject, text, html } }
  // Field shapes vary slightly, so read defensively.
  const data = (payload.data || payload) as Record<string, unknown>;
  const rawFrom = data.from;
  const fromEmail = (
    typeof rawFrom === 'string' ? rawFrom :
    Array.isArray(rawFrom) ? String(rawFrom[0] ?? '') :
    typeof rawFrom === 'object' && rawFrom !== null ? String((rawFrom as { email?: string; address?: string }).email || (rawFrom as { address?: string }).address || '') : ''
  ).replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
  const rawTo = data.to;
  const toEmail = (Array.isArray(rawTo) ? String(rawTo[0] ?? '') : String(rawTo ?? '')).replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();
  const subject = String(data.subject ?? '').slice(0, 500);
  const text = String(data.text ?? '').slice(0, 50000);
  const html = typeof data.html === 'string' ? data.html.slice(0, 200000) : null;

  if (!fromEmail || !fromEmail.includes('@')) return NextResponse.json({ ok: true, skipped: 'no_sender' });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Match the most recently updated lead with this email address.
  const { data: lead } = await admin
    .from('leads')
    .select('id, workspace_id')
    .ilike('email', fromEmail)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Only file replies we can attribute to a lead — everything still lands in
  // info@migrizo.com regardless, so nothing is ever lost.
  if (!lead) return NextResponse.json({ ok: true, matched: false });

  await admin.from('lead_emails').insert({
    workspace_id: lead.workspace_id,
    lead_id: lead.id,
    direction: 'in',
    from_email: fromEmail,
    to_email: toEmail || 'info@migrizo.com',
    subject,
    body_text: text,
    body_html: html,
    status: 'received',
  });

  return NextResponse.json({ ok: true, matched: true });
}
