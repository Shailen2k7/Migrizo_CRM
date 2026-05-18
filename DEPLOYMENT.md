# Deployment Guide

Two deployment paths — pick the one that fits your workflow.

---

## Option A — Drag-and-Drop (Fastest, No Git)

Best for: pushing the Phase 1 MVP live in 30 seconds.

1. Open [app.netlify.com](https://app.netlify.com) and sign in (Google login works).
2. Click **Add new site → Deploy manually**.
3. Drag the entire `migrizo-crm/` folder onto the drop zone.
4. Netlify uploads everything and gives you a URL like `https://relaxed-curie-12abcd.netlify.app`.
5. Done. No build step.

To update: drag the folder again. Netlify replaces the previous deploy and keeps history.

---

## Option B — GitHub + Auto-Deploy

Best for: when you start iterating frequently or want collaborators.

1. Go to [github.com/new](https://github.com/new) → create a private repo called `migrizo-crm`.
2. On the new-repo page, click **uploading an existing file**.
3. Drag all files from `migrizo-crm/` into the upload area. Commit.
4. Back in Netlify: **Add new site → Import from Git → GitHub → migrizo-crm**.
5. Build settings: leave **Build command** blank, **Publish directory** blank. Click Deploy.

From now on, every push to `main` auto-deploys in ~10 seconds.

---

## Custom Domain — `crm.migrizo.com`

1. In Netlify: **Site settings → Domain management → Add custom domain** → enter `crm.migrizo.com`.
2. In your DNS provider (GoDaddy / Cloudflare / wherever migrizo.com lives):
   - Add a **CNAME record**: `crm` → `your-site-name.netlify.app`
   - (If using Cloudflare, set proxy to "DNS only" — orange cloud OFF — during cert provisioning, then turn back on)
3. Wait 5–30 minutes for DNS propagation.
4. Netlify automatically provisions a Let's Encrypt SSL certificate. Look for the green padlock.

---

## Environment Variables (Phase 2)

When you add Supabase + Zoho Bigin integration, set these in **Site settings → Environment variables**:

| Variable | Source | Where to find it |
|---|---|---|
| `ZOHO_CLIENT_ID` | Zoho OAuth app | api-console.zoho.com → your app |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth app | api-console.zoho.com → your app |
| `ZOHO_REDIRECT_URI` | Hardcoded | `https://crm.migrizo.com/.netlify/functions/zoho-callback` |
| `ZOHO_WEBHOOK_SECRET` | Generated | Generate a random 32-char string; paste into Bigin webhook config too |
| `SUPABASE_URL` | Supabase | Project Settings → API → URL |
| `SUPABASE_ANON_KEY` | Supabase | Project Settings → API → anon public key |
| `SUPABASE_SERVICE_KEY` | Supabase | Project Settings → API → service_role secret (server-only) |
| `ENCRYPTION_KEY` | Generated | 32-byte random for encrypting refresh tokens at rest |

⚠ **Never commit `.env` files.** The `.gitignore` in this repo already excludes them.

---

## Netlify Functions Layout (Phase 2)

```
migrizo-crm/
└── netlify/
    └── functions/
        ├── zoho-callback.js     OAuth callback handler
        ├── bigin-webhook.js     Receives Bigin webhooks
        ├── leads.js             GET leads from Supabase cache
        ├── lead-update.js       PATCH a lead (writes to Bigin + cache)
        ├── ai-coo.js            Proxies to Claude/GPT with lead context
        └── _lib/
            ├── zoho.js          Token refresh + Bigin API helpers
            ├── supabase.js      Server-side Supabase client
            └── auth.js          Verifies session JWT
```

Functions auto-deploy from this folder — no extra config needed (the `netlify.toml` in the repo handles it).

---

## Security

- **Never commit `.env` files.** `.gitignore` excludes them.
- **Use Supabase RLS** (Row Level Security) on every table. Default-deny, then write policies per role.
- **Lock CORS** on Netlify Functions to `crm.migrizo.com` only.
- **Rotate the Zoho client secret every 6 months.**
- **During Phase 2 dev**, enable Netlify password protection (Site settings → Visitor access → Set password). Remove before public launch.
- **Set the security headers** already configured in `netlify.toml`:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=()`

---

## Free Tier Capacity

| Service | Free tier limit | Migrizo's actual needs |
|---|---|---|
| Netlify static hosting | Unlimited | ✅ Plenty |
| Netlify Functions | 125k invocations / month | ✅ ~30k/month projected |
| Supabase database | 500 MB | ✅ ~5 MB projected (text-only) |
| Supabase auth users | 50,000 MAU | ✅ <10 (team size) |
| Supabase realtime | 200 concurrent | ✅ <10 |
| Zoho Bigin API | 5,000 calls/day (free) | ⚠ Upgrade to Premier (50k/day) once live |

**Total monthly cost at current scale:** ₹0 → ₹2,000 (Bigin Premier). Everything else stays free.

---

## Going Live Checklist

- [ ] All 8 pages render without console errors
- [ ] `crm.migrizo.com` DNS resolves and SSL is green
- [ ] Netlify password protection removed (or kept during private beta)
- [ ] All env vars set in production (verify with a test function call)
- [ ] Bigin OAuth app's redirect URI matches production URL exactly
- [ ] Bigin webhook URL points to production, tested with a single record
- [ ] Supabase RLS policies deployed and tested
- [ ] First full-sync ran successfully and counts match Bigin
- [ ] Lead inline-edit roundtrip works (Migrizo → Supabase → Bigin → webhook back → Migrizo)
- [ ] AI COO chat responds (proxy to Claude/GPT is wired)
- [ ] Mobile breakpoint tested on iPhone (sidebar collapses gracefully)
