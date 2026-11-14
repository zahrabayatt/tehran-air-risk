"""Small JSON files for the site, all computed from the cached history (none hand-typed).

- history.json: positive rates by year and calendar month, per cell and pooled, and the daily
  number of positive cells, from every labelled day.
- profile.json: facts for the Data page (counts, missing hours, splits, sources).

Called from training/train.py; nothing here fits or chooses anything.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

from pipeline.fetch import POLLUTANTS, WEATHER
from pipeline.grid import CELLS
from training.features import CUTOFF, FEATURES, INPUTS, on_standard_time
from training.labels import MIN_HOURS, THRESHOLD

WEATHER_FIRST_TARGET = "2024-03-15"   # the first run is 2024-03-14, so the first target day
_NAMES = {c["id"]: c["name"] for c in CELLS}
_ORDER = {c["id"]: i for i, c in enumerate(CELLS)}

SOURCES = [
    {"use": "Pollutants: " + ", ".join(POLLUTANTS) + " (hourly)",
     "source": "Open-Meteo Air Quality API, CAMS global domain",
     "licence": "CC-BY 4.0",
     "attribution": "Copernicus Atmosphere Monitoring Service (CAMS) and Open-Meteo"},
    {"use": "Weather: " + ", ".join(WEATHER) + " (hourly, up to the cutoff)",
     "source": "Open-Meteo Historical Forecast API, ECMWF IFS",
     "licence": "CC-BY 4.0",
     "attribution": "Open-Meteo and ECMWF (IFS open data, CC-BY 4.0)"},
]


def _r(x: float, digits: int = 4) -> float:
    return round(float(x), digits)


def _cells(frame: pd.DataFrame) -> list[str]:
    return sorted(frame["cell_id"].unique(), key=lambda c: (_ORDER.get(c, len(_ORDER)), c))


# --- history.json ---------------------------------------------------------------

def _rates(labels: pd.DataFrame, key: pd.Series, name: str) -> list[dict]:
    # `positives` is the exact count; `rate` is rounded to four decimals, so the site shows positives / days.
    return [{name: int(k), "days": int(len(g)), "positives": int(g["y"].sum()), "rate": _r(g["y"].mean())}
            for k, g in labels.groupby(key, sort=True)]


def build_history(labels: pd.DataFrame) -> dict:
    """Positive rates by year and month, per cell and pooled, and a daily timeline."""
    dates = pd.to_datetime(labels["date"])
    years, months = dates.dt.year, dates.dt.month
    by_year, by_month = {}, {}
    for cell in _cells(labels):
        mask = labels["cell_id"] == cell
        by_year[cell] = _rates(labels[mask], years[mask], "year")
        by_month[cell] = _rates(labels[mask], months[mask], "month")
    by_year["pooled"] = _rates(labels, years, "year")
    by_month["pooled"] = _rates(labels, months, "month")
    first, last = dates.min(), dates.max()
    span = pd.date_range(first, last, freq="D")
    positive = labels.groupby(dates)["y"].sum().reindex(span, fill_value=0)
    labelled = labels.groupby(dates)["y"].size().reindex(span, fill_value=0)
    return {"threshold": THRESHOLD,
            "cells": [{"id": c, "name": _NAMES.get(c, c)} for c in _cells(labels)],
            "by_year": by_year, "by_month": by_month,
            "daily": {"start": str(first.date()), "end": str(last.date()),
                      "positive_cells": positive.astype(int).tolist(),
                      "labelled_cells": labelled.astype(int).tolist()}}


# --- profile.json ---------------------------------------------------------------

def _missing(hourly: pd.DataFrame) -> tuple[dict, dict]:
    """Cell-hours on each cell's full UTC grid (first to last stamp) that are absent or null."""
    totals = {"hours_checked": 0, "count": 0, "pm2_5_count": 0}
    per_cell = {}
    for cell, block in hourly.groupby("cell_id"):
        times = pd.DatetimeIndex(block["time_utc"])
        grid = pd.date_range(times.min(), times.max(), freq="h")
        values = block.set_index(times)[INPUTS].reindex(grid)
        any_null = int(values.isna().any(axis=1).sum())
        pm = int(values["pm2_5"].isna().sum())
        per_cell[cell] = {"hours_checked": len(grid), "missing_hours": any_null, "missing_pm2_5_hours": pm}
        totals["hours_checked"] += len(grid)
        totals["count"] += any_null
        totals["pm2_5_count"] += pm
    totals["share"] = totals["count"] / totals["hours_checked"]
    totals["pm2_5_share"] = totals["pm2_5_count"] / totals["hours_checked"]
    return totals, per_cell


def build_profile(hourly: pd.DataFrame, labels: pd.DataFrame, windows: pd.DataFrame,
                  dataset: pd.DataFrame, splits: dict[str, pd.DataFrame],
                  no_weather_dropped: int = 0) -> dict:
    """Facts for the Data page. Aggregates only, no row-level values."""
    missing, per_cell_missing = _missing(hourly)
    # Labelled target dates whose issue day D and target day D+1 are both on +03:30: each could
    # have been a row, and the ones without a row lack a complete window of inputs.
    targets = pd.to_datetime(labels["date"])
    issuable = on_standard_time(targets - pd.Timedelta(days=1)) & on_standard_time(targets)
    times = pd.DatetimeIndex(hourly["time_utc"])
    dates = pd.to_datetime(labels["date"])
    cells = []
    for cell in _cells(labels):
        lab = labels[labels["cell_id"] == cell]
        cells.append({"id": cell, "name": _NAMES.get(cell, cell),
                      "labelled_days": int(len(lab)),
                      "positives": int(lab["y"].sum()),
                      "positive_rate": _r(lab["y"].mean()),
                      "mean_pm25": _r(lab["mean_pm25"].mean(), 2),
                      "rows": int((dataset["cell_id"] == cell).sum()),
                      **per_cell_missing[cell]})
    return {
        "sources": SOURCES,
        "values_are": "modelled (CAMS), not station measurements",
        "threshold": THRESHOLD,
        "label_rule": f"Tehran-day mean PM2.5 above {THRESHOLD} ug/m3, needing at least "
                      f"{MIN_HOURS} of 24 hourly values",
        "cutoff_utc": f"{int(CUTOFF.total_seconds() // 3600):02d}:{int(CUTOFF.total_seconds() % 3600 // 60):02d}",
        "hourly_range": {"start": str(times.min()), "end": str(times.max())},
        "labelled_range": {"start": str(dates.min().date()), "end": str(dates.max().date())},
        "weather_first_target": WEATHER_FIRST_TARGET,
        "cell_count": len(cells),
        "usable_cell_days": int(len(labels)),
        "missing_hours": {k: (_r(v, 6) if isinstance(v, float) else int(v)) for k, v in missing.items()},
        "rows": {"labelled_windows": int(len(windows)),
                 "dst_dropped": int(len(windows) - len(dataset) - no_weather_dropped),
                 "incomplete_inputs_dropped": int(issuable.sum() - len(dataset) - no_weather_dropped),
                 "no_weather_dropped": int(no_weather_dropped),
                 "dataset": int(len(dataset))},
        "splits": {name: {"rows": int(len(part)),
                          "start": str(min(part["target_date"])),
                          "end": str(max(part["target_date"])),
                          "positives": int(part["y"].sum()),
                          "positive_rate": _r(part["y"].mean())}
                   for name, part in splits.items()},
        "yearly": [{"year": int(y), "days": int(len(g)), "positives": int(g["y"].sum()), "rate": _r(g["y"].mean())}
                   for y, g in labels.groupby(dates.dt.year)],
        "cells": cells,
    }


# --- writing --------------------------------------------------------------------

def _finite(node) -> None:
    if isinstance(node, float) and not math.isfinite(node):
        raise ValueError("refusing to write a non-finite number")
    if isinstance(node, dict):
        for v in node.values():
            _finite(v)
    elif isinstance(node, (list, tuple)):
        for v in node:
            _finite(v)


def write_json(path: Path, data) -> int:
    """Compact UTF-8 JSON with a trailing newline. Returns the size in bytes."""
    _finite(data)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(text + "\n", encoding="utf-8", newline="\n")
    return path.stat().st_size
