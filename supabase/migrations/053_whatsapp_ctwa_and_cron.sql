-- =============================================================================
-- 053_whatsapp_ctwa_and_cron.sql — CLICK-TO-WHATSAPP LEADS + A SCHEDULER THAT
--                                  ACTUALLY RUNS
--
-- THREE FIXES.
--
-- 1. CLICK-TO-WHATSAPP ADS ARE FULLY-TAGGED LEADS
--    A Meta "Send message" ad with a form does not POST to our API. It sends
--    the answers to us AS THE FIRST WHATSAPP MESSAGE:
--
--        Full name: Shailen Pathak
--        Phone number: +919999311087
--        Email: shailenpathak@gmail.com
--        Field of expertise? Which area do you qualify under?: Tech
--        Readiness to invest? Are you willing to invest…?: Yes
--
--    Until now that was treated as plain text and eligibility went to a human.
--    We now PARSE it, so the lead arrives with a real name, email, industry and
--    investment_readiness — exactly like an ad-form lead — and runs the whole
--    journey automatically: hot lane, intro, then guide + video + booking on
--    reply. No human step, no template, no marketing frequency cap.
--
--    The parser is deliberately shape-driven ("Label: value" lines), not
--    wording-driven, so editing the questions in Meta does not break it.
--
-- 2. THE SCHEDULER
--    051 scheduled the drains only "if the cron schema exists" — and on a
--    Supabase project where pg_cron was never enabled, that check silently did
--    nothing. Result: the engine only ran when a human pressed "Run now".
--    This migration enables the extensions, schedules both drains, and adds
--    whatsapp_cron_status() so the UI can SHOW whether it is really running.
--
-- 3. Adds whatsapp_touch_read(), a single call the inbox uses to clear both the
--    unread count and the "needs reply" flag when a human opens a chat.
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. THE PARSER ───────────────────────────────────────────────────────────
-- Reads "Label: value" lines out of a click-to-WhatsApp first message.
-- Returns null when the message is ordinary conversation, so a human typing
-- "Email: hi" cannot accidentally look like a lead form (we require at least
-- two recognised fields).
create or replace function public.whatsapp_parse_ctwa(p_text text)
returns jsonb language plpgsql immutable as $fn$
declare
  ln        text;
  lbl       text;
  val       text;
  pos       int;
  hits      int := 0;
  v_name    text;
  v_email   text;
  v_expert  text;
  v_ready   text;
  v_phone   text;
begin
  if p_text is null or length(p_text) < 12 then return null; end if;

  foreach ln in array regexp_split_to_array(p_text, E'\n') loop
    pos := position(':' in ln);
    -- A question keeps its own "?" before the colon; that is fine, we only
    -- need the LAST colon-separated value.
    pos := length(ln) - position(':' in reverse(ln)) + 1;
    if pos <= 1 then continue; end if;

    lbl := lower(btrim(substr(ln, 1, pos - 1)));
    val := btrim(substr(ln, pos + 1));
    if val = '' then continue; end if;

    -- ORDER MATTERS. The readiness question contains the word "professional"
    -- ("…invest in professional guidance…"), which a loose expertise pattern
    -- happily swallows — that mis-read cost us a whole tagged lead in testing.
    -- Readiness is therefore matched first, and "profession" is anchored to a
    -- word end so "professional" can never trip it.
    if    lbl ~ 'readiness|willing to invest|ready to invest|budget'
                                             then v_ready  := val; hits := hits + 1;
    elsif lbl ~ 'full name|^name\M'          then v_name   := val; hits := hits + 1;
    elsif lbl ~ 'e-?mail'                    then v_email  := val; hits := hits + 1;
    elsif lbl ~ 'phone|mobile|contact number' then v_phone := val; hits := hits + 1;
    elsif lbl ~ 'expertise|which area|\mfield\M|domain|industry|profession\M|specialis|specializ'
                                             then v_expert := val; hits := hits + 1;
    end if;
  end loop;

  if hits < 2 then return null; end if;   -- ordinary chat, not a form

  return jsonb_strip_nulls(jsonb_build_object(
    'full_name', v_name,
    'email',     v_email,
    'phone',     v_phone,
    'expertise', v_expert,
    'readiness', v_ready,
    'industry',  public.map_expertise(v_expert),
    'investment_readiness', public.map_readiness(v_ready)
  ));
end;
$fn$;
grant execute on function public.whatsapp_parse_ctwa(text) to authenticated, service_role;


-- ── 2. APPLY WHAT WE PARSED ─────────────────────────────────────────────────
-- Fills gaps only. A value a human has since corrected in the CRM is never
-- overwritten by an old ad answer — same rule as the meta-lead ingest.
create or replace function public.whatsapp_apply_ctwa(
  p_ws uuid, p_lead uuid, p_journey uuid, p_parsed jsonb
) returns void language plpgsql security definer set search_path = public as $fn$
declare
  v_ind   text := p_parsed->>'industry';
  v_rdy   text := p_parsed->>'investment_readiness';
  v_name  text := p_parsed->>'full_name';
  v_email text := p_parsed->>'email';
begin
  if p_parsed is null then return; end if;

  update public.leads l
     set full_name = case
           -- "WhatsApp 9199…" is our placeholder; a real name always wins
           when v_name is not null and (l.full_name is null or l.full_name ~ '^WhatsApp ')
             then v_name else l.full_name end,
         email     = coalesce(l.email, v_email),
         industry  = coalesce(l.industry, v_ind),
         investment_readiness = coalesce(l.investment_readiness, v_rdy),
         intake    = coalesce(l.intake, '{}'::jsonb)
                     || jsonb_strip_nulls(jsonb_build_object(
                          'expertise', p_parsed->>'expertise',
                          'investment_readiness', p_parsed->>'readiness',
                          'captured_via', 'click_to_whatsapp')),
         updated_at = now()
   where l.id = p_lead;

  update public.whatsapp_journeys j
     set field     = coalesce(j.field, v_ind),
         readiness = coalesce(j.readiness, v_rdy),
         priority  = j.priority or (public.whatsapp_field_eligible(v_ind) and v_rdy = 'yes')
   where j.id = p_journey;
end;
$fn$;


-- ── 3. THE TRIGGER ──────────────────────────────────────────────────────────
-- Same as 052 plus: parse the first message, and enrich even an EXISTING
-- untagged lead (a click-to-WhatsApp ad answered by someone already in the CRM
-- is still free, accurate data — throwing it away would be silly).
create or replace function public.whatsapp_auto_on_inbound()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  j        public.whatsapp_journeys%rowtype;
  cfg      public.whatsapp_automation%rowtype;
  v_conv   public.whatsapp_conversations%rowtype;
  v_lead   uuid;
  v_new    boolean := false;
  v_parsed jsonb;
begin
  if new.direction <> 'in' then return new; end if;

  select * into cfg from public.whatsapp_automation where workspace_id = new.workspace_id;
  if cfg.workspace_id is null or not cfg.enabled then return new; end if;

  v_parsed := public.whatsapp_parse_ctwa(new.body);

  select * into j from public.whatsapp_journeys
   where workspace_id = new.workspace_id and conversation_id = new.conversation_id;
  if j.id is null then
    select jj.* into j from public.whatsapp_journeys jj
      join public.whatsapp_conversations c on c.id = new.conversation_id
     where jj.workspace_id = new.workspace_id and jj.phone_e164 = c.phone_e164
     limit 1;
    if j.id is not null and j.conversation_id is null then
      update public.whatsapp_journeys set conversation_id = new.conversation_id where id = j.id;
    end if;
  end if;

  -- ═══ they reached out to us, and we have never spoken ════════════════════
  if j.id is null and cfg.inbound_enabled then
    select * into v_conv from public.whatsapp_conversations where id = new.conversation_id;

    if v_conv.id is not null
       and not exists (select 1 from public.whatsapp_suppressions s
                        where s.workspace_id = new.workspace_id and s.phone_e164 = v_conv.phone_e164)
       and not exists (select 1 from public.whatsapp_messages m
                        where m.conversation_id = new.conversation_id
                          and m.direction = 'out' and m.id <> new.id)
    then
      v_lead := public.whatsapp_auto_lead_from_inbound(new.workspace_id, v_conv.id);
      if v_lead is not null then
        insert into public.whatsapp_journeys
          (workspace_id, lead_id, conversation_id, phone_e164, stage, entry_source)
        values (new.workspace_id, v_lead, v_conv.id, v_conv.phone_e164, 'intro_queued', 'whatsapp_inbound')
        on conflict (workspace_id, lead_id) do update
          set conversation_id = excluded.conversation_id
        returning * into j;

        if j.id is not null and j.stage = 'intro_queued' then
          v_new := true;
          -- Tag BEFORE the intro job runs, so the hot lane and the eligibility
          -- branch both see the real values on the very first pass.
          perform public.whatsapp_apply_ctwa(new.workspace_id, v_lead, j.id, v_parsed);
          insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
          values (new.workspace_id, j.id, 'inbound_intro',
                  jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id,
                                     'ctwa', v_parsed is not null));
        end if;
      end if;
    end if;
  end if;

  -- Late form data for a journey we already had → still worth capturing.
  if j.id is not null and not v_new and v_parsed is not null then
    perform public.whatsapp_apply_ctwa(new.workspace_id, j.lead_id, j.id, v_parsed);
    select * into j from public.whatsapp_journeys where id = j.id;
  end if;

  -- ═══ existing behaviour ══════════════════════════════════════════════════
  if j.id is not null and not v_new then
    update public.whatsapp_auto_jobs
       set status = 'skipped', error = 'lead_replied'
     where journey_id = j.id and status = 'queued' and kind in ('reminder','cold_enrol');

    if j.stage in ('welcome_queued','awaiting_reply') then
      if public.whatsapp_field_eligible(j.field) then
        update public.whatsapp_journeys set stage = 'eligible' where id = j.id;
        insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind)
        select new.workspace_id, j.id, 'assets'
         where not exists (select 1 from public.whatsapp_auto_jobs q
                            where q.journey_id = j.id and q.kind = 'assets'
                              and q.status in ('queued','running','done'));
      else
        update public.whatsapp_journeys set stage = 'needs_review' where id = j.id;
        update public.whatsapp_conversations set needs_attention = true where id = new.conversation_id;
        insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
        select new.workspace_id, j.id, 'notify',
               jsonb_build_object('reason', 'field_review', 'conversation_id', new.conversation_id)
         where not exists (select 1 from public.whatsapp_auto_jobs q
                            where q.journey_id = j.id and q.kind = 'notify'
                              and q.payload->>'reason' = 'field_review');
      end if;
    end if;
  end if;

  -- Q&A brain: every message except the first of a new inbound journey, and
  -- never a pure ad-form dump (there is no question in it to answer).
  if cfg.auto_faq and coalesce(new.body, '') <> '' and not v_new and v_parsed is null then
    insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
    select new.workspace_id,
           coalesce(j.id, public.whatsapp_auto_orphan_journey(new.workspace_id, new.conversation_id)),
           'faq',
           jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id)
     where coalesce(j.id, public.whatsapp_auto_orphan_journey(new.workspace_id, new.conversation_id)) is not null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists whatsapp_auto_on_inbound on public.whatsapp_messages;
create trigger whatsapp_auto_on_inbound after insert on public.whatsapp_messages
  for each row execute function public.whatsapp_auto_on_inbound();


-- ── 4. READ = READ ──────────────────────────────────────────────────────────
-- One call the inbox makes when a human opens a chat: the unread count goes to
-- zero AND the "needs reply" flag clears. Reading it IS the acknowledgement —
-- a flag that only a developer knows how to clear is not a flag, it is noise.
create or replace function public.whatsapp_touch_read(p_conversation_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update public.whatsapp_conversations
     set unread_count = 0, needs_attention = false, updated_at = now()
   where id = p_conversation_id
     and workspace_id in (select user_workspaces());
$fn$;
grant execute on function public.whatsapp_touch_read(uuid) to authenticated;


-- ── 5. THE SCHEDULER, FOR REAL ──────────────────────────────────────────────
-- 051 wrapped this in "if the cron schema exists", which quietly did nothing
-- on a project where pg_cron had never been enabled. Enable, then schedule.
do $ext$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron could not be created here (%). Enable it in Supabase → Database → Extensions, then re-run this migration.', sqlerrm;
  end;
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net could not be created here (%).', sqlerrm;
  end;
end $ext$;

do $cron$
declare v_url text := 'https://crm.migrizo.com';
        v_hdr jsonb := '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron is not installed — automation will NOT run by itself.';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job
   where jobname in ('migrizo-whatsapp-auto-drain','migrizo-whatsapp-seq-drain');

  perform cron.schedule('migrizo-whatsapp-auto-drain', '* * * * *', format(
    $job$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb);$job$,
    v_url || '/api/whatsapp/automation/drain', v_hdr::text));

  perform cron.schedule('migrizo-whatsapp-seq-drain', '*/10 * * * *', format(
    $job$select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb);$job$,
    v_url || '/api/whatsapp/sequences/drain', v_hdr::text));

  raise notice 'Scheduled: automation drain every minute, sequence drain every 10 minutes.';
end $cron$;


-- ── 6. IS IT ACTUALLY RUNNING? ──────────────────────────────────────────────
-- The UI shows this. A scheduler you cannot see is a scheduler you cannot
-- trust — the whole reason nobody noticed the engine was idle for days.
create or replace function public.whatsapp_cron_status()
returns jsonb language plpgsql stable security definer set search_path = public, cron as $fn$
declare v_jobs jsonb := '[]'::jsonb; v_last timestamptz; v_has boolean;
begin
  v_has := exists (select 1 from pg_namespace where nspname = 'cron');
  if not v_has then
    return jsonb_build_object('installed', false, 'jobs', v_jobs, 'ok', false);
  end if;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb)
      into v_jobs
      from cron.job
     where jobname like 'migrizo-whatsapp-%';
  exception when others then v_jobs := '[]'::jsonb;
  end;

  -- Newer pg_cron keeps run history; older ones do not. Either is fine.
  begin
    execute $q$select max(start_time) from cron.job_run_details d
              join cron.job j on j.jobid = d.jobid
             where j.jobname = 'migrizo-whatsapp-auto-drain'$q$ into v_last;
  exception when others then v_last := null;
  end;

  return jsonb_build_object(
    'installed', true,
    'jobs', v_jobs,
    'last_run', v_last,
    'ok', jsonb_array_length(v_jobs) >= 1
  );
end;
$fn$;
grant execute on function public.whatsapp_cron_status() to authenticated;


-- ── 7. OVERVIEW carries the scheduler state ─────────────────────────────────
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

-- ── Verification: what the parser makes of a real ad message ────────────────
select public.whatsapp_parse_ctwa(
E'Full name: Shailen Pathak\nPhone number: +919999311087\nEmail: shailenpathak@gmail.com\nField of expertise? Which area do you qualify under?: Tech\nReadiness to invest? Are you willing to invest in professional guidance for your visa process?: Yes'
) as parsed_click_to_whatsapp;

select public.whatsapp_cron_status() as scheduler;
