-- =============================================================================
-- 120 — THE CLIENT'S GST NUMBER
-- -----------------------------------------------------------------------------
-- A GSTIN belongs to the CLIENT, not to one payment. The same company quotes
-- the same number on every invoice we ever raise for them, so it lives on the
-- lead and is typed once — the GST bar on any payment row reads and writes it,
-- and every later invoice for that client already has it.
--
-- OPTIONAL BY DESIGN. Most of our clients are individuals with no GSTIN at all.
-- The column is nullable, there is no default, and an invoice without one
-- prints exactly as it does today. Nothing about an existing invoice changes.
--
-- WHY THE CHECK IS DELIBERATELY LOOSE
-- A GSTIN is 15 characters in a well-known pattern, but a constraint that
-- enforces the pattern would reject a real number the day the format is
-- extended, and block someone mid-typing through a form that saves as you go.
-- So the database only insists it is not absurd — 15 characters, letters and
-- digits — and the screen does the friendly checking, where it can explain
-- itself instead of throwing an error.
--
-- Idempotent. Safe to run twice.
-- =============================================================================

alter table public.leads add column if not exists gstin text;

do $$ begin
  alter table public.leads add constraint leads_gstin_chk
    check (gstin is null or gstin ~ '^[0-9A-Z]{15}$');
exception when duplicate_object then null; end $$;

comment on column public.leads.gstin is
  'The client''s GST identification number, 15 characters, uppercase. NULL for '
  'individuals and anyone who has not given one — which is most leads. Printed '
  'on the invoice under BILL TO when present, omitted entirely when not.';

-- Only useful for finding a client by their number, which is rare but is
-- exactly the moment you want it to be instant. Partial, so the 2,700 leads
-- without a GSTIN cost nothing.
create index if not exists idx_leads_gstin on public.leads (workspace_id, gstin)
  where gstin is not null;

notify pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
select
  count(*)                                  as total_leads,
  count(*) filter (where gstin is not null) as with_gstin
from public.leads;
