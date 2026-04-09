begin;

-- Ensure lookup table is protected by RLS.
alter table public.exercises enable row level security;

-- Add covering indexes for FK lookups on exercise_swaps.
create index if not exists idx_exercise_swaps_original_exercise_id
on public.exercise_swaps(original_exercise_id);

create index if not exists idx_exercise_swaps_substitute_exercise_id
on public.exercise_swaps(substitute_exercise_id);

-- exercises policies (read + insert for authenticated users)
drop policy if exists "exercises_select_authenticated" on public.exercises;
drop policy if exists "exercises_insert_authenticated" on public.exercises;

create policy "exercises_select_authenticated"
on public.exercises
for select
using ((select auth.uid()) is not null);

create policy "exercises_insert_authenticated"
on public.exercises
for insert
with check ((select auth.uid()) is not null);

-- profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own"
on public.profiles
for select
using (id = (select auth.uid()));

create policy "profiles_insert_own"
on public.profiles
for insert
with check (id = (select auth.uid()));

create policy "profiles_update_own"
on public.profiles
for update
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "profiles_delete_own"
on public.profiles
for delete
using (id = (select auth.uid()));

-- splits policies
drop policy if exists "splits_select_own" on public.splits;
drop policy if exists "splits_insert_own" on public.splits;
drop policy if exists "splits_update_own" on public.splits;
drop policy if exists "splits_delete_own" on public.splits;

create policy "splits_select_own"
on public.splits
for select
using (user_id = (select auth.uid()));

create policy "splits_insert_own"
on public.splits
for insert
with check (user_id = (select auth.uid()));

create policy "splits_update_own"
on public.splits
for update
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "splits_delete_own"
on public.splits
for delete
using (user_id = (select auth.uid()));

-- workouts policies (ownership via parent split)
drop policy if exists "workouts_select_own" on public.workouts;
drop policy if exists "workouts_insert_own" on public.workouts;
drop policy if exists "workouts_update_own" on public.workouts;
drop policy if exists "workouts_delete_own" on public.workouts;

create policy "workouts_select_own"
on public.workouts
for select
using (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = (select auth.uid())
  )
);

create policy "workouts_insert_own"
on public.workouts
for insert
with check (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = (select auth.uid())
  )
);

create policy "workouts_update_own"
on public.workouts
for update
using (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = (select auth.uid())
  )
);

create policy "workouts_delete_own"
on public.workouts
for delete
using (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = (select auth.uid())
  )
);

-- workout_exercises policies (ownership via workout -> split)
drop policy if exists "workout_exercises_select_own" on public.workout_exercises;
drop policy if exists "workout_exercises_insert_own" on public.workout_exercises;
drop policy if exists "workout_exercises_update_own" on public.workout_exercises;
drop policy if exists "workout_exercises_delete_own" on public.workout_exercises;

create policy "workout_exercises_select_own"
on public.workout_exercises
for select
using (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = (select auth.uid())
  )
);

create policy "workout_exercises_insert_own"
on public.workout_exercises
for insert
with check (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = (select auth.uid())
  )
);

create policy "workout_exercises_update_own"
on public.workout_exercises
for update
using (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = (select auth.uid())
  )
);

create policy "workout_exercises_delete_own"
on public.workout_exercises
for delete
using (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = (select auth.uid())
  )
);

-- sessions policies
drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_insert_own" on public.sessions;
drop policy if exists "sessions_update_own" on public.sessions;
drop policy if exists "sessions_delete_own" on public.sessions;

create policy "sessions_select_own"
on public.sessions
for select
using (user_id = (select auth.uid()));

create policy "sessions_insert_own"
on public.sessions
for insert
with check (user_id = (select auth.uid()));

create policy "sessions_update_own"
on public.sessions
for update
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "sessions_delete_own"
on public.sessions
for delete
using (user_id = (select auth.uid()));

-- lift_sets policies (ownership via session.user_id)
drop policy if exists "lift_sets_select_own" on public.lift_sets;
drop policy if exists "lift_sets_insert_own" on public.lift_sets;
drop policy if exists "lift_sets_update_own" on public.lift_sets;
drop policy if exists "lift_sets_delete_own" on public.lift_sets;

create policy "lift_sets_select_own"
on public.lift_sets
for select
using (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = (select auth.uid())
  )
);

create policy "lift_sets_insert_own"
on public.lift_sets
for insert
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = (select auth.uid())
  )
);

create policy "lift_sets_update_own"
on public.lift_sets
for update
using (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = (select auth.uid())
  )
);

create policy "lift_sets_delete_own"
on public.lift_sets
for delete
using (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = (select auth.uid())
  )
);

-- cardio_sessions policies
drop policy if exists "cardio_sessions_select_own" on public.cardio_sessions;
drop policy if exists "cardio_sessions_insert_own" on public.cardio_sessions;
drop policy if exists "cardio_sessions_update_own" on public.cardio_sessions;
drop policy if exists "cardio_sessions_delete_own" on public.cardio_sessions;

create policy "cardio_sessions_select_own"
on public.cardio_sessions
for select
using (user_id = (select auth.uid()));

create policy "cardio_sessions_insert_own"
on public.cardio_sessions
for insert
with check (user_id = (select auth.uid()));

create policy "cardio_sessions_update_own"
on public.cardio_sessions
for update
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "cardio_sessions_delete_own"
on public.cardio_sessions
for delete
using (user_id = (select auth.uid()));

-- exercise_swaps policies
drop policy if exists "exercise_swaps_select_own" on public.exercise_swaps;
drop policy if exists "exercise_swaps_insert_own" on public.exercise_swaps;
drop policy if exists "exercise_swaps_update_own" on public.exercise_swaps;
drop policy if exists "exercise_swaps_delete_own" on public.exercise_swaps;

create policy "exercise_swaps_select_own"
on public.exercise_swaps
for select
using (user_id = (select auth.uid()));

create policy "exercise_swaps_insert_own"
on public.exercise_swaps
for insert
with check (user_id = (select auth.uid()));

create policy "exercise_swaps_update_own"
on public.exercise_swaps
for update
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "exercise_swaps_delete_own"
on public.exercise_swaps
for delete
using (user_id = (select auth.uid()));

commit;
