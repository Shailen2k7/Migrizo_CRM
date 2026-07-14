-- ============================================================================
-- 015: EMAIL SYSTEM — free-form compose, per-user signatures, reply capture.
--
--   lead_emails      → every custom email sent from the CRM and every reply
--                      received (via the Resend Inbound webhook), threaded
--                      per lead. Branded template sends (SLA/invoice/etc.)
--                      continue to log to `activity` as before.
--   email_signatures → one signature per user, auto-appended to composes.
-- ============================================================================

create table if not exists public.lead_emails (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid references public.leads(id) on delete cascade,   -- nullable: unmatched inbound kept for audit
  direction     text not null check (direction in ('out', 'in')),
  from_email    text not null,
  to_email      text not null,
  subject       text not null default '',
  body_text     text not null default '',
  body_html     text,
  status        text not null default 'sent',   -- sent | failed | received
  provider_id   text,                            -- Resend message id
  error         text,
  created_by    uuid,                            -- app user who sent (null for inbound)
  created_at    timestamptz not null default now()
);
create index if not exists idx_lead_emails_lead on public.lead_emails (lead_id, created_at desc);
create index if not exists idx_lead_emails_ws on public.lead_emails (workspace_id, created_at desc);

create table if not exists public.email_signatures (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null,
  signature     jsonb not null default '{}'::jsonb,  -- { closing, name, title, company, phone, website, email }
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.lead_emails enable row level security;
alter table public.email_signatures enable row level security;

drop policy if exists "ws lead emails" on public.lead_emails;
create policy "ws lead emails" on public.lead_emails for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));

drop policy if exists "ws email signatures" on public.email_signatures;
create policy "ws email signatures" on public.email_signatures for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));
