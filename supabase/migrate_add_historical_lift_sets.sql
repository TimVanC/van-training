-- Pre-van.training lifting history (imported from a user's old spreadsheets
-- via scripts/parseHistoricalSplits.py + scripts/importHistoricalLifts.ts).
-- Kept separate from lift_sets on purpose: Analytics and the dashboard only
-- read lift_sets, so this data never leaks into those views. Only
-- api/getPeak.ts reads it. Applied to the live project on 2026-10-01.
create table if not exists public.historical_lift_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  split_name text not null,
  split_abbr text not null,
  day_name text not null,
  session_key text not null,
  session_index integer not null,
  date date not null,
  date_estimated boolean not null default true,
  exercise_name text not null,
  set_number integer not null,
  weight numeric not null,
  reps integer not null check (reps > 0),
  target_reps integer,
  is_drop_set boolean not null default false,
  raw_cell text,
  notes text,
  excluded_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_historical_lift_sets_user_id on public.historical_lift_sets(user_id);
create index if not exists idx_historical_lift_sets_user_date on public.historical_lift_sets(user_id, date);
create unique index if not exists idx_historical_lift_sets_unique_set
  on public.historical_lift_sets(user_id, session_key, exercise_name, set_number);

alter table public.historical_lift_sets enable row level security;

create policy "historical_lift_sets_select_own"
on public.historical_lift_sets
for select
using ((select auth.uid()) = user_id);

-- Inserts/updates happen through the service-role import script only.
