// ============================================================================
// COMPOSE SEND — POST /api/email/compose
// Body: { leadId, subject, body }
// Sends a free-form email to the lead through Resend, with the sender's saved
// signature auto-appended, records it in lead_emails (the thread) and in the
// activity feed. Same permission model as the branded-template endpoint.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderCustomEmail, DEFAULT_SIGNATURE, type EmailSignature } from '@/lib/email/custom';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let body: { leadId?: string; subject?: string; body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 }); }
  const leadId = body.leadId;
  const subject = (body.subject || '').trim();
  const message = (body.body || '').trim();
  if (!leadId || !subject || !message) return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  if (subject.length > 200 || message.length > 20000) return NextResponse.json({ ok: false, reason: 'too_long' }, { status: 400 });

  // Load the lead (RLS restricts to the user's workspace).
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).single();
  if (error || !lead) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (!lead.email) return NextResponse.json({ ok: false, reason: 'no_email' });

  // PERMISSION: same model as branded emails — admin, or members if enabled.
  const { data: membership } = await supabase
    .from('workspace_members').select('role')
    .eq('workspace_id', lead.workspace_id).eq('user_id', user.id).single();
  if (!membership) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  if (membership.role !== 'admin') {
    const { data: ws } = await supabase.from('workspaces').select('allow_member_email').eq('id', lead.workspace_id).single();
    if (!ws || !(ws as { allow_member_email?: boolean }).allow_member_email) {
      return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
    }
  }

  // The sender's saved signature (falls back to the workspace default).
  const { data: sigRow } = await supabase
    .from('email_signatures').select('signature')
    .eq('workspace_id', lead.workspace_id).eq('user_id', user.id).maybeSingle();
  const sig: EmailSignature = { ...DEFAULT_SIGNATURE, ...((sigRow?.signature as Partial<EmailSignature>) || {}) };

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  if (!apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' });
  const replyTo = process.env.REPLY_TO || 'info@migrizo.com';

  const email = renderCustomEmail({ bodyText: message, sig });

  let providerId: string | null = null;
  let sendError: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, reply_to: replyTo, to: [lead.email], subject, html: email.html, text: email.text }),
    });
    if (res.ok) {
      const j = await res.json().catch(() => null);
      providerId = j?.id || null;
    } else {
      sendError = (await res.text().catch(() => '')) || `HTTP ${res.status}`;
    }
  } catch {
    sendError = 'network_error';
  }

  // Record in the thread (both success and failure, so nothing silently vanishes).
  await supabase.from('lead_emails').insert({
    workspace_id: lead.workspace_id, lead_id: leadId, direction: 'out',
    from_email: from, to_email: lead.email, subject,
    body_text: `${message}`, body_html: email.html,
    status: sendError ? 'failed' : 'sent', provider_id: providerId, error: sendError, created_by: user.id,
  });

  if (sendError) return NextResponse.json({ ok: false, reason: 'send_failed', detail: sendError }, { status: 502 });

  // Activity feed (best-effort).
  try {
    await supabase.from('activity').insert({
      workspace_id: lead.workspace_id, user_id: user.id, lead_id: leadId,
      action: 'email_sent', meta: { email_type: 'custom', subject },
    });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true });
}
