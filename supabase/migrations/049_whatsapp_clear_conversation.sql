-- =============================================================================
-- 049_whatsapp_clear_conversation.sql — CLEAR / DELETE A CONVERSATION
--
-- "Close this chat completely, and when it opens again it starts fresh."
--
-- TWO ACTIONS, DELIBERATELY DIFFERENT
--   clear   — wipes the messages, keeps the contact in the inbox
--   delete  — removes the conversation entirely; it reappears blank the next
--             time that number messages you or you message them
--
-- WHAT IS NEVER TOUCHED, AND WHY
--   * whatsapp_suppressions — an opt-out is a promise. Clearing a chat must
--     never resurrect someone's consent. STOP stays STOP, forever.
--   * The activity trail — every clear writes an activity row, so a deleted
--     conversation still leaves evidence that it existed and who removed it.
--
-- THE ONE SUBTLE DECISION: last_inbound_at
--   Clearing keeps it. That timestamp is not our data, it is a fact about the
--   real world — Meta's 24-hour window. Resetting it would make the CRM believe
--   the window is shut while WhatsApp still considers it open, and free-form
--   replies would start failing for no visible reason.
--   Deleting the conversation drops it with the row, which is correct: the next
--   message genuinely re-establishes the window.
--
-- Safe to run twice.
-- =============================================================================

create or replace function public.whatsapp_clear_conversation(
  p_conversation_id uuid,
  p_delete          boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_ws uuid; v_lead uuid; v_phone text; v_deleted int;
begin
  select workspace_id, lead_id, phone_e164
    into v_ws, v_lead, v_phone
    from public.whatsapp_conversations
   where id = p_conversation_id;

  if v_ws is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Destructive, so admins only — not merely "a member of the workspace".
  if not public.is_campaign_admin(v_ws) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;

  delete from public.whatsapp_messages where conversation_id = p_conversation_id;
  get diagnostics v_deleted = row_count;

  -- Leave a trace BEFORE the row disappears, so the audit survives the delete.
  insert into public.activity (workspace_id, user_id, lead_id, action, meta)
  values (v_ws, auth.uid(), v_lead,
          case when p_delete then 'whatsapp_conversation_deleted' else 'whatsapp_chat_cleared' end,
          jsonb_build_object('phone', v_phone, 'messages_removed', v_deleted));

  if p_delete then
    delete from public.whatsapp_conversations where id = p_conversation_id;
    return jsonb_build_object('ok', true, 'deleted', true, 'messages_removed', v_deleted);
  end if;

  -- Keep the thread, empty it. last_inbound_at survives on purpose (see header).
  update public.whatsapp_conversations
     set unread_count    = 0,
         needs_attention = false,
         last_preview    = null,
         last_direction  = null,
         last_message_at = null,
         last_outbound_at = null,
         status          = 'open',
         updated_at      = now()
   where id = p_conversation_id;

  return jsonb_build_object('ok', true, 'deleted', false, 'messages_removed', v_deleted);
end;
$fn$;

comment on function public.whatsapp_clear_conversation(uuid, boolean) is
  'Empties a conversation, or removes it entirely. Never touches suppressions; always writes an activity row.';

revoke all on function public.whatsapp_clear_conversation(uuid, boolean) from public;
grant execute on function public.whatsapp_clear_conversation(uuid, boolean) to authenticated;
