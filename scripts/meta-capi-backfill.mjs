#!/usr/bin/env node
// =============================================================================
// META CAPI — one-off backfill for leads that arrived in the last 7 days.
//
//   node scripts/meta-capi-backfill.mjs            # dry run (default): prints, changes nothing
//   node scripts/meta-capi-backfill.mjs --commit   # writes
//
// What it does:
//   1. Copies Meta's lead id (+ created time) from form_submissions onto leads
//      that do not have it yet (submissions from the last 7 days only).
//   2. For every lead whose meta_lead_created_at is within the last 7 days,
//      works out which stages already happened and queues the missing ones in
//      meta_capi_events:
//        lead       — lead created in the CRM
//        contacted  — first stage change made by a team member (activity log)
//        qualified  — marked Eligible / Highly eligible by a team member
//   3. Never queues a (lead, event) that is already in meta_capi_events, and
//      skips any stage that happened more than 7 days ago (Meta rejects those).
//
// It does NOT call Meta itself: queued rows are sent by /api/meta-capi/run
// (every minute), which also applies the META_CAPI_ENABLED kill switch.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — from the
// environment, or from .env.local in the project folder.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

const COMMIT = process.argv.includes('--commit');
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const now = Math.floor(Date.now() / 1000);
const since = now - SEVEN_DAYS;

function loadEnv() {
  const env = { ...process.env };
  const file = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function get(q) {
  const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${q.split('?')[0]} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function send(method, q, body, extra = {}) {
  const r = await fetch(`${URL_}/rest/v1/${q}`, { method, headers: { ...H, ...extra }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${q.split('?')[0]} → ${r.status} ${await r.text()}`);
}
const iso = (s) => new Date(s * 1000).toISOString();
const sec = (t) => Math.floor(new Date(t).getTime() / 1000);
const log = (o) => console.log(JSON.stringify(o));

console.log(`Meta CAPI backfill — ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (nothing is written; add --commit to write)'}`);
console.log(`Window: leads Meta-created after ${iso(since)}\n`);

// ---- 1) copy Meta ids from form_submissions onto leads -----------------------
const subs = await get(`form_submissions?select=lead_id,meta_lead_id,submitted_at&meta_lead_id=not.is.null&lead_id=not.is.null&submitted_at=gte.${iso(since)}&order=submitted_at.asc&limit=5000`);
const firstByLead = new Map();
for (const s of subs) if (/^[0-9]+$/.test(s.meta_lead_id) && !firstByLead.has(s.lead_id)) firstByLead.set(s.lead_id, s);
let copied = 0;
if (firstByLead.size) {
  const ids = [...firstByLead.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const missing = await get(`leads?select=id&meta_leadgen_id=is.null&id=in.(${chunk.join(',')})`);
    for (const { id } of missing) {
      const s = firstByLead.get(id);
      log({ step: 'copy_meta_id', lead_id: id, meta_leadgen_id: s.meta_lead_id, meta_lead_created_at: sec(s.submitted_at) });
      if (COMMIT) await send('PATCH', `leads?id=eq.${id}&meta_leadgen_id=is.null`, { meta_leadgen_id: s.meta_lead_id, meta_lead_created_at: sec(s.submitted_at) });
      copied++;
    }
  }
}
console.log(`\nStep 1: ${copied} lead(s) ${COMMIT ? 'given' : 'would get'} their Meta id.\n`);

// ---- 2) queue missing stages --------------------------------------------------
// In a dry run the ids from step 1 are not written yet, so include them here.
const leads = await get(`leads?select=id,workspace_id,created_at,eligibility,eligibility_at,eligibility_source,meta_leadgen_id,meta_lead_created_at&meta_leadgen_id=not.is.null&meta_lead_created_at=gte.${since}&limit=5000`);
if (!COMMIT) {
  for (const [id, s] of firstByLead) {
    if (!leads.some((l) => l.id === id)) {
      const [l] = await get(`leads?select=id,workspace_id,created_at,eligibility,eligibility_at,eligibility_source,meta_leadgen_id&id=eq.${id}`);
      if (l && !l.meta_leadgen_id) leads.push({ ...l, meta_leadgen_id: s.meta_lead_id, meta_lead_created_at: sec(s.submitted_at) });
    }
  }
}

let queued = 0, already = 0, tooOld = 0;
for (const l of leads) {
  const existing = new Set((await get(`meta_capi_events?select=event_name&lead_id=eq.${l.id}`)).map((r) => r.event_name));
  const stages = [];
  stages.push({ event_name: 'lead', at: sec(l.created_at) });
  const moves = await get(`activity?select=created_at&lead_id=eq.${l.id}&action=eq.moved_stage&user_id=not.is.null&order=created_at.asc&limit=1`);
  if (moves[0]) stages.push({ event_name: 'contacted', at: sec(moves[0].created_at) });
  if (['eligible', 'highly_eligible'].includes(l.eligibility) && l.eligibility_source === 'manual' && l.eligibility_at) {
    stages.push({ event_name: 'qualified', at: sec(l.eligibility_at) });
  }
  for (const st of stages) {
    let t = Math.max(st.at, l.meta_lead_created_at + 1);
    if (existing.has(st.event_name)) { already++; log({ step: 'skip', reason: 'already_queued_or_sent', lead_id: l.id, event_name: st.event_name }); continue; }
    if (t < now - SEVEN_DAYS) { tooOld++; log({ step: 'skip', reason: 'older_than_7_days', lead_id: l.id, event_name: st.event_name, event_time: t, at: iso(t) }); continue; }
    if (t > now) t = now;
    log({ step: 'queue', lead_id: l.id, meta_leadgen_id: l.meta_leadgen_id, event_name: st.event_name, event_time: t, at: iso(t) });
    if (COMMIT) {
      await send('POST', 'meta_capi_events?on_conflict=lead_id,event_name',
        { workspace_id: l.workspace_id, lead_id: l.id, event_name: st.event_name, event_time: t, source: 'backfill' },
        { Prefer: 'resolution=ignore-duplicates,return=minimal' });
    }
    queued++;
  }
}

console.log(`\nStep 2: ${leads.length} Meta lead(s) in window · ${queued} event(s) ${COMMIT ? 'queued' : 'would be queued'} · ${already} already queued/sent · ${tooOld} older than 7 days (skipped)`);
if (!COMMIT) console.log('\nDry run only. Run again with --commit to write.');
else console.log('\nDone. Queued events are sent by /api/meta-capi/run within a minute (only if META_CAPI_ENABLED=true).');
