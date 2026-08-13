-- =============================================================================
-- 060_fix_option_slugs.sql — META SENDS SLUGS, NOT LABELS
--
-- THE BUG (the real one behind "tech_" showing but Industry staying unset):
--   When a Meta form option has no separate label, Meta sends the OPTION SLUG —
--   "tech_", "art_", "arts_culture", "not_sure". Underscore is a WORD character
--   in both JS and Postgres regex, so:
--
--     '\mtech\M'  does NOT match 'tech_'   → industry stayed NULL
--     '\marts?\M' does NOT match 'art_'    → industry stayed NULL
--
--   'research_' and 'engineering_' happened to work, because those rules use a
--   bare substring with no closing word boundary. That is the whole reason it
--   "worked for some leads and not others" — it was never about the lead, it
--   was about which rule happened to end in a boundary.
--
-- THE SECOND BUG, worse and silent:
--   'not_sure' skipped the MAYBE rule (which reads 'not sure', with a space)
--   and was then caught by 'sure' inside the YES rule. An undecided lead was
--   being tagged WILLING TO PAY — straight into the hot lane.
--
-- THE FIX: read a slug as the words it stands for. Underscores, hyphens and
-- plus signs become spaces before matching. The RAW answer in leads.intake is
-- untouched — the drawer still shows exactly what Meta sent.
--
-- Then intake_rederive() repairs every lead already stored this way.
-- Safe to run twice.
-- =============================================================================

-- ── EXPERTISE ───────────────────────────────────────────────────────────────
create or replace function public.map_expertise(p_raw text)
returns text language plpgsql immutable as $fn$
declare
  -- slug → words, so 'tech_' reads as 'tech' and 'arts_culture' as 'arts culture'
  t text := btrim(regexp_replace(
              regexp_replace(lower(coalesce(public.intake_flatten(p_raw), '')), '[_+-]+', ' ', 'g'),
              '\s+', ' ', 'g'));
begin
  if t = '' then return null; end if;
  if t ~ 'fintech|finance|financial|banking|\mbank\M|investment|investor|accounting|accountant|actuar|trading' then return 'finance'; end if;
  if t ~ 'biotech|healthtech|medtech|health|medical|medicine|clinical|clinician|doctor|physician|surgeon|nurse|pharma|dental|psychiat|biomed' then return 'healthcare'; end if;
  if t ~ 'research|academi|scientist|science|scientific|\mphd\M|post.?doc|professor|fellowship|peer.?review|laborator' then return 'research'; end if;
  if t ~ '\marts?\M|artist|culture|cultural|creative|film|cinema|music|fashion|architect|photograph|theatre|theater|dance|literature|writer|author|curator' then return 'art'; end if;
  if t ~ 'education|edtech|teaching|teacher|tutor|training|pedagog|school|curriculum' then return 'education'; end if;
  if t ~ 'software engineer|data engineer|ml engineer|ai engineer|devops engineer|cloud engineer|platform engineer|qa engineer|front.?end|back.?end|full.?stack' then return 'tech'; end if;
  if t ~ '\mengineer|mechanical|civil|electrical|aerospace|manufactur|hardware|robotic|automotive|structural' then return 'engineering'; end if;
  if t ~ '\mtech\M|technolog|digital|software|\mit\M|information technology|\mai\M|artificial intelligence|machine learning|\mml\M|data scien|developer|programmer|\msaas\M|cyber|security|cloud|devops|blockchain|web3|product manag|\mux\M' then return 'tech'; end if;
  if t ~ 'business|management|marketing|\msales\M|consult|entrepreneur|founder|operations|\mhr\M|human resources|strategy|commerce|retail|logistics|supply chain' then return 'business'; end if;
  if t ~ '^other$|not listed|none of|prefer not' then return 'other'; end if;
  return null;
end;
$fn$;

-- ── READINESS ───────────────────────────────────────────────────────────────
create or replace function public.map_readiness(p_raw text)
returns text language plpgsql immutable as $fn$
declare
  t text := btrim(regexp_replace(
              regexp_replace(lower(coalesce(public.intake_flatten(p_raw), '')), '[_+-]+', ' ', 'g'),
              '\s+', ' ', 'g'));
begin
  if t = '' then return null; end if;
  if t ~ 'not willing|not interested|not looking|unwilling|can.?t afford|cannot afford|no budget|do not want|don.t want|never|without pay' then return 'no'; end if;
  if t ~ 'maybe|depend|not sure|unsure|perhaps|possibly|not right now|not now|need more|more info|more detail|budget|afford|think about|thinking|consider|explore|discuss|know more|tell me more' then return 'maybe'; end if;
  if t ~ '^no\M|^nope' then return 'no'; end if;
  if t ~ '\myes\M|willing|ready|prepared to|happy to|absolutely|definitely|of course|sure|certainly|interested|open to|will invest|can invest|agree' then return 'yes'; end if;
  return null;
end;
$fn$;

-- ── REPAIR THE PAST ─────────────────────────────────────────────────────────
-- Every lead whose stored raw answer now maps gets its tag, retroactively.
-- The campaign audience sweep picks them up within 10 minutes.
select * from public.intake_rederive();

notify pgrst, 'reload schema';

-- ── Verification: the slugs Meta actually sends ─────────────────────────────
select v.answer,
       public.map_expertise(v.answer) as industry,
       public.map_readiness(v.answer) as readiness
  from (values ('tech_'), ('art_'), ('arts_culture'), ('research_academia'),
               ('engineering_'), ('business_management'),
               ('yes'), ('no'), ('maybe'), ('not_sure')) v(answer);
