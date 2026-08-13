-- =============================================================================
-- 061_audience_facets.sql — THE AUDIENCE STOPS BEING A PUZZLE
--
-- WHAT WENT WRONG
--   Ticking Yes/Maybe/No under "Can invest" silently excluded all 82 hot leads,
--   because every one of them has investment_readiness NULL. The screen showed
--   "0" and gave no reason. The founder had to run SQL to find out why. That is
--   a design failure: a filter must never remove people invisibly.
--
-- THE TWO FUNCTIONS THIS ADDS
--
--   whatsapp_audience_facets(ws, audience)
--     Live counts for EVERY option, computed the way faceted search should be:
--     each dimension counted with its own filter lifted, so a chip's number is
--     exactly what you get if you click it. "No tag" is a first-class option
--     with its own count, never a hidden default.
--
--   ...and inside the same call, BLOCKERS:
--     when the audience reaches nobody, it names the single filter responsible
--     and says how many you would reach without it. The UI turns that into a
--     one-click fix. Nobody should ever see a bare 0 again.
--
-- Safe to run twice.
-- =============================================================================

-- ── 1. "No tag" becomes a real, selectable value ────────────────────────────
-- Was the string 'unknown', which no chip ever sent. Now '__none__', the same
-- token the facet counts are keyed by — one vocabulary end to end. Visa gains
-- the same option, because most leads have no route set and there was no way
-- to include them at all.
create or replace function public.whatsapp_campaign_matches(p_ws uuid, p_audience jsonb)
returns table (lead_id uuid, phone text)
language sql stable security definer set search_path = public as $fn$
  with a as (
    select coalesce(p_audience->'stages',     '[]'::jsonb) as stages,
           coalesce(p_audience->'industries', '[]'::jsonb) as industries,
           coalesce(p_audience->'readiness',  '[]'::jsonb) as readiness,
           coalesce(p_audience->'visa',       '[]'::jsonb) as visa,
           nullif(p_audience->>'added_days', '')::int      as added_days,
           nullif(p_audience->>'quiet_days', '')::int      as quiet_days
  )
  select l.id, p.norm
    from public.leads l
    cross join a
    cross join lateral (select public.whatsapp_normalize_phone(l.phone) as norm) p
   where l.workspace_id = p_ws
     and coalesce(l.is_sample, false) = false
     and p.norm is not null
     and case when jsonb_array_length(a.stages) > 0
              then l.stage in (select jsonb_array_elements_text(a.stages))
              else l.stage not in ('won', 'junk') end
     and (jsonb_array_length(a.industries) = 0
          or l.industry in (select jsonb_array_elements_text(a.industries))
          or (a.industries ? '__none__' and l.industry is null))
     and (jsonb_array_length(a.readiness) = 0
          or l.investment_readiness in (select jsonb_array_elements_text(a.readiness))
          or (a.readiness ? '__none__' and l.investment_readiness is null))
     and (jsonb_array_length(a.visa) = 0
          or l.visa_type in (select jsonb_array_elements_text(a.visa))
          or (a.visa ? '__none__' and l.visa_type is null))
     and (a.added_days is null
          or l.created_at >= now() - make_interval(days => a.added_days))
     and (a.quiet_days is null or a.quiet_days <= 0 or not exists (
            select 1 from public.whatsapp_conversations c
             where c.workspace_id = p_ws and c.phone_e164 = p.norm
               and c.last_outbound_at > now() - make_interval(days => a.quiet_days)))
     -- always on: never talk over a conversation that moved in the last 24h
     and not exists (
            select 1 from public.whatsapp_conversations c
             where c.workspace_id = p_ws and c.phone_e164 = p.norm
               and greatest(coalesce(c.last_message_at, 'epoch'::timestamptz),
                            coalesce(c.last_inbound_at, 'epoch'::timestamptz))
                   > now() - interval '24 hours');
$fn$;
grant execute on function public.whatsapp_campaign_matches(uuid, jsonb) to authenticated, service_role;

-- Any audience saved with the old token keeps working.
update public.whatsapp_sequences
   set audience = jsonb_set(audience, '{industries}',
         (select jsonb_agg(case when x = 'unknown' then '__none__' else x end)
            from jsonb_array_elements_text(audience->'industries') x))
 where audience ? 'industries' and audience->'industries' ? 'unknown';
update public.whatsapp_sequences
   set audience = jsonb_set(audience, '{readiness}',
         (select jsonb_agg(case when x = 'unknown' then '__none__' else x end)
            from jsonb_array_elements_text(audience->'readiness') x))
 where audience ? 'readiness' and audience->'readiness' ? 'unknown';


-- ── 2. FACETS ───────────────────────────────────────────────────────────────
create or replace function public.whatsapp_audience_facets(p_ws uuid, p_audience jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_stage jsonb; v_ind jsonb; v_rdy jsonb; v_visa jsonb;
  v_total int; v_blockers jsonb := '[]'::jsonb;
  v_try int; v_key text; v_label text;
begin
  if not (p_ws in (select user_workspaces())) then
    return jsonb_build_object('ok', false, 'reason', 'not_your_workspace');
  end if;

  -- ── how many the audience reaches as it stands ───────────────────────────
  select count(*) into v_total from public.whatsapp_campaign_matches(p_ws, p_audience);

  -- ── per-option counts, each with its OWN filter lifted ───────────────────
  -- (that is what makes a chip's number the number you get by clicking it)
  select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) into v_stage
    from (select l.stage, count(*)::int as n
            from public.whatsapp_campaign_matches(p_ws, p_audience - 'stages') m
            join public.leads l on l.id = m.lead_id
           group by l.stage) s;

  select coalesce(jsonb_object_agg(s.k, s.n), '{}'::jsonb) into v_ind
    from (select coalesce(l.industry, '__none__') as k, count(*)::int as n
            from public.whatsapp_campaign_matches(p_ws, p_audience - 'industries') m
            join public.leads l on l.id = m.lead_id
           group by 1) s;

  select coalesce(jsonb_object_agg(s.k, s.n), '{}'::jsonb) into v_rdy
    from (select coalesce(l.investment_readiness, '__none__') as k, count(*)::int as n
            from public.whatsapp_campaign_matches(p_ws, p_audience - 'readiness') m
            join public.leads l on l.id = m.lead_id
           group by 1) s;

  select coalesce(jsonb_object_agg(s.k, s.n), '{}'::jsonb) into v_visa
    from (select coalesce(l.visa_type, '__none__') as k, count(*)::int as n
            from public.whatsapp_campaign_matches(p_ws, p_audience - 'visa') m
            join public.leads l on l.id = m.lead_id
           group by 1) s;

  -- ── if it reaches nobody, name the filter to blame ───────────────────────
  if v_total = 0 then
    foreach v_key in array array['industries', 'readiness', 'visa', 'quiet_days', 'added_days', 'stages'] loop
      if p_audience ? v_key then
        select count(*) into v_try from public.whatsapp_campaign_matches(p_ws, p_audience - v_key);
        if v_try > 0 then
          v_label := case v_key
            when 'industries' then 'Field'
            when 'readiness'  then 'Can invest'
            when 'visa'       then 'Visa'
            when 'quiet_days' then 'Not messaged recently'
            when 'added_days' then 'Added'
            else 'Stage' end;
          v_blockers := v_blockers || jsonb_build_object(
            'key', v_key, 'label', v_label, 'would_reach', v_try);
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'stage', v_stage,
    'industry', v_ind,
    'readiness', v_rdy,
    'visa', v_visa,
    'blockers', v_blockers
  );
end;
$fn$;
grant execute on function public.whatsapp_audience_facets(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';

comment on function public.whatsapp_audience_facets(uuid, jsonb) is
  'Live per-option counts for the campaign audience builder, each dimension counted with its own filter lifted. When the audience reaches nobody it also names the responsible filter and how many would be reached without it.';
