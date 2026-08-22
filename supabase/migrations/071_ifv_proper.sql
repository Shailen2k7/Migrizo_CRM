-- ============================================================================
-- 071 — IFV IS NOT GTV. Stop leaking GTV work into founder roadmaps.
--
-- THE BUG (structural, not cosmetic)
-- 067 seeded "general" activities with criterion_id = NULL, meaning
-- "show for every route". So GTV admin work — Evidence audit, CV and personal
-- statement, RECOMMENDATION LETTERS, Final evidence consolidation — appeared on
-- Innovator Founder plans. An IFV applicant does not need expert recommendation
-- letters. Nothing in that list belongs to a founder's endorsement.
--
-- THE FIX
-- A general activity now belongs to a VISA. GTV generals show only for GTV
-- routes, IFV generals only for IFV. Criterion-linked activities were already
-- safe (a criterion belongs to a route, a route to a visa).
--
-- AND: the real IFV requirement set, from the founder's own list —
--   Passport + personal details · Updated CV / founder profile · Detailed
--   business idea & plan · Innovation / USP evidence · Market research &
--   competitor analysis · Financial projections + funding / source of funds ·
--   Founder's skills, experience & contribution · Go-to-market &
--   scalability / job-creation plan · Existing business evidence (website,
--   traction, customers, revenue, IP, partnerships)
--
-- The endorsement turns on Innovative + Viable + Scalable, PLUS proof that the
-- applicant genuinely is the founder / key person and will run the business
-- day to day. That last test was missing entirely, so it becomes a fourth
-- criterion (ROLE) rather than being left implicit.
-- ============================================================================

-- ── 1. A general activity belongs to a visa ─────────────────────────────────
alter table public.roadmap_activities
  add column if not exists visa text;

do $$ begin
  alter table public.roadmap_activities
    add constraint roadmap_activities_visa_chk check (visa is null or visa in ('gtv','ifv'));
exception when duplicate_object then null; end $$;

comment on column public.roadmap_activities.visa is
  'Only meaningful for general activities (criterion_id IS NULL): which visa they belong to. NULL = shown for any visa. Criterion-linked rows are already scoped through their route.';

-- Everything general seeded so far was GTV work. Claim it as such.
update public.roadmap_activities
   set visa = 'gtv'
 where criterion_id is null
   and visa is null
   and title in ('Evidence audit','CV and personal statement','Recommendation letters',
                 'Final evidence consolidation');

-- 069 added IFV generals but left them unscoped. Tag them, and retire
-- "Letters of support" — too easily confused with GTV recommendation letters,
-- and partner/customer proof is already covered by the traction evidence below.
update public.roadmap_activities set visa = 'ifv'
 where criterion_id is null
   and title in ('Endorsing body selection','Pitch deck','Endorsement interview prep');
update public.roadmap_activities set active = false
 where criterion_id is null and title = 'Letters of support';


do $seed$
declare ws record; v_if uuid; v_inn uuid; v_via uuid; v_sca uuid; v_role uuid;
begin
  for ws in select id from public.workspaces loop
    select id into v_if from public.roadmap_routes
     where workspace_id = ws.id and name = 'Innovator Founder';
    continue when v_if is null;

    -- ── 2. The three tests, in the founder's own framing ──────────────────
    update public.roadmap_criteria set
      title = 'Innovative',
      description = 'An original business idea with a clear USP that meets a new or existing market need, backed by market research and competitor analysis.'
     where route_id = v_if and code = 'INN';

    update public.roadmap_criteria set
      title = 'Viable',
      description = 'A realistic, fundable plan: financial projections, source of funds, and a founder with the skills and experience to deliver it.'
     where route_id = v_if and code = 'VIA';

    update public.roadmap_criteria set
      title = 'Scalable',
      description = 'Evidence of structured growth: go-to-market, UK job creation, and expansion into national and international markets.'
     where route_id = v_if and code = 'SCA';

    -- ── 3. The missing fourth test ────────────────────────────────────────
    -- The endorsing body must be satisfied the applicant IS the founder or key
    -- person and will run the business day to day. That is judged separately
    -- from the idea itself, so it gets its own criterion instead of hiding
    -- inside "Viable".
    if not exists (select 1 from public.roadmap_criteria where route_id = v_if and code = 'ROLE') then
      insert into public.roadmap_criteria (workspace_id, route_id, code, kind, title, description, sort_order)
      values (ws.id, v_if, 'ROLE', 'mandatory', 'Founder role & day-to-day',
              'Proof the applicant is genuinely the founder or a key person, holds a meaningful stake, and will run the business day to day rather than being a passive investor.', 4);
    end if;

    select id into v_inn  from public.roadmap_criteria where route_id = v_if and code = 'INN';
    select id into v_via  from public.roadmap_criteria where route_id = v_if and code = 'VIA';
    select id into v_sca  from public.roadmap_criteria where route_id = v_if and code = 'SCA';
    select id into v_role from public.roadmap_criteria where route_id = v_if and code = 'ROLE';

    -- ── 4. Retire the earlier IFV guesses so the list is not doubled up ───
    update public.roadmap_activities set active = false
     where workspace_id = ws.id
       and criterion_id in (v_inn, v_via, v_sca)
       and title in ('Business plan — innovation section','Competitor and IP analysis',
                     'Founder capability evidence','Financial model','Job creation plan',
                     'Market expansion plan','Market research pack','Product demo and MVP evidence',
                     'Full business plan draft','Funding and runway evidence','Founder CV and track record',
                     'UK hiring plan by role and year','International expansion plan');

    -- ── 5. The real IFV library ───────────────────────────────────────────
    insert into public.roadmap_activities (workspace_id, criterion_id, visa, title, detail, priority, sort_order)
    select ws.id, x.crit, 'ifv', x.t, x.d, x.p, x.o
      from (values
        -- INNOVATIVE
        (v_inn,  'Business idea document',        'Write up the idea in full: the problem, the solution, and what makes it original.', 'ESSENTIAL', 100),
        (v_inn,  'Innovation / USP evidence',     'Evidence what is genuinely new — the differentiator a competitor cannot simply copy.', 'ESSENTIAL', 101),
        (v_inn,  'Market research',               'Size the market and prove the need with credible data, not assertion.', 'ESSENTIAL', 102),
        (v_inn,  'Competitor analysis',           'Map direct and indirect competitors and show where this business wins.', 'ESSENTIAL', 103),
        (v_inn,  'IP, patents or proprietary tech','Filings, trademarks, or proprietary technology that protect the advantage.', 'GOOD TO HAVE', 104),
        -- VIABLE
        (v_via,  'Detailed business plan',        'The full plan in the endorsing body''s expected structure.', 'ESSENTIAL', 105),
        (v_via,  'Financial projections',         'Three-year projections: revenue, costs, headcount, margins and assumptions.', 'ESSENTIAL', 106),
        (v_via,  'Funding & source of funds',     'Where the money comes from, with statements or investment agreements proving it is available and lawful.', 'ESSENTIAL', 107),
        (v_via,  'Founder skills & experience',   'Map the founder''s background directly onto what the plan requires them to do.', 'ESSENTIAL', 108),
        (v_via,  'Costing and pricing model',     'Unit economics: what it costs to deliver and what customers pay.', 'IMPORTANT', 109),
        -- SCALABLE
        (v_sca,  'Go-to-market plan',             'How the first customers are won: channels, pricing, sales motion, timeline.', 'ESSENTIAL', 110),
        (v_sca,  'UK job creation plan',          'Roles, timing and salary bands for the UK hires this business will make.', 'ESSENTIAL', 111),
        (v_sca,  'Growth & expansion plan',       'The route from UK launch to national and then international markets.', 'ESSENTIAL', 112),
        (v_sca,  'Traction evidence',             'Existing proof the business works: website, users, customers, revenue, pilots, letters of intent.', 'IMPORTANT', 113),
        (v_sca,  'Partnerships & contracts',      'Signed partnerships, supplier or distribution agreements that support the growth case.', 'GOOD TO HAVE', 114),
        -- FOUNDER ROLE
        (v_role, 'Proof of founder role',         'Incorporation documents, shareholding and director appointment showing the applicant is the founder or key person.', 'ESSENTIAL', 115),
        (v_role, 'Day-to-day involvement plan',   'A statement of the applicant''s operational role and time commitment — running the business, not funding it.', 'ESSENTIAL', 116),
        (v_role, 'Team & org structure',          'Who else is involved, their roles, and where the applicant sits.', 'IMPORTANT', 117)
      ) as x(crit, t, d, p, o)
     where x.crit is not null
       and not exists (select 1 from public.roadmap_activities a
                        where a.workspace_id = ws.id and a.title = x.t and a.active);

    -- ── 6. IFV general work (admin, not tied to one test) ─────────────────
    insert into public.roadmap_activities (workspace_id, criterion_id, visa, title, detail, priority, sort_order)
    select ws.id, null, 'ifv', x.t, x.d, x.p, x.o
      from (values
        ('Passport & personal details',   'Collect passport, current visa status and personal details for the application.', 'ESSENTIAL', 120),
        ('Updated CV / founder profile',  'A founder-framed CV: what they have built, not a job-hunting CV.', 'ESSENTIAL', 121),
        ('Endorsing body selection',      'Choose the endorsing body, confirm fees and book the assessment slot.', 'ESSENTIAL', 122),
        ('Pitch deck',                    'A concise deck for the endorsement interview.', 'IMPORTANT', 123),
        ('Endorsement interview prep',    'Rehearse the innovation, viability, scalability and founder-role questions.', 'ESSENTIAL', 124),
        ('Final application pack',        'Assemble every document and run the submission checklist.', 'ESSENTIAL', 125)
      ) as x(t, d, p, o)
     where not exists (select 1 from public.roadmap_activities a
                        where a.workspace_id = ws.id and a.title = x.t and a.active);
  end loop;
end $seed$;

notify pgrst, 'reload schema';

-- IFV should now read as a founder plan, with no GTV work anywhere in it.
select coalesce(c.code, 'GENERAL') as criterion,
       coalesce(c.title, 'Admin / whole plan') as name,
       a.title as activity, a.priority
  from public.roadmap_activities a
  left join public.roadmap_criteria c on c.id = a.criterion_id
  left join public.roadmap_routes  r on r.id = c.route_id
 where a.active
   and (r.name = 'Innovator Founder' or (a.criterion_id is null and a.visa = 'ifv'))
 order by c.sort_order nulls last, a.sort_order;
