-- ============================================================================
-- 075 — GST on invoices.
--
-- The invoice template hardcoded CGST 0% / SGST 0%. Some clients are billed
-- with GST and some are not, so the rate has to be a per-payment decision.
--
-- WHY ON THE PAYMENT AND NOT PASSED AT SEND TIME
-- The invoice goes out two ways: emailed (/api/email/send) and downloaded as a
-- PDF (/api/invoice/pdf). If the rate were an argument to the send, the PDF
-- route would have no idea what was actually billed and the two documents
-- would disagree — on a tax document. Storing it on the payment row means both
-- renderers read the same number, and reopening a six-month-old invoice shows
-- the rate that was actually charged rather than today's default.
--
--   gst_rate  0 = no GST (the default, and how every existing invoice stays)
--   gst_mode  'add'       — GST is ADDED to the amount; the client pays more
--             'inclusive' — the amount already contains GST; it is extracted
--
-- The mode matters: at 18% on 3,000, "add" bills 3,540 while "inclusive"
-- bills 3,000 and reports 457.63 of tax inside it. Getting that backwards
-- misstates the tax on a legal document, so it is recorded explicitly rather
-- than assumed.
-- ============================================================================

alter table public.payments add column if not exists gst_rate numeric(5,2) not null default 0;
alter table public.payments add column if not exists gst_mode text not null default 'add';

do $$ begin
  alter table public.payments add constraint payments_gst_rate_chk
    check (gst_rate >= 0 and gst_rate <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.payments add constraint payments_gst_mode_chk
    check (gst_mode in ('add', 'inclusive'));
exception when duplicate_object then null; end $$;

comment on column public.payments.gst_rate is
  'Total GST percentage for this invoice (split CGST/SGST half each on the document). 0 = no GST.';
comment on column public.payments.gst_mode is
  'add = GST added on top of amount (client pays amount + GST). inclusive = amount already contains GST, which is extracted for display.';

notify pgrst, 'reload schema';

-- Every existing payment keeps gst_rate 0, so no already-sent invoice changes.
select count(*) as payments_total,
       count(*) filter (where gst_rate > 0) as with_gst
  from public.payments;
