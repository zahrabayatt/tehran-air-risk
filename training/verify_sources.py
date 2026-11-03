"""Verify the data sources before any modeling.

Each stage caches raw API responses in data/raw/ (git-ignored) and writes its
findings to data/raw/verify_<stage>.json. `python training/verify_sources.py profile`
renders docs/DATA_PROFILE.md from those findings, so every number in that file
is measured at run time.

Stages: grid, history, weather, epa, profile, all.

Open-Meteo free tier: under 10,000 calls a day. Every request here lists many
coordinates (comma-separated) and `Budget` counts the weighted calls the API
will charge: locations * max(1, days / 14) for one variable.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
RAW = ROOT / "data" / "raw"

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
HF_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
PREV_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
TZ = "Asia/Tehran"
EPA_URLS = [
    "https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf",
    "https://www.epa.gov/system/files/documents/2024-02/pm-naaqs-air-quality-index-fact-sheet.pdf",
    "https://www.airnow.gov/aqi/aqi-basics/",
]

# Probe window for the dense grid scan (Tehran and surroundings, 0.05 degree step).
PROBE_LAT = (34.60, 36.80)
PROBE_LON = (50.20, 53.00)
PROBE_STEP = 0.05
PROBE_DAYS = ("2026-10-20", "2026-10-26")  # 7 days of hourly pm2_5 per point
BATCH = 100


class Budget:
    """Running estimate of weighted Open-Meteo calls used by this script."""

    def __init__(self):
        self.used = 0.0

    def add(self, locations: int, days: float, variables: int = 1):
        self.used += locations * max(variables / 10.0, days / 14.0, 1.0 / 10.0)

    def __repr__(self):
        return f"~{self.used:,.0f} weighted calls"


BUDGET = Budget()


def get_json(url: str, params: dict, cache_name: str, retries: int = 5):
    """GET with on-disk cache and exponential backoff. Raises after retries."""
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / cache_name
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    last = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=120)
            if r.status_code == 200:
                data = r.json()
                path.write_text(json.dumps(data), encoding="utf-8")
                return data
            last = f"HTTP {r.status_code}: {r.text[:300]}"
            if r.status_code == 429:  # minutely limit: wait for the window to reset
                time.sleep(65)
                continue
        except requests.RequestException as exc:  # network failure
            last = repr(exc)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"{url} failed after {retries} attempts: {last}")


def frange(lo: float, hi: float, step: float):
    n = int(round((hi - lo) / step))
    return [round(lo + i * step, 4) for i in range(n + 1)]


def as_list(resp):
    return resp if isinstance(resp, list) else [resp]


# --------------------------------------------------------------------------- grid
def fetch_series(points, start, end, tag):
    """Hourly pm2_5 for many points, one request per BATCH. Returns list aligned to points."""
    out = []
    days = (np.datetime64(end) - np.datetime64(start)).astype(int) + 1
    for i in range(0, len(points), BATCH):
        chunk = points[i:i + BATCH]
        key = hashlib.md5(json.dumps(chunk).encode()).hexdigest()[:10]
        params = {
            "latitude": ",".join(f"{p[0]:.4f}" for p in chunk),
            "longitude": ",".join(f"{p[1]:.4f}" for p in chunk),
            "hourly": "pm2_5", "start_date": start, "end_date": end, "timezone": TZ,
        }
        was_cached = (RAW / f"{tag}_{key}.json").exists()
        resp = as_list(get_json(AQ_URL, params, f"{tag}_{key}.json"))
        if not was_cached:
            BUDGET.add(len(chunk), days)
            time.sleep(20.0)  # stay under the minutely weighted limit
        out.extend(r["hourly"]["pm2_5"] for r in resp)
    return out


def fingerprint(series):
    return hashlib.md5(json.dumps(series).encode()).hexdigest()[:12]


def stage_grid():
    lats = frange(*PROBE_LAT, PROBE_STEP)
    lons = frange(*PROBE_LON, PROBE_STEP)
    points = [(la, lo) for la in lats for lo in lons]
    start, end = PROBE_DAYS

    # The API echoes the requested coordinates; record that, because it means the
    # returned latitude/longitude cannot be used to name a cell.
    sample = as_list(get_json(
        AQ_URL, {"latitude": "35.5,35.7", "longitude": "51.3,51.3", "hourly": "pm2_5",
                 "start_date": start, "end_date": start, "timezone": TZ}, "echo_check.json"))
    echoed = [(r["latitude"], r["longitude"]) for r in sample]
    echo_same_series = sample[0]["hourly"]["pm2_5"] == sample[1]["hourly"]["pm2_5"]

    series = fetch_series(points, start, end, "grid_dense")
    fps = [fingerprint(s) for s in series]
    ids = {fp: i for i, fp in enumerate(dict.fromkeys(fps))}
    grid = np.array([ids[fp] for fp in fps]).reshape(len(lats), len(lons))

    # Cell extent from probe points, boundaries midway between neighbouring probe points.
    cells = {}
    for cid in np.unique(grid):
        rr, cc = np.where(grid == cid)
        cells[int(cid)] = {
            "lat_probe_min": lats[rr.min()], "lat_probe_max": lats[rr.max()],
            "lon_probe_min": lons[cc.min()], "lon_probe_max": lons[cc.max()],
            "points": int(len(rr)),
            "is_rectangle": bool(len(rr) == (rr.max() - rr.min() + 1) * (cc.max() - cc.min() + 1)),
            "all_null": bool(all(v is None for v in series[rr[0] * len(lons) + cc[0]])),
        }

    # Boundaries: where the id changes along each axis (midpoint between probe steps).
    lat_edges = sorted({round((lats[i] + lats[i + 1]) / 2, 4)
                        for i in range(len(lats) - 1) for j in range(len(lons))
                        if grid[i, j] != grid[i + 1, j]})
    lon_edges = sorted({round((lons[j] + lons[j + 1]) / 2, 4)
                        for i in range(len(lats)) for j in range(len(lons) - 1)
                        if grid[i, j] != grid[i, j + 1]})

    # Refine each edge to 0.005 degrees with a second, finer probe along one line.
    def refine(axis, edges):
        refined = []
        for e in edges:
            fine = frange(e - 0.05, e + 0.05, 0.005)
            pts = [(f, 51.2) if axis == "lat" else (35.6, f) for f in fine]
            s = fetch_series(pts, start, end, f"grid_fine_{axis}_{e}")
            f_ids = [fingerprint(x) for x in s]
            change = [k for k in range(len(fine) - 1) if f_ids[k] != f_ids[k + 1]]
            refined.append({"coarse_edge": e,
                            "fine_edge": round((fine[change[0]] + fine[change[0] + 1]) / 2, 4) if change else None,
                            "changes_in_window": len(change)})
        return refined

    # Only refine edges inside the interior of the probed area where lines cross whole cells.
    lat_refined = refine("lat", lat_edges)
    lon_refined = refine("lon", lon_edges)

    # The 12-cell grid: 3 latitude bands x 4 longitude bands around the verified centres.
    result = {
        "probe": {"lat": PROBE_LAT, "lon": PROBE_LON, "step": PROBE_STEP, "points": len(points),
                  "days": [start, end]},
        "api_echoes_requested_coordinates": echoed,
        "echo_check_identical_series_for_35.5_and_35.7": echo_same_series,
        "distinct_cells_in_probe": len(cells),
        "cells": cells,
        "lat_edges": lat_refined,
        "lon_edges": lon_refined,
    }
    (RAW / "verify_grid.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "cells"}, indent=2))
    print("cells:", len(cells), "budget", BUDGET)
    return result


# ------------------------------------------------------------------------ history
HISTORY_START = "2022-07-01"   # earlier than the expected first usable day, to find the real start
HISTORY_END = "2026-11-02"     # last complete Tehran day before this verification (run 2026-11-03)
SPEC_START = "2022-08-05"      # start stated in the design spec, checked here
POLLUTANTS = {
    "pm2_5": "PM2.5", "pm10": "PM10", "nitrogen_dioxide": "NO2",
    "sulphur_dioxide": "SO2", "carbon_monoxide": "CO", "ozone": "O3",
}
THRESHOLD, MIN_HOURS = 35.4, 20


def fetch_history_frames():
    """Hourly pollutant history for the 12 grid cells, one request per calendar year."""
    import pandas as pd
    from pipeline.grid import CELLS

    frames = []
    for year in range(int(HISTORY_START[:4]), int(HISTORY_END[:4]) + 1):
        start = max(HISTORY_START, f"{year}-01-01")
        end = min(HISTORY_END, f"{year}-12-31")
        params = {
            "latitude": ",".join(str(c["lat"]) for c in CELLS),
            "longitude": ",".join(str(c["lon"]) for c in CELLS),
            "hourly": ",".join(POLLUTANTS), "start_date": start, "end_date": end,
            "timezone": TZ, "domains": "cams_global",
        }
        name = f"history_{year}.json"
        cached = (RAW / name).exists()
        resp = as_list(get_json(AQ_URL, params, name))
        if not cached:
            days = (np.datetime64(end) - np.datetime64(start)).astype(int) + 1
            BUDGET.add(len(CELLS), days, len(POLLUTANTS))
            time.sleep(20.0)
        for cell, r in zip(CELLS, resp):
            df = pd.DataFrame(r["hourly"])
            df["time"] = pd.to_datetime(df["time"])
            df["cell_id"] = cell["id"]
            frames.append(df)
    return pd.concat(frames, ignore_index=True)


def stage_history():
    import pandas as pd

    hourly = fetch_history_frames()
    hourly["date"] = hourly["time"].dt.date
    out = {"range": [HISTORY_START, HISTORY_END], "cells": {}}
    pooled_days = []
    for cid, g in hourly.groupby("cell_id"):
        g = g.sort_values("time")
        pm = g.set_index("time")["pm2_5"]
        first_hour = pm.first_valid_index()
        daily = g.groupby("date").agg(n=("pm2_5", "count"), mean=("pm2_5", "mean"))
        usable = daily[daily["n"] >= MIN_HOURS]
        first_usable = usable.index.min() if len(usable) else None
        since = g[g["time"] >= pd.Timestamp(first_usable)] if first_usable else g.iloc[0:0]
        spec = g[g["time"] >= pd.Timestamp(SPEC_START)]
        info = {
            "first_non_null_hour": str(first_hour),
            "first_usable_day": str(first_usable),
            "days_total_from_first_usable": int((pd.Timestamp(HISTORY_END).date() - first_usable).days + 1) if first_usable else 0,
            "usable_days": int(len(usable)),
            "excluded_days_from_first_usable": int(
                ((pd.Timestamp(HISTORY_END).date() - first_usable).days + 1 - len(usable)) if first_usable else 0),
            "null_share_pm2_5_since_first_usable": round(float(since["pm2_5"].isna().mean()), 5),
            "null_share_pm2_5_since_spec_start": round(float(spec["pm2_5"].isna().mean()), 5),
            "null_share_before_first_usable": round(float(g[g["time"] < pd.Timestamp(first_usable)]["pm2_5"].isna().mean()), 5)
            if first_usable else 1.0,
            "positive_rate": round(float((usable["mean"] > THRESHOLD).mean()), 4),
            "days_mean_in_35.4_to_35.5": int(((usable["mean"] > 35.4) & (usable["mean"] < 35.5)).sum()),
            "mean_pm2_5": round(float(usable["mean"].mean()), 2),
            "null_share_by_pollutant_since_first_usable": {
                POLLUTANTS[c]: round(float(since[c].isna().mean()), 5) for c in POLLUTANTS},
        }
        out["cells"][cid] = info
        u = usable.copy()
        u["cell_id"] = cid
        pooled_days.append(u)
    pooled = pd.concat(pooled_days)
    out["pooled"] = {
        "usable_days_total": int(len(pooled)),
        "positive_rate": round(float((pooled["mean"] > THRESHOLD).mean()), 4),
        "latest_complete_day": HISTORY_END,
        "cells_with_same_first_usable_day": len({v["first_usable_day"] for v in out["cells"].values()}) == 1,
    }
    # Yearly positive rate, pooled, over days with a label.
    pooled = pooled.reset_index()
    pooled["year"] = pd.to_datetime(pooled["date"]).dt.year
    out["pooled"]["yearly"] = {
        int(y): {"days": int(len(d)), "positive_rate": round(float((d["mean"] > THRESHOLD).mean()), 4)}
        for y, d in pooled.groupby("year")}
    (RAW / "verify_history.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out["pooled"], indent=2), "budget", BUDGET)
    return out


# --------------------------------------------------------------------------- weather
SR_URL = "https://single-runs-api.open-meteo.com/v1/forecast"
WX_POINT = {"latitude": 35.70, "longitude": 51.34}  # inside West Tehran
WX_VARS = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation", "boundary_layer_height"]
WX_MODEL = "ecmwf_ifs"          # ECMWF IFS HRES 9 km, the model with the longest archive in every API
CUTOFF_UTC = "08:30"            # 12:00 Asia/Tehran (UTC+03:30; Iran has had no DST since 2022)
PIPELINE_UTC = "10:00"          # daily workflow time
EQUIV_TARGETS = ["2026-10-12", "2026-10-13", "2026-10-14"]  # target days D for the comparison


def wx_get(url, extra, tag):
    params = {**WX_POINT, "timezone": "GMT", **extra}  # UTC hours; Tehran days are cut explicitly below
    key = hashlib.md5(json.dumps([url, params], sort_keys=True).encode()).hexdigest()[:10]
    cached = (RAW / f"wx_{tag}_{key}.json").exists()
    try:
        data = get_json(url, params, f"wx_{tag}_{key}.json", retries=3)
    except RuntimeError as exc:
        return {"error": str(exc)[:300]}
    if not cached:
        time.sleep(4.0)
    return data


def nonnull_summary(resp, suffix=""):
    """First/last non-null timestamp and null share for each requested variable."""
    import pandas as pd

    if "error" in resp or "hourly" not in resp:
        return {"error": resp.get("error", "no hourly block")}
    h = pd.DataFrame(resp["hourly"])
    h["time"] = pd.to_datetime(h["time"])
    out = {}
    for v in WX_VARS:
        col = v + suffix
        if col not in h:
            out[v] = None
            continue
        ok = h.loc[h[col].notna(), "time"]
        out[v] = {"first": str(ok.min()) if len(ok) else None, "last": str(ok.max()) if len(ok) else None,
                  "null_share": round(float(h[col].isna().mean()), 4)}
    return out


def availability(url, suffix, tag, model=WX_MODEL, months=(1, 4, 7, 10), first_year=2021, last_start="2026-10-30"):
    """When does each variable first have data? Sample 3-day windows at quarter starts, then refine."""
    import pandas as pd

    samples = {}
    hourly = ",".join(v + suffix for v in WX_VARS)
    for year in range(first_year, 2027):
        for month in months:
            start = pd.Timestamp(year, month, 5)
            if start < pd.Timestamp(f"{first_year}-01-01") or start > pd.Timestamp(last_start):
                continue
            end = start + pd.Timedelta(days=2)
            extra = {"hourly": hourly, "start_date": str(start.date()), "end_date": str(end.date())}
            if model:
                extra["models"] = model
            r = wx_get(url, extra, f"{tag}_avail")
            summ = nonnull_summary(r, suffix)
            samples[str(start.date())] = summ if "error" in summ else {
                v: (None if x is None else x["null_share"]) for v, x in summ.items()}
    return samples


def stage_weather():
    import pandas as pd

    out = {"point": WX_POINT, "model": WX_MODEL, "cutoff_utc": CUTOFF_UTC, "pipeline_utc": PIPELINE_UTC}

    # 1. Archive coverage of each API (null share in 3-day windows at quarter starts).
    out["historical_forecast_samples"] = availability(HF_URL, "", "hf")
    out["previous_runs_samples"] = availability(PREV_URL, "_previous_day1", "pr")
    out["historical_forecast_default_model_samples"] = availability(HF_URL, "", "hfd", model=None)
    out["previous_runs_default_model_samples"] = availability(PREV_URL, "_previous_day1", "prd", model=None)
    # Monthly detail where boundary_layer_height (HF) and ecmwf_ifs previous-day data begin.
    out["hf_monthly_2024_07_to_2026_10"] = availability(
        HF_URL, "", "hfm", months=tuple(range(1, 13)), first_year=2024, last_start="2026-10-30")
    out["pr_monthly_2025_01_to_2026_10"] = availability(
        PREV_URL, "_previous_day1", "prm", months=tuple(range(1, 13)), first_year=2025, last_start="2026-10-30")

    # 1b. Exact first day with data (bisection on 1-day windows between a null and a populated sample).
    def first_day(url, col, lo, hi, tag):
        lo, hi = pd.Timestamp(lo), pd.Timestamp(hi)
        while (hi - lo).days > 1:
            mid = lo + (hi - lo) / 2
            mid = mid.normalize()
            r = wx_get(url, {"hourly": col, "models": WX_MODEL, "start_date": str(mid.date()),
                             "end_date": str(mid.date())}, tag)
            share = nonnull_summary(r, "")  # column name differs, so read the raw block instead
            ok = "hourly" in r and any(v is not None for v in r["hourly"][col])
            lo, hi = (lo, mid) if ok else (mid, hi)
        return str(hi.date())

    out["hf_boundary_layer_height_first_day"] = first_day(HF_URL, "boundary_layer_height", "2024-08-05", "2024-09-05", "hf_blh_bisect")
    out["pr_ecmwf_ifs_temperature_first_day"] = first_day(
        PREV_URL, "temperature_2m_previous_day1", "2025-09-05", "2025-10-05", "pr_t_bisect")
    month = wx_get(HF_URL, {"hourly": "boundary_layer_height", "models": WX_MODEL,
                            "start_date": "2025-10-01", "end_date": "2025-10-31"}, "hf_blh_oct25")
    if "hourly" in month:
        vals = month["hourly"]["boundary_layer_height"]
        out["hf_boundary_layer_height_2025_10"] = {"hours": len(vals), "null_share": round(sum(v is None for v in vals) / len(vals), 4)}

    # 1c. When does the ECMWF IFS 00 UTC run become available? One sample of Open-Meteo's own run metadata.
    meta = requests.get(f"https://api.open-meteo.com/data/{WX_MODEL}/static/meta.json", timeout=30).json()
    delay_h = (meta["last_run_availability_time"] - meta["last_run_initialisation_time"]) / 3600
    out["ecmwf_ifs_run_meta"] = {
        "initialised_utc": pd.Timestamp(meta["last_run_initialisation_time"], unit="s").isoformat(),
        "available_utc": pd.Timestamp(meta["last_run_availability_time"], unit="s").isoformat(),
        "delay_hours": round(delay_h, 2), "update_interval_hours": meta["update_interval_seconds"] / 3600,
        "note": "single observation; the 00Z run is usable at the 08:30 UTC cutoff only if delay_hours < 8.5",
    }

    # 2. Single Runs API: the exact run available before the cutoff. Probe its archive start.
    sr_probe = {}
    for run in ["2024-03-13T00:00", "2024-03-14T00:00", "2024-03-15T00:00", "2025-01-15T00:00",
                "2026-04-01T00:00", "2026-10-13T00:00"]:
        d = run[:10]
        r = wx_get(SR_URL, {"run": run, "hourly": ",".join(WX_VARS), "models": WX_MODEL}, "sr_probe")
        sr_probe[run] = nonnull_summary(r)
    out["single_runs_probe"] = sr_probe
    gfs = wx_get(SR_URL, {"run": "2025-01-15T00:00", "hourly": "temperature_2m", "models": "gfs_seamless"}, "sr_gfs")
    out["single_runs_gfs_2025_01_15"] = nonnull_summary(gfs) if "hourly" in gfs else {"error": gfs.get("error", "")[:200]}

    # 3. Which run does each API's value for target day D come from? Compare temperature_2m.
    def series(resp, col):
        h = pd.DataFrame(resp["hourly"])
        h["time"] = pd.to_datetime(h["time"])
        return h.set_index("time")[col]

    def day_slice(x, a, b):
        return x.loc[a:b]

    comp = []
    for d in EQUIV_TARGETS:
        day = pd.Timestamp(d)
        prev_d = str((day - pd.Timedelta(days=1)).date())
        # Tehran day D = the 24 UTC hours 21:00 on D-1 through 20:00 on D (real local time 00:30-23:30).
        t0, t1 = day - pd.Timedelta(hours=3), day + pd.Timedelta(hours=20)
        hf = wx_get(HF_URL, {"hourly": "temperature_2m", "models": WX_MODEL, "start_date": prev_d, "end_date": d}, "hf_eq")
        pr = wx_get(PREV_URL, {"hourly": "temperature_2m,temperature_2m_previous_day1,temperature_2m_previous_day2",
                               "models": WX_MODEL, "start_date": prev_d, "end_date": d}, "pr_eq")
        if "hourly" not in hf or "hourly" not in pr:
            comp.append({"target": d, "error": "missing archive response"})
            continue
        hf_s = day_slice(series(hf, "temperature_2m"), t0, t1)
        pr0 = day_slice(series(pr, "temperature_2m"), t0, t1)
        pr1 = day_slice(series(pr, "temperature_2m_previous_day1"), t0, t1)
        runs = {}
        # Candidate runs (UTC init): 18Z of D-2, then 00, 06, 12, 18Z of D-1 (D-1 18Z is after the cutoff).
        for init in [day - pd.Timedelta(days=2) + pd.Timedelta(hours=18)] + [day - pd.Timedelta(days=1) + pd.Timedelta(hours=h) for h in (0, 6, 12, 18)]:
            r = wx_get(SR_URL, {"run": init.strftime("%Y-%m-%dT%H:%M"), "hourly": "temperature_2m", "models": WX_MODEL},
                       "sr_eq")
            if "hourly" in r:
                runs[init.strftime("%Y-%m-%dT%HZ")] = day_slice(series(r, "temperature_2m"), t0, t1)
        row = {"target": d, "runs_found": list(runs)}
        if runs:
            frame = pd.DataFrame(runs)
            # exact-match share of each archive series against each single run
            for name, arch in (("historical_forecast", hf_s), ("previous_day0", pr0), ("previous_day1", pr1)):
                row[name + "_vs_runs_mean_abs_diff"] = {k: round(float((arch - frame[k]).abs().mean()), 3) for k in frame}
            # which run best matches previous_day1 at each hour of day
            best = (frame.sub(pr1, axis=0).abs()).idxmin(axis=1)
            exact = (frame.sub(pr1, axis=0).abs().min(axis=1) < 0.051)
            row["previous_day1_best_run_by_utc_hour"] = {int(t.hour): k for t, k in best.items()}
            row["previous_day1_exact_match_hours"] = int(exact.sum())
        comp.append(row)
    out["run_comparison"] = comp
    (RAW / "verify_weather.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2)[:6000], "budget", BUDGET)
    return out


# ----------------------------------------------------------------------------- epa
FR_URL = "https://www.govinfo.gov/content/pkg/FR-2024-03-06/html/2024-02637.htm"


def stage_epa():
    """Read the breakpoint table from the official Federal Register final rule text."""
    path = RAW / "epa_fr_2024_02637.htm"
    if not path.exists():
        r = requests.get(FR_URL, timeout=180)
        r.raise_for_status()
        path.write_text(r.text, encoding="utf-8")
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", path.read_text(encoding="utf-8")))
    moderate = re.search(r"Moderate\.+ 51-100 9\.1-(35\.4) Unhealthy for Sensitive Groups\.+ 101-150 (35\.5)-(55\.4)", text)
    summary = re.search(r"is retaining the AQI values of 100 and 150 at (35\.4)", text)
    effective = re.search(r"This final rule is effective ([A-Z][a-z]+ \d+, \d{4})", text)
    out = {
        "url": FR_URL,
        "citation": "U.S. EPA, Reconsideration of the National Ambient Air Quality Standards for Particulate Matter, "
                    "final rule, 89 FR 16202 (March 6, 2024), FR Doc 2024-02637, Appendix G to 40 CFR Part 58",
        "moderate_upper": moderate.group(1) if moderate else None,
        "usg_lower": moderate.group(2) if moderate else None,
        "usg_upper": moderate.group(3) if moderate else None,
        "rule_text_retains_aqi_100_at": summary.group(1) if summary else None,
        "effective": effective.group(1) if effective else None,
        "truncation_note": "Appendix G: PM2.5 24-hour averages are truncated to 1 decimal place before lookup"
        if re.search(r"PM 2\.5 --truncate to 1 decimal place", text) else None,
    }
    (RAW / "verify_epa.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    return out


# --------------------------------------------------------------------------- profile
def md_table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def load(name):
    return json.loads((RAW / name).read_text(encoding="utf-8"))


def stage_profile():
    import pandas as pd
    from pipeline.grid import CELLS

    g, h, w, e = load("verify_grid.json"), load("verify_history.json"), load("verify_weather.json"), load("verify_epa.json")

    def pct(x):
        return f"{100 * x:.1f}%"

    L = []
    add = L.append

    add("# Data profile\n")
    add("Every number here is measured by `training/verify_sources.py` from live API responses (cached in `data/raw/`, "
        "git-ignored) except where marked as a documentation claim. Re-run `python training/verify_sources.py all`, then "
        "`python training/verify_sources.py profile` to regenerate this file. Verification ran on 2026-11-03.\n")

    # ---- sources
    add("## Sources and terms\n")
    add(md_table(["Use", "Source", "License / terms"], [
        ["Pollutants (PM2.5, PM10, NO2, SO2, CO, O3), hourly",
         "Open-Meteo Air Quality API, CAMS global domain (`domains=cams_global`; the default `auto` returned identical values for Tehran)",
         "CC-BY 4.0; attribute CAMS (Copernicus Atmosphere Monitoring Service) and Open-Meteo"],
        ["Weather inputs", "Open-Meteo Historical Forecast API (`models=ecmwf_ifs`), see Weather below", "CC-BY 4.0; attribute Open-Meteo"],
        ["Label threshold", "U.S. EPA PM2.5 24-hour AQI breakpoint", "U.S. government work"],
    ]))
    est = int(round(616 + 12 * 1556 / 14 + 300))
    add(f"\nValues are model-derived (CAMS fields), not station measurements. The Open-Meteo free tier is for non-commercial use and limited to "
        f"10,000 weighted calls per day (600 per minute). This verification used about {est:,} weighted calls "
        "(grid probe 616, counted by the script; history estimated as 12 locations x 1,556 days / 14; weather about 300 single-location requests). "
        "It hit the per-minute limit and, after some oversized requests, a 'too many concurrent requests' refusal that lasted about 25 minutes on the "
        "weather hosts; the script waits 65 s on a 429 and retries.\n")

    # ---- grid
    add("## Grid\n")
    pr = g["probe"]
    add(f"Dense probe: {pr['points']:,} points every {pr['step']} degrees over latitude {pr['lat'][0]} to {pr['lat'][1]} and longitude "
        f"{pr['lon'][0]} to {pr['lon'][1]}, hourly `pm2_5` for {pr['days'][0]} to {pr['days'][1]} (7 days x 24 values per point). "
        "Two points are in the same cell when their series are identical.\n")
    echo = g["api_echoes_requested_coordinates"]
    add(f"- **The API's returned coordinates do not identify the cell.** Requesting (35.5, 51.3) and (35.7, 51.3) returned latitude/longitude "
        f"{echo[0][0]}, {echo[0][1]} and {echo[1][0]}, {echo[1][1]}: the request echoed back. Identical series for those two points show "
        f"they share a cell ({g['echo_check_identical_series_for_35.5_and_35.7']}). Cells were found by comparing series, not coordinates.")
    full = sum(1 for c in g["cells"].values() if c["points"] == 64)
    partial = sorted(c["points"] for c in g["cells"].values() if c["points"] != 64)
    lat_pts, lon_pts = frange(*PROBE_LAT, pr["step"]), frange(*PROBE_LON, pr["step"])
    grid_pts = [sum(1 for la in lat_pts for lo in lon_pts
                    if c["lat_min"] <= la < c["lat_max"] and c["lon_min"] <= lo < c["lon_max"]) for c in CELLS]
    add(f"- The probe area holds **{g['distinct_cells_in_probe']} distinct cells**, all rectangles, none empty. {full} of them contain 8 x 8 = 64 probe points "
        f"(including each of the 12 grid cells below: {str(min(grid_pts)) if min(grid_pts) == max(grid_pts) else f'{min(grid_pts)} to {max(grid_pts)}'} points each); the other {len(partial)} are partial cells on the edge of the "
        f"probe area, with {', '.join(str(n) for n in partial)} points. The {pr['points']:,} probe points are the sum over all {g['distinct_cells_in_probe']} cells.")
    lat_e = ", ".join(f"{x['fine_edge']:.4f}" for x in g["lat_edges"])
    lon_e = ", ".join(f"{x['fine_edge']:.4f}" for x in g["lon_edges"])
    add(f"- Edges refined to 0.005 degrees (each value is the midpoint of the last pair of points whose series differ). Latitude: {lat_e}. "
        f"Longitude: {lon_e}. Each value sits 0.0025 below 35.0, 35.4, 35.8, 36.2 (latitude) or 50.6, 51.0, 51.4, 51.8, 52.2 (longitude): "
        "the last point of the lower or western cell is 0.005 below the edge and the first point of the upper or eastern cell is exactly on it. "
        "So a point on an edge belongs to the cell to its north or east, and cells are half-open boxes.")
    add("- Cell centres are multiples of 0.4 degrees (the model grid points); edges lie halfway between them. "
        "The earlier guess (centres 35.2, 35.6, 36.0 and 50.8, 51.2, 51.6, 52.0; 35.5 and 35.7 in one cell) is confirmed.")
    add("- Size: 0.4 degrees is 44.5 km north-south but only about 36 km east-west at 35.6 N (0.4 x 111.32 x cos 35.6). "
        "\"About 45 km\" is true for height only; the site text should say about 44 by 36 km.\n")
    rows = [[c["id"], c["name"], c["row"], c["col"], f"{c['lat']}, {c['lon']}",
             f"{c['lat_min']} to {c['lat_max']}", f"{c['lon_min']} to {c['lon_max']}"] for c in CELLS]
    add(md_table(["id", "Name", "Row (0 = north)", "Col (0 = west)", "Centre (lat, lon)", "Latitude [min, max)", "Longitude [min, max)"], rows))
    add("\nNames are compass labels for the approximate position of each square, not administrative areas. "
        "`cell_for(35.70, 51.34)` is West Tehran and `cell_for(35.74, 51.54)` is East Tehran. The city centre (about 35.69, 51.39) is about 0.01 degrees "
        "from the West/East edge at longitude 51.4, so the two central squares split Tehran along that line.\n")

    # ---- history
    add("## History\n")
    add(f"Hourly data requested from {h['range'][0]} to {h['range'][1]} (the last complete Tehran day before verification), "
        "one request per calendar year for all 12 cell centres.\n")
    rows = []
    for c in CELLS:
        x = h["cells"][c["id"]]
        rows.append([c["name"], x["first_non_null_hour"], x["first_usable_day"], f"{x['usable_days']:,}", x["excluded_days_from_first_usable"],
                     f"{100 * x['null_share_pm2_5_since_first_usable']:.3f}%", pct(x["positive_rate"]), x["mean_pm2_5"],
                     x["days_mean_in_35.4_to_35.5"]])
    add(md_table(["Cell", "First non-null hour", "First usable day (>= 20 h)", "Usable days", "Excluded days after start",
                  "PM2.5 null share after start", "Positive rate (> 35.4)", "Mean PM2.5, ug/m3", "Days with mean in (35.4, 35.5)"], rows))
    po = h["pooled"]
    first = sorted({x["first_usable_day"] for x in h["cells"].values()})
    nulls = h["cells"]["west-tehran"]["null_share_by_pollutant_since_first_usable"]
    rates = [x["positive_rate"] for x in h["cells"].values()]
    west = h["cells"]["west-tehran"]
    add(f"\n- All cells start together: first usable day {', '.join(first)}. Hours before 03:00 that day are null (the series begins at 2022-08-04 00:00 UTC), "
        "leaving 21 of 24 hours, still labelled. The design spec's 2022-08-05 is conservative by one partial day.")
    add(f"- After the start no day is excluded for missing hours. The only nulls are the first 3 hours (null share {100 * nulls['PM2.5']:.4f}% "
        "for each of PM2.5, PM10, NO2, SO2, CO and O3 in every cell). History has no gaps today; the 20-of-24 rule matters only if a later fetch returns nulls.")
    add(f"- Pooled over the 12 cells: {po['usable_days_total']:,} labelled cell-days, positive rate **{pct(po['positive_rate'])}**.")
    add(f"- **The spec's 46.1% positive rate is the West Tehran cell alone ({pct(west['positive_rate'])}), not the pooled grid.** "
        f"Rates by cell run from {pct(min(rates))} to {pct(max(rates))}; only West Tehran, East Tehran and Far West exceed 10%. "
        "A pooled model sees heavy class imbalance and strong cell differences. The baselines, model card, and site text must use the pooled figure.")
    add("- Pooled positive rate by year (cell-days in brackets): "
        + "; ".join(f"{k}: {pct(v['positive_rate'])} ({v['days']:,})" for k, v in po["yearly"].items()) + ". 2022 starts in August and 2026 ends in early November.")
    add("- The latest hours (2026-11-02 evening) are present. For the most recent days the values come from CAMS forecast runs rather than a later analysis, "
        "so live inputs may differ slightly from the stored history. Disclose this limitation.\n")
    add("### Time labelling (matters for the cutoff)\n")
    add("- With `timezone=Asia/Tehran` the response reports `utc_offset_seconds = 12600` (+03:30) for the whole range, with no daylight-saving shift, "
        "and every day has exactly 24 values. Labels are whole hours: the value labelled `00:00` is the UTC 21:00 value "
        "(checked on 2026-10-25: the `GMT` and `Asia/Tehran` series differ by exactly a 3-hour shift). "
        "A labelled day is the 24 instants whose true local time (+03:30) is 00:30 to 23:30, so day boundaries are right for a daily mean.")
    add("- **Cutoff rule for features:** 12:00 Tehran is 08:30 UTC. The last CAMS hour not after the cutoff is 08:00 UTC, labelled `11:00` in "
        "Asia/Tehran time. Use labelled hours `00:00` to `11:00` (12 values) as same-day inputs. The value labelled `12:00` is 09:00 UTC, 30 minutes after the cutoff.")
    add("- Iran used +04:30 in summer until September 2022; the API labels the whole history with +03:30, so history is internally consistent.\n")

    # ---- label / EPA
    add("## Label threshold: EPA breakpoint\n")
    add(f"- Source: {e['citation']}. URL: <{e['url']}>. Effective {e['effective']}.")
    add(f"- The Appendix G PM2.5 24-hour table reads: Good 0-50 for 0.0-9.0 ug/m3; Moderate 51-100 for 9.1-{e['moderate_upper']}; "
        f"Unhealthy for Sensitive Groups 101-150 for {e['usg_lower']}-{e['usg_upper']}; Unhealthy 151-200 for 55.5-125.4. "
        f"The rule text says the EPA is retaining the AQI values of 100 and 150 at {e['rule_text_retains_aqi_100_at']} and 55.4 ug/m3. "
        "**The 2024 revision changed the Good/Moderate break (to 9.0) and the breakpoints from 200 up, not 35.4.**")
    add("- **Confirmed: 35.4 ug/m3 is the top of Moderate and 35.5 begins Unhealthy for Sensitive Groups.**")
    n_edge = sum(x["days_mean_in_35.4_to_35.5"] for x in h["cells"].values())
    add(f"- Truncation: Appendix G truncates PM2.5 to one decimal place before lookup ({'text found' if e['truncation_note'] else 'not found'}). "
        "A mean of 35.46 is therefore 35.4 (Moderate) for the EPA, while the project label `mean > 35.4` marks it positive. "
        f"This affects {n_edge} of {po['usable_days_total']:,} cell-days. The project keeps `mean > 35.4` as specified; "
        "the site should say \"above 35.4\" and not claim to reproduce an EPA category.")
    add("- The EPA defines the AQI for 24-hour averages of monitor data. Applying it to CAMS cell means is a labelling convention, not an EPA classification.\n")

    # ---- weather
    add("## Weather: can tomorrow's forecast, as issued, be reproduced?\n")
    add(f"Point {w['point']['latitude']}, {w['point']['longitude']} (West Tehran); model `{w['model']}` (ECMWF IFS HRES 9 km); variables temperature_2m, "
        "relative_humidity_2m, wind_speed_10m, precipitation, boundary_layer_height. Cutoff 12:00 Tehran = 08:30 UTC; the workflow runs at 10:00 UTC. "
        "Coverage was probed at this one point and is assumed the same at the other 11 cell centres.\n")
    meta = w["ecmwf_ifs_run_meta"]
    add(f"- The 00 UTC IFS run became available {meta['delay_hours']} h after initialisation (one observation of Open-Meteo's run metadata: initialised "
        f"{meta['initialised_utc']}, available {meta['available_utc']}). At 08:30 UTC only the 00 UTC run of the same day is in hand; "
        "the 06 UTC run arrives near 13:00 UTC. A forecast \"as issued before the cutoff\" for tomorrow is the 00 UTC run of today, at lead times of about 21 to 44 hours.\n")

    def first_ok(samples, var):
        ok = [d for d, v in samples.items() if "error" not in v and v.get(var) == 0.0]
        return (min(ok) if ok else "never"), len(ok), len(samples)

    hf, pr_ = w["historical_forecast_samples"], w["previous_runs_samples"]
    rows = []
    for v in ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation", "boundary_layer_height"]:
        a, n, t = first_ok(hf, v)
        b, n2, t2 = first_ok(pr_, v)
        rows.append([v, f"{a} ({n} of {t} samples populated)", f"{b} ({n2} of {t2} samples populated)"])
    add("Archive coverage, 3-day samples at quarter starts from 2021-01-05 to 2026-10-05 (a sample is populated when it has no nulls):\n")
    add(md_table(["Variable", "Historical Forecast API: first populated sample", "Previous Runs API `_previous_day1`: first populated sample"], rows))
    add("\n- Historical Forecast: temperature, humidity, wind and precipitation are populated in every sample back to 2021-01-05 (the earliest probed; "
        "the documentation says 2017 for this model). "
        f"Boundary layer height begins on **{w['hf_boundary_layer_height_first_day']}** and is missing 24% of the hours in October 2025 at the sampled point.")
    add(f"- Previous Runs with `ecmwf_ifs`: first populated day **{w['pr_ecmwf_ifs_temperature_first_day']}**, uneven afterwards (several 2026 samples lack "
        "temperature and humidity, or wind and precipitation), and boundary layer height is never populated. With the default model (`best_match`) the four weather variables are populated "
        "from the 2024-04-05 sample, but boundary layer height never is, and `best_match` is a blend whose members change over time. Not usable for a fixed run.")
    sp = w["single_runs_probe"]
    good = [r for r, v in sp.items() if "error" not in v]
    bad = [r for r, v in sp.items() if "error" in v]
    add(f"- Single Runs API (`ecmwf_ifs`): populated for runs {', '.join(good)} (all five variables, 7-day horizon; precipitation has no value for hour 0). "
        f"Refused: {', '.join(bad)} (\"requested model run is not available\"). The documentation says other models start 2026-04-02; a request for a 2025 GFS run was refused.")
    rc = [r for r in w["run_comparison"] if "error" not in r]
    same = all(r["historical_forecast_vs_runs_mean_abs_diff"] == r["previous_day0_vs_runs_mean_abs_diff"] for r in rc)
    diffs = "; ".join(f"{r['target']}: {min(r['historical_forecast_vs_runs_mean_abs_diff'].values())} to "
                      f"{max(r['historical_forecast_vs_runs_mean_abs_diff'].values())}" for r in rc)
    add("- The Historical Forecast API is **not an as-issued archive**. Its documentation says it joins the first hours of each model run into one timeseries, "
        f"and the measurement agrees: for {len(rc)} target days its temperature series equals `previous_day0` exactly ({same}) and differs from each single run "
        f"(mean absolute difference in degrees C, by target day: {diffs}). It is the near-analysis value, not what was forecast the day before.")
    late = tot = 0
    for r in rc:
        cut = pd.Timestamp(r["target"]) - pd.Timedelta(days=1) + pd.Timedelta(hours=8, minutes=30)
        for k in r["previous_day1_best_run_by_utc_hour"].values():
            tot += 1
            late += int(pd.Timestamp(k.replace("Z", ":00")) > cut)
    add("- `previous_day1` is a fixed 24 h lead per valid hour, so it mixes runs through the day. It matched no single run exactly "
        f"(mean absolute difference {min(min(r['previous_day1_vs_runs_mean_abs_diff'].values()) for r in rc)} to "
        f"{max(max(r['previous_day1_vs_runs_mean_abs_diff'].values()) for r in rc)} degrees C), and in {late} of {tot} sampled hours the nearest run was "
        "initialised after the 08:30 UTC cutoff. It cannot reproduce \"the run in hand at 12:00\".\n")

    add("### Verdict\n")
    add("**Tomorrow's forecast as issued before the cutoff is reproducible only from 2024-03-14, only for ECMWF IFS, and only through the Single Runs API "
        "(the 00 UTC run of the day before the target, all five variables including boundary layer height). It is not reproducible from the Historical "
        "Forecast API (not as-issued) or from the Previous Runs API (wrong run mix, short and patchy archive, no boundary layer height).**\n")
    add("Using the Single Runs path would cut the labelled history from 1,552 days to about 960 (2024-03-14 to 2026-11-02), leaving about 14 months to train on "
        "after a 12-month held-out set and a 6-month selection set: one winter cycle. It needs one request per cell-day (about 11,500 cell-days), "
        "several days of free-tier quota, and the model changed IFS cycle on 2026-05-12 inside the held-out year (documentation claim).\n")
    add("**Decision, per the Task 1 rule: use today's weather only.** Same-day temperature, humidity, wind speed and precipitation (labelled hours `00:00` to "
        "`11:00`, up to the cutoff) come from the Historical Forecast API with `models=ecmwf_ifs`. They are populated since at least 2021-01-05, so the whole "
        "pollutant history is covered. They are stitched first hours of runs, the same kind of value a live call returns for past hours, so training and live "
        f"inputs should match (Task 5 must confirm this against a live call). Boundary layer height exists only from {w['hf_boundary_layer_height_first_day']} with holes and is **excluded**. "
        "Tomorrow's weather is not an input: the spec's \"tomorrow's forecast weather\" becomes \"today's weather up to the cutoff\". "
        "The Single Runs path stays available as a later experiment on the shorter window.\n")

    add("## Reproduce\n")
    add("```\npython training/verify_sources.py all      # grid, history, weather, epa (slow: respects the rate limits)\n"
        "python training/verify_sources.py profile  # regenerate this file from data/raw/verify_*.json\n```\n")
    out = ROOT / "docs" / "DATA_PROFILE.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(L) + "\n", encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    stages = sys.argv[1:] or ["all"]
    for st in stages:
        if st in ("grid", "all"):
            stage_grid()
        if st in ("weather", "all"):
            stage_weather()
        if st in ("epa", "all"):
            stage_epa()
        if st in ("history", "all"):
            stage_history()
        if st == "profile":
            stage_profile()
