-- ============================================================================
-- 050: AD-FORM INTAKE
--
-- The Meta form now asks two qualifying questions — field of expertise, and
-- whether the person is willing to pay for professional guidance. Make was
-- already sending both; the CRM had nowhere to put them, so both were parsed
-- and dropped on the floor.
--
-- Every answer is stored twice, deliberately:
--
--   DERIVED   leads.industry              'tech' | 'research' | 'art' | ...
--             leads.investment_readiness  'yes'  | 'maybe'    | 'no'
--             Clean enums. Queue filters, sequence audiences, reports and
--             anything built later read THESE, never the free text.
--
--   RAW       leads.intake  jsonb — the answer exactly as the person gave it.
--             A mapping mistake can never destroy the original, the caller sees
--             the real words, and a new form question lands here with no
--             migration at all.
--
-- industry already exists (002) and already has a chip in the UI, so expertise
-- reuses it rather than adding a second nearly-identical column.
--
-- Safe to run repeatedly.
-- ============================================================================

alter table public.leads
  add column if not exists investment_readiness text,
  add column if not exists intake jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_investment_readiness_check') then
    alter table public.leads add constraint leads_investment_readiness_check
      check (investment_readiness is null or investment_readiness in ('yes','maybe','no'));
  end if;
end
$$;

comment on column public.leads.investment_readiness is
  'Derived from the ad form. yes | maybe | no. NULL means never asked, which is not the same as no.';
comment on column public.leads.intake is
  'Raw ad-form answers, verbatim. Source of truth when a mapping is wrong.';


-- ── Indexes the automation will want ────────────────────────────────────────
-- Partial, because most leads predate the form and carry NULL.
create index if not exists idx_leads_readiness
  on public.leads (workspace_id, investment_readiness)
  where investment_readiness is not null;

create index if not exists idx_leads_industry
  on public.leads (workspace_id, industry)
  where industry is not null;

-- The combination a caller queue would actually sort on: reachable, willing,
-- newest first.
create index if not exists idx_leads_qualified_recent
  on public.leads (workspace_id, investment_readiness, created_at desc)
  where investment_readiness in ('yes','maybe');


-- ============================================================================
-- MAPPERS — the SQL mirror of lib/intake.ts.
--
-- Two copies exist for the same reason normalizePhone and
-- whatsapp_normalize_phone do: the route needs to map on write without a round
-- trip, and SQL needs to map for backfills and for any automation written as a
-- function later. Change one, change the other.
-- ============================================================================

-- Meta hands back arrays. Make sometimes flattens them, sometimes not.
create or replace function public.intake_flatten(p_raw text)
returns text language sql immutable as $fn$
  select nullif(
    btrim(regexp_replace(coalesce(p_raw, ''), '^\[\s*"?|"?\s*\]$', '', 'g')),
    ''
  );
$fn$;

-- EXPERTISE -> industry. First match wins, so the specific readings are tried
-- before the general ones: fintech reaches finance before tech claims it.
-- Returns NULL, never 'other', when nothing matches — NULL means "unreadable",
-- 'other' means "a human looked and it fits nothing".
create or replace function public.map_expertise(p_raw text)
returns text language plpgsql immutable as $fn$
declare t text := lower(coalesce(public.intake_flatten(p_raw), ''));
begin
  if t = '' then return null; end if;
  if t ~ 'fintech|finance|financial|banking|\mbank\M|investment|investor|accounting|accountant|actuar|trading' then return 'finance'; end if;
  if t ~ 'biotech|healthtech|medtech|health|medical|medicine|clinical|clinician|doctor|physician|surgeon|nurse|pharma|dental|psychiat|biomed' then return 'healthcare'; end if;
  if t ~ 'research|academi|scientist|science|scientific|\mphd\M|post.?doc|professor|fellowship|peer.?review|laborator' then return 'research'; end if;
  if t ~ '\marts?\M|artist|culture|cultural|creative|film|cinema|music|fashion|architect|photograph|theatre|theater|dance|literature|writer|author|curator' then return 'art'; end if;
  if t ~ 'education|edtech|teaching|teacher|tutor|training|pedagog|school|curriculum' then return 'education'; end if;
  if t ~ 'mechanical|civil engineer|electrical|aerospace|manufactur|hardware|robotic|automotive|structural' then return 'engineering'; end if;
  if t ~ '\mtech\M|technolog|digital|software|\mit\M|information technology|\mai\M|artificial intelligence|machine learning|\mml\M|data scien|data engineer|developer|programmer|\msaas\M|cyber|security|cloud|devops|blockchain|web3|product manag|\mux\M' then return 'tech'; end if;
  if t ~ 'business|management|marketing|\msales\M|consult|entrepreneur|founder|operations|\mhr\M|human resources|strategy|commerce|retail|logistics|supply chain' then return 'business'; end if;
  if t ~ '^other$|not listed|none of|prefer not' then return 'other'; end if;
  return null;
end;
$fn$;

-- READINESS -> yes / maybe / no.
--
-- Three tiers, and the order is the whole trick.
--
-- An unambiguous refusal goes first, because "I cannot afford it" and "I have
-- no budget" both contain words that also appear in hesitation, and those are
-- settled answers, not wavering ones.
--
-- MAYBE goes second, ahead of the looser NO patterns, because "not sure" and
-- "not right now" both contain "not". Read those as a refusal and you retire a
-- lead who was only hesitating. On a paid ad form hesitation is the biggest of
-- the three groups and by far the most worth calling, so it gets first claim on
-- the ambiguous wording.
create or replace function public.map_readiness(p_raw text)
returns text language plpgsql immutable as $fn$
declare t text := lower(coalesce(public.intake_flatten(p_raw), ''));
begin
  if t = '' then return null; end if;
  if t ~ 'not willing|not interested|not looking|unwilling|can.?t afford|cannot afford|no budget|do not want|don.t want|never|without pay' then return 'no'; end if;
  if t ~ 'maybe|depend|not sure|unsure|perhaps|possibly|not right now|not now|need more|more info|more detail|budget|afford|think about|thinking|consider|explore|discuss|know more|tell me more' then return 'maybe'; end if;
  if t ~ '^no\M|^nope' then return 'no'; end if;
  if t ~ '\myes\M|willing|ready|prepared to|happy to|absolutely|definitely|of course|sure|certainly|interested|open to|will invest|can invest|agree' then return 'yes'; end if;
  return null;
end;
$fn$;

grant execute on function public.intake_flatten(text)  to authenticated, service_role;
grant execute on function public.map_expertise(text)   to authenticated, service_role;
grant execute on function public.map_readiness(text)   to authenticated, service_role;


-- ── Backfill ────────────────────────────────────────────────────────────────
-- Re-derives both fields from whatever raw answers are already in intake. Run
-- it after changing a mapper above; the raw text is never touched, so this is
-- always safe and always repeatable.
create or replace function public.intake_rederive(p_workspace_id uuid default null)
returns table (updated_industry int, updated_readiness int)
language plpgsql security definer set search_path = public as $fn$
declare v_ind int := 0; v_rdy int := 0;
begin
  with t as (
    update public.leads l
       set industry = public.map_expertise(l.intake->>'expertise')
     where (p_workspace_id is null or l.workspace_id = p_workspace_id)
       and l.intake ? 'expertise'
       and l.industry is distinct from public.map_expertise(l.intake->>'expertise')
       and public.map_expertise(l.intake->>'expertise') is not null
    returning 1)
  select count(*)::int into v_ind from t;

  with t as (
    update public.leads l
       set investment_readiness = public.map_readiness(l.intake->>'investment_readiness')
     where (p_workspace_id is null or l.workspace_id = p_workspace_id)
       and l.intake ? 'investment_readiness'
       and l.investment_readiness is distinct from public.map_readiness(l.intake->>'investment_readiness')
    returning 1)
  select count(*)::int into v_rdy from t;

  updated_industry := v_ind; updated_readiness := v_rdy; return next;
end;
$fn$;
grant execute on function public.intake_rederive(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ── Verification ────────────────────────────────────────────────────────────
-- The mappers, against the wording people actually type.
select answer, public.map_readiness(answer) as reads_as
from (values
  ('["Yes"]'), ('Yes, I am willing to invest'), ('No'),
  ('Not sure yet'), ('Maybe, depends on the cost'), ('I want to know more first')
) v(answer);

select answer, public.map_expertise(answer) as reads_as
from (values
  ('["Technology / Digital"]'), ('Research & Academia'), ('Arts and Culture'),
  ('Fintech'), ('Business / Management'), ('Something else entirely')
) v(answer);

select coalesce(investment_readiness, 'not asked') as readiness, count(*)
  from public.leads group by 1 order by 2 desc;
