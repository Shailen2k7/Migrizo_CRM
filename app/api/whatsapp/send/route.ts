// =============================================================================
// SEND — POST /api/whatsapp/send
// -----------------------------------------------------------------------------
// One message to one lead. Used by the inbox composer and the template picker.
// Bulk sending never comes through here; 041 adds a cron drain in the same
// queue-and-drain shape as the email engine.
//
// Body (one of):
//   { conversationId, body }                       free-form, window must be open
//   { conversationId, templateCode, values }       template, always allowed
//   { phone, leadId?, templateCode, values }       first contact, no thread yet
//
// Guarantees enforced HERE, server-side, because the browser cannot be trusted:
//   • suppressed numbers are refused          (RULE 2)
//   • free-form outside the 24h window is refused
//   • the daily cap and the sending pause are respected
//   • every template variable must have a value before we call Interakt
//   • a failure is written onto the message with Interakt's real reason
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { sendTemplate, sendText, sendMedia, renderTemplate } from '@/lib/whatsapp/interakt';
import { normalizePhone } from '@/lib/whatsapp/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Body {
  conversationId?: string;
  phone?: string;
  leadId?: string;
  body?: string;
  templateCode?: string;
  values?: Record<string, string>;
  /** From /api/whatsapp/media/upload — an attachment already in our bucket. */
  media?: {
    path: string;
    mediaType: 'image' | 'document' | 'audio' | 'video';
    name?: string;
    mime?: string;
    size?: number;
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, reason: 'unauthenticated' }, { status: 401 });

  const { data: member } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 403 });
  const wsId = member.workspace_id as string;

  let b: Body;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 }); }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  const admin = createAdmin(url, key, { auth: { persistSession: false } });

  // ── resolve the target ────────────────────────────────────────────────────
  let phone: string | null = null;
  let leadId: string | null = b.leadId ?? null;
  let lastInboundAt: string | null = null;

  if (b.conversationId) {
    const { data: conv } = await admin
      .from('whatsapp_conversations')
      .select('phone_e164, lead_id, last_inbound_at, workspace_id')
      .eq('id', b.conversationId)
      .maybeSingle();
    if (!conv || conv.workspace_id !== wsId) {
      return NextResponse.json({ ok: false, reason: 'conversation_not_found' }, { status: 404 });
    }
    phone = conv.phone_e164;
    leadId = leadId ?? conv.lead_id;
    lastInboundAt = conv.last_inbound_at;
  } else if (b.phone) {
    phone = normalizePhone(b.phone);
    if (!phone) return NextResponse.json({ ok: false, reason: 'bad_phone' }, { status: 400 });
    const { data: conv } = await admin
      .from('whatsapp_conversations')
      .select('lead_id, last_inbound_at')
      .eq('workspace_id', wsId)
      .eq('phone_e164', phone)
      .maybeSingle();
    if (conv) { leadId = leadId ?? conv.lead_id; lastInboundAt = conv.last_inbound_at; }
  } else {
    return NextResponse.json({ ok: false, reason: 'no_target' }, { status: 400 });
  }

  // Narrowing for everything below: by here we always have a usable number.
  if (!phone) return NextResponse.json({ ok: false, reason: 'bad_phone' }, { status: 400 });
  const to: string = phone;

  // ── RULE 2: suppressed is suppressed ──────────────────────────────────────
  const { data: supp } = await admin
    .from('whatsapp_suppressions')
    .select('reason')
    .eq('workspace_id', wsId)
    .eq('phone_e164', to)
    .maybeSingle();
  if (supp) {
    return NextResponse.json({ ok: false, reason: 'suppressed', detail: `Opted out (${supp.reason}). This number is never messaged again.` });
  }

  // ── cap / pause / dry-run ─────────────────────────────────────────────────
  // Is their 24-hour window open? If they wrote to us recently, this send is a
  // REPLY, not outreach — and a reply is never rationed. The daily cap exists
  // to stop us blasting strangers, not to stop us answering a customer who is
  // waiting. (The database agrees: whatsapp_record_outbound stamps replies as
  // not counting, so the allowance is not spent either.)
  const windowOpen = lastInboundAt
    ? Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS
    : false;

  const { data: gate } = await admin.rpc('whatsapp_can_send', { p_workspace_id: wsId });
  const g = (gate ?? {}) as {
    allowed?: boolean; connected?: boolean; dry_run?: boolean; paused?: boolean;
    reason?: string; cap?: number; sent_today?: number; remaining?: number;
  };
  const dryRun = g.dry_run !== false;

  if (!dryRun) {
    if (g.paused) {
      return NextResponse.json({ ok: false, reason: 'sending_paused', detail: g.reason || 'Sending is paused.' });
    }
    // whatsapp_can_send folds THREE conditions into one `allowed` flag:
    // connected AND not paused AND under cap. Reporting that as "cap reached"
    // sent people hunting through their daily limit when the real problem was a
    // credential that had never tested clean. Each cause now names itself.
    if (!g.connected) {
      return NextResponse.json({
        ok: false,
        reason: 'not_connected',
        detail: 'The Interakt credential has not tested clean on this deploy, so sending is blocked. ' +
                'Open WhatsApp → Settings and press "Test connection".',
      });
    }
    // The cap applies to OUTREACH only. Inside an open window we are replying,
    // so we go straight through — this is the safest traffic on WhatsApp and
    // blocking it was the single most damaging thing this route ever did.
    if (!windowOpen && (g.remaining ?? 0) <= 0) {
      return NextResponse.json({
        ok: false,
        reason: 'cap_reached',
        detail: `Daily cap reached for new outreach (${g.sent_today ?? '?'} of ${g.cap ?? '?'}). `
              + `Replies to people who messaged you still go out normally. `
              + `Resets at midnight IST — raise it in Settings if you need more today.`,
      });
    }
  }

  // ── build the message ─────────────────────────────────────────────────────
  const isTemplate = Boolean(b.templateCode);
  let text = '';
  let bodyValues: string[] = [];
  let category: string | null = null;
  let language = 'en';

  if (isTemplate) {
    const { data: tpl } = await admin
      .from('whatsapp_templates')
      .select('code, body, variables, category, language, meta_status, active')
      .eq('workspace_id', wsId)
      .eq('code', b.templateCode)
      .maybeSingle();
    if (!tpl) return NextResponse.json({ ok: false, reason: 'template_not_found' }, { status: 404 });
    if (!tpl.active) return NextResponse.json({ ok: false, reason: 'template_inactive' });
    if (!dryRun && tpl.meta_status !== 'approved') {
      return NextResponse.json({
        ok: false,
        reason: 'template_not_approved',
        detail: `This CRM has "${b.templateCode}" marked as "${tpl.meta_status}", so it refuses to send it. ` +
                `If Meta has already approved it in Interakt, open WhatsApp → Templates and press ` +
                `"Mark all as approved in Meta" — approval does not sync automatically unless Interakt's ` +
                `template-status webhook is switched on.`,
      });
    }

    const vars = Array.isArray(tpl.variables) ? (tpl.variables as Array<{ n: string; label?: string; default?: string }>) : [];
    const rendered = renderTemplate(tpl.body, vars, b.values ?? {});
    if (rendered.missing.length) {
      return NextResponse.json({
        ok: false,
        reason: 'missing_variables',
        detail: `No value supplied for ${rendered.missing.map((n) => `{{${n}}}`).join(', ')}. Meta rejects templates with empty variables.`,
      });
    }
    text = rendered.text;
    bodyValues = rendered.bodyValues;
    category = tpl.category;
    language = tpl.language || 'en';
  } else {
    text = String(b.body ?? '').trim();
    // A photo or PDF with no caption is a real message; only reject when there
    // is neither text nor a file.
    if (!text && !b.media) {
      return NextResponse.json({ ok: false, reason: 'empty_message' }, { status: 400 });
    }

    // The 24-hour rule. Meta enforces it; we enforce it first so the failure is
    // a clear message instead of a cryptic provider error.
    const open = lastInboundAt ? Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS : false;
    if (!open) {
      return NextResponse.json({
        ok: false,
        reason: 'window_closed',
        detail: lastInboundAt
          ? 'They last replied more than 24 hours ago. Send an approved template instead.'
          : 'They have never replied, so only an approved template can be sent.',
      });
    }
  }

  // ── record first, send second ─────────────────────────────────────────────
  // The row exists before the API call, so a crash mid-send leaves a visible
  // queued message rather than a silent gap.
  const { data: rec, error: recErr } = await admin.rpc('whatsapp_record_outbound', {
    p_workspace_id: wsId,
    p_phone: to,
    p_body: text,
    p_template_code: b.templateCode ?? null,
    p_category: category,
    p_variables: isTemplate ? (b.values ?? {}) : null,
    p_sent_by: user.id,
    p_lead_id: leadId,
    p_step: null,
    p_media_path: b.media?.path ?? null,
    p_media_type: b.media?.mediaType ?? null,
    p_media_name: b.media?.name ?? null,
    p_media_mime: b.media?.mime ?? null,
    p_media_size: b.media?.size ?? null,
  });
  if (recErr) return NextResponse.json({ ok: false, reason: recErr.message }, { status: 500 });

  const r = (rec ?? {}) as { ok?: boolean; reason?: string; message_id?: string; conversation_id?: string };
  if (!r.ok || !r.message_id) {
    return NextResponse.json({ ok: false, reason: r.reason || 'record_failed' });
  }

  // ── call Interakt ─────────────────────────────────────────────────────────
  // Interakt fetches media from a URL, so mint a short-lived signed link for
  // our private object. 10 minutes is far longer than the fetch needs and short
  // enough that the link is dead before it could be misused.
  let signedUrl: string | null = null;
  if (b.media?.path) {
    const { data: signed } = await admin.storage
      .from('whatsapp-media').createSignedUrl(b.media.path, 600);
    signedUrl = signed?.signedUrl ?? null;
    if (!signedUrl && !dryRun) {
      await admin.from('whatsapp_messages').update({
        status: 'failed', error_code: 'signing_failed',
        error_detail: 'Could not create a signed URL for the attachment.',
        updated_at: new Date().toISOString(),
      }).eq('id', r.message_id);
      return NextResponse.json({ ok: false, reason: 'signing_failed', messageId: r.message_id });
    }
  }

  const result = b.media
    ? await sendMedia({
        phone: to,
        mediaUrl: signedUrl ?? 'dry-run',
        mediaType: b.media.mediaType,
        fileName: b.media.name,
        caption: text || undefined,
        callbackData: r.message_id,
        dryRun,
      })
    : isTemplate
    ? await sendTemplate({
        phone: to,
        template: { name: b.templateCode as string, languageCode: language, bodyValues },
        callbackData: r.message_id,
        dryRun,
      })
    : await sendText({ phone: to, message: text, callbackData: r.message_id, dryRun });

  if (result.ok && result.providerId) {
    await admin.rpc('whatsapp_attach_provider_id', {
      p_message_id: r.message_id,
      p_provider_id: result.providerId,
    });
    if (leadId) {
      await admin.from('activity').insert({
        workspace_id: wsId,
        user_id: user.id,
        lead_id: leadId,
        action: 'whatsapp_sent',
        meta: {
          conversation_id: r.conversation_id,
          template: b.templateCode ?? null,
          dry_run: Boolean(result.dryRun),
          preview: text.slice(0, 180),
        },
      });
    }
    return NextResponse.json({
      ok: true,
      messageId: r.message_id,
      conversationId: r.conversation_id,
      dryRun: Boolean(result.dryRun),
    });
  }

  // Interakt's variable-count error is the single most common failure here and
  // its wording explains nothing. Translate it into the actual fix: our copy of
  // the template body and Interakt's copy disagree on how many {{n}} they hold.
  let detail = result.detail ?? '';
  const countMismatch = /missing variable values|expected number of values/i.test(detail);
  if (countMismatch) {
    const expected = /are\s+(\d+)/i.exec(detail)?.[1] ?? '?';
    detail =
      `Interakt expects ${expected} variable value(s) for "${b.templateCode}", but this CRM's copy of ` +
      `the template has ${bodyValues.length}. The two bodies have drifted apart. ` +
      `Open WhatsApp → Templates, press Edit on this template, and paste the exact body from Interakt.`;
  }

  // Failure: write the real reason onto the message so it shows on the bubble.
  console.error('[whatsapp][send] failed', { code: result.code, detail: result.detail, raw: result.raw });
  await admin
    .from('whatsapp_messages')
    .update({
      status: 'failed',
      error_code: countMismatch ? 'template_variable_mismatch' : (result.code ?? 'unknown'),
      error_detail: detail.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq('id', r.message_id);

  return NextResponse.json({
    ok: false,
    reason: countMismatch ? 'template_variable_mismatch' : (result.code ?? 'send_failed'),
    detail,
    messageId: r.message_id,
    conversationId: r.conversation_id,
  });
}
