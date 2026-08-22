-- ============================================================================
-- 068 — Every route gets a shape. Not every route works like Tech Nation.
--
-- WHAT 067 GOT WRONG
-- It seeded criteria for Digital Technology only, so a consultant with a
-- research or arts client opened the builder and section 2 was empty. Worse,
-- it assumed EVERY route follows the Tech Nation pattern of "one mandatory
-- criterion plus optional ones". That is simply not how the other routes work.
--
-- THE ACTUAL SHAPES
--
--   Digital Technology   MC + pick 2 of 4 optional criteria.
--   Innovator Founder    Three criteria, all required: innovation, viability,
--                        scalability. Nothing optional about any of them.
--   Arts and Culture     A mandatory standard plus supporting evidence.
--   Academia / Research  NOT criteria at all. Four qualifying PATHWAYS, and
--                        you need exactly one:
--                          1. Academic or research appointment
--                          2. Individual fellowship
--                          3. Endorsed funder (research grant)
--                          4. Peer review
--                        For the first three there is nothing to "build" over
--                        eight weeks — the person either holds the appointment,
--                        fellowship or grant, or they do not. The roadmap is
--                        document collection. Only peer review is an
--                        evidence-building exercise.
--
-- So a route now declares its own MODE, and the builder adapts to it instead
-- of pretending every applicant is a software engineer.
--
-- All wording remains yours to edit in Manage library. Re-running this never
-- overwrites an edit: every insert is guarded on the route having no criteria.
-- ============================================================================

-- ── 1. A route declares how it is assessed ──────────────────────────────────
alter table public.roadmap_routes
  add column if not exists mode text not null default 'criteria';

do $$ begin
  alter table public.roadmap_routes
    add constraint roadmap_routes_mode_chk
    check (mode in ('criteria','pathway','simple'));
exception when duplicate_object then null; end $$;

comment on column public.roadmap_routes.mode is
  'criteria = tick the criteria to evidence (Digital Tech, Arts, Innovator Founder). pathway = choose ONE qualifying route (Academia/Research). simple = no criteria, build straight from activities.';

-- ── 2. "pathway" joins mandatory/optional as a kind of requirement ──────────
do $$ begin
  alter table public.roadmap_criteria drop constraint if exists roadmap_criteria_kind_check;
  alter table public.roadmap_criteria
    add constraint roadmap_criteria_kind_check
    check (kind in ('mandatory','optional','pathway'));
exception when duplicate_object then null; end $$;


-- ── 3. Fill in the routes 067 left empty ────────────────────────────────────
do $seed$
declare
  ws record; v_route uuid; c uuid;
begin
  for ws in select id from public.workspaces loop

  -- ── ACADEMIA AND RESEARCH — four pathways, choose one ────────────────────
  select id into v_route from public.roadmap_routes
   where workspace_id = ws.id and name = 'Academia and Research';
  if v_route is not null then
    update public.roadmap_routes set mode = 'pathway' where id = v_route;

    if not exists (select 1 from public.roadmap_criteria where route_id = v_route) then
      insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order) values
        (ws.id, v_route, 'R1', 'pathway', 'Academic or research appointment',
         'An accepted offer for an eligible senior academic, research or innovation-leadership role at an approved institution. Needs the job description and an HR statement of guarantee.', 1),
        (ws.id, v_route, 'R2', 'pathway', 'Individual fellowship',
         'Holds — or held within the last five years — a fellowship from the approved list. Needs the award letter.', 2),
        (ws.id, v_route, 'R3', 'pathway', 'Endorsed funder (research grant)',
         'Named on a grant from an approved funder. Broadly: at least 50% of working time on the grant, a minimum award value, a grant of at least 24 months, and at least a year left on the employment contract. Verify the current thresholds before advising.', 3),
        (ws.id, v_route, 'R4', 'pathway', 'Peer review',
         'No qualifying appointment, fellowship or grant. Endorsement is judged on evidence and expert letters — this is the only academic pathway where a roadmap builds something new.', 4);

      -- Activities for the document-collection pathways.
      select id into c from public.roadmap_criteria where route_id = v_route and code = 'R1';
      insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
        (ws.id, c, 'Offer letter and job description', 'Collect the signed offer and a job description showing research or leadership as the primary function.', 'ESSENTIAL', 20),
        (ws.id, c, 'HR statement of guarantee', 'Request the statement of guarantee from the institution''s HR team.', 'ESSENTIAL', 21);

      select id into c from public.roadmap_criteria where route_id = v_route and code = 'R2';
      insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
        (ws.id, c, 'Fellowship award letter', 'Obtain the award letter and confirm the eligibility window still applies.', 'ESSENTIAL', 22);

      select id into c from public.roadmap_criteria where route_id = v_route and code = 'R3';
      insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
        (ws.id, c, 'Grant award letter', 'Collect the award letter naming the applicant and confirming value and duration.', 'ESSENTIAL', 23),
        (ws.id, c, 'Institutional statement', 'Request the statement of guarantee covering time commitment and contract length.', 'ESSENTIAL', 24);

      -- Peer review is the one that behaves like a build.
      select id into c from public.roadmap_criteria where route_id = v_route and code = 'R4';
      insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
        (ws.id, c, 'Publication and citation record', 'Assemble publications, citation counts and any peer-review or editorial roles.', 'ESSENTIAL', 25),
        (ws.id, c, 'Three expert letters',            'Secure letters from established figures in the field, drafted and reviewed.', 'ESSENTIAL', 26),
        (ws.id, c, 'Research statement',              'Draft the statement of past achievement and intended UK contribution.', 'ESSENTIAL', 27),
        (ws.id, c, 'Conference and invited talks',    'Evidence invited talks, keynotes or programme-committee roles.', 'IMPORTANT', 28),
        (ws.id, c, 'Grants and awards record',        'Collect competitive funding, prizes and recognition with amounts and dates.', 'IMPORTANT', 29);
    end if;
  end if;

  -- ── INNOVATOR FOUNDER — three criteria, every one required ───────────────
  select id into v_route from public.roadmap_routes
   where workspace_id = ws.id and name = 'Innovator Founder';
  if v_route is not null
     and not exists (select 1 from public.roadmap_criteria where route_id = v_route) then
    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order) values
      (ws.id, v_route, 'INN', 'mandatory', 'Innovation',
       'A genuine, original business plan meeting a new or existing market need, and creating a competitive advantage.', 1),
      (ws.id, v_route, 'VIA', 'mandatory', 'Viability',
       'A realistic and achievable plan, with the applicant''s skills, knowledge, experience and market awareness to deliver it.', 2),
      (ws.id, v_route, 'SCA', 'mandatory', 'Scalability',
       'Evidence of structured planning, potential for job creation, and growth into national and international markets.', 3);

    select id into c from public.roadmap_criteria where route_id = v_route and code = 'INN';
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, c, 'Business plan — innovation section', 'Articulate the original idea and the market need it answers.', 'ESSENTIAL', 30),
      (ws.id, c, 'Competitor and IP analysis',         'Show the competitive advantage, and any IP or filings that protect it.', 'IMPORTANT', 31);

    select id into c from public.roadmap_criteria where route_id = v_route and code = 'VIA';
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, c, 'Founder capability evidence', 'Map the founder''s track record against what the plan demands.', 'ESSENTIAL', 32),
      (ws.id, c, 'Financial model',             'Build the forecast, funding position and runway.', 'ESSENTIAL', 33);

    select id into c from public.roadmap_criteria where route_id = v_route and code = 'SCA';
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, c, 'Job creation plan',    'Set out UK hiring by role and year.', 'ESSENTIAL', 34),
      (ws.id, c, 'Market expansion plan','Show the path to national and then international markets.', 'IMPORTANT', 35);
  end if;

  -- ── ARTS AND CULTURE ─────────────────────────────────────────────────────
  select id into v_route from public.roadmap_routes
   where workspace_id = ws.id and name = 'Arts and Culture';
  if v_route is not null
     and not exists (select 1 from public.roadmap_criteria where route_id = v_route) then
    insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order) values
      (ws.id, v_route, 'MC',  'mandatory', 'Mandatory criterion',
       'Recognised as a leader (Exceptional Talent) or an emerging leader (Exceptional Promise) in the applicant''s artistic field, with an international profile or evidence of one developing.', 0),
      (ws.id, v_route, 'AC1', 'optional', 'International recognition',
       'Work performed, exhibited or published outside the applicant''s home country.', 1),
      (ws.id, v_route, 'AC2', 'optional', 'Media and critical recognition',
       'Reviews, features or critical coverage in recognised publications or broadcast media.', 2),
      (ws.id, v_route, 'AC3', 'optional', 'Awards and nominations',
       'Awards, nominations or selection for competitive programmes in the field.', 3);

    select id into c from public.roadmap_criteria where route_id = v_route and code = 'AC1';
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, c, 'International showcase',   'Secure an exhibition, performance, screening or publication outside the home country.', 'ESSENTIAL', 40);
    select id into c from public.roadmap_criteria where route_id = v_route and code = 'AC2';
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, c, 'Press and review pack',    'Gather reviews and features; commission coverage where there is a gap.', 'IMPORTANT', 41);
    select id into c from public.roadmap_criteria where route_id = v_route and code = 'AC3';
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order) values
      (ws.id, c, 'Award submissions',        'Identify and submit to credible awards and competitive programmes.', 'IMPORTANT', 42);
  end if;

  end loop;
end $seed$;

notify pgrst, 'reload schema';

-- No route should read zero any more.
select r.name as route,
       r.mode,
       count(c.id) filter (where c.kind = 'mandatory') as required,
       count(c.id) filter (where c.kind = 'optional')  as optional,
       count(c.id) filter (where c.kind = 'pathway')   as pathways,
       (select count(*) from public.roadmap_activities a
         where a.criterion_id in (select id from public.roadmap_criteria x where x.route_id = r.id)) as activities
  from public.roadmap_routes r
  left join public.roadmap_criteria c on c.route_id = r.id
 group by r.id, r.name, r.mode
 order by r.sort_order;
