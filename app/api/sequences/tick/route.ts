// =============================================================================
// SEQUENCES TICK — POST /api/sequences/tick   (pg_cron, every 30 minutes)
// -----------------------------------------------------------------------------
// The heartbeat of email automation. Each tick:
//   1. MAINTENANCE  — exit anyone who replied, booked, converted, unsubscribed,
//                     bounced or turned junk; wake sleepers into their single
//                     re-engagement cycle.
//   2. UNWEDGE      — skip any step whose template the lead somehow already
//                     received (the never-twice guarantee, kept unstuck).
//   3. SEND         — everything due, up to today's remaining cap
//                     (30 → 60 → 120 → 180 over four weeks). Leads mid-sequence
//                     send before brand-new day-0 enrolments.
//
// Every email: branded shell, per-recipient unsubscribe, RFC-8058 one-click
// headers, plain-text alternative, logged to the lead's activity feed.
// Secured by CRON_SECRET — same header as the campaign drain.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { wrapCampaignEmail } from '@/lib/email/campaign-shell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 26; // Netlify's ceiling

const SITE = 'https://crm.migrizo.com';

// Rough HTML -> text for the multipart alternative (same as the campaign drain:
// a real text part materially improves inbox placement).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rarr;/g, '->')
    .replace(/&middot;/g, '·').replace(/&mdash;/g, '—')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface DueRow {
  enrolment_id: string; workspace_id: string; lead_id: string; sequence_id: string;
  step_no: number; day_offset: number; template_id: string;
  lead_name: string | null; lead_email: string; subject: string; html: string;
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM;
  const replyTo = process.env.REPLY_TO || 'info@migrizo.com';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey || !from || !url || !key) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // 0 — top up from the fresh pool if auto enrolment is switched on. Runs at
  // most once per Indian calendar day however often the clock fires.
  const { data: auto } = await admin.rpc('sequence_auto_enrol');
  const autoRow = Array.isArray(auto) ? auto[0] : null;

  // 1 + 2 — sweep exits, wake sleepers, unwedge.
  const { data: maint } = await admin.rpc('sequence_maintenance');
  await admin.rpc('sequence_unwedge');

  // 3 — what's due, capped per workspace.
  // Generous fetch; per-workspace cap enforced below. 40/tick keeps each run
  // comfortably inside Netlify's 26s function limit (48 ticks/day × 40 ≈ far
  // above any cap, so the cap — not the batch size — is always the governor).
  const BATCH = 40;
  const { data: dueRaw } = await admin.rpc('sequence_pick_due', { p_limit: 200 });
  const due = ((dueRaw || []) as DueRow[]);
  if (due.length === 0) {
    return NextResponse.json({
      ok: true, sent: 0,
      ...(Array.isArray(maint) ? maint[0] : {}),
      ...(autoRow ? { auto_cold: autoRow.cold_added, auto_hot: autoRow.hot_added } : {}),
    });
  }

  // How many may go out right now. This is NOT simply the daily cap minus what
  // has been sent: outside the working-hours window it is zero, and inside it
  // the cap is released gradually across the day so the whole allowance is not
  // dumped in the first tick of the morning.
  const wsIds = Array.from(new Set(due.map((d) => d.workspace_id)));
  const remaining = new Map<string, number>();
  for (const ws of wsIds) {
    const { data: allowance } = await admin.rpc('sequence_allowance_now', { p_workspace_id: ws });
    remaining.set(ws, Math.max(0, Number(allowance) || 0));
  }

  let sent = 0, failed = 0, capped = 0;
  // Nothing to do outside the window; every workspace returns an allowance of 0.
  if (Array.from(remaining.values()).every((v) => v <= 0)) {
    return NextResponse.json({
      ok: true, sent: 0, waiting: due.length, reason: 'outside_sending_window',
      ...(autoRow ? { auto_cold: autoRow.cold_added, auto_hot: autoRow.hot_added } : {}),
    });
  }

  for (const r of due) {
    if (sent + failed >= BATCH) break;
    const left = remaining.get(r.workspace_id) ?? 0;
    if (left <= 0) { capped++; continue; }

    const first = (r.lead_name || 'there').split(' ')[0];
    const unsub = `${SITE}/api/unsubscribe?e=${encodeURIComponent(r.lead_email)}&w=${r.workspace_id}`;
    const subject = r.subject.replace(/\{\{\s*name\s*\}\}/gi, first);
    const content = r.html.replace(/\{\{\s*name\s*\}\}/gi, first);
    const html = wrapCampaignEmail(content, subject).replace(/\{\{\s*UNSUB_URL\s*\}\}/gi, unsub);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, reply_to: replyTo, to: [r.lead_email], subject, html,
          text: htmlToText(html),
          headers: {
            'List-Unsubscribe': `<${unsub}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}`);

      // Advance the state machine — schedules the next step, or sleeps, or completes.
      await admin.rpc('sequence_mark_sent', {
        p_enrolment_id: r.enrolment_id, p_template_id: r.template_id,
        p_step_no: r.step_no, p_subject: subject,
      });
      // Lead drawer's Emails tab.
      await admin.from('activity').insert({
        workspace_id: r.workspace_id, user_id: null, lead_id: r.lead_id,
        action: 'email_sent',
        meta: { email_type: 'sequence', sequence_id: r.sequence_id, step: r.step_no, subject },
      });
      remaining.set(r.workspace_id, left - 1);
      sent++;
    } catch {
      // Nothing is marked, so this exact send retries automatically next tick.
      failed++;
    }
  }

  return NextResponse.json({
    ok: true, sent, failed, capped,
    ...(Array.isArray(maint) && maint[0] ? { exited: maint[0].exited, woken: maint[0].woken } : {}),
    ...(autoRow ? { auto_cold: autoRow.cold_added, auto_hot: autoRow.hot_added } : {}),
  });
}
