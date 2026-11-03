"""Small JSON files for the site, all computed from the cached history (none hand-typed).

- sample.json: real training rows of one cell for the Lab's in-browser examples. It is built
  from the training split alone, so the Lab cannot hint at selection or held-out days.
- history.json: positive rates by year and calendar month, per cell and pooled, and the daily
  number of positive cells, from every labelled day.
- profile.json: facts for the Data page (counts, missing hours, splits, sources).

Called from training/train.py; nothing here fits or chooses anything.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.fetch import POLLUTANTS, WEATHER
from pipeline.grid import CELLS
from training.features import CUTOFF, FEATURES, INPUTS, on_standard_time
from training.labels import MIN_HOURS, THRESHOLD

# West Tehran is the one cell where both classes are common (46% of days above the threshold
# over the whole history; the other cells are mostly below 15%), so a year of it shows both.
SAMPLE_CELL = "west-tehran"
SAMPLE_DAYS = 365
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
     "attribution": "Open-Meteo"},
]


def _r(x: float, digits: int = 4) -> float:
    return round(float(x), digits)


def _cells(frame: pd.DataFrame) -> list[str]:
    return sorted(frame["cell_id"].unique(), key=lambda c: (_ORDER.get(c, len(_ORDER)), c))


# --- sample.json ----------------------------------------------------------------

def _latest_run(days: list, n: int) -> int:
    """Start index of the latest run of n consecutive dates in a sorted list."""
    ordinals = np.array([d.toordinal() for d in days])
    for end in range(len(days) - 1, n - 2, -1):
        if ordinals[end] - ordinals[end - n + 1] == n - 1:
            return end - n + 1
    raise ValueError(f"no run of {n} consecutive days")


def build_sample(train: pd.DataFrame, labels: pd.DataFrame, cell: str = SAMPLE_CELL,
                 days: int = SAMPLE_DAYS) -> dict:
    """The latest `days` consecutive TRAINING issue days of one cell, with raw features.

    Only `train` rows are read for features and labels; `labels` supplies the label-day mean
    PM2.5 (pm_tomorrow) of those same training target dates.
    """
    rows = train[train["cell_id"] == cell].sort_values("day").reset_index(drop=True)
    start = _latest_run(list(rows["day"]), days)
    rows = rows.iloc[start:start + days]
    means = labels[labels["cell_id"] == cell].set_index("date")["mean_pm25"]
    items = []
    for _, r in rows.iterrows():
        item = {"day": str(r["day"]), "target_date": str(r["target_date"]),
                "pm_today": _r(r["pm2_5_mean"], 3), "pm_tomorrow": _r(means[r["target_date"]], 3),
                "y": int(r["y"])}
        item.update({f: _r(r[f], 4) for f in FEATURES})
        items.append(item)

    months = pd.to_datetime(train["target_date"]).dt.month
    in_cell = train["cell_id"] == cell
    train_months = []
    for m in range(1, 13):
        pooled, local = train.loc[months == m, "y"], train.loc[in_cell & (months == m), "y"]
        train_months.append({"month": m,
                             "pooled_rate": _r(pooled.mean()) if len(pooled) else None,
                             "pooled_days": int(len(pooled)),
                             "cell_rate": _r(local.mean()) if len(local) else None,
                             "cell_days": int(len(local))})
    return {"cell": cell, "cell_name": _NAMES.get(cell, cell), "split": "train",
            "rule": f"the latest {days} consecutive training issue days of this cell",
            "start": items[0]["day"], "end": items[-1]["day"], "days": len(items),
            "positive_share": _r(np.mean([i["y"] for i in items])),
            "threshold": THRESHOLD, "features": list(FEATURES),
            "rows": items, "train_months": train_months}


# --- history.json ---------------------------------------------------------------

def _rates(labels: pd.DataFrame, key: pd.Series, name: str) -> list[dict]:
    return [{name: int(k), "days": int(len(g)), "rate": _r(g["y"].mean())}
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
                  dataset: pd.DataFrame, splits: dict[str, pd.DataFrame]) -> dict:
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
        "cell_count": len(cells),
        "usable_cell_days": int(len(labels)),
        "missing_hours": {k: (_r(v, 6) if isinstance(v, float) else int(v)) for k, v in missing.items()},
        "rows": {"labelled_windows": int(len(windows)),
                 "dst_dropped": int(len(windows) - len(dataset)),
                 "incomplete_inputs_dropped": int(issuable.sum() - len(dataset)),
                 "dataset": int(len(dataset))},
        "splits": {name: {"rows": int(len(part)),
                          "start": str(min(part["target_date"])),
                          "end": str(max(part["target_date"])),
                          "positive_rate": _r(part["y"].mean())}
                   for name, part in splits.items()},
        "yearly": [{"year": int(y), "days": int(len(g)), "rate": _r(g["y"].mean())}
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
