-- ============================================================================
-- 027: REWRITE THE GTV EMAIL LIBRARY
--
-- Three things this fixes, across all 14 emails:
--
--   1. PLACEHOLDERS. Several emails still shipped with [CLIENT_FIRST_NAME],
--      [X weeks], [AMOUNT], [LIST] and so on. Every one is now filled with
--      real detail, so each email is ready to read with nothing to edit.
--
--   2. DASHES. Every em dash and en dash is gone. Ordinary sentences instead.
--
--   3. CONTRACTIONS. Full words throughout. "I have" not "I've", "do not"
--      not "don't", "it is" not "it's".
--
-- Client story used (Cold 3 and Hot 3): Himanshu Tomar, senior software
-- engineer, came a few months ago believing he had no publications and no
-- awards. Work done: mapped his existing achievements against the criteria,
-- and got two pieces of his writing published. Endorsed a little over two
-- months later.
--
-- Fees stated (Hot 2): Migrizo fee 3,000 pounds across four stages
-- (500 / 1,250 / 500 / 750). Home Office: 561 endorsement + 205 visa = 766,
-- plus Immigration Health Surcharge at 1,035 per adult per year.
--
-- This UPDATES existing templates in place and INSERTS any that are missing,
-- so it works whether or not migrations 021 and 026 have already run.
-- Safe to run repeatedly. Custom templates you wrote yourself are untouched.
-- ============================================================================

create or replace function public.refresh_gtv_templates(p_workspace_id uuid)
returns int
language plpgsql security definer set search_path = public as $fn$
declare r record; n int := 0;
begin
  for r in
    select * from (values

    -- ══════════════════════════ COLD ══════════════════════════

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
     '<p><b>What takes time is the evidence.</b> Recommendation letters from the right people, published work, proof of impact outside your own company. Done properly, that is six to eight weeks of focused building.</p>' ||
     '<p>So the honest picture from start to finish is roughly <b>three to five months</b>, from beginning the work to holding the visa. Anyone promising faster is skipping the part that decides the outcome.</p>' ||
     '<p>If you want to know what your own timeline would look like, reply or book a call using the link below.</p>'),

    ('Cold 6: What it opens up', 'GTV Cold', 'cold', 6,
     'What the Global Talent Visa actually gives you',
     '<p>Hi {{name}},</p>' ||
     '<p>People research the <b>UK Global Talent Visa</b> for months without ever listing what it actually gives you. Here it is, plainly.</p>' ||
     '<p><b>No employer.</b> You are not tied to a sponsor. Change jobs, freelance, or start a company on day one, without asking anyone.</p>' ||
     '<p><b>No minimum salary.</b> There is no income threshold to keep, unlike the Skilled Worker route.</p>' ||
     '<p><b>Family included.</b> Your partner and children come with you, and your partner can work freely.</p>' ||
     '<p><b>Settlement in three years</b> on the Exceptional Talent track, one of the fastest routes to permanent residence the UK offers.</p>' ||
     '<p>It is the most independent visa the UK has. If that is the version of the UK you want, reply and I will tell you honestly how close your profile is.</p>'),

    -- ══════════════════════════ HOT ══════════════════════════

    ('Hot 1: What happens next', 'GTV Hot', 'hot', 11,
     'What happens next with your Global Talent Visa',
     '<p>Hi {{name}},</p>' ||
     '<p>Good speaking with you about the <b>UK Global Talent Visa</b>. Here is the whole process written down, so nothing comes as a surprise.</p>' ||
     '<p><b>1. Evidence review.</b> We map what you already have against the criteria and identify the gaps. Three to five days.</p>' ||
     '<p><b>2. Building the evidence.</b> Recommendation letters, published work, anything missing. Six to eight weeks, and this is the longest stage by far.</p>' ||
     '<p><b>3. Endorsement.</b> The application itself. Four to eight weeks for a decision.</p>' ||
     '<p><b>4. Visa.</b> Straightforward once you are endorsed. Two to three weeks.</p>' ||
     '<p>Stage two is where applications are won and lost, and it is the part you can begin today, regardless of when you plan to apply.</p>' ||
     '<p>If there is anything you want covered, reply or book a slot using the link below.</p>'),

    ('Hot 2: Costs and timing', 'GTV Hot', 'hot', 12,
     'The full cost of your Global Talent Visa, with nothing hidden',
     '<p>Hi {{name}},</p>' ||
     '<p>As promised, the full picture on your <b>UK Global Talent Visa</b>, with no small print.</p>' ||
     '<p><b>Our fee is 3,000 pounds</b>, paid in four stages as the work happens. 500 to begin, 1,250 for building the profile and evidence, 500 when the endorsement application goes in, and 750 once you are approved. You are never paying ahead of the work.</p>' ||
     '<p><b>Government fees are separate</b> and go directly to the Home Office rather than to us. Endorsement is 561 pounds and the visa itself is 205, so 766 in total. On top of that sits the Immigration Health Surcharge at 1,035 pounds per adult per year, paid upfront for the full length of the visa. For one person on a five year visa that comes to roughly 5,941 pounds including the surcharge. These figures are set by the government and can change.</p>' ||
     '<p><b>Typical timeline</b> is three to five months from starting to holding the visa.</p>' ||
     '<p><b>What our fee includes:</b> the full evidence review, mapping your profile against the criteria, building and structuring your evidence pack, drafting and coordinating your recommendation letters, getting your writing published where it helps, and preparing and submitting the endorsement application.</p>' ||
     '<p><b>What it does not include:</b> the government fees above, the health surcharge, document translation, and any travel or biometrics appointment costs.</p>' ||
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

    -- ═══════════════════════ RE-ENGAGEMENT ═══════════════════════

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
     '<p><b>The route is unchanged where it counts.</b> No sponsor, no salary threshold, settlement in three years on the talent track.</p>' ||
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
    update public.email_templates
       set subject    = r.subject,
           html       = r.html,
           track      = r.track,
           category   = r.category,
           sort       = r.sort::int,
           is_seeded  = true,
           updated_at = now()
     where workspace_id = p_workspace_id and name = r.name;

    if not found then
      insert into public.email_templates
        (workspace_id, name, track, category, sort, is_seeded, subject, html)
      values
        (p_workspace_id, r.name, r.track, r.category, r.sort::int, true, r.subject, r.html);
    end if;

    n := n + 1;
  end loop;

  return n;
end;
$fn$;

grant execute on function public.refresh_gtv_templates(uuid) to authenticated;

-- Apply immediately to every workspace, so nothing extra needs doing.
do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform public.refresh_gtv_templates(w.id);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Confirmation: should be 14 seeded templates, and zero placeholders left.
select count(*) filter (where is_seeded)                      as seeded_templates,
       count(*) filter (where html like '%[%]%' and is_seeded) as still_has_placeholders
  from public.email_templates;
