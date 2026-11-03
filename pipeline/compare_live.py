"""Measure how far the live inputs of the daily pipeline are from the history the model was trained on.

    python -m pipeline.compare_live [--days 5] [--write-profile]

The daily pipeline fetches fresh values (Air Quality API for pollutants, Historical Forecast API
for weather, the live forecast API as a weather fallback), while training used values fetched
earlier into data/raw/hourly.csv.gz. This script fetches recent days again and reports, per
variable, the mean and maximum absolute difference:

* weather: the live forecast API against the Historical Forecast API, same 12 pre-cutoff stamps;
* pollutants: the Air Quality API fetched now against the cached history, all overlapping hours;
* what the difference does to the model: the probability from each source for the same cell and day.

With --write-profile the "Live vs history" section of docs/DATA_PROFILE.md is rewritten (between
the marker comments, so `training/verify_sources.py profile` keeps it). Numbers are measured at run
time, never typed in.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path
from typing import Callable, Sequence

import pandas as pd
import requests

from pipeline import store
from pipeline.fetch import POLLUTANTS, WEATHER, fetch_hourly, read_hourly
from pipeline.grid import CELLS
from pipeline.predict import LIVE_FORECAST_URL, MODEL_PATH, load_model, model_probability, window_stamps
from training.features import build_row

ROOT = Path(__file__).resolve().parent.parent
HISTORY = ROOT / "data" / "raw" / "hourly.csv.gz"
PROFILE = ROOT / "docs" / "DATA_PROFILE.md"
RESULT = ROOT / "data" / "raw" / "verify_live.json"
BEGIN, END = "<!-- live-vs-history:begin -->", "<!-- live-vs-history:end -->"


def compare(a: pd.DataFrame, b: pd.DataFrame, columns: Sequence[str]) -> list[dict]:
    """Per column: hours present and non-null in both frames, mean and max absolute difference.

    Frames are joined on (cell_id, time_utc). Hours that are null on either side are counted
    separately and left out of the statistics. `mean_level` is the mean of `b` over those hours.
    """
    both = a.merge(b, on=["cell_id", "time_utc"], suffixes=("_a", "_b"))
    out = []
    for name in columns:
        x, y = both[f"{name}_a"], both[f"{name}_b"]
        ok = x.notna() & y.notna()
        diff = (x[ok] - y[ok]).abs()
        out.append({"variable": name, "hours": int(ok.sum()), "null_either": int((~ok).sum()),
                    "mean_abs": float(diff.mean()) if len(diff) else None,
                    "max_abs": float(diff.max()) if len(diff) else None,
                    "mean_level": float(y[ok].mean()) if ok.any() else None})
    return out


def _window(frame: pd.DataFrame, days: Sequence[dt.date]) -> pd.DataFrame:
    stamps = pd.DatetimeIndex(sorted({s for d in days for s in window_stamps(d)}))
    return frame[frame["time_utc"].isin(stamps)]


def probability_gap(history: pd.DataFrame, live: pd.DataFrame, days: Sequence[dt.date], model: dict) -> dict:
    """Probabilities from the cached history and from the live fetch, for every (cell, day) both can build."""
    rows = []
    for day in days:
        for cell in CELLS:
            h, f = build_row(history, cell["id"], day), build_row(live, cell["id"], day)
            if h is None or f is None:
                continue
            rows.append({"p_history": model_probability(model, h), "p_live": model_probability(model, f),
                         "d_pm_mean": abs(h["pm2_5_mean"] - f["pm2_5_mean"]),
                         "d_pm_max": abs(h["pm2_5_max"] - f["pm2_5_max"]),
                         "d_pm_last": abs(h["pm2_5_last"] - f["pm2_5_last"])})
    df = pd.DataFrame(rows)
    if df.empty:
        return {"rows": 0}
    dp = (df["p_history"] - df["p_live"]).abs()
    flips = int(((df["p_history"] >= 0.5) != (df["p_live"] >= 0.5)).sum())
    summary = lambda col: {"mean_abs": float(df[col].mean()), "max_abs": float(df[col].max())}  # noqa: E731
    return {"rows": len(df), "mean_abs": float(dp.mean()), "max_abs": float(dp.max()), "class_flips": flips,
            "pm2_5_mean": summary("d_pm_mean"), "pm2_5_max": summary("d_pm_max"), "pm2_5_last": summary("d_pm_last")}


def per_day(history: pd.DataFrame, live: pd.DataFrame) -> list[dict]:
    """PM2.5 difference by UTC day, newest first, to show whether older days settle."""
    both = history.merge(live, on=["cell_id", "time_utc"], suffixes=("_h", "_l"))
    both = both.dropna(subset=["pm2_5_h", "pm2_5_l"])
    both["day"] = both["time_utc"].dt.date
    both["d"] = (both["pm2_5_h"] - both["pm2_5_l"]).abs()
    g = both.groupby("day")["d"].agg(["mean", "max"]).sort_index(ascending=False)
    return [{"day": str(d), "mean_abs": float(r["mean"]), "max_abs": float(r["max"])} for d, r in g.iterrows()]


def measure(now, *, days: int = 5, get: Callable | None = None, sleep: Callable | None = None,
            history_path=HISTORY, model_path=MODEL_PATH, pause_s: float = 2.0) -> dict:
    """Fetch recent data again and compare it with the history cache and between weather sources."""
    options = {"get": get or requests.get, "sleep": sleep or time.sleep, "pause_s": pause_s}
    model = load_model(model_path)
    today = store.issue_date(now)
    weather_days = [today - dt.timedelta(days=i) for i in range(days - 1, -1, -1)]
    first, last = weather_days[0] - dt.timedelta(days=1), weather_days[-1]
    hf = fetch_hourly(CELLS, first, last, sources=("weather",), **options)
    live = fetch_hourly(CELLS, first, last, sources=("weather",), weather_url=LIVE_FORECAST_URL, **options)
    hf_window = _window(hf, weather_days)
    result = {"measured_at": store.utc_stamp(now), "weather_days": [d.isoformat() for d in weather_days],
              "weather_live_vs_historical": compare(_window(live, weather_days), hf_window, WEATHER),
              "historical_forecast_nulls": int(hf_window[list(WEATHER)].isna().sum().sum()),
              "historical_forecast_hours": int(len(hf_window) * len(WEATHER))}

    history = read_hourly(history_path)
    h_last = history["time_utc"].max()
    h_days = list(pd.date_range(h_last.date() - dt.timedelta(days=days + 1), h_last.date()).date)
    fresh = fetch_hourly(CELLS, h_days[0], h_days[-1], **options)
    overlap = history[history["time_utc"] >= pd.Timestamp(h_days[0], tz="UTC")]
    result["history_cache_last_hour"] = str(h_last)
    result["history_days"] = [d.isoformat() for d in h_days]
    result["pollutants_air_quality_vs_cache"] = compare(fresh, overlap, POLLUTANTS)
    result["pollutants_precutoff_hours_only"] = compare(_window(fresh, h_days[1:]), _window(overlap, h_days[1:]), POLLUTANTS)
    result["weather_historical_refetch_vs_cache"] = compare(fresh, overlap, WEATHER)
    result["pm2_5_by_day"] = per_day(overlap, fresh)
    issuable = [d for d in h_days[1:] if len(_window(overlap, [d])) == len(CELLS) * 12]
    result["probability"] = probability_gap(overlap, fresh, issuable, model)
    return result


# --------------------------------------------------------------------------- report
def _fmt(x, digits=3):
    return "n/a" if x is None else f"{x:.{digits}f}"


def _table(rows: list[dict]) -> str:
    out = ["| Variable | Hours compared | Mean abs. difference | Max abs. difference | Mean level |",
           "|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['variable']} | {r['hours']:,} | {_fmt(r['mean_abs'])} | {_fmt(r['max_abs'])} | "
                   f"{_fmt(r['mean_level'], 2)} |")
    return "\n".join(out)


def render(result: dict) -> str:
    """The "Live vs history" section as Markdown, wrapped in the marker comments."""
    p = result["probability"]
    L = [BEGIN, "## Live vs history", "",
         f"Measured on {result['measured_at']} by `python -m pipeline.compare_live` (all 12 cells; every number below "
         "is computed from live responses, nothing typed in). The daily pipeline fetches its inputs live; the model "
         "was trained on values fetched earlier. Differences are absolute, in the variable's own unit "
         "(ug/m3 for pollutants; degrees C, percent, km/h and mm for weather).",
         "",
         "**What the zeros mean.** The history cache was fetched within about a day of this comparison, so a zero shows that "
         "the live sources and the cache match now. It does not show whether the hours of an issue day are revised "
         "later; the saved live snapshot (`data/raw/live_snapshot_*.csv.gz`, git-ignored) is for re-checking that on a "
         "later day."]
    L += ["", "### Weather: live forecast API against Historical Forecast API", "",
          f"Same 12 pre-cutoff stamps (21:00 UTC on D-1 to 08:00 UTC on D) for D = {', '.join(result['weather_days'])}; "
          "both with `models=ecmwf_ifs`, fetched in the same minute. The deployed model does not use weather "
          "(its features are `pm2_5_mean`, `pm2_5_max`, `pm2_5_last`, `season_sin`, `season_cos`), so this is "
          f"informational. Historical Forecast API nulls in those hours: {result['historical_forecast_nulls']} of "
          f"{result['historical_forecast_hours']:,}.", "",
          _table(result["weather_live_vs_historical"])]
    L += ["", "### Pollutants: Air Quality API fetched now against the history cache", "",
          f"Overlap: UTC days {result['history_days'][0]} to {result['history_days'][-1]} (the cache ends "
          f"{result['history_cache_last_hour']}), `domains=cams_global`, every overlapping hour.", "",
          _table(result["pollutants_air_quality_vs_cache"]), "",
          "Only the 12 pre-cutoff hours of each issue day (the hours the model sees):", "",
          _table(result["pollutants_precutoff_hours_only"]), "",
          "PM2.5 by UTC day (newest first), to show whether older days settle:", "",
          "| UTC day | Mean abs. difference | Max abs. difference |", "|---|---|---|"]
    L += [f"| {r['day']} | {_fmt(r['mean_abs'])} | {_fmt(r['max_abs'])} |" for r in result["pm2_5_by_day"]]
    L += ["", "Weather from the Historical Forecast API fetched now against the same variables in the history cache "
          "(informational):", "", _table(result["weather_historical_refetch_vs_cache"])]
    if p.get("rows"):
        L += ["", "### Effect on the model", "",
              f"For the same {p['rows']} (cell, day) pairs, probability from the cached history against probability "
              f"from the fresh fetch: mean absolute difference {_fmt(p['mean_abs'], 4)}, maximum "
              f"{_fmt(p['max_abs'], 4)}, {p['class_flips']} change(s) of predicted class at 0.5. Feature differences "
              f"(ug/m3): `pm2_5_mean` mean {_fmt(p['pm2_5_mean']['mean_abs'])} / max {_fmt(p['pm2_5_mean']['max_abs'])}; "
              f"`pm2_5_max` mean {_fmt(p['pm2_5_max']['mean_abs'])} / max {_fmt(p['pm2_5_max']['max_abs'])}; "
              f"`pm2_5_last` mean {_fmt(p['pm2_5_last']['mean_abs'])} / max {_fmt(p['pm2_5_last']['max_abs'])}."]
    L += ["", END, ""]
    return "\n".join(L)


def extract_section(text: str) -> str | None:
    """The marked "Live vs history" block of a profile text, markers included, or None."""
    if BEGIN in text and END in text:
        return text[text.index(BEGIN):text.index(END) + len(END)] + "\n"
    return None


def splice(text: str, section: str) -> str:
    """Put `section` into the profile text: replace the marked block, else insert before "## Reproduce"."""
    old = extract_section(text)
    if old is not None:
        return text.replace(old, section.rstrip("\n") + "\n", 1)
    anchor = "## Reproduce"
    if anchor in text:
        return text.replace(anchor, section + "\n" + anchor, 1)
    return text.rstrip("\n") + "\n\n" + section


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compare live pipeline inputs with the training history.")
    ap.add_argument("--days", type=int, default=5, help="issue days for the weather comparison (default 5)")
    ap.add_argument("--write-profile", action="store_true", help="rewrite the section in docs/DATA_PROFILE.md")
    args = ap.parse_args(argv)
    result = measure(pd.Timestamp.now(tz="UTC"), days=args.days)
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    section = render(result)
    if args.write_profile:
        PROFILE.write_text(splice(PROFILE.read_text(encoding="utf-8"), section), encoding="utf-8")
        print("wrote", PROFILE)
    print(section)
    return 0


if __name__ == "__main__":
    sys.exit(main())
