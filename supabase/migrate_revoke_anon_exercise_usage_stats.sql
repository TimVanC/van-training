-- Applied 2026-07-23 (Supabase migration: revoke_anon_exercise_usage_stats)
--
-- The function checks the caller's email internally, but there is no reason
-- for unauthenticated clients to be able to invoke it at all.
revoke execute on function public.exercise_usage_stats(uuid) from anon;
revoke execute on function public.exercise_usage_stats(uuid) from public;
