-- ============================================================================
-- 070 — A route belongs to a VISA. Innovator Founder is not a GTV route.
--
-- THE MISTAKE THIS FIXES
-- 067 put all four routes in one flat list, so a lead already marked IFV was
-- still shown Digital Technology, Arts and Academia as if they were choices.
-- They are not. The hierarchy is:
--
--   Global Talent Visa (GTV)          Innovator Founder Visa (IFV)
--     ├─ Digital Technology             └─ Innovator Founder
--     ├─ Arts and Culture
--     └─ Academia and Research
--
-- GTV has disciplines you choose between. IFV has none — it is one route, and
-- an IFV applicant is never choosing between it and "Arts and Culture".
--
-- The lead's visa_type already records which visa they are on, so the builder
-- can now show only that visa's routes: three disciplines for a GTV client, and
-- for an IFV client no picker at all — just their route, locked.
-- ============================================================================

alter table public.roadmap_routes
  add column if not exists visa text not null default 'gtv';

do $$ begin
  alter table public.roadmap_routes
    add constraint roadmap_routes_visa_chk check (visa in ('gtv','ifv'));
exception when duplicate_object then null; end $$;

comment on column public.roadmap_routes.visa is
  'Which visa this route belongs to, matching leads.visa_type. GTV has several disciplines; IFV is a single route.';

-- Innovator Founder is the IFV route; everything else seeded so far is GTV.
update public.roadmap_routes set visa = 'ifv' where name ilike '%innovator%';
update public.roadmap_routes set visa = 'gtv' where name not ilike '%innovator%';

create index if not exists idx_rm_routes_visa
  on public.roadmap_routes (workspace_id, visa, sort_order);

notify pgrst, 'reload schema';

select visa,
       count(*)                       as routes,
       string_agg(name, ', ' order by sort_order) as which
  from public.roadmap_routes
 group by visa
 order by visa;
