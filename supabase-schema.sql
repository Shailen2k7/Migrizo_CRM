-- ============================================================
-- MIGRIZO CRM — Supabase Schema
-- Paste this entire file into Supabase SQL Editor and run it.
-- ============================================================

-- 1. User profiles (extends Supabase auth)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text not null default '',
  role text not null default 'counselor', -- 'admin' or 'counselor'
  avatar_initials text generated always as (upper(left(full_name, 2))) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Admins read all profiles" on public.profiles for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), coalesce(new.raw_user_meta_data->>'role', 'counselor'));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Zoho OAuth tokens (NEVER accessible from frontend — service role only)
create table if not exists public.zoho_tokens (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  api_domain text default 'https://www.zohoapis.in',
  connected_by uuid references auth.users(id),
  updated_at timestamptz default now()
);
alter table public.zoho_tokens enable row level security;
-- NO frontend policies — only service role key can access this table

-- 3. Audit log
create table if not exists public.audit_log (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id),
  user_name text,
  user_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_name text,
  before_state jsonb,
  after_state jsonb,
  ip_address text,
  created_at timestamptz default now()
);
alter table public.audit_log enable row level security;
create policy "Admins read all audit logs" on public.audit_log for select using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "Authenticated users insert logs" on public.audit_log for insert with check (auth.uid() is not null);

-- 4. Leads cache (synced from Bigin via webhook + API)
create table if not exists public.leads_cache (
  zoho_id text primary key,
  full_name text,
  phone text,
  email text,
  score int default 0,
  tags text[] default '{}',
  stage text default 'New Inquiry',
  amount_paid numeric default 0,
  total_fee numeric default 0,
  payment_phase text,
  owner_name text,
  last_contacted timestamptz,
  raw jsonb,
  synced_at timestamptz default now()
);
alter table public.leads_cache enable row level security;
create policy "Authenticated users read leads" on public.leads_cache for select using (auth.uid() is not null);

-- 5. Tasks cache (follow-ups)
create table if not exists public.tasks_cache (
  zoho_id text primary key,
  subject text,
  due_date timestamptz,
  status text default 'Not Started',
  contact_id text,
  contact_name text,
  contact_phone text,
  priority text default 'Normal',
  description text,
  raw jsonb,
  synced_at timestamptz default now()
);
alter table public.tasks_cache enable row level security;
create policy "Authenticated users read tasks" on public.tasks_cache for select using (auth.uid() is not null);

-- 6. Events cache (consultations, meetings)
create table if not exists public.events_cache (
  zoho_id text primary key,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  contact_id text,
  contact_name text,
  event_type text default 'Consultation',
  location text,
  raw jsonb,
  synced_at timestamptz default now()
);
alter table public.events_cache enable row level security;
create policy "Authenticated users read events" on public.events_cache for select using (auth.uid() is not null);

-- Indexes for speed
create index if not exists idx_leads_stage on public.leads_cache(stage);
create index if not exists idx_leads_payment_phase on public.leads_cache(payment_phase);
create index if not exists idx_tasks_due_date on public.tasks_cache(due_date);
create index if not exists idx_tasks_status on public.tasks_cache(status);
create index if not exists idx_audit_created on public.audit_log(created_at desc);
create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id);

-- ============================================================
-- After running this, go to Supabase > Authentication > Settings
-- and set Site URL to: https://migrizo-crm.netlify.app
-- Add redirect URL: https://migrizo-crm.netlify.app/login.html
-- ============================================================
