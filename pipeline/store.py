"""Shared by the daily scripts: Tehran dates and the predictions file.

`data/predictions.json` is an object `{"schema_version": 1, "entries": [...]}`; an empty list means
no forecast has been issued yet. Each entry is one forecast for one cell and one target day:

    issued_at           ISO UTC time the forecast was made, e.g. "2026-11-03T10:05:00Z"
    target_date         the Tehran calendar date being forecast, "YYYY-MM-DD"
    cell_id             a pipeline.grid cell id
    probability         model probability that the target day's mean PM2.5 exceeds 35.4, or null
    predicted           1 if probability >= 0.5, else 0; null on a gap
    model_version       "version" of model/model.json that produced it
    outcome             1 / 0 once the target day is over and observed, else null
    outcome_mean_pm25   the observed Tehran-day mean PM2.5 behind `outcome`, else null
    outcome_note        only when an outcome was still missing 14 days after the target day: why it stays null
    gap                 true when no forecast could be made for this cell (nothing was invented)
    gap_reason          why, for a gap; null otherwise
    cams_forecast_pm25  CAMS's own forecast mean PM2.5 for the target day, display only, never a model input
    issued_late         true when the forecast was made after the target day had begun (issued_at later than
                        20:30 UTC on the day before target_date, which is 00:00 Tehran)
    weather             tomorrow's ECMWF weather inputs the model used, {wx_temp, wx_rh, wx_wind, wx_precip, wx_blh}
                        (the Lab's worked example); null on a gap

A saved forecast is never changed: the first one saved for a (target_date, cell_id) wins. There is
exactly one entry per (target_date, cell_id), sorted by target_date then cell_id, one
entry per line so a daily change is a small diff.
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pandas as pd

from training.labels import TEHRAN

SCHEMA_VERSION = 1
ISSUE_HOUR = 12          # forecasts are issued at noon Tehran time
KEY = ("target_date", "cell_id")


def tehran_now(now) -> pd.Timestamp:
    """`now` as a Tehran-time Timestamp. A naive time is refused: the runner's clock is never trusted."""
    ts = pd.Timestamp(now)
    if ts.tzinfo is None:
        raise ValueError("now must be timezone-aware; refusing to guess the runner's time zone")
    return ts.tz_convert(TEHRAN)


def issue_date(now) -> dt.date:
    """The Tehran date a forecast made at `now` is issued on: today from 12:00 Tehran time, else yesterday."""
    local = tehran_now(now)
    day = local.date()
    return day if local.hour >= ISSUE_HOUR else day - dt.timedelta(days=1)


def day_over(target: dt.date, now) -> bool:
    """True once Tehran's calendar day `target` has fully ended (now >= 00:00 Tehran of the next day)."""
    end = pd.Timestamp(target + dt.timedelta(days=1), tz=TEHRAN)
    return pd.Timestamp(now) >= end


def issued_late(target: dt.date, now) -> bool:
    """True when `now` is later than the start of Tehran's day `target` (00:00 Tehran, 20:30 UTC the day before)."""
    return pd.Timestamp(now) > pd.Timestamp(target, tz=TEHRAN)


def utc_stamp(now) -> str:
    return pd.Timestamp(now).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path) -> list[dict]:
    """The entries in `path`; [] when the file does not exist. Anything unreadable raises ValueError."""
    path = Path(path)
    if not path.exists():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        entries = doc["entries"]
        if not isinstance(entries, list):
            raise TypeError("entries is not a list")
        return entries
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"{path} is not a predictions file ({exc}); refusing to overwrite it") from exc


def sort_entries(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda e: (e["target_date"], e["cell_id"]))


def save(path, entries: list[dict]) -> None:
    """Write the entries sorted, one per line, ending in a newline. Identical entries give identical bytes."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ",\n".join("  " + json.dumps(e, separators=(",", ":")) for e in sort_entries(entries))
    head = f'{{"schema_version": {SCHEMA_VERSION}, "entries": ['
    body = f"{head}\n{lines}\n]}}\n" if lines else f"{head}\n]}}\n"
    path.write_text(body, encoding="utf-8", newline="\n")


def merge(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Add `incoming` to `existing`, keeping one entry per (target_date, cell_id).

    A saved forecast is never replaced: a non-gap entry stays whatever arrives later, so the first
    forecast saved wins. A gap may be replaced, by a later gap (its reason is newer) or by a forecast.
    """
    merged = {(e["target_date"], e["cell_id"]): e for e in existing}
    for e in incoming:
        key = (e["target_date"], e["cell_id"])
        old = merged.get(key)
        if old is not None and not old["gap"]:
            continue
        merged[key] = e
    return sort_entries(list(merged.values()))
