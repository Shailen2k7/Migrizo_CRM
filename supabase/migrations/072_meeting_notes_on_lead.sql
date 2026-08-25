-- ============================================================================
-- 072 — A meeting note IS a note on the lead.
--
-- THE PROBLEM
-- Meeting notes lived in meetings.notes and nowhere else. A consultant wrote
-- up a call — the single most valuable thing anyone records about a lead — and
-- it was invisible in the lead drawer, in the Last note column, in the daily
-- tracker and its CSV export, in search, and to the AI scoring and drafting
-- routes. Two people could work the same lead and never see each other's call
-- notes.
--
-- THE FIX
-- Every meeting note is mirrored into the lead's notes, linked back to the
-- meeting it came from. Because everything in the CRM reads notes and
-- leads.last_note, the note then shows up everywhere at once.
--
--   notes.meeting_id  NULL  → a note somebody typed in the lead drawer
--                     set   → the mirror of that meeting's note
--
-- ONE note per meeting, updated in place when the meeting note is edited, so
-- re-saving a meeting note does not spam the lead with near-duplicates. The
-- unique index below is what guarantees that, not just the app code.
-- ============================================================================

-- ── 1. Link a note to its meeting ───────────────────────────────────────────
alter table public.notes add column if not exists meeting_id uuid;

do $$ begin
  alter table public.notes
    add constraint notes_meeting_fk
    foreign key (meeting_id) references public.meetings(id) on delete cascade;
exception when duplicate_object then null; end $$;

comment on column public.notes.meeting_id is
  'When set, this note is the mirror of that meeting''s notes. NULL means a note typed directly on the lead.';

-- At most one mirrored note per meeting — editing updates, never duplicates.
create unique index if not exists idx_notes_meeting_unique
  on public.notes (meeting_id) where meeting_id is not null;

-- ── 2. RLS: a meeting note belongs to the team, not to one author ───────────
-- The existing policies only allow INSERT (author_id = auth.uid()) and DELETE
-- (own note or admin). A meeting note has to be editable by whoever edits the
-- meeting — if Prateek updates a call note Shailen first saved, the UPDATE
-- would otherwise be silently filtered to zero rows: no error, no save, the
-- exact failure mode that made the campaign toggles look like they worked.
--
-- These policies are ADDITIVE (Postgres ORs policies for the same command) and
-- are deliberately narrowed to meeting-linked rows, so hand-typed notes keep
-- their original, stricter rules.
drop policy if exists "update meeting notes in workspace" on public.notes;
create policy "update meeting notes in workspace" on public.notes
  for update
  using      (workspace_id in (select public.user_workspaces()) and meeting_id is not null)
  with check (workspace_id in (select public.user_workspaces()) and meeting_id is not null);

drop policy if exists "delete meeting notes in workspace" on public.notes;
create policy "delete meeting notes in workspace" on public.notes
  for delete
  using (workspace_id in (select public.user_workspaces()) and meeting_id is not null);

-- ── 3. Backfill every meeting note written so far ───────────────────────────
-- author_id is left NULL: we do not know who typed a note that predates this
-- migration, and inventing an author on a client record is worse than leaving
-- it blank. The UI shows these as "Meeting note".
insert into public.notes (lead_id, workspace_id, body, author_id, meeting_id, created_at)
select m.lead_id, m.workspace_id, btrim(m.notes), null, m.id,
       coalesce(m.updated_at, m.created_at, now())
  from public.meetings m
 where m.lead_id is not null
   and btrim(coalesce(m.notes, '')) <> ''
   and not exists (select 1 from public.notes n where n.meeting_id = m.id);

-- ── 4. Refresh each lead's "last note" so the mirror shows up in the leads
--      table, daily tracker, CSV export, search and the AI context ──────────
-- Recomputed from the notes table itself rather than from meetings, so a lead
-- whose newest note is a typed one keeps that one.
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
-- Every meeting that has a note and a linked lead should now have exactly one
-- mirrored note. "unmirrored" must be 0.
select
  (select count(*) from public.meetings
    where lead_id is not null and btrim(coalesce(notes,'')) <> '')            as meeting_notes,
  (select count(*) from public.notes where meeting_id is not null)            as mirrored_notes,
  (select count(*) from public.meetings m
    where m.lead_id is not null and btrim(coalesce(m.notes,'')) <> ''
      and not exists (select 1 from public.notes n where n.meeting_id = m.id)) as unmirrored,
  (select count(*) from public.meetings
    where lead_id is null and btrim(coalesce(notes,'')) <> '')                as notes_on_unlinked_meetings;
