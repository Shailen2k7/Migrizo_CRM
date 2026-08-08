-- =============================================================================
-- 043_whatsapp_outbound_start.sql
--
-- Two reads that turn the WhatsApp inbox into an outbound channel:
--
--   whatsapp_phone_audit()      How many of your leads are actually reachable
--                               on WhatsApp, and why the rest are not.
--   whatsapp_reachable_leads()  The searchable, filterable list behind the
--                               "New conversation" picker.
--
-- WHY THE AUDIT MATTERS BEFORE THE SEQUENCE ENGINE
-- ------------------------------------------------
-- A 5-message sequence across 2,000 leads and across 300 leads are different
-- businesses. Meta charges per conversation, quality rating punishes sending to
-- numbers that are not on WhatsApp, and a lead with a landline or a mistyped
-- number is a guaranteed failed send. Knowing the real reachable count first
-- decides whether outbound is a campaign or a hand-picked list.
--
-- Both functions reuse whatsapp_normalize_phone() from 040, so "reachable" here
-- means exactly what the send route will accept — no second definition of valid
-- that can drift away from the first.
--
-- Read-only. No new tables. Safe to run twice.
-- =============================================================================

-- ── 1. THE AUDIT ────────────────────────────────────────────────────────────
-- One row of counts. Every lead falls into exactly one bucket, so the buckets
-- sum to total — if they ever stop summing, the classification has a hole.
create or replace function public.whatsapp_phone_audit(p_workspace_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (
    select l.id,
           l.phone,
           public.whatsapp_normalize_phone(l.phone) as norm,
           l.stage
      from public.leads l
     where l.workspace_id = p_workspace_id
  ), classified as (
    select b.*,
           case
             when b.phone is null or btrim(b.phone) = ''      then 'no_number'
             when b.norm is null                              then 'unusable'
             when s.phone_e164 is not null                    then 'opted_out'
             when c.id is not null                            then 'already_talking'
             else 'reachable'
           end as bucket
      from base b
      left join public.whatsapp_suppressions s
             on s.workspace_id = p_workspace_id and s.phone_e164 = b.norm
      left join public.whatsapp_conversations c
             on c.workspace_id = p_workspace_id and c.phone_e164 = b.norm
  )
  select jsonb_build_object(
    'total_leads',      (select count(*) from classified),
    'reachable',        (select count(*) from classified where bucket = 'reachable'),
    'already_talking',  (select count(*) from classified where bucket = 'already_talking'),
    'opted_out',        (select count(*) from classified where bucket = 'opted_out'),
    'no_number',        (select count(*) from classified where bucket = 'no_number'),
    'unusable',         (select count(*) from classified where bucket = 'unusable'),

    -- Reachable split by stage, so you can see whether your outbound audience is
    -- actually cold leads or people already deep in the pipeline.
    'reachable_by_stage', coalesce((
      select jsonb_object_agg(stage, n)
        from (select stage, count(*) as n from classified
               where bucket = 'reachable' group by stage) x
    ), '{}'::jsonb),

    -- Up to 25 examples of numbers we rejected. This is the actionable part:
    -- most "unusable" numbers are one missing digit or a stray country code,
    -- and seeing them is what makes them fixable.
    'unusable_examples', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'phone', phone))
        from (select id, phone from classified where bucket = 'unusable' limit 25) y
    ), '[]'::jsonb)
  )
  where p_workspace_id in (select user_workspaces());
$$;

comment on function public.whatsapp_phone_audit(uuid) is
  'Reachability breakdown of every lead. Buckets are mutually exclusive and sum to total_leads.';


-- ── 2. THE PICKER LIST ──────────────────────────────────────────────────────
-- Powers "New conversation". Deliberately returns leads we CANNOT message too,
-- flagged with a reason, rather than hiding them: searching for a client by name
-- and getting no result is indistinguishable from a broken search. Seeing the
-- row greyed out with "opted out" answers the question instead.
create or replace function public.whatsapp_reachable_leads(
  p_workspace_id uuid,
  p_query        text default null,
  p_stage        text default null,
  p_visa         text default null,
  p_only_sendable boolean default false,
  p_limit        int  default 100
) returns table (
  lead_id         uuid,
  full_name       text,
  phone_raw       text,
  phone_e164      text,
  email           text,
  stage           text,
  visa_type       text,
  score           int,
  conversation_id uuid,
  last_message_at timestamptz,
  suppressed      boolean,
  sendable        boolean,
  blocked_reason  text
)
language sql stable security definer set search_path = public as $$
  with rows as (
    select l.id as lead_id,
           l.full_name,
           l.phone as phone_raw,
           public.whatsapp_normalize_phone(l.phone) as phone_e164,
           l.email, l.stage, l.visa_type, l.score,
           c.id as conversation_id,
           c.last_message_at,
           (s.phone_e164 is not null) as suppressed
      from public.leads l
      left join public.whatsapp_conversations c
             on c.workspace_id = l.workspace_id
            and c.phone_e164 = public.whatsapp_normalize_phone(l.phone)
      left join public.whatsapp_suppressions s
             on s.workspace_id = l.workspace_id
            and s.phone_e164 = public.whatsapp_normalize_phone(l.phone)
     where l.workspace_id = p_workspace_id
       and l.workspace_id in (select user_workspaces())
       and (p_stage is null or p_stage = '' or l.stage = p_stage)
       and (p_visa  is null or p_visa  = '' or l.visa_type = p_visa)
       and (
         p_query is null or btrim(p_query) = ''
         or l.full_name ilike '%' || btrim(p_query) || '%'
         or coalesce(l.phone, '') ilike '%' || btrim(p_query) || '%'
         or coalesce(l.email, '') ilike '%' || btrim(p_query) || '%'
       )
  ), judged as (
    select r.*,
           case
             when r.suppressed        then 'Opted out — never message again'
             when r.phone_e164 is null and (r.phone_raw is null or btrim(r.phone_raw) = '')
                                      then 'No phone number on file'
             when r.phone_e164 is null then 'Phone number is not a valid WhatsApp number'
             else null
           end as blocked_reason
      from rows r
  )
  select lead_id, full_name, phone_raw, phone_e164, email, stage, visa_type,
         score, conversation_id, last_message_at, suppressed,
         (blocked_reason is null) as sendable,
         blocked_reason
    from judged
   where (not p_only_sendable) or blocked_reason is null
   -- Sendable first, then never-contacted before already-talking (a fresh lead
   -- is the more useful default), then highest score.
   order by (blocked_reason is null) desc,
            (conversation_id is null) desc,
            score desc nulls last,
            full_name asc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

comment on function public.whatsapp_reachable_leads(uuid, text, text, text, boolean, int) is
  'Lead list for the New Conversation picker. Returns unsendable leads too, with blocked_reason set.';


-- ── 3. GRANTS ───────────────────────────────────────────────────────────────
-- Both are security definer and gate on user_workspaces() internally, so
-- authenticated is the right audience: any team member may start a chat.
revoke all on function public.whatsapp_phone_audit(uuid) from public;
revoke all on function public.whatsapp_reachable_leads(uuid, text, text, text, boolean, int) from public;
grant execute on function public.whatsapp_phone_audit(uuid) to authenticated;
grant execute on function public.whatsapp_reachable_leads(uuid, text, text, text, boolean, int) to authenticated;
