# Migrizo CRM

A production-grade visa consultancy CRM with multi-user support, built on **Next.js 15** + **Supabase**.

## Features

**Dashboard** — Live KPIs, lead funnel, temperature donut, daily inflow, revenue trend, AI insights, recent activity, quick actions.
**Leads** — Sortable/filterable table, inline stage editing, lead drawer with notes & payments tabs, segment filters (Hot / Today / Overdue / Proposal / Won), CSV export.
**Payments** — Milestone tracking (Kickstart 25% → Profile Building 35% → Endorsement 25% → Post Approval 15%), client payment rows with progress dots, overdue detection.
**CSV/Excel Import** — Auto-detects Zoho Bigin fields, normalizes phone/email/stages/dates, detects duplicates, shows preview with errors before importing.
**Settings** — Theme toggle, danger zone with "Clear sample data" and "Reset workspace" (typed confirmation).
**AI COO** — Computed insights from live data (overdue follow-ups, hot leads, stale clients, conversion rate, suggested actions).
**Auth** — Google OAuth + email magic link via Supabase Auth.
**Multi-user** — Each signup gets an isolated workspace via DB trigger. RLS policies enforce workspace scoping on every query.
**Realtime** — Changes from other users on the same workspace appear instantly via Supabase realtime subscriptions.

## Stack

- Next.js 15 (App Router) + React 19
- TypeScript (strict)
- Supabase (Auth + Postgres + Realtime + RLS)
- TailwindCSS + custom design tokens with full dark mode
- TanStack Table v8 for the leads table
- Framer Motion for drawer / modal animations
- Papa Parse (CSV) + SheetJS (Excel) for imports
- Sonner for toasts
- Lucide icons

## Setup

### 1. Install

```bash
cd migrizo-crm
npm install
```

### 2. Create a Supabase project

1. Go to https://supabase.com → New project.
2. Once it's provisioned, go to **SQL Editor** → New query.
3. Open `supabase/migrations/001_initial_schema.sql` from this repo, paste the entire contents into the editor, and click **Run**. This creates all tables, RLS policies, the auto-workspace trigger, and the reset RPC.
4. Go to **Project Settings → API**. Copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. Configure Google OAuth (optional but recommended)

1. In Supabase: **Authentication → Providers → Google**. Toggle on.
2. Get OAuth credentials from https://console.cloud.google.com (Create OAuth client → Web). Set the authorized redirect URI to the one Supabase shows (looks like `https://<project>.supabase.co/auth/v1/callback`).
3. Paste the Client ID and Client Secret into Supabase. Save.

For email magic links, no extra config is needed — it works out of the box.

### 4. Environment variables

Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 5. Run locally

```bash
npm run dev
```

Open http://localhost:3000 → you'll be redirected to `/login`. Sign in with Google or request a magic link. A workspace is created automatically.

### 6. Deploy to Netlify

1. Push to GitHub.
2. On https://app.netlify.com → **Add new site → Import from Git**.
3. Pick your repo. Netlify auto-detects Next.js.
4. Add environment variables (same as `.env.local`) under **Site settings → Environment variables**. Update `NEXT_PUBLIC_SITE_URL` to your Netlify URL.
5. In your Supabase project: **Authentication → URL Configuration**. Add your Netlify URL to **Site URL** and to **Redirect URLs** (e.g. `https://your-site.netlify.app/**`).
6. Deploy.

## Multi-user setup

Anyone who signs up gets their own isolated workspace. Their data is invisible to others — RLS enforces this at the database layer, not just in app code.

To invite a teammate into the **same** workspace (future feature), you'd need to:
1. Run an `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (...)` from a server-side admin context.
2. (A team invite UI is planned for v2.)

## Database structure

- `workspaces` — One per signup (auto-created via trigger).
- `workspace_members` — Maps users to workspaces with a role (`admin` or `member`). Admins can delete leads/payments and reset workspace data.
- `leads` — All client records, scoped by `workspace_id`.
- `notes` — History attached to each lead.
- `payments` — Milestone-based payments with status (pending / paid / overdue).
- `activity` — Audit log of every action.

All tables have RLS enabled. Every policy uses the `user_workspaces()` helper function so users only see rows from their own workspaces.

## CSV/Excel import

The importer auto-detects these column names (case- and space-insensitive):

| Canonical field   | Detected from                                                                |
|-------------------|------------------------------------------------------------------------------|
| Full name         | Full Name, Name, Contact Name, Lead Name, or First Name + Last Name combined |
| Phone             | Phone, Phone Number, Mobile, Mobile Number, Contact Number, Cell             |
| Email             | Email, Email Address, E-mail                                                 |
| Visa type         | Visa Type, Visa, Product, Service, Category                                  |
| Stage             | Stage, Lead Stage, Status, Lead Status, Deal Stage                           |
| Last note         | Notes, Description, Comments, Remarks                                        |
| Next follow-up    | Next Follow-up, Follow-up Date, Next Action Date                             |
| Payment status    | Payment Status, Paid Status                                                  |
| Amount paid       | Amount, Amount Paid, Paid Amount, Revenue, Value                             |

It also normalizes:
- **Phone** → `+91 XXXXX XXXXX` Indian format
- **Stage** → mapped to canonical stages (won, lost, proposal, qualified, etc.)
- **Dates** → ISO, accepts DD/MM/YYYY and DD-MM-YYYY
- **Duplicates** → detected by phone OR email match against existing leads

## Resetting data

Settings → Danger zone has two options:

1. **Clear samples** — Deletes only leads marked `is_sample = true` (none by default since this build doesn't ship with sample data).
2. **Reset workspace** — Deletes ALL leads, payments, notes, and activity. Requires typing `RESET` to confirm. Admin-only.

Both call the `reset_workspace(ws_id, sample_only)` RPC which enforces admin role server-side.

## Project structure

```
migrizo-crm/
├── app/
│   ├── login/page.tsx          ← Google + magic link login
│   ├── auth/callback/route.ts  ← OAuth callback
│   ├── (app)/                  ← Protected routes (require auth)
│   │   ├── layout.tsx          ← Fetches user/workspace, mounts shell
│   │   ├── dashboard/page.tsx
│   │   ├── leads/page.tsx
│   │   ├── payments/page.tsx
│   │   ├── settings/page.tsx
│   │   └── ai/page.tsx
│   ├── layout.tsx              ← Root layout (Inter font, Sonner)
│   ├── globals.css             ← Design tokens + dark mode
│   └── page.tsx                ← Redirects to /dashboard
├── components/
│   ├── shared/
│   │   ├── app-provider.tsx    ← Global state, CRUD, realtime
│   │   ├── app-shell.tsx       ← Wraps everything, owns modals/drawers
│   │   └── modal.tsx
│   ├── leads/
│   │   ├── leads-table.tsx
│   │   ├── lead-drawer.tsx
│   │   ├── add-lead-dialog.tsx
│   │   └── import-dialog.tsx   ← THE big import system
│   ├── payments/record-payment-dialog.tsx
│   ├── dashboard/
│   │   ├── charts.tsx          ← Funnel, donut, daily, revenue
│   │   └── dashboard-bits.tsx  ← KPIs, AI strip, activity feed
│   ├── sidebar.tsx
│   └── topbar.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts           ← Browser client
│   │   ├── server.ts           ← Server client (RSC)
│   │   └── middleware.ts       ← Session refresh + route guard
│   ├── types.ts                ← All TS types + display metadata
│   ├── utils.ts                ← formatINR, timeAgo, normalizePhone, etc.
│   └── csv-import.ts           ← Zoho Bigin auto-detection + preview
├── supabase/migrations/001_initial_schema.sql
├── middleware.ts               ← Routes Supabase session check
├── tailwind.config.ts
├── next.config.js
├── netlify.toml
├── package.json
├── tsconfig.json
└── .env.local.example
```

## Production checklist

- [ ] Ran SQL migration in Supabase
- [ ] Set environment variables in Netlify
- [ ] Added Netlify URL to Supabase **Site URL** and **Redirect URLs**
- [ ] Tested signup → workspace auto-created
- [ ] Tested CSV import with a real Zoho Bigin export
- [ ] Tested reset workspace (typed RESET, data cleared)
- [ ] Tested with a second user → confirmed they cannot see the first user's data (RLS working)

## Troubleshooting

**"Workspace not found" after signup** — The DB trigger didn't run. Confirm `001_initial_schema.sql` was executed without errors in Supabase SQL Editor.

**OAuth redirect mismatch** — Add the exact Netlify URL (with `https://` and no trailing slash) to Supabase's redirect allowlist.

**Import not detecting fields** — Make sure your CSV column headers match the patterns in the table above. Unknown columns are listed under "Ignored columns" in the preview.

**Realtime not working** — Check that Supabase has realtime enabled for `leads`, `payments`, `activity` tables (Project → Database → Replication).
