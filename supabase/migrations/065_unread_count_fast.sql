-- ============================================================================
-- 065 — One cheap query for the unread badge.
--
-- The badge and the browser-tab count were both calling whatsapp_stats(), which
-- runs SEVEN count queries — two of them across the whole messages table — just
-- to read one number. Worse, they each re-ran it on every conversation change,
-- so while the campaign engine was sending, each outbound message triggered a
-- storm of counting in every open browser tab. That is what made the WhatsApp
-- screen crawl.
--
-- This is the same number, from one index-only count.
-- ============================================================================

create or replace function public.whatsapp_unread_count(p_workspace_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select count(*)::int
      from public.whatsapp_conversations c
     where c.workspace_id = p_workspace_id
       and c.unread_count > 0
  ), 0)
  where p_workspace_id in (select user_workspaces());
$$;

grant execute on function public.whatsapp_unread_count(uuid) to authenticated;

-- The supporting index already exists (idx_wa_conv_unread, a partial index on
-- workspace_id where unread_count > 0), so this is an index-only scan over a
-- handful of rows rather than a table count.


-- ── Clear everything, in one click ──────────────────────────────────────────
-- A badge you cannot act on is worse than no badge. If the count says 6 and
-- you cannot find the 6 — because they are old threads, or someone else read
-- them on another screen, or a counter drifted — you need a way out that does
-- not involve hunting. This is that way out.
create or replace function public.whatsapp_mark_all_read(p_workspace_id uuid)
returns int
language sql security definer set search_path = public as $$
  with cleared as (
    update public.whatsapp_conversations
       set unread_count = 0, updated_at = now()
     where workspace_id = p_workspace_id
       and unread_count > 0
       and workspace_id in (select user_workspaces())
    returning 1
  )
  select coalesce(count(*)::int, 0) from cleared;
$$;

grant execute on function public.whatsapp_mark_all_read(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ── WHERE ARE MY 6? ─────────────────────────────────────────────────────────
-- Run this to see exactly which conversations are counted as unread, and
-- whether they actually contain an inbound message you have not seen.
select c.phone_e164,
       coalesce(l.full_name, '(no lead)')      as who,
       c.unread_count,
       c.last_direction,
       c.last_message_at,
       left(coalesce(c.last_preview, ''), 60)  as preview,
       (select count(*) from public.whatsapp_messages m
         where m.conversation_id = c.id and m.direction = 'in') as inbound_msgs
  from public.whatsapp_conversations c
  left join public.leads l on l.id = c.lead_id
 where c.unread_count > 0
 order by c.last_message_at desc nulls last;
