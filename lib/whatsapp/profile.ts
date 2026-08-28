// =============================================================================
// PROFILE PIPELINE — a CV lands in the chat, and moments later the lead has
// a formatted text profile, an industry, and an eligibility verdict.
//
// THE FILE IS KEPT (founder decision, v2). The team opens CVs from the inbox
// long after the verdict, so the original file stays in storage under its
// original name — a file with no name gets "<Lead> — CV.<ext>". Bulk
// clean-up is a deliberate act: the "Delete all stored CVs" button in
// WhatsApp Settings, never an automatic side effect.
//
// VERDICT SAFETY
//   * A human's verdict is never overwritten: eligibility_source='manual' stops
//     this pipeline cold.
//   * A rejection is only as good as its reason — the reason is stored and
//     shown, never just a boolean.
//   * Extraction shorter than 300 chars (image-only PDF, corrupt file) does
//     NOT guess. It flags the conversation for a human and keeps the file.
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { keywordEligibility, ELIGIBILITY_PROMPT_BLOCK } from './eligibility';

export interface ProfileVerdict {
  ok: boolean;
  skipped?: string;
  eligible?: boolean;
  route?: string;
  industry?: string;
  reason?: string;
  profileText?: string;
}

interface AiVerdictShape {
  eligible: boolean;
  route: string;
  industry: string;
  reason: string;
  profile_md: string;
}

const MAX_CHARS = 28_000; // plenty for any CV; keeps the prompt bounded
const INDUSTRY_VOCAB = ['tech', 'research', 'art', 'engineering', 'education', 'business', 'healthcare', 'finance', 'other'] as const;

// ── text extraction ─────────────────────────────────────────────────────────
async function extractText(bytes: Uint8Array, mime: string, name: string): Promise<string | null> {
  const lower = (name || '').toLowerCase();
  const isPdf = mime.includes('pdf') || lower.endsWith('.pdf');
  const isDocx = mime.includes('officedocument.wordprocessingml') || lower.endsWith('.docx');
  const isDoc = mime === 'application/msword' || lower.endsWith('.doc');

  try {
    if (isPdf) {
      // Import the inner module directly — pdf-parse's index.js runs a debug
      // harness on import that breaks under Next's bundler.
      const mod = (await import('pdf-parse/lib/pdf-parse.js')) as unknown as {
        default: (b: Buffer) => Promise<{ text: string }>;
      };
      const parse = typeof mod.default === 'function' ? mod.default : (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
      const out = await parse(Buffer.from(bytes));
      return out.text || null;
    }
    if (isDocx) {
      const mammoth = await import('mammoth');
      const out = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return out.value || null;
    }
    if (isDoc) {
      // Legacy binary .doc — still a third of Indian CVs. word-extractor
      // parses the OLE container in pure JS.
      const { default: WordExtractor } = await import('word-extractor');
      const doc = await new WordExtractor().extract(Buffer.from(bytes));
      return doc.getBody() || null;
    }
    return null;
  } catch (e) {
    console.error('[profile] extraction failed', e);
    return null;
  }
}

// ── the verdict call ────────────────────────────────────────────────────────
interface AiVerdict {
  eligible: boolean;
  route: string;
  industry: string;
  reason: string;
  profile_md: string;
}

async function judgeCv(cvText: string, leadName: string): Promise<AiVerdict | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const prompt = `You are the intake reviewer for Migrizo, a premium UK immigration consultancy. A prospective client named "${leadName}" sent this CV over WhatsApp.
${ELIGIBILITY_PROMPT_BLOCK}

Respond with ONLY a JSON object, no markdown fences:
{
  "eligible": true|false,
  "route": a short route name, e.g. "Digital Technology", "Digital Technology — Cybersecurity", "Research & Academia", "Engineering & Technology", "Arts & Culture", or "None",
  "industry": one of ${JSON.stringify(INDUSTRY_VOCAB)},
  "reason": "2-3 plain sentences a consultant can read aloud",
  "profile_md": "the CV reformatted as clean markdown: ## Name & headline, ## Experience (role — company — years, one line each), ## Education, ## Achievements & recognition (awards, publications, patents, media), ## Links. Keep every fact, invent nothing."
}

CV TEXT:
${cvText.slice(0, MAX_CHARS)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error('[profile] anthropic call failed', res.status, await res.text().catch(() => ''));
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((c) => c.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<AiVerdict>;
    if (typeof parsed.eligible !== 'boolean' || !parsed.profile_md) return null;
    return {
      eligible: parsed.eligible,
      route: parsed.route || 'None',
      industry: INDUSTRY_VOCAB.includes((parsed.industry || '') as typeof INDUSTRY_VOCAB[number])
        ? (parsed.industry as string) : 'other',
      reason: parsed.reason || '',
      profile_md: parsed.profile_md,
    };
  } catch (e) {
    console.error('[profile] anthropic call threw', e);
    return null;
  }
}

// ── judgement claim ─────────────────────────────────────────────────────────
// Two photos of a two-page CV arrive seconds apart → two concurrent webhook
// invocations. Without an arbiter BOTH would judge and BOTH would send T5.
// The claim is one atomic conditional UPDATE on the lead: whoever flips
// profile_ai from NULL wins; everyone else walks away. Released on every
// failure path; consumed (overwritten with the real verdict) on success.
export async function claimProfileJudgement(admin: SupabaseClient, leadId: string): Promise<boolean> {
  const { data } = await admin
    .from('leads')
    .update({ profile_ai: { status: 'processing', at: new Date().toISOString() } })
    .eq('id', leadId)
    .is('profile_ai', null)
    .is('profile_text', null)
    .or('eligibility_source.is.null,eligibility_source.neq.manual')
    .select('id');
  return (data?.length ?? 0) > 0;
}

export async function releaseProfileJudgement(admin: SupabaseClient, leadId: string): Promise<void> {
  await admin.from('leads')
    .update({ profile_ai: null })
    .eq('id', leadId)
    .contains('profile_ai', { status: 'processing' });
}

// ── the pipeline ────────────────────────────────────────────────────────────
export async function processCvMessage(
  admin: SupabaseClient,
  wsId: string,
  opts: {
    leadId: string;
    leadName: string;
    conversationId: string;
    mediaPath: string;      // storage path in whatsapp-media
    mediaName: string | null;
    mediaMime: string | null;
    providerMsgId: string | null;
  }
): Promise<ProfileVerdict> {
  // A human's verdict is final; a second CV needs a human, not a second robot.
  const { data: lead } = await admin
    .from('leads')
    .select('id, profile_received, eligibility_source')
    .eq('id', opts.leadId)
    .maybeSingle();
  if (!lead) return { ok: false, skipped: 'lead_gone' };
  if (lead.eligibility_source === 'manual') return { ok: false, skipped: 'manual_verdict_exists' };
  if (lead.profile_received === 'cv' || lead.profile_received === 'both') {
    await flagAttention(admin, wsId, opts.conversationId);
    return { ok: false, skipped: 'second_cv_needs_human' };
  }

  // Atomic arbiter — a photo arriving in the same second must not also judge.
  if (!(await claimProfileJudgement(admin, opts.leadId))) {
    return { ok: false, skipped: 'judgement_in_progress' };
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from('whatsapp-media')
    .download(opts.mediaPath);
  if (dlErr || !blob) {
    await releaseProfileJudgement(admin, opts.leadId);
    return { ok: false, skipped: `download_failed: ${dlErr?.message ?? 'no data'}` };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = await extractText(bytes, opts.mediaMime || '', opts.mediaName || '');

  if (!text || text.trim().length < 300) {
    // Scanned/corrupt/legacy file — do not guess, do not delete, wave a human over.
    await releaseProfileJudgement(admin, opts.leadId);
    await flagAttention(admin, wsId, opts.conversationId);
    return { ok: false, skipped: 'unreadable_document' };
  }

  const verdict = await judgeCv(text, opts.leadName);
  if (!verdict) {
    await releaseProfileJudgement(admin, opts.leadId);
    await flagAttention(admin, wsId, opts.conversationId);
    return { ok: false, skipped: 'ai_unavailable' };
  }

  // THE SAFETY NET (founder rulebook): a CV whose text matches the
  // eligibility dictionary can NEVER go out as not-eligible, whatever the
  // model concluded. The override is recorded so the drawer shows both.
  if (!verdict.eligible) {
    const kw = keywordEligibility(text);
    if (kw.eligible) {
      verdict.eligible = true;
      verdict.route = kw.route || verdict.route || 'Digital Technology';
      if (kw.industry) verdict.industry = kw.industry;
      verdict.reason = `Rulebook match (${kw.matched.slice(0, 5).join(', ')}). ${verdict.reason}`.slice(0, 500);
    }
  }

  return persistCvVerdict(admin, wsId, {
    leadId: opts.leadId,
    priorProfile: lead.profile_received as string | null,
    verdict,
    mediaPaths: [opts.mediaPath],
    source: 'whatsapp_cv',
    fileLabel: opts.mediaName,
    leadDisplayName: opts.leadName,
  });
}

/**
 * The single write path for an accepted CV verdict — file, photo, or backfill.
 * Persists the profile + verdict on the lead, KEEPS the source files (named
 * after the lead when the upload carried no name), and logs the activity.
 */
async function persistCvVerdict(
  admin: SupabaseClient,
  wsId: string,
  opts: {
    leadId: string;
    priorProfile: string | null;
    verdict: AiVerdictShape;
    mediaPaths: string[];
    source: 'whatsapp_cv' | 'whatsapp_cv_image';
    fileLabel: string | null;
    leadDisplayName?: string | null;
  }
): Promise<ProfileVerdict> {
  const { verdict } = opts;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    profile_text: verdict.profile_md,
    profile_ai: {
      eligible: verdict.eligible, route: verdict.route, reason: verdict.reason,
      industry: verdict.industry, source: opts.source,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', at: now,
    },
    profile_received: opts.priorProfile === 'linkedin' ? 'both' : 'cv',
    profile_received_at: now,
    eligibility: verdict.eligible ? 'eligible' : 'not_eligible',
    eligibility_at: now,
    eligibility_source: 'ai',
  };
  const { data: ld } = await admin.from('leads').select('industry').eq('id', opts.leadId).maybeSingle();
  if (!ld?.industry) patch.industry = verdict.industry;

  await admin.from('leads').update(patch).eq('id', opts.leadId);

  // KEEP the files. Only fix meaningless auto-names ("document-1724….pdf")
  // so the inbox reads "Satpreet Kaur — CV.pdf" instead of a timestamp.
  if (opts.mediaPaths.length) {
    const { data: msgRows } = await admin.from('whatsapp_messages')
      .select('id, media_path, media_name')
      .eq('workspace_id', wsId)
      .in('media_path', opts.mediaPaths);
    for (const m of msgRows ?? []) {
      const genericName = !m.media_name || /^(document|image|file|img|doc)[-_ ]?[\d.]*\.\w+$/i.test(m.media_name);
      if (genericName) {
        const ext = (m.media_path as string).split('.').pop() || 'pdf';
        await admin.from('whatsapp_messages')
          .update({ media_name: `${opts.leadDisplayName || 'Lead'} — CV.${ext}`, updated_at: now })
          .eq('id', m.id);
      }
    }
  }

  await admin.from('activity').insert({
    workspace_id: wsId, user_id: null, lead_id: opts.leadId,
    action: 'profile_received',
    meta: {
      auto: true, source: opts.source, eligible: verdict.eligible,
      route: verdict.route, industry: verdict.industry, file: opts.fileLabel,
      pages: opts.mediaPaths.length,
    },
  });

  return {
    ok: true,
    eligible: verdict.eligible,
    route: verdict.route,
    industry: verdict.industry,
    reason: verdict.reason,
    profileText: verdict.profile_md,
  };
}

// ── the PHOTO pipeline ──────────────────────────────────────────────────────
// A CV photographed with a phone — one image or several pages within minutes.
// The vision model carries an is-this-even-a-CV gate: a selfie, a payment
// screenshot or a meme is answered with is_cv=false and LEFT ALONE (no
// deletion, no verdict, no flag). Only a genuine CV is judged and cleaned up.
const MAX_IMAGE_BYTES = 4_500_000; // Claude's per-image ceiling, with margin

export async function processCvImages(
  admin: SupabaseClient,
  wsId: string,
  opts: {
    leadId: string;
    leadName: string;
    conversationId: string;
    images: Array<{ path: string; mime: string | null }>;
    /** Caller already holds the judgement claim (webhook settle path). */
    claimHeld?: boolean;
  }
): Promise<ProfileVerdict> {
  const { data: lead } = await admin
    .from('leads')
    .select('id, profile_received, eligibility_source')
    .eq('id', opts.leadId)
    .maybeSingle();
  if (!lead) return { ok: false, skipped: 'lead_gone' };
  if (lead.eligibility_source === 'manual') return { ok: false, skipped: 'manual_verdict_exists' };
  if (lead.profile_received === 'cv' || lead.profile_received === 'both') {
    // They already sent a CV that was judged — a new image is a human's call.
    return { ok: false, skipped: 'cv_already_processed' };
  }

  if (!opts.claimHeld && !(await claimProfileJudgement(admin, opts.leadId))) {
    return { ok: false, skipped: 'judgement_in_progress' };
  }
  const bail = async (skipped: string, flag = false): Promise<ProfileVerdict> => {
    await releaseProfileJudgement(admin, opts.leadId);
    if (flag) await flagAttention(admin, wsId, opts.conversationId);
    return { ok: false, skipped };
  };

  // Claude accepts exactly four image types. Anything else (HEIC, SVG) is
  // SKIPPED, not relabeled — a lied-about media type fails the whole call.
  const toMediaType = (mime: string | null): string | null => {
    const m = (mime || '').toLowerCase();
    if (m.includes('png')) return 'image/png';
    if (m.includes('webp')) return 'image/webp';
    if (m.includes('gif')) return 'image/gif';
    if (m.includes('jpg') || m.includes('jpeg')) return 'image/jpeg';
    return null;
  };

  const blocks: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [];
  const usedPaths: string[] = [];
  for (const img of opts.images.slice(0, 4)) {
    const mediaType = toMediaType(img.mime);
    if (!mediaType) continue;
    const { data: blob } = await admin.storage.from('whatsapp-media').download(img.path);
    if (!blob) continue;
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) continue;
    blocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } });
    usedPaths.push(img.path);
  }
  if (!blocks.length) return bail('no_readable_images');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return bail('ai_unavailable', true);
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  const prompt = `You are the intake reviewer for Migrizo, a premium UK immigration consultancy. A prospective client named "${opts.leadName}" sent ${blocks.length === 1 ? 'this image' : `these ${blocks.length} images`} over WhatsApp.

FIRST decide: is this actually a CV / resume (possibly photographed pages of one)? A selfie, screenshot, certificate photo, payment proof or anything else is NOT a CV.

If it IS a CV, assess it using this binding rulebook:
${ELIGIBILITY_PROMPT_BLOCK}
Transcribe faithfully from the images; judge on what is visible.

Respond with ONLY a JSON object, no markdown fences:
{
  "is_cv": true|false,
  "eligible": true|false,
  "route": a short route name, e.g. "Digital Technology", "Digital Technology — Cybersecurity", "Research & Academia", "Engineering & Technology", "Arts & Culture", or "None",
  "industry": one of ${JSON.stringify(INDUSTRY_VOCAB)},
  "reason": "2-3 plain sentences a consultant can read aloud",
  "profile_md": "if is_cv: every fact from the images as clean markdown — ## Name & headline, ## Experience, ## Education, ## Achievements & recognition, ## Links. Transcribe faithfully, invent nothing. If not a CV: empty string."
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 3000,
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }],
      }),
    });
    if (!res.ok) {
      console.error('[profile] vision call failed', res.status, await res.text().catch(() => ''));
      return bail('ai_unavailable', true);
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.find((c) => c.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return bail('ai_bad_response');
    const parsed = JSON.parse(match[0]) as Partial<AiVerdictShape> & { is_cv?: boolean };

    if (parsed.is_cv !== true) return bail('not_a_cv');
    if (typeof parsed.eligible !== 'boolean' || !parsed.profile_md) {
      return bail('ai_bad_response', true);
    }

    // Safety net on the TRANSCRIBED text: the dictionary outranks the model
    // for photos exactly as it does for files.
    if (!parsed.eligible) {
      const kw = keywordEligibility(parsed.profile_md);
      if (kw.eligible) {
        parsed.eligible = true;
        parsed.route = kw.route || parsed.route || 'Digital Technology';
        if (kw.industry) parsed.industry = kw.industry;
        parsed.reason = `Rulebook match (${kw.matched.slice(0, 5).join(', ')}). ${parsed.reason ?? ''}`.slice(0, 500);
      }
    }

    return persistCvVerdict(admin, wsId, {
      leadId: opts.leadId,
      priorProfile: lead.profile_received as string | null,
      verdict: {
        eligible: parsed.eligible,
        route: parsed.route || 'None',
        industry: INDUSTRY_VOCAB.includes((parsed.industry || '') as typeof INDUSTRY_VOCAB[number])
          ? (parsed.industry as string) : 'other',
        reason: parsed.reason || '',
        profile_md: parsed.profile_md,
      },
      mediaPaths: usedPaths,
      source: 'whatsapp_cv_image',
      fileLabel: `${usedPaths.length} photo${usedPaths.length === 1 ? '' : 's'}`,
      leadDisplayName: opts.leadName,
    });
  } catch (e) {
    console.error('[profile] vision pipeline threw', e);
    await releaseProfileJudgement(admin, opts.leadId);
    return { ok: false, skipped: 'error' };
  }
}

/** LinkedIn URL with no CV: record it, and hand the judgement to a human — we cannot read LinkedIn. */
export async function recordLinkedInOnly(
  admin: SupabaseClient,
  wsId: string,
  opts: { leadId: string; conversationId: string; url: string }
): Promise<void> {
  const { data: lead } = await admin
    .from('leads').select('profile_received').eq('id', opts.leadId).maybeSingle();
  if (!lead || lead.profile_received === 'both') return;
  const now = new Date().toISOString();
  await admin.from('leads').update({
    profile_received: lead.profile_received === 'cv' ? 'both' : 'linkedin',
    profile_received_at: now,
  }).eq('id', opts.leadId);
  await admin.from('activity').insert({
    workspace_id: wsId, user_id: null, lead_id: opts.leadId,
    action: 'profile_received',
    meta: { auto: true, source: 'whatsapp_linkedin', url: opts.url },
  });
  await flagAttention(admin, wsId, opts.conversationId);
}

async function flagAttention(admin: SupabaseClient, _wsId: string, conversationId: string): Promise<void> {
  await admin.from('whatsapp_conversations')
    .update({ needs_attention: true, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
}
