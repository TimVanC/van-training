-- Make exercise_swaps admin-curated global.
--
-- Splits/workouts/exercises remain per-user, but swap relationships are name-based
-- ("any exercise named X can swap to Y"), so they can safely be shared across users.
-- The admin (timvancau@gmail.com) curates a global set; every user sees those global
-- swaps in the logging swap picker, plus their own personal swaps.

-- 1) Remove the admin's obvious test rows.
delete from public.exercise_swaps
where id in (
  '2d0b7ef1-eaa3-4482-a0ce-d4fd9ba2852b',  -- Neutral Grip Pull-Ups -> Test Swap Addition
  '0e72da84-6ff7-49fb-9878-ab77ca96c6ed'   -- test 2 -> Test
);

-- 2) Add the global flag. Personal swaps stay false; admin-curated swaps are true.
alter table public.exercise_swaps
  add column if not exists is_global boolean not null default false;

-- 3) Backfill: all of the admin's remaining swaps become the global program set.
update public.exercise_swaps
set is_global = true
where user_id = (select id from auth.users where email = 'timvancau@gmail.com');

-- 4) Reads: any authenticated user can see global swaps plus their own personal ones.
--    Writes stay owner-scoped (friends can't edit the admin's global swaps).
drop policy if exists "exercise_swaps_select_own" on public.exercise_swaps;
drop policy if exists "exercise_swaps_select_global_or_own" on public.exercise_swaps;
create policy "exercise_swaps_select_global_or_own"
  on public.exercise_swaps
  for select
  using (is_global = true or user_id = (select auth.uid()));

create index if not exists idx_exercise_swaps_global_base
  on public.exercise_swaps (base_exercise_name)
  where is_global = true;
