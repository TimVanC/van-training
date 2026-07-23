-- One-off data repair: rebuild lstarbinski@gmail.com's missing day templates.
--
-- Background:
--   The user's PPLs split has workout rows for every day, but the
--   `workout_exercises` (per-day exercise prescription) rows were lost for
--   every day except Core. With an empty prescription, loadDayExercises()
--   returns [] and handleDaySelect() silently aborts -> tapping the day does
--   nothing. His logged history (sessions + lift_sets) is fully intact, so we
--   reconstruct each day's template from his most recent logged session.
--
-- Scope / safety:
--   * INSERT-ONLY. No existing rows (template or history) are modified.
--   * Scoped strictly to lstarbinski@gmail.com via an email lookup.
--   * Only fills days that are currently empty (guards against double-runs).
--   * `Core` already has its template, so it is untouched.
--   * `Legs` is intentionally NOT rebuilt: the user has no logged history for
--     that day (he trained "Legs + Shoulders" instead), so there is nothing to
--     reconstruct from. Decide separately whether to populate it.
--
-- Name mapping (logged exercise_name -> current catalog name):
--   * "Hacksquat"            -> "Hack Squat"
--   * "Lying Hamstring Curl" -> "Hamstring Curl"
--   * "Incline Cable Curls"  -> created below (no catalog match existed)
--
-- order_index note:
--   All sets in a session share one submit timestamp, so the original
--   exercise order is not recoverable. We default to (most sets first, then
--   alphabetical). Reorder in the Admin Portal if a different order is wanted.

-- 1) Ensure the one missing catalog exercise exists.
insert into public.exercises (name)
select 'Incline Cable Curls'
where not exists (
  select 1 from public.exercises where name = 'Incline Cable Curls'
);

-- 2) Rebuild the five recoverable day templates.
with target_user as (
  select id as user_id
  from auth.users
  where email = 'lstarbinski@gmail.com'
),
plan(day_name, exercise_name, sets, rep_range, order_index) as (
  values
    -- Push A
    ('Push A', 'Incline Dumbbell Press',            4, '8-10',  1),
    ('Push A', 'Flat Machine Chest Press',          3, '10',    2),
    ('Push A', 'Overhead Cable Triceps Extension',  3, '10',    3),
    ('Push A', 'Pronated Triceps Pushdowns',        2, '10-12', 4),
    ('Push A', 'Weighted Chest Dips',               2, '9-10',  5),
    -- Pull A
    ('Pull A', 'Lat Pulldown',                      4, '10',    1),
    ('Pull A', 'Seated Cable Row',                  3, '9-10',  2),
    ('Pull A', 'Single Arm Rear Delt Cable Fly',    3, '30',    3),
    ('Pull A', 'Incline Cable Curls',               3, '8-10',  4),
    -- Legs + Shoulders
    ('Legs + Shoulders', 'Cable Lateral Raises',          4, '20',    1),
    ('Legs + Shoulders', 'Hack Squat',                    4, '10',    2),
    ('Legs + Shoulders', 'Seated Calf Raise',             4, '12-15', 3),
    ('Legs + Shoulders', 'Hamstring Curl',                3, '12',    4),
    ('Legs + Shoulders', 'Leg Extension',                 3, '12-15', 5),
    ('Legs + Shoulders', 'Seated Dumbbell Shoulder Press',3, '9-15',  6),
    -- Push B
    ('Push B', 'Decline Machine Press',             3, '7-11',  1),
    ('Push B', 'Flat Dumbbell Press',               3, '9-10',  2),
    ('Push B', 'High to Low Cable Fly',             3, '12-15', 3),
    ('Push B', 'Overhead Cable Triceps Extension',  3, '9-10',  4),
    ('Push B', 'Triceps Pushdowns',                 3, '10-15', 5),
    -- Pull B
    ('Pull B', 'Heavy Seated Cable Row',            4, '10',    1),
    ('Pull B', 'Hammer Curls',                      3, '20',    2),
    ('Pull B', 'Lat Pulldown',                      3, '10',    3),
    ('Pull B', 'Preacher Curls',                    3, '10',    4)
),
resolved as (
  select
    w.id  as workout_id,
    e.id  as exercise_id,
    p.sets,
    p.rep_range,
    p.order_index
  from plan p
  cross join target_user tu
  join public.splits  s on s.user_id  = tu.user_id and s.name = 'PPLs'
  join public.workouts w on w.split_id = s.id       and w.name = p.day_name
  join public.exercises e on e.name = p.exercise_name
  -- Only touch days that currently have no prescription rows.
  where not exists (
    select 1 from public.workout_exercises we where we.workout_id = w.id
  )
)
insert into public.workout_exercises (workout_id, exercise_id, sets, rep_range, order_index)
select workout_id, exercise_id, sets, rep_range, order_index
from resolved
on conflict (workout_id, order_index) do nothing;
