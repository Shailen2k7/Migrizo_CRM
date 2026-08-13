-- =============================================================================
-- 059_fix_expertise_mapping.sql — "ENGINEERING" NOW MEANS ENGINEERING
--
-- THE BUG, precisely: the ad form's own option is the bare word "Engineering",
-- and the expertise mapper only knew sub-disciplines (mechanical, civil
-- engineer, electrical, …). A lead who picked Tech, Research or Arts mapped
-- fine; a lead who picked Engineering fell through EVERY rule and arrived with
-- industry NULL — "Not set" in the drawer. Hence "works for some leads, not
-- others". Same gap existed in lib/intake.ts (fixed in the same pack).
--
-- Order note: the tech-flavoured engineer titles (software/data/ML engineer…)
-- are claimed by a tech rule placed BEFORE the general engineering bucket, so
-- widening "engineer" cannot steal a software engineer from tech.
--
-- Then intake_rederive() re-reads every lead's SAVED raw answers with the new
-- rules — the double-storage design (raw + derived) exists precisely so a
-- mapper bug is repairable after the fact. Untagged Engineering leads get
-- their tag back retroactively, and the campaign audience picks them up on
-- the next 10-minute sweep. Safe to run twice.
-- =============================================================================

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
  -- software-flavoured engineers are TECH, decided before the general bucket
  if t ~ 'software engineer|data engineer|ml engineer|ai engineer|devops engineer|cloud engineer|platform engineer|qa engineer|front.?end|back.?end|full.?stack' then return 'tech'; end if;
  -- THE FIX: \mengineer catches the bare form option "Engineering"
  if t ~ '\mengineer|mechanical|civil|electrical|aerospace|manufactur|hardware|robotic|automotive|structural' then return 'engineering'; end if;
  if t ~ '\mtech\M|technolog|digital|software|\mit\M|information technology|\mai\M|artificial intelligence|machine learning|\mml\M|data scien|developer|programmer|\msaas\M|cyber|security|cloud|devops|blockchain|web3|product manag|\mux\M' then return 'tech'; end if;
  if t ~ 'business|management|marketing|\msales\M|consult|entrepreneur|founder|operations|\mhr\M|human resources|strategy|commerce|retail|logistics|supply chain' then return 'business'; end if;
  if t ~ '^other$|not listed|none of|prefer not' then return 'other'; end if;
  return null;
end;
$fn$;

-- Repair the past: every lead whose saved raw answer now maps gets its tag.
select * from public.intake_rederive();

notify pgrst, 'reload schema';

-- ── Verification: the exact wordings from the ad form ────────────────────────
select v.answer, public.map_expertise(v.answer) as maps_to
  from (values ('Engineering'), ('Tech'), ('Research & Academia'),
               ('Arts and Culture'), ('Software Engineer'), ('Other')) v(answer);
