-- Safeguard: stop catalog deletions from silently wiping users' programs.
--
-- Problem:
--   workout_exercises.exercise_id currently has ON DELETE CASCADE (set by
--   migrate_exercise_delete_fk_actions.sql). Deleting an exercise from the
--   global catalog therefore removes it from EVERY user's program prescription
--   with no warning. This is the most likely cause of lost day templates
--   (history in lift_sets survives because that FK is ON DELETE SET NULL).
--
-- Fix:
--   Switch workout_exercises.exercise_id back to ON DELETE RESTRICT so the
--   database blocks deleting an exercise that is still referenced by any
--   program. To retire an exercise, archive it (is_archived = true) — which
--   already hides it from the logging UI without destroying program rows —
--   or remove it from programs first.
--
--   lift_sets.exercise_id is intentionally left as ON DELETE SET NULL: orphaning
--   historical sets (while keeping exercise_name) is the desired behavior.
--
-- Idempotent / safe to re-run.

begin;

alter table public.workout_exercises
  drop constraint if exists workout_exercises_exercise_id_fkey;

alter table public.workout_exercises
  add constraint workout_exercises_exercise_id_fkey
  foreign key (exercise_id) references public.exercises(id) on delete restrict;

commit;
