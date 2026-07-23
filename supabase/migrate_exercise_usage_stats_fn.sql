-- Admin-only helper: report how widely a catalog exercise is used across ALL
-- users' programs, so the Admin Portal can show the blast radius before a
-- delete. workout_exercises has owner-scoped RLS, so a normal client query
-- would only see the admin's own rows; this SECURITY DEFINER function counts
-- across every user. It returns aggregate counts only (no row data) and is
-- gated to the curating admin.

create or replace function public.exercise_usage_stats(p_exercise_id uuid)
returns table (slot_count integer, user_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Counts span all users, so restrict to the curating admin.
  if auth.uid() is null
     or auth.uid() <> (select id from auth.users where email = 'timvancau@gmail.com') then
    raise exception 'not authorized';
  end if;

  return query
  select
    count(*)::int                  as slot_count,
    count(distinct s.user_id)::int as user_count
  from public.workout_exercises we
  join public.workouts w on w.id = we.workout_id
  join public.splits   s on s.id = w.split_id
  where we.exercise_id = p_exercise_id;
end;
$$;

grant execute on function public.exercise_usage_stats(uuid) to authenticated;
