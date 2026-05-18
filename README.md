# Migrizo CRM — Operations OS

> A world-class operational CRM for visa consultancy. **Not a traditional CRM** — this is an **Operations OS** that sits on top of Zoho Bigin and gives the team a fast, collaborative, realtime execution layer.

Built for Migrizo, UK Global Talent Visa consulting.

---

## Philosophy

Zoho Bigin remains the **source of truth** for contacts, deals, tasks and document storage. This frontend is the **operational layer** — designed for speed, clarity and zero-click execution.

**Design language:** Attio · Linear · Notion · Stripe Dashboard. Clean white interface, soft shadows, premium typography, elegant tables, AI-first.

---

## Project Structure

```
migrizo-crm/
├── index.html              Dashboard — KPIs, charts, AI insights
├── leads.html              Master Leads Workspace (heart of system)
├── followups.html          Follow-up Center — overdue, today, upcoming
├── payments.html           Payment Tracker — milestone pipeline
├── calendar.html           Unified calendar — all events
├── reports.html            Deep analytics & funnel reporting
├── ai-coo.html             AI COO — daily briefing + chat
├── settings.html           Profile, team, stages, integrations
├── assets/
│   ├── styles.css          Shared design system (single source)
│   └── app.js              Shared interactions (sidebar, toast, tabs)
├── README.md
├── INTEGRATION_ZOHO_BIGIN.md
├── DEPLOYMENT.md
├── _redirects              Netlify clean URLs
├── netlify.toml            Netlify config + security headers
└── .gitignore
```

---

## Current State

| Page | Status | Notes |
|---|---|---|
| Dashboard | ✅ Complete | 6 KPI cards, 4 charts, AI COO insights panel |
| Leads | ✅ Complete | Inline editing, drawer, popovers, bulk actions, 7-stage pipeline |
| Follow-ups | ✅ Complete | Tabs (overdue/today/upcoming/done), quick actions, urgency colors |
| Payments | ✅ Complete | Pipeline kanban + table view, milestone phases |
| Calendar | ✅ Complete | Month grid + today's schedule sidebar |
| Reports | ✅ Complete | Funnel, revenue, aging, conversion, time-per-stage, ROI |
| AI COO | ✅ Complete | Daily briefing, 6 insight cards, chat interface |
| Settings | ✅ Complete | 7 panes — profile, team, stages, integrations, notifications, appearance |

All pages share `assets/styles.css` and `assets/app.js` — change once, applies everywhere.

---

## Tech Stack

### Phase 1 — what's here (this MVP)
Static HTML + vanilla CSS + vanilla JS. Chart.js for charts, Lucide for icons, Inter from Google Fonts. Drag-and-drop deployable to Netlify in 30 seconds. **Zero build step.**

### Phase 2 — production rebuild (recommended)
- **Framework:** Next.js 15 + React 19 + TypeScript
- **Styling:** TailwindCSS + shadcn/ui (preserve the existing design tokens — they're already calibrated)
- **Animation:** Framer Motion
- **Tables:** TanStack Table (for the Leads workspace)
- **State:** Zustand (UI state) + TanStack Query (server state)
- **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions)
- **CRM Source of Truth:** Zoho Bigin (synced both ways via API)
- **Hosting:** Netlify (frontend) + Netlify Functions (proxy for Bigin OAuth and webhooks)
- **Auth:** Google Login + Email (via Supabase Auth)

---

## Design Tokens (from `assets/styles.css`)

```css
--primary: #6366F1
--primary-hover: #4F46E5
--primary-50: #EEF2FF
--bg: #F7F8FB
--surface: #FFFFFF
--border: #ECEEF2

/* Text scale */
--text-1: #0F172A  /* headings */
--text-2: #475569  /* body */
--text-3: #94A3B8  /* muted */

/* Status pairs */
--green-bg/text, --blue-bg/text, --amber-bg/text, --red-bg/text,
--purple-bg/text, --orange-bg/text, --pink-bg/text, --teal-bg/text
```

**Typography:** Inter 400/500/600/700/800/900
**Radius:** 8px / 10px / 12px / 999px
**Sidebar:** 256px fixed, sticky full-height
**Stat card icons:** 11px lucide, stroke-width 1.5

---

## Persistent Build Rules

Constraints already baked into every page — preserve in Phase 2:

- **Do not show:** Visa Type column, Lead ID column, Source column, Counselor column, Priority column
- **Single counselor mode:** Manik Verma is the only counselor — don't add per-counselor filtering yet
- **Single source:** Meta Ads is the only lead source — don't add source filter yet
- **Single visa type:** UK Global Talent Visa — don't add visa-type filtering yet
- **Visa Pipeline stages (locked, 7):**
  1. New Inquiry · 2. Attempted Contact · 3. Connected · 4. Qualified · 5. Consultation Scheduled · 6. Proposal Shared · 7. Partial Payment → Closed Won
- **Payment phases (locked, 4):**
  Kickstart · Profile Building · Endorsement Submission · Post Approval
- **Score:** 1–10 conic ring · ≤3 red · 4–6 amber · ≥7 green
- **Currency:** INR Indian comma format (₹12,45,000)
- **Phone:** +91 XXXXX XXXXX
- **AI COO is everywhere:** topbar gradient button + dedicated sidebar item + dashboard insights + leads mini banner

---

## Roadmap

| Phase | Scope | Effort |
|---|---|---|
| Phase 1 (now) | Static HTML mockup — visual + interaction fidelity | ✅ Done |
| Phase 2 | Next.js + Supabase rebuild · auth · realtime · Bigin sync | 3–4 weeks |
| Phase 3 | AI COO live (Claude/GPT integration) · automated nudges · WhatsApp send-from-app | 2 weeks |
| Phase 4 | Mobile responsive · iOS/Android web app · push notifications | 2 weeks |
| Phase 5 | Multi-counselor support · role-based access · team analytics | 1 week |

---

## Quick Start (Phase 1)

1. Open `index.html` directly in any browser — works locally with no server.
2. To deploy: drag the entire `migrizo-crm/` folder onto [app.netlify.com](https://app.netlify.com) → done.
3. For a custom domain (e.g. `crm.migrizo.com`), see `DEPLOYMENT.md`.

For the Bigin integration architecture and Phase 2 backend wiring, see `INTEGRATION_ZOHO_BIGIN.md`.
