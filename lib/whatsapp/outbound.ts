// =============================================================================
// OUTBOUND HELPER — the one way the autopilot sends a WhatsApp message.
//
// Three callers share this file: the Interakt webhook (inline T1 / T5 / T7),
// the intake drain (T2–T4, T6), and nothing else. It owns the discipline the
// /api/whatsapp/send route enforces for humans:
//
//   record the row FIRST  →  call Interakt  →  attach provider id  →  activity
//
// so a crash mid-send leaves a visible failed message in the inbox, never a
// silent gap.
//
// TEMPLATE TEXTS live in whatsapp_saved_replies — the founder typed T1–T7 into
// the Quick replies screen and this file finds them by shortcut ("t1") or
// title ("T1 …"). Placeholders are filled from ONE values map that understands
// both spellings the founder used:
//   {{1}} {{2}} {{3}}            positional, Meta style
//   {{name}} {{booking}} {{video}} {{pdf}} {{route}}   named, quick-reply style
// A placeholder left unfilled is a refusal to send, not a message with
// "{{2}}" in it — a lead must never see the machinery.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendText, sendTemplate, sendMedia, renderTemplate } from './interakt';

export interface WaSettings {
  workspace_id: string;
  connected: boolean;
  dry_run: boolean;
  sending_paused: boolean;
  campaigns_paused: boolean;
  booking_url: string | null;
  pdf_url: string | null;
  video_url: string | null;
}

export async function getWaSettings(admin: SupabaseClient): Promise<WaSettings | null> {
  const { data } = await admin
    .from('whatsapp_settings')
    .select('workspace_id, connected, dry_run, sending_paused, campaigns_paused, booking_url, pdf_url, video_url')
    .order('connected', { ascending: false })
    .limit(1);
  return (data?.[0] as WaSettings) ?? null;
}

export const firstName = (n: string | null | undefined): string =>
  (n || '').replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, '').trim().split(/\s+/)[0] || 'there';

// ── T1–T7 lookup in Quick replies ───────────────────────────────────────────
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function resolveSavedReply(
  admin: SupabaseClient,
  wsId: string,
  tKey: string // 't1' … 't7'
): Promise<{ id: string; body: string } | null> {
  const { data } = await admin
    .from('whatsapp_saved_replies')
    .select('id, shortcut, title, body')
    .eq('workspace_id', wsId);
  if (!data?.length) return null;

  const want = normKey(tKey);
  // Exact shortcut wins; then a title that STARTS with the key and is not a
  // longer number ("T1" must not match a future "T10").
  const exact = data.find((r) => normKey(r.shortcut) === want);
  if (exact) return { id: exact.id, body: exact.body };
  const byTitle = data.find((r) => new RegExp(`^${want}(?![0-9])`).test(normKey(r.title)));
  return byTitle ? { id: byTitle.id, body: byTitle.body } : null;
}

// ── placeholder filling ─────────────────────────────────────────────────────
export interface FillResult { text: string; missing: string[] }

export function fillPlaceholders(body: string, values: Record<string, string>): FillResult {
  const missing: string[] = [];
  const text = body.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, token: string) => {
    const v = (values[token] ?? values[token.toLowerCase()] ?? '').trim();
    if (!v) { missing.push(token); return `{{${token}}}`; }
    return v;
  });
  return { text, missing: Array.from(new Set(missing)) };
}

/**
 * The variable contract for each template, written down once.
 * T1/T2 carry no variables by design (the founder wrote them that way).
 */
export function valuesFor(
  step: number,
  ctx: { first: string; route?: string | null; video?: string | null; booking?: string | null; pdf?: string | null }
): Record<string, string> {
  const named: Record<string, string> = {
    name: ctx.first,
    route: ctx.route || '',
    video: ctx.video || '',
    booking: ctx.booking || '',
    pdf: ctx.pdf || '',
  };
  switch (step) {
    case 3:
    case 4:
    case 7: return { ...named, '1': ctx.first };
    case 5: return { ...named, '1': ctx.first, '2': ctx.route || '', '3': ctx.video || '' };
    case 6: return { ...named, '1': ctx.first, '2': ctx.booking || '' };
    default: return named; // T1, T2
  }
}

// ── the send itself ─────────────────────────────────────────────────────────
export interface OutboundResult { ok: boolean; code?: string; detail?: string; messageId?: string }

async function recordAndAttach(
  admin: SupabaseClient,
  wsId: string,
  opts: {
    phone: string; body: string; leadId: string | null; step: string;
    templateCode?: string | null; category?: string | null; variables?: Record<string, string> | null;
    mediaName?: string | null; mediaType?: string | null;
  },
  fire: (callbackData: string) => Promise<{ ok: boolean; providerId?: string; code?: string; detail?: string }>
): Promise<OutboundResult> {
  const { data: rec } = await admin.rpc('whatsapp_record_outbound', {
    p_workspace_id: wsId,
    p_phone: opts.phone,
    p_body: opts.body,
    p_template_code: opts.templateCode ?? null,
    p_category: opts.category ?? null,
    p_variables: opts.variables ?? null,
    p_sent_by: null, // automation
    p_lead_id: opts.leadId,
    p_step: opts.step,
    p_media_path: null,
    p_media_type: opts.mediaType ?? null,
    p_media_name: opts.mediaName ?? null,
    p_media_mime: null,
    p_media_size: null,
  });
  const r = (rec ?? {}) as { ok?: boolean; reason?: string; message_id?: string };
  if (!r.ok || !r.message_id) {
    return {
      ok: false,
      code: r.reason === 'suppressed' ? 'suppressed' : 'record_failed',
      detail: r.reason === 'suppressed'
        ? 'number opted out — nothing can be sent to it'
        : (r.reason || 'could not record the message'),
    };
  }

  const result = await fire(r.message_id);
  if (!result.ok) {
    await admin.from('whatsapp_messages').update({
      status: 'failed',
      error_code: result.code ?? 'send_failed',
      error_detail: (result.detail ?? '').slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', r.message_id);
    return { ok: false, code: result.code ?? 'send_failed', detail: result.detail, messageId: r.message_id };
  }
  if (result.providerId) {
    await admin.rpc('whatsapp_attach_provider_id', {
      p_message_id: r.message_id, p_provider_id: result.providerId,
    });
  }
  if (opts.leadId) {
    await admin.from('activity').insert({
      workspace_id: wsId, user_id: null, lead_id: opts.leadId,
      action: 'whatsapp_sent',
      meta: { auto: true, step: opts.step, template: opts.templateCode ?? null },
    });
  }
  return { ok: true, messageId: r.message_id };
}

/** Free-form text — only legal while the lead's 24h window is open. */
export async function sendSessionText(
  admin: SupabaseClient,
  wsId: string,
  opts: { phone: string; leadId: string | null; body: string; step: string; dryRun: boolean }
): Promise<OutboundResult> {
  return recordAndAttach(admin, wsId,
    { phone: opts.phone, body: opts.body, leadId: opts.leadId, step: opts.step },
    (callbackData) => sendText({ phone: opts.phone, message: opts.body, callbackData, dryRun: opts.dryRun }));
}

/**
 * Meta-approved template — the only thing that can reach a closed window.
 * The template row is matched to the T-key by code ("t3", "…_t3") or name, so
 * whatever naming Interakt forces on approval, it still resolves.
 */
export async function sendApprovedTemplate(
  admin: SupabaseClient,
  wsId: string,
  opts: { phone: string; leadId: string | null; tKey: string; values: Record<string, string>; step: string; dryRun: boolean }
): Promise<OutboundResult> {
  const { data: tpls } = await admin
    .from('whatsapp_templates')
    .select('code, name, body, variables, language, category, meta_status, active')
    .eq('workspace_id', wsId)
    .eq('active', true);

  const want = normKey(opts.tKey);
  const tpl = (tpls ?? []).find((t) => {
    const code = normKey(t.code || '');
    const name = normKey(t.name || '');
    return code === want || code.endsWith(want) || new RegExp(`^${want}(?![0-9])`).test(name);
  });

  if (!tpl) {
    return { ok: false, code: 'template_missing', detail: `No template matching "${opts.tKey}" exists yet — create it in the Templates tab and submit to Meta.` };
  }
  if (tpl.meta_status !== 'approved' && !opts.dryRun) {
    return { ok: false, code: 'template_not_approved', detail: `Template "${tpl.code}" is ${tpl.meta_status} — Meta has not approved it yet.` };
  }

  const vars = Array.isArray(tpl.variables) ? tpl.variables : [];
  const rendered = renderTemplate(tpl.body, vars, opts.values);
  if (rendered.missing.length) {
    return { ok: false, code: 'missing_variables', detail: `Template "${tpl.code}" is missing ${rendered.missing.map((n) => `{{${n}}}`).join(', ')}` };
  }

  return recordAndAttach(admin, wsId,
    {
      phone: opts.phone, body: rendered.text, leadId: opts.leadId, step: opts.step,
      templateCode: tpl.code, category: tpl.category, variables: opts.values,
    },
    (callbackData) => sendTemplate({
      phone: opts.phone,
      template: { name: tpl.code, languageCode: tpl.language || 'en', bodyValues: rendered.bodyValues },
      callbackData, dryRun: opts.dryRun,
    }));
}

/** The process document that rides along with T5, when settings.pdf_url is set. */
export async function sendProcessDocument(
  admin: SupabaseClient,
  wsId: string,
  opts: { phone: string; leadId: string | null; pdfUrl: string; step: string; dryRun: boolean }
): Promise<OutboundResult> {
  return recordAndAttach(admin, wsId,
    {
      phone: opts.phone, body: '📄 Migrizo — how the process works', leadId: opts.leadId,
      step: opts.step, mediaName: 'Migrizo Process.pdf', mediaType: 'document',
    },
    (callbackData) => sendMedia({
      phone: opts.phone, mediaUrl: opts.pdfUrl, mediaType: 'document',
      fileName: 'Migrizo Process.pdf', callbackData, dryRun: opts.dryRun,
    }));
}
