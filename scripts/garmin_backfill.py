#!/usr/bin/env python3
"""
Backfill Garmin Connect Personal API data into Supabase (raw-first).

Every response is stored verbatim as jsonb in `garmin_daily_raw`
(one row per calendar date per dataset) or `garmin_activities`
(one row per activity). The clean `garmin_daily` / `training_recovery`
views are built on top of those tables, so nothing is ever lost.

Credentials come from `.env` in the repo root (never printed):

    GARMIN_PERSONAL_API_KEY      personal API key from Garmin Connect settings
    SUPABASE_URL                 https://<project>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    service role key (RLS has no policies for these tables)

Install:   python3 -m pip install -r scripts/requirements-garmin.txt   (Python 3.12+)

Usage:
    python scripts/garmin_backfill.py --inspect              # step 1: samples + field names + window probe
    python scripts/garmin_backfill.py                        # backfill 2026-02-23 .. today, all datasets
    python scripts/garmin_backfill.py --start 2026-09-01 --datasets sleep,hrv,activities
    python scripts/garmin_backfill.py --force                # refetch everything in range
    python scripts/garmin_backfill.py --dry-run              # fetch but write nothing to Supabase

Behaviour:
    * Range endpoints are fetched in windows (default 28 days). A 400 (or 500 on
      daily summaries, which Garmin returns for windows it says it supports)
      halves the window and retries.
    * Per-day endpoints (sleep, hrv) loop daily.
    * Upserts are idempotent. Dates already in `garmin_daily_raw` are skipped
      unless --force, except the last --refresh-days days, which Garmin may
      still be updating.
    * A date Garmin returned nothing for gets a row with a null payload, so the
      next run knows it was fetched. --force refetches those too.
    * 429/5xx: exponential backoff. 401: one forced token refresh, then retry.
    * Every chunk is logged to `garmin_sync_runs`.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
import time
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from garmin_personal_api import (
    GarminPersonalApiClient,
    HttpError,
    PersonalApiAuthenticator,
    resolve_api_key,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_START = date(2026, 2, 23)  # first day the watch was worn daily
DEFAULT_WINDOW_DAYS = 28
DEFAULT_REFRESH_DAYS = 3
DEFAULT_DELAY_SECONDS = 0.5
DEFAULT_PAGE_SIZE = 20  # activity search 500s above ~45 per page
DEFAULT_TOKEN_CACHE = REPO_ROOT / ".garmin-bearer-token.json"  # gitignored
SAMPLES_DIR = REPO_ROOT / "samples"  # gitignored (personal health data)
UPSERT_BATCH = 200
MAX_ERROR_TEXT = 2000

log = logging.getLogger("garmin_backfill")
Json = Any
Params = list[tuple[str, str]]


# ----------------------------------------------------------------------------
# .env
# ----------------------------------------------------------------------------


def load_dotenv(path: Path) -> None:
    """Minimal KEY=VALUE loader; existing environment variables win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


# ----------------------------------------------------------------------------
# Dates
# ----------------------------------------------------------------------------


def daterange(start: date, end: date) -> Iterator[date]:
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=1)


def contiguous_runs(days: Iterable[date]) -> list[tuple[date, date]]:
    runs: list[tuple[date, date]] = []
    for day in sorted(set(days)):
        if runs and runs[-1][1] + timedelta(days=1) == day:
            runs[-1] = (runs[-1][0], day)
        else:
            runs.append((day, day))
    return runs


def format_runs(days: Iterable[date]) -> str:
    parts = []
    for a, b in contiguous_runs(days):
        parts.append(a.isoformat() if a == b else f"{a.isoformat()}..{b.isoformat()}")
    return ", ".join(parts) if parts else "none"


def parse_date(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {text!r}") from exc


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------------
# Dataset registry
# ----------------------------------------------------------------------------

Splitter = Callable[[Json], dict[str, Json]]


def _by_key(items: Json, key: str, *, group: bool = False) -> dict[str, Json]:
    """Index a list of per-day objects by their date field.

    With group=True several objects for one date are kept as a list
    (wellness activities can occur more than once per day).
    """
    out: dict[str, Json] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        day = item.get(key)
        if not isinstance(day, str):
            continue
        day = day[:10]
        if group:
            out.setdefault(day, []).append(item)
        else:
            out[day] = item
    return out


def _nested(key: str, inner: str) -> Splitter:
    return lambda resp: _by_key((resp or {}).get(key) if isinstance(resp, dict) else None, inner)


@dataclass(frozen=True)
class Dataset:
    name: str
    kind: str  # "range" | "daily" | "activities"
    fetch: Callable[..., Json] | None
    split: Splitter | None
    note: str


DATASETS: dict[str, Dataset] = {
    "daily_summaries": Dataset(
        "daily_summaries", "range", GarminPersonalApiClient.get_daily_summaries,
        _nested("data", "calendarDate"),
        "/usersummary-service/v2/dailysummaries: steps, resting HR, stress, body battery, calories, intensity minutes",
    ),
    "sleep": Dataset(
        "sleep", "daily", GarminPersonalApiClient.get_daily_sleep, None,
        "/sleep-service/sleep/dailySleep: full sleep record incl. sleepScores",
    ),
    "sleep_summaries": Dataset(
        "sleep_summaries", "range", GarminPersonalApiClient.get_daily_sleep_summaries,
        lambda resp: _by_key(resp, "calendarDate"),
        "/sleep-service/sleep/dailySleepSummariesByDate",
    ),
    "hrv_summaries": Dataset(
        "hrv_summaries", "range", GarminPersonalApiClient.get_daily_hrv_summaries,
        _nested("hrvSummaries", "calendarDate"),
        "/hrv-service/hrv/daily: lastNightAvg, weeklyAvg, status",
    ),
    "hrv": Dataset(
        "hrv", "daily", GarminPersonalApiClient.get_daily_hrv, None,
        "/hrv-service/hrv/{date}: hrvSummary + overnight readings",
    ),
    "body_battery": Dataset(
        "body_battery", "range", GarminPersonalApiClient.get_daily_body_battery,
        lambda resp: _by_key(resp, "date"),
        "/wellness-service/wellness/bodyBattery/reports/daily: charged, drained, intraday values",
    ),
    "stress": Dataset(
        "stress", "range", GarminPersonalApiClient.get_daily_stress,
        lambda resp: _by_key(resp, "calendarDate"),
        "/usersummary-service/stats/stress/daily: values.overallStressLevel + durations",
    ),
    "steps": Dataset(
        "steps", "range", GarminPersonalApiClient.get_daily_steps,
        lambda resp: _by_key(resp, "calendarDate"),
        "/usersummary-service/stats/steps/daily: totalSteps, totalDistance, stepGoal",
    ),
    "weight": Dataset(
        "weight", "range", GarminPersonalApiClient.get_weight_measurements,
        _nested("dailyWeightSummaries", "summaryDate"),
        "/weight-service/weight/range: dailyWeightSummaries (grams)",
    ),
    "wellness_activities": Dataset(
        "wellness_activities", "range", GarminPersonalApiClient.get_wellness_activity_summaries,
        lambda resp: _by_key(resp, "calendarDate", group=True),
        "/wellnessactivity-service/activity/summary/range: list per date",
    ),
    "activities": Dataset(
        "activities", "activities", None, None,
        "search_activities (paged) + get_activity detail -> garmin_activities",
    ),
}

# JSON paths the garmin_daily view reads. --inspect checks they resolve.
VIEW_PATHS: dict[str, dict[str, list[str]]] = {
    "daily_summaries": {
        "steps": ["movement", "steps", "value"],
        "resting_hr": ["heartRate", "restingValue"],
        "avg_stress": ["stress", "avgLevel"],
        "body_battery_high": ["bodyBattery", "maxValue"],
        "body_battery_low": ["bodyBattery", "minValue"],
        "body_battery_charged": ["bodyBattery", "chargedValue"],
        "body_battery_drained": ["bodyBattery", "drainedValue"],
        "active_kcal": ["calories", "burnedActive"],
        "total_kcal": ["calories", "burnedTotal"],
        "intensity_moderate": ["intensityMinutes", "moderate"],
        "intensity_vigorous": ["intensityMinutes", "vigorous"],
    },
    "sleep": {
        "sleep_total_s": ["sleepTimeSeconds"],
        "deep_s": ["deepSleepSeconds"],
        "light_s": ["lightSleepSeconds"],
        "rem_s": ["remSleepSeconds"],
        "awake_s": ["awakeSleepSeconds"],
        "sleep_score": ["sleepScores", "overall", "value"],
    },
    "sleep_summaries": {
        "sleep_total_s": ["sleepTimeSeconds"],
        "sleep_score": ["sleepScores", "overall", "value"],
    },
    "hrv_summaries": {
        "hrv_last_night_avg": ["lastNightAvg"],
        "hrv_weekly_avg": ["weeklyAvg"],
        "hrv_status": ["status"],
    },
    "hrv": {
        "hrv_last_night_avg": ["hrvSummary", "lastNightAvg"],
        "hrv_weekly_avg": ["hrvSummary", "weeklyAvg"],
        "hrv_status": ["hrvSummary", "status"],
    },
    "body_battery": {"charged": ["charged"], "drained": ["drained"]},
    "stress": {"avg_stress": ["values", "overallStressLevel"]},
    "steps": {"steps": ["totalSteps"]},
    "weight": {"weight_g": ["latestWeight", "weight"]},
}


def select_datasets(spec: str | None) -> list[Dataset]:
    if not spec or spec == "all":
        return list(DATASETS.values())
    out = []
    for name in spec.split(","):
        name = name.strip()
        if name not in DATASETS:
            raise SystemExit(f"unknown dataset {name!r}; choose from: {', '.join(DATASETS)}")
        out.append(DATASETS[name])
    return out


# ----------------------------------------------------------------------------
# Garmin client with retries
# ----------------------------------------------------------------------------


class Garmin:
    """Wraps the official client with a polite delay, backoff and 401 refresh."""

    def __init__(
        self,
        api_key: str,
        *,
        token_cache: Path,
        delay: float,
        max_retries: int = 5,
    ) -> None:
        self._api_key = api_key
        self._auth = PersonalApiAuthenticator(bearer_token_cache_file=token_cache)
        token = self._auth.obtain_token(api_key)
        self.client = GarminPersonalApiClient(token.access_token)
        self.delay = delay
        self.max_retries = max_retries
        self.calls = 0

    def refresh_token(self) -> None:
        token = self._auth.obtain_token(self._api_key, force_refresh=True)
        self.client.update_bearer_token(token.access_token)

    def call(self, fn: Callable[..., Json], *args: Any, **kwargs: Any) -> Json:
        """Call `fn(client, ...)`. Returns None for 204/404 (no data).

        Raises HttpError for 400 and for 429/5xx once retries are exhausted.
        """
        refreshed = False
        attempt = 0
        while True:
            if self.calls:
                time.sleep(self.delay)
            self.calls += 1
            try:
                return fn(self.client, *args, **kwargs)
            except HttpError as exc:
                status = exc.status_code
                if status == 401 and not refreshed:
                    log.warning("401 from Garmin; refreshing bearer token once")
                    refreshed = True
                    self.refresh_token()
                    continue
                if status == 404:
                    return None
                if (status == 429 or status >= 500) and attempt < self.max_retries:
                    attempt += 1
                    wait = min(60.0, 2.0**attempt + random.uniform(0, 1))
                    log.warning("HTTP %s from Garmin; retry %d/%d in %.1fs", status, attempt, self.max_retries, wait)
                    time.sleep(wait)
                    continue
                raise
            except requests.RequestException as exc:
                if attempt < self.max_retries:
                    attempt += 1
                    wait = min(60.0, 2.0**attempt + random.uniform(0, 1))
                    log.warning("network error (%s); retry %d/%d in %.1fs", type(exc).__name__, attempt, self.max_retries, wait)
                    time.sleep(wait)
                    continue
                raise


# ----------------------------------------------------------------------------
# Supabase (PostgREST) store
# ----------------------------------------------------------------------------


class Store:
    """Thin PostgREST client using the service role key."""

    def __init__(self, url: str, service_key: str, *, dry_run: bool = False) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.dry_run = dry_run
        self._session = requests.Session()
        self._session.headers.update(
            {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
        )

    # -- low level -----------------------------------------------------------

    def _request(self, method: str, table: str, *, params: Params | None = None, json_body: Json = None, prefer: str | None = None) -> Json:
        headers = {"Prefer": prefer} if prefer else {}
        resp = self._session.request(method, f"{self.base}/{table}", params=params, json=json_body, headers=headers, timeout=60)
        if not resp.ok:
            raise RuntimeError(f"Supabase {method} {table} -> HTTP {resp.status_code}: {resp.text[:500]}")
        return resp.json() if resp.content else None

    def _select_all(self, table: str, params: Params) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset, limit = 0, 1000
        while True:
            page = self._request("GET", table, params=[*params, ("limit", str(limit)), ("offset", str(offset))]) or []
            rows.extend(page)
            if len(page) < limit:
                return rows
            offset += limit

    # -- garmin_daily_raw ----------------------------------------------------

    def _daily_filter(self, dataset: str, start: date, end: date) -> Params:
        return [
            ("select", "calendar_date"),
            ("dataset", f"eq.{dataset}"),
            ("calendar_date", f"gte.{start.isoformat()}"),
            ("calendar_date", f"lte.{end.isoformat()}"),
        ]

    def fetched_dates(self, dataset: str, start: date, end: date, *, only_with_payload: bool = False) -> set[date]:
        if self.dry_run:
            return set()
        params = self._daily_filter(dataset, start, end)
        if only_with_payload:
            params.append(("payload", "not.is.null"))
        return {date.fromisoformat(r["calendar_date"]) for r in self._select_all("garmin_daily_raw", params)}

    def empty_dates(self, dataset: str, start: date, end: date) -> set[date]:
        if self.dry_run:
            return set()
        params = [*self._daily_filter(dataset, start, end), ("payload", "is.null")]
        return {date.fromisoformat(r["calendar_date"]) for r in self._select_all("garmin_daily_raw", params)}

    def upsert_daily(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        if self.dry_run:
            log.info("[dry-run] would upsert %d garmin_daily_raw rows (%s)", len(rows), rows[0]["dataset"])
            return
        for i in range(0, len(rows), UPSERT_BATCH):
            self._request(
                "POST",
                "garmin_daily_raw",
                params=[("on_conflict", "calendar_date,dataset")],
                json_body=rows[i : i + UPSERT_BATCH],
                prefer="resolution=merge-duplicates,return=minimal",
            )

    # -- garmin_activities ---------------------------------------------------

    def existing_activity_ids(self, start: date, end: date) -> set[int]:
        if self.dry_run:
            return set()
        params = [
            ("select", "activity_id"),
            ("start_time_local", f"gte.{start.isoformat()}T00:00:00"),
            ("start_time_local", f"lte.{end.isoformat()}T23:59:59"),
        ]
        return {int(r["activity_id"]) for r in self._select_all("garmin_activities", params)}

    def count_activities(self, start: date, end: date) -> int:
        if self.dry_run:
            return 0
        return len(self.existing_activity_ids(start, end))

    def upsert_activities(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        if self.dry_run:
            log.info("[dry-run] would upsert %d garmin_activities rows", len(rows))
            return
        for i in range(0, len(rows), UPSERT_BATCH):
            self._request(
                "POST",
                "garmin_activities",
                params=[("on_conflict", "activity_id")],
                json_body=rows[i : i + UPSERT_BATCH],
                prefer="resolution=merge-duplicates,return=minimal",
            )

    # -- garmin_sync_runs ----------------------------------------------------

    def start_run(self, dataset: str, range_start: date, range_end: date) -> int | None:
        if self.dry_run:
            return None
        rows = self._request(
            "POST",
            "garmin_sync_runs",
            json_body={"dataset": dataset, "range_start": range_start.isoformat(), "range_end": range_end.isoformat(), "status": "running"},
            prefer="return=representation",
        )
        return int(rows[0]["id"])

    def finish_run(self, run_id: int | None, status: str, error: str | None = None) -> None:
        if self.dry_run or run_id is None:
            return
        body: dict[str, Any] = {"finished_at": now_iso(), "status": status}
        if error:
            body["error"] = error[:MAX_ERROR_TEXT]
        self._request("PATCH", "garmin_sync_runs", params=[("id", f"eq.{run_id}")], json_body=body, prefer="return=minimal")


# ----------------------------------------------------------------------------
# Sync logic
# ----------------------------------------------------------------------------


@dataclass
class Outcome:
    chunks: int = 0
    errors: list[str] | None = None
    window: int = DEFAULT_WINDOW_DAYS

    def fail(self, message: str) -> None:
        if self.errors is None:
            self.errors = []
        self.errors.append(message)


def _daily_rows(dataset: str, days: Iterable[date], split: dict[str, Json], fetched_at: str) -> list[dict[str, Any]]:
    return [
        {"calendar_date": d.isoformat(), "dataset": dataset, "payload": split.get(d.isoformat()), "fetched_at": fetched_at}
        for d in days
    ]


def dates_to_fetch(store: Store, dataset: str, start: date, end: date, *, force: bool, refresh_from: date) -> list[date]:
    if force:
        return list(daterange(start, end))
    fetched = store.fetched_dates(dataset, start, end)
    return [d for d in daterange(start, end) if d >= refresh_from or d not in fetched]


def sync_range(ds: Dataset, garmin: Garmin, store: Store, start: date, end: date, *, window: int, force: bool, refresh_from: date) -> Outcome:
    assert ds.fetch and ds.split
    out = Outcome(window=window)
    need = dates_to_fetch(store, ds.name, start, end, force=force, refresh_from=refresh_from)
    if not need:
        log.info("%-20s nothing to fetch", ds.name)
        return out
    log.info("%-20s %d day(s) to fetch: %s", ds.name, len(need), format_runs(need))
    for run_start, run_end in contiguous_runs(need):
        cur = run_start
        while cur <= run_end:
            chunk_end = min(cur + timedelta(days=out.window - 1), run_end)
            run_id = store.start_run(ds.name, cur, chunk_end)
            try:
                resp = garmin.call(ds.fetch, cur, chunk_end)
            except HttpError as exc:
                span = (chunk_end - cur).days + 1
                shrinkable = exc.status_code in (400, 500) and span > 1
                if shrinkable:
                    new_window = max(1, span // 2)
                    msg = f"HTTP {exc.status_code} for {span}-day window; shrinking window to {new_window}"
                    log.warning("%-20s %s", ds.name, msg)
                    store.finish_run(run_id, "error", msg)
                    out.window = new_window
                    continue  # retry same start with the smaller window
                msg = f"{cur}..{chunk_end}: {exc}"
                log.error("%-20s %s", ds.name, msg)
                store.finish_run(run_id, "error", str(exc))
                out.fail(msg)
                cur = chunk_end + timedelta(days=1)
                continue
            except Exception as exc:  # network after retries, auth, etc.
                msg = f"{cur}..{chunk_end}: {exc}"
                log.error("%-20s %s", ds.name, msg)
                store.finish_run(run_id, "error", str(exc))
                out.fail(msg)
                cur = chunk_end + timedelta(days=1)
                continue
            split = ds.split(resp)
            rows = _daily_rows(ds.name, daterange(cur, chunk_end), split, now_iso())
            try:
                store.upsert_daily(rows)
            except Exception as exc:
                msg = f"{cur}..{chunk_end}: store failed: {exc}"
                log.error("%-20s %s", ds.name, msg)
                store.finish_run(run_id, "error", str(exc))
                out.fail(msg)
                cur = chunk_end + timedelta(days=1)
                continue
            got = sum(1 for r in rows if r["payload"] is not None)
            log.info("%-20s %s..%s  %d/%d day(s) with data", ds.name, cur, chunk_end, got, len(rows))
            store.finish_run(run_id, "success" if got else "empty")
            out.chunks += 1
            cur = chunk_end + timedelta(days=1)
    return out


def sync_daily(ds: Dataset, garmin: Garmin, store: Store, start: date, end: date, *, force: bool, refresh_from: date) -> Outcome:
    assert ds.fetch
    out = Outcome(window=1)
    need = dates_to_fetch(store, ds.name, start, end, force=force, refresh_from=refresh_from)
    if not need:
        log.info("%-20s nothing to fetch", ds.name)
        return out
    log.info("%-20s %d day(s) to fetch: %s", ds.name, len(need), format_runs(need))
    for day in need:
        run_id = store.start_run(ds.name, day, day)
        try:
            resp = garmin.call(ds.fetch, day)
        except Exception as exc:
            msg = f"{day}: {exc}"
            log.error("%-20s %s", ds.name, msg)
            store.finish_run(run_id, "error", str(exc))
            out.fail(msg)
            continue
        payload = resp if resp not in (None, {}, []) else None
        try:
            store.upsert_daily(_daily_rows(ds.name, [day], {day.isoformat(): payload}, now_iso()))
        except Exception as exc:
            msg = f"{day}: store failed: {exc}"
            log.error("%-20s %s", ds.name, msg)
            store.finish_run(run_id, "error", str(exc))
            out.fail(msg)
            continue
        store.finish_run(run_id, "success" if payload is not None else "empty")
        out.chunks += 1
        log.info("%-20s %s  %s", ds.name, day, "ok" if payload is not None else "no data")
    return out


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _int(value: Any) -> int | None:
    num = _num(value)
    return int(round(num)) if num is not None else None


def activity_row(summary: dict[str, Any], detail: Json, fetched_at: str) -> dict[str, Any]:
    """Flatten a search row (plus detail) into a garmin_activities row."""
    d_summary = detail.get("summaryDTO", {}) if isinstance(detail, dict) else {}
    d_type = detail.get("activityTypeDTO", {}) if isinstance(detail, dict) else {}

    def pick(key_search: str, key_detail: str | None = None) -> Any:
        value = summary.get(key_search)
        if value is None and key_detail:
            value = d_summary.get(key_detail)
        return value

    activity_type = (summary.get("activityType") or {}).get("typeKey") or d_type.get("typeKey")
    return {
        "activity_id": int(summary["activityId"]),
        "start_time_local": pick("startTimeLocal", "startTimeLocal"),
        "activity_type": activity_type,
        "activity_name": summary.get("activityName") or (detail.get("activityName") if isinstance(detail, dict) else None),
        "duration_s": _num(pick("duration", "duration")),
        "distance_m": _num(pick("distance", "distance")),
        "avg_hr": _int(pick("averageHR", "averageHR")),
        "max_hr": _int(pick("maxHR", "maxHR")),
        "calories": _num(pick("calories", "calories")),
        "aerobic_te": _num(pick("aerobicTrainingEffect", "trainingEffect")),
        "anaerobic_te": _num(pick("anaerobicTrainingEffect", "anaerobicTrainingEffect")),
        "payload": {"summary": summary, "detail": detail},
        "fetched_at": fetched_at,
    }


def search_all(garmin: Garmin, start: date, end: date, *, page_size: int) -> list[dict[str, Any]]:
    """Page through search_activities for an inclusive local-date range."""
    found: list[dict[str, Any]] = []
    seen: set[int] = set()
    offset = 0
    while True:
        page = garmin.call(
            GarminPersonalApiClient.search_activities,
            start=offset,
            limit=page_size,
            start_date=start,
            end_date=end,
        ) or []
        for item in page:
            if isinstance(item, dict) and item.get("activityId") not in seen:
                seen.add(item["activityId"])
                found.append(item)
        if len(page) < page_size:
            return found
        offset += page_size


def sync_activities(garmin: Garmin, store: Store, start: date, end: date, *, window: int, force: bool, refresh_from: date, page_size: int) -> Outcome:
    out = Outcome(window=window)
    existing = set() if force else store.existing_activity_ids(start, end)
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=window - 1), end)
        run_id = store.start_run("activities", cur, chunk_end)
        try:
            summaries = search_all(garmin, cur, chunk_end, page_size=page_size)
            rows = []
            for summary in summaries:
                aid = int(summary["activityId"])
                start_local = str(summary.get("startTimeLocal") or "")[:10]
                recent = bool(start_local) and date.fromisoformat(start_local) >= refresh_from
                if aid in existing and not recent:
                    continue
                detail = garmin.call(GarminPersonalApiClient.get_activity, aid)
                rows.append(activity_row(summary, detail, now_iso()))
            store.upsert_activities(rows)
            log.info("%-20s %s..%s  %d found, %d fetched", "activities", cur, chunk_end, len(summaries), len(rows))
            store.finish_run(run_id, "success" if rows else ("empty" if not summaries else "skipped"))
            out.chunks += 1
        except Exception as exc:
            msg = f"{cur}..{chunk_end}: {exc}"
            log.error("%-20s %s", "activities", msg)
            store.finish_run(run_id, "error", str(exc))
            out.fail(msg)
        cur = chunk_end + timedelta(days=1)
    return out


# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------


def print_summary(store: Store, datasets: list[Dataset], start: date, end: date, outcomes: dict[str, Outcome]) -> bool:
    expected = set(daterange(start, end))
    print()
    print(f"Summary {start} .. {end} ({len(expected)} days)")
    print(f"{'dataset':20} {'with data':>9} {'empty':>6} {'missing':>8}  window  notes")
    ok = True
    for ds in datasets:
        outcome = outcomes.get(ds.name, Outcome())
        if ds.kind == "activities":
            count = store.count_activities(start, end)
            print(f"{ds.name:20} {count:>9} {'-':>6} {'-':>8}  {outcome.window:>6}  activities in range")
        else:
            with_data = store.fetched_dates(ds.name, start, end, only_with_payload=True)
            empty = store.empty_dates(ds.name, start, end)
            missing = expected - with_data - empty
            print(f"{ds.name:20} {len(with_data):>9} {len(empty):>6} {len(missing):>8}  {outcome.window:>6}")
            if empty:
                print(f"{'':20} empty (Garmin had no data): {format_runs(empty)}")
            if missing:
                print(f"{'':20} never fetched: {format_runs(missing)}")
        if outcome.errors:
            ok = False
            for err in outcome.errors:
                print(f"{'':20} ERROR {err}")
    return ok


# ----------------------------------------------------------------------------
# Inspect mode (step 1)
# ----------------------------------------------------------------------------


def describe(value: Json, *, depth: int = 0, max_depth: int = 2, indent: str = "    ") -> list[str]:
    """Human-readable field listing: keys with scalar types, nested objects expanded."""
    lines: list[str] = []
    pad = indent * depth
    if isinstance(value, dict):
        for key, val in value.items():
            if isinstance(val, dict):
                if depth < max_depth:
                    lines.append(f"{pad}{key}: {{")
                    lines.extend(describe(val, depth=depth + 1, max_depth=max_depth))
                    lines.append(f"{pad}}}")
                else:
                    lines.append(f"{pad}{key}: {{{', '.join(list(val)[:12])}{', ...' if len(val) > 12 else ''}}}")
            elif isinstance(val, list):
                first = val[0] if val else None
                if isinstance(first, dict):
                    lines.append(f"{pad}{key}: [{len(val)} x {{{', '.join(list(first)[:12])}{', ...' if len(first) > 12 else ''}}}]")
                else:
                    lines.append(f"{pad}{key}: [{len(val)} x {type(first).__name__ if val else '?'}]")
            else:
                lines.append(f"{pad}{key}: {type(val).__name__}")
    elif isinstance(value, list):
        lines.append(f"{pad}list of {len(value)}")
        if value:
            lines.extend(describe(value[0], depth=depth, max_depth=max_depth))
    else:
        lines.append(f"{pad}{type(value).__name__}")
    return lines


def _walk(payload: Json, path: list[str]) -> Any:
    cur = payload
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def save_sample(name: str, payload: Json) -> Path:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    path = SAMPLES_DIR / f"{name}.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def probe_window(ds: Dataset, garmin: Garmin, end: date, *, start_days: int) -> tuple[int | None, str]:
    """Try a window of `start_days`, halving on 400/500. Returns (largest working window, note)."""
    assert ds.fetch
    days = start_days
    tried: list[str] = []
    while days >= 1:
        start = end - timedelta(days=days - 1)
        try:
            garmin.call(ds.fetch, start, end)
            tried.append(f"{days}d ok")
            return days, "; ".join(tried)
        except HttpError as exc:
            tried.append(f"{days}d -> HTTP {exc.status_code}")
            if exc.status_code not in (400, 500):
                return None, "; ".join(tried)
            days //= 2
    return None, "; ".join(tried)


def inspect(garmin: Garmin, datasets: list[Dataset], *, day: date, probe_days: int, page_size: int) -> None:
    week_start = day - timedelta(days=6)
    print(f"Inspecting with day={day} and range={week_start}..{day}; samples -> {SAMPLES_DIR}")
    windows: dict[str, str] = {}
    for ds in datasets:
        print(f"\n=== {ds.name}  ({ds.note})")
        try:
            if ds.kind == "range":
                assert ds.fetch and ds.split
                one = garmin.call(ds.fetch, day, day)
                week = garmin.call(ds.fetch, week_start, day)
                p1 = save_sample(f"{ds.name}_1d", one)
                p7 = save_sample(f"{ds.name}_7d", week)
                print(f"saved {p1.name}, {p7.name}")
                split = ds.split(week)
                print(f"7-day range split into {len(split)} date(s): {', '.join(sorted(split))}")
                sample_payload = next(iter(split.values()), None)
                if isinstance(sample_payload, list):
                    sample_payload = sample_payload[0] if sample_payload else None
                print("per-day fields:")
                print("\n".join(describe(sample_payload if sample_payload is not None else week)))
                best, note = probe_window(ds, garmin, day, start_days=probe_days)
                windows[ds.name] = f"{best}d" if best else "FAILED"
                print(f"max window probe: {note}")
            elif ds.kind == "daily":
                assert ds.fetch
                resp = garmin.call(ds.fetch, day)
                path = save_sample(f"{ds.name}_{day.isoformat()}", resp)
                print(f"saved {path.name}")
                print("fields:")
                print("\n".join(describe(resp)))
                sample_payload = resp
            else:
                summaries = search_all(garmin, week_start, day, page_size=page_size)
                path = save_sample("activities_search_7d", summaries)
                print(f"saved {path.name} ({len(summaries)} activities)")
                if summaries:
                    detail = garmin.call(GarminPersonalApiClient.get_activity, summaries[0]["activityId"])
                    path = save_sample(f"activity_{summaries[0]['activityId']}", detail)
                    print(f"saved {path.name}")
                    print("search row fields:")
                    print("\n".join(describe(summaries[0], max_depth=1)))
                    print("detail fields:")
                    print("\n".join(describe(detail, max_depth=1)))
                    row = activity_row(summaries[0], detail, now_iso())
                    row.pop("payload")
                    print(f"garmin_activities row: {json.dumps(row, default=str)}")
                continue
            paths = VIEW_PATHS.get(ds.name)
            if paths and sample_payload is not None:
                print("view fields:")
                for column, path in paths.items():
                    value = _walk(sample_payload, path)
                    status = "MISSING" if value is None else repr(value)
                    print(f"    {column:22} {'.'.join(path):40} {status}")
        except Exception as exc:
            print(f"FAILED: {exc}")
    if windows:
        print("\nRange window probe results:")
        for name, result in windows.items():
            print(f"    {name:22} {result}")


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", type=parse_date, default=DEFAULT_START, help=f"first calendar date (default {DEFAULT_START})")
    parser.add_argument("--end", type=parse_date, default=None, help="last calendar date (default today)")
    parser.add_argument("--datasets", default="all", help=f"comma list or 'all': {', '.join(DATASETS)}")
    parser.add_argument("--force", action="store_true", help="refetch dates already stored")
    parser.add_argument("--refresh-days", type=int, default=DEFAULT_REFRESH_DAYS, help="always refetch the last N days (default %(default)s)")
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW_DAYS, help="days per range request (default %(default)s; shrinks on 400)")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE, help="activities per search page (default %(default)s)")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS, help="seconds between Garmin calls (default %(default)s)")
    parser.add_argument("--dry-run", action="store_true", help="fetch from Garmin but write nothing to Supabase")
    parser.add_argument("--inspect", action="store_true", help="step 1: save samples to ./samples, print field names, probe windows")
    parser.add_argument("--inspect-day", type=parse_date, default=None, help="day to inspect (default yesterday)")
    parser.add_argument("--env-file", type=Path, default=REPO_ROOT / ".env")
    parser.add_argument("--token-cache", type=Path, default=DEFAULT_TOKEN_CACHE, help="bearer token cache file (gitignored)")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
    if not args.verbose:
        logging.getLogger("garmin_personal_api").setLevel(logging.WARNING)

    load_dotenv(args.env_file)
    today = date.today()
    end = args.end or today
    if args.start > end:
        raise SystemExit(f"--start {args.start} is after --end {end}")
    if args.window < 1:
        raise SystemExit("--window must be at least 1")
    datasets = select_datasets(args.datasets)

    try:
        api_key = resolve_api_key()
    except Exception as exc:
        raise SystemExit(f"Garmin API key not found: {exc}") from exc
    garmin = Garmin(api_key, token_cache=args.token_cache, delay=args.delay)

    if args.inspect:
        inspect(garmin, datasets, day=args.inspect_day or (today - timedelta(days=1)), probe_days=args.window, page_size=args.page_size)
        print(f"\nGarmin calls made: {garmin.calls}")
        return 0

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not args.dry_run and not (url and key):
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (set them in .env) unless --dry-run")
    store = Store(url or "https://dry-run.invalid", key or "dry-run", dry_run=args.dry_run)

    refresh_from = today - timedelta(days=max(0, args.refresh_days))
    outcomes: dict[str, Outcome] = {}
    for ds in datasets:
        if ds.kind == "range":
            outcomes[ds.name] = sync_range(ds, garmin, store, args.start, end, window=args.window, force=args.force, refresh_from=refresh_from)
        elif ds.kind == "daily":
            outcomes[ds.name] = sync_daily(ds, garmin, store, args.start, end, force=args.force, refresh_from=refresh_from)
        else:
            outcomes[ds.name] = sync_activities(garmin, store, args.start, end, window=args.window, force=args.force, refresh_from=refresh_from, page_size=args.page_size)

    ok = print_summary(store, datasets, args.start, end, outcomes)
    print(f"Garmin calls made: {garmin.calls}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
