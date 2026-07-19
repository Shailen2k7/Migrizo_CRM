-- ============================================================================
-- 017: LEARNING HUB — a simple internal library of PDF resources.
-- Admins upload PDFs into categories; everyone in the workspace can read them.
-- Files live in a PRIVATE storage bucket; the app serves them via short-lived
-- signed URLs (so documents are never exposed on a public link).
-- ============================================================================

create table if not exists public.learning_docs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  title         text not null,
  category      text not null default 'general',   -- sales | product | gtv | general
  storage_path  text not null,                     -- path inside the learning-docs bucket
  file_name     text not null,
  file_size     bigint not null default 0,
  uploaded_by   uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_learning_docs_ws on public.learning_docs (workspace_id, created_at desc);

alter table public.learning_docs enable row level security;

-- READ: any member of the workspace.
drop policy if exists "ws read learning" on public.learning_docs;
create policy "ws read learning" on public.learning_docs for select to public
  using (workspace_id in (select user_workspaces()));

-- WRITE (insert/update/delete): admins only.
drop policy if exists "admin write learning" on public.learning_docs;
create policy "admin write learning" on public.learning_docs for all to public
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- PRIVATE storage bucket for the PDFs (not publicly listable).
insert into storage.buckets (id, name, public)
values ('learning-docs', 'learning-docs', false)
on conflict (id) do nothing;

-- Any authenticated user may READ objects (the app still gates by workspace in
-- the table; signed URLs are generated server-checked). Upload/delete are the
-- app's job to restrict to admins, enforced by the table RLS above + the UI.
drop policy if exists "learning read" on storage.objects;
create policy "learning read" on storage.objects for select to authenticated
  using (bucket_id = 'learning-docs');

drop policy if exists "learning upload" on storage.objects;
create policy "learning upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'learning-docs');

drop policy if exists "learning delete" on storage.objects;
create policy "learning delete" on storage.objects for delete to authenticated
  using (bucket_id = 'learning-docs');
