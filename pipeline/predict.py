"""Daily forecast: for every grid cell, the probability that tomorrow's Tehran-day mean PM2.5 exceeds 35.4.

    python -m pipeline.predict                 # one try for "now"
    python -m pipeline.predict --final         # the day's last try: a cell that is not ready becomes a gap
    python -m pipeline.predict --dry-run       # fetch and print the entries, write nothing
    python -m pipeline.predict --now 2026-11-03T13:30:00Z --out /tmp/p.json   # replay / test

The workflow tries four times a day. A forecast needs two sources: the CAMS pollutants up to the
cutoff, and tomorrow's weather from the ECMWF IFS 00 UTC run of the issue day. A cell is saved only
when both are ready (`readiness`); otherwise nothing is saved for it and the next try retries,
until the last try (`--final`, or any try from 21:00 Tehran time), which records a gap with the
reason. A saved forecast is never overwritten, and one saved after Tehran midnight is marked
`issued_late`. A run the weather API does not hold yet (HTTP 400) is "not ready", never a gap.

Issue date D is the Tehran date of now when now is at or after 12:00 Asia/Tehran, otherwise the
previous Tehran date, and the target is D+1. The runner's own date is never used, so a run that
is delayed past midnight UTC still forecasts the right day.

Inputs are the 12 hourly stamps from 21:00 UTC on D-1 to 08:00 UTC on D (everything up to the 12:00
Tehran cutoff): pollutants and today's weather from the Open-Meteo Air Quality and Historical
Forecast APIs (the live forecast API fills weather hours the historical one has not caught up on,
see docs/DATA_PROFILE.md, "Live vs history"), plus the five tomorrow-weather inputs (`wx_*`) from the
Single Runs API (`pipeline.weather`). Features come from `training.features.build_row`, scaling and
weights from the frozen model/model.json, which this module only reads. CAMS's own forecast of the
target day is stored as `cams_forecast_pm25` for display; it is not a model input.

Nothing is invented. Exit status: 0 if every cell of the target date has a forecast, 3 if a gap was
recorded, 4 if some cell is not ready and this was not the last try, 2 on bad input.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Callable, NamedTuple, Sequence

import numpy as np
import pandas as pd
import requests

from pipeline import store
from pipeline.fetch import POLLUTANTS, TIMEOUT_S as FETCH_TIMEOUT_S, WEATHER, FetchError, fetch_hourly
from pipeline.grid import CELLS
from pipeline.weather import WX_FEATURES, RunNotAvailable, fetch_run, weather_inputs
from training.features import INPUTS, LAST_STAMP_HOUR, WINDOW_HOURS, build_row, on_standard_time, zscore_apply
from training.labels import MIN_HOURS, TEHRAN
from training.model import predict_proba

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "model" / "model.json"
PREDICTIONS_PATH = ROOT / "data" / "predictions.json"

LIVE_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PER_CELL_ATTEMPTS = 3      # tries per cell once the all-cells request has failed
BUDGET_S = 600             # time allowed for all fetching in one run; what is not fetched by then becomes gaps
STOP_AFTER = 3             # consecutive failed cells before the rest are given up on (the API is down)
PROBABILITY_DECIMALS = 4
EXIT_GAPS = 3
EXIT_NOT_READY = 4         # some cell is not ready yet and this was not the last try: nothing saved for it
FINAL_HOUR = 21            # from this Tehran hour a try is the last chance and records gaps
CAMS_REASON = "CAMS hours up to the cutoff not published yet"
CAMS_RUN_REASON = "CAMS 00 UTC run not published yet"
CAMS_META_URL = "https://air-quality-api.open-meteo.com/data/cams_global/static/meta.json"
META_ATTEMPTS = 3
META_TIMEOUT_S = FETCH_TIMEOUT_S
ECMWF_REASON = "ECMWF 00 UTC run not published yet"


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


def fetch_frame(cells: Sequence[dict], day: dt.date, *, get, sleep, attempts=None,
                deadline=None, clock=None) -> pd.DataFrame:
    """Hourly inputs for UTC days D-1..D+1 (D+1 carries CAMS's forecast of the target day).

    Weather hours the historical forecast API has not published yet are filled from the live
    forecast API. Raises FetchError if the pollutant or historical request fails for good.
    """
    options = {"get": get, "sleep": sleep, "deadline": deadline, "clock": clock}
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


def fetch_cells(cells: Sequence[dict], day: dt.date, *, get, sleep, deadline=None,
                clock=None) -> tuple[pd.DataFrame, dict[str, str]]:
    """(frame, errors): one request for all cells; if it fails, cell by cell so one bad cell costs only itself.

    Past `deadline` nothing more is requested: the cells still without data get a gap with the reason.
    """
    budget = {"deadline": deadline, "clock": clock}
    try:
        return fetch_frame(cells, day, get=get, sleep=sleep, **budget), {}
    except FetchError as exc:
        first_error = str(exc)
    frames, errors, streak = [], {}, 0
    for cell in cells:
        if streak >= STOP_AFTER:
            errors[cell["id"]] = f"fetch skipped: stopped after {STOP_AFTER} consecutive failed cells ({first_error})"
            continue
        try:
            frames.append(fetch_frame([cell], day, get=get, sleep=sleep, attempts=PER_CELL_ATTEMPTS, **budget))
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


def fetch_weather(cells: Sequence[dict], day: dt.date, *, get, sleep, deadline=None,
                  clock=None) -> tuple[pd.DataFrame | None, str | None]:
    """(inputs, error): tomorrow's five weather inputs per cell from the 00 UTC run of `day`, in one request.

    `inputs` is `weather_inputs`' frame, or None when there is none yet: the API says it holds no such run
    (HTTP 400, `RunNotAvailable`: not published yet, so the try waits) or the fetch failed (`error` says why).
    """
    try:
        run_frame = fetch_run(cells, day, get=get, sleep=sleep, deadline=deadline, clock=clock or time.monotonic)
    except RunNotAvailable:
        return None, None
    except FetchError as exc:
        return None, f"ECMWF forecast fetch failed: {exc}"
    return weather_inputs(run_frame, day), None


def cams_run_reason(day: dt.date, *, get, sleep, attempts: int = META_ATTEMPTS) -> str | None:
    """Why CAMS is not ready for issue day `day`, or None when its latest run began at or after 00:00 UTC on `day`.

    The air-quality series fills past hours from whichever run covered them, so complete hours do not
    prove the 00 UTC run of `day` has landed; Open-Meteo's run metadata does. A failed or unreadable
    metadata request is "not ready" with the failure as the reason, never "ready".
    """
    failure = "unknown error"
    for attempt in range(attempts):
        try:
            resp = get(CAMS_META_URL, params={}, timeout=META_TIMEOUT_S)
            if resp.status_code == 200:
                started = float(resp.json()["last_run_initialisation_time"])
                midnight = pd.Timestamp(day, tz="UTC").timestamp()
                return None if started >= midnight else CAMS_RUN_REASON
            failure = f"HTTP {resp.status_code}"
            if resp.status_code != 429 and resp.status_code < 500:
                break
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            failure = f"{type(exc).__name__}: {exc}"
        if attempt + 1 < attempts:
            sleep(2.0 ** attempt)
    return f"CAMS run metadata fetch failed: {failure}"


def _cams_reason(cell_frame: pd.DataFrame | None, stamps: pd.DatetimeIndex) -> str | None:
    """Why the pre-cutoff hours are not usable yet, or None when all 12 are there and complete."""
    if cell_frame is None or cell_frame.empty:
        return CAMS_REASON
    window = cell_frame[cell_frame["time_utc"].isin(stamps)]
    n = window["time_utc"].nunique()
    if n < WINDOW_HOURS:
        return f"{CAMS_REASON} (time axis covers {n} of {WINDOW_HOURS} expected pre-cutoff hours)"
    nulls = window[INPUTS].isna().sum()
    nulls = nulls[nulls > 0]
    air = [f"{name} ({int(c)} h)" for name, c in nulls.items() if name in POLLUTANTS]
    if air:                                  # the API answers with nulls for hours the CAMS run has not reached
        return f"{CAMS_REASON}: null " + ", ".join(air)
    if len(nulls):
        return "null values in the pre-cutoff hours: " + ", ".join(f"{name} ({int(c)} h)" for name, c in nulls.items())
    return None


def _weather_reason(row: pd.Series | None) -> str | None:
    """Why tomorrow's weather inputs are not usable yet, or None when all five are there."""
    if row is None:
        return ECMWF_REASON
    missing = [name for name in WX_FEATURES if pd.isna(row[name])]
    if len(missing) == len(WX_FEATURES):
        return ECMWF_REASON
    if missing:
        return f"ECMWF forecast has too many missing hours for {', '.join(missing)}"
    return None


def readiness(cams_frame: pd.DataFrame | None, weather_frame: pd.DataFrame | None, cells: Sequence[dict],
              day: dt.date) -> dict[str, str | None]:
    """Per cell: None when both sources are ready for issue day `day`, else the reason it is not.

    `cams_frame` is the hourly pollutants and today's weather (`fetch_frame`), `weather_frame` the
    tomorrow inputs (`weather_inputs`) or None when the run is not published. The reasons: the
    day is on summer time, "CAMS hours up to the cutoff not published yet" (or the pollutant or weather
    value that is null), "ECMWF 00 UTC run not published yet", or the specific missing wx_ variable.
    """
    target = day + dt.timedelta(days=1)
    stamps = window_stamps(day)
    wx_rows = {}
    if weather_frame is not None and len(weather_frame):
        wx_rows = {row["cell_id"]: row for _, row in weather_frame.iterrows()}
    out = {}
    for cell in cells:
        if not all(on_standard_time([day, target])):
            out[cell["id"]] = "issue or target day was on Iran summer time (+04:30); the model has no input for it"
            continue
        mine = None if cams_frame is None or not len(cams_frame) else cams_frame[cams_frame["cell_id"] == cell["id"]]
        out[cell["id"]] = _cams_reason(mine, stamps) or _weather_reason(wx_rows.get(cell["id"]))
    return out


def _weather_values(row: pd.Series) -> dict[str, float]:
    return {name: round(float(row[name]), PROBABILITY_DECIMALS) for name in WX_FEATURES}


def make_entry(cell: dict, cell_frame: pd.DataFrame | None, reason: str | None, wx_row: pd.Series | None, *,
               day: dt.date, issued_at: str, issued_late: bool, model: dict) -> dict:
    """One predictions entry for `cell`: a forecast when `reason` is None, else a gap that says why."""
    target = day + dt.timedelta(days=1)
    entry = {"issued_at": issued_at, "target_date": target.isoformat(), "cell_id": cell["id"],
             "probability": None, "predicted": None, "model_version": model["version"],
             "outcome": None, "outcome_mean_pm25": None, "gap": True, "gap_reason": reason,
             "cams_forecast_pm25": None, "issued_late": issued_late, "weather": None}
    if cell_frame is not None and not cell_frame.empty:
        entry["cams_forecast_pm25"] = cams_forecast(cell_frame, target)
    if reason is not None:
        return entry
    try:
        row = build_row(cell_frame, cell["id"], day)
    except ValueError as exc:
        row = None
        entry["gap_reason"] = f"unusable hourly data: {exc}"
    if row is None:
        entry["gap_reason"] = entry["gap_reason"] or "no feature row could be built from the pre-cutoff hours"
        return entry
    weather = _weather_values(wx_row)
    row.update(weather)
    probability = round(model_probability(model, row), PROBABILITY_DECIMALS)
    entry.update(probability=probability, predicted=int(probability >= model.get("decision_threshold", 0.5)),
                 gap=False, weather=weather)
    return entry


class Try(NamedTuple):
    """What one try did: the target date, the entries it made, the cells it left for the next try (with
    the reason), and how many cells already held a forecast."""
    target: str
    entries: list
    waiting: dict
    skipped: int


def default_final(now, day: dt.date) -> bool:
    """True from 21:00 Tehran time on issue day `day`, and after Tehran midnight (the day has begun)."""
    local = store.tehran_now(now)
    return local.hour >= FINAL_HOUR or local.date() > day


def issue(now=None, *, get: Callable | None = None, sleep: Callable[[float], None] | None = None,
          final: bool | None = None, model_path=MODEL_PATH, predictions_path=PREDICTIONS_PATH,
          cells: Sequence[dict] = CELLS, clock: Callable[[], float] | None = None, write: bool = True) -> Try:
    """One try at tomorrow's forecast for `now`; saves what is ready into the predictions file.

    A cell that already holds a forecast for the target day is skipped: no fetch, no change. For the
    others, both sources are fetched once (pollutants and today's weather, then the 00 UTC weather run) and
    `readiness` decides per cell. A cell that is ready is saved. One that is not is left for the next
    try, unless `final` (default: `default_final`), when it is saved as a gap with the reason.
    `get`, `sleep` and `clock` default to requests.get, time.sleep and time.monotonic; tests inject
    fakes. All fetching shares one budget of BUDGET_S seconds. `write=False` saves nothing (dry run).
    """
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    day = store.issue_date(now)
    target = day + dt.timedelta(days=1)
    final = default_final(now, day) if final is None else final
    model = load_model(model_path)
    existing = store.load(predictions_path)       # a corrupt file stops the run before any request
    held = {e["cell_id"] for e in existing if e["target_date"] == target.isoformat() and not e["gap"]}
    pending = [c for c in cells if c["id"] not in held]
    skipped = len(cells) - len(pending)
    if not pending:
        return Try(target.isoformat(), [], {}, skipped)
    clock = clock or time.monotonic
    get, sleep = get or requests.get, sleep or time.sleep
    deadline = clock() + BUDGET_S
    run_reason = cams_run_reason(day, get=get, sleep=sleep)
    if run_reason is not None:                               # the CAMS 00 UTC run is not out: fetch nothing else
        frame, weather = pd.DataFrame(), None
        reasons = {c["id"]: run_reason for c in pending}
    else:
        frame, errors = fetch_cells(pending, day, get=get, sleep=sleep, deadline=deadline, clock=clock)
        weather, weather_error = fetch_weather(pending, day, get=get, sleep=sleep, deadline=deadline, clock=clock)
        reasons = readiness(frame, weather, pending, day)
        for cell_id, reason in reasons.items():
            if reason == ECMWF_REASON and weather_error:
                reasons[cell_id] = weather_error
        reasons.update(errors)                               # a pollutant fetch that failed for good
    wx_rows = {} if weather is None else {r["cell_id"]: r for _, r in weather.iterrows()}
    issued_at, late = store.utc_stamp(now), store.issued_late(target, now)
    entries, waiting = [], {}
    for cell in pending:
        reason = reasons[cell["id"]]
        if reason is not None and not final:
            waiting[cell["id"]] = reason
            continue
        mine = frame[frame["cell_id"] == cell["id"]] if len(frame) else None
        entries.append(make_entry(cell, mine, reason, wx_rows.get(cell["id"]), day=day, issued_at=issued_at,
                                  issued_late=late, model=model))
    if write and entries:
        store.save(predictions_path, store.merge(existing, entries))
    return Try(target.isoformat(), store.sort_entries(entries), waiting, skipped)


def status(tried: Try) -> int:
    """The exit status of a try: 4 if some cell was left for the next try, 3 if a gap was recorded, else 0."""
    if tried.waiting:
        return EXIT_NOT_READY
    return EXIT_GAPS if any(e["gap"] for e in tried.entries) else 0


def run(now=None, *, get: Callable | None = None, sleep: Callable[[float], None] | None = None,
        final: bool | None = None, **options) -> int:
    """`issue` for `now` and return its exit status (0, `EXIT_GAPS`, or `EXIT_NOT_READY`)."""
    return status(issue(now, get=get, sleep=sleep, final=final, **options))


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Issue tomorrow's PM2.5 forecast for the 12 grid cells.")
    ap.add_argument("--now", help="pretend it is this ISO time (needs a UTC offset); default: the real time")
    ap.add_argument("--out", default=str(PREDICTIONS_PATH), help="predictions file to update")
    ap.add_argument("--model", default=str(MODEL_PATH), help="frozen model file (read only)")
    ap.add_argument("--final", action="store_true",
                    help="this is the day's last try: record a gap for a cell that is not ready "
                         "(default: only from 21:00 Tehran time)")
    ap.add_argument("--dry-run", action="store_true", help="fetch and print the entries; write nothing")
    args = ap.parse_args(argv)
    try:
        now = pd.Timestamp(args.now) if args.now else pd.Timestamp.now(tz="UTC")
        tried = issue(now, predictions_path=args.out, model_path=args.model, final=True if args.final else None,
                      write=not args.dry_run)
    except (ValueError, OSError) as exc:
        print(f"predict failed: {exc}", file=sys.stderr)
        return 2
    gaps = [e for e in tried.entries if e["gap"]]
    verb = "would save" if args.dry_run else "saved"
    print(f"try {store.utc_stamp(now)} for {tried.target}: {verb} {len(tried.entries) - len(gaps)} forecasts and "
          f"{len(gaps)} gaps; {tried.skipped} already held a forecast; {len(tried.waiting)} not ready")
    if args.dry_run:
        for e in tried.entries:
            print(json.dumps(e, separators=(",", ":")))
    for e in gaps:
        print(f"  gap {e['cell_id']}: {e['gap_reason']}", file=sys.stderr)
    for cell_id, reason in tried.waiting.items():
        print(f"  not ready {cell_id}: {reason}", file=sys.stderr)
    return status(tried)


if __name__ == "__main__":
    sys.exit(main())
