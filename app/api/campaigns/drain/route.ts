// =============================================================================
// CAMPAIGN DRAIN — cron-driven, throttled sender. Every minute it sends a small
// BATCH of queued recipients (protects domain reputation), personalises the
// {{name}} greeting + unsubscribe link, logs each send to the lead's activity
// (so it appears in the drawer's Emails tab), and updates campaign counters.
// Secured by CRON_SECRET.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 40;          // recipients per minute (~2,400/hr ceiling; safe + fast)
const SITE = 'https://crm.migrizo.com';

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) return NextResponse.json({ ok: false }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  const replyTo = process.env.REPLY_TO || 'info@migrizo.com';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !from || !url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Grab one batch of queued recipients across active campaigns.
  const { data: batch } = await admin
    .from('campaign_recipients')
    .select('id, campaign_id, workspace_id, lead_id, email, full_name')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH);
  if (!batch || batch.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  // Cache campaign bodies (subject/html) so we don't refetch per recipient.
  const campIds = Array.from(new Set(batch.map((r) => r.campaign_id)));
  const { data: camps } = await admin.from('campaigns').select('id, subject, html').in('id', campIds);
  const campById = new Map((camps || []).map((c) => [c.id, c]));

  let sent = 0, failed = 0;
  const perCampaign: Record<string, { sent: number; failed: number }> = {};

  for (const r of batch) {
    const camp = campById.get(r.campaign_id);
    if (!camp) continue;
    const first = (r.full_name || 'there').split(' ')[0];
    const unsub = `${SITE}/api/unsubscribe?e=${encodeURIComponent(r.email)}&w=${r.workspace_id}`;
    const subject = camp.subject.replace(/\{\{\s*name\s*\}\}/gi, first);
    const html = camp.html
      .replace(/\{\{\s*name\s*\}\}/gi, first)
      .replace(/\{\{\s*UNSUB\s*\}\}/gi, `<a href="${unsub}" style="color:#8FA0C4;text-decoration:underline;">Unsubscribe</a>`);

    perCampaign[r.campaign_id] ||= { sent: 0, failed: 0 };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, reply_to: replyTo, to: [r.email], subject, html }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);
      await admin.from('campaign_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id);
      // Log to the lead's activity → shows in the drawer Emails tab.
      await admin.from('activity').insert({
        workspace_id: r.workspace_id, user_id: null, lead_id: r.lead_id,
        action: 'email_sent', meta: { email_type: 'campaign', campaign_id: r.campaign_id, subject },
      });
      sent++; perCampaign[r.campaign_id].sent++;
    } catch (e) {
      await admin.from('campaign_recipients').update({ status: 'failed', error: (e as Error).message }).eq('id', r.id);
      failed++; perCampaign[r.campaign_id].failed++;
    }
  }

  // Update campaign counters + mark done when the queue empties.
  for (const cid of Object.keys(perCampaign)) {
    const { data: c } = await admin.from('campaigns').select('sent, failed').eq('id', cid).single();
    const newSent = (c?.sent || 0) + perCampaign[cid].sent;
    const newFailed = (c?.failed || 0) + perCampaign[cid].failed;
    const { count: remaining } = await admin
      .from('campaign_recipients').select('id', { count: 'exact', head: true })
      .eq('campaign_id', cid).eq('status', 'queued');
    await admin.from('campaigns').update({
      sent: newSent, failed: newFailed,
      status: (remaining || 0) === 0 ? 'done' : 'sending',
      updated_at: new Date().toISOString(),
    }).eq('id', cid);
  }

  return NextResponse.json({ ok: true, sent, failed });
}
