// =============================================================================
// SENT DOCUMENT VIEWER — the content of a branded email we already sent.
// -----------------------------------------------------------------------------
// GET ?activity=<activity id of the 'email_sent' row>
//
// * Same permission as sending: admin/owner, or members when the workspace
//   allows client emails. RLS scopes everything to the user's workspace.
// * Sends since migration 128 keep an exact copy (sent_documents) → exact.
// * Older SLAs were never stored, so they are rebuilt from the template with
//   the lead's current details and the logged discount / instalments, and
//   flagged so the drawer can say so. Edits made before sending can't be
//   recovered for those.
// =============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderSLA, visaKindOf } from '@/lib/email/branded';
import { planFromAmounts } from '@/lib/email/sla-plans';
import type { Lead } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  const activityId = new URL(req.url).searchParams.get('activity');
  if (!activityId) return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 });

  const { data: entry } = await supabase
    .from('activity')
    .select('id, workspace_id, lead_id, action, meta, created_at')
    .eq('id', activityId)
    .eq('action', 'email_sent')
    .single();
  if (!entry || !entry.lead_id) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });

  // PERMISSION: mirrors /api/email/send — client documents are admin-only
  // unless the workspace has opened client emails to members.
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', entry.workspace_id)
    .eq('user_id', user.id)
    .single();
  if (!membership) return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
  if (membership.role !== 'admin') {
    const { data: ws } = await supabase
      .from('workspaces')
      .select('allow_member_email')
      .eq('id', entry.workspace_id)
      .single();
    if (!ws || !(ws as { allow_member_email?: boolean }).allow_member_email) {
      return NextResponse.json({ ok: false, reason: 'forbidden' }, { status: 403 });
    }
  }

  const meta = (entry.meta || {}) as { email_type?: string; discount?: number; plan?: number[]; edited?: boolean };

  // 1) The exact copy. Linked by activity id; if that link is missing, the copy
  //    written in the same second for the same lead and type is the one.
  let { data: doc } = await supabase
    .from('sent_documents')
    .select('subject, html, to_email, created_at')
    .eq('activity_id', activityId)
    .maybeSingle();
  if (!doc && meta.email_type) {
    const t = new Date(entry.created_at).getTime();
    const { data: near } = await supabase
      .from('sent_documents')
      .select('subject, html, to_email, created_at')
      .eq('lead_id', entry.lead_id)
      .eq('email_type', meta.email_type)
      .is('activity_id', null)
      .gte('created_at', new Date(t - 60_000).toISOString())
      .lte('created_at', new Date(t + 60_000).toISOString())
      .limit(1);
    doc = near?.[0] ?? null;
  }
  if (doc) {
    return NextResponse.json({ ok: true, exact: true, subject: doc.subject, html: doc.html, to: doc.to_email });
  }

  // 2) Older SLA with no stored copy: rebuild it.
  if (meta.email_type === 'sla') {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', entry.lead_id).single();
    if (!lead) return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 });
    const plan = Array.isArray(meta.plan) && meta.plan.length > 0
      ? planFromAmounts(meta.plan.map((a) => Math.round(Number(a) || 0)), visaKindOf((lead as Lead).visa_type))
      : undefined;
    const email = renderSLA(lead as Lead, plan ? 0 : (meta.discount || 0), plan);
    return NextResponse.json({
      ok: true, exact: false, edited: meta.edited === true,
      subject: email.subject, html: email.html, to: (lead as Lead).email || '',
    });
  }

  return NextResponse.json({ ok: false, reason: 'not_kept' }, { status: 404 });
}
