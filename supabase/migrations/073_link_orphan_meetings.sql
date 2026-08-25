-- ============================================================================
-- 073 — Rescue call notes stranded on meetings that were never linked to a lead.
--
-- 072 mirrored every meeting note onto its lead. But a meeting only carries a
-- lead_id if the booking form matched one AT THE MOMENT OF BOOKING, on an exact
-- email or an exactly-equal phone string. Three common cases miss:
--
--   * the lead was created in the CRM AFTER the call was booked
--   * the client booked with a different email than the one on their lead
--   * the phone matched in substance but not as text — "+91 92174 28262"
--     against "9217428262" is not an equality match
--
-- Those meetings still hold real call notes, and 072 left them where they were.
-- This migration matches them up on email (case-insensitive) and on phone
-- (last 10 digits, so formatting and country prefixes stop mattering), sets the
-- meeting's lead_id, and mirrors the note the same way 072 does.
--
-- AMBIGUITY IS NOT RESOLVED, IT IS SKIPPED.
-- If a meeting matches more than one lead, nothing is linked. Guessing would
-- attach one client's call notes to another client's record, and on a client
-- CRM that is a worse outcome than a note nobody moved. Skipped rows are listed
-- at the bottom so they can be linked by hand.
-- ============================================================================

-- Last 10 digits of a phone number, for matching across formats.
-- NULL for anything under 7 digits: a lead whose phone field holds "0", "-" or
-- some other placeholder must not match another lead holding the same junk.
create or replace function public.phone_key(p text)
returns text language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 7
      then right(regexp_replace(p, '\D', '', 'g'), 10)
    else null
  end
$$;

do $link$
declare linked int := 0;
begin
  -- ── 1. Unambiguous EMAIL match ────────────────────────────────────────────
  with candidate as (
    select m.id as meeting_id,
           (select l.id from public.leads l
             where l.workspace_id = m.workspace_id
               and lower(btrim(l.email)) = lower(btrim(m.client_email))
             limit 2) as lead_id,
           (select count(*) from public.leads l
             where l.workspace_id = m.workspace_id
               and lower(btrim(l.email)) = lower(btrim(m.client_email))) as matches
      from public.meetings m
     where m.lead_id is null
       and btrim(coalesce(m.client_email, '')) <> ''
  )
  update public.meetings m
     set lead_id = c.lead_id
    from candidate c
   where m.id = c.meeting_id and c.matches = 1;
  get diagnostics linked = row_count;
  raise notice 'linked by email: %', linked;

  -- ── 2. Unambiguous PHONE match, for whatever is still unlinked ────────────
  with candidate as (
    select m.id as meeting_id,
           (select l.id from public.leads l
             where l.workspace_id = m.workspace_id
               and public.phone_key(l.phone) = public.phone_key(m.client_phone)
             limit 2) as lead_id,
           (select count(*) from public.leads l
             where l.workspace_id = m.workspace_id
               and public.phone_key(l.phone) = public.phone_key(m.client_phone)) as matches
      from public.meetings m
     where m.lead_id is null
       and public.phone_key(m.client_phone) is not null
  )
  update public.meetings m
     set lead_id = c.lead_id
    from candidate c
   where m.id = c.meeting_id and c.matches = 1;
  get diagnostics linked = row_count;
  raise notice 'linked by phone: %', linked;
end $link$;

-- ── 3. Mirror the notes of everything newly linked (same rule as 072) ───────
insert into public.notes (lead_id, workspace_id, body, author_id, meeting_id, created_at)
select m.lead_id, m.workspace_id, btrim(m.notes), null, m.id,
       coalesce(m.updated_at, m.created_at, now())
  from public.meetings m
 where m.lead_id is not null
   and btrim(coalesce(m.notes, '')) <> ''
   and not exists (select 1 from public.notes n where n.meeting_id = m.id);

-- ── 4. Refresh each lead's "last note" so the rescued notes show up in the
--      leads table, daily tracker, CSV export, search and the AI context ────
update public.leads l
   set last_note           = x.body,
       last_note_at        = x.created_at,
       last_note_author_id = x.author_id
  from (
    select distinct on (n.lead_id) n.lead_id, n.body, n.created_at, n.author_id
      from public.notes n
     order by n.lead_id, n.created_at desc
  ) x
 where l.id = x.lead_id
   and (l.last_note is distinct from x.body or l.last_note_at is distinct from x.created_at);

notify pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
select
  (select count(*) from public.notes where meeting_id is not null)          as notes_now_on_leads,
  (select count(*) from public.meetings
    where lead_id is not null and btrim(coalesce(notes,'')) <> ''
      and not exists (select 1 from public.notes n where n.meeting_id = meetings.id)) as still_unmirrored,
  (select count(*) from public.meetings
    where lead_id is null and btrim(coalesce(notes,'')) <> '')              as notes_still_unlinked;

-- Anything left here needs a human: either no lead exists for that person yet,
-- or more than one lead matched and the migration refused to guess. Open the
-- meeting, check who it is, and link or create the lead by hand.
select m.starts_at, m.client_name, m.client_email, m.client_phone,
       left(btrim(m.notes), 90) as note_preview,
       case
         when (select count(*) from public.leads l
                where l.workspace_id = m.workspace_id
                  and (lower(btrim(l.email)) = lower(btrim(m.client_email))
                    or public.phone_key(l.phone) = public.phone_key(m.client_phone))) > 1
           then 'AMBIGUOUS — more than one lead matches'
         else 'NO MATCHING LEAD'
       end as why
  from public.meetings m
 where m.lead_id is null
   and btrim(coalesce(m.notes, '')) <> ''
 order by m.starts_at desc;
