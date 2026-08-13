-- ============================================================================
-- 063 — Everyone on the team can run campaigns + quick replies.
--
-- Why: campaign_access was empty, so ONLY the workspace owner's login could
-- toggle campaigns, edit steps or save quick replies. Everyone else's edits
-- were silently blocked by row-level security (the UI even said "saved" —
-- that lie is fixed in code in the same deploy as this migration).
--
-- What this does: every ACTIVE member of the workspace becomes a campaign
-- admin. New members added later can be granted the same way (one insert).
-- Safe to run twice.
-- ============================================================================

insert into public.campaign_access (workspace_id, user_id, granted_by)
select m.workspace_id, m.user_id, w.owner_id
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
 where coalesce(m.status, 'active') = 'active'
on conflict (workspace_id, user_id) do nothing;

-- Release any stale 10-minute send leases left behind by engine runs that
-- died mid-flight, so those people are due again on the next tick.
update public.wa_campaign_people
   set next_send_at = now()
 where status = 'waiting'
   and next_send_at is not null
   and next_send_at > now()
   and next_send_at <= now() + interval '15 minutes';

-- Show the result: who can now manage campaigns, and the engine's state.
select 'campaign admins' as what, count(*)::text as value from public.campaign_access
union all
select 'people waiting', count(*)::text from public.wa_campaign_people where status = 'waiting'
union all
select 'due right now', count(*)::text from public.wa_campaign_people
 where status = 'waiting' and next_send_at <= now()
union all
select 'engine last ran', coalesce(max(engine_last_run_at)::text, 'never') from public.whatsapp_settings;
