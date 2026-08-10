// =============================================================================
// INTERAKT ADAPTER — the only file that knows Interakt exists.
//
// Everything else in the WhatsApp module talks to these functions. If we ever
// swap provider (Gupshup, Meta Cloud direct), this file is what changes.
//
// API surface we use, verified against Interakt's docs:
//   POST https://api.interakt.ai/v1/public/message/
//   Authorization: Basic <SECRET_KEY>          (the key IS the credential —
//                                               Interakt already base64-encodes
//                                               it; do NOT re-encode)
//   Body (template):
//     { countryCode:"+91", phoneNumber:"9820144518", type:"Template",
//       callbackData:"<our message id>",
//       template:{ name, languageCode, headerValues:[], bodyValues:[...] } }
//   Body (free-form, only valid inside the 24h window):
//     { countryCode, phoneNumber, type:"Text", data:{ message:"..." } }
//   Response: { result:true, message:"...", id:"<provider message id>" }
//
// DRY RUN: when settings.dry_run is true nothing leaves the process. The call
// is logged and a synthetic id is returned so the whole pipeline — statuses,
// activity rows, the inbox — can be exercised without touching the number.
// =============================================================================

import { splitPhone } from './phone';

const BASE = 'https://api.interakt.ai/v1/public';
const TIMEOUT_MS = 15_000;

export interface SendResult {
  ok: boolean;
  providerId?: string;
  dryRun?: boolean;
  /** Machine-readable failure code — goes into whatsapp_messages.error_code. */
  code?: string;
  /** Human-readable failure detail — shown on the message bubble. */
  detail?: string;
  /** Raw provider response, for the server log only. Never sent to the browser. */
  raw?: unknown;
}

export interface TemplatePayload {
  name: string;
  languageCode?: string;
  headerValues?: string[];
  bodyValues?: string[];
}

function apiKey(): string | null {
  return process.env.INTERAKT_API_KEY || null;
}

export function isConfigured(): boolean {
  return Boolean(apiKey());
}

async function call(
  path: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const key = apiKey();
  if (!key) throw new Error('INTERAKT_API_KEY missing');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { /* keep text */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Turn any thrown value into a SendResult rather than letting it escape. */
function asFailure(e: unknown): SendResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('abort')) {
    return { ok: false, code: 'timeout', detail: `Interakt did not respond within ${TIMEOUT_MS / 1000}s` };
  }
  return { ok: false, code: 'network', detail: msg };
}

/**
 * Pull a useful error out of Interakt's response. Their failures are not
 * uniform — sometimes { result:false, message }, sometimes an errors array,
 * sometimes plain text. Never swallow it: a silent failure is the worst
 * outcome for this integration.
 */
function readError(status: number, json: Record<string, unknown> | null, text: string): SendResult {
  const m = json as Record<string, unknown> | null;
  const message =
    (typeof m?.message === 'string' && m.message) ||
    (typeof m?.error === 'string' && m.error) ||
    (Array.isArray(m?.errors) && typeof (m.errors as unknown[])[0] === 'string'
      ? String((m.errors as unknown[])[0])
      : '') ||
    (text ? text.slice(0, 400) : `HTTP ${status}`);

  let code = String(status);
  if (status === 401 || status === 403) code = 'unauthorized';
  else if (status === 429) code = 'rate_limited';
  else if (status >= 500) code = 'provider_error';
  const cc = m?.channel_error_code ?? m?.error_code;
  if (cc != null) code = String(cc);

  return { ok: false, code, detail: message, raw: json ?? text };
}

// ── SEND A TEMPLATE ─────────────────────────────────────────────────────────
export async function sendTemplate(opts: {
  phone: string;
  template: TemplatePayload;
  callbackData?: string;
  dryRun?: boolean;
}): Promise<SendResult> {
  const split = splitPhone(opts.phone);
  if (!split) {
    return { ok: false, code: 'bad_phone', detail: `Cannot parse phone number "${opts.phone}"` };
  }

  const payload = {
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    type: 'Template',
    ...(opts.callbackData ? { callbackData: opts.callbackData.slice(0, 512) } : {}),
    template: {
      name: opts.template.name,
      languageCode: opts.template.languageCode || 'en',
      headerValues: opts.template.headerValues ?? [],
      bodyValues: opts.template.bodyValues ?? [],
    },
  };

  if (opts.dryRun) {
    console.log('[whatsapp][DRY RUN] template ->', JSON.stringify(payload));
    return { ok: true, dryRun: true, providerId: `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  }

  try {
    const { status, json, text } = await call('/message/', payload);
    if (status >= 200 && status < 300 && json?.result === true && typeof json.id === 'string') {
      return { ok: true, providerId: json.id, raw: json };
    }
    return readError(status, json, text);
  } catch (e) {
    return asFailure(e);
  }
}

// ── SEND FREE-FORM TEXT (only legal inside the 24-hour window) ───────────────
export async function sendText(opts: {
  phone: string;
  message: string;
  callbackData?: string;
  dryRun?: boolean;
}): Promise<SendResult> {
  const split = splitPhone(opts.phone);
  if (!split) {
    return { ok: false, code: 'bad_phone', detail: `Cannot parse phone number "${opts.phone}"` };
  }

  const payload = {
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    type: 'Text',
    ...(opts.callbackData ? { callbackData: opts.callbackData.slice(0, 512) } : {}),
    data: { message: opts.message },
  };

  if (opts.dryRun) {
    console.log('[whatsapp][DRY RUN] text ->', JSON.stringify(payload));
    return { ok: true, dryRun: true, providerId: `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  }

  try {
    const { status, json, text } = await call('/message/', payload);
    if (status >= 200 && status < 300 && json?.result === true && typeof json.id === 'string') {
      return { ok: true, providerId: json.id, raw: json };
    }
    return readError(status, json, text);
  } catch (e) {
    return asFailure(e);
  }
}


// ── SEND MEDIA ──────────────────────────────────────────────────────────────
// Interakt takes a PUBLICLY REACHABLE url and fetches the file itself; it will
// not accept a raw upload on this endpoint. Our bucket is private, so the
// caller passes a short-lived signed URL — long enough for Interakt to pull the
// bytes, short enough that a leaked link is worthless an hour later.
//
// mediaType maps to Interakt's `type`: Image | Document | Audio | Video.
export async function sendMedia(opts: {
  phone: string;
  mediaUrl: string;
  mediaType: 'image' | 'document' | 'audio' | 'video';
  fileName?: string;
  caption?: string;
  callbackData?: string;
  dryRun?: boolean;
}): Promise<SendResult> {
  const split = splitPhone(opts.phone);
  if (!split) {
    return { ok: false, code: 'bad_phone', detail: `Cannot parse phone number "${opts.phone}"` };
  }

  const typeMap = { image: 'Image', document: 'Document', audio: 'Audio', video: 'Video' } as const;

  const payload = {
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    type: typeMap[opts.mediaType],
    ...(opts.callbackData ? { callbackData: opts.callbackData.slice(0, 512) } : {}),
    data: {
      mediaUrl: opts.mediaUrl,
      ...(opts.fileName ? { fileName: opts.fileName } : {}),
      ...(opts.caption ? { caption: opts.caption } : {}),
    },
  };

  if (opts.dryRun) {
    // Never log the signed URL itself — it grants read access for its lifetime.
    console.log('[whatsapp][DRY RUN] media ->', JSON.stringify({
      ...payload, data: { ...payload.data, mediaUrl: '<signed-url-redacted>' },
    }));
    return { ok: true, dryRun: true, providerId: `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  }

  try {
    const { status, json, text } = await call('/message/', payload);
    if (status >= 200 && status < 300 && json?.result === true && typeof json.id === 'string') {
      return { ok: true, providerId: json.id, raw: json };
    }
    return readError(status, json, text);
  } catch (e) {
    return asFailure(e);
  }
}

/** Interakt's content-type strings -> our media_type enum. */
export function mediaTypeFromInterakt(contentType: string | null | undefined): 'image' | 'document' | 'audio' | 'video' | 'sticker' | null {
  const t = (contentType || '').toLowerCase();
  if (t.includes('image')) return 'image';
  if (t.includes('video')) return 'video';
  if (t.includes('audio') || t.includes('voice')) return 'audio';
  if (t.includes('sticker')) return 'sticker';
  if (t.includes('document') || t.includes('file')) return 'document';
  return null;
}

/** MIME -> our media_type enum, for files WE send. */
export function mediaTypeFromMime(mime: string): 'image' | 'document' | 'audio' | 'video' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

// ── CONNECTION TEST ─────────────────────────────────────────────────────────
// Interakt has no dedicated "ping" endpoint, so we prove the credential by
// making a deliberately invalid send and reading which way it fails:
//   401/403          -> the key is wrong. This is the answer we care about.
//   anything else    -> the key was accepted; the payload was rejected, which
//                       is exactly what we asked for.
// No message is ever created, so this is safe to run as often as you like.
export interface ConnectionResult {
  ok: boolean;
  code?: string;
  detail?: string;
}

export async function testConnection(): Promise<ConnectionResult> {
  if (!isConfigured()) {
    return { ok: false, code: 'not_configured', detail: 'INTERAKT_API_KEY is not set in the environment' };
  }
  try {
    const { status, json, text } = await call('/message/', {
      countryCode: '+91',
      phoneNumber: '0000000000',
      type: 'Template',
      template: { name: '__migrizo_connection_probe__', languageCode: 'en', bodyValues: [] },
    });

    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: 'unauthorized',
        detail:
          'Interakt rejected the API key. Most common cause: the key was copied ' +
          'from the wrong field — you need the Secret Key from Settings → Developer Setting.',
      };
    }
    if (status === 429) {
      return { ok: false, code: 'rate_limited', detail: 'Interakt rate limit hit. Wait a minute and retry.' };
    }
    if (status >= 500) {
      return { ok: false, code: 'provider_error', detail: `Interakt returned HTTP ${status}. Their side, not ours.` };
    }
    // 4xx that is not an auth failure means the credential worked.
    const note =
      (typeof json?.message === 'string' && json.message) || text.slice(0, 200) || `HTTP ${status}`;
    return { ok: true, detail: `Credential accepted (probe rejected as expected: ${note})` };
  } catch (e) {
    const f = asFailure(e);
    return { ok: false, code: f.code, detail: f.detail };
  }
}

// ── TEMPLATE RENDERING ──────────────────────────────────────────────────────
// Our stored body uses {{1}} {{2}} placeholders. Interakt wants the values as a
// positional array AND we want the rendered text to store on the message so the
// inbox shows exactly what the lead received.

export interface RenderedTemplate {
  /** Values in positional order, for Interakt's bodyValues. */
  bodyValues: string[];
  /** Fully substituted text, for whatsapp_messages.body. */
  text: string;
  /** Placeholders present in the body but with no value supplied. */
  missing: string[];
}

export function renderTemplate(
  body: string,
  variables: Array<{ n: string; label?: string; default?: string }>,
  values: Record<string, string>
): RenderedTemplate {
  // Trust the body, not the metadata: read the placeholders that are actually
  // there, in the order Meta will expect them.
  const found = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((m) => m[1]);
  const order = Array.from(new Set(found)).sort((a, b) => Number(a) - Number(b));

  const missing: string[] = [];
  const bodyValues = order.map((n) => {
    const meta = variables.find((v) => String(v.n) === n);
    const v = (values[n] ?? meta?.default ?? '').trim();
    if (!v) missing.push(n);
    return v;
  });

  let text = body;
  order.forEach((n, i) => {
    text = text.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), bodyValues[i] || `{{${n}}}`);
  });

  return { bodyValues, text, missing };
}
