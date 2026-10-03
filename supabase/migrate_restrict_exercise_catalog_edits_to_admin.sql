-- Applied 2026-10-03 (Supabase migration: restrict_exercise_catalog_edits_to_admin)
--
-- The exercise catalog is shared by every user. Any signed-in user could
-- rename or delete rows, which would rewrite everyone's program. Adding rows
-- stays open (logging a custom swap creates one); renaming and deleting are
-- admin-only, matching the Admin Portal, which is the only UI that does either.
drop policy if exists exercises_update_authenticated on public.exercises;
drop policy if exists exercises_update_admin on public.exercises;
create policy exercises_update_admin on public.exercises
  for update to authenticated
  using ((select auth.jwt() ->> 'email') = 'timvancau@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'timvancau@gmail.com');

drop policy if exists exercises_delete_authenticated on public.exercises;
drop policy if exists exercises_delete_admin on public.exercises;
create policy exercises_delete_admin on public.exercises
  for delete to authenticated
  using ((select auth.jwt() ->> 'email') = 'timvancau@gmail.com');
