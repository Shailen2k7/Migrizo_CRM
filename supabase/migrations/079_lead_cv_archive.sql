-- ============================================================================
-- 079 — CV ON RECORD.
--
-- The founder's requirement, verbatim: "scan the complete CV of the person
-- and add it to a button in the lead drawer, so that in future, if we need
-- to see the lead CV, it is saved in a proper format — a record for always."
--
-- So the moment a CV is judged, the ORIGINAL FILE is copied into a permanent
-- per-lead archive (whatsapp-media bucket, {ws}/cv/{lead_id}/…) and these two
-- columns point at it. The chat copy can be purged, the conversation can be
-- cleared, the message can be deleted-for-me — the lead's CV survives all of
-- it, downloadable from the drawer under a proper name with a proper
-- extension.
--
-- Idempotent: safe to run twice.
-- ============================================================================

alter table public.leads add column if not exists cv_path text;
alter table public.leads add column if not exists cv_name text;

comment on column public.leads.cv_path is
  'Permanent archive copy of the CV the lead sent ({ws}/cv/{lead_id}/… in whatsapp-media). Survives chat clears and the Delete-all-CVs purge. Served by /api/lead/cv/[leadId].';
comment on column public.leads.cv_name is
  'Download filename for the archived CV — the customer''s own filename when they sent one, else "<Lead Name> — CV.<ext>".';

notify pgrst, 'reload schema';

select count(*) filter (where cv_path is not null) as leads_with_archived_cv
  from public.leads;
