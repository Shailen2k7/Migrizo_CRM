-- ============================================================================
-- 128: SENT DOCUMENTS — keep an exact copy of every branded email we send
-- (SLA, onboarding, invoice, "how it works"), so the team can open what the
-- client actually received from the lead drawer. Before this, only a log line
-- went to `activity`; edits made in the document editor were lost.
--
-- activity_id links each copy to its 'email_sent' activity row (no FK: the
-- activity table has no primary key constraint to reference).
-- ============================================================================

create table if not exists public.sent_documents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  activity_id   uuid,
  email_type    text not null,
  to_email      text not null default '',
  subject       text not null default '',
  html          text not null,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sent_documents_activity on public.sent_documents (activity_id);
create index if not exists idx_sent_documents_lead on public.sent_documents (lead_id, created_at desc);

alter table public.sent_documents enable row level security;

drop policy if exists "ws sent documents" on public.sent_documents;
create policy "ws sent documents" on public.sent_documents for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));
