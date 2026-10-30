-- Migration: raw-first Garmin Connect Personal API storage.
-- Safe to run multiple times (idempotent).
--
-- Every API response is kept verbatim in jsonb so nothing is lost if the
-- clean views (migrate_add_garmin_views.sql) ever need to change. Range
-- responses are split by the backfill script into one row per calendar date
-- per dataset. A row whose payload is JSON null means the date was fetched and
-- Garmin returned nothing for it.
--
-- Access: RLS is enabled with no policies, so anon/authenticated clients see
-- nothing. The backfill script writes with the service role, which bypasses
-- RLS. Grants are revoked as well so the tables are not even listable through
-- PostgREST for those roles.

begin;

create table if not exists public.garmin_daily_raw (
  calendar_date date not null,
  dataset text not null,
  payload jsonb,
  fetched_at timestamptz not null default now(),
  primary key (calendar_date, dataset)
);

comment on table public.garmin_daily_raw is
  'Raw Garmin Personal API responses, one row per calendar date per dataset. payload is JSON null when Garmin returned no data for that date.';

create index if not exists garmin_daily_raw_dataset_date_idx
  on public.garmin_daily_raw (dataset, calendar_date desc);

create table if not exists public.garmin_activities (
  activity_id bigint primary key,
  start_time_local timestamp,
  activity_type text,
  activity_name text,
  duration_s numeric,
  distance_m numeric,
  avg_hr integer,
  max_hr integer,
  calories numeric,
  aerobic_te numeric,
  anaerobic_te numeric,
  payload jsonb,
  fetched_at timestamptz not null default now()
);

comment on table public.garmin_activities is
  'Garmin activities. payload holds {"summary": search row, "detail": /activity-service response}. start_time_local is the watch-local wall time (no zone).';

create index if not exists garmin_activities_start_time_local_idx
  on public.garmin_activities (start_time_local desc);

create table if not exists public.garmin_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  range_start date,
  range_end date,
  dataset text not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'empty', 'error', 'skipped')),
  error text
);

comment on table public.garmin_sync_runs is
  'One row per backfill chunk (range window, single day, or activity page) so runs are auditable and resumable.';

create index if not exists garmin_sync_runs_dataset_started_idx
  on public.garmin_sync_runs (dataset, started_at desc);

alter table public.garmin_daily_raw enable row level security;
alter table public.garmin_activities enable row level security;
alter table public.garmin_sync_runs enable row level security;

-- Service role only for now: no policies, and no grants for the API roles.
revoke all on table public.garmin_daily_raw from anon, authenticated;
revoke all on table public.garmin_activities from anon, authenticated;
revoke all on table public.garmin_sync_runs from anon, authenticated;

commit;
