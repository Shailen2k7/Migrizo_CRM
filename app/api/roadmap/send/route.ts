// ============================================================================
// ROADMAP SEND — POST /api/roadmap/send
// Body: { roadmapId }
// Loads the saved roadmap + its lead, renders the branded template with the
// fixed operations signature, sends via Resend, records it in lead_emails (so
// it appears in the Emails conversation thread), logs activity, and marks
// the roadmap row as sent. Same permission model as the email module.
// ============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderRoadmapEmail, renderRoadmapText, roadmapVisaName } from '@/lib/roadmap/template';
import type { RoadmapData } from '@/lib/roadmap/types';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let body: { roadmapId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 }); }
  if (!body.roadmapId) return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });

  // Roadmap row (RLS scopes to the user's workspace)
  const { data: rm, error: rmErr } = await supabase.from('roadmaps').select('*').eq('id', body.roadmapId).single();
  if (rmErr || !rm) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  const { data: lead, error: leadErr } = await supabase.from('leads').select('*').eq('id', rm.lead_id).single();
  if (leadErr || !lead) return NextResponse.json({ ok: false, reason: 'lead_not_found' }, { status: 404 });
  if (!lead.email) return NextResponse.json({ ok: false, reason: 'no_email' });

  // Permission: admin, or members when workspace allows member email
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

  const data = rm.data as RoadmapData;
  const subject = `Your ${roadmapVisaName(data)} Roadmap — ${data.client_name} | Migrizo`;
  const html = renderRoadmapEmail(data);
  const text = renderRoadmapText(data);

  let providerId: string | null = null;
  let sendError: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, reply_to: replyTo, to: [lead.email], subject, html, text }),
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

  // Record in the Emails thread — success and failure both, nothing silent.
  await supabase.from('lead_emails').insert({
    workspace_id: lead.workspace_id, lead_id: lead.id, direction: 'out',
    from_email: from, to_email: lead.email, subject,
    body_text: `Roadmap: ${data.grade} · ${data.evidence_score} · ${data.roadmap.length} steps · ${data.timeline}`,
    body_html: html,
    status: sendError ? 'failed' : 'sent', provider_id: providerId, error: sendError, created_by: user.id,
  });

  if (sendError) return NextResponse.json({ ok: false, reason: 'send_failed', detail: sendError }, { status: 502 });

  await supabase.from('roadmaps').update({ status: 'sent', sent_at: new Date().toISOString(), sent_to: lead.email, updated_at: new Date().toISOString() }).eq('id', rm.id);
  try {
    await supabase.from('activity').insert({
      workspace_id: lead.workspace_id, user_id: user.id, lead_id: lead.id,
      action: 'email_sent', meta: { email_type: 'roadmap', subject, weeks: data.roadmap.length },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true });
}
