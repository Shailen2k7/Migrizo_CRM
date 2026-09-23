-- =============================================================================
-- 121 — GTV ELIGIBILITY GAINS TWO MORE ANSWERS
-- -----------------------------------------------------------------------------
-- leads.eligibility has answered one question since migration 074: is this
-- person eligible, yes or no. The Master Leads view asks a slightly richer
-- version of the same question, so the column learns two more answers:
--
--   highly_eligible — eligible, and clearly stronger than the rest
--   others          — reviewed, but does not belong in either bucket
--
-- WHY THIS COLUMN AND NOT A NEW ONE
-- A separate gtv_eligibility column was the obvious alternative and it is a
-- trap. The dashboards would go on reading leads.eligibility while people
-- filled in the new one, and within a week the CRM would hold two different
-- answers to the same question with nothing to say which was right. One
-- question, one column.
--
-- NOTHING IS REWRITTEN. Every existing row keeps the value it has. The two new
-- values start at zero rows and are only ever reached by hand.
--
-- HIGHLY ELIGIBLE STILL COUNTS AS ELIGIBLE. The application reads this column
-- through isGtvEligible() in lib/master-leads.ts, which treats highly_eligible
-- as a stronger eligible, so promoting someone never makes the Eligible card
-- on the Leads dashboard tick DOWN by one.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

do $$ begin
  alter table public.leads drop constraint if exists leads_eligibility_chk;
  alter table public.leads add constraint leads_eligibility_chk
    check (eligibility is null or eligibility in
      ('eligible', 'highly_eligible', 'not_eligible', 'others'));
end $$;

comment on column public.leads.eligibility is
  'GTV eligibility verdict: eligible | highly_eligible | not_eligible | others. '
  'NULL means not reviewed, which is a real state and deliberately different '
  'from not_eligible. Read through isGtvEligible() so that highly_eligible '
  'counts inside eligible wherever a total is shown.';

notify pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect the counts you have today, and zero in the two new buckets.
select coalesce(eligibility, '(not reviewed)') as gtv_eligibility, count(*)
from public.leads
where coalesce(is_sample, false) = false
group by 1
order by 2 desc;
