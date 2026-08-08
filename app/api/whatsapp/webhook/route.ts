// =============================================================================
// INTERAKT WEBHOOK — POST /api/whatsapp/webhook?key=<WHATSAPP_WEBHOOK_SECRET>
// -----------------------------------------------------------------------------
// The only way messages and delivery receipts get into the CRM. Paste the URL
// above into Interakt → Webhooks once, with every event enabled.
//
// Events handled (Interakt's real type strings):
//   message_received                  a lead replied
//   message_api_sent|delivered|read|failed
//   message_campaign_sent|delivered|read|failed
//   message_template_status_update    Meta approved or rejected a template
//   phone_number_quality_update       quality dropped -> auto-pause sending
//
// Field paths, per Interakt's docs:
//   data.message.id                       provider message id
//   data.message.message_status           sent | delivered | read | failed
//   data.message.channel_error_code       failure code
//   data.message.channel_failure_reason   failure text
//   data.customer.channel_phone_number    the lead's number (inbound)
//   data.message.message                  the text they sent
//
// ALWAYS RETURNS 200 for anything we recognise, even on internal error.
// Interakt retries non-2xx, and a retry storm on a bug we cannot fix from here
// is worse than a logged failure. 401 is the only rejection.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const STATUS_MAP: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
  message_api_sent: 'sent',
  message_api_delivered: 'delivered',
  message_api_read: 'read',
  message_api_failed: 'failed',
  message_campaign_sent: 'sent',
  message_campaign_delivered: 'delivered',
  message_campaign_read: 'read',
  message_campaign_failed: 'failed',
};

export async function POST(req: NextRequest) {
  // ── auth: query param or header, either is fine ──────────────────────────
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || process.env.INBOUND_WEBHOOK_SECRET;
  const given = req.nextUrl.searchParams.get('key') || req.headers.get('x-webhook-secret');
  if (!secret || given !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let payload: Json;
  try { payload = obj(await req.json()); } catch {
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  const type = str(payload.type) ?? '';
  const data = obj(payload.data);
  const message = obj(data.message);
  const customer = obj(data.customer);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[whatsapp][webhook] supabase env missing');
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Every workspace shares one WhatsApp number, so resolve the workspace from
  // the connected settings row rather than from the payload.
  async function workspaceId(): Promise<string | null> {
    const { data: rows } = await admin
      .from('whatsapp_settings')
      .select('workspace_id, connected')
      .order('connected', { ascending: false })
      .limit(1);
    return rows?.[0]?.workspace_id ?? null;
  }

  try {
    // ── 1. DELIVERY RECEIPTS ────────────────────────────────────────────────
    if (STATUS_MAP[type]) {
      const providerId = str(message.id);
      if (!providerId) return NextResponse.json({ ok: true, skipped: 'no_message_id' });

      const status = STATUS_MAP[type];
      const { data: applied } = await admin.rpc('whatsapp_update_status', {
        p_provider_id: providerId,
        p_status: status,
        p_error_code: str(message.channel_error_code),
        p_error_detail: str(message.channel_failure_reason),
      });

      if (applied === false) {
        // Not ours, or an out-of-order receipt we correctly ignored.
        console.log('[whatsapp][webhook] status not applied', { type, providerId });
      }
      return NextResponse.json({ ok: true, event: type, status, applied: applied === true });
    }

    // ── 2. INBOUND MESSAGE ──────────────────────────────────────────────────
    if (type === 'message_received') {
      const phone =
        str(customer.channel_phone_number) ??
        str(customer.phone_number) ??
        str(customer.traits && obj(customer.traits).phone);
      if (!phone) return NextResponse.json({ ok: true, skipped: 'no_phone' });

      const contentType = str(message.message_content_type) ?? 'Text';
      const text =
        str(message.message) ??
        (contentType !== 'Text' ? `[${contentType}]` : null) ??
        '';

      const wsId = await workspaceId();
      if (!wsId) {
        console.error('[whatsapp][webhook] no workspace with whatsapp_settings');
        return NextResponse.json({ ok: true, skipped: 'no_workspace' });
      }

      const { data: res, error } = await admin.rpc('whatsapp_record_inbound', {
        p_workspace_id: wsId,
        p_phone: phone,
        p_body: text,
        p_provider_id: str(message.id),
        p_sent_at: new Date().toISOString(),
      });
      if (error) {
        console.error('[whatsapp][webhook] record_inbound failed', error.message, { phone });
        return NextResponse.json({ ok: true, error: error.message });
      }

      const r = obj(res);
      // RULE 1: we flagged it, we did NOT stop the sequence. RULE 2: if this was
      // an opt-out keyword, whatsapp_record_inbound already junked the lead.
      return NextResponse.json({
        ok: true,
        event: type,
        duplicate: r.duplicate === true,
        optout: r.optout === true,
        conversationId: r.conversation_id ?? null,
      });
    }

    // ── 3. TEMPLATE APPROVAL ────────────────────────────────────────────────
    if (type === 'message_template_status_update') {
      const name = str(data.message_template_name);
      const event = (str(data.event) ?? '').toUpperCase();
      if (!name) return NextResponse.json({ ok: true, skipped: 'no_template_name' });

      const map: Record<string, string> = {
        APPROVED: 'approved',
        REJECTED: 'rejected',
        PAUSED: 'paused',
        PENDING: 'submitted',
        IN_APPEAL: 'submitted',
        DISABLED: 'paused',
      };
      const meta_status = map[event];
      if (!meta_status) return NextResponse.json({ ok: true, skipped: `unmapped_event_${event}` });

      const { error } = await admin
        .from('whatsapp_templates')
        .update({ meta_status, meta_reason: str(data.reason), updated_at: new Date().toISOString() })
        .eq('code', name);
      if (error) console.error('[whatsapp][webhook] template update failed', error.message);

      return NextResponse.json({ ok: true, event: type, template: name, meta_status });
    }

    // ── 4. QUALITY DROP -> AUTO-PAUSE ───────────────────────────────────────
    // Protecting the number matters more than finishing a campaign. A suspended
    // number takes client comms down with it, not just marketing.
    if (type === 'phone_number_quality_update') {
      const quality = (str(data.event) ?? str(obj(data.phone_number).quality_rating) ?? '').toUpperCase();
      const wsId = await workspaceId();
      if (!wsId || !quality) return NextResponse.json({ ok: true, skipped: 'no_quality' });

      const { data: s } = await admin
        .from('whatsapp_settings')
        .select('auto_pause_below')
        .eq('workspace_id', wsId)
        .maybeSingle();

      const rank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const threshold = s?.auto_pause_below ?? 'HIGH';
      const shouldPause =
        threshold !== 'NEVER' &&
        rank[quality] !== undefined &&
        rank[quality] < (rank[threshold] ?? 3);

      await admin
        .from('whatsapp_settings')
        .update({
          quality_rating: quality,
          ...(shouldPause
            ? { sending_paused: true, pause_reason: `Quality rating dropped to ${quality} — paused automatically. Restart manually.` }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', wsId);

      if (shouldPause) console.warn('[whatsapp][webhook] SENDING AUTO-PAUSED, quality =', quality);
      return NextResponse.json({ ok: true, event: type, quality, paused: shouldPause });
    }

    // Anything else: acknowledge so Interakt stops retrying, and log it so we
    // can see what we are not handling yet.
    console.log('[whatsapp][webhook] unhandled event', type);
    return NextResponse.json({ ok: true, ignored: type || 'unknown' });
  } catch (e) {
    console.error('[whatsapp][webhook] unhandled error', e);
    return NextResponse.json({ ok: true, error: 'logged' });
  }
}

// Some providers probe with GET before accepting a webhook URL.
export async function GET(req: NextRequest) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || process.env.INBOUND_WEBHOOK_SECRET;
  const given = req.nextUrl.searchParams.get('key');
  if (!secret || given !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, service: 'migrizo-whatsapp-webhook' });
}
