-- =============================================================================
-- 088 — PUT AN INBOUND LEAD INTO TODAY'S QUEUE THE MOMENT IT ARRIVES
-- -----------------------------------------------------------------------------
-- generate_daily_queue() builds each person's list once and then refuses to
-- touch it again that day:
--
--     if exists (select 1 from lead_queue where … and day = v_today) then
--       continue;
--
-- That is right for the nightly build — a queue that grew all day would never
-- feel finishable. But it means a lead who filled the website form at 11am
-- cannot be worked until tomorrow, which for an inbound lead who just typed
-- their own phone number is the worst possible outcome.
--
-- So inbound leads are inserted straight into today's queue instead of waiting
-- for the next nightly run. Deliberately NOT capped by cold_per_day: the cap
-- rations cold outreach, and a person who just raised their hand is not cold
-- outreach. A handful of extra rows on a busy day is the correct trade.
--
-- Idempotent, and safe to run twice.
-- =============================================================================

create or replace function public.enqueue_lead_now(
  p_workspace_id uuid,
  p_lead_id      uuid
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_today date := public.crm_today();
  v_lead  record;
  v_user  uuid;
  v_id    uuid;
begin
  select l.stage, l.retired_at, l.is_sample, l.snooze_until, l.phone, l.email
    into v_lead
    from public.leads l
   where l.id = p_lead_id and l.workspace_id = p_workspace_id;
  if not found then return null; end if;

  -- Same workability test the nightly build uses, so this can never queue a
  -- lead the queue itself would have rejected.
  if not public.lead_is_workable(
       v_lead.stage, v_lead.retired_at, v_lead.is_sample,
       v_lead.snooze_until, v_lead.phone, v_lead.email) then
    return null;
  end if;

  -- Already in today's list (a repeat submission, or the nightly build got
  -- there first) — nothing to do.
  if exists (select 1 from public.lead_queue
              where lead_id = p_lead_id and day = v_today) then
    return null;
  end if;

  -- Give it to whoever is carrying the least today, so inbound leads spread
  -- across the team instead of always landing on the same person.
  select r.user_id into v_user
    from public.lead_queue_rules r
   where r.workspace_id = p_workspace_id and r.active and r.cold_per_day > 0
   order by (select count(*) from public.lead_queue q
              where q.workspace_id = p_workspace_id
                and q.user_id = r.user_id
                and q.day = v_today
                and q.status = 'pending') asc,
            r.user_id asc
   limit 1;

  -- No one has an active quota: leave it in the Leads list rather than
  -- inventing an owner.
  if v_user is null then return null; end if;

  insert into public.lead_queue (workspace_id, user_id, lead_id, day, assigned_manually)
  values (p_workspace_id, v_user, p_lead_id, v_today, true)
  on conflict (lead_id, day) do nothing
  returning id into v_id;

  return v_id;
end;
$fn$;

grant execute on function public.enqueue_lead_now(uuid, uuid) to service_role;
grant execute on function public.enqueue_lead_now(uuid, uuid) to authenticated;

-- Verify:
--   select public.enqueue_lead_now('<workspace-uuid>', '<lead-uuid>');
--   select day, count(*) from public.lead_queue group by day order by day desc limit 3;
