-- ============================================================================
-- 074 — LEAD INTELLIGENCE: the three facts the dashboards need but nothing
-- recorded until now.
--
--   first_response_at   when the lead FIRST wrote back to us (WhatsApp/email).
--                       Powers Response %. Derived from message tables, never
--                       hand-typed, and kept current by triggers from here on.
--   profile_received    CV / LinkedIn / both — set by a click in the drawer.
--                       Powers Profile Submission %.
--   eligibility         eligible / not_eligible; NULL = not reviewed yet.
--                       Powers Eligibility %, Non-Eligible %, and the HOT %
--                       denominator. eligibility_source records whether a
--                       human clicked it or this migration inferred it.
--
-- WHY "derived" EXISTS
-- Nobody is going to re-review 2,400 historical leads by hand. But anyone who
-- reached Hot / MR coming soon / Invoice sent / Won was necessarily assessed
-- and found eligible — you do not quote someone you have not reviewed — and
-- Junk was rejected. Backfilling those as 'derived' makes the dashboard useful
-- on day one while staying honest about which rows a human actually touched.
-- ============================================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.leads add column if not exists first_response_at   timestamptz;
alter table public.leads add column if not exists profile_received    text;
alter table public.leads add column if not exists profile_received_at timestamptz;
alter table public.leads add column if not exists eligibility         text;
alter table public.leads add column if not exists eligibility_at      timestamptz;
alter table public.leads add column if not exists eligibility_by      uuid;
alter table public.leads add column if not exists eligibility_source  text;

do $$ begin
  alter table public.leads add constraint leads_profile_received_chk
    check (profile_received is null or profile_received in ('cv','linkedin','both'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leads add constraint leads_eligibility_chk
    check (eligibility is null or eligibility in ('eligible','not_eligible'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leads add constraint leads_eligibility_source_chk
    check (eligibility_source is null or eligibility_source in ('manual','derived'));
exception when duplicate_object then null; end $$;

comment on column public.leads.eligibility is
  'NULL = not reviewed yet. Not-reviewed leads stay OUT of every eligibility denominator, so an untouched backlog cannot fake a good number.';

-- Dashboards slice by creation cohort; make that cheap at any size.
create index if not exists idx_leads_ws_created  on public.leads    (workspace_id, created_at);
create index if not exists idx_meetings_ws_created on public.meetings (workspace_id, created_at);
create index if not exists idx_leads_eligibility on public.leads (workspace_id, eligibility)
  where eligibility is not null;

-- ── 2. Backfill first_response_at from what already happened ────────────────
-- Earliest inbound WhatsApp message per lead…
update public.leads l
   set first_response_at = x.first_in
  from (select lead_id, min(created_at) as first_in
          from public.whatsapp_messages
         where direction = 'in' and lead_id is not null
         group by lead_id) x
 where l.id = x.lead_id
   and (l.first_response_at is null or x.first_in < l.first_response_at);

-- …and earliest inbound email, whichever came first wins.
update public.leads l
   set first_response_at = x.first_in
  from (select lead_id, min(created_at) as first_in
          from public.lead_emails
         where direction = 'in' and lead_id is not null
         group by lead_id) x
 where l.id = x.lead_id
   and (l.first_response_at is null or x.first_in < l.first_response_at);

-- ── 3. Keep it current: any future inbound stamps the lead ──────────────────
create or replace function public.stamp_first_response()
returns trigger language plpgsql security definer as $$
begin
  if new.direction = 'in' and new.lead_id is not null then
    update public.leads
       set first_response_at = least(coalesce(first_response_at, new.created_at), new.created_at)
     where id = new.lead_id
       and (first_response_at is null or new.created_at < first_response_at);
  end if;
  return new;
end $$;

drop trigger if exists trg_first_response_wa on public.whatsapp_messages;
create trigger trg_first_response_wa
  after insert on public.whatsapp_messages
  for each row execute function public.stamp_first_response();

drop trigger if exists trg_first_response_email on public.lead_emails;
create trigger trg_first_response_email
  after insert on public.lead_emails
  for each row execute function public.stamp_first_response();

-- ── 4. Derive eligibility for the history nobody will re-type ───────────────
-- Only rows never reviewed; a human's click (eligibility_source='manual') is
-- never overwritten, this run or any rerun.
update public.leads
   set eligibility        = 'eligible',
       eligibility_at     = coalesce(eligibility_at, now()),
       eligibility_source = 'derived'
 where eligibility is null
   and stage in ('hot','mr_coming_soon','invoice_sent','won');

update public.leads
   set eligibility        = 'not_eligible',
       eligibility_at     = coalesce(eligibility_at, now()),
       eligibility_source = 'derived'
 where eligibility is null
   and stage = 'junk';

notify pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
select
  count(*)                                                   as total_leads,
  count(*) filter (where first_response_at is not null)      as responded,
  count(*) filter (where eligibility = 'eligible')           as eligible,
  count(*) filter (where eligibility = 'not_eligible')       as not_eligible,
  count(*) filter (where eligibility is null)                as not_reviewed,
  count(*) filter (where eligibility_source = 'derived')     as derived_rows
  from public.leads;
