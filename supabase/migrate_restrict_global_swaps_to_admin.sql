-- Applied 2026-07-23 (Supabase migration: restrict_global_swaps_to_admin)
--
-- Global (admin-curated) exercise swaps were only enforced in the UI: the
-- insert/update policies let any authenticated user set is_global = true,
-- which would push their swap to every user's swap list. Gate global writes
-- to the admin account at the RLS level.
drop policy if exists exercise_swaps_insert_own on public.exercise_swaps;
create policy exercise_swaps_insert_own on public.exercise_swaps
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      coalesce(is_global, false) = false
      or (select auth.jwt() ->> 'email') = 'timvancau@gmail.com'
    )
  );

drop policy if exists exercise_swaps_update_own on public.exercise_swaps;
create policy exercise_swaps_update_own on public.exercise_swaps
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      coalesce(is_global, false) = false
      or (select auth.jwt() ->> 'email') = 'timvancau@gmail.com'
    )
  );
