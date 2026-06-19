-- exercises is a global catalog: any authenticated user could already SELECT/INSERT,
-- but there were no UPDATE or DELETE policies. With RLS enabled, that caused the admin
-- portal's Archive (update is_archived), Edit (update name/supports_assisted), Replace
-- (archive old), and Permanently Delete actions to silently affect 0 rows with no error.
-- These policies add the missing UPDATE/DELETE access (matching the existing pattern).

drop policy if exists "exercises_update_authenticated" on public.exercises;
create policy "exercises_update_authenticated"
  on public.exercises
  for update
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy if exists "exercises_delete_authenticated" on public.exercises;
create policy "exercises_delete_authenticated"
  on public.exercises
  for delete
  using ((select auth.uid()) is not null);
