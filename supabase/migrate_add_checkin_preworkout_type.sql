-- Migration: record what the pre-workout was when a check-in answers "yes".
-- Safe to run multiple times (idempotent).

begin;

alter table public.workout_checkins
  add column if not exists preworkout_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workout_checkins_preworkout_type_check'
  ) then
    alter table public.workout_checkins
      add constraint workout_checkins_preworkout_type_check
      check (preworkout_type in ('preworkout', 'energy_drink', 'coffee', 'other'));
  end if;
end $$;

commit;
