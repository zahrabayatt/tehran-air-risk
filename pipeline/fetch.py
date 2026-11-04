"""Hourly pollutant and weather history for the 12 grid cells, from Open-Meteo.

Pollutants come from the Air Quality API (`domains=cams_global`); weather from the
Historical Forecast API (`models=ecmwf_ifs`), as chosen in docs/DATA_PROFILE.md.
Both are requested at the cell centres with `timezone=GMT`, so every timestamp is UTC.
(With a Tehran timezone the API labels whole hours: the label 00:00 is 21:00 UTC.)

Nulls stay NaN: nothing is filled, interpolated or invented. Transient failures are
retried with backoff and then raised as `FetchError`; a response full of nulls is not
a failure.

Command line (writes a gzipped CSV, git-ignored under data/raw):

    python -m pipeline.fetch --start 2022-08-04 --end 2026-11-02 --out data/raw/hourly.csv.gz
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
import pandas as pd
import requests

from pipeline.grid import CELLS

AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
FORECAST_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
POLLUTANTS = ("pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide", "ozone")
WEATHER = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation")
COLUMNS = ["cell_id", "time_utc", *POLLUTANTS, *WEATHER]

# Task 1 found that multi-year requests time out; ~3 months for 12 locations is cheap and reliable.
WINDOW_DAYS = 90
ATTEMPTS = 5
TIMEOUT_S = 45           # a hung connection must not hold a daily run: one attempt is cut off after this
HISTORY_TIMEOUT_S = 120  # the offline history rebuild (this module's CLI) asks for 90-day windows and has no budget
BACKOFF_S = 2.0          # waits 2, 4, 8, ... seconds between attempts
RATE_LIMIT_WAIT_S = 65   # a 429 is the per-minute limit: wait for the window to reset


class FetchError(RuntimeError):
    """The data could not be fetched: retries were exhausted or the API refused the request."""


class _Retry(Exception):
    """One attempt failed in a way worth retrying (carries the reason and the wait)."""

    def __init__(self, reason: str, wait: float):
        super().__init__(reason)
        self.wait = wait


def _request(get: Callable, sleep: Callable[[float], None], url: str, params: dict,
             n_locations: int, names: Sequence[str], attempts: int,
             deadline: float | None = None, clock: Callable[[], float] = time.monotonic) -> list[pd.DataFrame]:
    """GET `url`, retrying on network errors, HTTP 5xx, 429 and malformed bodies.

    Returns one frame per location (`time_utc` plus `names`), in request order. When `deadline`
    (a reading of `clock`) is given, no attempt starts after it and no wait is slept that would
    run past it, so a chain of retries ends at most one attempt (TIMEOUT_S) after the deadline.
    """
    reason = "no attempt made"
    for attempt in range(attempts):
        if deadline is not None and clock() >= deadline:
            raise FetchError(f"{url} not fetched: time budget used up after {attempt} attempts ({reason})")
        try:
            return _attempt(get, url, params, n_locations, names, attempt)
        except _Retry as exc:
            reason = str(exc)
            if attempt < attempts - 1:
                if deadline is not None and clock() + exc.wait >= deadline:
                    raise FetchError(
                        f"{url} not fetched: time budget used up after {attempt + 1} attempts ({reason})") from exc
                sleep(exc.wait)
    raise FetchError(f"{url} failed after {attempts} attempts: {reason}")


def _attempt(get, url, params, n_locations, names, attempt) -> list[pd.DataFrame]:
    backoff = BACKOFF_S * 2 ** attempt
    try:
        resp = get(url, params=params, timeout=TIMEOUT_S)
    except requests.RequestException as exc:
        raise _Retry(f"network error: {exc!r}", backoff) from exc
    status = resp.status_code
    if status == 429:
        raise _Retry(f"HTTP 429: {str(resp.text)[:200]}", RATE_LIMIT_WAIT_S)
    if status >= 500:
        raise _Retry(f"HTTP {status}: {str(resp.text)[:200]}", backoff)
    if status != 200:  # a request the API will never accept: retrying cannot help
        raise FetchError(f"{url} refused the request with HTTP {status}: {str(resp.text)[:300]}")
    try:
        return _parse(resp.json(), n_locations, names)
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise _Retry(f"malformed response: {exc!r}", backoff) from exc


def _parse(body, n_locations: int, names: Sequence[str]) -> list[pd.DataFrame]:
    blocks = body if isinstance(body, list) else [body]
    if len(blocks) != n_locations:
        raise ValueError(f"expected {n_locations} locations, got {len(blocks)}")
    frames = []
    for block in blocks:
        offset = block.get("utc_offset_seconds", 0)
        if offset != 0:
            raise ValueError(f"expected UTC times, got utc_offset_seconds={offset}")
        hourly = block["hourly"]
        times = pd.to_datetime(hourly["time"], utc=True)
        columns = {"time_utc": times}
        for name in names:
            values = hourly[name]
            if len(values) != len(times):
                raise ValueError(f"{name} has {len(values)} values for {len(times)} hours")
            # None (JSON null) becomes NaN; nothing else is touched.
            columns[name] = np.array(values, dtype="float64")
        frames.append(pd.DataFrame(columns))
    return frames


def _day(value) -> dt.date:
    return pd.Timestamp(value).date()


def _windows(start: dt.date, end: dt.date, days: int):
    first = start
    while first <= end:
        last = min(first + dt.timedelta(days=days - 1), end)
        yield first, last
        first = last + dt.timedelta(days=1)


def columns_of(sources: Sequence[str]) -> list[str]:
    """The value columns that `sources` ("air", "weather") produce."""
    return [*(POLLUTANTS if "air" in sources else ()), *(WEATHER if "weather" in sources else ())]


def _collapse_duplicates(frame: pd.DataFrame, names: Sequence[str], where: str) -> pd.DataFrame:
    """One row per (cell_id, time_utc). Identical repeats collapse; repeats that disagree raise FetchError.

    A repeated stamp must not multiply rows in a merge, and picking one of two different values
    would be a guess, so a conflict is an error (null against a number counts as a conflict).
    """
    key = ["cell_id", "time_utc"]
    if not frame.duplicated(key).any():
        return frame
    distinct = frame.groupby(key)[list(names)].nunique(dropna=False)
    conflicts = distinct[(distinct > 1).any(axis=1)]
    if len(conflicts):
        cell_id, stamp = conflicts.index[0]
        raise FetchError(f"{where} repeats {len(conflicts)} hour(s) with different values, "
                         f"first {cell_id} at {stamp}")
    return frame.drop_duplicates(key, keep="last")


def fetch_hourly(cells: Sequence[dict], start, end, *,
                 get: Callable | None = None, sleep: Callable[[float], None] | None = None,
                 window_days: int = WINDOW_DAYS, attempts: int = ATTEMPTS,
                 pause_s: float = 0.0, sources: Sequence[str] = ("air", "weather"),
                 weather_url: str = FORECAST_URL, deadline: float | None = None,
                 clock: Callable[[], float] | None = None) -> pd.DataFrame:
    """Hourly pollutants and weather for `cells` over the UTC days `start` to `end` inclusive.

    Returns one long frame with columns `cell_id`, `time_utc` (tz-aware UTC), the six
    pollutants and four weather variables, one row per cell and hour, ordered by cell
    (as given) then time. Missing values are NaN. `get(url, params=..., timeout=...)` and
    `sleep(seconds)` default to `requests.get` and `time.sleep`; tests inject fakes.
    `pause_s` waits that long after each request to stay under the free-tier rate limit.
    Raises `FetchError` once `attempts` tries fail on a network error, HTTP 5xx, HTTP 429
    or a malformed body.

    `sources` picks what to request: "air" (pollutants), "weather", or both (the default);
    the frame then holds only those columns. `weather_url` swaps the weather endpoint; the daily
    pipeline uses the live forecast API when the historical one has not yet caught up.

    `deadline` (a reading of `clock`, default `time.monotonic`) is a time budget for the whole
    call: once it has passed, further retries and requests raise `FetchError` instead.
    """
    unknown = set(sources) - {"air", "weather"}
    if unknown or not sources:
        raise ValueError(f"sources must be 'air' and/or 'weather', got {tuple(sources)!r}")
    get = get or requests.get
    sleep = sleep or time.sleep
    clock = clock or time.monotonic
    first, last = _day(start), _day(end)
    if first > last:
        raise ValueError(f"start {first} is after end {last}")
    cells = list(cells)
    location = {"latitude": ",".join(str(c["lat"]) for c in cells),
                "longitude": ",".join(str(c["lon"]) for c in cells), "timezone": "GMT"}
    pieces = []
    for w_start, w_end in _windows(first, last, window_days):
        window = {"start_date": w_start.isoformat(), "end_date": w_end.isoformat()}
        merged = None
        for source, url, names, extra in (("air", AIR_QUALITY_URL, POLLUTANTS, {"domains": "cams_global"}),
                                          ("weather", weather_url, WEATHER, {"models": "ecmwf_ifs"})):
            if source not in sources:
                continue
            params = {**location, **window, "hourly": ",".join(names), **extra}
            frames = _request(get, sleep, url, params, len(cells), names, attempts, deadline, clock)
            part = pd.concat([f.assign(cell_id=c["id"]) for c, f in zip(cells, frames)], ignore_index=True)
            part = _collapse_duplicates(part, names, url)
            merged = part if merged is None else merged.merge(part, on=["cell_id", "time_utc"], how="outer")
            if pause_s:
                sleep(pause_s)
        pieces.append(merged)
    out = _collapse_duplicates(pd.concat(pieces, ignore_index=True), columns_of(sources), "the combined windows")
    order = {c["id"]: i for i, c in enumerate(cells)}
    out = out.assign(_o=out["cell_id"].map(order)).sort_values(["_o", "time_utc"], kind="stable")
    return out[["cell_id", "time_utc", *columns_of(sources)]].reset_index(drop=True)


def write_hourly(df: pd.DataFrame, path) -> None:
    """Write the frame as CSV (gzipped when the name ends in .gz); NaN becomes an empty field."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


def read_hourly(path) -> pd.DataFrame:
    """Read a frame written by `write_hourly`, restoring tz-aware UTC timestamps."""
    df = pd.read_csv(path, float_precision="round_trip")
    df["time_utc"] = pd.to_datetime(df["time_utc"], utc=True)
    return df


def _caching_get(cache_dir: Path, get: Callable) -> Callable:
    """Wrap `get` so a successful response is stored on disk and a repeat run reuses it."""
    class _Cached:
        status_code, text = 200, ""

        def __init__(self, body):
            self._body = body

        def json(self):
            return self._body

    def cached(url, params=None, timeout=None):
        key = hashlib.md5(json.dumps([url, params], sort_keys=True).encode()).hexdigest()
        path = cache_dir / f"{key}.json"
        if path.exists():
            return _Cached(json.loads(path.read_text(encoding="utf-8")))
        resp = get(url, params=params, timeout=timeout)
        if resp.status_code == 200:
            body = resp.json()
            cache_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(body), encoding="utf-8")
        return resp

    return cached


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch hourly history for the 12 grid cells.")
    global TIMEOUT_S
    TIMEOUT_S = HISTORY_TIMEOUT_S
    ap.add_argument("--start", required=True, help="first UTC day, YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="last UTC day (inclusive), YYYY-MM-DD")
    ap.add_argument("--out", required=True, help="output path, e.g. data/raw/hourly.csv.gz")
    ap.add_argument("--window-days", type=int, default=WINDOW_DAYS)
    ap.add_argument("--pause", type=float, default=10.0, help="seconds to wait after each request")
    ap.add_argument("--cache-dir", default=None,
                    help="store raw responses here so an interrupted run resumes without new API calls")
    args = ap.parse_args(argv)

    get = requests.get
    if args.cache_dir:
        get = _caching_get(Path(args.cache_dir), get)
    try:
        df = fetch_hourly(CELLS, args.start, args.end, get=get, window_days=args.window_days,
                          pause_s=args.pause)
    except FetchError as exc:
        print(f"fetch failed: {exc}", file=sys.stderr)
        return 1
    write_hourly(df, args.out)
    print(f"wrote {len(df):,} rows ({df['cell_id'].nunique()} cells, "
          f"{df['time_utc'].min()} to {df['time_utc'].max()}) to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
