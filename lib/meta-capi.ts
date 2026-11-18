// =============================================================================
// META CONVERSIONS API (CRM) — sends our lead stages back to Meta.
//
// The database queues events (migration 131: meta_capi_events, filled by
// triggers). This module drains that queue: one event per request, never the
// same (lead, event) twice, retries only where retrying can help.
//
// HARD RULES (each one is a silent failure at Meta if broken):
//   - user_data.lead_id is Meta's RAW numeric leadgen id. Never hashed. Sent
//     as a JSON number written digit-for-digit (never through a JS number,
//     which would round ids above 2^53).
//   - action_source is exactly "system_generated".
//   - event_time is unix SECONDS and strictly greater than the lead's Meta
//     created time (bumped to created + 1 if not).
//   - Meta only accepts events up to 7 days old; older ones are skipped and
//     logged, never sent.
//   - ONE event per request: in a batch, one bad event discards them all.
//
// Pure apart from the injected store / fetch / clock, so the acceptance tests
// run the exact code production runs.
// =============================================================================

export type CapiEventName = 'lead' | 'contacted' | 'qualified';

export interface CapiConfig {
  enabled: boolean;
  datasetId: string;
  token: string;
  version: string;
  graphBase: string;
  /** Optional: Events Manager → Test events code, while checking the setup. */
  testEventCode?: string;
}

export function capiConfigFromEnv(env: Record<string, string | undefined> = process.env): CapiConfig {
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(env.META_CAPI_ENABLED || '').trim()),
    datasetId: String(env.META_DATASET_ID || '').trim(),
    token: String(env.META_CAPI_TOKEN || '').trim(),
    version: String(env.META_API_VERSION || '').trim() || 'v23.0',
    graphBase: String(env.META_GRAPH_BASE || '').trim() || 'https://graph.facebook.com',
    testEventCode: String(env.META_CAPI_TEST_EVENT_CODE || '').trim() || undefined,
  };
}

export interface QueueRow {
  id: string;
  lead_id: string;
  event_name: CapiEventName;
  event_time: number;        // unix seconds — when the stage happened
  attempt_count: number;
}

export interface LeadMeta {
  meta_leadgen_id: string | null;
  meta_lead_created_at: number | null;   // unix seconds
}

export interface RowPatch {
  status?: 'pending' | 'sent' | 'failed' | 'skipped';
  sent_at?: string | null;
  http_status?: number | null;
  response_body?: string | null;
  attempt_count?: number;
  next_attempt_at?: string;
  event_time?: number;
}

export interface CapiStore {
  /** Pending rows whose next_attempt_at has passed, oldest first. */
  due(limit: number): Promise<QueueRow[]>;
  /** Take a row for this run; false if another run already took it. */
  claim(id: string): Promise<boolean>;
  lead(leadId: string): Promise<LeadMeta | null>;
  update(id: string, patch: RowPatch): Promise<void>;
}

export interface CapiDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Unix seconds. */
  now: () => number;
  log: (line: Record<string, unknown>) => void;
}

export const defaultDeps: CapiDeps = {
  fetch: (...a) => fetch(...a),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Math.floor(Date.now() / 1000),
  log: (line) => console.log('[meta-capi]', JSON.stringify(line)),
};

export const SEVEN_DAYS = 7 * 24 * 60 * 60;
/** Waits before retry 1, 2, 3 (ms). Retries 1–2 run inline; retry 3 is
 *  scheduled on the queue so one slow event never holds the whole run. */
export const BACKOFF_MS = [1000, 4000, 16000];
const MAX_ATTEMPTS = 1 + BACKOFF_MS.length;   // first try + 3 retries
const INLINE_ATTEMPTS = 3;                    // first try + retries 1 and 2

const LEADGEN_RE = /^[0-9]{5,25}$/;

/** Decide what (if anything) to send. Pure. */
export function planEvent(row: QueueRow, lead: LeadMeta | null, nowSec: number):
  | { send: true; eventTime: number; leadgenId: string }
  | { send: false; reason: string } {
  const id = (lead?.meta_leadgen_id || '').trim();
  if (!id) return { send: false, reason: 'no_meta_leadgen_id' };
  if (!LEADGEN_RE.test(id)) return { send: false, reason: 'meta_leadgen_id_not_numeric' };

  let t = Math.floor(row.event_time);
  const created = lead?.meta_lead_created_at ?? null;
  // Never in the future.
  if (t > nowSec) t = nowSec;
  // Strictly after Meta created the lead.
  if (created !== null && t <= created) t = created + 1;
  if (created !== null && created + 1 > nowSec) return { send: false, reason: 'lead_created_in_future' };
  if (t < nowSec - SEVEN_DAYS) {
    return { send: false, reason: `older_than_7_days (event ${new Date(t * 1000).toISOString()})` };
  }
  return { send: true, eventTime: t, leadgenId: id };
}

/** The exact request body. lead_id is spliced in as raw digits. */
export function buildBody(eventName: CapiEventName, eventTime: number, leadgenId: string, cfg: CapiConfig): string {
  const PLACEHOLDER = '"__LEADGEN_ID__"';
  const body: Record<string, unknown> = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      action_source: 'system_generated',
      user_data: { lead_id: '__LEADGEN_ID__' },
      custom_data: { lead_event_source: 'Migrizo CRM', event_source: 'crm' },
    }],
    access_token: cfg.token,
  };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
  if (!LEADGEN_RE.test(leadgenId)) throw new Error('leadgen id must be digits only');
  return JSON.stringify(body).replace(PLACEHOLDER, leadgenId);
}

type Attempt = { http: number | null; body: string; retryable: boolean };

async function attemptOnce(url: string, payload: string, deps: CapiDeps): Promise<Attempt> {
  try {
    const res = await deps.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    const text = await res.text().catch(() => '');
    return { http: res.status, body: text.slice(0, 4000), retryable: res.status >= 500 };
  } catch (e) {
    return { http: null, body: `network_error: ${(e as Error)?.message || String(e)}`.slice(0, 4000), retryable: true };
  }
}

export interface RunSummary {
  enabled: boolean;
  configured: boolean;
  picked: number;
  sent: number;
  skipped: number;
  failed: number;
  retry_later: number;
}

/** Send one queued row (already claimed). */
export async function processRow(row: QueueRow, lead: LeadMeta | null, cfg: CapiConfig, store: CapiStore, deps: CapiDeps):
  Promise<'sent' | 'skipped' | 'failed' | 'retry_later'> {
  const nowSec = deps.now();
  const plan = planEvent(row, lead, nowSec);
  if (!plan.send) {
    // "Skip silently" for non-Meta leads: recorded on the row, one quiet log line.
    deps.log({ lead_id: row.lead_id, event_name: row.event_name, event_time: row.event_time, result: 'skipped', reason: plan.reason });
    await store.update(row.id, { status: 'skipped', response_body: plan.reason, http_status: null });
    return 'skipped';
  }

  const url = `${cfg.graphBase}/${cfg.version}/${encodeURIComponent(cfg.datasetId)}/events`;
  const payload = buildBody(row.event_name, plan.eventTime, plan.leadgenId, cfg);
  let attempts = row.attempt_count;
  let last: Attempt = { http: null, body: '', retryable: true };

  for (let i = 0; i < INLINE_ATTEMPTS && attempts < MAX_ATTEMPTS; i++) {
    // Inline waits (1s, 4s). A retry picked up from the queue already waited.
    if (i > 0) await deps.sleep(BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]);
    attempts += 1;
    last = await attemptOnce(url, payload, deps);
    deps.log({
      lead_id: row.lead_id, meta_leadgen_id: plan.leadgenId, event_name: row.event_name,
      event_time: plan.eventTime, attempt: attempts, http_status: last.http, response_body: last.body,
    });
    if (last.http !== null && last.http >= 200 && last.http < 300) {
      await store.update(row.id, {
        status: 'sent', sent_at: new Date(deps.now() * 1000).toISOString(), http_status: last.http,
        response_body: last.body, attempt_count: attempts, event_time: plan.eventTime,
      });
      return 'sent';
    }
    if (!last.retryable) break;   // 4xx: Meta rejected it — the body says why.
  }

  if (last.retryable && attempts < MAX_ATTEMPTS) {
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    await store.update(row.id, {
      status: 'pending', http_status: last.http, response_body: last.body, attempt_count: attempts,
      next_attempt_at: new Date((deps.now() * 1000) + wait).toISOString(), event_time: plan.eventTime,
    });
    return 'retry_later';
  }
  await store.update(row.id, {
    status: 'failed', http_status: last.http, response_body: last.body, attempt_count: attempts, event_time: plan.eventTime,
  });
  return 'failed';
}

/** Drain due events. Stops picking up new ones after `budgetMs`. */
export async function processQueue(store: CapiStore, cfg: CapiConfig, deps: CapiDeps = defaultDeps,
  opts: { limit?: number; budgetMs?: number } = {}): Promise<RunSummary> {
  const summary: RunSummary = { enabled: cfg.enabled, configured: !!(cfg.datasetId && cfg.token), picked: 0, sent: 0, skipped: 0, failed: 0, retry_later: 0 };
  // Kill switch: nothing leaves the building. Queued rows simply wait.
  if (!cfg.enabled) { deps.log({ result: 'disabled', note: 'META_CAPI_ENABLED is not true — nothing sent' }); return summary; }
  if (!summary.configured) { deps.log({ result: 'not_configured', note: 'META_DATASET_ID / META_CAPI_TOKEN missing — nothing sent' }); return summary; }

  const started = Date.now();
  const budget = opts.budgetMs ?? 18000;
  const rows = await store.due(opts.limit ?? 25);
  for (const row of rows) {
    if (Date.now() - started > budget) break;
    if (!(await store.claim(row.id))) continue;
    summary.picked += 1;
    const lead = await store.lead(row.lead_id);
    const r = await processRow(row, lead, cfg, store, deps);
    summary[r] += 1;
  }
  return summary;
}
