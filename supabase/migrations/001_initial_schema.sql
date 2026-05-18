-- =========================================
-- MIGRIZO CRM · Supabase schema
-- Multi-user, workspace-scoped, RLS-protected
-- =========================================

-- =========================================
-- TABLES
-- =========================================

-- Workspaces (each user gets one auto on signup; can invite team later)
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz default now()
);

-- Workspace members (role-based access)
create table if not exists public.workspace_members (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'member')),
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- Leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  full_name text not null,
  phone text,
  email text,
  visa_type text,
  stage text not null default 'new'
    check (stage in ('new','attempted','connected','qualified','consultation','proposal','partial','won','lost')),
  source text,
  score int default 50 check (score >= 0 and score <= 100),
  next_follow_up timestamptz,
  payment_status text default 'none'
    check (payment_status in ('none','partial','paid','overdue')),
  amount_paid bigint default 0,
  amount_total bigint default 0,
  last_note text,
  last_note_author_id uuid references auth.users(id),
  last_note_at timestamptz,
  tags text[] default '{}',
  created_at timestamptz default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  is_sample boolean default false
);

create index if not exists idx_leads_workspace on public.leads(workspace_id);
create index if not exists idx_leads_phone on public.leads(workspace_id, phone) where phone is not null;
create index if not exists idx_leads_email on public.leads(workspace_id, email) where email is not null;
create index if not exists idx_leads_stage on public.leads(workspace_id, stage);
create index if not exists idx_leads_next_follow_up on public.leads(workspace_id, next_follow_up);

-- Notes
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  body text not null,
  author_id uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists idx_notes_lead on public.notes(lead_id, created_at desc);

-- Payments (milestone-based)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade not null,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  milestone text not null
    check (milestone in ('kickstart','profile_building','endorsement','post_approval')),
  amount bigint not null,
  status text default 'pending' check (status in ('pending','paid','overdue')),
  due_date date,
  paid_at timestamptz,
  note text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_payments_lead on public.payments(lead_id);
create index if not exists idx_payments_workspace on public.payments(workspace_id);
create index if not exists idx_payments_due on public.payments(workspace_id, due_date) where status != 'paid';

-- Activity log
create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  user_id uuid references auth.users(id),
  lead_id uuid references public.leads(id) on delete set null,
  action text not null,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_activity_workspace on public.activity(workspace_id, created_at desc);

-- =========================================
-- TRIGGERS & FUNCTIONS
-- =========================================

-- updated_at auto-update
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
  before update on public.leads
  for each row execute procedure public.update_updated_at();

-- Auto-create workspace when a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
  display_name text;
begin
  display_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );

  insert into public.workspaces (name, owner_id)
  values (display_name || '''s Workspace', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'admin');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper: get the user's workspace IDs
create or replace function public.user_workspaces()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid();
$$;

-- Helper: is user admin of a workspace
create or replace function public.is_workspace_admin(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Reset workspace data (admin only)
create or replace function public.reset_workspace(ws_id uuid, sample_only boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_admin(ws_id) then
    raise exception 'Only workspace admins can reset data';
  end if;

  if sample_only then
    delete from public.leads where workspace_id = ws_id and is_sample = true;
  else
    delete from public.activity where workspace_id = ws_id;
    delete from public.payments where workspace_id = ws_id;
    delete from public.notes where workspace_id = ws_id;
    delete from public.leads where workspace_id = ws_id;
  end if;
end;
$$;

-- =========================================
-- ROW LEVEL SECURITY
-- =========================================

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.leads enable row level security;
alter table public.notes enable row level security;
alter table public.payments enable row level security;
alter table public.activity enable row level security;

-- workspaces
drop policy if exists "view own workspaces" on public.workspaces;
create policy "view own workspaces" on public.workspaces
  for select using (id in (select public.user_workspaces()));

drop policy if exists "update own workspace" on public.workspaces;
create policy "update own workspace" on public.workspaces
  for update using (owner_id = auth.uid());

-- workspace_members
drop policy if exists "view members of own workspaces" on public.workspace_members;
create policy "view members of own workspaces" on public.workspace_members
  for select using (workspace_id in (select public.user_workspaces()));

-- leads
drop policy if exists "view leads in workspace" on public.leads;
create policy "view leads in workspace" on public.leads
  for select using (workspace_id in (select public.user_workspaces()));

drop policy if exists "insert leads in workspace" on public.leads;
create policy "insert leads in workspace" on public.leads
  for insert with check (workspace_id in (select public.user_workspaces()));

drop policy if exists "update leads in workspace" on public.leads;
create policy "update leads in workspace" on public.leads
  for update using (workspace_id in (select public.user_workspaces()));

drop policy if exists "delete leads admin only" on public.leads;
create policy "delete leads admin only" on public.leads
  for delete using (public.is_workspace_admin(workspace_id));

-- notes
drop policy if exists "view notes in workspace" on public.notes;
create policy "view notes in workspace" on public.notes
  for select using (workspace_id in (select public.user_workspaces()));

drop policy if exists "insert notes in workspace" on public.notes;
create policy "insert notes in workspace" on public.notes
  for insert with check (workspace_id in (select public.user_workspaces()) and author_id = auth.uid());

drop policy if exists "delete own notes or admin" on public.notes;
create policy "delete own notes or admin" on public.notes
  for delete using (author_id = auth.uid() or public.is_workspace_admin(workspace_id));

-- payments
drop policy if exists "view payments in workspace" on public.payments;
create policy "view payments in workspace" on public.payments
  for select using (workspace_id in (select public.user_workspaces()));

drop policy if exists "insert payments in workspace" on public.payments;
create policy "insert payments in workspace" on public.payments
  for insert with check (workspace_id in (select public.user_workspaces()));

drop policy if exists "update payments in workspace" on public.payments;
create policy "update payments in workspace" on public.payments
  for update using (workspace_id in (select public.user_workspaces()));

drop policy if exists "delete payments admin only" on public.payments;
create policy "delete payments admin only" on public.payments
  for delete using (public.is_workspace_admin(workspace_id));

-- activity
drop policy if exists "view activity in workspace" on public.activity;
create policy "view activity in workspace" on public.activity
  for select using (workspace_id in (select public.user_workspaces()));

drop policy if exists "insert activity in workspace" on public.activity;
create policy "insert activity in workspace" on public.activity
  for insert with check (workspace_id in (select public.user_workspaces()));
