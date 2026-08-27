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
import { createClient } from '@supabase/supabase-js';
import { renderProcess } from '@/lib/email/branded';
import { flattenAnswer, mapExpertise, mapReadiness, detectAnswers } from '@/lib/intake';

// Core fields the route understands. Anything else in the body is treated as an
// extra ad-form answer and kept verbatim in leads.intake.
const CORE_KEYS = new Set(['token', 'full_name', 'phone', 'email', 'visa_type', 'source']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
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
    return NextResponse.json({ ok: false, reason: 'bad_json' }, { status: 400 });
  }

  // ---- auth: shared token --------------------------------------------------
  const expected = process.env.INGEST_SECRET;
  if (!expected || body.token !== expected) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }

  // ---- required field ------------------------------------------------------
  const fullName = (body.full_name || '').trim();
  if (!fullName) {
    return NextResponse.json({ ok: false, reason: 'missing_name' }, { status: 400 });
  }
  const phone = (body.phone || '').trim() || null;
  const email = (body.email || '').trim() || null;

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
    return NextResponse.json({ ok: false, reason: 'no_workspace' }, { status: 500 });
  }

  // ---- dedupe by phone within the workspace --------------------------------
  // A repeat submission is not nothing. The person filled the form a second
  // time, possibly answering a question they skipped before, so the answers are
  // folded into the lead we already have rather than thrown away with it. Only
  // gaps are filled: a value a human has since corrected in the CRM is never
  // overwritten by an old ad-form answer.
  if (phone) {
    const { data: existing } = await admin
      .from('leads')
      .select('id, industry, investment_readiness, intake')
      .eq('workspace_id', ws.id)
      .eq('phone', phone)
      .limit(1);
    if (existing && existing.length > 0) {
      const prev = existing[0];
      const patch: Record<string, unknown> = {};
      if (Object.keys(intake).length > 0) {
        patch.intake = { ...(prev.intake as Record<string, unknown> || {}), ...intake };
      }
      if (industry && !prev.industry) patch.industry = industry;
      if (readiness && !prev.investment_readiness) patch.investment_readiness = readiness;
      if (Object.keys(patch).length > 0) {
        await admin.from('leads').update(patch).eq('id', prev.id);
      }
      return NextResponse.json({
        ok: true, duplicate: true, id: prev.id, enriched: Object.keys(patch).length > 0,
      });
    }
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
    })
    .select('id')
    .single();
  if (insErr) {
    return NextResponse.json({ ok: false, reason: insErr.message }, { status: 500 });
  }

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

  // ---------------------------------------------------------------------------
  // WHATSAPP INTAKE (076): put the new lead on the T1–T4 chase. Ten-minute
  // grace on purpose — most Meta leads open WhatsApp and send the prefilled
  // hello within minutes, which opens the 24h window and lets the webhook fire
  // T1 as free-form text instantly. Only a lead who never messages falls
  // through to the slower approved-template branch. Never blocks lead creation.
  // ---------------------------------------------------------------------------
  let t1: string | null = null;
  if (phone) {
    try {
      await admin.rpc('wa_intake_enqueue', {
        p_workspace_id: ws.id, p_lead_id: lead.id, p_phone: phone,
        p_track: 'chase', p_first_step: 1, p_delay_minutes: 10,
      });
      // THE RACE FIX: if this person's WhatsApp hello arrived BEFORE this
      // POST (common — the form's click-to-WhatsApp fires immediately), the
      // window is already open and T1 must not wait for the cron. Fire it
      // right now; if they haven't messaged yet, the webhook fires it the
      // second they do, and the queued row above is the final safety net.
      const { fireT1IfWindowOpen } = await import('@/lib/whatsapp/intake');
      t1 = await fireT1IfWindowOpen(admin, ws.id, lead.id, phone, fullName);
    } catch (e) {
      console.error('[ingest] wa intake hook failed (lead still created)', e);
    }
  }

  // industry and readiness come back in the response on purpose: Make's
  // execution history then shows how each answer was read, so a form option
  // nobody mapped shows up as null there instead of being discovered weeks
  // later as a gap in a report.
  return NextResponse.json({
    ok: true, id: lead.id, welcomed, whatsapp_t1: t1,
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
