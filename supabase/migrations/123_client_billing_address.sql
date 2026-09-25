-- =============================================================================
-- 123 — THE CLIENT'S BILLING ADDRESS
-- -----------------------------------------------------------------------------
-- Printed under BILL TO on every invoice and receipt, beneath the client's
-- name, alongside the GST number added by migration 120.
--
-- IT LIVES ON THE LEAD, NOT THE PAYMENT, for the same reason the GSTIN does:
-- an address belongs to the client. Typed once on any payment's invoice panel,
-- it is already there for every later instalment.
--
-- ONE FREE-TEXT FIELD, NOT FIVE. Clients are in India, the UK and elsewhere;
-- a street / city / state / PIN form fits one country's addresses and fights
-- everyone else's. People paste addresses whole, and the invoice prints them
-- line for line, so line breaks are kept exactly as typed.
--
-- OPTIONAL BY DESIGN. NULL prints nothing, and an invoice for a client with
-- no address looks exactly as it does today.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

alter table public.leads add column if not exists billing_address text;

do $$ begin
  alter table public.leads add constraint leads_billing_address_len_chk
    check (billing_address is null or char_length(billing_address) <= 600);
exception when duplicate_object then null; end $$;

comment on column public.leads.billing_address is
  'Client billing address, printed under BILL TO on invoices and receipts. '
  'Free text, line breaks preserved, at most 600 characters. NULL prints nothing.';

notify pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
select count(*) as total_leads,
       count(*) filter (where billing_address is not null) as with_address
from public.leads;
