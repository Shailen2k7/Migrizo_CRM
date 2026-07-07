// =============================================================================
// META LEAD ADS → MIGRIZO CRM  ·  INGEST ENDPOINT
// -----------------------------------------------------------------------------
// A single public webhook that Make (or any connector) POSTs a lead to.
// It authenticates the caller with a shared secret, de-duplicates by phone/email,
// and inserts a new row into `leads` tagged source = 'meta'. The CRM's existing
// realtime subscription then makes the lead appear live in the Daily Tracker —
// no refresh, no manual entry.
//
// WHY SERVICE ROLE: there is no logged-in user on a webhook, so we can't use the
// normal cookie-based Supabase client (which relies on RLS + a session). We use
// the service-role key, which bypasses RLS — that's exactly why the shared-secret
// check below is mandatory: it is the only thing guarding this endpoint.
//
// REQUIRED ENV VARS (Netlify → Site configuration → Environment variables):
//   NEXT_PUBLIC_SUPABASE_URL      (already set)
//   SUPABASE_SERVICE_ROLE_KEY     (add — Supabase → Project Settings → API → service_role)
//   INGEST_SECRET                 (add — any long random string; also paste into Make)
//   INGEST_WORKSPACE_ID           (optional — your workspace UUID. If you have only
//                                  one workspace, the code auto-detects it and you
//                                  can skip this.)
//   INGEST_DEFAULT_STAGE          (optional — 'cold' (default) or 'hot')
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { normalizePhone, normalizeEmail } from '@/lib/utils';

export const runtime = 'nodejs';

// ---- Small helpers ---------------------------------------------------------

// Pull a value from the body under any of several possible key names, so the
// Make field-mapping is forgiving (Meta calls it "phone_number", "full_name",
// "email", but people map them differently).
function pick(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---- The endpoint ----------------------------------------------------------

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.INGEST_SECRET;

  if (!url || !serviceKey) {
    return json(500, { ok: false, reason: 'server_not_configured' });
  }
  if (!secret) {
    return json(500, { ok: false, reason: 'ingest_secret_missing' });
  }

  // Parse the body (JSON from Make's HTTP module).
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, reason: 'invalid_json' });
  }

  // 1) AUTH — the only guard on a service-role endpoint. The token can be sent
  //    in the body ("token") or as a header ("x-ingest-secret").
  const provided =
    (typeof body.token === 'string' ? body.token : '') ||
    req.headers.get('x-ingest-secret') ||
    '';
  if (provided !== secret) {
    return json(401, { ok: false, reason: 'unauthorized' });
  }

  // 2) EXTRACT the lead fields (forgiving key matching).
  const fullName = pick(body, ['full_name', 'name', 'fullName', 'Full_Name']) || 'Unnamed lead';
  const rawPhone = pick(body, ['phone', 'phone_number', 'mobile', 'Phone', 'whatsapp']);
  const rawEmail = pick(body, ['email', 'email_address', 'Email']);
  const visaType = pick(body, ['visa_type', 'service', 'interest', 'campaign_name']);
  const campaign = pick(body, ['campaign', 'campaign_name', 'form_name', 'ad_name']);

  const phone = normalizePhone(rawPhone);
  const email = normalizeEmail(rawEmail);

  // Reject empty leads — must have at least a phone or an email to be useful.
  if (!phone && !email) {
    return json(422, { ok: false, reason: 'no_contact_info' });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  // 3) RESOLVE the workspace. Prefer the env var; otherwise auto-detect when
  //    there's exactly one workspace (your single-tenant setup).
  let workspaceId = process.env.INGEST_WORKSPACE_ID || '';
  if (!workspaceId) {
    const { data: ws } = await supabase.from('workspaces').select('id').limit(2);
    if (ws && ws.length === 1) {
      workspaceId = ws[0].id as string;
    } else {
      return json(500, {
        ok: false,
        reason: 'workspace_unresolved',
        hint: 'Set INGEST_WORKSPACE_ID — more than one workspace exists.',
      });
    }
  }

  // 4) DE-DUPLICATE by phone or email within this workspace. If we already have
  //    this person, we skip the insert (still return 200 so Make sees success).
  const orFilters: string[] = [];
  if (phone) orFilters.push(`phone.eq.${phone}`);
  if (email) orFilters.push(`email.eq.${email}`);

  if (orFilters.length) {
    const { data: existing } = await supabase
      .from('leads')
      .select('id')
      .eq('workspace_id', workspaceId)
      .or(orFilters.join(','))
      .limit(1);

    if (existing && existing.length > 0) {
      return json(200, { ok: true, duplicate: true, lead_id: existing[0].id });
    }
  }

  // 5) INSERT the new lead. Columns mirror the app's own createLead().
  const stage =
    (process.env.INGEST_DEFAULT_STAGE === 'hot' ? 'hot' : 'cold') as 'hot' | 'cold';

  const { data: inserted, error } = await supabase
    .from('leads')
    .insert({
      workspace_id: workspaceId,
      full_name: fullName,
      phone,
      email,
      visa_type: visaType,
      stage,
      source: 'meta',
      score: 50,
      payment_status: 'none',
      currency: 'INR',
      amount_paid: 0,
      amount_total: 0,
      tags: campaign ? [`meta:${campaign}`] : [],
      is_sample: false,
    })
    .select('id')
    .single();

  if (error) {
    return json(500, { ok: false, reason: 'insert_failed', detail: error.message });
  }

  // 6) BEST-EFFORT activity log (never blocks the response). Shows up in the feed
  //    as an automated ingest so you can tell Meta leads from hand-added ones.
  try {
    await supabase.from('activity').insert({
      workspace_id: workspaceId,
      user_id: null,
      lead_id: inserted.id,
      action: 'lead_ingested',
      meta: { source: 'meta', campaign: campaign || null },
    });
  } catch {
    /* noop */
  }

  return json(200, { ok: true, duplicate: false, lead_id: inserted.id });
}

// Optional: a plain GET returns a heartbeat so you can confirm the route is live
// in a browser (it will never leak data — no secret, no query).
export async function GET() {
  return json(200, { ok: true, service: 'meta-lead-ingest', status: 'live' });
}
