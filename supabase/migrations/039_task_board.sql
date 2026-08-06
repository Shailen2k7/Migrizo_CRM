-- ============================================================================
-- 039: TASKS & GOALS BOARD
--
-- One table, four periods. A task belongs to exactly one period, identified by
-- its scope plus a period key:
--
--   scope      period_key            meaning
--   ---------  --------------------  ----------------------------------------
--   daily      2026-08-06            that calendar day
--   weekly     2026-08-03            the Monday the week starts on
--   monthly    2026-08                that month
--   yearly     2026                   that year — COMPANY goals
--
-- ACCESS
--   Everyone reads and writes their OWN daily/weekly/monthly tasks.
--   The super admin reads and writes EVERYONE's.
--   Yearly rows are company goals: readable by every workspace member,
--   writable only by the super admin.
--
-- This file is self-contained: it creates the super-admin list and helper if
-- an earlier migration has not already done so, so it can be run on its own.
--
-- Safe to run repeatedly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHO IS THE SUPER ADMIN (created here if 036 was never run)
-- ---------------------------------------------------------------------------
create table if not exists public.goal_super_admins (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

insert into public.goal_super_admins (email, note)
values ('shailenpathak@gmail.com', 'Founder — sees everyone, sets the company yearly goals')
on conflict (email) do nothing;

alter table public.goal_super_admins enable row level security;
drop policy if exists "read super admins" on public.goal_super_admins;
create policy "read super admins" on public.goal_super_admins
  for select to authenticated using (true);

create or replace function public.is_goal_super_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
      join public.goal_super_admins s on lower(u.email) = lower(s.email)
     where u.id = auth.uid()
  );
$$;
grant execute on function public.is_goal_super_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE BOARD
-- ---------------------------------------------------------------------------
create table if not exists public.task_board (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  scope        text not null check (scope in ('daily','weekly','monthly','yearly')),
  period_key   text not null,
  title        text not null,
  status       text not null default 'todo' check (status in ('todo','doing','blocked','done')),
  done         boolean not null default false,
  done_at      timestamptz,
  sort_order   int not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists task_board_lookup on public.task_board(workspace_id, scope, period_key);
create index if not exists task_board_user   on public.task_board(workspace_id, user_id, scope);

-- Keep `done` and `status` from ever disagreeing, whichever one the UI sets.
create or replace function public.task_board_sync() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.done is distinct from old.done then
      new.status := case when new.done then 'done' else 'todo' end;
    elsif new.status is distinct from old.status then
      new.done := (new.status = 'done');
    end if;
  else
    new.done := (new.status = 'done') or new.done;
    if new.done then new.status := 'done'; end if;
  end if;

  new.done_at  := case when new.done then coalesce(new.done_at, now()) else null end;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists task_board_sync_trg on public.task_board;
create trigger task_board_sync_trg before insert or update on public.task_board
  for each row execute function public.task_board_sync();

-- ---------------------------------------------------------------------------
-- 3. RLS
--    Grants are stated explicitly rather than relying on default privileges,
--    so the table behaves the same on any database it is restored to.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.task_board to authenticated;

alter table public.task_board enable row level security;

-- READ: your own rows, plus every yearly (company) row, plus everything if
-- you are the super admin.
drop policy if exists "read tasks" on public.task_board;
create policy "read tasks" on public.task_board for select to authenticated
  using (
    workspace_id in (select user_workspaces())
    and (scope = 'yearly' or user_id = auth.uid() or public.is_goal_super_admin())
  );

-- WRITE: your own non-yearly rows; the super admin may write anything,
-- including the company yearly goals. A member can never touch yearly.
drop policy if exists "write tasks" on public.task_board;
create policy "write tasks" on public.task_board for all to authenticated
  using (
    workspace_id in (select user_workspaces())
    and (
      public.is_goal_super_admin()
      or (scope <> 'yearly' and user_id = auth.uid())
    )
  )
  with check (
    workspace_id in (select user_workspaces())
    and (
      public.is_goal_super_admin()
      or (scope <> 'yearly' and user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. REVIEW ROLLUP — counts per person per scope, for the Review tab.
--    Respects the same visibility rules, so a member only ever sees their own
--    line even if they call it directly.
-- ---------------------------------------------------------------------------
create or replace function public.task_board_summary(p_workspace_id uuid)
returns table (
  user_id   uuid,
  scope     text,
  planned   bigint,
  completed bigint,
  blocked   bigint
)
language sql stable security definer set search_path = public as $$
  select t.user_id, t.scope,
         count(*)                                    as planned,
         count(*) filter (where t.done)              as completed,
         count(*) filter (where t.status = 'blocked') as blocked
    from public.task_board t
   where t.workspace_id = p_workspace_id
     and t.scope <> 'yearly'
     and (public.is_goal_super_admin() or t.user_id = auth.uid())
   group by t.user_id, t.scope;
$$;

grant execute on function public.task_board_summary(uuid) to authenticated;

select 'task board ready' as status;
