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

interface AiVerdictShape {
  eligible: boolean;
  route: string;
  industry: string;
  reason: string;
  profile_md: string;
}

const MAX_CHARS = 28_000; // plenty for any CV; keeps the prompt bounded
const INDUSTRY_VOCAB = ['tech', 'research', 'art', 'engineering', 'education', 'business', 'healthcare', 'finance', 'other'] as const;

// ── THE ELIGIBILITY RUBRIC ──────────────────────────────────────────────────
// ONE rubric, shared by the text prompt and the vision prompt. They used to
// carry two separate copies of a much narrower description, so a CV sent as a
// PDF and the same CV photographed could be judged differently.
//
// The old wording described Digital Technology as "product/engineering
// leadership, scaling products, open-source impact, founding or senior roles at
// product-led tech companies" and then added "routine IT service roles ... are
// usually NOT eligible". Cybersecurity was never mentioned. Nor was data,
// infrastructure, DevOps, ML, semiconductors or telecom. A security architect
// matched none of the positive wording and every word of the negative, so the
// model rejected genuinely eligible people — which is exactly what happened.
//
// Two further corrections are load-bearing:
//   * Exceptional PROMISE exists. The old prompt only ever described the
//     proven-leader bar, so early-career candidates were judged against a
//     standard that does not apply to them.
//   * A WhatsApp CV is one or two pages. Talks, patents, CVEs, certifications
//     and publications are routinely absent from it. Absence of evidence on a
//     short CV is not evidence of an ineligible person.
const ELIGIBILITY_RUBRIC = `ENDORSEMENT ROUTES

- Digital Technology: the whole of the technology sector, not only product companies. Software engineering and development (frontend, backend, full-stack, mobile, web, embedded, firmware); architecture (solutions, technical, enterprise, platform); cloud and infrastructure (AWS, Azure, GCP, Kubernetes, Docker, Terraform, IaC, serverless, distributed systems, edge, SRE, DevOps, DevSecOps, MLOps, platform engineering); CYBERSECURITY in every form (security engineering, information security, security architecture, threat intelligence and research, SOC, incident response, digital forensics, network/cloud/application security, penetration testing, ethical hacking, vulnerability research, IAM, cryptography, zero trust, malware research, privacy engineering, cyber defence); AI and machine learning (AI/ML engineering and research, deep learning, NLP, computer vision, generative AI, LLMs, reinforcement learning, AI safety, AI infrastructure, applied AI); data (data science, data engineering, data architecture, big data, analytics, BI, quantitative analysis, decision science); computer science fundamentals (algorithms, distributed computing, operating systems, databases, networks, compilers, systems programming, HPC, parallel computing, quantum computing); fintech (payments, digital banking, open banking, regtech, insurtech, wealthtech, quantitative finance, algorithmic trading, fraud and AML technology); blockchain, DLT, smart contracts, Web3, DeFi; telecommunications (5G/6G, wireless, RF, satellite, optical, signal processing); semiconductors and hardware (chip and IC design, VLSI, ASIC, FPGA, microelectronics, processor architecture, embedded systems); robotics and autonomous systems (autonomous vehicles, drones/UAV, industrial robotics, human-robot interaction, IoT, digital twins, AR/VR/XR); health and bio technology (bioinformatics, computational biology, digital health, medtech, medical AI, genomics, drug discovery technology); energy and climate technology (renewables, batteries and storage, EV, hydrogen, smart grids, carbon capture, cleantech). Technical leadership counts as evidence, not as a separate category: CTO, CIO, CISO, VP/Head of Engineering or Technology, technical/engineering/R&D/innovation director, principal, staff, distinguished or lead engineer, technical fellow.

- Research & Academia: a research record in ANY scientific, engineering or technical discipline — PhD or doctoral candidacy, postdoctoral work, publications, citations, grants, patents, peer review, academic appointments, principal investigator roles, industrial R&D. This is the right route for the classical engineering disciplines (mechanical, electrical, electronic, civil, structural, chemical, aerospace, automotive, mechatronics, industrial, manufacturing, biomedical, materials, environmental, energy, petroleum, nuclear, marine, instrumentation, control, systems) when the person's case rests on research and innovation rather than on digital product work.

- Arts & Culture: significant creative work with media recognition, awards or international showings.

TWO STANDARDS, NOT ONE
- Exceptional Talent: already a recognised leader in the field.
- Exceptional Promise: EARLY-CAREER with strong potential to become one. Judge a candidate with under roughly eight years of experience against Promise, never against Talent. Missing this distinction wrongly rejects strong early-career people.

HOW TO JUDGE
- Do NOT rely on exact job-title matching. Equivalent, adjacent, interdisciplinary, specialist, senior, research, academic and leadership roles all count. Someone whose profession, education, research, publications, technical expertise, innovation or professional work sits anywhere in technology, computer science, AI, ML, data science, cybersecurity, software, cloud, engineering, scientific research, STEM, fintech, robotics, telecom, semiconductors, biotech, healthtech, energy tech, climate tech or blockchain is in scope.
- Never mark someone ineligible merely because their specialism is not named above, or because their title does not sound like a product role. Judge the substance of the work.
- A WhatsApp CV is one or two pages and routinely omits awards, talks, patents, publications and certifications. Do not treat a thin CV as a weak candidate — judge what the work itself implies.
- "Plausible with our help building the evidence portfolio" counts as ELIGIBLE. Reserve ineligible for someone genuinely years away from any credible case, or plainly outside every field above.
- When it is genuinely borderline, lean ELIGIBLE and say why in the reason. A wrong "no" is sent to the person and loses a real client; a wrong "yes" costs one consultation call. The two errors are not equal.`;

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

${ELIGIBILITY_RUBRIC}

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
        // Deterministic. The API default is 1.0, which is fine for prose and
        // wrong for a verdict: the same CV could come back eligible on one
        // run and not eligible on the next. A judgement must be reproducible.
        temperature: 0,
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

  return persistCvVerdict(admin, wsId, {
    leadId: opts.leadId,
    priorProfile: lead.profile_received as string | null,
    verdict,
    mediaPaths: [opts.mediaPath],
    source: 'whatsapp_cv',
    fileLabel: opts.mediaName,
  });
}

/**
 * The single write path for an accepted CV verdict — file, photo, or backfill.
 * Persists the profile + verdict on the lead, DELETES the source files
 * (founder rule: no document storage; the formatted text is the durable
 * copy), and logs the activity.
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

  // Delete the files — keep each message's NAME so the bubble still says what
  // arrived; clear the path so nothing dangles.
  if (opts.mediaPaths.length) {
    await admin.storage.from('whatsapp-media').remove(opts.mediaPaths);
    await admin.from('whatsapp_messages')
      .update({ media_path: null, media_source_url: null, updated_at: now })
      .eq('workspace_id', wsId)
      .in('media_path', opts.mediaPaths);
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

If it IS a CV, assess it for the UK Global Talent Visa using this rubric:

${ELIGIBILITY_RUBRIC}

Respond with ONLY a JSON object, no markdown fences:
{
  "is_cv": true|false,
  "eligible": true|false,
  "route": "Digital Technology" | "Research & Academia" | "Arts & Culture" | "None",
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
        // Deterministic — see the note on the text path. Same CV, same verdict.
        temperature: 0,
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
