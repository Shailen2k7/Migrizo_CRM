-- ============================================================================
-- 067 — ROADMAP LIBRARY: the consultant decides, the system remembers.
--
-- THE PROBLEM WITH TODAY
-- The Roadmap tab is a paste box. Someone opens Claude, asks for a block,
-- pastes it, and hopes it parses. Every roadmap comes out slightly different,
-- the knowledge lives in a prompt nobody owns, and a bad paste means starting
-- over. That is the chaos.
--
-- THE FIX
-- Split what is REUSABLE from what is PER-CLIENT.
--
--   Reusable (set up once, grows slowly):
--     roadmap_routes      — Digital Technology, Arts, Academia …
--     roadmap_criteria    — the MC and OC1..OC4 for each route
--     roadmap_activities  — the activity library, each tagged to a criterion
--
--   Per client (chosen in 2 minutes):
--     roadmaps.builder    — which route, which criteria, which activities, weeks
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH
-- `roadmaps.data` keeps its exact shape, so renderRoadmapEmail() and
-- /api/roadmap/send keep working with no change at all. We are replacing how
-- the roadmap is BUILT, never how it is sent. One new nullable column is added
-- to remember the choices so the plan can be reopened and edited later —
-- including after it has been sent.
-- ============================================================================

-- ── 1. Remember the choices, so a roadmap can always be reopened ────────────
alter table public.roadmaps
  add column if not exists builder jsonb;

comment on column public.roadmaps.builder is
  'The consultant''s selections (route, grade, duration, ticked criteria, activities, week rows). Lets the builder reopen and edit a roadmap later. `data` remains the rendered output that the email/PDF uses.';


-- ── 2. Routes ───────────────────────────────────────────────────────────────
create table if not exists public.roadmap_routes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

-- ── 3. Criteria: the MC and the OCs for a route ─────────────────────────────
create table if not exists public.roadmap_criteria (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  route_id     uuid not null references public.roadmap_routes(id) on delete cascade,
  code         text not null,                       -- 'MC', 'OC1' …
  kind         text not null default 'optional'
               check (kind in ('mandatory','optional')),
  title        text not null,                       -- 'External recognition'
  description  text,                                -- the long wording
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (route_id, code)
);

-- ── 4. Activity library, each tied to the criterion it evidences ────────────
create table if not exists public.roadmap_activities (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  -- Nullable on purpose: a general activity ("Evidence audit") belongs to the
  -- plan rather than to any single criterion, and must still be pickable.
  criterion_id  uuid references public.roadmap_criteria(id) on delete set null,
  title         text not null,
  detail        text,
  priority      text not null default 'IMPORTANT'
                check (priority in ('ESSENTIAL','IMPORTANT','GOOD TO HAVE')),
  sort_order    int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_rm_criteria_route on public.roadmap_criteria (route_id, sort_order);
create index if not exists idx_rm_activities_ws  on public.roadmap_activities (workspace_id, criterion_id);


-- ── 5. RLS — everyone in the workspace reads, admins curate ─────────────────
alter table public.roadmap_routes     enable row level security;
alter table public.roadmap_criteria   enable row level security;
alter table public.roadmap_activities enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['roadmap_routes','roadmap_criteria','roadmap_activities'] loop
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format('create policy "%s read" on public.%I for select to authenticated
                    using (workspace_id in (select user_workspaces()))', t, t);
    -- Consultants build roadmaps; curating the library is the same team, so
    -- write is workspace-scoped rather than admin-only. RLS still stops any
    -- cross-workspace access.
    execute format('drop policy if exists "%s write" on public.%I', t, t);
    execute format('create policy "%s write" on public.%I for all to authenticated
                    using (workspace_id in (select user_workspaces()))
                    with check (workspace_id in (select user_workspaces()))', t, t);
  end loop;
end $rls$;


-- ── 6. Seed a starting library ──────────────────────────────────────────────
-- STARTING POINTS, NOT GOSPEL. These are the standard shapes for the Global
-- Talent routes; the exact wording is yours to own. Edit every line of it in
-- Settings → Roadmap library. Seeding runs only when a workspace has no routes,
-- so re-running this migration never overwrites your edits.
do $seed$
declare
  ws record; v_route uuid; v_mc uuid; v_oc1 uuid; v_oc2 uuid; v_oc3 uuid; v_oc4 uuid;
begin
  for ws in select id from public.workspaces loop
    if exists (select 1 from public.roadmap_routes r where r.workspace_id = ws.id) then
      continue;                                   -- already set up; leave alone
    end if;

    insert into public.roadmap_routes (workspace_id, name, sort_order)
    values (ws.id, 'Digital Technology', 1)
    returning id into v_route;

    insert into public.roadmap_routes (workspace_id, name, sort_order) values
      (ws.id, 'Arts and Culture', 2),
      (ws.id, 'Academia and Research', 3),
      (ws.id, 'Innovator Founder', 4);

    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order) values
      (ws.id, v_route, 'MC',  'mandatory', 'Mandatory criterion',
       'Proven track record of innovation in the digital technology sector, as a founder, senior executive or employee working on a new digital field or concept.', 0)
      returning id into v_mc;

    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order)
    values (ws.id, v_route, 'OC1', 'optional', 'Recognition beyond the role',
            'Recognition for work beyond the candidate''s occupation that contributes to the advancement of the field.', 1)
    returning id into v_oc1;

    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order)
    values (ws.id, v_route, 'OC2', 'optional', 'Innovation track record',
            'A proven track record of innovation in the digital technology sector.', 2)
    returning id into v_oc2;

    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order)
    values (ws.id, v_route, 'OC3', 'optional', 'Significant contributions',
            'Significant technical, commercial or entrepreneurial contributions to the field.', 3)
    returning id into v_oc3;

    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order)
    values (ws.id, v_route, 'OC4', 'optional', 'Academic contributions',
            'Academic contributions through research, endorsed by an expert in the field.', 4)
    returning id into v_oc4;

    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, null,  'Evidence audit',                'Review everything the candidate already has and map it against the chosen criteria.', 'ESSENTIAL', 0),
      (ws.id, null,  'CV and personal statement',     'Rewrite the CV and draft the personal statement in the endorsing body''s language.',  'ESSENTIAL', 1),
      (ws.id, v_oc1, 'Award nomination',              'Identify and submit to a credible industry award.',                                   'IMPORTANT', 2),
      (ws.id, v_oc1, 'Press or media feature',        'Secure coverage in a recognised industry publication.',                               'GOOD TO HAVE', 3),
      (ws.id, v_oc1, 'Speaking opportunity',          'Confirm a conference talk, panel or podcast appearance.',                             'IMPORTANT', 4),
      (ws.id, v_oc2, 'Product or launch evidence',    'Document a product, feature or launch the candidate led, with metrics.',              'ESSENTIAL', 5),
      (ws.id, v_oc2, 'Growth and traction metrics',   'Collect revenue, user or adoption figures with a credible source.',                   'IMPORTANT', 6),
      (ws.id, v_oc3, 'Technical publication',         'Publish a technical article, whitepaper or open-source contribution.',                'IMPORTANT', 7),
      (ws.id, v_oc3, 'Mentoring or judging',          'Take a mentoring, judging or advisory role and evidence it.',                          'GOOD TO HAVE', 8),
      (ws.id, v_oc4, 'Research or citation record',   'Assemble publications, citations and any peer-review activity.',                      'IMPORTANT', 9),
      (ws.id, null,  'Recommendation letters',        'Secure three letters from recognised experts, drafted and reviewed.',                 'ESSENTIAL', 10),
      (ws.id, null,  'Final evidence consolidation',  'Assemble the ten evidence documents and run the submission checklist.',               'ESSENTIAL', 11);
  end loop;
end $seed$;

notify pgrst, 'reload schema';

-- What the library now holds.
select r.name as route,
       count(distinct c.id) as criteria,
       (select count(*) from public.roadmap_activities a where a.workspace_id = r.workspace_id) as activities
  from public.roadmap_routes r
  left join public.roadmap_criteria c on c.route_id = r.id
 group by r.id, r.name, r.workspace_id
 order by r.name;
