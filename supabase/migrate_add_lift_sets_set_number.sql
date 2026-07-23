-- Applied 2026-07-23 (Supabase migration: add_lift_sets_set_number)
--
-- Adds a real set-order column. Previously all sets in a session were inserted
-- in one statement and shared the same created_at, so within-exercise order
-- (heaviest set first) was not reliably stored — which the progression engine
-- depends on. appendWorkout now writes set_number explicitly.
alter table public.lift_sets add column if not exists set_number integer;

with numbered as (
  select id,
    row_number() over (
      partition by session_id, exercise_name
      order by created_at, ctid
    ) as rn
  from public.lift_sets
)
update public.lift_sets ls
set set_number = n.rn
from numbered n
where ls.id = n.id
  and ls.set_number is null;
