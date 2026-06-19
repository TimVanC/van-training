-- Migration: persist exercise metadata (input mode, sled, assisted, archived)
-- Moves runtime-only flags from src/data/plateModeExercises.ts into the DB.
-- Safe to run multiple times (idempotent).

begin;

-- 1) exercises: archival flag + intrinsic equipment/input metadata
alter table public.exercises
  add column if not exists is_archived boolean not null default false;

alter table public.exercises
  add column if not exists input_mode text not null default 'weight';

alter table public.exercises
  add column if not exists is_sled boolean not null default false;

alter table public.exercises
  add column if not exists supports_assisted boolean not null default false;

-- constrain input_mode to known values
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exercises'::regclass
      and conname = 'exercises_input_mode_check'
  ) then
    alter table public.exercises
      add constraint exercises_input_mode_check
      check (input_mode in ('weight', 'plates'));
  end if;
end
$$;

-- 2) Backfill from current hardcoded sets (case-insensitive match on name)

-- PLATE_MODE_EXERCISES
update public.exercises
set input_mode = 'plates'
where lower(name) in (
  'leg press',
  'flat machine chest press',
  'decline machine press',
  'seated calf raise',
  'hack squat'
);

-- SLED_EXERCISES
update public.exercises
set is_sled = true
where lower(name) in (
  'leg press',
  'hack squat'
);

-- ASSISTED_EXERCISES
update public.exercises
set supports_assisted = true
where lower(name) in (
  'neutral grip pull-ups',
  'pull ups',
  'lat pulldown',
  'cable crunches',
  'hanging knee raises',
  'oblique crunch',
  'serratus crunch'
);

-- 3) workout_exercises: nullable per-prescription input_mode override.
--    NULL = inherit from exercises.input_mode.
alter table public.workout_exercises
  add column if not exists input_mode text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workout_exercises'::regclass
      and conname = 'workout_exercises_input_mode_check'
  ) then
    alter table public.workout_exercises
      add constraint workout_exercises_input_mode_check
      check (input_mode is null or input_mode in ('weight', 'plates'));
  end if;
end
$$;

commit;
