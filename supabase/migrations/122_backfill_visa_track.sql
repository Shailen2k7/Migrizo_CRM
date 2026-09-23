-- =============================================================================
-- 122 — VISA TRACK BACKFILL: untagged Meta Ads leads are GTV leads
-- -----------------------------------------------------------------------------
-- WHAT HAPPENED
-- leads.visa_type is filled from the Make.com payload (body.visa_type in
-- app/api/ingest/meta-lead). The old Meta form carried a visa field; the new
-- one, live since mid-July 2026, carries expertise + investment_readiness and
-- no visa at all. So from July the field simply stopped being filled:
--
--   untagged per month   May 6 · Jun 3 · Jul 171 · Aug 557 · Sep 651
--
-- WHY THEY ARE GTV
--   * The new form's expertise options are tech / research / arts / other —
--     the Global Talent Visa endorsement routes. An IFV form asks about a
--     business; this one does not.
--   * The system already treats them as GTV: the intake route sends the GTV
--     process email when visa_type is missing (renderProcess default 'gtv'),
--     and Relay renders a blank visa as "Global Talent Visa" in every message.
--
-- SCOPE: blank visa_type AND either
--   * source = 'Meta Ads' (the GTV ad pipeline), or
--   * Field / Category is Tech, Research or Arts — the three GTV endorsement
--     routes. Owner's rule, 23 Sep 2026: "tag all as GTV whoever is in this
--     category". It catches one lead with no source that the first rule missed.
-- About 1,372 leads on 23 Sep 2026 (the number grows as new untagged leads
-- arrive). The ~17 others carry no evidence either way and stay blank for a
-- human to tag.
--
-- A lead already tagged IFV stays IFV even inside these categories (there is
-- one, in Research). Only blanks are ever filled.
--
-- NOTHING ELSE MOVES
--   * Only visa_type is written. Only blank rows are touched; a lead already
--     tagged — GTV, IFV or anything else — is never changed.
--   * updated_at is PRESERVED. The leads_updated_at trigger is paused for this
--     one statement only, so these contacts do not jump to the top of
--     the CRM lists or the WhatsApp contact list.
--   * No automation can fire: the only other trigger on leads
--     (whatsapp_auto_on_lead) is AFTER INSERT. The guard below re-checks the
--     LIVE trigger list and aborts if anything else reacts to updates.
--   * Messages read identically before and after: Relay renders both a blank
--     visa and 'gtv' as "Global Talent Visa". No campaign filters on visa.
--
-- ROLLBACK (exact, because the touched ids are recorded):
--   alter table public.leads disable trigger leads_updated_at;
--   update public.leads set visa_type = null
--     where id in (select lead_id from public.leads_visa_backfill_122);
--   alter table public.leads enable trigger leads_updated_at;
--
-- Idempotent: a second run finds nothing blank to tag and changes nothing.
-- =============================================================================

begin;

-- ── Guard: stop if any trigger other than the timestamp one fires on UPDATE ──
do $$
declare extra text;
begin
  select string_agg(tgname, ', ') into extra
  from pg_trigger
  where tgrelid = 'public.leads'::regclass
    and not tgisinternal
    and tgname <> 'leads_updated_at'
    and (tgtype & 16) <> 0;                      -- 16 = fires on UPDATE
  if extra is not null then
    raise exception 'Backfill stopped: unexpected UPDATE trigger(s) on leads: %', extra;
  end if;
end $$;

-- ── Record exactly which leads this touches, for an exact rollback ──────────
create table if not exists public.leads_visa_backfill_122 (
  lead_id       uuid primary key,
  backfilled_at timestamptz not null default now()
);
alter table public.leads_visa_backfill_122 enable row level security;
-- No policies: only the service role and the SQL editor can read it.

-- ── The backfill ────────────────────────────────────────────────────────────
alter table public.leads disable trigger leads_updated_at;

with target as (
  select id
  from public.leads
  where (visa_type is null or btrim(visa_type) = '')
    and (source = 'Meta Ads' or industry in ('tech', 'research', 'art'))
    and coalesce(is_sample, false) = false
  for update
),
saved as (
  insert into public.leads_visa_backfill_122 (lead_id)
  select id from target
  on conflict (lead_id) do nothing
  returning lead_id
)
update public.leads l
set visa_type = 'gtv'
from saved s
where l.id = s.lead_id;

alter table public.leads enable trigger leads_updated_at;

commit;

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect: tech_research_arts_still_blank = 0 (the rule you asked for),
-- tagged_by_this_script ≈ 1,372, still_blank ≈ 17, trigger enabled = O.
select
  (select count(*) from public.leads
     where industry in ('tech', 'research', 'art')
       and (visa_type is null or btrim(visa_type) = '')
       and coalesce(is_sample,false) = false)                                  as tech_research_arts_still_blank,
  (select count(*) from public.leads_visa_backfill_122)                        as tagged_by_this_script,
  (select count(*) from public.leads
     where (visa_type is null or btrim(visa_type) = '') and coalesce(is_sample,false) = false) as still_blank,
  (select tgenabled from pg_trigger
     where tgrelid = 'public.leads'::regclass and tgname = 'leads_updated_at')  as updated_at_trigger_enabled;
