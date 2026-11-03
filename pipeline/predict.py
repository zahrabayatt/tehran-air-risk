"""Daily forecast: for every grid cell, the probability that tomorrow's Tehran-day mean PM2.5 exceeds 35.4.

    python -m pipeline.predict                 # issue a forecast for "now"
    python -m pipeline.predict --now 2026-11-03T10:00:00Z --out /tmp/p.json   # replay / test

Issue date D is the Tehran date of now when now is at or after 12:00 Asia/Tehran, otherwise the
previous Tehran date, and the target is D+1. The runner's own date is never used, so a run that
is delayed past midnight UTC still forecasts the right day.

Inputs are the 12 hourly stamps from 21:00 UTC on D-1 to 08:00 UTC on D (everything up to the 12:00
Tehran cutoff), fetched live from the same sources the model was trained on: pollutants from the
Open-Meteo Air Quality API (cams_global) and weather from the Historical Forecast API
(ecmwf_ifs). If that API has not caught up with today, the missing weather hours come from the live
forecast API with the same model (see docs/DATA_PROFILE.md, "Live vs history"). The deployed model
only uses PM2.5 and the season, so weather is carried for completeness and does not affect the result.

Features come from `training.features.build_row`, scaling and weights from the frozen
model/model.json, which this module only reads. CAMS's own forecast of the target day is stored as
`cams_forecast_pm25` for display; it is not a model input.

Nothing is invented: if a cell's fetch fails, the time axis is short, or any needed value is null,
that cell gets a gap entry (probability null) with the reason, and the other cells are unaffected.
Exit status: 0 if every cell of the target date has a forecast, 3 if any has a gap, 2 on bad input.
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

from pipeline import store
from pipeline.fetch import WEATHER, FetchError, fetch_hourly
from pipeline.grid import CELLS
from training.features import INPUTS, LAST_STAMP_HOUR, WINDOW_HOURS, build_row, on_standard_time, zscore_apply
from training.labels import MIN_HOURS, TEHRAN
from training.model import predict_proba

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "model" / "model.json"
PREDICTIONS_PATH = ROOT / "data" / "predictions.json"

LIVE_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PER_CELL_ATTEMPTS = 3      # tries per cell once the all-cells request has failed
STOP_AFTER = 3             # consecutive failed cells before the rest are given up on (the API is down)
PROBABILITY_DECIMALS = 4
EXIT_GAPS = 3


def load_model(path=MODEL_PATH) -> dict:
    """Read the frozen model. The pipeline opens it read-only and never writes it."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def window_stamps(day: dt.date) -> pd.DatetimeIndex:
    """The 12 hourly stamps usable at the 12:00 Tehran cutoff of issue day `day` (UTC)."""
    last = pd.Timestamp(day, tz="UTC") + pd.Timedelta(hours=LAST_STAMP_HOUR)
    return pd.DatetimeIndex([last - pd.Timedelta(hours=h) for h in range(WINDOW_HOURS - 1, -1, -1)])


def target_day_hours(target: dt.date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC start (inclusive) and end (exclusive) of Tehran's calendar day `target`."""
    start = pd.Timestamp(target, tz=TEHRAN).tz_convert("UTC")
    return start, pd.Timestamp(target + dt.timedelta(days=1), tz=TEHRAN).tz_convert("UTC")


def fill_weather(primary: pd.DataFrame, live: pd.DataFrame) -> pd.DataFrame:
    """Fill weather values that are missing in `primary` from `live`; never overwrite a value.

    Both frames are de-duplicated on (cell_id, time_utc) first. Rows only in `live` are not added.
    """
    key = ["cell_id", "time_utc"]
    out = primary.drop_duplicates(key, keep="last").set_index(key)
    live = live.drop_duplicates(key, keep="last").set_index(key)
    for column in live.columns:
        out[column] = out[column].fillna(live[column]) if column in out else live[column].reindex(out.index)
    return out.reset_index()


def _weather_incomplete(frame: pd.DataFrame, cells: Sequence[dict], stamps: pd.DatetimeIndex) -> list[dict]:
    inside = frame[frame["time_utc"].isin(stamps)]
    bad = []
    for cell in cells:
        mine = inside[inside["cell_id"] == cell["id"]]
        if len(mine) < len(stamps) or mine[list(WEATHER)].isna().any().any():
            bad.append(cell)
    return bad


def fetch_frame(cells: Sequence[dict], day: dt.date, *, get, sleep, attempts=None) -> pd.DataFrame:
    """Hourly inputs for UTC days D-1..D+1 (D+1 carries CAMS's forecast of the target day).

    Weather hours the historical forecast API has not published yet are filled from the live
    forecast API. Raises FetchError if the pollutant or historical request fails for good.
    """
    options = {"get": get, "sleep": sleep}
    if attempts is not None:
        options["attempts"] = attempts
    one_day = dt.timedelta(days=1)
    frame = fetch_hourly(cells, day - one_day, day + one_day, **options)
    behind = _weather_incomplete(frame, cells, window_stamps(day))
    if behind:
        try:
            live = fetch_hourly(behind, day - one_day, day, sources=("weather",),
                                weather_url=LIVE_FORECAST_URL, **options)
        except FetchError:
            return frame          # the entries will report the nulls
        frame = fill_weather(frame, live)
    return frame


def fetch_cells(cells: Sequence[dict], day: dt.date, *, get, sleep) -> tuple[pd.DataFrame, dict[str, str]]:
    """(frame, errors): one request for all cells; if it fails, cell by cell so one bad cell costs only itself."""
    try:
        return fetch_frame(cells, day, get=get, sleep=sleep), {}
    except FetchError as exc:
        first_error = str(exc)
    frames, errors, streak = [], {}, 0
    for cell in cells:
        if streak >= STOP_AFTER:
            errors[cell["id"]] = f"fetch skipped: stopped after {STOP_AFTER} consecutive failed cells ({first_error})"
            continue
        try:
            frames.append(fetch_frame([cell], day, get=get, sleep=sleep, attempts=PER_CELL_ATTEMPTS))
            streak = 0
        except FetchError as exc:
            errors[cell["id"]] = f"fetch failed: {exc}"
            streak += 1
    empty = pd.DataFrame(columns=["cell_id", "time_utc", *INPUTS])
    return (pd.concat(frames, ignore_index=True) if frames else empty), errors


# lab:model_probability
def model_probability(model: dict, row: dict) -> float:
    """Apply the frozen model to one build_row result: pick model['features'], z-score, sigmoid."""
    x = np.array([[row[name] for name in model["features"]]], dtype=float)
    z = zscore_apply(x, np.array(model["scaling"]["mu"]), np.array(model["scaling"]["sigma"]))
    return float(predict_proba(z, np.array(model["weights"]), model["bias"])[0])
# endlab


def cams_forecast(cell_frame: pd.DataFrame, target: dt.date) -> float | None:
    """CAMS's forecast mean PM2.5 for Tehran day `target`, or None with fewer than 20 hours. Display only."""
    start, end = target_day_hours(target)
    hours = cell_frame[(cell_frame["time_utc"] >= start) & (cell_frame["time_utc"] < end)]["pm2_5"].dropna()
    return round(float(hours.mean()), 2) if len(hours) >= MIN_HOURS else None


def _gap_reason(cell_frame: pd.DataFrame, day: dt.date, target: dt.date) -> str:
    if not all(on_standard_time([day, target])):
        return "issue or target day was on Iran summer time (+04:30); the model has no input for it"
    stamps = window_stamps(day)
    window = cell_frame[cell_frame["time_utc"].isin(stamps)]
    n = window["time_utc"].nunique()
    if n < WINDOW_HOURS:
        return f"time axis covers {n} of {WINDOW_HOURS} expected pre-cutoff hours"
    nulls = window[INPUTS].isna().sum()
    nulls = nulls[nulls > 0]
    if len(nulls):
        return "null values in the pre-cutoff hours: " + ", ".join(f"{name} ({int(c)} h)" for name, c in nulls.items())
    return "no feature row could be built from the pre-cutoff hours"


def make_entry(cell: dict, cell_frame: pd.DataFrame | None, error: str | None, *, day: dt.date,
               issued_at: str, model: dict) -> dict:
    """One predictions entry for `cell`: a forecast, or a gap that says why."""
    target = day + dt.timedelta(days=1)
    entry = {"issued_at": issued_at, "target_date": target.isoformat(), "cell_id": cell["id"],
             "probability": None, "predicted": None, "model_version": model["version"],
             "outcome": None, "outcome_mean_pm25": None, "gap": True, "gap_reason": None,
             "cams_forecast_pm25": None}
    if error is not None or cell_frame is None or cell_frame.empty:
        entry["gap_reason"] = error or "no data returned"
        return entry
    entry["cams_forecast_pm25"] = cams_forecast(cell_frame, target)
    try:
        row = build_row(cell_frame, cell["id"], day)
    except ValueError as exc:
        row = None
        entry["gap_reason"] = f"unusable hourly data: {exc}"
    if row is None:
        entry["gap_reason"] = entry["gap_reason"] or _gap_reason(cell_frame, day, target)
        return entry
    probability = round(model_probability(model, row), PROBABILITY_DECIMALS)
    entry.update(probability=probability, predicted=int(probability >= model.get("decision_threshold", 0.5)),
                 gap=False)
    return entry


def run(now=None, *, get: Callable | None = None, sleep: Callable[[float], None] | None = None,
        model_path=MODEL_PATH, predictions_path=PREDICTIONS_PATH, cells: Sequence[dict] = CELLS) -> list[dict]:
    """Issue the forecast for `now`, merge it into the predictions file, and return the new entries.

    `get` and `sleep` default to requests.get and time.sleep; tests inject fakes.
    """
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    day = store.issue_date(now)
    model = load_model(model_path)
    existing = store.load(predictions_path)       # a corrupt file stops the run before any request
    frame, errors = fetch_cells(cells, day, get=get or requests.get, sleep=sleep or time.sleep)
    issued_at = store.utc_stamp(now)
    entries = []
    for cell in cells:
        mine = frame[frame["cell_id"] == cell["id"]] if len(frame) else None
        entries.append(make_entry(cell, mine, errors.get(cell["id"]), day=day, issued_at=issued_at, model=model))
    store.save(predictions_path, store.merge(existing, entries))
    return store.sort_entries(entries)


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Issue today's PM2.5 forecast for the 12 grid cells.")
    ap.add_argument("--now", help="pretend it is this ISO time (needs a UTC offset); default: the real time")
    ap.add_argument("--out", default=str(PREDICTIONS_PATH), help="predictions file to update")
    ap.add_argument("--model", default=str(MODEL_PATH), help="frozen model file (read only)")
    args = ap.parse_args(argv)
    try:
        now = pd.Timestamp(args.now) if args.now else pd.Timestamp.now(tz="UTC")
        entries = run(now=now, predictions_path=args.out, model_path=args.model)
    except (ValueError, OSError) as exc:
        print(f"predict failed: {exc}", file=sys.stderr)
        return 2
    target = entries[0]["target_date"]
    stored = [e for e in store.load(args.out) if e["target_date"] == target]
    gaps = [e for e in stored if e["gap"]]
    print(f"issued {store.utc_stamp(now)} for {target}: {len(stored) - len(gaps)} forecasts, {len(gaps)} gaps")
    for e in gaps:
        print(f"  gap {e['cell_id']}: {e['gap_reason']}", file=sys.stderr)
    return EXIT_GAPS if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
