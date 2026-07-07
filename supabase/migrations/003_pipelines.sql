-- =============================================================================
-- MIGRIZO CRM — 003_pipelines.sql
-- Adds editable, multi-pipeline support (Bigin-style) on top of 002.
--
-- WHAT THIS DOES
--   * New `pipelines` table  — one per visa product (GTV, IFV, ...).
--   * New `stages` table     — the editable columns of each pipeline, each
--                              tagged active / won / lost so the Daily Tracker
--                              and AI COO keep working with custom stages.
--   * leads.pipeline_id      — which pipeline a lead lives in.
--   * Seeds your existing six stages as the default "Global Talent Visa"
--     pipeline, and points every existing lead at it — so nothing breaks.
--   * Removes the hard-coded stage CHECK so custom pipelines can define their
--     own stage keys (validity is now enforced by the stages table + app).
--
-- Idempotent: safe to re-run. Apply once in Supabase → SQL Editor → Run.
-- =============================================================================

-- 1) TABLES -------------------------------------------------------------------

create table if not exists public.pipelines (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  visa_type    text,                              -- e.g. 'GTV', 'IFV' (optional label)
  sort_order   integer not null default 0,
  is_default   boolean not null default false,    -- the pipeline shown first
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.stages (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references public.pipelines(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,                     -- display label, freely editable
  stage_key    text not null,                     -- stable slug stored on leads.stage
  color        text not null default 'slate',     -- red|blue|amber|violet|green|slate...
  sort_order   integer not null default 0,
  stage_type   text not null default 'active'
                 check (stage_type in ('active','won','lost')),
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (pipeline_id, stage_key)
);

-- 2) LEADS: add pipeline_id, drop the fixed-stage CHECK -----------------------

alter table public.leads
  add column if not exists pipeline_id uuid references public.pipelines(id) on delete set null;

-- Remove the hard-coded six-stage constraint so custom pipelines can define
-- their own stages. The stages table is now the source of truth.
alter table public.leads drop constraint if exists leads_stage_check;

-- 3) INDEXES ------------------------------------------------------------------

create index if not exists idx_pipelines_workspace on public.pipelines (workspace_id);
create index if not exists idx_stages_pipeline      on public.stages (pipeline_id);
create index if not exists idx_stages_workspace     on public.stages (workspace_id);
create index if not exists idx_leads_pipeline       on public.leads (pipeline_id);

-- 4) updated_at triggers (reuse existing touch function) ----------------------

drop trigger if exists pipelines_touch on public.pipelines;
create trigger pipelines_touch before update on public.pipelines
  for each row execute function public.update_updated_at();

drop trigger if exists stages_touch on public.stages;
create trigger stages_touch before update on public.stages
  for each row execute function public.update_updated_at();

-- 5) SEED: default "Global Talent Visa" pipeline per workspace ----------------
--    Recreates your current six stages exactly, then backfills existing leads.

do $$
declare
  ws  record;
  pid uuid;
begin
  for ws in select id from public.workspaces loop

    -- Skip if this workspace already has a default pipeline (idempotent)
    if exists (select 1 from public.pipelines where workspace_id = ws.id and is_default) then
      continue;
    end if;

    insert into public.pipelines (workspace_id, name, visa_type, sort_order, is_default)
    values (ws.id, 'Global Talent Visa', 'GTV', 0, true)
    returning id into pid;

    insert into public.stages (pipeline_id, workspace_id, name, stage_key, color, sort_order, stage_type)
    values
      (pid, ws.id, 'Hot Leads',       'hot',             'red',    0, 'active'),
      (pid, ws.id, 'Cold Leads',      'cold',            'blue',   1, 'active'),
      (pid, ws.id, 'Mr Coming Soon',  'mr_coming_soon',  'amber',  2, 'active'),
      (pid, ws.id, 'Invoice Sent',    'invoice_sent',    'violet', 3, 'active'),
      (pid, ws.id, 'Won',             'won',             'green',  4, 'won'),
      (pid, ws.id, 'Junk',            'junk',            'slate',  5, 'lost');

    -- Point every existing lead in this workspace at the default pipeline
    update public.leads
       set pipeline_id = pid
     where workspace_id = ws.id and pipeline_id is null;

  end loop;
end $$;

-- 6) ROW LEVEL SECURITY -------------------------------------------------------
--    Same workspace-scoped pattern as the rest of the app (user_workspaces()).

alter table public.pipelines enable row level security;
alter table public.stages    enable row level security;

drop policy if exists "view pipelines"   on public.pipelines;
create policy "view pipelines"   on public.pipelines for select to public
  using (workspace_id in (select user_workspaces()));
drop policy if exists "insert pipelines" on public.pipelines;
create policy "insert pipelines" on public.pipelines for insert to public
  with check (workspace_id in (select user_workspaces()));
drop policy if exists "update pipelines" on public.pipelines;
create policy "update pipelines" on public.pipelines for update to public
  using (workspace_id in (select user_workspaces()));
drop policy if exists "delete pipelines" on public.pipelines;
create policy "delete pipelines" on public.pipelines for delete to public
  using (workspace_id in (select user_workspaces()));

drop policy if exists "view stages"   on public.stages;
create policy "view stages"   on public.stages for select to public
  using (workspace_id in (select user_workspaces()));
drop policy if exists "insert stages" on public.stages;
create policy "insert stages" on public.stages for insert to public
  with check (workspace_id in (select user_workspaces()));
drop policy if exists "update stages" on public.stages;
create policy "update stages" on public.stages for update to public
  using (workspace_id in (select user_workspaces()));
drop policy if exists "delete stages" on public.stages;
create policy "delete stages" on public.stages for delete to public
  using (workspace_id in (select user_workspaces()));

-- Done. Your six stages are now the editable "Global Talent Visa" pipeline,
-- every existing lead is attached to it, and you can create new pipelines
-- (e.g. Innovator Founder Visa) with their own stages from Settings.
