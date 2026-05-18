# Environment Variables — Netlify Setup

Add these in: **Netlify Dashboard → Your Site → Site Configuration → Environment Variables**

---

## Required variables (the CRM won't work without all of these)

| Variable | Value | Where to get it |
|---|---|---|
| `ZOHO_CLIENT_ID` | `1000.JNXPPMOSNYA60ZXUSXX99PZ7PG1NKD` | Already set — from Zoho API Console |
| `ZOHO_CLIENT_SECRET` | `your_secret_here` | **Zoho API Console** → your app → Client Secret |
| `ZOHO_REDIRECT_URI` | `https://migrizo-crm.netlify.app/.netlify/functions/zoho-callback` | Exact URL — paste as-is |
| `SUPABASE_URL` | `https://whcrxkufczhqgnshzajt.supabase.co` | Already set — your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `your_service_role_key` | **Supabase Dashboard** → Project Settings → API → `service_role` key (secret) |

---

## For AI COO (add when ready)

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key — add this yourself, never share it |

---

## How to add them in Netlify

1. Go to [app.netlify.com](https://app.netlify.com)
2. Select your site `migrizo-crm`
3. Click **Site configuration** → **Environment variables**
4. Click **Add a variable** for each row above
5. After adding all variables, click **Trigger deploy** → **Deploy site** to rebuild

---

## How to get ZOHO_CLIENT_SECRET

1. Go to [api-console.zoho.in](https://api-console.zoho.in)
2. Click your **Migrizo CRM** app
3. You'll see **Client ID** and **Client Secret** — copy the secret

**Important:** Also add `https://migrizo-crm.netlify.app/.netlify/functions/zoho-callback`
to the **Authorized Redirect URIs** in the same Zoho app settings.

---

## How to get SUPABASE_SERVICE_ROLE_KEY

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Select your `migrizo-crm` project
3. Click **Project Settings** (gear icon) → **API**
4. Under **Project API keys**, copy the `service_role` key (**secret**, never put in frontend code)

---

## After setting all variables

1. **Run the Supabase schema:** Open Supabase Dashboard → SQL Editor → paste contents of `supabase-schema.sql` → Run
2. **Set Supabase Auth redirect:** Supabase → Authentication → URL Configuration → set **Site URL** to `https://migrizo-crm.netlify.app`
3. **Deploy:** Netlify → Trigger deploy
4. **Connect Zoho:** Go to `https://migrizo-crm.netlify.app/settings.html` → Integrations → Connect Zoho Bigin
5. **Create your first user:** Supabase → Authentication → Users → Invite user (sends email with magic link)

---

## Creating team members (all 4 users)

Supabase → Authentication → Users → **Invite user**

Enter each team member's email. They'll get a magic link to set their password.

After they log in, update their profile in Supabase SQL editor:
```sql
update public.profiles set full_name = 'Manik Verma', role = 'admin' where id = '<user-id>';
update public.profiles set full_name = 'Team Member 2', role = 'counselor' where id = '<user-id>';
```

Or they can update their own name from the Settings → Profile page.
