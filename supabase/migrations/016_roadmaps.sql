-- ============================================================================
-- 016: ROADMAPS — the Global Talent roadmap module.
-- One row per analysis pasted from Claude Max. Multiple versions per lead
-- (latest wins in the UI; history preserved). `data` holds the full parsed
-- JSON; `sent_at` marks when the branded roadmap email went out.
-- ============================================================================

create table if not exists public.roadmaps (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  data          jsonb not null,                 -- full RoadmapData (see lib/roadmap/types.ts)
  status        text not null default 'draft',  -- draft | sent
  sent_at       timestamptz,
  sent_to       text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_roadmaps_lead on public.roadmaps (lead_id, created_at desc);

alter table public.roadmaps enable row level security;

drop policy if exists "ws roadmaps" on public.roadmaps;
create policy "ws roadmaps" on public.roadmaps for all to public
  using (workspace_id in (select user_workspaces()))
  with check (workspace_id in (select user_workspaces()));
