"""Features at the 12:00 Tehran cutoff, the time split and the scaler, built so nothing late leaks in.

Each day D at 12:00 Tehran time (08:30 UTC; Tehran is UTC+03:30) we predict whether the
Tehran-day mean PM2.5 of D+1 exceeds the threshold. Open-Meteo's pollutant concentrations and
temperature are instantaneous values at the stamp; precipitation is the sum of the preceding
hour. Either way, the stamps usable at the cutoff are those up to 08:00 UTC (08:30 UTC is the
cutoff). The window is the 12 stamps from 21:00 UTC on D-1 through 08:00 UTC on D (00:30-11:30
Tehran time on D). Nothing stamped 09:00 UTC on D or later can influence a row, and the CAMS
forecast for tomorrow is never an input. A row needs all 12 hours of all 10 inputs to be non-null; otherwise
there is no row. Nothing is ever imputed.

Iran kept +04:30 summer time until 2022-09-21. On those days the 08:00 UTC stamp is 12:30 local
time, past the cutoff, so issue days D (and target days D+1) whose Asia/Tehran offset is not
+03:30 give no row (`on_standard_time`).

`build_row` makes one row (used live each day), `build_dataset` makes every row of the history at
once, and the two give identical values. `split_by_time` and the z-score helpers keep selection
and held-out rows out of every fitted number.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from pipeline.fetch import POLLUTANTS, WEATHER
from training.labels import TEHRAN

# The ten hourly columns that feed the features, in the order the helpers below index them.
INPUTS = [*POLLUTANTS, *WEATHER]
_PM25, _PRECIP = INPUTS.index("pm2_5"), INPUTS.index("precipitation")

WINDOW_HOURS = 12                         # 21:00 UTC (D-1) .. 08:00 UTC (D)
LAST_STAMP_HOUR = 8                       # the last usable stamp is 08:00 UTC on D
CUTOFF = pd.Timedelta(hours=8, minutes=30)  # 12:00 Tehran time, as an offset from 00:00 UTC on D
_LAST_STAMP = pd.Timedelta(hours=LAST_STAMP_HOUR)
_OFFSETS = np.arange(1 - WINDOW_HOURS, 1)   # -11 .. 0 hours relative to the last stamp
_YEAR_DAYS = 365.25
STANDARD_OFFSET = pd.Timedelta(hours=3, minutes=30)   # Asia/Tehran without summer time

# Kept in every row for testing and audit, never fed to the model.
AUDIT_COLUMNS = ["cell_id", "day", "target_date", "latest_input_utc", "cutoff_utc"]

FEATURES = [
    "pm2_5_mean",   # mean PM2.5 over the 12 pre-cutoff hours, ug/m3
    "pm10_mean",    # mean PM10 over the window, ug/m3
    "no2_mean",     # mean nitrogen dioxide over the window, ug/m3
    "so2_mean",     # mean sulphur dioxide over the window, ug/m3
    "co_mean",      # mean carbon monoxide over the window, ug/m3
    "o3_mean",      # mean ozone over the window, ug/m3
    "pm2_5_max",    # highest hourly PM2.5 in the window, ug/m3
    "pm2_5_last",   # the PM2.5 stamped 08:00 UTC on D (11:30 Tehran), ug/m3
    "temp_mean",    # mean 2 m temperature over the window, degrees C
    "rh_mean",      # mean relative humidity over the window, percent
    "wind_mean",    # mean 10 m wind speed over the window, km/h
    "precip_sum",   # total precipitation over the window, mm
    "season_sin",   # sin(2 pi doy / 365.25), doy = day of year of the TARGET date D+1
    "season_cos",   # cos(2 pi doy / 365.25), same doy
]


def _check_utc(column: pd.Series) -> None:
    if not pd.api.types.is_datetime64_any_dtype(column) or column.dt.tz is None:
        raise ValueError("time_utc must be timezone-aware (UTC); got naive timestamps")


def on_standard_time(days) -> np.ndarray:
    """True for each date whose Asia/Tehran offset at the 08:30 UTC cutoff is +03:30.

    False for the summer-time days up to 2022-09-21, when the offset was +04:30.
    """
    cutoffs = pd.DatetimeIndex(pd.to_datetime(pd.Series(list(days), dtype=object))) + CUTOFF
    local = cutoffs.tz_localize("UTC").tz_convert(TEHRAN).tz_localize(None)
    return np.asarray(local - cutoffs == STANDARD_OFFSET, dtype=bool)


def _issuable(days) -> np.ndarray:
    """Issue day D and target day D+1 are both on +03:30."""
    days = pd.to_datetime(pd.Series(list(days), dtype=object))
    return on_standard_time(days) & on_standard_time(days + pd.Timedelta(days=1))


def _features(windows: np.ndarray, target_dates: pd.DatetimeIndex) -> pd.DataFrame:
    """The FEATURES columns for n windows shaped (n, 10 inputs, 12 hours), oldest hour first.

    Both build_row and build_dataset call this, so a row has the same numbers either way.
    """
    w = np.ascontiguousarray(windows, dtype=float)
    means = w.mean(axis=2)
    angle = 2 * np.pi * np.asarray(target_dates.dayofyear, dtype=float) / _YEAR_DAYS
    columns = [means[:, i] for i in range(6)]                       # the six pollutant means
    columns += [w[:, _PM25, :].max(axis=1), w[:, _PM25, -1]]
    columns += [means[:, 6], means[:, 7], means[:, 8], w[:, _PRECIP, :].sum(axis=1)]
    columns += [np.sin(angle), np.cos(angle)]
    return pd.DataFrame(dict(zip(FEATURES, columns)))


# lab:build_row
def build_row(hourly: pd.DataFrame, cell_id: str, day) -> dict | None:
    """One feature row for `cell_id`, issued at 12:00 Tehran time on the Tehran date `day` (D).

    Uses only the 12 stamps 21:00 UTC (D-1) .. 08:00 UTC (D), all at or before the 08:30 UTC
    cutoff. Returns None on summer-time days (see on_standard_time) and unless all 12 hours are
    present and non-null in all 10 inputs. The label date is D+1. Features, in the order of
    FEATURES: the means of PM2.5, PM10, NO2, SO2, CO and O3; the maximum and the last (08:00 UTC) value of PM2.5; the means of temperature,
    humidity and wind speed and the sum of precipitation; sin and cos of the season angle of D+1.
    The row also carries cell_id, day, target_date, latest_input_utc and cutoff_utc for audit.
    """
    _check_utc(hourly["time_utc"])
    day = pd.Timestamp(day).date()
    if not _issuable([day])[0]:
        return None                                         # summer time: 08:00 UTC is past 12:00
    last = pd.Timestamp(day, tz="UTC") + _LAST_STAMP
    stamps = last + pd.to_timedelta(_OFFSETS, unit="h")
    cell = hourly[hourly["cell_id"] == cell_id]
    inside = cell[cell["time_utc"].isin(stamps)]
    if inside["time_utc"].duplicated().any():
        raise ValueError(f"duplicate hourly stamps for cell {cell_id!r} on {day}")
    window = inside.sort_values("time_utc")
    if len(window) < WINDOW_HOURS:
        return None
    values = window[INPUTS].to_numpy(dtype=float)               # (12 hours, 10 inputs)
    if np.isnan(values).any():
        return None
    target = day + dt.timedelta(days=1)
    feats = _features(values.T[None, :, :], pd.DatetimeIndex([target]))
    row = {"cell_id": cell_id, "day": day, "target_date": target,
           "latest_input_utc": last, "cutoff_utc": last + (CUTOFF - _LAST_STAMP)}
    row.update({name: float(feats[name].iloc[0]) for name in FEATURES})
    return row
# endlab


def _cell_rows(block: pd.DataFrame) -> pd.DataFrame:
    """Audit columns and features for every complete window of one cell (any row order)."""
    cell_id = block["cell_id"].iloc[0]
    times = pd.DatetimeIndex(block["time_utc"]).tz_convert("UTC")
    if times.has_duplicates:
        raise ValueError(f"duplicate hourly stamps for cell {cell_id!r}")
    grid = pd.date_range(times.min().floor("h"), times.max(), freq="h")   # a complete hourly grid
    values = pd.DataFrame(block[INPUTS].to_numpy(dtype=float), index=times).sort_index() \
        .reindex(grid).to_numpy()                                         # gaps become NaN
    ends = np.flatnonzero(np.asarray(grid.hour) == LAST_STAMP_HOUR)
    ends = ends[ends >= WINDOW_HOURS - 1]
    windows = values[ends[:, None] + _OFFSETS]                            # (n, 12 hours, 10 inputs)
    complete = ~np.isnan(windows).any(axis=(1, 2))
    ends, windows = ends[complete], windows[complete]
    last = grid[ends]
    days = last.tz_localize(None).normalize()
    targets = days + pd.Timedelta(days=1)
    out = pd.DataFrame({"cell_id": cell_id,
                        "day": [d.date() for d in days],
                        "target_date": [d.date() for d in targets],
                        "latest_input_utc": last,
                        "cutoff_utc": last + (CUTOFF - _LAST_STAMP)})
    return pd.concat([out, _features(windows.transpose(0, 2, 1), targets)], axis=1)


def labelled_windows(hourly: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    """Every (cell, D) with a complete window and a label for D+1, summer-time days included.

    build_dataset is this minus the summer-time days; the data profile counts the difference.
    """
    _check_utc(hourly["time_utc"])
    if labels.duplicated(["cell_id", "date"]).any():
        raise ValueError("labels has duplicate (cell_id, date) pairs")
    frames = [_cell_rows(block) for _, block in hourly.groupby("cell_id", sort=True)]
    rows = pd.concat(frames, ignore_index=True) if frames else \
        pd.DataFrame(columns=AUDIT_COLUMNS + FEATURES)
    wanted = labels[["cell_id", "date", "y"]].rename(columns={"date": "target_date"})
    out = rows.merge(wanted, on=["cell_id", "target_date"], how="inner")
    out["y"] = out["y"].astype("int64")
    return out.sort_values(["cell_id", "day"]).reset_index(drop=True)[AUDIT_COLUMNS + FEATURES + ["y"]]


def build_dataset(hourly: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    """One row per (cell, D) with a complete window, a label for D+1, and D on +03:30.

    `labels` is the output of daily_labels (cell_id, date, y, ...). Columns: AUDIT_COLUMNS,
    then FEATURES, then y (int64). Sorted by cell then day; the values equal build_row's.
    """
    out = labelled_windows(hourly, labels)
    if out.empty:
        return out
    return out[_issuable(out["day"])].reset_index(drop=True)


# lab:split_by_time
def split_by_time(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(train, selection, held_out) by `target_date`, oldest to newest with no overlap.

    The held-out set is the final 12 calendar months (target_date later than the last target
    date minus 12 months), selection is the 6 months before that, train is everything earlier.
    Every cell stays in all three parts; the model is pooled across cells.
    """
    if df.empty:
        raise ValueError("need more than 18 months of history to split; got no rows")
    dates = pd.to_datetime(df["target_date"])
    held_after = dates.max() - pd.DateOffset(months=12)
    selection_after = held_after - pd.DateOffset(months=6)
    held = df[dates > held_after]
    selection = df[(dates > selection_after) & (dates <= held_after)]
    train = df[dates <= selection_after]
    if train.empty or selection.empty or held.empty:
        raise ValueError("need more than 18 months of history to split into train, "
                         f"selection and held-out; got {dates.min().date()} to {dates.max().date()}")
    return (train.reset_index(drop=True), selection.reset_index(drop=True),
            held.reset_index(drop=True))
# endlab


# lab:zscore
def _guard(sigma) -> np.ndarray:
    sigma = np.asarray(sigma, dtype=float)
    if np.isnan(sigma).any():
        raise ValueError("sigma is NaN; the training columns must not contain NaN")
    return np.where(sigma < 1e-12, 1.0, sigma)


def zscore_fit(X) -> tuple[np.ndarray, np.ndarray]:
    """Per-column mean and standard deviation of the TRAINING rows.

    A (nearly) constant column, sigma below 1e-12, gets sigma = 1. NaN raises ValueError.
    """
    X = np.asarray(X, dtype=float)
    if X.ndim == 1:
        X = X.reshape(-1, 1)
    mu = X.mean(axis=0)
    sigma = _guard(X.std(axis=0))
    return mu, sigma


def zscore_apply(X, mu, sigma) -> np.ndarray:
    """(X - mu) / sigma, with any sigma below 1e-12 treated as 1. NaN sigma raises ValueError."""
    X = np.asarray(X, dtype=float)
    return (X - mu) / _guard(sigma)
# endlab
