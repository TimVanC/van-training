-- Migration: per-exercise notes on a logged workout.
-- sessions.notes stays the day-level note; this table holds one note per
-- exercise in that session ("seat 4", "left side felt harder", "machine was
-- taken, did pec deck"). Kept separate from lift_sets so a note survives on
-- an exercise that was skipped and has no sets.
-- Safe to run multiple times (idempotent). Applied to the live project on 2026-10-30.

create table if not exists public.session_exercise_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  -- The name the sets were logged under (the swap, when one was used),
  -- matching lift_sets.exercise_name.
  exercise_name text not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_exercise_notes_session_id
  on public.session_exercise_notes (session_id);

create unique index if not exists idx_session_exercise_notes_unique
  on public.session_exercise_notes (session_id, lower(exercise_name));

alter table public.session_exercise_notes enable row level security;

-- Ownership flows through the parent session, like lift_sets.
drop policy if exists "session_exercise_notes_select_own" on public.session_exercise_notes;
create policy "session_exercise_notes_select_own"
  on public.session_exercise_notes for select
  using (exists (
    select 1 from public.sessions s
    where s.id = session_exercise_notes.session_id and s.user_id = (select auth.uid())
  ));

drop policy if exists "session_exercise_notes_insert_own" on public.session_exercise_notes;
create policy "session_exercise_notes_insert_own"
  on public.session_exercise_notes for insert
  with check (exists (
    select 1 from public.sessions s
    where s.id = session_exercise_notes.session_id and s.user_id = (select auth.uid())
  ));

drop policy if exists "session_exercise_notes_update_own" on public.session_exercise_notes;
create policy "session_exercise_notes_update_own"
  on public.session_exercise_notes for update
  using (exists (
    select 1 from public.sessions s
    where s.id = session_exercise_notes.session_id and s.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.sessions s
    where s.id = session_exercise_notes.session_id and s.user_id = (select auth.uid())
  ));

drop policy if exists "session_exercise_notes_delete_own" on public.session_exercise_notes;
create policy "session_exercise_notes_delete_own"
  on public.session_exercise_notes for delete
  using (exists (
    select 1 from public.sessions s
    where s.id = session_exercise_notes.session_id and s.user_id = (select auth.uid())
  ));
