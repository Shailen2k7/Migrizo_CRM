# Meta Conversions API (CRM) — lead stages back to Meta

Sends three stages for every Meta lead, so the campaign can optimise for
**conversion leads** instead of raw form fills:

| Event       | When it is queued                                                        |
|-------------|--------------------------------------------------------------------------|
| `lead`      | The lead arrives from Meta (gets its Meta lead id)                       |
| `contacted` | First stage change made by a team member (automations don't count)       |
| `qualified` | A team member marks the lead **Eligible** or **Highly eligible**         |

## How it works

1. **Make** sends `meta_lead_id` (Meta's `leadgen_id`) and `created_time` to
   `/api/ingest/meta-lead`, which already stores them in `form_submissions`.
2. A trigger copies them onto the lead: `leads.meta_leadgen_id` and
   `leads.meta_lead_created_at` (unix seconds). Intake code is unchanged.
3. Triggers on `leads` queue stage events in `meta_capi_events`. That table is
   the queue, the send log and the idempotency guard
   (`unique (lead_id, event_name)` — a stage is never sent twice).
4. `/api/meta-capi/run` (Supabase cron, every minute) sends due events — one
   per request — and records `http_status`, `response_body`, `attempt_count`.

A Meta outage can never block or slow a CRM action: triggers only insert a
queue row, and sending happens separately.

## Rules enforced (lib/meta-capi.ts)

- `user_data.lead_id` = raw numeric leadgen id, unhashed, written digit-for-digit.
- `action_source` = `"system_generated"`.
- `event_time` (unix seconds) is always > `meta_lead_created_at` (bumped to +1),
  never in the future.
- Events older than 7 days are skipped and logged (`older_than_7_days`).
- Leads without a Meta id are skipped silently.
- 5xx / network errors: retried — 1s, 4s inline, then 16s via the queue
  (4 attempts total). 4xx: not retried; Meta's full response is stored.

## Environment variables (Netlify → Site configuration → Environment variables)

| Variable                    | Value                                                             |
|-----------------------------|-------------------------------------------------------------------|
| `META_DATASET_ID`           | Events Manager → your **CRM** dataset → Settings → Dataset ID     |
| `META_CAPI_TOKEN`           | System user token (ads_management) — or "Generate access token" in the dataset settings |
| `META_API_VERSION`          | Optional, default `v23.0`                                         |
| `META_CAPI_ENABLED`         | `true` to send. Anything else = kill switch, nothing is sent      |
| `META_CAPI_TEST_EVENT_CODE` | Optional. Events Manager → Test events code, while checking. Remove after. |

`CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are
already set for the other jobs.

## Database

Run `supabase/migrations/131_meta_capi.sql`, then schedule the cron job
(every minute, `POST https://crm.migrizo.com/api/meta-capi/run` with header
`x-cron-secret: <CRON_SECRET>`). The ready-to-run file with both is kept
outside the repo because it contains the secret.

## Backfill (leads that arrived in the last 7 days)

```bash
node scripts/meta-capi-backfill.mjs            # dry run: prints what it would do
node scripts/meta-capi-backfill.mjs --commit   # copies Meta ids + queues missing stages
```

Run from the project folder (reads `.env.local`). It never queues a stage that
is already in `meta_capi_events` and skips anything older than 7 days. The
every-minute job sends what it queued.

## Tests

```bash
npx jiti scripts/meta-capi-acceptance.ts
```

Runs the real sender against a local fake Meta server: no-id skip, 3 stages →
3 requests, no resend, 7-day skip, event_time > created, kill switch, plus
4xx/5xx handling.

## Debugging match rates

```sql
select e.event_name, e.status, e.http_status, e.attempt_count, e.event_time,
       l.meta_leadgen_id, e.response_body, e.updated_at
  from meta_capi_events e join leads l on l.id = e.lead_id
 order by e.updated_at desc limit 50;
```

Every attempt is also logged in Netlify function logs as
`[meta-capi] {"lead_id":…,"meta_leadgen_id":…,"event_name":…,"event_time":…,"http_status":…,"response_body":…}`.
