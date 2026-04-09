-- Enable UUID generation
create extension if not exists pgcrypto;

-- Profiles (maps 1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Split templates owned by a user
create table if not exists public.splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_splits_user_id on public.splits(user_id);
create unique index if not exists idx_splits_user_name_unique on public.splits(user_id, name);

-- Workouts inside a split (ordered)
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  split_id uuid not null references public.splits(id) on delete cascade,
  name text not null,
  order_index integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workouts_split_id on public.workouts(split_id);
create unique index if not exists idx_workouts_split_order_unique on public.workouts(split_id, order_index);

-- Canonical exercise catalog (global)
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_exercises_name on public.exercises(name);

-- Workout -> exercise mapping with per-workout prescription
create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  sets integer not null check (sets > 0),
  rep_range text not null,
  order_index integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workout_exercises_workout_id on public.workout_exercises(workout_id);
create index if not exists idx_workout_exercises_exercise_id on public.workout_exercises(exercise_id);
create unique index if not exists idx_workout_exercises_workout_order_unique on public.workout_exercises(workout_id, order_index);

-- Lift sessions completed by a user on a specific workout
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete restrict,
  date timestamptz not null,
  notes text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.sessions
add column if not exists notes text;

create index if not exists idx_sessions_user_id on public.sessions(user_id);
create index if not exists idx_sessions_workout_id on public.sessions(workout_id);
create index if not exists idx_sessions_user_date on public.sessions(user_id, date desc);

-- Logged lift sets for a given session
create table if not exists public.lift_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  exercise_name text not null,
  weight numeric not null,
  reps integer not null check (reps > 0),
  volume numeric generated always as (weight * reps) stored,
  rir numeric not null default 0 check (rir >= 0),
  plate_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.lift_sets
drop constraint if exists lift_sets_weight_check;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.lift_sets'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%weight%'
      and pg_get_constraintdef(oid) ilike '%>=%'
      and pg_get_constraintdef(oid) ilike '%0%'
  loop
    execute format('alter table public.lift_sets drop constraint if exists %I;', c.conname);
  end loop;
end
$$;

alter table public.lift_sets
add column if not exists plate_data jsonb;

create index if not exists idx_lift_sets_session_id on public.lift_sets(session_id);
create index if not exists idx_lift_sets_exercise_id on public.lift_sets(exercise_id);

-- Cardio sessions (Run/Bike/Swim)
create table if not exists public.cardio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('Run', 'Bike', 'Swim')),
  distance numeric not null check (distance > 0),
  duration integer not null check (duration > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_cardio_sessions_user_id on public.cardio_sessions(user_id);
create index if not exists idx_cardio_sessions_user_type on public.cardio_sessions(user_id, type);
create index if not exists idx_cardio_sessions_created_at on public.cardio_sessions(created_at desc);

-- Optional per-user substitutions
create table if not exists public.exercise_swaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_exercise_id uuid not null references public.exercises(id) on delete cascade,
  substitute_exercise_id uuid not null references public.exercises(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (original_exercise_id <> substitute_exercise_id)
);

create index if not exists idx_exercise_swaps_user_id on public.exercise_swaps(user_id);
create unique index if not exists idx_exercise_swaps_unique_pair on public.exercise_swaps(user_id, original_exercise_id, substitute_exercise_id);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.splits enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.sessions enable row level security;
alter table public.lift_sets enable row level security;
alter table public.cardio_sessions enable row level security;
alter table public.exercise_swaps enable row level security;

-- profiles policies
create policy "profiles_select_own"
on public.profiles
for select
using (id = auth.uid());

create policy "profiles_insert_own"
on public.profiles
for insert
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "profiles_delete_own"
on public.profiles
for delete
using (id = auth.uid());

-- splits policies
create policy "splits_select_own"
on public.splits
for select
using (user_id = auth.uid());

create policy "splits_insert_own"
on public.splits
for insert
with check (user_id = auth.uid());

create policy "splits_update_own"
on public.splits
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "splits_delete_own"
on public.splits
for delete
using (user_id = auth.uid());

-- workouts policies (ownership via parent split)
create policy "workouts_select_own"
on public.workouts
for select
using (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = auth.uid()
  )
);

create policy "workouts_insert_own"
on public.workouts
for insert
with check (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = auth.uid()
  )
);

create policy "workouts_update_own"
on public.workouts
for update
using (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = auth.uid()
  )
);

create policy "workouts_delete_own"
on public.workouts
for delete
using (
  exists (
    select 1
    from public.splits s
    where s.id = workouts.split_id
      and s.user_id = auth.uid()
  )
);

-- workout_exercises policies (ownership via workout -> split)
create policy "workout_exercises_select_own"
on public.workout_exercises
for select
using (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = auth.uid()
  )
);

create policy "workout_exercises_insert_own"
on public.workout_exercises
for insert
with check (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = auth.uid()
  )
);

create policy "workout_exercises_update_own"
on public.workout_exercises
for update
using (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = auth.uid()
  )
);

create policy "workout_exercises_delete_own"
on public.workout_exercises
for delete
using (
  exists (
    select 1
    from public.workouts w
    join public.splits s on s.id = w.split_id
    where w.id = workout_exercises.workout_id
      and s.user_id = auth.uid()
  )
);

-- sessions policies
create policy "sessions_select_own"
on public.sessions
for select
using (user_id = auth.uid());

create policy "sessions_insert_own"
on public.sessions
for insert
with check (user_id = auth.uid());

create policy "sessions_update_own"
on public.sessions
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "sessions_delete_own"
on public.sessions
for delete
using (user_id = auth.uid());

-- lift_sets policies (ownership via session.user_id)
create policy "lift_sets_select_own"
on public.lift_sets
for select
using (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = auth.uid()
  )
);

create policy "lift_sets_insert_own"
on public.lift_sets
for insert
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = auth.uid()
  )
);

create policy "lift_sets_update_own"
on public.lift_sets
for update
using (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = auth.uid()
  )
);

create policy "lift_sets_delete_own"
on public.lift_sets
for delete
using (
  exists (
    select 1
    from public.sessions s
    where s.id = lift_sets.session_id
      and s.user_id = auth.uid()
  )
);

-- cardio_sessions policies
create policy "cardio_sessions_select_own"
on public.cardio_sessions
for select
using (user_id = auth.uid());

create policy "cardio_sessions_insert_own"
on public.cardio_sessions
for insert
with check (user_id = auth.uid());

create policy "cardio_sessions_update_own"
on public.cardio_sessions
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "cardio_sessions_delete_own"
on public.cardio_sessions
for delete
using (user_id = auth.uid());

-- exercise_swaps policies
create policy "exercise_swaps_select_own"
on public.exercise_swaps
for select
using (user_id = auth.uid());

create policy "exercise_swaps_insert_own"
on public.exercise_swaps
for insert
with check (user_id = auth.uid());

create policy "exercise_swaps_update_own"
on public.exercise_swaps
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "exercise_swaps_delete_own"
on public.exercise_swaps
for delete
using (user_id = auth.uid());
