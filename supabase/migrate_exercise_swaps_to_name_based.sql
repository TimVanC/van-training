-- Migration: move exercise_swaps to name-based latest-preference model
-- Safe to run multiple times (idempotent).
-- Keeps legacy ID columns for backwards compatibility; does not drop data.

begin;

-- 1) Add new columns if they do not exist.
alter table public.exercise_swaps
add column if not exists base_exercise_name text;

alter table public.exercise_swaps
add column if not exists swap_exercise_name text;

alter table public.exercise_swaps
add column if not exists updated_at timestamptz;

-- 2) Backfill name columns from legacy exercise IDs when present.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exercise_swaps'
      and column_name = 'original_exercise_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'exercise_swaps'
      and column_name = 'substitute_exercise_id'
  ) then
    update public.exercise_swaps s
    set
      base_exercise_name = coalesce(s.base_exercise_name, e1.name),
      swap_exercise_name = coalesce(s.swap_exercise_name, e2.name)
    from public.exercises e1, public.exercises e2
    where s.original_exercise_id = e1.id
      and s.substitute_exercise_id = e2.id;
  end if;
end
$$;

-- 3) Ensure updated_at is populated and normalized.
update public.exercise_swaps
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.exercise_swaps
alter column updated_at set default now();

-- 4) Keep only latest row per user + base exercise (case-insensitive).
--    This converts history rows into a single "current preference".
with ranked_swaps as (
  select
    id,
    row_number() over (
      partition by user_id, lower(coalesce(base_exercise_name, ''))
      order by coalesce(updated_at, created_at) desc, created_at desc, id desc
    ) as rn
  from public.exercise_swaps
  where coalesce(base_exercise_name, '') <> ''
)
delete from public.exercise_swaps s
using ranked_swaps r
where s.id = r.id
  and r.rn > 1;

-- 5) Add indexes/constraints for name-based reads + upserts.
create index if not exists idx_exercise_swaps_user_id
on public.exercise_swaps(user_id);

create index if not exists idx_exercise_swaps_user_base_name
on public.exercise_swaps(user_id, base_exercise_name);

drop index if exists idx_exercise_swaps_unique_pair;
drop index if exists idx_exercise_swaps_unique_pair_ci;

create unique index if not exists idx_exercise_swaps_user_base_unique_ci
on public.exercise_swaps(user_id, lower(base_exercise_name))
where base_exercise_name is not null;

create unique index if not exists idx_exercise_swaps_user_base_swap_unique_ci
on public.exercise_swaps(user_id, lower(base_exercise_name), lower(swap_exercise_name))
where base_exercise_name is not null
  and swap_exercise_name is not null;

-- 6) Tighten nullability only if data is clean.
do $$
begin
  if not exists (
    select 1
    from public.exercise_swaps
    where base_exercise_name is null
       or trim(base_exercise_name) = ''
       or swap_exercise_name is null
       or trim(swap_exercise_name) = ''
  ) then
    alter table public.exercise_swaps
      alter column base_exercise_name set not null,
      alter column swap_exercise_name set not null,
      alter column updated_at set not null;
  end if;
end
$$;

commit;

