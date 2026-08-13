-- =============================================================================
-- 057_meeting_slots_and_not_responding.sql
--
-- TWO FIXES.
--
-- 1. HALF-HOUR BOOKING SLOTS
--    A 2:00pm booking was swallowing 2:30pm, so the next offer was 3:00pm.
--    Two things caused it, and both are fixed here:
--
--      a) The slot GRID stepped by the meeting's DURATION. A 30-minute call
--         therefore only ever produced a 30-minute grid by accident — change the
--         duration to 60 and the grid silently became hourly. Grid spacing and
--         call length are different questions, so they are now different
--         columns: slot_step_minutes (how often a slot is offered) and
--         slot_minutes (how long the call runs).
--
--      b) buffer_minutes defaulted to 10, and the buffer is applied on BOTH
--         sides of an existing meeting. A 2:00–2:30 call therefore blocked
--         1:50–2:40, which overlaps the 2:30 slot and kills it. Back-to-back
--         half-hour calls are impossible with any buffer above zero, so the
--         default is now 0 and existing members are reset once (below).
--
--    Result: 10:00, 10:30, 11:00 … and booking 2:00pm leaves 2:30pm bookable.
--    Anyone who wants breathing room can set a buffer again in Booking
--    settings — the field is still there, it just no longer defaults to on.
--
-- 2. "NOT RESPONDING" IS NOW A STAGE YOU CAN SET
--    The Leads screen already had a Not Responding filter, but it was purely
--    COMPUTED (open + untouched for 14 days) — there was no way to say "this
--    one has gone quiet" by hand. It is now a real stage in the dropdown, and
--    the filter shows both: the ones you marked AND the ones that went stale on
--    their own. leads.stage has had no CHECK constraint since migration 003
--    (custom pipelines own their stage lists), so nothing to alter there — this
--    section only registers the stage for any pipeline board that wants it.
--
-- Safe to run twice.
-- =============================================================================


-- ── 1. BOOKING GRID ─────────────────────────────────────────────────────────
do $slots$
declare v_first_run boolean;
begin
  -- Only reset buffers on the FIRST application. Re-running this migration
  -- months later must not stomp a buffer someone set on purpose since.
  v_first_run := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'scheduler_members'
       and column_name  = 'slot_step_minutes');

  alter table public.scheduler_members
    add column if not exists slot_step_minutes int not null default 30;

  if v_first_run then
    update public.scheduler_members
       set slot_step_minutes = 30,
           buffer_minutes    = 0,
           updated_at        = now();
  end if;
end $slots$;

-- New members start with no buffer, so half-hour slots work out of the box.
alter table public.scheduler_members alter column buffer_minutes set default 0;

-- Guard rails: a zero or negative step would spin the slot loop forever.
alter table public.scheduler_members drop constraint if exists scheduler_members_step_check;
alter table public.scheduler_members add constraint scheduler_members_step_check
  check (slot_step_minutes between 5 and 240);

comment on column public.scheduler_members.slot_step_minutes is
  'How often a slot is OFFERED (grid spacing). slot_minutes is how long the call RUNS. 30/30 gives back-to-back half-hour calls; 30/60 offers a slot every 30 min for a 60-min call.';
comment on column public.scheduler_members.buffer_minutes is
  'Dead time enforced on BOTH sides of a booked meeting. Must be 0 for back-to-back slots.';


-- ── 2. "NOT RESPONDING" STAGE ───────────────────────────────────────────────
-- Register it on every pipeline that does not already have it, so the board and
-- the Leads dropdown agree. Pipelines are optional — this whole block is a
-- no-op on a workspace that never created one.
do $stage$
begin
  if to_regclass('public.stages') is null then return; end if;

  insert into public.stages (workspace_id, pipeline_id, stage_key, name, color, sort_order, stage_type)
  select p.workspace_id, p.id, 'not_responding', 'Not Responding', 'amber',
         coalesce((select max(s2.sort_order) from public.stages s2 where s2.pipeline_id = p.id), 0) + 1,
         'active'
    from public.pipelines p
   where not exists (select 1 from public.stages s
                      where s.pipeline_id = p.id and s.stage_key = 'not_responding')
  on conflict (pipeline_id, stage_key) do nothing;
exception when others then
  -- Older/renamed stages schema: the app-side stage list still works without it.
  raise notice 'Skipped pipeline stage registration (%). The Leads dropdown is unaffected.', sqlerrm;
end $stage$;


notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────────────
select slug, display_name, slot_minutes, slot_step_minutes, buffer_minutes
  from public.scheduler_members order by created_at;
