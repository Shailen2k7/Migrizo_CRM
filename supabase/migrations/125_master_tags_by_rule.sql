-- =============================================================================
-- 125 — MASTER LEADS: tag by rule from Category + Willingness to Pay
-- -----------------------------------------------------------------------------
-- Owner's rules, 30 Sep 2026 (Category = leads.industry, WTP =
-- leads.investment_readiness, Eligibility = leads.eligibility, Visa =
-- leads.visa_type, Status = leads.stage):
--
--   Rule 1  Other + Not WTP                    → Status Junk, Not Eligible, IFV
--   Rule 2  Other + WTP / Maybe                → Eligible, visa IFV
--   Rule 3  Tech / Research / Arts + Not WTP   → Eligible, visa GTV
--   Rule 4  Tech / Research / Arts + WTP/Maybe → Eligible, visa GTV
--   Rule 5  Tech / Research / Arts + no WTP    → Eligible, visa GTV
--   (Other with no WTP answer is left alone: owner's rule is Other + WTP /
--   Maybe only.)
--
-- Owner's decisions, 30 Sep 2026:
--   * Rule 2 wins over "Others" set by hand on Other + WTP/Maybe leads.
--   * Rule 1 wins over "Others" set by hand (→ Not Eligible).
--   * "Not Eligible" already told to the client on WhatsApp is kept.
--   * Hand tags on Tech/Research/Arts leads are kept.
--
-- WHAT IS NEVER OVERWRITTEN
--   * An eligibility told to the client on WhatsApp, read from a CV, or set by
--     hand (eligibility_source whatsapp / ai / manual) — except hand-set
--     "Others" under Rules 1 and 2, per the owner. Blank ones and ones
--     "inherited from older data" (derived) are rewritten.
--   * A visa set by anything other than the 23 Sep backfill (122). That
--     backfill stamped GTV on every untagged Meta Ads lead, including
--     Other-category leads that Rule 2 now says are IFV — those are corrected.
--   * Rule 1 skips leads that are Hot, Converted, Invoice Sent, Mr Coming
--     Soon, Lost, Spotlight, or marked Eligible by a person / WhatsApp / CV.
--
-- NOTHING ELSE MOVES
--   * updated_at is PRESERVED (trigger paused for this transaction), so no
--     lead jumps to the top of the CRM lists or the WhatsApp contact list.
--   * No automation fires: whatsapp_auto_on_lead is AFTER INSERT, and
--     open_case_on_won (124) only acts on a move into 'won' — this script
--     never sets 'won'. The guard re-checks the live trigger list and stops
--     on anything else. WhatsApp senders and campaigns do not filter on stage.
--   * Every touched row's previous values are saved in
--     public.leads_tag_backfill_125 for an exact rollback (bottom of file).
--
-- Idempotent: a second run finds nothing left to change.
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
    -- open_case_on_won (migration 124) acts only on a move INTO 'won'; this
    -- script only ever moves leads to 'junk', so it returns immediately.
    and tgname <> 'open_case_on_won'
    and (tgtype & 16) <> 0;
  if extra is not null then
    raise exception 'Stopped: unexpected UPDATE trigger(s) on leads: %', extra;
  end if;
end $$;

-- ── Allow 'rule' as an eligibility source ────────────────────────────────────
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.leads'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%eligibility_source%'
  loop
    execute format('alter table public.leads drop constraint %I', c.conname);
  end loop;
  alter table public.leads add constraint leads_eligibility_source_chk
    check (eligibility_source is null or eligibility_source in ('manual', 'derived', 'ai', 'whatsapp', 'rule'));
end $$;

-- ── Record previous values for an exact rollback ─────────────────────────────
create table if not exists public.leads_tag_backfill_125 (
  lead_id                uuid primary key,
  rule                   text not null,
  old_stage              text,
  old_eligibility        text,
  old_eligibility_source text,
  old_eligibility_at     timestamptz,
  old_eligibility_by     uuid,
  old_visa_type          text,
  applied_at             timestamptz not null default now()
);
alter table public.leads_tag_backfill_125 enable row level security;

-- ── Which rule each lead falls under ─────────────────────────────────────────
drop table if exists plan125;
create temp table plan125 as
with base as (
  select l.*,
    case
      when l.industry = 'other' and l.investment_readiness = 'no'                         then 'R1'
      when l.industry = 'other' and l.investment_readiness in ('yes', 'maybe')            then 'R2'
      when l.industry in ('tech', 'research', 'art') and l.investment_readiness = 'no'    then 'R3'
      when l.industry in ('tech', 'research', 'art') and l.investment_readiness in ('yes', 'maybe') then 'R4'
      when l.industry in ('tech', 'research', 'art') and l.investment_readiness is null   then 'R5'
    end as rule,
    exists (select 1 from public.leads_visa_backfill_122 b where b.lead_id = l.id) as visa_from_122
  from public.leads l
  where coalesce(l.is_sample, false) = false
), ruled as (
  select b.*,
    (b.eligibility is null or b.eligibility_source is null or b.eligibility_source = 'derived'
     or (b.rule in ('R1', 'R2') and b.eligibility_source = 'manual' and b.eligibility = 'others')
    ) as elig_writable
  from base b
  where b.rule is not null
    -- Rule 1 protections. Every test is null-safe: a lead with NO eligibility
    -- must count as "not protected", not as "unknown" (the first run of this
    -- file skipped 54 such leads because NULL made the whole test NULL).
    and not (b.rule = 'R1' and (
      coalesce(b.stage, '') in ('hot', 'won', 'invoice_sent', 'mr_coming_soon', 'lost')
      or coalesce(b.is_spotlight, false)
      or (coalesce(b.eligibility, '') in ('eligible', 'highly_eligible')
          and coalesce(b.eligibility_source, '') in ('manual', 'whatsapp', 'ai'))
    ))
)
select id, rule, stage, eligibility, eligibility_source, eligibility_at, eligibility_by, visa_type,
  case when rule = 'R1' and stage <> 'junk' then 'junk' end as new_stage,
  case when not elig_writable then null
       when rule = 'R1' and eligibility is distinct from 'not_eligible' then 'not_eligible'
       when rule <> 'R1' and (eligibility is null or eligibility not in ('eligible', 'highly_eligible')) then 'eligible'
  end as new_eligibility,
  case when rule in ('R1', 'R2') and (visa_type is null or visa_from_122) and visa_type is distinct from 'ifv' then 'ifv'
       when rule in ('R3', 'R4', 'R5') and visa_type is null then 'gtv'
  end as new_visa
from ruled;

delete from plan125 where new_stage is null and new_eligibility is null and new_visa is null;

insert into public.leads_tag_backfill_125
  (lead_id, rule, old_stage, old_eligibility, old_eligibility_source, old_eligibility_at, old_eligibility_by, old_visa_type)
select id, rule, stage, eligibility, eligibility_source, eligibility_at, eligibility_by, visa_type
from plan125
on conflict (lead_id) do nothing;

-- ── Apply, with the timestamp trigger paused ────────────────────────────────
alter table public.leads disable trigger leads_updated_at;

update public.leads l set
  stage              = coalesce(p.new_stage, l.stage),
  eligibility        = coalesce(p.new_eligibility, l.eligibility),
  eligibility_source = case when p.new_eligibility is not null then 'rule' else l.eligibility_source end,
  eligibility_at     = case when p.new_eligibility is not null then now() else l.eligibility_at end,
  eligibility_by     = case when p.new_eligibility is not null then null  else l.eligibility_by end,
  visa_type          = coalesce(p.new_visa, l.visa_type)
from plan125 p
where p.id = l.id;

alter table public.leads enable trigger leads_updated_at;

commit;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Expect about 1,406 rows — R1 ≈ 88, R2 ≈ 583, R3 ≈ 94, R4 ≈ 468, R5 ≈ 173 —
-- plus whatever arrived since 30 Sep.
select rule, count(*) from public.leads_tag_backfill_125 group by 1 order by 1;

select coalesce(eligibility, '(blank)') as eligibility, coalesce(eligibility_source, '(blank)') as source, count(*)
from public.leads where coalesce(is_sample, false) = false
group by 1, 2 order by 3 desc;

select coalesce(visa_type, '(blank)') as visa, count(*)
from public.leads where coalesce(is_sample, false) = false group by 1 order by 2 desc;

-- ── Rollback (exact) ─────────────────────────────────────────────────────────
-- begin;
-- alter table public.leads disable trigger leads_updated_at;
-- update public.leads l set
--   stage = b.old_stage, eligibility = b.old_eligibility, eligibility_source = b.old_eligibility_source,
--   eligibility_at = b.old_eligibility_at, eligibility_by = b.old_eligibility_by, visa_type = b.old_visa_type
-- from public.leads_tag_backfill_125 b where b.lead_id = l.id;
-- alter table public.leads enable trigger leads_updated_at;
-- delete from public.leads_tag_backfill_125;
-- commit;
