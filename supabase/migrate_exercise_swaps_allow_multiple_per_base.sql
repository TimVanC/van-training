-- Allow multiple swap options (alternates) per base exercise.
--
-- Previously idx_exercise_swaps_user_base_unique_ci enforced UNIQUE
-- (user_id, lower(base_exercise_name)), limiting each exercise to a single swap.
-- Any attempt to add a second alternate for the same base exercise was rejected,
-- which made the Swap Relationship Manager appear to be "missing" relationships.
--
-- The logging UI (ExerciseLogging.tsx) already fetches ALL swap rows for a base
-- exercise and builds a multi-option list, so dropping this index safely unlocks
-- multiple alternates per exercise.
--
-- There were TWO one-swap-per-base unique indexes (a case-insensitive variant and an
-- older case-sensitive variant), both of which had to be dropped.
--
-- idx_exercise_swaps_user_base_swap_unique_ci (user_id, lower(base), lower(swap))
-- is intentionally kept so exact duplicate base->swap pairs are still rejected.

drop index if exists public.idx_exercise_swaps_user_base_unique_ci;
drop index if exists public.idx_exercise_swaps_user_base_unique;
