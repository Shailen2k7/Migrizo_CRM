// =============================================================================
// META CAPI — acceptance tests.   Run:  npx jiti scripts/meta-capi-acceptance.ts
//
// Runs the real sender (lib/meta-capi.ts) against a local fake Meta server
// and an in-memory queue that enforces the same unique (lead_id, event_name)
// rule as the database. Touches no real data and calls no real Meta API.
// =============================================================================

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  processQueue, type CapiConfig, type CapiDeps, type CapiStore, type QueueRow, type LeadMeta, type RowPatch, type CapiEventName,
} from '../lib/meta-capi';

// ---- fake Meta -------------------------------------------------------------
type Req = { path: string; body: string };
let requests: Req[] = [];
let respond: (b: string) => { status: number; body: string } = () => ({ status: 200, body: '{"events_received":1,"messages":[],"fbtrace_id":"TEST"}' });
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { requests.push({ path: req.url || '', body: b }); const r = respond(b); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(r.body); });
});

// ---- in-memory queue, same uniqueness as the DB ------------------------------
type Row = QueueRow & { status: string; http_status?: number | null; response_body?: string | null; next_attempt_at: number };
function makeStore(leads: Record<string, LeadMeta>) {
  const rows: Row[] = [];
  let n = 0;
  const store: CapiStore & { enqueue: (lead: string, ev: CapiEventName, t: number) => boolean; rows: Row[] } = {
    rows,
    enqueue(lead, ev, t) {
      if (!leads[lead]?.meta_leadgen_id) return false;                       // trigger: non-Meta leads never queue
      if (rows.some((r) => r.lead_id === lead && r.event_name === ev)) return false; // ON CONFLICT DO NOTHING
      rows.push({ id: `row${++n}`, lead_id: lead, event_name: ev, event_time: t, attempt_count: 0, status: 'pending', next_attempt_at: 0 });
      return true;
    },
    async due(limit) { return rows.filter((r) => r.status === 'pending' && r.next_attempt_at <= Date.now()).slice(0, limit).map((r) => ({ ...r })); },
    async claim() { return true; },
    async lead(id) { return leads[id] ?? null; },
    async update(id, p: RowPatch) {
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, p);
      if (p.next_attempt_at) r.next_attempt_at = new Date(p.next_attempt_at).getTime();
    },
  };
  return store;
}

const logs: Record<string, unknown>[] = [];
const NOW = Math.floor(Date.now() / 1000);
const deps = (): CapiDeps => ({ fetch, sleep: async (ms) => { sleeps.push(ms); }, now: () => NOW, log: (l) => { logs.push(l); console.log('    log', JSON.stringify(l)); } });
let sleeps: number[] = [];
let cfg: CapiConfig;

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = '') { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? `  (${detail})` : ''}`); }
function reset() { requests = []; logs.length = 0; sleeps = []; respond = () => ({ status: 200, body: '{"events_received":1,"messages":[],"fbtrace_id":"TEST"}' }); }

const BIG_ID = '1088222023839615';
const HUGE_ID = '90071992547409931';   // > 2^53: must survive digit-for-digit

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  cfg = { enabled: true, datasetId: '123456789', token: 'TEST_TOKEN', version: 'v23.0', graphBase: `http://127.0.0.1:${port}` };

  // 1 -------------------------------------------------------------------------
  console.log('\nTEST 1 — lead with no meta_leadgen_id is skipped, nothing sent, no error');
  reset();
  {
    const s = makeStore({ L1: { meta_leadgen_id: null, meta_lead_created_at: null } });
    const queued = ['lead', 'contacted', 'qualified'].map((e) => s.enqueue('L1', e as CapiEventName, NOW - 60));
    // Even if a row somehow existed, the sender must skip it quietly:
    s.rows.push({ id: 'x', lead_id: 'L1', event_name: 'lead', event_time: NOW - 60, attempt_count: 0, status: 'pending', next_attempt_at: 0 });
    let threw = false; let sum;
    try { sum = await processQueue(s, cfg, deps()); } catch { threw = true; }
    check('nothing queued by the trigger rule', queued.every((q) => !q));
    check('0 requests to Meta', requests.length === 0, `requests=${requests.length}`);
    check('no error raised', !threw);
    check('row marked skipped: no_meta_leadgen_id', s.rows[0].status === 'skipped' && s.rows[0].response_body === 'no_meta_leadgen_id', JSON.stringify(sum));
  }

  // 2 -------------------------------------------------------------------------
  console.log('\nTEST 2 — a lead through all three stages → exactly 3 requests, all HTTP 200');
  reset();
  const created = NOW - 3600;
  const s2 = makeStore({ L2: { meta_leadgen_id: BIG_ID, meta_lead_created_at: created } });
  {
    s2.enqueue('L2', 'lead', created + 5);
    s2.enqueue('L2', 'contacted', created + 600);
    s2.enqueue('L2', 'qualified', created + 1800);
    const sum = await processQueue(s2, cfg, deps());
    check('exactly 3 requests', requests.length === 3, `requests=${requests.length}`);
    check('all 3 rows sent with HTTP 200', s2.rows.every((r) => r.status === 'sent' && r.http_status === 200), JSON.stringify(sum));
    const bodies = requests.map((r) => JSON.parse(r.body));
    check('one event per request', bodies.every((b) => b.data.length === 1));
    check('event names lead / contacted / qualified', bodies.map((b) => b.data[0].event_name).join(',') === 'lead,contacted,qualified');
    check('action_source = system_generated', bodies.every((b) => b.data[0].action_source === 'system_generated'));
    check('lead_id is the raw number, not hashed or quoted', requests.every((r) => r.body.includes(`"lead_id":${BIG_ID}`)));
    check('custom_data correct', bodies.every((b) => b.data[0].custom_data.lead_event_source === 'Migrizo CRM' && b.data[0].custom_data.event_source === 'crm'));
    check('POST path = /v23.0/{DATASET_ID}/events', requests.every((r) => r.path === '/v23.0/123456789/events'), requests[0]?.path);
    console.log('    sample request body:', requests[0].body.replace('TEST_TOKEN', '<token>'));
  }

  // 3 -------------------------------------------------------------------------
  console.log('\nTEST 3 — re-triggering a stage already sent → zero new requests');
  reset();
  {
    const again = ['lead', 'contacted', 'qualified'].map((e) => s2.enqueue('L2', e as CapiEventName, NOW - 10));
    await processQueue(s2, cfg, deps());
    check('re-queue refused (unique lead_id + event_name)', again.every((a) => !a));
    check('0 new requests', requests.length === 0, `requests=${requests.length}`);
  }

  // 4 -------------------------------------------------------------------------
  console.log('\nTEST 4 — lead older than 7 days is skipped with a clear log line');
  reset();
  {
    const old = NOW - 9 * 86400;
    const s = makeStore({ L4: { meta_leadgen_id: BIG_ID, meta_lead_created_at: old } });
    s.enqueue('L4', 'lead', old + 2);
    await processQueue(s, cfg, deps());
    check('0 requests', requests.length === 0);
    const line = logs.find((l) => String(l.reason || '').startsWith('older_than_7_days'));
    check('log line says older_than_7_days', !!line, line ? String(line.reason) : 'missing');
    check('row marked skipped', s.rows[0].status === 'skipped');
  }

  // 5 -------------------------------------------------------------------------
  console.log('\nTEST 5 — event_time is always greater than meta_lead_created_at');
  reset();
  {
    const c = NOW - 500;
    const s = makeStore({ L5: { meta_leadgen_id: HUGE_ID, meta_lead_created_at: c } });
    s.enqueue('L5', 'lead', c);          // same second
    s.enqueue('L5', 'contacted', c - 30); // earlier
    s.enqueue('L5', 'qualified', NOW + 999); // future → clamped to now
    await processQueue(s, cfg, deps());
    const times = requests.map((r) => JSON.parse(r.body).data[0].event_time as number);
    check('same-second event bumped to created + 1', times[0] === c + 1, `${times[0]} vs created ${c}`);
    check('earlier event bumped to created + 1', times[1] === c + 1, `${times[1]}`);
    check('future event clamped to now', times[2] === NOW, `${times[2]}`);
    check('every event_time > created', times.every((t) => t > c));
    check('17-digit lead id sent digit-for-digit', requests.every((r) => r.body.includes(`"lead_id":${HUGE_ID}`)));
  }

  // 6 -------------------------------------------------------------------------
  console.log('\nTEST 6 — META_CAPI_ENABLED=false → nothing is sent');
  reset();
  {
    const s = makeStore({ L6: { meta_leadgen_id: BIG_ID, meta_lead_created_at: NOW - 100 } });
    s.enqueue('L6', 'lead', NOW - 50);
    const sum = await processQueue(s, { ...cfg, enabled: false }, deps());
    check('0 requests', requests.length === 0, JSON.stringify(sum));
    check('row left pending (sent later if switched on within 7 days)', s.rows[0].status === 'pending');
  }

  // extra: error handling ------------------------------------------------------
  console.log('\nEXTRA — 4xx is not retried; 5xx retries with 1s, 4s, then 16s backoff');
  reset();
  {
    respond = () => ({ status: 400, body: '{"error":{"message":"Invalid parameter","code":100}}' });
    const s = makeStore({ L7: { meta_leadgen_id: BIG_ID, meta_lead_created_at: NOW - 100 } });
    s.enqueue('L7', 'lead', NOW - 50);
    await processQueue(s, cfg, deps());
    check('4xx: exactly 1 request, marked failed, body kept', requests.length === 1 && s.rows[0].status === 'failed' && String(s.rows[0].response_body).includes('Invalid parameter'));
  }
  reset();
  {
    respond = () => ({ status: 503, body: '{"error":"unavailable"}' });
    const s = makeStore({ L8: { meta_leadgen_id: BIG_ID, meta_lead_created_at: NOW - 100 } });
    s.enqueue('L8', 'lead', NOW - 50);
    await processQueue(s, cfg, deps());
    const r = s.rows[0];
    check('5xx: 3 tries now with 1s + 4s waits', requests.length === 3 && sleeps.join(',') === '1000,4000', `sleeps=${sleeps.join(',')}`);
    check('then re-queued 16s later', r.status === 'pending' && r.attempt_count === 3 && Math.abs(r.next_attempt_at - (NOW * 1000 + 16000)) < 5);
    r.next_attempt_at = 0;               // let the next cron run pick it up
    respond = () => ({ status: 200, body: '{"events_received":1}' });
    requests = [];
    await processQueue(s, cfg, deps());
    check('4th attempt succeeds → sent', requests.length === 1 && r.status === 'sent' && r.attempt_count === 4);
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); server.close(); process.exit(1); });
