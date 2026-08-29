-- =============================================================================
-- 082 — REMOVE THE WHATSAPP MODULE FROM THE DATABASE
-- -----------------------------------------------------------------------------
-- ⚠️  DESTRUCTIVE AND IRREVERSIBLE. Run 081 first, read its notices, and export
--     the chat history (the query at the bottom of 081) BEFORE running this.
--
-- WhatsApp now lives entirely in Interakt. This removes every trace of it from
-- Postgres: scheduled jobs, triggers, functions, then tables.
--
-- WHAT SURVIVES ON PURPOSE:
--   • The `whatsapp-media` storage bucket and every object in it. Archived CVs
--     live there and `leads.cv_path` still points at them. A bucket cannot be
--     renamed in place, so the id stays; nothing in the app shows that name.
--   • Every lead column: profile_text, profile_ai, eligibility,
--     eligibility_source, profile_received, cv_path, cv_name, first_response_at.
--     That is lead data, not WhatsApp data.
--   • The 'whatsapp' option on follow_ups.channel — you still call and message
--     people on WhatsApp, just from Interakt.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

-- ── 1. stop the scheduled jobs ───────────────────────────────────────────────
do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in
      select jobname from cron.job
       where jobname like 'migrizo-wa-%'
          or jobname like 'migrizo-whatsapp-%'
    loop
      perform cron.unschedule(j.jobname);
      raise notice '082: unscheduled %', j.jobname;
    end loop;
  end if;
exception when others then
  raise notice '082: cron cleanup skipped (%)', sqlerrm;
end $$;

-- ── 2. drop triggers that live on tables we are KEEPING ──────────────────────
-- These sit on leads / meetings / whatsapp_suppressions and would otherwise
-- block the drops below or leave dangling references.
drop trigger if exists trg_first_response_wa      on public.whatsapp_messages;
drop trigger if exists trg_wa_on_meeting          on public.meetings;
drop trigger if exists trg_campaign_cancel_queue  on public.leads;
drop trigger if exists trg_whatsapp_settings_bootstrap on public.workspaces;
drop trigger if exists trg_whatsapp_settings_bootstrap on public.workspace_members;

-- The email side of first_response stays; only the WhatsApp trigger goes.
-- (trg_first_response_email on lead_emails is deliberately untouched.)

-- ── 3. drop every whatsapp_* / wa_* function ─────────────────────────────────
-- Signature-agnostic: builds the exact DROP for each overload it finds.
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and (p.proname like 'whatsapp\_%' or p.proname like 'wa\_%')
  loop
    execute format('drop function if exists %s cascade', f.sig);
    n := n + 1;
  end loop;
  raise notice '082: dropped % whatsapp/wa functions', n;
end $$;

-- ── 4. drop the tables ───────────────────────────────────────────────────────
-- Children before parents. cascade clears policies, indexes and constraints.
drop table if exists public.wa_campaign_people      cascade;
drop table if exists public.wa_campaign_steps       cascade;
drop table if exists public.wa_campaigns            cascade;
drop table if exists public.wa_intake               cascade;

drop table if exists public.whatsapp_messages       cascade;
drop table if exists public.whatsapp_conversations  cascade;
drop table if exists public.whatsapp_templates      cascade;
drop table if exists public.whatsapp_saved_replies  cascade;
drop table if exists public.whatsapp_suppressions   cascade;
drop table if exists public.whatsapp_webhook_log    cascade;
drop table if exists public.whatsapp_settings       cascade;

-- Tables from the retired 040–061 automation era, in case any survived.
drop table if exists public.whatsapp_auto_jobs      cascade;
drop table if exists public.whatsapp_automation     cascade;
drop table if exists public.whatsapp_journeys       cascade;
drop table if exists public.whatsapp_faqs           cascade;
drop table if exists public.whatsapp_sequence_steps cascade;
drop table if exists public.whatsapp_sequence_enrollments cascade;
drop table if exists public.whatsapp_sequences      cascade;

-- ── 5. keep first_response_at working without WhatsApp ───────────────────────
-- It was stamped by whichever channel replied first. Email is now the only one,
-- and that trigger already exists — this just proves it is still attached.
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_first_response_email'
       and tgrelid = 'public.lead_emails'::regclass
  ) then
    raise notice '082: WARNING — trg_first_response_email is missing. first_response_at will stop being stamped.';
  else
    raise notice '082: first_response_at still stamped from inbound email.';
  end if;
exception when undefined_table then
  raise notice '082: lead_emails not found, skipping first_response check';
end $$;

-- ── 6. confirm ───────────────────────────────────────────────────────────────
do $$
declare v_tables int; v_fns int; v_jobs int := 0;
begin
  select count(*) into v_tables
    from information_schema.tables
   where table_schema = 'public'
     and (table_name like 'whatsapp\_%' or table_name like 'wa\_%');

  select count(*) into v_fns
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and (p.proname like 'whatsapp\_%' or p.proname like 'wa\_%');

  begin
    select count(*) into v_jobs from cron.job
     where jobname like 'migrizo-wa-%' or jobname like 'migrizo-whatsapp-%';
  exception when others then v_jobs := 0;
  end;

  raise notice '082 DONE: % whatsapp tables, % functions, % cron jobs remaining (all three should be 0).',
    v_tables, v_fns, v_jobs;
end $$;
