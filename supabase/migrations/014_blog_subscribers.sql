-- ============================================================================
-- 014: Blog newsletter subscribers.
-- Written only by the server (service role) via /api/blog/subscribe.
-- RLS enabled with NO public policies: anon/authenticated cannot read or
-- write this table directly. Export the list from Table Editor when needed.
-- ============================================================================
create table if not exists public.blog_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'blog',
  created_at timestamptz not null default now()
);

alter table public.blog_subscribers enable row level security;
