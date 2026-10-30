# Garmin Personal API field reference

Field names below come from Garmin Connect Personal API responses (scrubbed
real responses plus the pydantic models generated from Garmin's OpenAPI spec).
Run `python scripts/garmin_backfill.py --inspect` to write your own samples to
`./samples/` (gitignored) and confirm every path in the `view fields` check.

Tables: `garmin_daily_raw (calendar_date, dataset, payload)` keeps each
dataset's per-day object verbatim; `garmin_activities` keeps
`{"summary": <search row>, "detail": <activity detail>}`.

| dataset | endpoint | kind | date key | window used (API max) |
|---|---|---|---|---|
| `daily_summaries` | `/usersummary-service/v2/dailysummaries` | range | `data[].calendarDate` | 28 (31; HTTP 500 beyond ~90) |
| `sleep` | `/sleep-service/sleep/dailySleep?date=` | per day | request date | 1 |
| `sleep_summaries` | `/sleep-service/sleep/dailySleepSummariesByDate` | range | `[].calendarDate` | 28 (31) |
| `hrv_summaries` | `/hrv-service/hrv/daily/{from}/{to}` | range | `hrvSummaries[].calendarDate` | 28 (365) |
| `hrv` | `/hrv-service/hrv/{date}` | per day | request date | 1 |
| `body_battery` | `/wellness-service/wellness/bodyBattery/reports/daily` | range | `[].date` | 28 (31) |
| `stress` | `/usersummary-service/stats/stress/daily/{from}/{to}` | range | `[].calendarDate` | 28 (28) |
| `steps` | `/usersummary-service/stats/steps/daily/{from}/{to}` | range | `[].calendarDate` | 28 (28) |
| `weight` | `/weight-service/weight/range/{from}/{to}?includeAll=true` | range | `dailyWeightSummaries[].summaryDate` | 28 (~365) |
| `wellness_activities` | `/wellnessactivity-service/activity/summary/range/{from}/{to}` | range | `[].calendarDate` (array per date) | 28 |
| `activities` | `/activitylist-service/activities/search/activities` + `/activity-service/activity/{id}` | paged | `startTimeLocal` | 28-day chunks, 20 per page (500 above ~45) |

The script starts every range dataset at 28 days and halves the window on
HTTP 400 (or 500 for daily summaries). `--inspect` reports the largest window
that worked.

## `garmin_daily` view columns

| column | dataset | JSON path | fallback |
|---|---|---|---|
| `steps` | daily_summaries | `movement.steps.value` | steps `totalSteps` |
| `resting_hr` | daily_summaries | `heartRate.restingValue` | |
| `avg_stress` | daily_summaries | `stress.avgLevel` | stress `values.overallStressLevel` (if >= 0) |
| `body_battery_high` | daily_summaries | `bodyBattery.maxValue` | |
| `body_battery_low` | daily_summaries | `bodyBattery.minValue` | |
| `body_battery_charged` | daily_summaries | `bodyBattery.chargedValue` | body_battery `charged` |
| `body_battery_drained` | daily_summaries | `bodyBattery.drainedValue` | body_battery `drained` |
| `sleep_total_s` | sleep | `sleepTimeSeconds` | sleep_summaries same path |
| `deep_s` / `light_s` / `rem_s` / `awake_s` | sleep | `deepSleepSeconds` / `lightSleepSeconds` / `remSleepSeconds` / `awakeSleepSeconds` | sleep_summaries |
| `sleep_score` | sleep | `sleepScores.overall.value` | sleep_summaries |
| `hrv_last_night_avg` | hrv_summaries | `lastNightAvg` | hrv `hrvSummary.lastNightAvg` |
| `hrv_weekly_avg` | hrv_summaries | `weeklyAvg` | hrv `hrvSummary.weeklyAvg` |
| `hrv_status` | hrv_summaries | `status` (`BALANCED`, `UNBALANCED`, `LOW`, `POOR`, `NONE`, `INVALID`) | hrv `hrvSummary.status` |
| `active_kcal` | daily_summaries | `calories.burnedActive` | |
| `total_kcal` | daily_summaries | `calories.burnedTotal` | |
| `intensity_minutes` | daily_summaries | `intensityMinutes.moderate + 2 * intensityMinutes.vigorous` | |
| `weight_kg` | weight | `latestWeight.weight / 1000` (Garmin stores grams) | |

Garmin files a night's sleep and HRV under the date you wake up, so the
`sleep_*` and `hrv_*` columns for date D describe the night D-1 to D. The
`training_recovery` view labels them `prior_night_*` for that reason and adds
`next_night_*` from D+1.

## Other useful raw fields

- `daily_summaries`: `heartRate.minValue/maxValue`, `stress.maxLevel`,
  `stress.*Proportion`, `bodyBattery.latestValue/endOfDayValue`,
  `respiration.avgValue`, `pulseOx.avgValue`, `hydration.consumedInMl`,
  `movement.floorsAscended.value`, `wellnessChronology.*`.
- `sleep`: `napTimeSeconds`, `avgSleepStress`, `avgHeartRate`, `awakeCount`,
  `averageRespirationValue`, `sleepScores.{totalDuration,stress,awakeCount,restlessness,remPercentage,lightPercentage,deepPercentage}.{value,qualifierKey}`,
  `sleepNeed.{baseline,actual,feedback}`, `sleepStart/EndTimestampGMT` (epoch ms).
- `hrv`: `hrvSummary.lastNight5MinHigh`, `hrvSummary.baseline.{lowUpper,balancedLow,balancedUpper}`,
  `hrvReadings[].{hrvValue,readingTimeGMT}`.
- `body_battery`: `bodyBatteryValuesArray` (intraday, see `bodyBatteryValueDescriptorDTOList`),
  `bodyBatteryActivityEvent[]`.
- `stress`: `values.{restStressDuration,lowStressDuration,mediumStressDuration,highStressDuration}` (seconds).
- `steps`: `totalDistance` (m), `stepGoal`.
- `weight`: `latestWeight.{bmi,bodyFat,bodyWater,muscleMass,boneMass,sourceType}`, `allWeightMetrics[]`.
- `activities.summary`: `activityType.typeKey`, `startTimeGMT`, `elapsedDuration`,
  `movingDuration`, `bmrCalories`, `steps`, `summarizedExerciseSets[]`.
- `activities.detail`: `summaryDTO.{trainingEffect,anaerobicTrainingEffect,activityTrainingLoad,trainingEffectLabel,moderateIntensityMinutes,vigorousIntensityMinutes,differenceBodyBattery,totalExerciseReps,activeSets}`.
