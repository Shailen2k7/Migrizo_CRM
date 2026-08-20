# Fix: slow WhatsApp screen + edge-function hardening

## What was wrong — this one was my bug

The sidebar badge ALREADY had a watcher calling `whatsapp_stats()`. When I added
the tab-title count, I added a SECOND watcher calling the same thing. And
`whatsapp_stats()` is not cheap: it runs **7 COUNT queries**, two of them across
the entire messages table — just to read one number.

Both watchers re-ran it on *every* conversation change. Every outbound campaign
message updates a conversation row. So while the engine was sending, each
message set off ~14 heavy counts **in every open browser tab**. That is what
made conversations crawl.

## What is fixed

| Before | After |
|---|---|
| 2 realtime channels for the same number | **1**, owned by the app shell |
| `whatsapp_stats()` — 7 counts, 2 full table scans | `whatsapp_unread_count()` — **1 index-only count** (verified: Index Only Scan) |
| Re-queried on every row change | **Debounced** — a burst of 50 changes = 1 query |
| Listened to `*` on conversations | Only `UPDATE`, which is the only event that changes the count |

## "It says 6 but I can't find any unread"

Two things for that:

1. **A "Mark all read (6)" button** now appears in the WhatsApp header whenever
   the count is above zero. One click clears it — no hunting.
2. Migration 065 ends with a query that **lists exactly which conversations are
   counted as unread**, including how many inbound messages each really has.
   Run it and you will see whether those 6 are real or a drifted counter.

## The Netlify "edge function has crashed"

Your site is up — I fetched it and it served normally, so that was Netlify's
deploy-time screenshot, not a live outage. But it should never be *possible*,
so the auth middleware is now hardened: if Supabase is slow during a token
refresh (exactly what the query storm above would cause), it no longer throws
and takes the whole site down with it. It fails soft and lets the request
through — security is unchanged, because the real check is the server-side
`getUser()` in the app layout, which still runs.

Also removed `NEXT_USE_NETLIFY_EDGE` from netlify.toml — a dead flag from the
old Netlify runtime v4.

## Deploy — 2 steps

1. Supabase → SQL Editor → run `supabase/migrations/065_unread_count_fast.sql`
   **Run this FIRST**, before deploying the code — the new code calls the
   function it creates. (Safe to run twice. It prints your unread conversations
   at the end.)

2. Replace these files, commit, push:
   - `middleware.ts`                        (crash guard)
   - `lib/supabase/middleware.ts`           (soft-fail auth refresh)
   - `netlify.toml`                         (dead flag removed)
   - `components/whatsapp/wa-alerts.tsx`    (one cheap, debounced watcher)
   - `components/sidebar.tsx`               (reads the shared count)
   - `app/(app)/whatsapp/page.tsx`          (Mark all read button)

## Test
Open WhatsApp — the list should load at its old speed. Press "Mark all read" and
the badge, the tab title and the list all drop to zero together.
