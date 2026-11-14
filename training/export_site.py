"""The JSON files the rebuilt Lab, Forecast and Data pages read, in web/public/data/.

Run with `python -m training.export_site` (needs data/raw/hourly.csv.gz, data/raw/weather.csv.gz
and the weather run cache, model/model.json, and web/public/data/profile.json and history.json
from `python -m training.train`). `training.train` calls it at its end.

- lab-days.json: for every training day, each square's morning PM2.5 mean on the issue day and the
  mean PM2.5 of the target day (the Lab's "what is a training row" views).
- lab-timing.json: three West Tehran cases, 48 hourly PM2.5 values (from 00:30 on the issue day
  to 23:30 on the day after, Tehran time) and the 00 UTC weather run's hourly forecast from the
  run cache.
- lab-rows.json: every training and selection row (the model's inputs that the Lab draws, the
  label, the square and the day of year) and the costs and weights of the candidates that use
  all 19 inputs, one per penalty.
- lab-today.json: one worked example for model version 2, the newest West Tehran day of the
  held-out year, with the real outcome, plus the held-out summary and the vectorization timing.
- data-page.json: counts, splits, rates, reliability bins and costs for the Data page.

Nothing here fits or chooses anything; every number is read from the data and model.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.grid import CELLS
from pipeline.weather import WX_FEATURES, read_weather
from training.export_data import write_json
from training.features import FEATURES, build_dataset, split_by_time, zscore_apply
from training.labels import daily_labels
from training.model import predict_proba

ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "data" / "raw" / "hourly.csv.gz"
WEATHER_PATH = ROOT / "data" / "raw" / "weather.csv.gz"
WEATHER_CACHE = ROOT / "data" / "raw" / "weather_cache"
MODEL_PATH = ROOT / "model" / "model.json"
DATA_DIR = ROOT / "web" / "public" / "data"

TIMING_CELL = "west-tehran"
# (key, title, issue day D). The target day is D + 1.
TIMING_CASES = [("cleans", "Wind cleans it up", "2025-03-01"),
                ("builds", "It builds up", "2024-11-06"),
                ("stays", "It stays dirty", "2024-11-09")]
ROW_COLUMNS = ["pm2_5_mean", "pm2_5_max", "pm2_5_last", "season_sin", "season_cos",
               "wx_wind", "wx_blh", "wx_precip", "wx_temp", "wx_rh"]
ROW_DIGITS = [3, 1, 1, 3, 3, 3, 3, 1, 3, 3]
ALL_INPUTS = list(FEATURES) + list(WX_FEATURES)
TODAY_CELL = "west-tehran"


def _names() -> dict:
    return {c["id"]: c["name"] for c in CELLS}


def _mean_lookup(labels: pd.DataFrame) -> dict:
    return {(c, str(d)): m for c, d, m in zip(labels["cell_id"], labels["date"], labels["mean_pm25"])}


def _day(value) -> pd.Timestamp:
    return pd.Timestamp(value)


# --- lab-days.json ----------------------------------------------------------------

def build_days(train: pd.DataFrame, labels: pd.DataFrame) -> dict:
    """Per square and training day: the morning's PM2.5 mean (`today`, the first model input) and
    the mean PM2.5 of the target day (`tomorrow`)."""
    means = _mean_lookup(labels)
    days = sorted({str(d) for d in train["target_date"]})
    cells = []
    for cell in CELLS:
        mine = train[train["cell_id"] == cell["id"]]
        today = {str(d): v for d, v in zip(mine["target_date"], mine["pm2_5_mean"])}
        if set(today) != set(days):
            raise ValueError(f"{cell['id']} lacks training days that other squares have")
        cells.append({"id": cell["id"], "name": cell["name"],
                      "tomorrow": [round(float(means[(cell["id"], d)]), 3) for d in days],
                      "today": [round(float(today[d]), 1) for d in days]})
    return {"days": days, "cells": cells, "m": int(len(train))}


# --- lab-timing.json --------------------------------------------------------------

def _clean(value):
    return None if value is None or (isinstance(value, float) and np.isnan(value)) else value


def build_timing(hourly: pd.DataFrame, labels: pd.DataFrame, cache_dir: Path,
                 cases=TIMING_CASES, cell: str = TIMING_CELL) -> list[dict]:
    """48 hourly PM2.5 values and the run's hourly weather for each case.

    Hours are counted from 00:00 Tehran time on the issue day D, so the hourly stamp 21:00 UTC on
    D-1 is hour 0.5 and the stamp 20:00 UTC on D+1 is hour 47.5. The weather run is the 00 UTC run
    of D (03:30 Tehran time): its hour k is hour 3.5 + k, and its first 45 hours are kept.
    """
    means = _mean_lookup(labels)
    block = hourly[hourly["cell_id"] == cell].set_index("time_utc")["pm2_5"]
    out = []
    for key, title, today in cases:
        day = _day(today)
        target = str((day + pd.Timedelta(days=1)).date())
        first = pd.Timestamp(day, tz="UTC") - pd.Timedelta(hours=3)          # 21:00 UTC on D-1
        stamps = pd.date_range(first, periods=48, freq="h")
        if not all(s in block.index for s in stamps):
            raise ValueError(f"{cell} lacks hourly PM2.5 around {today}")
        pm = [[k + 0.5, round(float(block[s]), 1)] for k, s in enumerate(stamps)]
        rec = json.loads((Path(cache_dir) / f"{today}.json").read_text(encoding="utf-8"))
        h = rec["data"][rec["cells"].index(cell)]["hourly"]
        wx = [[3.5 + k, h["wind_speed_10m"][k], h["boundary_layer_height"][k], _clean(h["precipitation"][k])]
              for k in range(45)]
        out.append({"key": key, "title": title, "today": today, "target": target, "pm": pm, "wx": wx,
                    "tomorrow_mean": round(float(means[(cell, target)]), 1)})
    return out


# --- lab-rows.json ----------------------------------------------------------------

def _rows(df: pd.DataFrame, cells: list[str]) -> dict:
    index = {c: i for i, c in enumerate(cells)}
    values = [[round(v, d) for v in df[name].tolist()] for name, d in zip(ROW_COLUMNS, ROW_DIGITS)]
    y = df["y"].astype(int).tolist()
    cell = [index[c] for c in df["cell_id"]]
    doy = [int(_day(d).dayofyear) for d in df["target_date"]]
    rows = [[*(col[i] for col in values), y[i], cell[i], doy[i]] for i in range(len(df))]
    return {"cols": ROW_COLUMNS + ["y", "cell", "doy"], "rows": rows}


def build_rows(train: pd.DataFrame, selection: pd.DataFrame, model: dict, cells: list[str]) -> dict:
    """Train and selection rows (held-out rows are never exported) and the all-inputs candidates."""
    reg = [{"lambda": c["lambda"], "train": round(c["train_cost"], 5), "sel": round(c["selection_cost"], 5),
            "w": [round(w, 4) for w in c["weights"]]}
           for c in model["candidates"] if c["feature_set"] == "all_wx"]
    return {"cells": list(cells), "train": _rows(train, cells), "sel": _rows(selection, cells),
            "reg": {"features": ALL_INPUTS, "rows": reg}}


# --- lab-today.json ---------------------------------------------------------------

def pick_days(train: pd.DataFrame, features: list[str], cell: str = TODAY_CELL) -> list[dict]:
    """Eight training days of `cell` for the step 10 browser: four OK days spread from clean to dirty
    and four followed by an unhealthy day, sorted by the day's average PM2.5."""
    rows = train[train["cell_id"] == cell]
    pos = rows[rows["y"] == 1]
    neg = rows[rows["y"] == 0].sort_values("pm2_5_mean", kind="stable")
    n = len(neg)
    step = max(1, len(pos) // 4)
    chosen = [neg.iloc[int(n * 0.2)], neg.iloc[int(n * 0.6)], neg.iloc[int(n * 0.9)], neg.iloc[n - 3]]
    chosen += [pos.iloc[i] for i in range(0, len(pos), step)][:4]
    chosen.sort(key=lambda r: r["pm2_5_mean"])
    return [{"x": [round(float(r[f]), 4) for f in features], "y": int(r["y"]),
             "doy": int(_day(r["target_date"]).dayofyear)} for r in chosen]


def build_today(labels: pd.DataFrame, held: pd.DataFrame, model: dict,
                cell: str = TODAY_CELL, train: pd.DataFrame | None = None) -> dict:
    """Model version 2 on the newest finished `cell` row of the held-out year."""
    if model.get("version") != 2:
        raise ValueError("lab-today needs model version 2")
    rows = held[held["cell_id"] == cell]
    if rows.empty:
        raise ValueError(f"no held-out rows for {cell}")
    row = rows.sort_values("target_date").iloc[-1]
    features = list(model["features"])
    x = [float(row[f]) for f in features]
    mu, sigma = model["scaling"]["mu"], model["scaling"]["sigma"]
    p = float(predict_proba(zscore_apply(np.array([x]), np.array(mu), np.array(sigma)),
                            np.array(model["weights"]), model["bias"])[0])
    means = _mean_lookup(labels)
    target = str(row["target_date"])
    held_p = model["held_out_probabilities"]
    return {"cell": _names()[cell], "day": str(row["day"]), "target": target,
            "features": features, "x": x, "mu": mu, "sigma": sigma,
            "w": model["weights"], "b": model["bias"], "lambda": model["hyperparameters"]["lambda"],
            "p": round(p, 6),
            "held": {"cost": model["cost"]["held_out"],
                     "base": {k: model["baselines"][k]["held_out_cost"] for k in ("overall", "monthly")},
                     "rows": model["rows"]["held_out"],
                     "calib": {"bins": held_p["bins"], "counts_y1": held_p["counts_y1"],
                               "counts_y0": held_p["counts_y0"]}},
            "vec": model["vectorization"],
            "actual": round(float(means[(cell, target)]), 1),
            **({"days": pick_days(train, features)} if train is not None else {})}


# --- data-page.json ---------------------------------------------------------------

def build_data_page(profile: dict, history: dict, model: dict) -> dict:
    """The Data page's numbers from profile.json, history.json and model.json."""
    cells = profile["cells"]
    per_square = {c["labelled_days"] for c in cells}
    if len(per_square) != 1:
        raise ValueError("squares have different numbers of labelled days")
    rows = profile["rows"]
    held = model["held_out_probabilities"]
    edges = held["bins"]
    return {
        "facts": {"days_per_square": per_square.pop(), "square_days": profile["usable_cell_days"],
                  "start": profile["labelled_range"]["start"], "end": profile["labelled_range"]["end"],
                  "missing_hours": profile["missing_hours"]["count"],
                  "hours_checked": profile["missing_hours"]["hours_checked"]},
        "rows": {"labelled_windows": rows["labelled_windows"], "dst_dropped": rows["dst_dropped"],
                 "incomplete_inputs_dropped": rows["incomplete_inputs_dropped"],
                 "dataset": rows["dataset"] + rows["no_weather_dropped"],
                 "no_weather_dropped": rows["no_weather_dropped"], "with_weather": rows["dataset"]},
        "splits": profile["splits"],
        "cells": [{"id": c["id"], "name": c["name"], "rate": c["positive_rate"], "mean": c["mean_pm25"]}
                  for c in cells],
        "by_month": {k: [m["rate"] for m in v] for k, v in
                     {**{c["id"]: history["by_month"][c["id"]] for c in cells},
                      "pooled": history["by_month"]["pooled"]}.items()},
        "calib": [{"from": edges[i], "to": edges[i + 1], "yes": held["counts_y1"][i], "no": held["counts_y0"][i]}
                  for i in range(len(edges) - 1)],
        "cost": model["cost"],
        "baselines": {k: model["baselines"][k]["held_out_cost"] for k in ("overall", "monthly")},
    }


# --- the run ----------------------------------------------------------------------

def main() -> int:
    from pipeline.fetch import read_hourly

    hourly = read_hourly(RAW_PATH)
    labels = daily_labels(hourly)
    df = build_dataset(hourly, labels, weather=read_weather(WEATHER_PATH))
    train, selection, held = split_by_time(df)
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    profile = json.loads((DATA_DIR / "profile.json").read_text(encoding="utf-8"))
    history = json.loads((DATA_DIR / "history.json").read_text(encoding="utf-8"))
    if (len(train), len(selection), len(held)) != (model["rows"]["train"], model["rows"]["selection"],
                                                   model["rows"]["held_out"]):
        raise SystemExit("the rows rebuilt from data/raw do not match model.json; rerun training.train")

    cells = sorted(c["id"] for c in CELLS)
    sizes = {
        "lab-days.json": write_json(DATA_DIR / "lab-days.json", build_days(train, labels)),
        "lab-timing.json": write_json(DATA_DIR / "lab-timing.json",
                                      build_timing(hourly, labels, WEATHER_CACHE)),
        "lab-rows.json": write_json(DATA_DIR / "lab-rows.json", build_rows(train, selection, model, cells)),
        "lab-today.json": write_json(DATA_DIR / "lab-today.json", build_today(labels, held, model, train=train)),
        "data-page.json": write_json(DATA_DIR / "data-page.json", build_data_page(profile, history, model)),
    }
    print("site data:", sizes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
