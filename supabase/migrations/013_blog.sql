-- =============================================================================
-- MIGRIZO CRM — 013_blog.sql
-- Blog module: posts, access control (owner-only until granted), image storage.
-- =============================================================================

create table if not exists public.blog_posts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  author_id        uuid,
  title            text not null,
  slug             text not null unique,
  excerpt          text,
  cover_url        text,
  content          jsonb not null default '[]',   -- block-based content
  tags             text[] default '{}',
  seo_title        text,
  seo_description  text,
  status           text not null default 'draft', -- draft | published
  published_at     timestamptz,
  views            int not null default 0,
  reading_minutes  int not null default 3,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists idx_blog_published on public.blog_posts (status, published_at desc);

-- Who can see/manage the Blog module in the CRM (owner-only until granted).
create table if not exists public.blog_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null,
  granted_by   uuid,
  created_at   timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- Seed: ONLY the founding admin (earliest admin membership) gets access.
insert into public.blog_access (workspace_id, user_id)
select workspace_id, user_id from public.workspace_members
where role = 'admin'
order by created_at asc
limit 1
on conflict do nothing;

alter table public.blog_posts  enable row level security;
alter table public.blog_access enable row level security;

-- Manage posts: only users present in blog_access for that workspace.
drop policy if exists "blog editors manage posts" on public.blog_posts;
create policy "blog editors manage posts" on public.blog_posts for all to public
  using (workspace_id in (select workspace_id from public.blog_access where user_id = auth.uid()))
  with check (workspace_id in (select workspace_id from public.blog_access where user_id = auth.uid()));

-- See who has access: any workspace member; grant/revoke: only existing editors.
drop policy if exists "members read blog access" on public.blog_access;
create policy "members read blog access" on public.blog_access for select to public
  using (workspace_id in (select user_workspaces()));

drop policy if exists "editors grant blog access" on public.blog_access;
create policy "editors grant blog access" on public.blog_access for insert to public
  with check (workspace_id in (select workspace_id from public.blog_access where user_id = auth.uid()));

drop policy if exists "editors revoke blog access" on public.blog_access;
create policy "editors revoke blog access" on public.blog_access for delete to public
  using (workspace_id in (select workspace_id from public.blog_access where user_id = auth.uid()));

-- Public image storage for blog media.
insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', true)
on conflict (id) do nothing;

drop policy if exists "blog images public read" on storage.objects;
create policy "blog images public read" on storage.objects for select to public
  using (bucket_id = 'blog-images');

drop policy if exists "blog images auth upload" on storage.objects;
create policy "blog images auth upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'blog-images');

drop policy if exists "blog images auth delete" on storage.objects;
create policy "blog images auth delete" on storage.objects for delete to authenticated
  using (bucket_id = 'blog-images');
