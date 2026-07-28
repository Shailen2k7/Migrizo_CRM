// =============================================================================
// SEQUENCE TEST SEND — POST /api/sequences/test  { templateId, to }
// Sends yourself a real copy of any template, wrapped in the branded shell,
// exactly as a lead would receive it. Campaign admins only. Test sends do NOT
// count against the daily cap and are never recorded in sequence_sends.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { wrapCampaignEmail } from '@/lib/email/campaign-shell';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { templateId?: string; to?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 }); }
  const to = (body.to || '').trim().toLowerCase();
  if (!body.templateId || !to.includes('@')) {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  }

  // Template is RLS-scoped to campaign admins — if we can read it, we're allowed.
  const { data: tpl } = await supabase
    .from('email_templates')
    .select('workspace_id, subject, html')
    .eq('id', body.templateId)
    .maybeSingle();
  if (!tpl) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  const replyTo = process.env.REPLY_TO || 'info@migrizo.com';
  if (!apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' });

  const first = (user.user_metadata?.full_name as string || 'there').split(' ')[0];
  const subject = `[TEST] ${tpl.subject.replace(/\{\{\s*name\s*\}\}/gi, first)}`;
  const html = wrapCampaignEmail(tpl.html.replace(/\{\{\s*name\s*\}\}/gi, first), subject)
    .replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, 'https://crm.migrizo.com/api/unsubscribe');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, reply_to: replyTo, to: [to], subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, reason: 'send_failed', detail }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, reason: 'send_failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
