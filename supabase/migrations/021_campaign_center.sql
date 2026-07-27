-- ============================================================================
-- 021: CAMPAIGN CENTER — access control + seeded GTV template library
--
--   • Campaigns become SUPER-ADMIN ONLY. The super admin is the workspace
--     owner (workspaces.owner_id). He can grant access to other members via
--     campaign_access; until he does, nobody else can see or send campaigns.
--   • Nine ready-made Global Talent Visa nurture templates (4 cold, 5 hot)
--     are seeded into the existing email_templates table. Every one opens by
--     saying clearly that this is about the UK Global Talent Visa.
--     Templates hold ONLY the content; the branded shell (logo, signature,
--     CTA, unsubscribe) is applied by the system at send time, so every email
--     looks identical in format no matter who edits the words.
-- ============================================================================

-- ── Access grants ───────────────────────────────────────────────────────────
create table if not exists public.campaign_access (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null,
  granted_by   uuid,
  created_at   timestamptz default now(),
  primary key (workspace_id, user_id)
);

alter table public.campaign_access enable row level security;

-- Who is a campaign admin? The owner, always; plus anyone granted.
create or replace function public.is_campaign_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = p_workspace_id and w.owner_id = auth.uid()
  ) or exists (
    select 1 from public.campaign_access a
     where a.workspace_id = p_workspace_id and a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_campaign_admin(uuid) to authenticated;

-- Only the OWNER manages grants (not even granted admins can re-grant).
drop policy if exists "owner manages access" on public.campaign_access;
create policy "owner manages access" on public.campaign_access for all to authenticated
  using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid()))
  with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid()));

drop policy if exists "admins read access" on public.campaign_access;
create policy "admins read access" on public.campaign_access for select to authenticated
  using (public.is_campaign_admin(workspace_id));

-- ── Tighten campaign tables to campaign admins ──────────────────────────────
drop policy if exists "ws campaigns" on public.campaigns;
create policy "ws campaigns" on public.campaigns for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "ws campaign recipients" on public.campaign_recipients;
drop policy if exists "ws recipients" on public.campaign_recipients;
create policy "ws recipients" on public.campaign_recipients for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "ws email templates" on public.email_templates;
drop policy if exists "ws templates" on public.email_templates;
create policy "ws templates" on public.email_templates for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

-- Suppressions stay workspace-wide (the unsubscribe route writes them), but
-- reading the list in the UI is a campaign-admin activity.
drop policy if exists "ws suppressions" on public.email_suppressions;
create policy "ws suppressions" on public.email_suppressions for select to authenticated
  using (public.is_campaign_admin(workspace_id));

-- Category column so the library can group Cold / Hot / Custom.
alter table public.email_templates add column if not exists category text default 'custom';
alter table public.email_templates add column if not exists sort int default 100;
alter table public.email_templates add column if not exists is_seeded boolean default false;

-- ── Seed the nine GTV templates ─────────────────────────────────────────────
-- Idempotent: called from the Campaigns page; inserts only if that workspace
-- has no seeded templates yet. Re-running never duplicates or overwrites edits.
create or replace function public.seed_campaign_templates(p_workspace_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.is_campaign_admin(p_workspace_id) then
    return 0;
  end if;

  select count(*) into n from public.email_templates
   where workspace_id = p_workspace_id and is_seeded;
  if n > 0 then return 0; end if;

  insert into public.email_templates (workspace_id, name, track, category, sort, is_seeded, subject, html) values

  -- ════ COLD 1 ════
  (p_workspace_id, 'Cold 1: The reopener', 'GTV Cold', 'cold', 1, true,
   'Still thinking about the UK Global Talent Visa?',
   '<p>Hi {{name}},</p>' ||
   '<p>I''m writing about the <b>UK Global Talent Visa</b>. You enquired with us at Migrizo about this route some time ago.</p>' ||
   '<p>I''m going back through older enquiries and wanted to ask you one thing: is the UK still on your mind, or has the plan changed?</p>' ||
   '<p>Either answer is useful. If it''s changed, just tell me and I''ll close your file. No more emails from us.</p>' ||
   '<p>If it hasn''t, reply and I''ll tell you honestly whether your profile is close.</p>'),

  -- ════ COLD 2 ════
  (p_workspace_id, 'Cold 2: Two refusal mistakes', 'GTV Cold', 'cold', 2, true,
   'The 2 things that get Global Talent Visa applications refused',
   '<p>Hi {{name}},</p>' ||
   '<p>Quick note about the <b>UK Global Talent Visa</b>. There''s no ask in this one, just the two reasons we most often see strong applicants refused.</p>' ||
   '<p><b>1. Evidence that describes the role instead of the impact.</b> "Led a team of 12" tells an assessor nothing. "Cut processing time by 40%, adopted across three markets" is evidence. Most people submit the first kind without realising.</p>' ||
   '<p><b>2. Starting too late.</b> Recommendation letters, published work and speaking slots take three to six months to arrange properly. Most applicants start building evidence in the month they want to apply, and that single mistake sinks more good profiles than weak achievements do.</p>' ||
   '<p>If you''re aiming for this year, the work starts now rather than in six months.</p>' ||
   '<p>Happy to point you at what matters for your profile specifically. Just reply, or grab a slot below.</p>'),

  -- ════ COLD 3 ════
  (p_workspace_id, 'Cold 3: Client story', 'GTV Cold', 'cold', 3, true,
   'He was sure he wasn''t eligible for the Global Talent Visa',
   '<p>Hi {{name}},</p>' ||
   '<p>A quick story about the <b>UK Global Talent Visa</b> that might sound familiar.</p>' ||
   '<p>[CLIENT_FIRST_NAME] came to us [TIMEFRAME] ago convinced he wasn''t eligible. [ONE LINE ON HIS PROFILE, e.g. senior engineer, no publications, no awards, no speaking history.]</p>' ||
   '<p>What was missing wasn''t achievement. It was <b>evidence</b> of achievement.</p>' ||
   '<p>[WHAT WE DID, e.g. mapped his work against the criteria, arranged three recommendation letters from people who had seen his impact, and got two pieces of his writing published.]</p>' ||
   '<p><b>Endorsed in [X] weeks.</b></p>' ||
   '<p>Most people we speak to are closer than they believe. If you want a straight answer on where you stand, book a call below and I''ll look at your profile properly.</p>'),

  -- ════ COLD 4 ════
  (p_workspace_id, 'Cold 4: Should I close your file?', 'GTV Cold', 'cold', 4, true,
   'Should I close your Global Talent Visa file?',
   '<p>Hi {{name}},</p>' ||
   '<p>I''ve sent a few notes about the <b>UK Global Talent Visa</b> and haven''t heard back, which usually means the timing is wrong or the plan has changed. Both are completely fine.</p>' ||
   '<p>This is my last email. Reply with a single word and I''ll act on it today:</p>' ||
   '<p><b>Later</b>, and I''ll check back in six months, nothing before that.<br/>' ||
   '<b>Close</b>, and I''ll delete your file. You won''t hear from us again.<br/>' ||
   '<b>Yes</b>, and I''ll call you this week.</p>' ||
   '<p>Thank you either way.</p>'),

  -- ════ HOT 1 ════
  (p_workspace_id, 'Hot 1: What happens next', 'GTV Hot', 'hot', 11, true,
   'What happens next with your Global Talent Visa',
   '<p>Hi {{name}},</p>' ||
   '<p>Good speaking with you about the <b>UK Global Talent Visa</b>. Here''s the whole process written down, so nothing comes as a surprise.</p>' ||
   '<p><b>1. Evidence review.</b> We map what you already have against the criteria and identify the gaps. [X days]</p>' ||
   '<p><b>2. Building the evidence.</b> Recommendation letters, published work, anything missing. [X weeks. This is the longest stage by far.]</p>' ||
   '<p><b>3. Endorsement.</b> The application itself. [X weeks for a decision.]</p>' ||
   '<p><b>4. Visa.</b> Straightforward once you''re endorsed. [X weeks]</p>' ||
   '<p>Stage two is where applications are won and lost, and it''s the part you can begin today, regardless of when you plan to apply.</p>' ||
   '<p>If there''s anything you want covered, reply or book a slot below.</p>'),

  -- ════ HOT 2 ════
  (p_workspace_id, 'Hot 2: Costs and timing', 'GTV Hot', 'hot', 12, true,
   'Global Talent Visa costs and timing, explained plainly',
   '<p>Hi {{name}},</p>' ||
   '<p>As promised, here is the full picture on your <b>UK Global Talent Visa</b>, with no small print.</p>' ||
   '<p><b>Our fee:</b> [AMOUNT], [PAYMENT STRUCTURE].<br/>' ||
   '<b>Government fees:</b> [AMOUNT], paid directly to the Home Office rather than to us.<br/>' ||
   '<b>Typical timeline:</b> [X] weeks from start to visa in hand.</p>' ||
   '<p><b>Included:</b> [LIST]<br/><b>Not included:</b> [LIST]</p>' ||
   '<p>Two things worth saying plainly. Endorsement is decided on evidence, not fees. Nobody can buy a decision, and anyone who implies otherwise isn''t worth listening to. And every month of delay pushes your settlement date back by exactly the same month.</p>' ||
   '<p>Happy to walk through any of it. Book a time below.</p>'),

  -- ════ HOT 3 ════
  (p_workspace_id, 'Hot 3: Someone with your profile', 'GTV Hot', 'hot', 13, true,
   'A Global Talent Visa case worth telling you about',
   '<p>Hi {{name}},</p>' ||
   '<p>When we spoke about your <b>UK Global Talent Visa</b> plans, you mentioned [THEIR SPECIFIC CONCERN]. It''s worth telling you about [CLIENT_FIRST_NAME].</p>' ||
   '<p>[PROFILE, chosen to resemble this lead as closely as possible.]</p>' ||
   '<p>[THE SAME DOUBT THEY RAISED, AND WHY IT FELT REAL AT THE TIME.]</p>' ||
   '<p>[WHAT WE DID ABOUT IT.] [THE OUTCOME AND HOW LONG IT TOOK.]</p>' ||
   '<p>The pattern we see constantly: people underestimate the evidence they already have and overestimate what the criteria actually demand.</p>' ||
   '<p>If you''d like a proper written gap analysis of your profile, book a slot below and I''ll put it together.</p>'),

  -- ════ HOT 4 ════
  (p_workspace_id, 'Hot 4: Anything blocking you?', 'GTV Hot', 'hot', 14, true,
   'Anything blocking your Global Talent Visa?',
   '<p>Hi {{name}},</p>' ||
   '<p>We spoke about the <b>UK Global Talent Visa</b> a couple of weeks ago and things have gone quiet, which in my experience means one of four things.</p>' ||
   '<p>The cost. The timing. You''re not sure you''d qualify. Or life simply got busy.</p>' ||
   '<p>Whichever it is, tell me and I''ll give you a straight answer, including telling you <i>not</i> to apply if that''s the honest one. I''d rather lose the work than take money from someone who isn''t ready.</p>' ||
   '<p>The only outcome I''d avoid is drifting. Evidence takes months to build, so a decision delayed is a start date delayed, and the settlement clock doesn''t begin until you arrive.</p>' ||
   '<p>Reply with a word or two, or book a quick call below.</p>'),

  -- ════ HOT 5 ════
  (p_workspace_id, 'Hot 5: Leaving it with you', 'GTV Hot', 'hot', 15, true,
   'Leaving your Global Talent Visa file with you',
   '<p>Hi {{name}},</p>' ||
   '<p>Last note from me on your <b>UK Global Talent Visa</b>.</p>' ||
   '<p>Your file is still open and everything we discussed still stands. If you want to pick it up, reply and we''ll start exactly where we left off. Nothing needs repeating.</p>' ||
   '<p>If not, no hard feelings at all. I''ll stop emailing, and you can come back whenever the timing is right. We''re not going anywhere.</p>' ||
   '<p>One honest thought before I go: the people who get endorsed are rarely the most impressive on paper. They''re the ones who started building evidence before they felt ready.</p>' ||
   '<p>Whenever that is for you, you know where I am.</p>');

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.seed_campaign_templates(uuid) to authenticated;

-- ── Re-seed after edits to the library above ────────────────────────────────
-- Running this file again refreshes the seeded library: all nine seeded
-- templates are removed and the page re-seeds the current wording on next
-- open. Custom templates (is_seeded = false) are never touched.
delete from public.email_templates where is_seeded;
