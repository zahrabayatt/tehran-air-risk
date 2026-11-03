"""Daily labels: did a cell's Tehran-calendar-day mean PM2.5 exceed the threshold?

A day is the Asia/Tehran calendar date (UTC+03:30, no daylight saving since 2022) of
each hourly UTC timestamp. The hour stamped 20:00 UTC is 23:30 Tehran time, the last
hour of that Tehran date; 21:00 UTC is 00:30 on the next date.
"""
from __future__ import annotations

import pandas as pd

TEHRAN = "Asia/Tehran"
THRESHOLD = 35.4   # U.S. EPA 24-hour PM2.5 AQI breakpoint (docs/DATA_PROFILE.md)
MIN_HOURS = 20     # fewest non-null hourly values for a day to count
COLUMNS = ["cell_id", "date", "y", "mean_pm25"]

# Means of one-decimal values carry float noise around 1e-14; a mean of exactly 35.4
# must compare as 35.4. Nine decimals is far below the data's own resolution.
_NOISE_DECIMALS = 9


def daily_labels(hourly: pd.DataFrame, threshold: float = THRESHOLD, min_hours: int = MIN_HOURS) -> pd.DataFrame:
    """Label each (cell, Tehran day) with y = 1 iff the mean PM2.5 is strictly above `threshold`.

    `hourly` needs `cell_id`, `time_utc` (tz-aware) and `pm2_5`; NaN hours are ignored and
    do not count toward `min_hours`. Days with fewer than `min_hours` non-null hours get no
    row. Returns `cell_id, date, y, mean_pm25`, sorted by cell then date: `date` holds
    `datetime.date` objects (Tehran calendar dates), `y` is int 0/1, `mean_pm25` is the
    mean over the non-null hours.
    """
    times = pd.DatetimeIndex(hourly["time_utc"])
    if times.tz is None:
        raise ValueError("time_utc must be timezone-aware (UTC); got naive timestamps")
    frame = pd.DataFrame({
        "cell_id": hourly["cell_id"].to_numpy(),
        "date": times.tz_convert(TEHRAN).date,
        "pm2_5": hourly["pm2_5"].to_numpy(dtype=float),
    })
    daily = (frame.groupby(["cell_id", "date"], sort=True)["pm2_5"]
             .agg(n="count", mean_pm25="mean").reset_index())
    daily = daily[daily["n"] >= min_hours].copy()
    daily["y"] = (daily["mean_pm25"].round(_NOISE_DECIMALS) > threshold).astype("int64")
    return daily[COLUMNS].reset_index(drop=True)
