"""Fill in what actually happened for earlier forecasts.

    python -m pipeline.fill_outcomes

For every entry whose target Tehran day has fully ended (now is at or after 00:00 Tehran time of the
next day) and that has no outcome yet, fetch that day's hourly PM2.5 from the same Air Quality API
the labels were built from and set `outcome` with `training.labels.daily_labels` (strictly above
35.4 ug/m3, at least 20 hourly values) and `outcome_mean_pm25`. A day without enough data stays null
and is tried again on the next run, until 14 days after the day ended; after that the outcome stays null,
is no longer fetched, and the entry gets an `outcome_note` that says so. Entries with an outcome are never fetched or changed, so the
script is idempotent. Gap entries get an outcome too (the day happened either way); their
probability and prediction stay null. Only the outcome fields are written, never the forecast.

The values behind recent outcomes may still be revised by CAMS; that is the same limitation the
training history has, and it is stated on the site.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
from typing import Callable, Sequence

import pandas as pd
import requests

from pipeline import store
from pipeline.fetch import FetchError, fetch_hourly
from pipeline.grid import CELLS
from pipeline.predict import PREDICTIONS_PATH
from training.labels import daily_labels

EXIT_FETCH_FAILED = 3
GIVE_UP_DAYS = 14             # an outcome still missing this long after its day is not retried
GIVE_UP_NOTE = f"no outcome: not available {GIVE_UP_DAYS} days after the target day, so it is no longer retried"
BUDGET_S = 300             # time allowed for fetching in one run; unfinished outcomes are tried again tomorrow


def expired(entry: dict, now) -> bool:
    """True once GIVE_UP_DAYS full days have passed since the entry's target day ended."""
    return store.day_over(dt.date.fromisoformat(entry["target_date"]) + dt.timedelta(days=GIVE_UP_DAYS), now)


def pending(entries: list[dict], now) -> list[dict]:
    """Entries with no outcome whose target day is over and not yet given up on."""
    return [e for e in entries
            if e.get("outcome") is None and store.day_over(dt.date.fromisoformat(e["target_date"]), now)
            and not expired(e, now)]


def run(now=None, *, get: Callable | None = None, sleep: Callable[[float], None] | None = None,
        predictions_path=PREDICTIONS_PATH, cells: Sequence[dict] = CELLS,
        clock: Callable[[], float] | None = None) -> int:
    """Fill every outcome that can be filled, save the file if anything changed, return how many were filled.

    Raises FetchError if the data for the pending days could not be fetched (nothing is changed).
    """
    now = pd.Timestamp.now(tz="UTC") if now is None else pd.Timestamp(now)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    entries = store.load(predictions_path)
    gave_up = [e for e in entries if e.get("outcome") is None and expired(e, now) and e.get("outcome_note") != GIVE_UP_NOTE]
    for e in gave_up:
        e["outcome_note"] = GIVE_UP_NOTE
    todo = pending(entries, now)
    known = {c["id"]: c for c in cells}
    todo = [e for e in todo if e["cell_id"] in known]
    if not todo:
        if gave_up:
            store.save(predictions_path, entries)
        return 0
    days = sorted(dt.date.fromisoformat(e["target_date"]) for e in todo)
    ids = sorted({e["cell_id"] for e in todo})
    clock = clock or time.monotonic
    hourly = fetch_hourly([known[i] for i in ids], days[0] - dt.timedelta(days=1), days[-1],
                          get=get or requests.get, sleep=sleep or time.sleep, sources=("air",),
                          deadline=clock() + BUDGET_S, clock=clock)
    labels = daily_labels(hourly)
    found = {(r.cell_id, r.date.isoformat()): r for r in labels.itertuples()}
    filled = 0
    for e in todo:
        row = found.get((e["cell_id"], e["target_date"]))
        if row is not None:
            e["outcome"] = int(row.y)
            e["outcome_mean_pm25"] = round(float(row.mean_pm25), 2)
            filled += 1
    if filled or gave_up:
        store.save(predictions_path, entries)
    return filled


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fill outcomes for forecasts whose target day has ended.")
    ap.add_argument("--now", help="pretend it is this ISO time (needs a UTC offset); default: the real time")
    ap.add_argument("--out", default=str(PREDICTIONS_PATH), help="predictions file to update")
    args = ap.parse_args(argv)
    try:
        now = pd.Timestamp(args.now) if args.now else pd.Timestamp.now(tz="UTC")
        filled = run(now=now, predictions_path=args.out)
    except FetchError as exc:
        print(f"fill_outcomes failed: {exc}", file=sys.stderr)
        return EXIT_FETCH_FAILED
    except (ValueError, OSError) as exc:
        print(f"fill_outcomes failed: {exc}", file=sys.stderr)
        return 2
    print(f"filled {filled} outcome(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
