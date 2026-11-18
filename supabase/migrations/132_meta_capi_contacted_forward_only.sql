-- =============================================================================
-- Meta CAPI — `contacted` only on genuine forward progress.
--
-- Before: ANY first stage change by a team member sent `contacted`, including a
-- move to Junk. That teaches Meta that junk leads progress.
--
-- After: `contacted` is sent only when a team member moves a Meta lead INTO one
-- of these stages (allow-list — any stage not listed, including stages added
-- later, sends nothing):
--     hot, warm, highly_eligible, eligible, mr_coming_soon, invoice_sent, won
-- Never sent for: cold (entry stage), not_responding, junk, lost, or anything else.
--
-- `qualified` is sent ONLY when a team member picks Eligible / Highly Eligible in
-- the Eligibility dropdown (eligibility_source = 'manual'). WhatsApp, rule, AI and
-- derived tags never send it.
--
-- Still once per lead (unique lead_id + event_name). Only the trigger function
-- changes; the queue and the `lead` rule are unchanged. Safe to run twice.
-- =============================================================================

create or replace function public.meta_capi_lead_events()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.meta_leadgen_id is null then
    return new;                                   -- not a Meta lead: nothing to send
  end if;

  -- lead: the moment the lead got its Meta id (arrival).
  if tg_op = 'INSERT' or old.meta_leadgen_id is null then
    perform public.meta_capi_enqueue(new.workspace_id, new.id, 'lead', new.created_at);
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null then
    -- contacted: a team member moves the lead FORWARD (allow-list only).
    if new.stage is distinct from old.stage
       and new.stage in ('hot', 'warm', 'highly_eligible', 'eligible', 'mr_coming_soon', 'invoice_sent', 'won') then
      perform public.meta_capi_enqueue(new.workspace_id, new.id, 'contacted', now());
    end if;
    -- qualified: ONLY when a team member picks Eligible / Highly Eligible in the
    -- Eligibility dropdown (drawer or Master Leads → eligibility_source = 'manual').
    -- Tags from WhatsApp, rules, AI or history (source whatsapp/rule/ai/derived)
    -- never count. A team member confirming a bot tag does count.
    if new.eligibility in ('eligible', 'highly_eligible')
       and new.eligibility_source = 'manual'
       and (coalesce(old.eligibility, '') not in ('eligible', 'highly_eligible')
            or old.eligibility_source is distinct from 'manual') then
      perform public.meta_capi_enqueue(new.workspace_id, new.id, 'qualified', coalesce(new.eligibility_at, now()));
    end if;
  end if;
  return new;
exception when others then
  raise warning 'meta_capi_lead_events failed: %', sqlerrm;
  return new;
end $$;
