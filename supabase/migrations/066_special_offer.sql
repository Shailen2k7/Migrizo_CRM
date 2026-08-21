-- ============================================================================
-- 066 — Special offer (£500 or FREE) on a lead.
--
-- WHY THIS IS NOT A STAGE
--
-- The obvious move is another entry in the stage dropdown. It would be wrong,
-- and expensively so:
--
--   • A lead on a £500 offer is still HOT or COLD. Both facts matter, and a
--     stage can only hold one of them.
--   • The WhatsApp engine enrols people by stage (wa_sync reads stage='hot'
--     / 'cold'). Moving someone to a "special offer" stage would silently drop
--     them out of their follow-up campaign — the exact class of invisible
--     failure that cost us a day on the sending engine.
--   • The funnel counts on the Leads screen would stop adding up.
--
-- So the offer is its own field, sitting ALONGSIDE the stage. Nothing existing
-- changes meaning, and a lead can be "Hot + FREE case" — which is precisely the
-- combination worth looking at.
--
-- Every column is nullable with no default, so existing rows are untouched and
-- "no offer" stays the natural state of the table.
-- ============================================================================

alter table public.leads
  add column if not exists offer_type     text,
  add column if not exists offer_amount   numeric(12,2),
  add column if not exists offer_currency text,
  add column if not exists offer_note     text,
  add column if not exists offer_at       timestamptz,
  add column if not exists offer_by       uuid;

-- 'discount' = a reduced quote (the £500 case). 'free' = no fee at all.
-- NULL = no offer, which is the vast majority of leads.
do $$ begin
  alter table public.leads
    add constraint leads_offer_type_chk
    check (offer_type is null or offer_type in ('discount','free'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.leads
    add constraint leads_offer_currency_chk
    check (offer_currency is null or offer_currency in ('GBP','INR','USD'));
exception when duplicate_object then null; end $$;

comment on column public.leads.offer_type is
  'Special pricing offered to win a high-quality case. discount = reduced quote, free = no fee. NULL = none. Independent of stage.';
comment on column public.leads.offer_at is
  'When the offer was granted — so the experiment (does discounting win more approvals?) can actually be measured later.';

-- The Leads screen filters on this constantly; a partial index keeps that free
-- no matter how large the table gets, because only offered leads are in it.
create index if not exists idx_leads_offer
  on public.leads (workspace_id, offer_type)
  where offer_type is not null;

notify pgrst, 'reload schema';

-- Who is on an offer right now, and what it is worth.
select coalesce(offer_type, 'no offer')                as offer,
       count(*)                                         as leads,
       sum(coalesce(offer_amount, 0))                   as total_quoted
  from public.leads
 group by 1
 order by 1;
