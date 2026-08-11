-- =============================================================================
-- 055_whatsapp_health_panel.sql — FAILURES YOU CAN SEE, AND RETRY WITH A CLICK
--
-- Twice in one evening the engine failed with a perfectly clear reason sitting
-- in a table nobody surfaces: the scheduler that never ran, and an assets job
-- that lost a 36-second race with its own trigger. Both times the founder had
-- to debug production in the SQL editor.
--
-- From now on:
--   * The Automation tab's overview carries every recent FAILED job, with the
--     lead's name and the plain-English error.
--   * whatsapp_job_retry(job_id) — one click puts a failed job back in the
--     queue with a fresh attempt counter.
--
-- Safe to run twice.
-- =============================================================================

-- ── 1. RETRY ────────────────────────────────────────────────────────────────
create or replace function public.whatsapp_job_retry(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_ws uuid; v_kind text;
begin
  select workspace_id, kind into v_ws, v_kind
    from public.whatsapp_auto_jobs where id = p_job_id;
  if v_ws is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.is_campaign_admin(v_ws) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;

  update public.whatsapp_auto_jobs
     set status = 'queued', attempts = 0, error = null, claimed_at = null, due_at = now()
   where id = p_job_id and status = 'failed';

  if not found then return jsonb_build_object('ok', false, 'reason', 'not_failed'); end if;

  insert into public.activity (workspace_id, user_id, lead_id, action, meta)
  values (v_ws, auth.uid(), null, 'whatsapp_job_retried', jsonb_build_object('job', p_job_id, 'kind', v_kind));
  return jsonb_build_object('ok', true);
end;
$fn$;
grant execute on function public.whatsapp_job_retry(uuid) to authenticated;


-- ── 2. OVERVIEW carries failures ────────────────────────────────────────────
create or replace function public.whatsapp_automation_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'settings', (select to_jsonb(a) from public.whatsapp_automation a where a.workspace_id = p_workspace_id),
    'cron', public.whatsapp_cron_status(),
    'counts', (
      select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
        from (select stage, count(*) as n
                from public.whatsapp_journeys
               where workspace_id = p_workspace_id and stop_reason is distinct from 'faq_only'
               group by stage) s),
    'entry', (
      select coalesce(jsonb_object_agg(entry_source, n), '{}'::jsonb)
        from (select entry_source, count(*) as n
                from public.whatsapp_journeys
               where workspace_id = p_workspace_id and stop_reason is distinct from 'faq_only'
               group by entry_source) e),
    'failed_jobs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'kind', q.kind, 'error', q.error,
               'updated_at', q.updated_at, 'lead_name', l.full_name,
               'phone', jj.phone_e164)
             order by q.updated_at desc), '[]'::jsonb)
        from public.whatsapp_auto_jobs q
        join public.whatsapp_journeys jj on jj.id = q.journey_id
        join public.leads l on l.id = jj.lead_id
       where q.workspace_id = p_workspace_id
         and q.status = 'failed'
         and q.updated_at > now() - interval '7 days'
       limit 12),
    'faqs', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order, f.created_at), '[]'::jsonb)
        from public.whatsapp_faqs f where f.workspace_id = p_workspace_id),
    'sequences', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
                                order by s.created_at), '[]'::jsonb)
        from public.whatsapp_sequences s where s.workspace_id = p_workspace_id),
    'journeys', (
      select coalesce(jsonb_agg(row_j order by row_j->>'updated_at' desc), '[]'::jsonb)
        from (
          select to_jsonb(j) || jsonb_build_object(
                   'lead_name', l.full_name,
                   'lead_stage', l.stage,
                   'pending_jobs', (select count(*) from public.whatsapp_auto_jobs q
                                     where q.journey_id = j.id and q.status = 'queued'))
                 as row_j
            from public.whatsapp_journeys j
            join public.leads l on l.id = j.lead_id
           where j.workspace_id = p_workspace_id
             and j.stop_reason is distinct from 'faq_only'
           order by j.updated_at desc
           limit 40) t)
  );
$fn$;
grant execute on function public.whatsapp_automation_overview(uuid) to authenticated;

notify pgrst, 'reload schema';
