// =============================================================================
// INTERAKT WEBHOOK — POST /api/whatsapp/webhook?key=<WHATSAPP_WEBHOOK_SECRET>
// -----------------------------------------------------------------------------
// The only way messages and delivery receipts get into the CRM. Paste the URL
// above into Interakt → Webhooks once, with every message event enabled.
//
// Events handled (Interakt's real type strings):
//   message_received                  a lead replied
//   message_api_sent|delivered|read|failed
//   message_campaign_sent|delivered|read|failed
//   message_template_status_update    Meta approved or rejected a template
//   phone_number_quality_update       quality dropped -> auto-pause sending
//
// EVERY REQUEST IS LOGGED to whatsapp_webhook_log (migration 042) before we
// return, including the ones we reject with 401 and the ones that throw. That
// table is what makes "inbound is not working" a five-second SELECT instead of
// an afternoon of guessing. The logging is fire-and-forget: if migration 042
// has not been applied yet, the insert fails silently and message handling
// carries on exactly as before.
//
// ALWAYS RETURNS 200 for anything we recognise, even on internal error.
// Interakt retries non-2xx, and a retry storm on a bug we cannot fix from here
// is worse than a logged failure. 401 is the only rejection.
// =============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mediaTypeFromInterakt } from '@/lib/whatsapp/interakt';
import { handleInboundForIntake } from '@/lib/whatsapp/intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The intake pipeline (CV extraction + verdict) runs inside this request.
// Interakt only needs a 2xx eventually; duplicates are deduped by provider id.
export const maxDuration = 60;

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

/** What ended up happening to this request. Mirrors the column in 042. */
type Outcome = 'unauthorized' | 'bad_json' | 'handled' | 'ignored' | 'error';

interface LogRow {
  event_type: string | null;
  outcome: Outcome;
  detail: string | null;
  phone: string | null;
  provider_id: string | null;
  workspace_id: string | null;
  payload: unknown;
}


/**
 * Pull an inbound attachment into OUR storage.
 *
 * Interakt hands us a URL that expires. If we only stored the link, every CV in
 * the CRM would quietly rot into a 404 within days — so we fetch the bytes now
 * and keep them. A failure here must never lose the message: we fall back to
 * recording the source URL so the file can be retried later.
 */
/**
 * A human-readable filename for an attachment.
 *
 * Interakt does NOT send the customer's original filename. Every inbound media
 * payload was checked: the message object carries media_url and
 * message_content_type and nothing else identifying the file, and the URL
 * itself is a random blob ("ylfdTBkupHNu.pdf"). There is no original name to
 * preserve, so one has to be built.
 *
 * "Upen Pathak — CV.pdf" beats "document-1787852212034.pdf" for the only
 * things a name is for here: recognising it in the inbox and in a download
 * folder. Falls back to the phone number when the chat has no lead yet.
 */
async function mediaFileName(
  admin: SupabaseClient,
  wsId: string,
  phone: string | null,
  declaredType: string,
  ext: string
): Promise<string> {
  const label = declaredType === 'image' ? 'Photo'
    : declaredType === 'document' ? 'CV'
    : declaredType === 'audio' ? 'Voice note'
    : declaredType === 'video' ? 'Video' : 'File';

  let who: string | null = phone;
  if (phone) {
    try {
      // The conversation first — it holds the lead link once one exists.
      const { data } = await admin
        .from('whatsapp_conversations')
        .select('lead:leads(full_name)')
        .eq('workspace_id', wsId)
        .eq('phone_e164', phone)
        .maybeSingle();
      const lead = data?.lead as { full_name?: string } | { full_name?: string }[] | null;
      who = (Array.isArray(lead) ? lead[0]?.full_name : lead?.full_name) || phone;

      // On a FIRST message there is no conversation yet — capture runs before
      // whatsapp_record_inbound creates one — so the lookup above finds
      // nothing and every first CV would be named after a phone number. That
      // is the most common case of all, so fall back to matching the lead
      // directly on the last ten digits of the number. This only ever decides
      // a FILENAME, so a loose match is the right trade: worst case the file
      // is named after the phone, exactly as it would have been anyway.
      if (who === phone) {
        const last10 = phone.replace(/\D/g, '').slice(-10);
        if (last10.length === 10) {
          const { data: byPhone } = await admin
            .from('leads')
            .select('full_name')
            .eq('workspace_id', wsId)
            .ilike('phone', `%${last10}`)
            .order('created_at', { ascending: false })
            .limit(1);
          who = byPhone?.[0]?.full_name || phone;
        }
      }
    } catch {
      who = phone;
    }
  }

  // ASCII only, and no em-dash. This string ends up in BOTH the display name
  // and (via storageKey below) the storage object key, and Supabase storage
  // rejects a key containing non-ASCII with a 400 — verified the hard way: an
  // em-dash here fails the upload while the database row still records the
  // path, leaving a message pointing at a file that does not exist.
  const safe = (who || 'Unknown').replace(/[^\w.\- ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${safe} - ${label}.${ext}`;
}

/**
 * A storage object key derived from a display name. Storage is far stricter
 * than a filename: anything outside plain ASCII word characters, dot and dash
 * is replaced. The pretty name still goes on the message row for the inbox and
 * the download dialog — only the KEY is flattened.
 */
/**
 * File extension for a MIME type.
 *
 * Naively taking mime.split('/')[1] produces ".vndopenx" for a Word document,
 * because its type is
 * "application/vnd.openxmlformats-officedocument.wordprocessingml.document".
 * A file called "Upen Pathak - CV.vndopenx" does not open on a double-click,
 * so the common types are mapped explicitly and the split is only the
 * fallback for anything unrecognised.
 */
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

const extFor = (mime: string): string =>
  EXT_BY_MIME[mime.toLowerCase()]
  ?? mime.split('/')[1]?.replace(/[^\w]/g, '').slice(0, 8)
  ?? 'bin';

const storageKey = (wsId: string, name: string): string =>
  `${wsId}/in/${Math.random().toString(36).slice(2, 12)}-` +
  (name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(0, 80) || 'file');

async function captureMedia(
  admin: SupabaseClient,
  wsId: string,
  message: Json,
  phone: string | null
): Promise<{
  path: string | null; type: string | null; name: string | null;
  mime: string | null; size: number | null; sourceUrl: string | null;
  error: string | null;
}> {
  const empty = {
    path: null, type: null, name: null, mime: null, size: null,
    sourceUrl: null, error: null,
  };

  // Interakt is not consistent about the field name across content types.
  const sourceUrl =
    str(message.media_url) ?? str(message.mediaUrl) ??
    str(message.url) ?? str(obj(message.media).url);
  const declaredType = mediaTypeFromInterakt(
    str(message.message_content_type) ?? str(message.type) ?? str(message.content_type)
  );
  if (!sourceUrl || !declaredType) return empty;

  const fallbackName =
    str(message.file_name) ?? str(message.fileName) ?? str(message.caption) ?? null;

  // Two attempts on BOTH the download and the upload. The old code tried each
  // once and, on failure, dropped the file on the floor with the reason going
  // only to console.error — which is why 35% of attachments read "file not
  // available" with nothing anywhere saying why. Most of these failures are
  // transient; a second attempt a moment later fixes them.
  //
  // Whatever happens, sourceUrl and the failure reason are RETURNED, so a
  // failed capture stays recoverable instead of becoming a dead row.
  let lastError = 'unknown';

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch(sourceUrl, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) { lastError = `download HTTP ${res.status}`; continue; }

      const buf = new Uint8Array(await res.arrayBuffer());
      // 100MB is past anything WhatsApp will deliver; treat it as hostile.
      if (buf.byteLength === 0) { lastError = 'downloaded 0 bytes'; continue; }
      if (buf.byteLength > 100 * 1024 * 1024) {
        return { ...empty, type: declaredType, name: fallbackName, sourceUrl,
                 error: `file too large (${Math.round(buf.byteLength / 1048576)}MB)` };
      }

      const mime = res.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
      const extFromMime = extFor(mime);
      // Interakt sends no filename, so build a readable one. A caption that
      // already looks like a filename is still honoured — if a name ever does
      // arrive, it wins over anything we invent.
      const name = (fallbackName && /\.[A-Za-z0-9]{2,5}$/.test(fallbackName))
        ? fallbackName.replace(/[^\w.\- ]+/g, '_').slice(0, 120)
        : await mediaFileName(admin, wsId, phone, declaredType, extFromMime);

      const path = storageKey(wsId, name);
      const { error } = await admin.storage.from('whatsapp-media')
        .upload(path, buf, { contentType: mime, upsert: false });
      if (error) {
        lastError = `storage upload: ${error.message}`;
        console.error('[whatsapp][webhook] media upload failed', error.message, { attempt });
        continue;
      }

      return { path, type: declaredType, name, mime, size: buf.byteLength, sourceUrl, error: null };
    } catch (e) {
      lastError = `fetch threw: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[whatsapp][webhook] media capture failed', lastError, { attempt });
    }
  }

  // Both attempts failed. The row is still written with the type, the name and
  // — critically — the source URL, which Interakt keeps alive for years. That
  // is what lets /api/whatsapp/media/backfill recover it later.
  console.error('[whatsapp][webhook] media capture gave up', lastError);
  return { ...empty, type: declaredType, name: fallbackName, sourceUrl, error: lastError };
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[whatsapp][webhook] supabase env missing');
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Filled in as we go; written exactly once in the finally block below.
  const log: LogRow = {
    event_type: null, outcome: 'error', detail: null,
    phone: null, provider_id: null, workspace_id: null, payload: null,
  };

  try {
    // ── auth: query param or header, either is fine ────────────────────────
    // Read the body first even on a 401 — knowing WHICH event was rejected is
    // the difference between "wrong secret" and "wrong URL".
    let payload: Json | null = null;
    let badJson = false;
    try { payload = obj(await req.json()); } catch { badJson = true; }
    log.payload = payload;
    log.event_type = payload ? str(payload.type) : null;

    // ── secret comparison, made forgiving of the two ways this always breaks ──
    //
    // 1. Netlify env values pick up a trailing newline or space on paste. The
    //    value looks identical in the UI and never matches. Hence .trim().
    //
    // 2. If the secret contains + / or =, putting it raw in a query string
    //    corrupts it: "+" decodes to a space. So we compare the decoded form,
    //    the raw form, and the space-back-to-plus repair of the raw form, and
    //    accept any of the three.
    //
    // Interakt cannot send custom headers, so ?key= is the only channel — which
    // is exactly why it has to be robust.
    const secret = (process.env.WHATSAPP_WEBHOOK_SECRET || process.env.INBOUND_WEBHOOK_SECRET || '').trim();
    const rawGiven = (
      req.nextUrl.searchParams.get('key') ??
      req.headers.get('x-webhook-secret') ??
      req.headers.get('x-interakt-secret') ??
      ''
    ).trim();

    const candidates = new Set<string>();
    if (rawGiven) {
      candidates.add(rawGiven);
      candidates.add(rawGiven.replace(/ /g, '+'));   // undo query-string mangling
      try { candidates.add(decodeURIComponent(rawGiven).trim()); } catch { /* not encoded */ }
    }
    const matched = secret !== '' && candidates.has(secret);

    if (!matched) {
      log.outcome = 'unauthorized';
      if (!secret) {
        log.detail = 'WHATSAPP_WEBHOOK_SECRET is not set on this deploy';
      } else if (!rawGiven) {
        log.detail = 'no key query param and no secret header on the request';
      } else {
        // Enough of a fingerprint to spot the difference, not enough to be a
        // leak: lengths plus first and last two characters of each.
        const fp = (v: string) => `len ${v.length} "${v.slice(0, 2)}…${v.slice(-2)}"`;
        log.detail =
          `secret supplied but did not match. Netlify has ${fp(secret)}, ` +
          `Interakt sent ${fp(rawGiven)}. ` +
          (secret.length !== rawGiven.length
            ? 'Lengths differ — likely a truncated paste, or the secret was regenerated in Interakt after you copied it.'
            : 'Same length, different content — likely a character mangled by the URL, or a different secret entirely.');
      }
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    if (badJson || !payload) {
      log.outcome = 'bad_json';
      log.detail = 'request body was not valid JSON';
      return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
    }

    const type = log.event_type ?? '';
    const data = obj(payload.data);
    const message = obj(data.message);
    const customer = obj(data.customer);
    log.provider_id = str(message.id);

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

    // ── 1. DELIVERY RECEIPTS ──────────────────────────────────────────────
    if (STATUS_MAP[type]) {
      const providerId = log.provider_id;
      if (!providerId) {
        log.outcome = 'ignored';
        log.detail = 'receipt had no data.message.id';
        return NextResponse.json({ ok: true, skipped: 'no_message_id' });
      }

      const status = STATUS_MAP[type];
      const { data: applied, error } = await admin.rpc('whatsapp_update_status', {
        p_provider_id: providerId,
        p_status: status,
        p_error_code: str(message.channel_error_code),
        p_error_detail: str(message.channel_failure_reason),
      });

      if (error) {
        log.outcome = 'error';
        log.detail = `whatsapp_update_status: ${error.message}`;
        console.error('[whatsapp][webhook] status rpc failed', error.message);
        return NextResponse.json({ ok: true, error: error.message });
      }

      log.outcome = applied === true ? 'handled' : 'ignored';
      if (applied !== true) {
        // Not ours, or an out-of-order receipt we correctly ignored.
        log.detail = 'no outbound message matched this provider id';
      }
      return NextResponse.json({ ok: true, event: type, status, applied: applied === true });
    }

    // ── 2. INBOUND MESSAGE ────────────────────────────────────────────────
    if (type === 'message_received') {
      const phone =
        str(customer.channel_phone_number) ??
        str(customer.phone_number) ??
        str(customer.traits && obj(customer.traits).phone);
      log.phone = phone;
      if (!phone) {
        log.outcome = 'ignored';
        log.detail = 'no phone number anywhere in data.customer';
        return NextResponse.json({ ok: true, skipped: 'no_phone' });
      }

      // With real media capture below, an empty caption is genuinely empty —
      // the database builds the "📄 CV.pdf" preview from the file itself.
      // Interakt sometimes serialises an ABSENT caption as the literal string
      // "None" (Python's None, stringified). That is not something the person
      // typed — showing it in the bubble, or feeding it to the intent brain,
      // is wrong both times. Treat it as empty.
      const rawText = str(message.message) ?? '';
      const text = /^(none|null|undefined)$/i.test(rawText.trim()) ? '' : rawText;

      const wsId = await workspaceId();
      log.workspace_id = wsId;
      if (!wsId) {
        log.outcome = 'error';
        log.detail = 'no whatsapp_settings row exists — nothing to attach this conversation to';
        console.error('[whatsapp][webhook] no workspace with whatsapp_settings');
        return NextResponse.json({ ok: true, skipped: 'no_workspace' });
      }

      const media = await captureMedia(admin, wsId, message, phone);

      const { data: res, error } = await admin.rpc('whatsapp_record_inbound', {
        p_workspace_id: wsId,
        p_phone: phone,
        p_body: text,
        p_provider_id: log.provider_id,
        p_sent_at: new Date().toISOString(),
        p_media_path: media.path,
        p_media_type: media.type,
        p_media_name: media.name,
        p_media_mime: media.mime,
        p_media_size: media.size,
        p_media_source_url: media.sourceUrl,
      });
      if (error) {
        log.outcome = 'error';
        log.detail = `whatsapp_record_inbound: ${error.message}`;
        console.error('[whatsapp][webhook] record_inbound failed', error.message, { phone });
        return NextResponse.json({ ok: true, error: error.message });
      }

      const r = obj(res);

      // A failed capture is written onto the message itself (079), not just to
      // console.error. Without this the inbox says "file not available" and
      // nothing anywhere records why, which is how 35% of attachments went
      // missing unnoticed. Best-effort: never worth failing the webhook over.
      if (media.error && r.message_id) {
        await admin.from('whatsapp_messages')
          .update({ media_error: media.error })
          .eq('id', String(r.message_id));
      }

      log.outcome = 'handled';
      log.detail = [
        media.type ? `media:${media.type}${media.path ? '' : ' (capture failed)'}` : null,
        r.duplicate === true ? 'duplicate' : null,
        r.optout === true ? 'optout — lead junked' : null,
        r.conversation_id ? `conv ${r.conversation_id}` : 'no conversation id returned',
      ].filter(Boolean).join(' · ');

      // RULE 1: we flagged it, we did NOT stop the sequence. RULE 2: if this was
      // an opt-out keyword, whatsapp_record_inbound already junked the lead.

      // ── INTAKE AUTOPILOT (076) ─────────────────────────────────────────────
      // T1 inline, CV → verdict → T5/T6 or T7, LinkedIn capture. Strictly
      // best-effort: any failure is logged and flagged, never breaks the 200.
      // Duplicates (Interakt retries) and opt-outs never reach the autopilot.
      let intake: Record<string, unknown> | null = null;
      if (r.conversation_id && r.duplicate !== true && r.optout !== true) {
        try {
          intake = await handleInboundForIntake(admin, wsId, {
            conversationId: String(r.conversation_id),
            phone,
            text,
            providerMsgId: log.provider_id,
            media,
          });
          if (intake && Object.keys(intake).length) {
            log.detail = `${log.detail} · intake ${JSON.stringify(intake).slice(0, 200)}`;
          }
        } catch (e) {
          console.error('[whatsapp][webhook] intake autopilot threw', e);
        }
      }

      // ── PUSH TO PHONES (077): a lead writing in is the one event this
      // business cannot afford to see late. Fire-and-forget; the chime in
      // open tabs comes from realtime, this reaches closed laptops and
      // pockets. Duplicates never notify twice.
      if (r.duplicate !== true && r.optout !== true) {
        try {
          const { pushToWorkspace } = await import('@/lib/push-server');
          const { data: convRow } = r.conversation_id
            ? await admin.from('whatsapp_conversations')
                .select('lead_id, lead:leads(full_name)')
                .eq('id', r.conversation_id).maybeSingle()
            : { data: null };
          const leadRel = (convRow as { lead?: unknown } | null)?.lead;
          const leadOne = (Array.isArray(leadRel) ? leadRel[0] : leadRel) as { full_name?: string } | null | undefined;
          const leadName = leadOne?.full_name || phone;
          const preview = text
            ? text.slice(0, 110)
            : (media.type ? `📎 sent a ${media.type}${media.name ? ` — ${media.name}` : ''}` : 'sent a message');
          await pushToWorkspace(admin, wsId, {
            title: `WhatsApp · ${leadName}`,
            body: preview,
            url: '/whatsapp',
            tag: `wa-${r.conversation_id ?? phone}`,
          });
        } catch (e) {
          console.error('[whatsapp][webhook] push failed', e);
        }
      }

      return NextResponse.json({
        ok: true,
        event: type,
        duplicate: r.duplicate === true,
        optout: r.optout === true,
        conversationId: r.conversation_id ?? null,
        intake,
      });
    }

    // ── 3. TEMPLATE APPROVAL ──────────────────────────────────────────────
    if (type === 'message_template_status_update') {
      const name = str(data.message_template_name);
      const event = (str(data.event) ?? '').toUpperCase();
      if (!name) {
        log.outcome = 'ignored';
        log.detail = 'no data.message_template_name';
        return NextResponse.json({ ok: true, skipped: 'no_template_name' });
      }

      const map: Record<string, string> = {
        APPROVED: 'approved',
        REJECTED: 'rejected',
        PAUSED: 'paused',
        PENDING: 'submitted',
        IN_APPEAL: 'submitted',
        DISABLED: 'paused',
      };
      const meta_status = map[event];
      if (!meta_status) {
        log.outcome = 'ignored';
        log.detail = `template event "${event}" is not one we map`;
        return NextResponse.json({ ok: true, skipped: `unmapped_event_${event}` });
      }

      const { error } = await admin
        .from('whatsapp_templates')
        .update({ meta_status, meta_reason: str(data.reason), updated_at: new Date().toISOString() })
        .eq('code', name);

      if (error) {
        log.outcome = 'error';
        log.detail = `template update: ${error.message}`;
        console.error('[whatsapp][webhook] template update failed', error.message);
      } else {
        log.outcome = 'handled';
        log.detail = `${name} -> ${meta_status}`;
      }

      return NextResponse.json({ ok: true, event: type, template: name, meta_status });
    }

    // ── 4. QUALITY DROP -> AUTO-PAUSE ─────────────────────────────────────
    // Protecting the number matters more than finishing a campaign. A suspended
    // number takes client comms down with it, not just marketing.
    if (type === 'phone_number_quality_update') {
      const quality = (str(data.event) ?? str(obj(data.phone_number).quality_rating) ?? '').toUpperCase();
      const wsId = await workspaceId();
      log.workspace_id = wsId;
      if (!wsId || !quality) {
        log.outcome = 'ignored';
        log.detail = !wsId ? 'no whatsapp_settings row' : 'no quality rating in payload';
        return NextResponse.json({ ok: true, skipped: 'no_quality' });
      }

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
      log.outcome = 'handled';
      log.detail = `quality ${quality}${shouldPause ? ' — SENDING PAUSED' : ''}`;
      return NextResponse.json({ ok: true, event: type, quality, paused: shouldPause });
    }

    // Anything else: acknowledge so Interakt stops retrying, and log it so we
    // can see what we are not handling yet.
    log.outcome = 'ignored';
    log.detail = `event type "${type || 'unknown'}" is not handled by this route`;
    console.log('[whatsapp][webhook] unhandled event', type);
    return NextResponse.json({ ok: true, ignored: type || 'unknown' });
  } catch (e) {
    log.outcome = 'error';
    log.detail = e instanceof Error ? e.message.slice(0, 500) : 'unknown error';
    console.error('[whatsapp][webhook] unhandled error', e);
    return NextResponse.json({ ok: true, error: 'logged' });
  } finally {
    // Fire-and-forget. A failure here must never affect the response we already
    // decided on, and must never throw — it is a diagnostic, not a dependency.
    await record(admin, log);
  }
}

/** Insert one audit row. Swallows everything, including "table does not exist". */
async function record(admin: SupabaseClient, log: LogRow): Promise<void> {
  try {
    const { error } = await admin.from('whatsapp_webhook_log').insert({
      event_type: log.event_type,
      outcome: log.outcome,
      detail: log.detail ? log.detail.slice(0, 1000) : null,
      phone: log.phone,
      provider_id: log.provider_id,
      workspace_id: log.workspace_id,
      payload: log.payload ?? null,
    });
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.error('[whatsapp][webhook] audit insert failed', error.message);
    }
  } catch (e) {
    console.error('[whatsapp][webhook] audit insert threw', e);
  }
}

// Some providers probe with GET before accepting a webhook URL. This is also
// the fastest manual check that a deploy has the right secret: open the URL in
// a browser and you should see { ok: true }.
export async function GET(req: NextRequest) {
  const secret = (process.env.WHATSAPP_WEBHOOK_SECRET || process.env.INBOUND_WEBHOOK_SECRET || '').trim();
  const rawGiven = (req.nextUrl.searchParams.get('key') ?? '').trim();

  if (!secret) {
    return NextResponse.json({ ok: false, reason: 'secret_not_set_on_this_deploy' }, { status: 401 });
  }
  if (!rawGiven) {
    return NextResponse.json({ ok: false, reason: 'no_key_param' }, { status: 401 });
  }

  const candidates = new Set([rawGiven, rawGiven.replace(/ /g, '+')]);
  try { candidates.add(decodeURIComponent(rawGiven).trim()); } catch { /* not encoded */ }

  if (!candidates.has(secret)) {
    // Same fingerprint as the POST path, so pasting the URL into a browser tells
    // you whether the key is right before Interakt ever calls.
    const fp = (v: string) => ({ length: v.length, starts: v.slice(0, 2), ends: v.slice(-2) });
    return NextResponse.json(
      { ok: false, reason: 'secret_mismatch', netlify: fp(secret), you_sent: fp(rawGiven) },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true, service: 'migrizo-whatsapp-webhook' });
}
