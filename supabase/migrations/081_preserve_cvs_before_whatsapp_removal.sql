-- =============================================================================
-- 081 — PRESERVE EVERY CV BEFORE WHATSAPP IS REMOVED
-- -----------------------------------------------------------------------------
-- RUN THIS FIRST. Run it, check the numbers it reports, and only then run 082.
--
-- WHY: some leads' CVs were never copied into the permanent archive
-- (leads.cv_path). Their only pointer is a row in whatsapp_messages. Migration
-- 082 deletes that table, so those pointers would be lost — the files would
-- still sit in Storage, orphaned and unreachable.
--
-- WHAT THIS DOES: for every lead that has no archived CV, points cv_path at the
-- newest CV-looking file already in their chat. No file is copied or moved —
-- the storage bucket is NOT touched by 082, so the object stays exactly where
-- it is and the "Open CV" button keeps working afterwards.
--
-- Idempotent. Safe to run twice — it only ever fills a NULL.
-- =============================================================================

-- ── 1. what we are about to fix ──────────────────────────────────────────────
do $$
declare v_missing int; v_fixable int;
begin
  select count(*) into v_missing
    from public.leads l
   where l.cv_path is null
     and (l.profile_text is not null or l.profile_received is not null);

  select count(distinct l.id) into v_fixable
    from public.leads l
    join public.whatsapp_conversations c on c.lead_id = l.id
    join public.whatsapp_messages m on m.conversation_id = c.id
   where l.cv_path is null
     and m.direction = 'in'
     and m.media_path is not null
     and m.media_type in ('document','image');

  raise notice '081: % leads have a profile but no archived CV; % of them can be recovered from chat',
    v_missing, v_fixable;
end $$;

-- ── 2. point cv_path at the file that is already there ───────────────────────
-- Documents win over photos; newest wins within each kind.
with best as (
  select distinct on (c.lead_id)
         c.lead_id,
         m.media_path,
         m.media_name,
         m.created_at
    from public.whatsapp_conversations c
    join public.whatsapp_messages m on m.conversation_id = c.id
   where c.lead_id is not null
     and m.direction = 'in'
     and m.media_path is not null
     and m.media_type in ('document','image')
   order by c.lead_id,
            (case when m.media_type = 'document' then 0 else 1 end),
            m.created_at desc
)
update public.leads l
   set cv_path = b.media_path,
       cv_name = coalesce(nullif(btrim(l.cv_name), ''),
                          nullif(btrim(b.media_name), ''),
                          l.full_name || ' — CV'),
       updated_at = now()
  from best b
 where b.lead_id = l.id
   and l.cv_path is null;

-- ── 3. also stamp profile_received where a CV clearly arrived ────────────────
-- So the drawer shows the right state even for leads judged before that column
-- existed. Never overwrites a value a human set.
update public.leads l
   set profile_received = 'cv'
 where l.profile_received is null
   and l.cv_path is not null;

-- ── 4. report the result ─────────────────────────────────────────────────────
do $$
declare v_archived int; v_orphan int;
begin
  select count(*) into v_archived from public.leads where cv_path is not null;
  select count(*) into v_orphan
    from public.leads
   where cv_path is null and profile_text is not null;

  raise notice '081 DONE: % leads now have a CV file on record. % still have text only (their file was never kept — nothing was lost here, it was already gone).',
    v_archived, v_orphan;
end $$;

-- =============================================================================
-- BEFORE YOU RUN 082, export the chat history you want to keep.
-- In the Supabase SQL editor, run this and use "Download CSV":
--
--   select c.phone_e164,
--          l.full_name,
--          m.created_at,
--          m.direction,
--          m.body,
--          m.media_name,
--          m.status
--     from public.whatsapp_messages m
--     join public.whatsapp_conversations c on c.id = m.conversation_id
--     left join public.leads l on l.id = c.lead_id
--    order by c.phone_e164, m.created_at;
--
-- Keep that CSV somewhere safe. Interakt also holds the same history in its own
-- dashboard, so this is a belt-and-braces copy, not your only one.
-- =============================================================================
