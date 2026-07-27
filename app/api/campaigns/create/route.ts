// =============================================================================
// CREATE CAMPAIGN — builds the recipient queue from selected leads, applying
// the suppression list + dedupe. Does NOT send here; the drain cron sends,
// throttled, so a 1,300-lead campaign never blasts at once.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { wrapCampaignEmail } from '@/lib/email/campaign-shell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  let body: { name?: string; templateKey?: string; subject?: string; html?: string; leadIds?: string[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 }); }

  const { data: member } = await supabase.from('workspace_members').select('workspace_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false }, { status: 403 });
  const wsId = member.workspace_id;

  // Campaigns are super-admin only (workspace owner, or explicitly granted).
  const { data: allowed } = await supabase.rpc('is_campaign_admin', { p_workspace_id: wsId });
  if (!allowed) return NextResponse.json({ ok: false, reason: 'not_campaign_admin' }, { status: 403 });

  const subject = (body.subject || '').trim();
  // The editor supplies CONTENT ONLY; the branded frame (logo, GTV badge,
  // signature, CTA, unsubscribe) is fixed and applied here, so every campaign
  // email has an identical format regardless of edits.
  const content = (body.html || '').trim();
  // Legacy custom templates are already complete documents — don't re-wrap.
  const html = !content ? '' : content.startsWith('<!DOCTYPE') ? content : wrapCampaignEmail(content, subject);
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds : [];
  if (!subject || !html) return NextResponse.json({ ok: false, reason: 'missing_content' }, { status: 400 });
  if (leadIds.length === 0) return NextResponse.json({ ok: false, reason: 'no_recipients' }, { status: 400 });

  // Pull the selected leads (scoped to workspace) that actually have an email.
  const { data: leads } = await supabase
    .from('leads')
    .select('id, full_name, email')
    .eq('workspace_id', wsId)
    .in('id', leadIds);
  const withEmail = (leads || []).filter((l) => l.email && l.email.includes('@'));

  // Suppression list (unsubscribed / bounced) — never email these.
  const { data: supp } = await supabase.from('email_suppressions').select('email').eq('workspace_id', wsId);
  const suppressed = new Set((supp || []).map((s) => (s.email || '').toLowerCase()));

  // Dedupe by email + drop suppressed.
  const seen = new Set<string>();
  const recipients = withEmail.filter((l) => {
    const e = l.email!.toLowerCase();
    if (suppressed.has(e) || seen.has(e)) return false;
    seen.add(e); return true;
  });
  if (recipients.length === 0) return NextResponse.json({ ok: false, reason: 'all_suppressed_or_no_email' }, { status: 400 });

  // Create the campaign row.
  const { data: camp, error: cErr } = await supabase.from('campaigns').insert({
    workspace_id: wsId, created_by: user.id,
    name: body.name || subject || 'Campaign',
    template_key: body.templateKey || 'custom',
    subject, html, status: 'sending', total: recipients.length,
  }).select('id').single();
  if (cErr || !camp) return NextResponse.json({ ok: false, reason: cErr?.message }, { status: 500 });

  // Queue the recipients.
  const rows = recipients.map((l) => ({
    campaign_id: camp.id, workspace_id: wsId, lead_id: l.id,
    email: l.email, full_name: l.full_name, status: 'queued',
  }));
  const { error: rErr } = await supabase.from('campaign_recipients').insert(rows);
  if (rErr) return NextResponse.json({ ok: false, reason: rErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true, campaignId: camp.id, queued: recipients.length,
    skipped: leadIds.length - recipients.length,
  });
}
