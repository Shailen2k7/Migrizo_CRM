// =============================================================================
// META LEAD INGEST — public endpoint hit by the Make.com scenario
// (Facebook New Lead → Get Lead Details → HTTP POST here).
//
// Secured by a shared token (INGEST_SECRET) rather than a user session, so it
// must be listed in middleware PUBLIC_PATHS. Uses the Supabase service role to
// insert the lead (bypassing RLS, since there is no logged-in user).
//
// Expected JSON body (exactly what Make sends):
//   {
//     "token": "...", "full_name": "...", "phone": "...", "email": "...",
//     "expertise": "...",              // "Field of expertise?" — Meta sends an array
//     "investment_readiness": "..."    // "Readiness to invest?" — Meta sends an array
//   }
//
// The two qualifying answers are stored TWICE, deliberately. The derived enums
// (industry, investment_readiness) are what every queue filter, sequence
// audience and report reads. The raw answers go to leads.intake untouched, so a
// mapping mistake can never destroy the original and a question added to the
// form tomorrow lands here with no code change. See lib/intake.ts.
// =============================================================================
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { renderProcess } from '@/lib/email/branded';
import { flattenAnswer, mapExpertise, mapReadiness, detectAnswers } from '@/lib/intake';

// Core fields the route understands. Anything else in the body is treated as an
// extra ad-form answer and kept verbatim in leads.intake.
const CORE_KEYS = new Set([
  'token', 'full_name', 'phone', 'email', 'visa_type', 'source',
  // Optional attribution Make can send from "Get Lead Details". All are
  // optional — the endpoint works exactly as before when they are absent.
  'meta_lead_id', 'created_time', 'ad_name', 'form_name', 'campaign_name', 'platform',
]);

/** Meta's CSV export prefixes phone with "p:" and form ids with "f:". Strip them. */
const unprefix = (v: string) => v.replace(/^[a-z]:/i, '').trim();



export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Logs the outcome of every POST — including the rejected ones, which used to
 * vanish without trace. Fire-and-forget and fully guarded: if 085 has not been
 * applied, or the insert fails, lead creation carries on untouched.
 */
async function logIngest(
  admin: SupabaseClient | null,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = admin || (url && key ? createClient(url, key, { auth: { persistSession: false } }) : null);
    if (!db) return;
    await db.from('ingest_log').insert(row as never);
  } catch { /* logging must never be the reason a lead is lost */ }
}

export async function POST(req: Request) {
  const t0 = Date.now();
  // ---- parse body ----------------------------------------------------------
  let body: {
    token?: string; full_name?: string; phone?: string; email?: string;
    visa_type?: string; source?: string;
    // Meta sends these as arrays; flattenAnswer copes with array, string or "[]".
    expertise?: unknown; investment_readiness?: unknown;
    [k: string]: unknown;
  };
  try {
    body = await req.json();
  } catch {
    await logIngest(null, { outcome: 'rejected', reason: 'bad_json', ms: Date.now() - t0 });
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  // ---- auth: shared token --------------------------------------------------
  const expected = process.env.INGEST_SECRET;
  if (!expected || body.token !== expected) {
    await logIngest(null, {
      outcome: 'rejected', reason: 'unauthorized', ms: Date.now() - t0,
      // The token itself is never logged. The rest is, so a misconfigured
      // scenario is identifiable at a glance.
      full_name: String(body.full_name || '') || null,
      payload: { has_token: Boolean(body.token) },
    });
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  // ---- required field ------------------------------------------------------
  const fullName = (body.full_name || '').trim();
  if (!fullName) {
    // The single most likely silent failure: Make's field mapping broke after a
    // form was renamed. The whole payload is kept so you can see what arrived.
    await logIngest(null, {
      outcome: 'rejected', reason: 'missing_name', ms: Date.now() - t0,
      phone: String(body.phone || '') || null,
      email: String(body.email || '') || null,
      payload: body as Record<string, unknown>,
    });
    return NextResponse.json({ ok: false, reason: 'missing_name' }, { status: 400 });
  }
  const phone = unprefix(body.phone || '') || null;
  const email = (body.email || '').trim().toLowerCase() || null;

  // Optional attribution from Make. Absent on older scenarios; that is fine.
  const metaLeadId = unprefix(String(body.meta_lead_id || '')) || null;
  const submittedAt = (() => {
    const raw = String(body.created_time || '').trim();
    if (!raw) return new Date().toISOString();
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();

  // ---- ad-form intake ------------------------------------------------------
  // Raw first: every non-core key is kept exactly as it arrived, flattened only
  // from Meta's array wrapper. Derived second, from that same raw text.
  const intake: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (CORE_KEYS.has(k)) continue;
    const flat = flattenAnswer(v);
    if (flat) intake[k] = flat;
  }

  // The two qualifying answers are DETECTED, not assumed: canonical key, then
  // any key named like the question, then Meta's raw field_data array. A
  // second ad form whose Make mapping was never updated used to land here as
  // blanks — "works for some leads, not others". Not any more.
  const detected = detectAnswers(body, CORE_KEYS);
  if (detected.expertiseRaw && !intake.expertise) intake.expertise = detected.expertiseRaw;
  if (detected.readinessRaw && !intake.investment_readiness) intake.investment_readiness = detected.readinessRaw;
  const industry = mapExpertise(detected.expertiseRaw);
  const readiness = mapReadiness(detected.readinessRaw);

  // ---- service-role client (bypasses RLS) ----------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, reason: 'not_configured' }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ---- resolve the workspace (single-tenant: the first/only workspace) -----
  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (wsErr || !ws) {
    await logIngest(admin, {
      outcome: 'rejected', reason: 'no_workspace', ms: Date.now() - t0,
      full_name: fullName, phone, email,
    });
    return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 500 });
  }

  // ---------------------------------------------------------------------------
  // RECORD THE SUBMISSION — always, before anything else can go wrong.
  // Meta counts submissions; we now count them too, so the two can be compared.
  // ---------------------------------------------------------------------------
  const submissionBase = {
    workspace_id: ws.id,
    meta_lead_id: metaLeadId,
    submitted_at: submittedAt,
    full_name: fullName,
    phone,
    email,
    ad_name: (body.ad_name as string) || null,
    form_name: (body.form_name as string) || null,
    campaign_name: (body.campaign_name as string) || null,
    platform: (body.platform as string) || null,
    raw: intake,
  };

  // ---- find an existing person ---------------------------------------------
  // EXACT phone match, deliberately — this is what ran for a year.
  //
  // I briefly changed this to match on the last 10 digits, plus an email
  // fallback. That was a mistake: leads stored WITHOUT a country code
  // ("9812345678") suddenly matched Meta's "+919812345678", so people who used
  // to arrive as new leads were silently folded into an old record and vanished
  // from the Daily Tracker. Matching more loosely is only safe once returning
  // submissions are reliably visible — and they were not.
  //
  // Exact match errs towards showing you a lead. That is the right way to be
  // wrong: a visible duplicate can be merged, an invisible lead is lost.
  let prev: { id: string; industry: string | null; investment_readiness: string | null;
              intake: Record<string, unknown> | null; form_submission_count: number | null } | null = null;

  if (phone) {
    const { data } = await admin
      .from('leads')
      .select('id, industry, investment_readiness, intake, form_submission_count')
      .eq('workspace_id', ws.id)
      .eq('phone', phone)
      .limit(1);
    if (data && data.length > 0) prev = data[0];
  }

  // ---- returning person: enrich, stamp, and SAY SO -------------------------
  // A repeat submission used to vanish silently. Now it writes a submission
  // row, an activity entry and a timestamp, so it shows up in Daily Tracker
  // and in the lead's own timeline.
  if (prev) {
    const patch: Record<string, unknown> = {
      last_form_submitted_at: submittedAt,
      form_submission_count: (prev.form_submission_count || 1) + 1,
    };
    if (Object.keys(intake).length > 0) {
      patch.intake = { ...(prev.intake || {}), ...intake };
    }
    // Only gaps are filled. A value a human corrected in the CRM is never
    // overwritten by an old ad-form answer.
    if (industry && !prev.industry) patch.industry = industry;
    if (readiness && !prev.investment_readiness) patch.investment_readiness = readiness;

    await admin.from('leads').update(patch).eq('id', prev.id);

    const { error: subErr } = await admin.from('form_submissions')
      .upsert({ ...submissionBase, lead_id: prev.id, is_new_lead: false },
              { onConflict: 'meta_lead_id', ignoreDuplicates: true });
    // Never silent again. This exact call failed on every request for days
    // because the index it conflicts on was partial, and nothing said so.
    if (subErr) console.error('[ingest] form_submissions (returning) FAILED:', subErr.message);

    await admin.from('activity').insert({
      workspace_id: ws.id, user_id: null, lead_id: prev.id,
      action: 'form_resubmitted',
      meta: {
        submitted_at: submittedAt,
        ad_name: submissionBase.ad_name,
        form_name: submissionBase.form_name,
        count: patch.form_submission_count,
      },
    });

    await logIngest(admin, {
      outcome: 'returning', workspace_id: ws.id, lead_id: prev.id, ms: Date.now() - t0,
      full_name: fullName, phone, email, payload: intake,
    });

    return NextResponse.json({
      ok: true, duplicate: true, returning: true, id: prev.id,
      submissions: patch.form_submission_count,
    });
  }

  // ---- insert the lead -----------------------------------------------------
  const { data: lead, error: insErr } = await admin
    .from('leads')
    .insert({
      workspace_id: ws.id,
      full_name: fullName,
      phone,
      email,
      source: body.source || 'Meta Ads',
      stage: 'cold',
      visa_type: body.visa_type || null,
      tags: ['meta-lead'],
      // Derived — what automation reads.
      industry,
      investment_readiness: readiness,
      // Raw — what the person actually typed, kept whatever the mappers make of it.
      intake,
      last_form_submitted_at: submittedAt,
      form_submission_count: 1,
    })
    .select('id')
    .single();
  if (insErr) {
    await logIngest(admin, {
      outcome: 'rejected', reason: `insert_failed: ${insErr.message}`.slice(0, 300),
      workspace_id: ws.id, ms: Date.now() - t0,
      full_name: fullName, phone, email, payload: intake,
    });
    return NextResponse.json({ ok: false, reason: insErr.message }, { status: 500 });
  }

  await logIngest(admin, {
    outcome: 'created', workspace_id: ws.id, lead_id: lead.id, ms: Date.now() - t0,
    full_name: fullName, phone, email, payload: intake,
  });

  const { error: subErr } = await admin.from('form_submissions')
    .upsert({ ...submissionBase, lead_id: lead.id, is_new_lead: true },
            { onConflict: 'meta_lead_id', ignoreDuplicates: true });
  if (subErr) console.error('[ingest] form_submissions (new) FAILED:', subErr.message);

  // ---------------------------------------------------------------------------
  // AUTO WELCOME: send the "How it works" (GTV process) email to every new lead
  // the moment they land — while interest is hottest. Guards:
  //   - only when the lead has an email address (many Meta leads are phone-only)
  //   - never blocks lead creation (failures are logged, not thrown)
  //   - disable any time by setting env AUTO_WELCOME_EMAIL=false
  //   - duplicates never reach here (deduped above), so no double-sends
  // Each send is logged to activity → appears in the lead's Emails tab.
  // ---------------------------------------------------------------------------
  let welcomed = false;
  if (email && process.env.AUTO_WELCOME_EMAIL !== 'false') {
    try {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.NOTIFY_FROM;
      const replyTo = process.env.REPLY_TO || 'info@migrizo.com';
      if (apiKey && from) {
        const mail = renderProcess({ full_name: fullName, visa_type: body.visa_type || 'gtv' });
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, reply_to: replyTo, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
        });
        if (res.ok) {
          welcomed = true;
          await admin.from('activity').insert({
            workspace_id: ws.id, user_id: null, lead_id: lead.id,
            action: 'email_sent', meta: { email_type: 'process', auto: true, subject: mail.subject },
          });
        }
      }
    } catch { /* never block lead creation on email failure */ }
  }

  // industry and readiness come back in the response on purpose: Make's
  // execution history then shows how each answer was read, so a form option
  // nobody mapped shows up as null there instead of being discovered weeks
  // later as a gap in a report.
  return NextResponse.json({
    ok: true, id: lead.id, welcomed, duplicate: false, returning: false,
    industry, investment_readiness: readiness,
    // Where each answer was found — visible in Make's execution history, so a
    // remapped form shows up there instead of weeks later in a report.
    expertise_from: detected.expertiseFrom, readiness_from: detected.readinessFrom,
  });
}

// Health check so a browser GET doesn't look "broken" (Make only uses POST).
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'meta-lead ingest', method: 'POST only' });
}
