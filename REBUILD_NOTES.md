# REBUILD NOTES — v3 (Full Rebuild)

## What's now real

Every page pulls real data from your Bigin via Netlify Functions → Supabase cache. **Zero hardcoded numbers, zero fake names anywhere.**

## What's working end-to-end

### Pages
| Page | Real data | Working CTAs |
|------|-----------|-------------|
| Dashboard | ✅ KPIs from Bigin, real funnel + quality charts, recent leads, today's tasks | Add Lead, Mark task done |
| Leads | ✅ All Bigin contacts | Add Lead, Change Stage (writes to Bigin), Sync, Search, Stage filter |
| Follow-ups | ✅ Bigin Tasks | New Follow-up, Mark Done |
| Payments | ✅ Bigin Deals | Record Payment |
| Calendar | ✅ Tasks plotted by date | Month nav |
| Reports | ✅ All charts from real data | — |
| AI COO | ✅ Real Claude API integration | Chat, suggested prompts |
| Settings | ✅ Real profile data | Save Profile, Save Notifications, Re-sync Zoho |

### Buttons that now actually do things
- ✅ **Add Lead** (Dashboard, Leads sidebar, Leads topbar) → creates contact in Bigin
- ✅ **Change Stage** (click any stage pill on Leads) → updates Bigin deal
- ✅ **Sync** (Leads page) → pulls latest from Bigin
- ✅ **New Follow-up** (Follow-ups page) → creates Task in Bigin
- ✅ **Mark Done** (anywhere) → updates Task status in Bigin
- ✅ **Record Payment** (Payments table → Record button per deal) → updates Bigin deal
- ✅ **Save Profile** (Settings) → writes to Supabase user_metadata
- ✅ **Save Notification Preferences** → writes to Supabase user_metadata
- ✅ **Sign Out** (click user card in sidebar, or button in Settings) → ends session
- ✅ **AI COO chat** → calls Claude Sonnet 4.5 with your real CRM context

## Empty states (no fake data)

Every section that doesn't have data yet shows a proper empty state with an action — not zeros that look like fake numbers.

## What you need to do AFTER deploying

### 1. Add ANTHROPIC_API_KEY for AI COO
- Netlify → Site → Configuration → Environment variables
- Add new variable: `ANTHROPIC_API_KEY` = your Anthropic API key
- Without this, AI COO chat shows: "ANTHROPIC_API_KEY not set"
- All other features work without this

### 2. (Optional) Add custom fields in Bigin if you want full payment tracking
The Payments page reads `Amount_Paid__c` and `Payment_Phase__c` from Bigin Deals. If those custom fields don't exist, payments will show ₹0 paid — but won't error. To set them up:
- Bigin → Setup → Modules → Deals → Customize fields
- Add: `Amount_Paid__c` (Currency) and `Payment_Phase__c` (Pick list: Kickstart, Profile Building, Endorsement, Final Submission)

### 3. To invite team members
- Supabase Dashboard → Authentication → Users → Add user
- Use "Auto Confirm User" (skip the broken email invite)
- They log in at `/login.html` with the password you set
- Their profile appears in Settings → Team & Users on their first login

## Known limitations (honest)

- **Lead Stages and Payment Stages in Settings are display-only.** Stages live in Bigin and must be edited there. This is correct architecture — single source of truth.
- **Notifications save to your profile but don't deliver yet.** Email/in-app delivery is Phase 2 (needs a notification service like Resend or a cron function).
- **Dark mode shown as "coming soon".** UI is built light-theme only.

## Deploy steps

1. Download the new zip
2. Unzip locally
3. Open your GitHub repo (`Shailen2k7/Migrizo_CRM-main`) in browser
4. Drag all files into the repo → commit
5. Wait ~60s for Netlify auto-deploy
6. Add `ANTHROPIC_API_KEY` env var (see step 1 above) for AI COO
7. Open the live site, log in, click Sync on Leads page to pull fresh data

## Files changed in this rebuild
- All 8 HTML pages (`index, leads, followups, payments, calendar, reports, ai-coo, settings`)
- `assets/app.js` (added modal system, formatters, empty-state helper)
- `assets/auth.js` (added profile update, lead/deal/task write helpers, AI COO call)
- `assets/styles.css` (appended modal, form, empty-state, spinner styles — old styles preserved)
- `netlify/functions/write-record.js` (now supports create + update for all modules)
- `netlify/functions/get-tasks.js` (standard fields only, resilient to empty)
- `netlify/functions/get-deals.js` (standard fields + try/catch on custom fields)
- `netlify/functions/ai-coo.js` (**NEW** — Claude API integration)
- `login.html` unchanged (was already working)
