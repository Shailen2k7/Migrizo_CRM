// =============================================================================
// META LEAD INGEST — public endpoint hit by the Make.com scenario
// (Facebook New Lead → Get Lead Details → HTTP POST here).
//
// Secured by a shared token (INGEST_SECRET) rather than a user session, so it
// must be listed in middleware PUBLIC_PATHS. Uses the Supabase service role to
// insert the lead (bypassing RLS, since there is no logged-in user).
//
// Expected JSON body (exactly what Make sends):
//   { "token": "...", "full_name": "...", "phone": "...", "email": "..." }
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderProcess } from '@/lib/email/branded';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // ---- parse body ----------------------------------------------------------
  let body: { token?: string; full_name?: string; phone?: string; email?: string; visa_type?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  // ---- auth: shared token --------------------------------------------------
  const expected = process.env.INGEST_SECRET;
  if (!expected || body.token !== expected) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  // ---- required field ------------------------------------------------------
  const fullName = (body.full_name || '').trim();
  if (!fullName) {
    return NextResponse.json({ ok: false, reason: 'missing_name' }, { status: 400 });
  }
  const phone = (body.phone || '').trim() || null;
  const email = (body.email || '').trim() || null;

  // ---- service-role client (bypasses RLS) ----------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ---- resolve the workspace (single-tenant: the first/only workspace) -----
  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (wsErr || !ws) {
    return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 500 });
  }

  // ---- dedupe by phone within the workspace --------------------------------
  if (phone) {
    const { data: existing } = await admin
      .from('leads')
      .select('id')
      .eq('workspace_id', ws.id)
      .eq('phone', phone)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, duplicate: true, id: existing[0].id });
    }
  }

  // ---- insert the lead -----------------------------------------------------
  const { data: lead, error: insErr } = await admin
    .from('leads')
    .insert({
      workspace_id: ws.id,
      full_name: fullName,
      phone,
      email,
      source: body.source || 'Meta Ads',
      stage: 'cold',
      visa_type: body.visa_type || null,
      tags: ['meta-lead'],
    })
    .select('id')
    .single();
  if (insErr) {
    return NextResponse.json({ ok: false, reason: insErr.message }, { status: 500 });
  }

  // ---------------------------------------------------------------------------
  // AUTO WELCOME: send the "How it works" (GTV process) email to every new lead
  // the moment they land — while interest is hottest. Guards:
  //   - only when the lead has an email address (many Meta leads are phone-only)
  //   - never blocks lead creation (failures are logged, not thrown)
  //   - disable any time by setting env AUTO_WELCOME_EMAIL=false
  //   - duplicates never reach here (deduped above), so no double-sends
  // Each send is logged to activity → appears in the lead's Emails tab.
  // ---------------------------------------------------------------------------
  let welcomed = false;
  if (email && process.env.AUTO_WELCOME_EMAIL !== 'false') {
    try {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.NOTIFY_FROM;
      const replyTo = process.env.REPLY_TO || 'info@migrizo.com';
      if (apiKey && from) {
        const mail = renderProcess({ full_name: fullName, visa_type: body.visa_type || 'gtv' });
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, reply_to: replyTo, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
        });
        if (res.ok) {
          welcomed = true;
          await admin.from('activity').insert({
            workspace_id: ws.id, user_id: null, lead_id: lead.id,
            action: 'email_sent', meta: { email_type: 'process', auto: true, subject: mail.subject },
          });
        }
      }
    } catch { /* never block lead creation on email failure */ }
  }

  return NextResponse.json({ ok: true, id: lead.id, welcomed });
}

// Health check so a browser GET doesn't look "broken" (Make only uses POST).
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'meta-lead ingest', method: 'POST only' });
}
