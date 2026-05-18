# Zoho Bigin Integration Guide

How to wire this frontend to Zoho Bigin as the source of truth, with Supabase as the operational cache and realtime layer.

---

## Architecture

```
┌─────────────────────┐
│  Migrizo CRM        │  Static frontend (Phase 1)
│  Next.js (Phase 2)  │  React app on Netlify
└──────────┬──────────┘
           │ HTTPS / WebSocket
           ▼
┌─────────────────────┐
│  Netlify Functions  │  Backend-for-frontend proxy
│  (Node.js)          │  Hides OAuth secrets, validates writes
└──────────┬──────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐  ┌──────────────┐
│Supabase │  │ Zoho Bigin   │
│ Postgres│  │ REST API     │
│ Realtime│  │ Webhooks     │
│ Auth    │  │ OAuth 2.0    │
└─────────┘  └──────────────┘
```

**Why this split:**

- **Bigin** = system of record (contacts, deals, notes, tasks, documents). Source of truth.
- **Supabase** = operational cache + UI-only data (saved views, AI insights cache, user prefs, lead tags, follow-up state, activity log). Powers realtime collaboration and offline UX.
- **Netlify Functions** = OAuth, webhook receiver, signed proxy for write operations.

---

## Step 1 — Register a Zoho OAuth App

1. Go to [api-console.zoho.com](https://api-console.zoho.com) → sign in with the Zoho account that owns the Bigin workspace.
2. Click **Add Client** → choose **Server-based Applications**.
3. Fill in:
   - **Client Name:** Migrizo CRM
   - **Homepage URL:** `https://crm.migrizo.com`
   - **Authorized Redirect URIs:** `https://crm.migrizo.com/.netlify/functions/zoho-callback`
4. Copy the generated **Client ID** and **Client Secret**. Store these in Netlify environment variables (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`).

> ⚠ Use `accounts.zoho.in` (India data center) for endpoints, not `accounts.zoho.com`. The Migrizo Bigin account is on the India DC.

---

## Step 2 — OAuth 2.0 Authorization Code Flow

User clicks "Connect Zoho Bigin" in Settings → Integrations:

```
GET https://accounts.zoho.in/oauth/v2/auth
  ?scope=ZohoBigin.modules.ALL,ZohoBigin.settings.ALL,ZohoBigin.users.READ
  &client_id={ZOHO_CLIENT_ID}
  &response_type=code
  &access_type=offline
  &redirect_uri=https://crm.migrizo.com/.netlify/functions/zoho-callback
  &prompt=consent
```

Zoho redirects back with `?code=...`. The callback function exchanges it:

```js
// netlify/functions/zoho-callback.js
const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    redirect_uri: process.env.ZOHO_REDIRECT_URI,
    code: event.queryStringParameters.code,
  }),
});
const { access_token, refresh_token, expires_in } = await res.json();
// Store refresh_token in Supabase `zoho_connections` table, encrypted
```

`access_token` lives 1 hour. `refresh_token` is permanent (until revoked) — use it to mint new access tokens on demand.

---

## Step 3 — Bigin API Endpoints You'll Need

Base URL: `https://www.zohoapis.in/bigin/v2/`

| What you need | Endpoint |
|---|---|
| List/create/update deals (= leads) | `/Pipelines` |
| List/create/update contacts | `/Contacts` |
| Tasks (= follow-ups) | `/Tasks` |
| Notes | `/{Module}/{id}/Notes` |
| Pipeline stages metadata | `/settings/pipeline` |
| Custom field definitions | `/settings/fields?module=Pipelines` |
| Users (counselors) | `/users?type=ActiveUsers` |
| Webhook subscriptions | Bigin Settings → Workflow Rules (UI only) |

Authorization header: `Authorization: Zoho-oauthtoken {access_token}`

---

## Step 4 — Field Mapping (UI ↔ Bigin)

| Migrizo CRM field | Zoho Bigin field | Notes |
|---|---|---|
| Client name | `Deal_Name` + linked `Contact.Full_Name` | One Contact per Deal |
| Phone | `Contact.Phone` | E.164 format (+91…) |
| Email | `Contact.Email` | |
| Stage | `Stage` (in Pipelines) | 7 stages — match labels exactly |
| Score | `Lead_Score__c` | Custom field, integer 1–10 |
| Tags | `Tag` (built-in multi-select) | |
| Payment Phase | `Payment_Phase__c` | Custom picklist — 4 phases |
| Amount Paid | `Amount_Paid__c` | Custom currency field |
| Total Fee | `Amount` (built-in deal amount) | |
| Next Follow-up | `Task` linked to Deal, with `Due_Date` | Created/updated as separate Task |
| Notes | `Note_Content` (on `/Notes`) | |
| Lead Source | `Lead_Source` | Always "Meta Ads" for now |
| Counselor | `Owner` | Always Manik for now |

Create the custom fields once in **Bigin Setup → Customization → Modules → Pipelines → Layout** before the first sync runs.

---

## Step 5 — Webhooks (Bigin → Migrizo)

In Bigin: **Settings → Workflow Rules → Create Rule**. One rule per module (Deals, Contacts, Tasks). Each rule fires on Create/Update/Delete and `POST`s to:

```
https://crm.migrizo.com/.netlify/functions/bigin-webhook
```

Payload includes module + record ID + action. The webhook function then:

1. Verifies the request (Bigin sends an auth token in the header — validate against `ZOHO_WEBHOOK_SECRET`)
2. Fetches the full record from Bigin (webhook only sends an ID)
3. Updates the `leads_cache` table in Supabase
4. Supabase Realtime instantly pushes the change to every connected browser session

This is how realtime collaboration works — when one user edits a lead, every other open browser sees the update in <1 second.

---

## Step 6 — Read-Through / Write-Through Cache

**Reads** (the user opens Leads page):
1. Frontend queries Supabase `leads_cache` directly → instant render.
2. In the background, a function refreshes any stale rows (>5 min old) from Bigin.

**Writes** (the user inline-edits a stage):
1. Frontend optimistically updates Supabase via Supabase JS client → UI changes immediately.
2. A Netlify function asynchronously pushes the change to Bigin.
3. If Bigin rejects (e.g. validation), revert the Supabase row and show an error toast.

This pattern keeps the UI buttery-fast while maintaining Bigin as the source of truth.

---

## Step 7 — Supabase Tables (Local-Only Data)

These tables live in Supabase only — they are **not** in Bigin. They store data Bigin can't model well:

```sql
-- OAuth connections per user
zoho_connections (
  id, user_id, refresh_token_encrypted, org_id, dc_region, connected_at
)

-- Lead cache (mirror of Bigin Deals + Contacts, denormalized for read speed)
leads_cache (
  bigin_deal_id PRIMARY KEY, contact_id, name, phone, email,
  stage, score, payment_phase, amount_paid, total_fee,
  tags TEXT[], next_followup_at, notes, last_synced_at, updated_at
)

-- Multi-select tags (Bigin only has flat tags; here we control colors)
lead_tags (
  id, lead_id REFERENCES leads_cache, label, color
)

-- Saved filter views (All Leads, Hot, Today, etc.)
saved_views (
  id, user_id, name, icon, filters JSONB, sort_order, is_shared
)

-- AI COO conversation history
ai_conversations (
  id, user_id, title, started_at, last_message_at
)
ai_messages (
  id, conversation_id, role, content, created_at
)

-- AI COO insights cache (regenerated nightly)
ai_insights (
  id, kind, title, body, action_url, severity, created_at, dismissed_at
)

-- User preferences (theme, density, notification toggles)
user_prefs (
  user_id PRIMARY KEY, theme, density, notification_settings JSONB
)

-- Activity log for "who changed what when"
activity_log (
  id, lead_id, user_id, action, before JSONB, after JSONB, created_at
)
```

Enable **Realtime** on `leads_cache`, `lead_tags`, and `ai_insights`. Other tables can be polled.

---

## Step 8 — Authentication

- Use **Supabase Auth** with Google OAuth + Email/Password.
- After login, the user can connect their Zoho Bigin in Settings → Integrations (one-time OAuth flow).
- For now, treat the Zoho connection as **org-level** (single Bigin org, single team) — store one `zoho_connections` row shared by all team members. When you add multi-org later, scope by `org_id`.

---

## Step 9 — Rate Limits

Bigin API limits (Premier plan):
- **5,000 API calls/day** on Free
- **50,000 API calls/day** on Premier
- Burst: ~50 calls/minute

Best practices:
- Cache aggressively in Supabase (most reads should hit Supabase, not Bigin)
- Batch updates where possible
- For bulk imports, use Bigin's `/upsert` endpoints (10x cheaper than individual writes)
- Schedule the full-sync background job to run once every 6 hours, not continuously

---

## Step 10 — Launch Checklist

- [ ] Custom fields created in Bigin (`Lead_Score__c`, `Payment_Phase__c`, `Amount_Paid__c`)
- [ ] OAuth app registered in api-console.zoho.com
- [ ] `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_WEBHOOK_SECRET` set in Netlify env vars
- [ ] Supabase project created, tables + RLS policies deployed
- [ ] Netlify Functions deployed: `zoho-callback`, `bigin-webhook`, `leads`, `lead-update`
- [ ] Bigin webhooks pointing at production URL (test with one record first)
- [ ] Initial full-sync ran successfully (~248 deals × ~3 sec = ~12 min)
- [ ] Realtime subscription verified (edit in browser A → see in browser B)
- [ ] Optimistic-update rollback tested (force a Bigin validation error)

---

## Tips

- **Don't store Bigin access tokens in Supabase.** Only store the refresh token (encrypted). Mint a fresh access token on every API call from the server.
- **Use Bigin's `?fields=` param** on reads to only fetch what you need — cuts payload size by 70%+.
- **Index `leads_cache.bigin_deal_id`** — every webhook update hits this column.
- **Test with Bigin sandbox first** if available, or create a separate "dev" Pipelines stage set in production.
