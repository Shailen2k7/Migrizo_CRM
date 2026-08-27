-- =============================================================================
-- 079 — MEDIA RELIABILITY
-- -----------------------------------------------------------------------------
-- 35% of inbound attachments were arriving with media_path = null, which the
-- inbox renders as "file not available". The cause was not the provider:
-- Interakt's blob URLs stay valid for years, and re-fetching three failed ones
-- returned 200 with the full PDF. The capture step was failing on OUR side and
-- writing the reason to console.error only — so there was no record of what
-- went wrong, no retry, and nothing to recover from.
--
-- This migration adds the two things that were missing. It is deliberately
-- small: whatsapp_record_inbound is NOT touched. Its signature already carries
-- p_media_source_url, and dropping the live inbound RPC to add one more
-- parameter is a risk with no reward — the webhook can write media_error in a
-- follow-up UPDATE on the row it just created.
--
--   1. whatsapp_messages.media_error — why a capture failed, in the database
--      where a human (and the backfill sweep) can actually see it.
--
--   2. A partial index over broken media, so finding every recoverable file is
--      an index scan rather than a table scan of every message ever sent.
--
-- Idempotent: safe to run twice. Second run is NOTICEs only.
-- =============================================================================

-- ── 1. WHY IT FAILED ────────────────────────────────────────────────────────
alter table public.whatsapp_messages
  add column if not exists media_error text;

comment on column public.whatsapp_messages.media_error is
  'Why this attachment failed to capture (download or storage upload), in '
  'plain text. Null when the file stored fine, or when it has since been '
  'recovered by the media backfill. Paired with media_source_url, which is '
  'what makes recovery possible at all.';

-- ── 2. FIND BROKEN MEDIA FAST ───────────────────────────────────────────────
-- "Has an attachment, but no file behind it" — the exact set the backfill
-- sweep walks, and a tiny fraction of the table, so a partial index is both
-- cheap to maintain and the whole working set.
create index if not exists idx_wa_msg_media_broken
  on public.whatsapp_messages (workspace_id, created_at desc)
  where media_type is not null and media_path is null;

-- RLS: unchanged. media_error is a column on whatsapp_messages, which already
-- carries workspace-scoped policies from 040, and every read goes through
-- security-definer functions filtered on user_workspaces(). A new column
-- cannot widen that.

-- ── 3. VERIFY ───────────────────────────────────────────────────────────────
do $$
declare
  v_col boolean;
  v_idx boolean;
  v_broken int;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'whatsapp_messages'
       and column_name = 'media_error'
  ) into v_col;

  select exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'idx_wa_msg_media_broken'
  ) into v_idx;

  select count(*) into v_broken
    from public.whatsapp_messages
   where media_type is not null and media_path is null;

  raise notice '079 — media_error column ................ %', v_col;
  raise notice '079 — broken-media index ................ %', v_idx;
  raise notice '079 — attachments needing recovery ...... %', v_broken;

  if not (v_col and v_idx) then
    raise exception '079 did not apply cleanly — see the flags above';
  end if;
end $$;
