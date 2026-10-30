-- Migration: clean views over the raw Garmin tables.
-- Safe to run multiple times (idempotent). Requires migrate_add_garmin_tables.sql.
--
-- Field paths come from the Garmin Connect Personal API responses
-- (see supabase/garmin_field_reference.md). Every column is a jsonb lookup,
-- so a missing key yields null rather than an error.
--
-- Garmin attributes a night's sleep and HRV to the calendar date you wake up
-- on, so garmin_daily.sleep_* / hrv_* for date D describe the night D-1 -> D.
--
-- Both views run as security_invoker so the tables' RLS applies: the API
-- roles have no policies (and no grants), only the service role can read.

begin;

create or replace view public.garmin_daily
with (security_invoker = true) as
with
  ds as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'daily_summaries' and payload is not null and payload <> 'null'::jsonb
  ),
  sl as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'sleep' and payload is not null and payload <> 'null'::jsonb
  ),
  sls as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'sleep_summaries' and payload is not null and payload <> 'null'::jsonb
  ),
  -- per-day sleep record first, range summary as fallback
  slp as (
    select coalesce(sl.calendar_date, sls.calendar_date) as calendar_date,
           coalesce(sl.payload, sls.payload) as payload
    from sl full join sls on sls.calendar_date = sl.calendar_date
  ),
  hs as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'hrv_summaries' and payload is not null and payload <> 'null'::jsonb
  ),
  hd as (
    select calendar_date, payload -> 'hrvSummary' as payload from public.garmin_daily_raw
    where dataset = 'hrv' and payload is not null and payload <> 'null'::jsonb
  ),
  hrv as (
    select coalesce(hs.calendar_date, hd.calendar_date) as calendar_date,
           coalesce(hs.payload, hd.payload) as payload
    from hs full join hd on hd.calendar_date = hs.calendar_date
  ),
  bb as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'body_battery' and payload is not null and payload <> 'null'::jsonb
  ),
  st as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'stress' and payload is not null and payload <> 'null'::jsonb
  ),
  sp as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'steps' and payload is not null and payload <> 'null'::jsonb
  ),
  wt as (
    select calendar_date, payload from public.garmin_daily_raw
    where dataset = 'weight' and payload is not null and payload <> 'null'::jsonb
  ),
  days as (
    select distinct calendar_date from public.garmin_daily_raw where payload is not null and payload <> 'null'::jsonb
  )
select
  d.calendar_date,
  coalesce((ds.payload #>> '{movement,steps,value}')::integer,
           (sp.payload ->> 'totalSteps')::integer)                                   as steps,
  (ds.payload #>> '{heartRate,restingValue}')::integer                                as resting_hr,
  coalesce((ds.payload #>> '{stress,avgLevel}')::numeric,
           case when (st.payload #>> '{values,overallStressLevel}')::numeric >= 0
                then (st.payload #>> '{values,overallStressLevel}')::numeric end)    as avg_stress,
  (ds.payload #>> '{bodyBattery,maxValue}')::integer                                  as body_battery_high,
  (ds.payload #>> '{bodyBattery,minValue}')::integer                                  as body_battery_low,
  coalesce((ds.payload #>> '{bodyBattery,chargedValue}')::integer,
           (bb.payload ->> 'charged')::integer)                                       as body_battery_charged,
  coalesce((ds.payload #>> '{bodyBattery,drainedValue}')::integer,
           (bb.payload ->> 'drained')::integer)                                       as body_battery_drained,
  (slp.payload ->> 'sleepTimeSeconds')::integer                                       as sleep_total_s,
  (slp.payload ->> 'deepSleepSeconds')::integer                                       as deep_s,
  (slp.payload ->> 'lightSleepSeconds')::integer                                      as light_s,
  (slp.payload ->> 'remSleepSeconds')::integer                                        as rem_s,
  (slp.payload ->> 'awakeSleepSeconds')::integer                                      as awake_s,
  (slp.payload #>> '{sleepScores,overall,value}')::integer                            as sleep_score,
  (hrv.payload ->> 'lastNightAvg')::integer                                           as hrv_last_night_avg,
  (hrv.payload ->> 'weeklyAvg')::integer                                              as hrv_weekly_avg,
  hrv.payload ->> 'status'                                                            as hrv_status,
  (ds.payload #>> '{calories,burnedActive}')::integer                                 as active_kcal,
  (ds.payload #>> '{calories,burnedTotal}')::integer                                  as total_kcal,
  -- Garmin counts vigorous minutes double toward the weekly goal
  case when ds.payload ? 'intensityMinutes' then
    coalesce((ds.payload #>> '{intensityMinutes,moderate}')::integer, 0)
    + 2 * coalesce((ds.payload #>> '{intensityMinutes,vigorous}')::integer, 0)
  end                                                                                 as intensity_minutes,
  (wt.payload #>> '{latestWeight,weight}')::numeric / 1000.0                          as weight_kg
from days d
left join ds  on ds.calendar_date  = d.calendar_date
left join slp on slp.calendar_date = d.calendar_date
left join hrv on hrv.calendar_date = d.calendar_date
left join bb  on bb.calendar_date  = d.calendar_date
left join st  on st.calendar_date  = d.calendar_date
left join sp  on sp.calendar_date  = d.calendar_date
left join wt  on wt.calendar_date  = d.calendar_date;

comment on view public.garmin_daily is
  'One row per calendar date with the key Garmin metrics. sleep_*/hrv_* describe the night ending on that date.';

-- Tim's training days joined to Garmin recovery metrics.
-- user_id is timvancau@gmail.com in auth.users (profiles is empty).
create or replace view public.training_recovery
with (security_invoker = true) as
with
  me as (select 'e754e7e9-ff46-4788-a02a-a264db8d396d'::uuid as user_id),
  my_sessions as (
    select
      s.id                                               as session_id,
      (s.date at time zone 'America/New_York')::date     as session_date,
      s.date                                             as session_at,
      s.started_at,
      s.completed_at,
      s.notes,
      w.name                                             as workout_name,
      sp.name                                            as split_name
    from public.sessions s
    join me on me.user_id = s.user_id
    left join public.workouts w on w.id = s.workout_id
    left join public.splits sp on sp.id = w.split_id
  ),
  my_checkins as (
    select c.*
    from public.workout_checkins c
    join me on me.user_id = c.user_id
  ),
  days as (
    select session_date from my_sessions
    union
    select session_date from my_checkins
  )
select
  d.session_date,
  s.session_id,
  s.split_name,
  s.workout_name,
  s.session_at,
  s.started_at,
  s.completed_at,
  s.notes,
  c.id                       as checkin_id,
  c.split_name               as checkin_split_name,
  c.day_name                 as checkin_day_name,
  c.feel,
  c.effort,
  c.sleep                    as checkin_sleep,
  c.soreness,
  c.diet_quality,
  c.took_preworkout,
  -- same-day Garmin metrics
  g.steps,
  g.resting_hr,
  g.avg_stress,
  g.body_battery_high,
  g.body_battery_low,
  g.body_battery_charged,
  g.body_battery_drained,
  g.active_kcal,
  g.total_kcal,
  g.intensity_minutes,
  g.weight_kg,
  -- the night before training (Garmin files it under the wake-up date)
  g.sleep_total_s            as prior_night_sleep_total_s,
  g.deep_s                   as prior_night_deep_s,
  g.light_s                  as prior_night_light_s,
  g.rem_s                    as prior_night_rem_s,
  g.awake_s                  as prior_night_awake_s,
  g.sleep_score              as prior_night_sleep_score,
  g.hrv_last_night_avg       as prior_night_hrv_avg,
  g.hrv_weekly_avg,
  g.hrv_status,
  -- the night after training, for recovery
  n.sleep_total_s            as next_night_sleep_total_s,
  n.sleep_score              as next_night_sleep_score,
  n.hrv_last_night_avg       as next_night_hrv_avg
from days d
left join my_sessions s on s.session_date = d.session_date
left join lateral (
  select * from my_checkins c
  where c.session_date = d.session_date
  order by c.created_at desc
  limit 1
) c on true
left join public.garmin_daily g on g.calendar_date = d.session_date
left join public.garmin_daily n on n.calendar_date = d.session_date + 1
order by d.session_date desc, s.session_at desc;

comment on view public.training_recovery is
  'Tim''s sessions and check-ins (America/New_York dates) joined to Garmin metrics for that day, the night before, and the night after.';

revoke all on public.garmin_daily from anon, authenticated;
revoke all on public.training_recovery from anon, authenticated;

commit;
