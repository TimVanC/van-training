-- Migration: allow permanent deletion of an exercise from the admin portal.
--   * lift_sets historical rows are orphaned (exercise_id -> null, exercise_name retained)
--   * workout_exercises prescriptions referencing the exercise are removed
-- Safe to run multiple times (idempotent).

begin;

-- lift_sets: orphan historical sets on exercise deletion (keep exercise_name)
alter table public.lift_sets
  alter column exercise_id drop not null;

alter table public.lift_sets
  drop constraint if exists lift_sets_exercise_id_fkey;

alter table public.lift_sets
  add constraint lift_sets_exercise_id_fkey
  foreign key (exercise_id) references public.exercises(id) on delete set null;

-- workout_exercises: removing an exercise removes it from all programs
alter table public.workout_exercises
  drop constraint if exists workout_exercises_exercise_id_fkey;

alter table public.workout_exercises
  add constraint workout_exercises_exercise_id_fkey
  foreign key (exercise_id) references public.exercises(id) on delete cascade;

commit;
