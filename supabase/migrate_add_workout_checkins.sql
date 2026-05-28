-- Migration: add post-workout check-in questionnaire table.
-- Safe to run multiple times (idempotent).

begin;

create table if not exists public.workout_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  split_name text,
  day_name text,
  feel smallint check (feel between 1 and 10),
  effort smallint check (effort between 1 and 10),
  sleep smallint check (sleep between 1 and 10),
  soreness smallint check (soreness between 1 and 10),
  took_preworkout boolean,
  created_at timestamptz not null default now()
);

create index if not exists workout_checkins_user_date_idx
  on public.workout_checkins (user_id, session_date desc);

alter table public.workout_checkins enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workout_checkins'
      and policyname = 'Users manage own checkins'
  ) then
    create policy "Users manage own checkins"
      on public.workout_checkins
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

commit;
