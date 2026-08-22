-- ============================================================================
-- 069 — THE FOUNDER'S CORRECTIONS: real GTV criteria + full Innovator Founder.
--
-- Shailen corrected the meaning of every Digital Technology criterion:
--
--   MC   Third-party recognition of the CANDIDATE — media publications, awards,
--        high salary / significant increments, promotions, industry recognition.
--   OC1  Innovation — the track record of innovation in digital technology
--        (what 067 wrongly put under MC).
--   OC2  Recognition of work BEYOND the candidate's occupation — open source,
--        mentoring, judging, community leadership, talks.
--   OC3  Commercial contribution — revenue, growth, product or GTM impact.
--   OC4  Academic contribution — papers, articles, publications, research.
--
-- This migration REWRITES the Digital Technology criteria to those definitions
-- (deliberately unconditional: the previous wording was wrong, and the person
-- who owns the wording asked for this), retires the mis-mapped seeded
-- activities, and seeds a correct, fuller library for both GTV and the
-- Innovator Founder route — end to end, so switching a lead's route lights up
-- a complete set of assets on either side.
--
-- Anything the team added by hand (titles not in the seed lists) is untouched.
-- Safe to run twice: updates match on route+code, inserts are guarded by title.
-- ============================================================================

do $fix$
declare
  ws record; v_dt uuid; v_if uuid;
  v_mc uuid; v_oc1 uuid; v_oc2 uuid; v_oc3 uuid; v_oc4 uuid;
  v_inn uuid; v_via uuid; v_sca uuid;
begin
  for ws in select id from public.workspaces loop

  -- ════ DIGITAL TECHNOLOGY — corrected meanings ═════════════════════════════
  select id into v_dt from public.roadmap_routes
   where workspace_id = ws.id and name = 'Digital Technology';
  if v_dt is not null then

    update public.roadmap_criteria set
      title = 'Third-party recognition',
      description = 'Recognition of the candidate from outside their employer: media publications and press features, industry awards, a high salary or significant increments, promotions and other independent proof that the industry rates them.'
    where route_id = v_dt and code = 'MC';

    update public.roadmap_criteria set
      title = 'Innovation',
      description = 'A proven track record of innovation in the digital technology sector — as a founder, senior executive or employee working on a new digital field, product or concept.'
    where route_id = v_dt and code = 'OC1';

    update public.roadmap_criteria set
      title = 'Work beyond the occupation',
      description = 'Recognition for work outside the candidate''s day job that advances the field: open-source contributions, mentoring, judging, community leadership, talks and volunteering expertise.'
    where route_id = v_dt and code = 'OC2';

    update public.roadmap_criteria set
      title = 'Commercial contribution',
      description = 'Significant commercial or entrepreneurial contribution: revenue impact, user or product growth, go-to-market results, partnerships — with numbers and credible sources.'
    where route_id = v_dt and code = 'OC3';

    update public.roadmap_criteria set
      title = 'Academic contribution',
      description = 'Contribution through research and writing: papers, journal or industry articles, technical publications — endorsed or recognised by experts in the field.'
    where route_id = v_dt and code = 'OC4';

    select id into v_mc  from public.roadmap_criteria where route_id = v_dt and code = 'MC';
    select id into v_oc1 from public.roadmap_criteria where route_id = v_dt and code = 'OC1';
    select id into v_oc2 from public.roadmap_criteria where route_id = v_dt and code = 'OC2';
    select id into v_oc3 from public.roadmap_criteria where route_id = v_dt and code = 'OC3';
    select id into v_oc4 from public.roadmap_criteria where route_id = v_dt and code = 'OC4';

    -- The 067 activities were mapped to the WRONG criteria (e.g. awards under
    -- OC1). Retire exactly those seeded rows; hand-added ones are untouched.
    update public.roadmap_activities set active = false
     where workspace_id = ws.id
       and title in ('Award nomination','Press or media feature','Speaking opportunity',
                     'Product or launch evidence','Growth and traction metrics',
                     'Technical publication','Mentoring or judging','Research or citation record')
       and criterion_id in (v_mc, v_oc1, v_oc2, v_oc3, v_oc4);

    -- Correctly mapped GTV library. Guarded per title, so re-runs and renames
    -- never duplicate.
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order)
    select ws.id, x.crit, x.t, x.d, x.p, x.o
      from (values
        -- MC — third-party recognition of the candidate
        (v_mc,  'Media and press features',        'Secure coverage of the candidate in recognised media or industry publications.', 'ESSENTIAL', 50),
        (v_mc,  'Industry award submission',       'Identify credible awards and prepare nominations for the candidate.',            'ESSENTIAL', 51),
        (v_mc,  'Salary and promotion evidence',   'Assemble increment letters, appraisal history and promotion records showing high remuneration for the market.', 'IMPORTANT', 52),
        (v_mc,  'Expert recognition letters',      'Letters from senior industry figures recognising the candidate''s standing.',    'IMPORTANT', 53),
        -- OC1 — innovation
        (v_oc1, 'Innovation narrative and product evidence', 'Document the new product, platform or concept the candidate drove — architecture, launch, what was genuinely new.', 'ESSENTIAL', 54),
        (v_oc1, 'Patent or IP evidence',           'Collect patents, filings or proprietary work that proves innovation.',           'IMPORTANT', 55),
        -- OC2 — beyond the occupation
        (v_oc2, 'Open-source contributions',       'Evidence meaningful contributions to open-source projects with reach.',          'IMPORTANT', 56),
        (v_oc2, 'Mentoring and judging',           'Mentor at accelerators, judge hackathons or review for programmes — and evidence it.', 'IMPORTANT', 57),
        (v_oc2, 'Talks, panels and podcasts',      'Confirm speaking appearances that advance the field beyond the day job.',        'IMPORTANT', 58),
        -- OC3 — commercial contribution
        (v_oc3, 'Commercial impact pack',          'Revenue, user growth and adoption metrics tied to the candidate''s work, with credible sources.', 'ESSENTIAL', 59),
        (v_oc3, 'Partnerships and GTM evidence',   'Deals, launches or go-to-market results the candidate led.',                     'IMPORTANT', 60),
        -- OC4 — academic contribution
        (v_oc4, 'Technical paper or journal article', 'Publish or evidence a paper, journal piece or substantial technical article.', 'IMPORTANT', 61),
        (v_oc4, 'Industry articles and citations', 'Collect published articles, citations and expert endorsements of the research.', 'GOOD TO HAVE', 62)
      ) as x(crit, t, d, p, o)
     where x.crit is not null
       and not exists (select 1 from public.roadmap_activities a
                        where a.workspace_id = ws.id and a.title = x.t);
  end if;

  -- ════ INNOVATOR FOUNDER — end to end ══════════════════════════════════════
  select id into v_if from public.roadmap_routes
   where workspace_id = ws.id and name = 'Innovator Founder';
  if v_if is not null then
    select id into v_inn from public.roadmap_criteria where route_id = v_if and code = 'INN';
    select id into v_via from public.roadmap_criteria where route_id = v_if and code = 'VIA';
    select id into v_sca from public.roadmap_criteria where route_id = v_if and code = 'SCA';

    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order)
    select ws.id, x.crit, x.t, x.d, x.p, x.o
      from (values
        (v_inn, 'Market research pack',            'Evidence the market need the business answers, with data.',                      'ESSENTIAL', 70),
        (v_inn, 'Product demo and MVP evidence',   'Show the working product or prototype and what makes it new.',                   'IMPORTANT', 71),
        (v_via, 'Full business plan draft',        'Draft the complete plan in the endorsing body''s expected structure.',           'ESSENTIAL', 72),
        (v_via, 'Funding and runway evidence',     'Bank statements, investment or committed funds proving the plan is resourced.',  'ESSENTIAL', 73),
        (v_via, 'Founder CV and track record',     'Present the founder''s skills and history mapped to what the plan demands.',     'IMPORTANT', 74),
        (v_sca, 'UK hiring plan by role and year', 'Set out job creation with roles, timing and salary bands.',                      'ESSENTIAL', 75),
        (v_sca, 'International expansion plan',    'The path from UK launch to national and international markets.',                 'IMPORTANT', 76)
      ) as x(crit, t, d, p, o)
     where x.crit is not null
       and not exists (select 1 from public.roadmap_activities a
                        where a.workspace_id = ws.id and a.title = x.t);

    -- General IFV work that belongs to the plan, not one criterion.
    insert into public.roadmap_activities (workspace_id, criterion_id, title, detail, priority, sort_order)
    select ws.id, null, x.t, x.d, x.p, x.o
      from (values
        ('Endorsing body selection',      'Choose the endorsing body, confirm fees and book the initial slot.',            'ESSENTIAL', 77),
        ('Pitch deck',                    'A concise deck for the endorsing body interview.',                              'IMPORTANT', 78),
        ('Endorsement interview prep',    'Rehearse the interview: innovation, viability and scalability questions.',      'ESSENTIAL', 79),
        ('Letters of support',            'Secure letters from partners, customers or investors backing the plan.',        'GOOD TO HAVE', 80)
      ) as x(t, d, p, o)
     where not exists (select 1 from public.roadmap_activities a
                        where a.workspace_id = ws.id and a.title = x.t);
  end if;

  end loop;
end $fix$;

notify pgrst, 'reload schema';

-- Every criterion with its corrected meaning and its activity count.
select rt.name as route, c.code, c.title,
       (select count(*) from public.roadmap_activities a
         where a.criterion_id = c.id and a.active) as activities
  from public.roadmap_criteria c
  join public.roadmap_routes rt on rt.id = c.route_id
 where rt.name in ('Digital Technology','Innovator Founder')
 group by rt.name, c.code, c.title, c.id, c.sort_order
 order by rt.name, c.sort_order;
