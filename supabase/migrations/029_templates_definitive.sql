-- ============================================================================
-- 029: THE DEFINITIVE EMAIL FIX
--
-- WHAT WENT WRONG
--
-- The database holds duplicate seeded templates from an older seed. Migration
-- 027 matched templates by name, so it rewrote one copy while your sequences
-- pointed at a different copy. Worse, 027 had a "last resort" rule that
-- DELETED [PLACEHOLDER] text when it could not match a template by name. That
-- is why the email arrived reading "Our fee:." with nothing after it. The
-- placeholders were not filled, they were stripped. That rule is gone.
--
-- WHAT THIS DOES
--
--   1. Picks ONE canonical template per slot, preferring whichever one your
--      sequences actually point at.
--   2. Writes the real content into it.
--   3. Repoints every sequence step at the canonical row.
--   4. Deletes the duplicates, but only AFTER repointing, because
--      sequence_steps cascades on delete and would otherwise lose the step.
--   5. Never blanks anything. If content is missing the migration fails
--      loudly instead of quietly emptying an email.
--
-- All figures come from the Migrizo GTV document: fixed 3,000 pound fee
-- across four milestones, government and third party costs, and all in
-- totals of 7,500 for three years and 9,500 for five.
--
-- Safe to run repeatedly.
-- ============================================================================


-- Remove the destructive function from 027 so it can never run again.
drop function if exists public.refresh_gtv_templates(uuid);


create or replace function public.install_gtv_templates(p_workspace_id uuid)
returns table (canonical int, duplicates_removed int, steps_repointed int)
language plpgsql security definer set search_path = public as $fn$
declare
  r record; v_id uuid; v_can int := 0; v_dup int := 0; v_rep int := 0; c int;
begin
  for r in
    select * from (values

    ('Cold 1: The reopener', 'GTV Cold', 'cold', 1,
     'Still thinking about the UK Global Talent Visa?',
     '<p>Hi {{name}},</p>' ||
     '<p>I am writing about the <b>UK Global Talent Visa</b>. You enquired with us at Migrizo about this route some time ago.</p>' ||
     '<p>I am going back through older enquiries and wanted to ask you one thing. Is the UK still on your mind, or has the plan changed?</p>' ||
     '<p>Either answer is useful. If it has changed, just tell me and I will close your file. No more emails from us.</p>' ||
     '<p>If it has not, reply and I will tell you honestly whether your profile is close.</p>'),

    ('Cold 2: Two refusal mistakes', 'GTV Cold', 'cold', 2,
     'The 2 things that get Global Talent Visa applications refused',
     '<p>Hi {{name}},</p>' ||
     '<p>Quick note about the <b>UK Global Talent Visa</b>. There is no ask in this one, just the two reasons we most often see strong applicants refused.</p>' ||
     '<p><b>1. Evidence that describes the role instead of the impact.</b> "Led a team of 12" tells an assessor nothing. "Cut processing time by 40 percent, adopted across three markets" is evidence. Most people submit the first kind without realising.</p>' ||
     '<p><b>2. Starting too late.</b> Recommendation letters, published work and speaking slots take three to six months to arrange properly. Most applicants start building evidence in the month they want to apply, and that single mistake sinks more good profiles than weak achievements do.</p>' ||
     '<p>If you are aiming for this year, the work starts now rather than in six months.</p>' ||
     '<p>Happy to point you at what matters for your profile specifically. Just reply, or book a call using the link below.</p>'),

    ('Cold 3: Client story', 'GTV Cold', 'cold', 3,
     'He was sure he was not eligible for the Global Talent Visa',
     '<p>Hi {{name}},</p>' ||
     '<p>A quick story about the <b>UK Global Talent Visa</b> that might sound familiar.</p>' ||
     '<p>Himanshu came to us a few months ago convinced he was not eligible. He is a senior software engineer with no publications and no awards, and he had decided that settled the question before we had even spoken properly.</p>' ||
     '<p>What was missing was not achievement. It was <b>evidence</b> of achievement.</p>' ||
     '<p>We went through his work in detail and mapped it against what the endorsing body actually asks for. Then we got two pieces of his writing published, so there was something on the record outside his own company.</p>' ||
     '<p><b>He was endorsed a little over two months later.</b></p>' ||
     '<p>Most people we speak to are closer than they believe. If you want a straight answer on where you stand, book a call using the link below and I will look at your profile properly.</p>'),

    ('Cold 4: Should I close your file?', 'GTV Cold', 'cold', 4,
     'Should I close your Global Talent Visa file?',
     '<p>Hi {{name}},</p>' ||
     '<p>I have sent a few notes about the <b>UK Global Talent Visa</b> and have not heard back, which usually means the timing is wrong or the plan has changed. Both are completely fine.</p>' ||
     '<p>This is my last email. Reply with a single word and I will act on it today.</p>' ||
     '<p><b>Later</b>, and I will check back in six months, nothing before that.<br/>' ||
     '<b>Close</b>, and I will delete your file. You will not hear from us again.<br/>' ||
     '<b>Yes</b>, and I will call you this week.</p>' ||
     '<p>Thank you either way.</p>'),

    ('Cold 5: The real timeline', 'GTV Cold', 'cold', 5,
     'How long the Global Talent Visa really takes',
     '<p>Hi {{name}},</p>' ||
     '<p>One more useful thing about the <b>UK Global Talent Visa</b>, because almost everyone we speak to gets this wrong.</p>' ||
     '<p>The visa itself is fast. Endorsement decisions typically come back in four to eight weeks, and the visa after that in two to three.</p>' ||
     '<p><b>What takes time is the evidence.</b> Three recommendation letters from the right people, published work, proof of impact outside your own company. Done properly, that is six to eight weeks of focused building.</p>' ||
     '<p>So the honest picture from start to finish is roughly <b>three to five months</b>, from beginning the work to holding the visa. Anyone promising faster is skipping the part that decides the outcome.</p>' ||
     '<p>If you want to know what your own timeline would look like, reply or book a call using the link below.</p>'),

    ('Cold 6: What it opens up', 'GTV Cold', 'cold', 6,
     'What the Global Talent Visa actually gives you',
     '<p>Hi {{name}},</p>' ||
     '<p>People research the <b>UK Global Talent Visa</b> for months without ever listing what it actually gives you. Here it is, plainly.</p>' ||
     '<p><b>No job offer and no sponsor.</b> You are not tied to an employer. Change jobs, freelance, or start a company on day one, without asking anyone.</p>' ||
     '<p><b>No minimum salary.</b> There is no income threshold to keep, unlike the Skilled Worker route.</p>' ||
     '<p><b>Family included.</b> Your partner and children come with you from day one, and your partner can work freely.</p>' ||
     '<p><b>Settlement in three to five years</b>, then British citizenship. It is one of the fastest routes to permanent residence the UK offers.</p>' ||
     '<p>It is the most independent visa the UK has. If that is the version of the UK you want, reply and I will tell you honestly how close your profile is.</p>'),

    ('Hot 1: What happens next', 'GTV Hot', 'hot', 11,
     'What happens next with your Global Talent Visa',
     '<p>Hi {{name}},</p>' ||
     '<p>Good speaking with you about the <b>UK Global Talent Visa</b>. Here is exactly how we work, start to finish, so nothing comes as a surprise.</p>' ||
     '<p><b>1. Profile evaluation.</b> We map your profile to the right endorsing body and give you an honest assessment of where you stand. Three to five days.</p>' ||
     '<p><b>2. Personalised roadmap.</b> A step by step plan with clear milestones, timelines and a documentation checklist.</p>' ||
     '<p><b>3. Profile building.</b> UK style CV, LinkedIn, personal statement, PR coordination and UK visibility.</p>' ||
     '<p><b>4. Supporting documents.</b> Your three recommendation letters, which we draft and structure for you, and a criteria mapped evidence portfolio. Six to eight weeks, and this is the longest stage by far.</p>' ||
     '<p><b>5. Endorsement submission.</b> Full preparation, evidence compilation and liaison with the endorsing body. Four to eight weeks for a decision.</p>' ||
     '<p><b>6. Visa application.</b> UKVI filing, the health surcharge, and applications for your spouse and children. Two to three weeks.</p>' ||
     '<p><b>7. Post landing support.</b> Your UK network built before you arrive, National Insurance number, work setup and ILR planning.</p>' ||
     '<p>Stage four is where applications are won and lost, and it is the part you can begin today, regardless of when you plan to apply.</p>' ||
     '<p>If there is anything you want covered, reply or book a slot using the link below.</p>'),

    ('Hot 2: Costs and timing', 'GTV Hot', 'hot', 12,
     'The full cost of your Global Talent Visa, with nothing hidden',
     '<p>Hi {{name}},</p>' ||
     '<p>As promised, the full picture on your <b>UK Global Talent Visa</b>, with no small print.</p>' ||
     '<p><b>Our professional fee is 3,000 pounds.</b> It is fixed, and you pay it across four milestones as the work happens.</p>' ||
     '<p>500 to kickstart<br/>' ||
     '1,250 for profile building<br/>' ||
     '500 at endorsement submission<br/>' ||
     '750 final payment once you are approved</p>' ||
     '<p>You are never paying ahead of the work, and there are no hidden charges.</p>' ||
     '<p><b>Separately there are costs you pay directly</b> to the relevant authority rather than to us.</p>' ||
     '<p>Profile building through a PR agency, around 500 pounds<br/>' ||
     'UK endorsement fee, 561 pounds<br/>' ||
     'Visa fee, 210 pounds<br/>' ||
     'Immigration Health Surcharge, 1,035 pounds per person per year, paid upfront for the full length of the visa</p>' ||
     '<p>Those come to roughly 4,000 pounds for a single applicant.</p>' ||
     '<p><b>All in, including our fee, a realistic total is around 7,500 pounds for a three year visa and around 9,500 pounds for a five year visa.</b> Government charges are set by the authorities and can change.</p>' ||
     '<p><b>Typical timeline</b> is three to five months from starting the work to holding the visa.</p>' ||
     '<p><b>What our fee covers:</b> profile evaluation and eligibility, your personalised roadmap, UK style CV, LinkedIn and personal statement, drafting and structuring your three recommendation letters, building the criteria mapped evidence portfolio, full endorsement submission and liaison with the endorsing body, UKVI filing guidance including your spouse and children, and post landing support once you arrive.</p>' ||
     '<p><b>What it does not cover:</b> the government and third party costs listed above, document translation, and any travel or biometrics appointment costs.</p>' ||
     '<p>Two things worth saying plainly. Endorsement is decided on evidence, not fees. Nobody can buy a decision, and anyone who implies otherwise is not worth listening to. And every month of delay pushes your settlement date back by exactly the same month.</p>' ||
     '<p>Happy to walk through any of it. Book a time using the link below.</p>'),

    ('Hot 3: Someone with your profile', 'GTV Hot', 'hot', 13,
     'The one thing almost everyone gets wrong about their own profile',
     '<p>Hi {{name}},</p>' ||
     '<p>When we speak to people about the <b>UK Global Talent Visa</b>, one sentence comes up more than any other. My profile is not exceptional enough.</p>' ||
     '<p>It is worth telling you about Himanshu.</p>' ||
     '<p>He is a senior software engineer. No publications, no awards, no speaking history. He was certain that settled the question, and on the surface it did look that way.</p>' ||
     '<p>What we found when we went through his work properly was a body of real achievement that had simply never been written down anywhere an assessor could see it. So we mapped it against the criteria, and we got two pieces of his writing published so that the record existed outside his own company.</p>' ||
     '<p><b>He was endorsed a little over two months later.</b></p>' ||
     '<p>The pattern we see constantly is that people underestimate the evidence they already have and overestimate what the criteria actually demand.</p>' ||
     '<p>If you would like a proper written gap analysis of your profile, book a slot using the link below and I will put it together.</p>'),

    ('Hot 4: Anything blocking you?', 'GTV Hot', 'hot', 14,
     'Anything holding you back on the Global Talent Visa?',
     '<p>Hi {{name}},</p>' ||
     '<p>We spoke about the <b>UK Global Talent Visa</b> and I have not heard back, so I wanted to check whether something is sitting unresolved.</p>' ||
     '<p>In our experience it is usually one of three things. The cost, and whether it is worth it. Whether the profile is genuinely strong enough. Or simply timing, because life is busy and this is never urgent until it suddenly is.</p>' ||
     '<p>All three are fair. Tell me which one it is and I will give you a straight answer rather than a sales pitch.</p>' ||
     '<p>Reply with a word or two, or book a quick call using the link below.</p>'),

    ('Hot 5: Leaving it with you', 'GTV Hot', 'hot', 15,
     'Leaving your Global Talent Visa with you',
     '<p>Hi {{name}},</p>' ||
     '<p>This is my last note about the <b>UK Global Talent Visa</b>.</p>' ||
     '<p>I am not going to keep chasing. You know what the route offers, roughly what it costs, and how long it takes. If it is right for you, you will know.</p>' ||
     '<p>One thing worth remembering. The evidence stage is the long one, and it is the part that decides the outcome. Whenever you do start, that is where the months go.</p>' ||
     '<p>If you want to pick this up later, whether that is in three months or next year, write to me directly and we will start from wherever you are then.</p>' ||
     '<p>Wishing you well either way.</p>'),

    ('RE 1: Six months later', 'GTV Re-engage', 'reengagement', 21,
     'Is the UK back on the table?',
     '<p>Hi {{name}},</p>' ||
     '<p>A while back you looked into the <b>UK Global Talent Visa</b> with us at Migrizo, and the timing was not right. I said I would leave you alone, and I did.</p>' ||
     '<p>I am writing once more because things change. A new role, new plans, a partner''s job, a child''s schooling. If the UK is back on the table, your profile has probably grown since we last spoke, and it may be closer than it was.</p>' ||
     '<p>If it is still a no, ignore this and you will hear from me only one more time, briefly.</p>' ||
     '<p>If it is a maybe, just reply and I will take a fresh look at where you stand.</p>'),

    ('RE 2: What changed this year', 'GTV Re-engage', 'reengagement', 22,
     'What has changed with the Global Talent Visa',
     '<p>Hi {{name}},</p>' ||
     '<p>Since you last looked at the <b>UK Global Talent Visa</b>, a few things have moved, and one of them might matter to you.</p>' ||
     '<p><b>Assessment has tightened.</b> Endorsing bodies now weigh recognition outside your own company more heavily than internal achievements, which changes what a strong evidence pack looks like.</p>' ||
     '<p><b>Timelines are steadier.</b> Endorsement decisions have been coming back reliably, so the whole journey is easier to plan around a notice period or a school year.</p>' ||
     '<p><b>The route is unchanged where it counts.</b> No job offer, no sponsor, no salary threshold, and a settlement pathway in three to five years.</p>' ||
     '<p>If any of that shifts your thinking, reply and I will tell you what it means for your profile specifically.</p>'),

    ('RE 3: The final note', 'GTV Re-engage', 'reengagement', 23,
     'Closing your Global Talent Visa file',
     '<p>Hi {{name}},</p>' ||
     '<p>This is genuinely the last email about the <b>UK Global Talent Visa</b>. I am closing your file this week.</p>' ||
     '<p>If the UK ever comes back into the picture, whether that is next year or in five, you are welcome to write to me directly and we will pick it up from wherever you are then.</p>' ||
     '<p>If now is actually the moment and this email caught you at the right time, reply with one word and I will call you this week.</p>' ||
     '<p>Either way, thank you for reading these, and good luck with whatever you are building.</p>')

    ) as t(name, track, category, sort, subject, html)
  loop
    -- Refuse to write an empty email. This is the guard that migration 027
    -- did not have.
    if r.html is null or length(r.html) < 120 or r.html ~ '\[[A-Z]' then
      raise exception 'Template "%" is incomplete or still contains a placeholder', r.name;
    end if;

    -- Choose the canonical row for this slot. Prefer whichever row a sequence
    -- step already points at, so live sequences keep working.
    select t.id into v_id
      from public.email_templates t
     where t.workspace_id = p_workspace_id
       and t.category = r.category and t.sort = r.sort::int
     order by (exists (select 1 from public.sequence_steps s where s.template_id = t.id)) desc,
              t.created_at asc
     limit 1;

    -- Fall back to a name match if the slot is empty.
    if v_id is null then
      select id into v_id from public.email_templates
       where workspace_id = p_workspace_id and name = r.name limit 1;
    end if;

    if v_id is null then
      insert into public.email_templates
        (workspace_id, name, track, category, sort, is_seeded, subject, html)
      values
        (p_workspace_id, r.name, r.track, r.category, r.sort::int, true, r.subject, r.html)
      returning id into v_id;
    else
      update public.email_templates
         set name = r.name, track = r.track, category = r.category,
             sort = r.sort::int, subject = r.subject, html = r.html,
             is_seeded = true, updated_at = now()
       where id = v_id;
    end if;
    v_can := v_can + 1;

    -- Repoint every sequence step that points at a duplicate of this slot.
    -- MUST happen before the delete: sequence_steps cascades on delete and
    -- the step would otherwise vanish.
    update public.sequence_steps s
       set template_id = v_id
     where s.workspace_id = p_workspace_id
       and s.template_id <> v_id
       and s.template_id in (
         select id from public.email_templates
          where workspace_id = p_workspace_id and is_seeded
            and category = r.category and sort = r.sort::int and id <> v_id);
    get diagnostics c = row_count; v_rep := v_rep + c;

    -- Now the duplicates are safe to remove.
    delete from public.email_templates
     where workspace_id = p_workspace_id and is_seeded
       and category = r.category and sort = r.sort::int and id <> v_id;
    get diagnostics c = row_count; v_dup := v_dup + c;
  end loop;

  -- Any other seeded leftovers that no sequence uses at all.
  delete from public.email_templates t
   where t.workspace_id = p_workspace_id and t.is_seeded
     and t.category in ('cold','hot','reengagement')
     and not exists (select 1 from public.sequence_steps s where s.template_id = t.id)
     and t.name not in (
       'Cold 1: The reopener','Cold 2: Two refusal mistakes','Cold 3: Client story',
       'Cold 4: Should I close your file?','Cold 5: The real timeline','Cold 6: What it opens up',
       'Hot 1: What happens next','Hot 2: Costs and timing','Hot 3: Someone with your profile',
       'Hot 4: Anything blocking you?','Hot 5: Leaving it with you',
       'RE 1: Six months later','RE 2: What changed this year','RE 3: The final note');
  get diagnostics c = row_count; v_dup := v_dup + c;

  canonical := v_can; duplicates_removed := v_dup; steps_repointed := v_rep;
  return next;
end;
$fn$;

grant execute on function public.install_gtv_templates(uuid) to authenticated;


-- Run it for every workspace, then clean any stray dashes or contractions.
do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform public.install_gtv_templates(w.id);
  end loop;
end $$;

update public.email_templates
   set html = public.humanize_email_copy(html),
       subject = public.humanize_email_copy(subject),
       updated_at = now()
 where is_seeded;

notify pgrst, 'reload schema';


-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- seeded_templates must be 14. Everything else must be 0.

select
  count(*) filter (where is_seeded) as seeded_templates,
  count(*) filter (where is_seeded and html ~ '\[[A-Z]') as placeholders_left,
  count(*) filter (where is_seeded and (html ~ ('[' || U&'\2014' || U&'\2013' || ']')
                                     or subject ~ ('[' || U&'\2014' || U&'\2013' || ']'))) as dashes_left,
  count(*) filter (where is_seeded and html ~* '\y(I''m|I''ve|I''ll|don''t|doesn''t|won''t|can''t|isn''t|it''s|that''s|there''s|you''re|you''ve|you''ll|we''re|we''ve|we''ll|haven''t|hasn''t|aren''t|wasn''t|didn''t|he''s|she''s|let''s|what''s)\y') as contractions_left,
  count(*) filter (where is_seeded and length(html) < 200) as suspiciously_short
from public.email_templates;

-- Every sequence step must still resolve to a real template.
select count(*) as broken_sequence_steps
  from public.sequence_steps s
 where not exists (select 1 from public.email_templates t where t.id = s.template_id);

-- Read the fee email exactly as it will send.
select subject, html from public.email_templates where category = 'hot' and sort = 12;
