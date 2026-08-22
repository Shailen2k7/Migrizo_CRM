# Roadmap module — FINAL v2 (complete, one upload)

Replaces every earlier roadmap zip (v5, ui-fix, final). Safe to upload over
what you already deployed — migrations are idempotent.

## Fixed in v2 (your 4 points)

1. **Signature** — now follows the plan's visa. An IFV roadmap signs
   "Operations Head – Innovator Founder Visa"; GTV stays as before.
   Email subject and title switch too.
2. **PDF page overlap** — page-break rules added: the navy footer and each
   week row can no longer be sliced in half at a page boundary; they move
   whole to the next page.
3. **Everything in Week 1–2** — each activity you tick now lands in the
   emptiest week band automatically, so the plan spreads itself as you build
   it. Weeks you set by hand are never touched. The Auto-schedule button
   still re-lays the whole plan Essential-first if you want it.
4. **Closing paragraph** — "How the endorsement works" is now visa-aware.
   IFV clients read about the innovative / viable / scalable tests and the
   founder day-to-day requirement — no Global Talent wording anywhere in an
   IFV email (verified by automated check).

## What's inside

```
supabase/migrations/067..071                       Roadmap library (unchanged from v5)
lib/roadmap/library.ts                             Types, themes, visa logic
lib/roadmap/template.ts                            Visa-aware email (signature, subject, closing)  ← NEW
components/roadmap/roadmap-builder.tsx             Builder UI (auto-spread weeks, PDF page breaks)
components/leads/lead-drawer.tsx                   Drawer with builder + Special offer field
app/api/roadmap/send/route.ts                      Visa-aware email subject                        ← NEW
```

## Deploy — 2 steps

### 1. Supabase (only if you have NOT already run them)
Run in order: 067 → 068 → 069 → 070 → 071. Already ran them? Skip this step —
nothing in v2 needs new SQL.

### 2. Git — upload these 5 files at the same paths
- `lib/roadmap/library.ts`
- `lib/roadmap/template.ts`
- `components/roadmap/roadmap-builder.tsx`
- `components/leads/lead-drawer.tsx`
- `app/api/roadmap/send/route.ts`

Do NOT delete `components/roadmap/roadmap-tab.tsx` — old sent roadmaps still
render through it.

## Quick check after deploy
Open an IFV lead → Roadmap → tick 6+ activities → they land across different
weeks. Review & send → signature and closing paragraph say Innovator Founder.
Download PDF → footer sits whole on its page.
