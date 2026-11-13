"""Weather inputs in the training dataset: joined on (cell, target date), dropped when missing."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from pipeline.weather import WX_FEATURES, read_weather
from tests.test_leakage import make_hourly
from training.features import AUDIT_COLUMNS, FEATURES, build_dataset
from training.labels import daily_labels


def make_weather(dataset: pd.DataFrame, skip=()) -> pd.DataFrame:
    """One weather row per (cell, target_date) of `dataset`, run issued 00:00 UTC on day D."""
    rows = []
    for i, r in dataset.iterrows():
        if (r["cell_id"], r["target_date"]) in skip:
            continue
        rows.append({"cell_id": r["cell_id"], "target_date": r["target_date"],
                     "issued_run_utc": f"{r['day']}T00:00Z",
                     **{name: float(j + i) for j, name in enumerate(WX_FEATURES)}})
    return pd.DataFrame(rows)


def base():
    hourly = make_hourly(days=60)
    return hourly, daily_labels(hourly)


def test_weather_joins_on_target_date():
    hourly, labels = base()
    plain = build_dataset(hourly, labels)
    wx = make_weather(plain)
    out = build_dataset(hourly, labels, weather=wx)
    assert len(out) == len(plain)
    assert list(out.columns) == AUDIT_COLUMNS + ["issued_run_utc"] + FEATURES + WX_FEATURES + ["y"]
    # run D feeds the row whose target_date is D+1
    assert (pd.to_datetime(out["issued_run_utc"].str[:10]).dt.date == out["day"]).all()
    assert (pd.to_datetime(out["target_date"]) - pd.to_datetime(out["day"]) == pd.Timedelta(days=1)).all()
    key = out.iloc[3]
    want = wx[(wx["cell_id"] == key["cell_id"]) & (wx["target_date"] == key["target_date"])].iloc[0]
    assert key["wx_temp"] == want["wx_temp"] and key["wx_blh"] == want["wx_blh"]


def test_rows_without_weather_are_dropped_for_every_set():
    hourly, labels = base()
    plain = build_dataset(hourly, labels)
    gone = (plain["cell_id"][5], plain["target_date"][5])
    wx = make_weather(plain, skip={gone})
    wx.loc[wx.index[10], "wx_rh"] = np.nan            # a missing variable drops the row too
    out = build_dataset(hourly, labels, weather=wx)
    assert len(out) == len(plain) - 2
    assert not out[WX_FEATURES].isna().any().any()
    assert not ((out["cell_id"] == gone[0]) & (out["target_date"] == gone[1])).any()


def test_weather_run_starts_before_the_cutoff():
    hourly, labels = base()
    plain = build_dataset(hourly, labels)
    out = build_dataset(hourly, labels, weather=make_weather(plain))
    issued = pd.to_datetime(out["issued_run_utc"])
    assert (issued < out["cutoff_utc"]).all()
    assert ((out["cutoff_utc"] - issued) == pd.Timedelta(hours=8, minutes=30)).all()


def test_without_weather_dataset_is_unchanged():
    hourly, labels = base()
    out = build_dataset(hourly, labels)
    assert list(out.columns) == AUDIT_COLUMNS + FEATURES + ["y"]
    pd.testing.assert_frame_equal(out, build_dataset(hourly, labels, weather=None))


def test_read_weather_round_trip_joins(tmp_path):
    hourly, labels = base()
    plain = build_dataset(hourly, labels)
    path = tmp_path / "weather.csv.gz"
    make_weather(plain).to_csv(path, index=False)
    back = read_weather(path)
    assert isinstance(back["target_date"].iloc[0], dt.date)
    assert len(build_dataset(hourly, labels, weather=back)) == len(plain)
