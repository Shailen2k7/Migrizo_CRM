// =============================================================================
// DOCUMENT CHECKLIST EMAIL — send endpoint
// -----------------------------------------------------------------------------
// POST { leadId, subject, body }
//
// The drawer sends the wording shown in its editor (the saved template, or a
// one-off edit of it). The server renders it into the branded shell with the
// sender's signature — the same renderer the live preview uses — so the client
// receives exactly what was previewed.
//
// Kept apart from /api/email/send on purpose: adding this email changes
// nothing about how onboarding, SLA, invoice or "How it works" emails behave.
// Same permission model, same Resend sender, same activity + sent_documents
// logging, so it shows in the lead's email history like the others.
// =============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderChecklist, checklistVisaOf } from '@/lib/email/checklist';
import { DEFAULT_SIGNATURE, type EmailSignature } from '@/lib/email/custom';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let body: { leadId?: string; subject?: string; body?: string; visa?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 }); }
  const leadId = body.leadId;
  const subject = (body.subject || '').trim();
  const text = (body.body || '').trim();
  if (!leadId || !subject || !text) return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });
  if (subject.length > 200 || text.length > 20000) return NextResponse.json({ ok: false, reason: 'too_long' }, { status: 400 });

  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).single();
  if (error || !lead) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
  if (!lead.email) return NextResponse.json({ ok: false, reason: 'no_email' });

  // PERMISSION: same model as the other client emails — admin, or members if enabled.
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

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  if (!apiKey || !from) return NextResponse.json({ ok: false, reason: 'not_configured' });
  const replyTo = process.env.REPLY_TO || 'info@migrizo.com';

  // The sender's saved signature (falls back to the workspace default).
  const { data: sigRow } = await supabase
    .from('email_signatures').select('signature')
    .eq('workspace_id', lead.workspace_id).eq('user_id', user.id).maybeSingle();
  const sig: EmailSignature = { ...DEFAULT_SIGNATURE, ...((sigRow?.signature as Partial<EmailSignature>) || {}) };

  const visa = body.visa === 'ifv' || body.visa === 'gtv' ? body.visa : checklistVisaOf(lead.visa_type);
  const email = renderChecklist(lead, { subject, body: text }, sig);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, reply_to: replyTo, to: [lead.email], subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, reason: 'send_failed', detail }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, reason: 'send_failed' }, { status: 502 });
  }

  try {
    const { data: logged } = await supabase.from('activity').insert({
      workspace_id: lead.workspace_id,
      user_id: user.id,
      lead_id: leadId,
      action: 'email_sent',
      meta: { email_type: 'checklist', visa, subject: email.subject },
    }).select('id').single();
    await supabase.from('sent_documents').insert({
      workspace_id: lead.workspace_id,
      lead_id: leadId,
      activity_id: (logged as { id: string } | null)?.id ?? null,
      email_type: 'checklist',
      to_email: lead.email,
      subject: email.subject,
      html: email.html,
      created_by: user.id,
    });
  } catch { /* noop */ }

  return NextResponse.json({ ok: true });
}
