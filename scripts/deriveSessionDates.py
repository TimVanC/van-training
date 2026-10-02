"""
Date the spreadsheet-era training sessions from Google Sheets edit history.

scripts/fetchSheetRevisions.ts saves every revision of a sheet as an .xlsx.
Walking those in order, the first revision in which a row holds any set data
is the day that session was logged. Output is a JSON map the parser consumes:

    { "<ABBR>:<sheet>:<row>": { "date": "YYYY-MM-DD", "revision": "..." } }

Usage:
    python scripts/deriveSessionDates.py <out.json> ABBR=<revisions-folder> [ABBR=<folder> ...]
e.g.
    python scripts/deriveSessionDates.py backups/historical-splits/session_dates.json \
        GYM=backups/historical-splits/revisions/Gym GOD=backups/historical-splits/revisions/God_Split
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import openpyxl

LOCAL_TZ = ZoneInfo("America/New_York")


def row_has_data(ws, row: int, first_col: int) -> bool:
    for c in range(first_col, ws.max_column + 1):
        v = ws.cell(row=row, column=c).value
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        return True
    return False


def local_date(modified_time: str) -> dt.date:
    t = dt.datetime.fromisoformat(modified_time.replace("Z", "+00:00"))
    return t.astimezone(LOCAL_TZ).date()


def derive(abbr: str, folder: Path) -> dict[str, dict]:
    manifest = json.loads((folder / "revisions.json").read_text(encoding="utf-8"))
    revisions = sorted(manifest["revisions"], key=lambda r: r["modifiedTime"])
    first_seen: dict[str, dict] = {}
    loaded = 0
    for rev in revisions:
        stamp = rev["modifiedTime"].replace(":", "-")
        path = folder / f"{stamp}__{rev['id']}.xlsx"
        if not path.exists():
            continue
        try:
            wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        except Exception as exc:  # a corrupt/partial export shouldn't stop the walk
            print(f"  skip {path.name}: {exc}")
            continue
        loaded += 1
        for ws in wb.worksheets:
            header = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ())
            first_col = 2 if header and isinstance(header[0], str) and header[0].strip().lower() == "date" else 1
            for row_idx, values in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                key = f"{abbr}:{ws.title}:{row_idx}"
                if key in first_seen:
                    continue
                if any(v is not None and not (isinstance(v, str) and not v.strip()) for v in values[first_col - 1 :]):
                    first_seen[key] = {"date": local_date(rev["modifiedTime"]).isoformat(), "revision": rev["id"]}
        wb.close()
    print(f"{abbr}: {loaded} revisions read, {len(first_seen)} rows dated")
    return first_seen


def main() -> None:
    out_path = Path(sys.argv[1])
    result: dict[str, dict] = {}
    for spec in sys.argv[2:]:
        abbr, folder = spec.split("=", 1)
        result.update(derive(abbr, Path(folder)))
    out_path.write_text(json.dumps(result, indent=1, sort_keys=True), encoding="utf-8")
    print(f"wrote {len(result)} dated rows to {out_path}")


if __name__ == "__main__":
    main()
