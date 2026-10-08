-- =============================================================================
-- 126 — PAYMENTS KEEP THEIR OWN CURRENCY; CLIENT TOTALS CONVERT
-- -----------------------------------------------------------------------------
-- THE BUG (owner report, 8 Oct 2026)
-- Currency lived on the CLIENT. Switching it relabelled every earlier amount
-- without converting it (₹64,500 became "£64,500"), and the totals trigger
-- added amounts of different currencies together as if they were one.
--
-- THE MODEL FROM NOW ON
--   * Every payment keeps the currency it was paid / invoiced in
--     (payments.currency). Its invoice and receipt print in that currency.
--   * The client's currency (leads.currency) is the BILLING currency: total
--     fee, collected and pending are in it.
--   * A payment in a different currency carries the value it counts for in
--     the billing currency: credit_amount + credit_currency (+ fx_rate, the
--     rate used, for the record). The app fills these when it is recorded.
--   * leads.amount_paid = Σ of each paid payment's value in the billing
--     currency — the payment amount when the currencies match, its credit
--     when one is recorded, otherwise a conversion at the standing rate.
--   * Changing a client's billing currency recalculates amount_paid
--     (trigger below); the app converts the total fee at the same time.
--
-- THE SEVEN CLIENTS THIS CORRECTS (evidence checked one by one)
--   Wrong currency label on the payment — relabelled:
--     Jayapriya J      Kickstart "£64,500" → ₹64,500 (her note: deal ₹1,95,000)
--     Mehnaz Tabish    Kickstart "£65,000" → ₹65,000 (fee ₹2,25,000)
--     Chandra          Kickstart "₹500"    → £500    (fee £2,500, £ offer)
--   Real mixed-currency clients — the payment stays, its value is credited:
--     Saleha Panwar    ₹64,500 Kickstart counts as £500
--     Dhyey Thakore    ₹64,500 Kickstart counts as £500
--     Abhishek Bharne  ₹72,500 counts as £600 (his note: "paid … £600")
--     SIBA S. PANDA    £750 Phase 1 counts as ₹96,750 (₹129/£ — the rate
--                      behind ₹64,500 = £500 Kickstart)
--
-- NOTHING ELSE MOVES
--   * Only the seven payment rows above are edited; every other lead's
--     amount_paid already equals its payments (checked 8 Oct: 31 of 33).
--   * updated_at on leads is preserved (timestamp trigger paused for the
--     data fix only), so nobody jumps to the top of a list.
--   * Guards stop the script if any unexpected UPDATE trigger exists on
--     payments or leads. No WhatsApp table is touched.
--   * Every changed value is saved for an exact rollback (bottom of file).
--
-- Idempotent: the data fix only touches rows still in their old state.
-- =============================================================================

begin;

-- ── Guards ───────────────────────────────────────────────────────────────────
do $$
declare extra text;
begin
  select string_agg(tgname, ', ') into extra from pg_trigger
   where tgrelid = 'public.payments'::regclass and not tgisinternal
     and tgname <> 'payments_sync_lead' and (tgtype & 16) <> 0;
  if extra is not null then raise exception 'Stopped: unexpected UPDATE trigger(s) on payments: %', extra; end if;

  select string_agg(tgname, ', ') into extra from pg_trigger
   where tgrelid = 'public.leads'::regclass and not tgisinternal
     and tgname not in ('leads_updated_at', 'open_case_on_won', 'leads_currency_resync') and (tgtype & 16) <> 0;
  if extra is not null then raise exception 'Stopped: unexpected UPDATE trigger(s) on leads: %', extra; end if;
end $$;

-- ── 1 · Columns ──────────────────────────────────────────────────────────────
alter table public.payments add column if not exists credit_amount   numeric;
alter table public.payments add column if not exists credit_currency text;
alter table public.payments add column if not exists fx_rate         numeric;

comment on column public.payments.credit_amount is
  'When the payment currency differs from the client''s billing currency: what this payment counts for in credit_currency. Null when the currencies match.';
comment on column public.payments.fx_rate is
  'Rate used for credit_amount: units of credit_currency per 1 unit of the payment currency. For the record only.';

-- ── 2 · Conversion helpers ───────────────────────────────────────────────────
-- Standing rates (₹ per unit) — the same table the app uses (FX_TO_INR in
-- lib/utils.ts). Only a fallback: payments recorded in another currency carry
-- their own credit from the moment they are entered.
create or replace function public.fx_inr_per(ccy text) returns numeric
language sql immutable as $$
  select case upper(coalesce(ccy, 'INR')) when 'GBP' then 127.5 when 'USD' then 95.2 else 1 end::numeric
$$;

create or replace function public.payment_credit(
  p_amount numeric, p_currency text, p_credit_amount numeric, p_credit_currency text, lead_ccy text
) returns numeric
language sql immutable as $$
  select case
    when upper(coalesce(p_currency, lead_ccy, 'INR')) = upper(coalesce(lead_ccy, 'INR')) then coalesce(p_amount, 0)
    when p_credit_amount is not null and upper(coalesce(p_credit_currency, '')) = upper(coalesce(lead_ccy, 'INR')) then p_credit_amount
    else round(coalesce(p_amount, 0) * public.fx_inr_per(p_currency) / public.fx_inr_per(lead_ccy), 2)
  end
$$;

-- ── 3 · Totals trigger: add up values in the billing currency ───────────────
create or replace function public.sync_lead_payment_totals()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  target_lead_id uuid;
  total_paid numeric;
  lead_total numeric;
  lead_ccy text;
begin
  target_lead_id := coalesce(new.lead_id, old.lead_id);
  select amount_total, currency into lead_total, lead_ccy from public.leads where id = target_lead_id;

  select coalesce(sum(public.payment_credit(amount, currency, credit_amount, credit_currency, lead_ccy)), 0)
    into total_paid
    from public.payments
   where lead_id = target_lead_id and status = 'paid';

  update public.leads
     set amount_paid = round(total_paid),
         payment_status = case
           when total_paid = 0 then 'none'
           when coalesce(lead_total, 0) > 0 and total_paid >= lead_total then 'paid'
           else 'partial'
         end
   where id = target_lead_id;

  return coalesce(new, old);
end$function$;

-- ── 4 · Billing currency changed → recalculate what has been paid ──────────
create or replace function public.leads_currency_resync()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare total_paid numeric;
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.payments p where p.lead_id = new.id) then
    select coalesce(sum(public.payment_credit(p.amount, p.currency, p.credit_amount, p.credit_currency, new.currency)), 0)
      into total_paid
      from public.payments p
     where p.lead_id = new.id and p.status = 'paid';
    new.amount_paid := round(total_paid);
    new.payment_status := case
      when total_paid = 0 then 'none'
      when coalesce(new.amount_total, 0) > 0 and total_paid >= new.amount_total then 'paid'
      else 'partial'
    end;
  end if;
  return new;
end$function$;

drop trigger if exists leads_currency_resync on public.leads;
create trigger leads_currency_resync
  before update of currency on public.leads
  for each row execute function public.leads_currency_resync();

-- ── 5 · Correct the seven payments (with an exact undo record) ──────────────
create table if not exists public.payments_currency_fix_126 (
  payment_id          uuid primary key,
  lead_id             uuid not null,
  old_currency        text,
  old_credit_amount   numeric,
  old_credit_currency text,
  old_fx_rate         numeric,
  old_lead_amount_paid bigint,
  old_lead_payment_status text,
  fixed_at            timestamptz not null default now()
);
alter table public.payments_currency_fix_126 enable row level security;

drop table if exists fix126;
create temp table fix126 (payment_id uuid, expect_amount bigint, expect_currency text,
                          new_currency text, credit_amount numeric, credit_currency text, fx_rate numeric);
-- (Not 'on commit drop': Supabase's "Run and enable RLS" appends an RLS step
-- for every created table AFTER the commit, which then failed on a vanished
-- temp table. A temp table lives until the session ends anyway.)
insert into fix126 values
  -- relabel: the amount was right, the currency tag was wrong
  ('83580555-de1c-4286-9c32-88136756d8ca', 64500, 'GBP', 'INR', null, null, null),   -- Jayapriya J
  ('23ea0c5e-c057-4684-bfa0-8f54c6e93097', 65000, 'GBP', 'INR', null, null, null),   -- Mehnaz Tabish
  ('e9188ef5-82c0-4e96-b8b4-8840f7619dd9',   500, 'INR', 'GBP', null, null, null),   -- Chandra
  -- credit: a real payment in another currency, valued in the billing currency
  ('0fed6e88-e0bd-4dd9-a467-21e7c42a6295', 64500, 'INR', 'INR', 500,   'GBP', round(500/64500.0, 8)),   -- Saleha Panwar
  ('0e70916c-1cd7-402d-b677-867e486bcfa2', 64500, 'INR', 'INR', 500,   'GBP', round(500/64500.0, 8)),   -- Dhyey Thakore
  ('bfcb296c-ad8d-48ea-b4d0-52b385368997', 72500, 'INR', 'INR', 600,   'GBP', round(600/72500.0, 8)),   -- Abhishek Bharne
  ('2759bd43-d466-4569-b5cd-b309c237e636',   750, 'GBP', 'GBP', 96750, 'INR', 129);                     -- SIBA SHANKAR PANDA

insert into public.payments_currency_fix_126
  (payment_id, lead_id, old_currency, old_credit_amount, old_credit_currency, old_fx_rate, old_lead_amount_paid, old_lead_payment_status)
select p.id, p.lead_id, p.currency, p.credit_amount, p.credit_currency, p.fx_rate, l.amount_paid, l.payment_status
  from fix126 f
  join public.payments p on p.id = f.payment_id and p.amount = f.expect_amount and p.currency = f.expect_currency
  join public.leads l on l.id = p.lead_id
on conflict (payment_id) do nothing;

alter table public.leads disable trigger leads_updated_at;

update public.payments p
   set currency = f.new_currency,
       credit_amount = f.credit_amount,
       credit_currency = f.credit_currency,
       fx_rate = f.fx_rate
  from fix126 f
 where p.id = f.payment_id
   and p.amount = f.expect_amount
   and p.currency = f.expect_currency
   and p.credit_amount is null;          -- only rows still in their old state

alter table public.leads enable trigger leads_updated_at;

commit;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Expect:
--   Saleha Panwar      GBP  total 3000    paid 500     partial
--   Dhyey Thakore      GBP  total 3000    paid 500     partial
--   Abhishek Bharne    GBP  total 600     paid 600     paid
--   SIBA SHANKAR PANDA INR  total 325000  paid 161250  partial
--   Jayapriya J        INR  total 180000  paid 129000  partial
--   Mehnaz tabish      INR  total 225000  paid 65000   partial
--   Chandra            GBP  total 2500    paid 1250    partial
select l.full_name, l.currency, l.amount_total, l.amount_paid, l.payment_status
  from public.leads l
 where l.id in (select lead_id from public.payments_currency_fix_126)
 order by l.full_name;

-- ── Rollback (exact) ─────────────────────────────────────────────────────────
-- begin;
-- alter table public.leads disable trigger leads_updated_at;
-- update public.payments p set currency = b.old_currency, credit_amount = b.old_credit_amount,
--        credit_currency = b.old_credit_currency, fx_rate = b.old_fx_rate
--   from public.payments_currency_fix_126 b where b.payment_id = p.id;
-- update public.leads l set amount_paid = b.old_lead_amount_paid, payment_status = b.old_lead_payment_status
--   from (select distinct on (lead_id) lead_id, old_lead_amount_paid, old_lead_payment_status
--           from public.payments_currency_fix_126) b where b.lead_id = l.id;
-- alter table public.leads enable trigger leads_updated_at;
-- drop trigger if exists leads_currency_resync on public.leads;
-- commit;
