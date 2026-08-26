// =============================================================================
// PROFILE PIPELINE — a CV lands in the chat, and 30 seconds later the lead
// has a formatted text profile, an industry, and an eligibility verdict.
//
// THE FILE IS DELETED. Founder rule: the CRM keeps no documents. The bytes are
// pulled from storage, the text is extracted, and the object is removed — what
// survives is leads.profile_text (the formatted profile behind the drawer's
// Profile button) and leads.profile_ai (the verdict working-out). The message
// row keeps its file NAME so the inbox still reads "📄 CV.pdf", but the path
// is cleared so nothing can fetch bytes that no longer exist.
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

export interface ProfileVerdict {
  ok: boolean;
  skipped?: string;
  eligible?: boolean;
  route?: string;
  industry?: string;
  reason?: string;
  profileText?: string;
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
    if (isDoc) return null; // legacy .doc — no safe pure-JS parser; human reads it
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

  const prompt = `You are the intake reviewer for Migrizo, a premium UK immigration consultancy. A prospective client named "${leadName}" sent this CV over WhatsApp. Assess it for the UK Global Talent Visa.

Global Talent endorsement paths and what a plausible candidate looks like:
- Digital Technology (Tech Nation criteria): product/engineering leadership, scaling products, open-source impact, founding or senior roles at product-led tech companies.
- Research & Academia: PhD or equivalent research record, publications, grants, peer review, academic appointments.
- Arts & Culture: significant creative work with media recognition, awards, international showings.

Judge STRICTLY on evidence in the CV. "Plausible with our help building the evidence portfolio" counts as eligible; "years away from any credible case" does not. Routine IT service roles with no leadership, product ownership, or external recognition are usually NOT eligible.

Respond with ONLY a JSON object, no markdown fences:
{
  "eligible": true|false,
  "route": "Digital Technology" | "Research & Academia" | "Arts & Culture" | "None",
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

  const { data: blob, error: dlErr } = await admin.storage
    .from('whatsapp-media')
    .download(opts.mediaPath);
  if (dlErr || !blob) return { ok: false, skipped: `download_failed: ${dlErr?.message ?? 'no data'}` };

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = await extractText(bytes, opts.mediaMime || '', opts.mediaName || '');

  if (!text || text.trim().length < 300) {
    // Scanned/corrupt/legacy file — do not guess, do not delete, wave a human over.
    await flagAttention(admin, wsId, opts.conversationId);
    return { ok: false, skipped: 'unreadable_document' };
  }

  const verdict = await judgeCv(text, opts.leadName);
  if (!verdict) {
    await flagAttention(admin, wsId, opts.conversationId);
    return { ok: false, skipped: 'ai_unavailable' };
  }

  // Persist onto the lead — profile first, verdict second, both idempotent.
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    profile_text: verdict.profile_md,
    profile_ai: {
      eligible: verdict.eligible, route: verdict.route, reason: verdict.reason,
      industry: verdict.industry, model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', at: now,
    },
    profile_received: lead.profile_received === 'linkedin' ? 'both' : 'cv',
    profile_received_at: now,
    eligibility: verdict.eligible ? 'eligible' : 'not_eligible',
    eligibility_at: now,
    eligibility_source: 'ai',
  };
  const { data: ld } = await admin.from('leads').select('industry').eq('id', opts.leadId).maybeSingle();
  if (!ld?.industry) patch.industry = verdict.industry;

  await admin.from('leads').update(patch).eq('id', opts.leadId);

  // Delete the file — the founder's storage rule. Keep the NAME on the message
  // so the bubble still says what arrived; clear the path so nothing dangles.
  await admin.storage.from('whatsapp-media').remove([opts.mediaPath]);
  await admin.from('whatsapp_messages')
    .update({ media_path: null, media_source_url: null, updated_at: now })
    .eq('workspace_id', wsId)
    .eq('media_path', opts.mediaPath);

  await admin.from('activity').insert({
    workspace_id: wsId, user_id: null, lead_id: opts.leadId,
    action: 'profile_received',
    meta: {
      auto: true, source: 'whatsapp_cv', eligible: verdict.eligible,
      route: verdict.route, industry: verdict.industry, file: opts.mediaName,
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
