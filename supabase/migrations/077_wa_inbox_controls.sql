-- ============================================================================
-- 077 — INBOX CONTROLS: delete-for-me, mark-as-unread.
--
-- WHAT "DELETE" MEANS HERE, honestly: the WhatsApp Business API cannot recall
-- a message from the customer's phone — that feature exists only in the
-- consumer app. So "delete" in our inbox is DELETE FOR ME: the row stays in
-- the database (it is business correspondence and may matter later), but it
-- is hidden from the thread. Nothing is ever destroyed.
--
-- Mark-as-unread mirrors WhatsApp's own affordance: a human saw a chat but
-- wants it back in their "deal with this" pile.
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table public.whatsapp_messages
  add column if not exists hidden boolean not null default false;

comment on column public.whatsapp_messages.hidden is
  'Delete-for-me: hidden from the inbox thread, never deleted. The customer''s copy is untouchable via the Business API.';

-- Thread now skips hidden rows. Same signature, so every caller keeps working.
create or replace function public.whatsapp_thread(p_conversation_id uuid, p_limit int default 400)
returns setof public.whatsapp_messages
language sql stable security definer set search_path = public as $$
  select m.* from public.whatsapp_messages m
   where m.conversation_id = p_conversation_id
     and m.workspace_id in (select user_workspaces())
     and not coalesce(m.hidden, false)
   order by m.created_at asc
   limit p_limit;
$$;
grant execute on function public.whatsapp_thread(uuid, int) to authenticated;

-- Hide / unhide one message. Workspace-guarded; returns whether a row moved
-- so the UI can tell a refused update from a successful one.
create or replace function public.whatsapp_hide_message(p_message_id uuid, p_hidden boolean default true)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  update public.whatsapp_messages
     set hidden = p_hidden, updated_at = now()
   where id = p_message_id
     and workspace_id in (select user_workspaces());
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;
grant execute on function public.whatsapp_hide_message(uuid, boolean) to authenticated;

-- Put a conversation back in the unread pile.
create or replace function public.whatsapp_mark_unread(p_conversation_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_n int;
begin
  update public.whatsapp_conversations
     set unread_count = greatest(unread_count, 1), updated_at = now()
   where id = p_conversation_id
     and workspace_id in (select user_workspaces());
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;
grant execute on function public.whatsapp_mark_unread(uuid) to authenticated;

notify pgrst, 'reload schema';

select count(*) filter (where hidden) as hidden_messages from public.whatsapp_messages;
