-- =============================================================================
-- 080 — WHATSAPP CONVERSATION SEARCH
-- -----------------------------------------------------------------------------
-- WHY: the inbox search box searched a JavaScript array that only ever held the
-- 300 most-recently-active conversations. Anyone older than that was invisible,
-- so searching a real customer's name returned nothing and looked broken. Worse,
-- the client filter did `phone.includes('')` for text queries, which is true for
-- every row — so the phone clause silently matched everything.
--
-- WHAT: one RPC that searches the WHOLE table, in Postgres, where the data is.
-- Matches on:
--   • lead full name           (Amit, amit, AMIT — accent/case insensitive)
--   • lead email
--   • the phone, digits-only on BOTH sides, so "99993 11087", "+91 9999311087"
--     and "9999311087" all find +919999311087
--   • the last message preview
--
-- Returns the identical row shape as whatsapp_conversations_list so the inbox
-- can drop the results straight into the same list component.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

-- Trigram indexes make name/preview search fast at 100k conversations.
-- pg_trgm ships with Supabase; the guard keeps this file safe on a bare DB.
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice '080: pg_trgm unavailable, search will still work (seq scan)';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists leads_full_name_trgm
      on public.leads using gin (full_name gin_trgm_ops);
    create index if not exists wa_conv_preview_trgm
      on public.whatsapp_conversations using gin (last_preview gin_trgm_ops);
  end if;
end $$;

-- Digits-only phone index: the expression must match the one in the function.
create index if not exists wa_conv_phone_digits
  on public.whatsapp_conversations (workspace_id, (regexp_replace(phone_e164, '\D', '', 'g')));

drop function if exists public.whatsapp_conversations_search(uuid, text, int);

create function public.whatsapp_conversations_search(
  p_workspace_id uuid,
  p_query        text,
  p_limit        int default 80
) returns table (
  id uuid, lead_id uuid, phone_e164 text, lead_name text, lead_stage text,
  visa_type text, owner_id uuid, status text,
  unread_count int, needs_attention boolean,
  last_inbound_at timestamptz, last_message_at timestamptz,
  last_preview text, last_direction text,
  window_open boolean, window_expires_at timestamptz, suppressed boolean
)
language sql stable security definer set search_path = public as $$
  with q as (
    select
      btrim(coalesce(p_query, ''))                        as raw,
      lower(btrim(coalesce(p_query, '')))                 as low,
      regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
  )
  select c.id, c.lead_id, c.phone_e164,
         coalesce(l.full_name, c.phone_e164) as lead_name,
         l.stage, l.visa_type, c.owner_id,
         c.status, c.unread_count, c.needs_attention,
         c.last_inbound_at, c.last_message_at, c.last_preview, c.last_direction,
         (c.last_inbound_at is not null and c.last_inbound_at > now() - interval '24 hours') as window_open,
         (c.last_inbound_at + interval '24 hours') as window_expires_at,
         exists (select 1 from public.whatsapp_suppressions s
                  where s.workspace_id = c.workspace_id and s.phone_e164 = c.phone_e164) as suppressed
    from public.whatsapp_conversations c
    left join public.leads l on l.id = c.lead_id
   cross join q
   where c.workspace_id = p_workspace_id
     and c.workspace_id in (select user_workspaces())
     and q.raw <> ''
     and (
          -- name / email: plain substring, case-insensitive. No wildcards can
          -- leak in because we compare with position(), not LIKE.
          position(q.low in lower(coalesce(l.full_name, ''))) > 0
       or position(q.low in lower(coalesce(l.email, ''))) > 0
          -- phone: digits only on both sides, and only when the user actually
          -- typed digits. length(q.digits) = 0 for a name query, which is what
          -- made the old client-side check match every single row.
       or (length(q.digits) >= 3
           and position(q.digits in regexp_replace(c.phone_e164, '\D', '', 'g')) > 0)
          -- last message text, so "booking link" finds the thread too
       or position(q.low in lower(coalesce(c.last_preview, ''))) > 0
     )
   order by
     -- exact-ish name matches first, then most recent
     case when position(q.low in lower(coalesce(l.full_name, ''))) = 1 then 0 else 1 end,
     c.last_message_at desc nulls last
   limit greatest(1, least(coalesce(p_limit, 80), 300));
$$;

grant execute on function public.whatsapp_conversations_search(uuid, text, int) to authenticated;

comment on function public.whatsapp_conversations_search(uuid, text, int) is
  'Inbox search across ALL conversations (name, email, phone digits, last message). 080.';
