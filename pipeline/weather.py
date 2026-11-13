"""Tomorrow's weather as forecast by the ECMWF IFS 00 UTC run of the issue day.

Open-Meteo's Single Runs API returns one model run exactly as it was issued, so a training row
sees the same kind of forecast the live site sees. One request per run day covers all 12 cells.
The run of issue day D covers 48 hours from 00:00 UTC; hours 21 to 44 (21:00 UTC on D to
20:00 UTC on D+1) are tomorrow's 24 hours. Nulls stay NaN: nothing is filled.

Command line (writes a gzipped CSV, git-ignored under data/raw; one JSON per run is cached so
an interrupted build resumes without new requests):

    python -m pipeline.weather --start 2024-03-14 --end 2026-11-01 --out data/raw/weather.csv.gz
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
import pandas as pd
import requests

from pipeline.fetch import ATTEMPTS, TIMEOUT_S, FetchError, _parse, _request
from pipeline.grid import CELLS

SINGLE_RUNS_URL = "https://single-runs-api.open-meteo.com/v1/forecast"
WEATHER_VARS = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation",
                "boundary_layer_height")
WX_FEATURES = ["wx_temp", "wx_rh", "wx_wind", "wx_precip", "wx_blh"]
FIRST_RUN = dt.date(2024, 3, 14)
FORECAST_HOURS = 48
MAX_MISSING_HOURS = 4
PAUSE_S = 1.0             # between requests, well under the free tier's per-minute limit
OUTAGE_WAIT_S = 60        # first wait when the API keeps failing; doubles up to OUTAGE_MAX_WAIT_S
OUTAGE_MAX_WAIT_S = 900
OUTAGE_GIVE_UP_S = 1800   # give up (resumable) after this long without a successful request
_COLUMNS = ["cell_id", "target_date", "issued_run_utc", *WX_FEATURES]


class RunNotAvailable(FetchError):
    """The API refused the run (HTTP 400): it holds no such run. Retrying cannot help."""


def fetch_run(cells: Sequence[dict], run_day: dt.date, *, get: Callable, sleep: Callable[[float], None],
              attempts: int = ATTEMPTS, timeout: float = TIMEOUT_S) -> pd.DataFrame:
    """The IFS 00 UTC run of `run_day` for `cells`: `cell_id`, `time_utc` and the weather variables.

    One row per cell and forecast hour (48 per cell). Retries 429, 5xx and network errors with
    `pipeline.fetch`'s backoff; raises `FetchError` when retries run out and `RunNotAvailable`
    (a `FetchError`) when the API says the run does not exist.
    """
    cells = list(cells)
    params = {"latitude": ",".join(str(c["lat"]) for c in cells),
              "longitude": ",".join(str(c["lon"]) for c in cells),
              "models": "ecmwf_ifs", "hourly": ",".join(WEATHER_VARS), "timezone": "GMT",
              "forecast_hours": FORECAST_HOURS, "run": f"{run_day}T00:00"}

    def timed_get(url, params, timeout=timeout):
        return get(url, params=params, timeout=timeout)

    try:
        frames = _request(timed_get, sleep, SINGLE_RUNS_URL, params, len(cells), WEATHER_VARS, attempts)
    except FetchError as exc:
        if "refused the request with HTTP 400" in str(exc):
            raise RunNotAvailable(str(exc)) from exc
        raise
    return pd.concat([f.assign(cell_id=c["id"]) for c, f in zip(cells, frames)],
                     ignore_index=True)[["cell_id", "time_utc", *WEATHER_VARS]]


# lab:weather_inputs
def weather_inputs(run_frame: pd.DataFrame, run_day: dt.date) -> pd.DataFrame:
    """Tomorrow's five weather inputs per cell from the 00 UTC run of `run_day`."""
    first = pd.Timestamp(run_day, tz="UTC") + pd.Timedelta(hours=21)
    hours = pd.date_range(first, periods=24, freq="h")           # 21:00 UTC D to 20:00 UTC D+1
    reduce = {"temperature_2m": ("wx_temp", "mean"), "relative_humidity_2m": ("wx_rh", "mean"),
              "wind_speed_10m": ("wx_wind", "mean"), "precipitation": ("wx_precip", "sum"),
              "boundary_layer_height": ("wx_blh", "mean")}
    rows = []
    for cell_id, one in run_frame.groupby("cell_id", sort=False):
        day = one.set_index("time_utc").reindex(hours)           # an absent hour counts as missing
        row = {"cell_id": cell_id, "target_date": (hours[0] + pd.Timedelta(hours=3)).date(),
               "issued_run_utc": f"{run_day}T00:00Z"}
        for source, (name, how) in reduce.items():
            values = day[source]
            too_few = values.isna().sum() > MAX_MISSING_HOURS    # more than 4 of 24 missing: no value
            row[name] = np.nan if too_few else getattr(values, how)()
        rows.append(row)
    return pd.DataFrame(rows, columns=_COLUMNS)
# endlab


def read_weather(path) -> pd.DataFrame:
    """The CLI's CSV as `weather_inputs` returns it, with `target_date` a `datetime.date` again."""
    out = pd.read_csv(path)
    out["target_date"] = [d.date() for d in pd.to_datetime(out["target_date"])]
    return out


def _frame_from_record(rec: dict) -> pd.DataFrame | None:
    """A cached run as a frame, or None when the cached answer is that the API lacks the run."""
    data = rec["data"]
    if isinstance(data, dict):
        return None
    frames = _parse(data, len(rec["cells"]), WEATHER_VARS)
    return pd.concat([f.assign(cell_id=c) for c, f in zip(rec["cells"], frames)],
                     ignore_index=True)[["cell_id", "time_utc", *WEATHER_VARS]]


def build_history(start: dt.date, end: dt.date, cache: Path, *, get: Callable,
                  sleep: Callable[[float], None], cells: Sequence[dict] = CELLS
                  ) -> tuple[pd.DataFrame, list[tuple[str, str]]]:
    """Weather inputs for every run day from `start` to `end`, fetching only what the cache lacks.

    Returns the inputs and the list of (run, reason) the API does not have. Raises `FetchError`
    when the API stays down for OUTAGE_GIVE_UP_S; what was fetched so far stays cached.
    """
    cache.mkdir(parents=True, exist_ok=True)
    ids = [c["id"] for c in cells]
    pieces, lacking = [], []
    day = start
    while day <= end:
        path = cache / f"{day}.json"
        if path.exists():
            rec = json.loads(path.read_text(encoding="utf-8"))
        else:
            rec = _fetch_record(cells, ids, day, get, sleep)
            path.write_text(json.dumps(rec), encoding="utf-8")
            sleep(PAUSE_S)
        frame = _frame_from_record(rec)
        if frame is None:
            lacking.append((str(day), str(rec["data"].get("error", ""))[:120]))
        else:
            pieces.append(weather_inputs(frame, day))
        day += dt.timedelta(days=1)
    out = pd.concat(pieces, ignore_index=True) if pieces else pd.DataFrame(columns=_COLUMNS)
    return out, lacking


def _fetch_record(cells, ids, day, get, sleep) -> dict:
    """One run as the cache stores it: the API's own answer, or {"error": ...} for a missing run."""
    body = {}

    def recording_get(url, params, timeout):
        resp = get(url, params=params, timeout=timeout)
        if resp.status_code == 200:
            body["data"] = resp.json()
        return resp

    wait, waited = OUTAGE_WAIT_S, 0.0
    while True:
        try:
            fetch_run(cells, day, get=recording_get, sleep=sleep)
            return {"run": str(day), "cells": ids, "data": body["data"]}
        except RunNotAvailable as exc:
            return {"run": str(day), "cells": ids, "data": {"error": str(exc)}}
        except FetchError as exc:
            if waited + wait > OUTAGE_GIVE_UP_S:
                raise FetchError(f"run {day}: API still failing after {waited:.0f} s of waiting: {exc}") from exc
            print(f"{day}: {exc}; waiting {wait:.0f} s", file=sys.stderr, flush=True)
            sleep(wait)
            waited += wait
            wait = min(wait * 2, OUTAGE_MAX_WAIT_S)


def main(argv: Sequence[str] | None = None, *, get: Callable | None = None,
         sleep: Callable[[float], None] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch the ECMWF IFS 00 UTC weather runs for the 12 cells.")
    ap.add_argument("--start", default=str(FIRST_RUN), help="first run day, YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="last run day (inclusive), YYYY-MM-DD")
    ap.add_argument("--out", required=True, help="output path, e.g. data/raw/weather.csv.gz")
    ap.add_argument("--cache", default="data/raw/weather_cache", help="one JSON per run lives here")
    args = ap.parse_args(argv)
    start, end = pd.Timestamp(args.start).date(), pd.Timestamp(args.end).date()
    if start > end:
        ap.error(f"start {start} is after end {end}")
    try:
        out, lacking = build_history(start, end, Path(args.cache), get=get or requests.get,
                                     sleep=sleep or time.sleep)
    except FetchError as exc:
        print(f"fetch failed: {exc}", file=sys.stderr)
        return 1
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False)
    runs = out["issued_run_utc"].nunique()
    print(f"wrote {len(out):,} rows from {runs} runs to {path}; runs the API lacks: {len(lacking)}")
    for run, reason in lacking:
        print(f"  {run}: {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
