-- =============================================================================
-- 051_whatsapp_automation.sql — THE NEW-LEAD JOURNEY (tag-based, final)
--
-- The flow, exactly as approved:
--
--   ① Lead arrives from the Meta ad already tagged: FIELD (leads.industry)
--      and WILLING TO PAY (leads.investment_readiness). No CV scanning.
--   ② Field is one of the 4 GTV areas (tech/research/engineering/art)?
--        YES → eligible. Also willing to pay → 🔥 PRIORITY + push a human now.
--        NO / unknown → welcome still goes, but replies are HANDED TO A HUMAN.
--   ③ Welcome = fresh_lead_01 (changeable from a dropdown in the tab).
--   ④ Eligible lead replies (reply opens the 24h window)
--        → guide + video message, then the booking-link message.
--      Any question, from anyone, any time → the Q&A brain:
--        price/complaint/ready-to-pay/guarantee → human (flag + push)
--        matches a saved Q&A → YOUR answer, word-for-word
--        casual chatter → nothing; unknown question → human (flag + push)
--   ⑤ No reply → resend the welcome at +24h and +48h. Still silent and the
--      field is eligible → enrol into the chosen COLD SEQUENCE, else stop.
--   ⑥ Meeting booked → journey, queued jobs AND running sequences all stop.
--
-- Shape: triggers only insert small job rows; a 1-minute cron drain does the
-- real work (same queue-and-drain pattern as campaigns and sequences).
-- Safe to run twice. Also safe whether or not last night's 050 draft was
-- applied — every statement checks before it changes.
-- =============================================================================


-- ── 1. SETTINGS ─────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_automation (
  workspace_id   uuid primary key references public.workspaces(id) on delete cascade,
  enabled        boolean not null default false,
  sources        text[]  not null default array['Meta Ads'],
  welcome_template_code text not null default 'fresh_lead_01',
  pdf_url        text,
  video_url      text,
  booking_url    text,
  eligible_message text not null default
'Great news, {{name}} — based on your profile, you are a strong fit for the UK Global Talent route. 🎉

Two things worth 5 minutes of your time:
📄 Our step-by-step process guide: {{pdf}}
🎥 A short video that explains how it works: {{video}}',
  booking_message text not null default
'The next step is a quick 1-on-1 call with our team to map out your case and answer your questions.

Pick a time that suits you here: {{booking}}',
  not_eligible_message text not null default '',
  auto_faq       boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Columns new in this revision (no-ops when 050-draft never ran, or when re-run).
alter table public.whatsapp_automation
  add column if not exists cold_sequence_id uuid references public.whatsapp_sequences(id) on delete set null,
  add column if not exists reminder_hours_1 int not null default 24,
  add column if not exists reminder_hours_2 int not null default 48,
  add column if not exists priority_push    boolean not null default true;

-- The welcome is fresh_lead_01 now. Only replace the old draft default — a
-- code someone chose on purpose is never overwritten.
alter table public.whatsapp_automation alter column welcome_template_code set default 'fresh_lead_01';
update public.whatsapp_automation
   set welcome_template_code = 'fresh_lead_01'
 where welcome_template_code = 'migrizo_auto_welcome';

insert into public.whatsapp_automation (workspace_id)
select id from public.workspaces
on conflict (workspace_id) do nothing;


-- ── 2. Q&A — the growing knowledge base behind auto-answers ─────────────────
create table if not exists public.whatsapp_faqs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text not null,
  keywords     text[] not null default '{}',
  answer       text not null,
  active       boolean not null default true,
  sort_order   int not null default 0,
  times_used   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists whatsapp_faqs_ws on public.whatsapp_faqs (workspace_id, active);

-- New: the example question the founder types. The AI matches an incoming
-- message against these questions; keywords are an optional extra signal.
alter table public.whatsapp_faqs add column if not exists question text not null default '';

-- Seeds. The old 050-draft seeded 4 keyword-only rows; replace any that were
-- never used or edited, then install the approved set — including the PRICE
-- answer built from the GTV brochure. Discounts and negotiation still always
-- go to a human (enforced in the drain, before any Q&A matching).
do $faq$
declare v_ws uuid;
begin
  for v_ws in select id from public.workspaces loop
    delete from public.whatsapp_faqs
     where workspace_id = v_ws and times_used = 0 and question = ''
       and title in ('Cost / fees','Timeline / how long','Am I eligible / requirements','What is Global Talent');

    if not exists (select 1 from public.whatsapp_faqs where workspace_id = v_ws) then
      insert into public.whatsapp_faqs (workspace_id, title, question, keywords, answer, sort_order) values
      (v_ws, 'Price / total cost',
        'What is the price? How much does it cost? What do I need to spend?',
        array['price','cost','fee','fees','charges','how much','spend','quote','pricing'],
E'Great question — and we keep this fully transparent 👇\n\nOur professional fee is a fixed £3,000, paid across 4 simple milestones (£500 to begin, then £1,250, £500 and £750). No hidden charges.\n\nSeparately, there are government & third-party costs you pay directly (endorsement £561, visa £210, IHS, etc.) of roughly £4,000.\n\nSo most clients budget approximately £7,500 for the 3-year visa or £9,500 for the 5-year — all-inclusive.\n\nThe best next step is a free assessment call where we map your exact route and costs: {{booking}}', 1),
      (v_ws, 'What is the Global Talent Visa',
        'What is the Global Talent Visa? How does this visa work? What is GTV?',
        array['what is global talent','global talent visa','gtv','which visa','about this visa'],
E'The UK Global Talent Visa is a prestigious route for recognised leaders (or emerging leaders) in tech, research, engineering, and arts & culture.\n\nNo job offer, no sponsorship — your talent and achievements ARE the application. You get full freedom to work, freelance or build your own venture, bring your family from day one, and a path to permanent settlement in 3–5 years. 🇬🇧\n\nOur step-by-step guide explains it all: {{pdf}}', 2),
      (v_ws, 'How long does it take',
        'How long does the process take? What is the timeline? When can I move?',
        array['how long','timeline','duration','how much time','processing time','when can i'],
E'Most Global Talent cases take a few months end-to-end — profile building is usually the longest stage, and it depends on how strong your evidence already is.\n\nOn a quick call we can give you a realistic timeline for YOUR case: {{booking}}', 3),
      (v_ws, 'What is the process / what''s included',
        'What is the process? How do you work? What is included in your service?',
        array['process','steps','how do you work','included','what do you do','procedure'],
E'We manage everything end-to-end in 7 steps: profile evaluation → personalised roadmap → profile building (CV, LinkedIn, PR) → evidence & recommendation letters → endorsement submission → visa application → post-landing support.\n\nOne fixed fee, one dedicated case manager, no hidden charges. The full breakdown is in our guide: {{pdf}}', 4);
    end if;
  end loop;
end $faq$;


-- ── 3. JOURNEYS ─────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_journeys (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  lead_id         uuid not null,
  conversation_id uuid,
  phone_e164      text not null,
  stage           text not null default 'welcome_queued',
  eligibility     jsonb,
  stop_reason     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists whatsapp_journeys_lead on public.whatsapp_journeys (workspace_id, lead_id);
create index if not exists whatsapp_journeys_conv  on public.whatsapp_journeys (conversation_id);
create index if not exists whatsapp_journeys_stage on public.whatsapp_journeys (workspace_id, stage);

-- New columns for the tag-based flow.
alter table public.whatsapp_journeys
  add column if not exists priority       boolean not null default false,
  add column if not exists field          text,     -- industry snapshot at entry
  add column if not exists readiness      text,     -- yes | maybe | no | null
  add column if not exists reminders_sent int not null default 0;

-- Stage vocabulary changed (no CV check any more). Re-issue the CHECK with the
-- full superset so legacy rows from the 050 draft stay valid.
alter table public.whatsapp_journeys drop constraint if exists whatsapp_journeys_stage_check;
alter table public.whatsapp_journeys add constraint whatsapp_journeys_stage_check check (stage in (
  'welcome_queued',   -- welcome job waiting for the drain
  'awaiting_reply',   -- welcome sent; reminders may follow
  'needs_review',     -- wrong/unknown field, or human decision needed
  'eligible',         -- assets being sent
  'waiting_booking',  -- guide + booking link delivered
  'booked',           -- meeting exists — done
  'not_eligible',     -- a human said no → Junk
  'stopped',          -- no reply after reminders / suppressed / manual
  'checking'          -- legacy value from the 050 draft, kept for old rows
));

drop trigger if exists whatsapp_journeys_touch on public.whatsapp_journeys;
create trigger whatsapp_journeys_touch before update on public.whatsapp_journeys
  for each row execute function public.whatsapp_touch();


-- ── 4. JOB QUEUE ────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_auto_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  journey_id      uuid not null references public.whatsapp_journeys(id) on delete cascade,
  kind            text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'queued' check (status in ('queued','running','done','failed','skipped')),
  attempts        int  not null default 0,
  due_at          timestamptz not null default now(),
  claimed_at      timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists whatsapp_auto_jobs_due on public.whatsapp_auto_jobs (status, due_at);
create index if not exists whatsapp_auto_jobs_journey on public.whatsapp_auto_jobs (journey_id);

-- Kinds changed: reminder + cold_enrol + notify are new, eligibility is legacy.
alter table public.whatsapp_auto_jobs drop constraint if exists whatsapp_auto_jobs_kind_check;
alter table public.whatsapp_auto_jobs add constraint whatsapp_auto_jobs_kind_check
  check (kind in ('welcome','assets','faq','reminder','cold_enrol','notify','eligibility'));

drop trigger if exists whatsapp_auto_jobs_touch on public.whatsapp_auto_jobs;
create trigger whatsapp_auto_jobs_touch before update on public.whatsapp_auto_jobs
  for each row execute function public.whatsapp_touch();


-- ── 5. WHICH FIELDS ARE ELIGIBLE — one place, used by trigger and drain ─────
create or replace function public.whatsapp_field_eligible(p_industry text)
returns boolean language sql immutable as $fn$
  -- coalesce matters: an unknown field must read as FALSE, not NULL — a NULL
  -- here would poison the priority computation and fail the lead insert.
  select coalesce(p_industry in ('tech','research','engineering','art'), false);
$fn$;


-- ── 6. TRIGGER: a new lead arrives ──────────────────────────────────────────
create or replace function public.whatsapp_auto_on_lead()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  cfg     public.whatsapp_automation%rowtype;
  v_phone text;
  v_elig  boolean;
  v_prio  boolean;
  v_jid   uuid;
begin
  select * into cfg from public.whatsapp_automation where workspace_id = new.workspace_id;
  if cfg.workspace_id is null or not cfg.enabled then return new; end if;
  if coalesce(new.is_sample, false) then return new; end if;
  if new.source is null or not (new.source = any(cfg.sources)) then return new; end if;

  v_phone := public.whatsapp_normalize_phone(new.phone);
  if v_phone is null then return new; end if;

  if exists (select 1 from public.whatsapp_suppressions s
              where s.workspace_id = new.workspace_id and s.phone_e164 = v_phone) then
    return new;
  end if;

  -- One journey per phone, ever — a duplicate submission can't double-welcome.
  if exists (select 1 from public.whatsapp_journeys jj
              where jj.workspace_id = new.workspace_id and jj.phone_e164 = v_phone
                and jj.stop_reason is distinct from 'faq_only') then
    return new;
  end if;

  v_elig := public.whatsapp_field_eligible(new.industry);
  v_prio := v_elig and new.investment_readiness = 'yes';

  insert into public.whatsapp_journeys
    (workspace_id, lead_id, phone_e164, field, readiness, priority)
  values (new.workspace_id, new.id, v_phone, new.industry, new.investment_readiness, v_prio)
  on conflict (workspace_id, lead_id) do nothing
  returning id into v_jid;
  if v_jid is null then return new; end if;

  insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind)
  values (new.workspace_id, v_jid, 'welcome');
  return new;
end;
$fn$;

drop trigger if exists whatsapp_auto_on_lead on public.leads;
create trigger whatsapp_auto_on_lead after insert on public.leads
  for each row execute function public.whatsapp_auto_on_lead();


-- ── 7. TRIGGER: they replied ────────────────────────────────────────────────
-- A reply cancels pending reminders. An ELIGIBLE lead's reply queues the
-- assets. A wrong/unknown-field lead's reply goes to a human. Every reply with
-- text also passes through the Q&A brain, which answers, escalates, or stays
-- silent — decided in the drain, never here.
create or replace function public.whatsapp_auto_on_inbound()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  j   public.whatsapp_journeys%rowtype;
  cfg public.whatsapp_automation%rowtype;
begin
  if new.direction <> 'in' then return new; end if;

  select * into cfg from public.whatsapp_automation where workspace_id = new.workspace_id;
  if cfg.workspace_id is null or not cfg.enabled then return new; end if;

  select * into j from public.whatsapp_journeys
   where workspace_id = new.workspace_id and conversation_id = new.conversation_id;
  if j.id is null then
    select jj.* into j from public.whatsapp_journeys jj
      join public.whatsapp_conversations c on c.id = new.conversation_id
     where jj.workspace_id = new.workspace_id and jj.phone_e164 = c.phone_e164
     limit 1;
    if j.id is not null and j.conversation_id is null then
      update public.whatsapp_journeys set conversation_id = new.conversation_id where id = j.id;
    end if;
  end if;

  if j.id is not null then
    -- They spoke: reminders and the cold handoff are off the table.
    update public.whatsapp_auto_jobs
       set status = 'skipped', error = 'lead_replied'
     where journey_id = j.id and status = 'queued' and kind in ('reminder','cold_enrol');

    if j.stage in ('welcome_queued','awaiting_reply') then
      if public.whatsapp_field_eligible(j.field) then
        -- Eligible by tag → guide + video + booking, no CV needed.
        update public.whatsapp_journeys set stage = 'eligible' where id = j.id;
        insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind)
        select new.workspace_id, j.id, 'assets'
         where not exists (select 1 from public.whatsapp_auto_jobs q
                            where q.journey_id = j.id and q.kind = 'assets'
                              and q.status in ('queued','running','done'));
      else
        -- Wrong or unknown field → a human looks before anything is promised.
        update public.whatsapp_journeys set stage = 'needs_review' where id = j.id;
        update public.whatsapp_conversations set needs_attention = true where id = new.conversation_id;
        insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
        select new.workspace_id, j.id, 'notify',
               jsonb_build_object('reason', 'field_review', 'conversation_id', new.conversation_id)
         where not exists (select 1 from public.whatsapp_auto_jobs q
                            where q.journey_id = j.id and q.kind = 'notify'
                              and q.payload->>'reason' = 'field_review');
      end if;
    end if;
  end if;

  -- The Q&A brain sees every text message, journey or not.
  if cfg.auto_faq and coalesce(new.body, '') <> '' then
    insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind, payload)
    select new.workspace_id,
           coalesce(j.id, public.whatsapp_auto_orphan_journey(new.workspace_id, new.conversation_id)),
           'faq',
           jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id)
     where coalesce(j.id, public.whatsapp_auto_orphan_journey(new.workspace_id, new.conversation_id)) is not null;
  end if;
  return new;
end;
$fn$;

-- Bookkeeping journey for chats that never went through the new-lead flow, so
-- Q&A jobs have a row to hang off. Lead-less chats are skipped.
create or replace function public.whatsapp_auto_orphan_journey(p_ws uuid, p_conversation uuid)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_lead uuid; v_phone text;
begin
  select id into v_id from public.whatsapp_journeys
   where workspace_id = p_ws and conversation_id = p_conversation limit 1;
  if v_id is not null then return v_id; end if;

  select lead_id, phone_e164 into v_lead, v_phone
    from public.whatsapp_conversations where id = p_conversation;
  if v_lead is null then return null; end if;

  insert into public.whatsapp_journeys (workspace_id, lead_id, conversation_id, phone_e164, stage, stop_reason)
  values (p_ws, v_lead, p_conversation, v_phone, 'stopped', 'faq_only')
  on conflict (workspace_id, lead_id) do update set conversation_id = excluded.conversation_id
  returning id into v_id;
  return v_id;
end;
$fn$;

drop trigger if exists whatsapp_auto_on_inbound on public.whatsapp_messages;
create trigger whatsapp_auto_on_inbound after insert on public.whatsapp_messages
  for each row execute function public.whatsapp_auto_on_inbound();


-- ── 8. TRIGGER: a meeting is booked → everything stops ──────────────────────
create or replace function public.whatsapp_auto_on_meeting()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_phone text;
begin
  v_phone := public.whatsapp_normalize_phone(new.client_phone);

  update public.whatsapp_journeys j
     set stage = 'booked', stop_reason = 'meeting_booked'
   where j.workspace_id = new.workspace_id
     and j.stage not in ('booked','stopped')
     and ( (new.lead_id is not null and j.lead_id = new.lead_id)
           or (v_phone is not null and j.phone_e164 = v_phone) );

  update public.whatsapp_auto_jobs q
     set status = 'skipped', error = 'meeting_booked'
   where q.status = 'queued'
     and q.journey_id in (
       select id from public.whatsapp_journeys j
        where j.workspace_id = new.workspace_id and j.stage = 'booked'
          and ( (new.lead_id is not null and j.lead_id = new.lead_id)
                or (v_phone is not null and j.phone_e164 = v_phone) ));

  if v_phone is not null then
    update public.whatsapp_sequence_enrollments e
       set status = 'stopped', stop_reason = 'meeting_booked', updated_at = now()
     where e.workspace_id = new.workspace_id
       and e.phone_e164 = v_phone and e.status in ('active','paused');
  end if;

  insert into public.activity (workspace_id, user_id, lead_id, action, meta)
  select new.workspace_id, null, new.lead_id, 'whatsapp_automation_stopped',
         jsonb_build_object('reason', 'meeting_booked', 'phone', v_phone)
   where new.lead_id is not null;
  return new;
end;
$fn$;

do $mt$
begin
  if to_regclass('public.meetings') is not null then
    drop trigger if exists whatsapp_auto_on_meeting on public.meetings;
    create trigger whatsapp_auto_on_meeting after insert on public.meetings
      for each row execute function public.whatsapp_auto_on_meeting();
  end if;
end $mt$;


-- ── 9. CLAIM / COMPLETE ─────────────────────────────────────────────────────
create or replace function public.whatsapp_auto_claim(p_workspace_id uuid, p_batch int default 10)
returns setof public.whatsapp_auto_jobs
language plpgsql security definer set search_path = public as $fn$
begin
  update public.whatsapp_auto_jobs
     set status = 'queued', claimed_at = null
   where workspace_id = p_workspace_id and status = 'running'
     and claimed_at < now() - interval '10 minutes';

  return query
  update public.whatsapp_auto_jobs q
     set status = 'running', claimed_at = now(), attempts = q.attempts + 1
   where q.id in (
     select id from public.whatsapp_auto_jobs
      where workspace_id = p_workspace_id and status = 'queued' and due_at <= now()
      order by due_at
      limit p_batch
      for update skip locked)
  returning q.*;
end;
$fn$;

create or replace function public.whatsapp_auto_complete(
  p_job_id uuid, p_ok boolean, p_error text default null, p_retry boolean default false
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_ok then
    update public.whatsapp_auto_jobs set status = 'done', error = null where id = p_job_id;
  elsif p_retry then
    update public.whatsapp_auto_jobs
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           due_at = now() + (interval '2 minutes' * attempts),
           error  = p_error
     where id = p_job_id;
  else
    update public.whatsapp_auto_jobs set status = 'failed', error = p_error where id = p_job_id;
  end if;
end;
$fn$;


-- ── 10. ONE CALL FOR THE AUTOMATION TAB ─────────────────────────────────────
create or replace function public.whatsapp_automation_overview(p_workspace_id uuid)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_build_object(
    'settings', (select to_jsonb(a) from public.whatsapp_automation a where a.workspace_id = p_workspace_id),
    'counts', (
      select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
        from (select stage, count(*) as n
                from public.whatsapp_journeys
               where workspace_id = p_workspace_id and stop_reason is distinct from 'faq_only'
               group by stage) s),
    'faqs', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.sort_order, f.created_at), '[]'::jsonb)
        from public.whatsapp_faqs f where f.workspace_id = p_workspace_id),
    'sequences', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status)
                                order by s.created_at), '[]'::jsonb)
        from public.whatsapp_sequences s where s.workspace_id = p_workspace_id),
    'journeys', (
      select coalesce(jsonb_agg(row_j order by row_j->>'updated_at' desc), '[]'::jsonb)
        from (
          select to_jsonb(j) || jsonb_build_object(
                   'lead_name', l.full_name,
                   'lead_stage', l.stage,
                   'pending_jobs', (select count(*) from public.whatsapp_auto_jobs q
                                     where q.journey_id = j.id and q.status = 'queued'))
                 as row_j
            from public.whatsapp_journeys j
            join public.leads l on l.id = j.lead_id
           where j.workspace_id = p_workspace_id
             and j.stop_reason is distinct from 'faq_only'
           order by j.updated_at desc
           limit 40) t)
  );
$fn$;


-- ── 11. HUMAN DECISION on needs_review ──────────────────────────────────────
create or replace function public.whatsapp_journey_decide(p_journey_id uuid, p_eligible boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare j public.whatsapp_journeys%rowtype;
begin
  select * into j from public.whatsapp_journeys where id = p_journey_id;
  if j.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.is_campaign_admin(j.workspace_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_campaign_admin');
  end if;
  if j.stage not in ('needs_review','awaiting_reply','checking') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_stage', 'stage', j.stage);
  end if;

  if p_eligible then
    update public.whatsapp_journeys
       set stage = 'eligible',
           eligibility = coalesce(eligibility, '{}'::jsonb) || jsonb_build_object('verdict','eligible','decided_by','human')
     where id = p_journey_id;
    insert into public.whatsapp_auto_jobs (workspace_id, journey_id, kind)
    values (j.workspace_id, p_journey_id, 'assets');
  else
    update public.whatsapp_journeys
       set stage = 'not_eligible',
           eligibility = coalesce(eligibility, '{}'::jsonb) || jsonb_build_object('verdict','not_eligible','decided_by','human')
     where id = p_journey_id;
    update public.leads set stage = 'junk', updated_at = now()
     where id = j.lead_id and stage in ('cold','hot');
  end if;

  insert into public.activity (workspace_id, user_id, lead_id, action, meta)
  values (j.workspace_id, auth.uid(), j.lead_id, 'whatsapp_journey_decided',
          jsonb_build_object('eligible', p_eligible));
  return jsonb_build_object('ok', true);
end;
$fn$;


-- ── 12. RLS ─────────────────────────────────────────────────────────────────
alter table public.whatsapp_automation enable row level security;
alter table public.whatsapp_faqs       enable row level security;
alter table public.whatsapp_journeys   enable row level security;
alter table public.whatsapp_auto_jobs  enable row level security;

drop policy if exists "wa auto read"  on public.whatsapp_automation;
create policy "wa auto read"  on public.whatsapp_automation for select to authenticated
  using (workspace_id in (select user_workspaces()));
drop policy if exists "wa auto admin" on public.whatsapp_automation;
create policy "wa auto admin" on public.whatsapp_automation for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "wa faqs read"  on public.whatsapp_faqs;
create policy "wa faqs read"  on public.whatsapp_faqs for select to authenticated
  using (workspace_id in (select user_workspaces()));
drop policy if exists "wa faqs admin" on public.whatsapp_faqs;
create policy "wa faqs admin" on public.whatsapp_faqs for all to authenticated
  using (public.is_campaign_admin(workspace_id))
  with check (public.is_campaign_admin(workspace_id));

drop policy if exists "wa journeys read" on public.whatsapp_journeys;
create policy "wa journeys read" on public.whatsapp_journeys for select to authenticated
  using (workspace_id in (select user_workspaces()));

drop policy if exists "wa jobs read" on public.whatsapp_auto_jobs;
create policy "wa jobs read" on public.whatsapp_auto_jobs for select to authenticated
  using (workspace_id in (select user_workspaces()));


-- ── 13. THE WELCOME TEMPLATE ROW ────────────────────────────────────────────
-- fresh_lead_01 is already APPROVED in Interakt/Meta. This seeds the CRM row
-- if it's missing, marked approved, with a sensible body. ⚠️ If your Interakt
-- body differs, paste the EXACT approved body in the Templates tab — the
-- variable count must match or Interakt rejects the send.
do $tpl$
declare v_ws uuid;
begin
  for v_ws in select id from public.workspaces loop
    insert into public.whatsapp_templates
      (workspace_id, code, name, track, category, language, body, variables, meta_status, active)
    values (
      v_ws, 'fresh_lead_01', 'Auto · Fresh lead welcome', 'hot', 'UTILITY', 'en',
E'Hi {{1}}, thanks for your enquiry about the UK Global Talent Visa with Migrizo. 🇬🇧\n\nTo assess your profile, our team needs two quick things:\n\n1️⃣ Your updated CV (just attach it here)\n2️⃣ Your LinkedIn profile link\n\nReply with these and we''ll personally review your profile and come back to you shortly.',
      '[{"n":"1","label":"First name"}]'::jsonb,
      'approved', true)
    on conflict (workspace_id, code) do nothing;
  end loop;
end $tpl$;


-- ── 14. GRANTS ──────────────────────────────────────────────────────────────
revoke all on function public.whatsapp_auto_claim(uuid, int) from public;
revoke all on function public.whatsapp_auto_complete(uuid, boolean, text, boolean) from public;
grant execute on function public.whatsapp_automation_overview(uuid) to authenticated;
grant execute on function public.whatsapp_journey_decide(uuid, boolean) to authenticated;
grant execute on function public.whatsapp_field_eligible(text) to authenticated, service_role;


-- ── 15. CRON ────────────────────────────────────────────────────────────────
--   * automation drain — every minute ("as soon as a lead comes in")
--   * sequences drain — every 10 minutes (the audit found it had NO cron:
--     sequences only ran when someone pressed "Run now")
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'migrizo-whatsapp-auto-drain';
    perform cron.schedule('migrizo-whatsapp-auto-drain', '* * * * *', $job$
      select net.http_post(
        url     := 'https://crm.migrizo.com/api/whatsapp/automation/drain',
        headers := '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb,
        body    := '{}'::jsonb );
    $job$);

    perform cron.unschedule(jobid) from cron.job where jobname = 'migrizo-whatsapp-seq-drain';
    perform cron.schedule('migrizo-whatsapp-seq-drain', '*/10 * * * *', $job$
      select net.http_post(
        url     := 'https://crm.migrizo.com/api/whatsapp/sequences/drain',
        headers := '{"Content-Type":"application/json","x-cron-secret":"ucQ_jD3FZcCPvY1aaxK1s0gQmLs3OtX9"}'::jsonb,
        body    := '{}'::jsonb );
    $job$);
  end if;
end $cron$;

notify pgrst, 'reload schema';

comment on table public.whatsapp_journeys is
  'One row per lead inside WhatsApp automation. Eligibility comes from the ad tag (leads.industry), not a CV scan.';
comment on table public.whatsapp_faqs is
  'The Q&A knowledge base. AI matches incoming questions to these and sends the saved answer verbatim — it never invents.';
