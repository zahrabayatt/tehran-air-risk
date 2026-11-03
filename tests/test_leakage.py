"""Leakage tests: a row issued at the 12:00 Tehran cutoff may use only data stamped at or before it.

Tehran is UTC+03:30, so the cutoff of issue day D is 08:30 UTC. The last usable hourly stamp
is 08:00 UTC (11:30 Tehran) and the window is the 12 stamps 21:00 UTC (D-1) .. 08:00 UTC (D).
The label is the mean PM2.5 of the Tehran day D+1.
"""
from __future__ import annotations

import datetime as dt
import inspect

import numpy as np
import pandas as pd
import pytest

from pipeline.fetch import COLUMNS as HOURLY_COLUMNS
from training import features
from training.features import (AUDIT_COLUMNS, FEATURES, build_dataset, build_row, split_by_time,
                               zscore_apply, zscore_fit)
from training.labels import daily_labels

VARIABLES = HOURLY_COLUMNS[2:]          # the six pollutants and four weather columns
CELLS = ["west-tehran", "far-east"]


def make_hourly(start="2024-01-01", days=40, cells=CELLS, seed=0):
    """Random hourly history on a complete UTC grid, one block per cell, no nulls."""
    rng = np.random.default_rng(seed)
    times = pd.date_range(pd.Timestamp(start, tz="UTC"), periods=24 * days, freq="h")
    blocks = []
    for cell in cells:
        block = pd.DataFrame({"cell_id": cell, "time_utc": times})
        for name in VARIABLES:
            block[name] = rng.uniform(1.0, 100.0, size=len(times)).round(1)
        blocks.append(block)
    return pd.concat(blocks, ignore_index=True)


def cutoff_of(day):
    return pd.Timestamp(day, tz="UTC") + pd.Timedelta(hours=8, minutes=30)


# ---------------------------------------------------------------- interface and column names

def test_build_row_signature_has_no_forecast_argument():
    assert list(inspect.signature(build_row).parameters) == ["hourly", "cell_id", "day"]


def test_features_constant_is_the_agreed_list_in_order():
    assert FEATURES == [
        "pm2_5_mean", "pm10_mean", "no2_mean", "so2_mean", "co_mean", "o3_mean",
        "pm2_5_max", "pm2_5_last",
        "temp_mean", "rh_mean", "wind_mean", "precip_sum",
        "season_sin", "season_cos",
    ]
    assert len(set(FEATURES)) == len(FEATURES)


def test_no_forecast_or_tomorrow_column_exists():
    hourly = make_hourly()
    row = build_row(hourly, "west-tehran", dt.date(2024, 1, 10))
    ds = build_dataset(hourly, daily_labels(hourly))
    banned = ("forecast", "cams", "tomorrow", "next", "target_pm", "label_pm", "mean_pm25")
    for name in list(row) + list(ds.columns) + FEATURES:
        assert not any(word in name.lower() for word in banned), name
    assert set(row) == set(AUDIT_COLUMNS) | set(FEATURES)
    assert list(ds.columns) == AUDIT_COLUMNS + FEATURES + ["y"]
    assert "y" not in row


def test_only_audit_columns_besides_features_and_label():
    assert AUDIT_COLUMNS == ["cell_id", "day", "target_date", "latest_input_utc", "cutoff_utc"]
    assert not set(AUDIT_COLUMNS) & set(FEATURES)


# ---------------------------------------------------------------- the 12:00 cutoff

def test_row_values_on_a_known_window():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    row = build_row(hourly, "west-tehran", day)
    stamps = pd.date_range("2024-01-09 21:00", "2024-01-10 08:00", freq="h", tz="UTC")
    assert len(stamps) == 12
    w = hourly[(hourly["cell_id"] == "west-tehran") & hourly["time_utc"].isin(stamps)].sort_values("time_utc")
    assert row["pm2_5_mean"] == pytest.approx(w["pm2_5"].mean())
    assert row["pm10_mean"] == pytest.approx(w["pm10"].mean())
    assert row["no2_mean"] == pytest.approx(w["nitrogen_dioxide"].mean())
    assert row["so2_mean"] == pytest.approx(w["sulphur_dioxide"].mean())
    assert row["co_mean"] == pytest.approx(w["carbon_monoxide"].mean())
    assert row["o3_mean"] == pytest.approx(w["ozone"].mean())
    assert row["pm2_5_max"] == w["pm2_5"].max()
    assert row["pm2_5_last"] == w["pm2_5"].iloc[-1]
    assert row["temp_mean"] == pytest.approx(w["temperature_2m"].mean())
    assert row["rh_mean"] == pytest.approx(w["relative_humidity_2m"].mean())
    assert row["wind_mean"] == pytest.approx(w["wind_speed_10m"].mean())
    assert row["precip_sum"] == pytest.approx(w["precipitation"].sum())


def test_window_is_pre_cutoff_in_tehran_time():
    # 21:00 UTC (D-1) is 00:30 on the Tehran date D; 08:00 UTC is 11:30 on D.
    stamps = pd.date_range("2024-01-09 21:00", "2024-01-10 08:00", freq="h", tz="UTC")
    local = stamps.tz_convert("Asia/Tehran")
    assert {t.date() for t in local} == {dt.date(2024, 1, 10)}
    assert local[0].strftime("%H:%M") == "00:30" and local[-1].strftime("%H:%M") == "11:30"


def test_latest_input_is_at_most_the_cutoff():
    hourly = make_hourly()
    for day in [dt.date(2024, 1, 3), dt.date(2024, 1, 20), dt.date(2024, 2, 5)]:
        row = build_row(hourly, "far-east", day)
        assert row["latest_input_utc"] == pd.Timestamp(day, tz="UTC") + pd.Timedelta(hours=8)
        assert row["cutoff_utc"] == cutoff_of(day)
        assert row["latest_input_utc"] <= row["cutoff_utc"]
    ds = build_dataset(hourly, daily_labels(hourly))
    assert (ds["latest_input_utc"] <= ds["cutoff_utc"]).all()
    assert (ds["latest_input_utc"].dt.tz is not None) and str(ds["cutoff_utc"].dt.tz) == "UTC"


def test_label_date_is_the_next_day_and_inputs_end_before_the_label_day_starts():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    row = build_row(hourly, "west-tehran", day)
    assert row["day"] == day
    assert row["target_date"] == dt.date(2024, 1, 11)
    # Tehran day D+1 starts at 21:00 UTC on D; no input may be that late.
    label_day_start = pd.Timestamp("2024-01-10 21:00", tz="UTC")
    assert row["latest_input_utc"] < label_day_start
    ds = build_dataset(hourly, daily_labels(hourly))
    assert (pd.to_datetime(ds["target_date"]) - pd.to_datetime(ds["day"]) == pd.Timedelta(days=1)).all()


@pytest.mark.parametrize("first_late_stamp", ["2024-01-10 09:00", "2024-01-10 10:00", "2024-01-10 21:00",
                                              "2024-01-11 08:00"])
def test_changing_any_value_at_or_after_0900_utc_leaves_the_row_unchanged(first_late_stamp):
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    before = build_row(hourly, "west-tehran", day)
    changed = hourly.copy()
    late = changed["time_utc"] >= pd.Timestamp("2024-01-10 09:00", tz="UTC")
    assert late.sum() > 0
    changed.loc[late, VARIABLES] = 9999.0                  # every variable, every cell, all later stamps
    assert build_row(changed, "west-tehran", day) == before
    # also when only one late stamp, in one column, is touched
    one = hourly.copy()
    hit = (one["cell_id"] == "west-tehran") & (one["time_utc"] == pd.Timestamp(first_late_stamp, tz="UTC"))
    assert hit.sum() == 1
    one.loc[hit, "pm2_5"] = -5.0
    assert build_row(one, "west-tehran", day) == before


def test_removing_all_data_after_the_cutoff_leaves_the_row_unchanged():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    truncated = hourly[hourly["time_utc"] <= cutoff_of(day)]
    assert build_row(truncated, "west-tehran", day) == build_row(hourly, "west-tehran", day)


def test_the_label_day_pm25_cannot_reach_the_features():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    target_day = (hourly["time_utc"] >= pd.Timestamp("2024-01-10 21:00", tz="UTC")) & \
                 (hourly["time_utc"] <= pd.Timestamp("2024-01-11 20:00", tz="UTC"))
    hourly.loc[target_day, "pm2_5"] = 5.0                  # a clean target day: label 0
    spiked = hourly.copy()
    spiked.loc[target_day, "pm2_5"] = 1000.0
    assert build_row(spiked, "west-tehran", day) == build_row(hourly, "west-tehran", day)
    clean = build_dataset(hourly, daily_labels(hourly))
    dirty = build_dataset(spiked, daily_labels(spiked))
    a = clean[(clean["cell_id"] == "west-tehran") & (clean["day"] == day)].iloc[0]
    b = dirty[(dirty["cell_id"] == "west-tehran") & (dirty["day"] == day)].iloc[0]
    assert (a[FEATURES] == b[FEATURES]).all()
    assert a["y"] == 0 and b["y"] == 1                      # the label did change


def test_changing_a_value_inside_the_window_does_change_the_row():
    # Guards the guards: the leakage tests above would pass trivially if rows ignored the data.
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    changed = hourly.copy()
    hit = (changed["cell_id"] == "west-tehran") & (changed["time_utc"] == pd.Timestamp("2024-01-10 08:00", tz="UTC"))
    changed.loc[hit, "pm2_5"] = 777.0
    after = build_row(changed, "west-tehran", day)
    assert after["pm2_5_last"] == 777.0 and after["pm2_5_max"] == 777.0
    # one hour earlier than the window is not used either
    older = hourly.copy()
    hit = (older["cell_id"] == "west-tehran") & (older["time_utc"] == pd.Timestamp("2024-01-09 20:00", tz="UTC"))
    older.loc[hit, "pm2_5"] = 777.0
    assert build_row(older, "west-tehran", day) == build_row(hourly, "west-tehran", day)


def test_other_cells_do_not_leak_into_a_cell():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    changed = hourly.copy()
    changed.loc[changed["cell_id"] == "far-east", VARIABLES] = 0.0
    assert build_row(changed, "west-tehran", day) == build_row(hourly, "west-tehran", day)


# ---------------------------------------------------------------- incomplete inputs give None

def test_row_is_none_when_any_window_hour_is_missing_or_null():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    assert build_row(hourly, "west-tehran", day) is not None
    stamp = pd.Timestamp("2024-01-10 03:00", tz="UTC")
    for name in VARIABLES:
        nulled = hourly.copy()
        nulled.loc[(nulled["cell_id"] == "west-tehran") & (nulled["time_utc"] == stamp), name] = np.nan
        assert build_row(nulled, "west-tehran", day) is None, name
    dropped = hourly[~((hourly["cell_id"] == "west-tehran") & (hourly["time_utc"] == stamp))]
    assert build_row(dropped, "west-tehran", day) is None
    assert build_row(dropped, "far-east", day) is not None           # other cells unaffected


def test_row_is_none_at_the_edges_of_the_history_and_for_unknown_cells():
    hourly = make_hourly(start="2024-01-01", days=10)
    assert build_row(hourly, "west-tehran", dt.date(2024, 1, 1)) is None   # window starts 2023-12-31 21:00
    assert build_row(hourly, "west-tehran", dt.date(2024, 1, 2)) is not None
    assert build_row(hourly, "west-tehran", dt.date(2024, 1, 10)) is not None  # 08:00 UTC Jan 10 is the last full window
    assert build_row(hourly, "west-tehran", dt.date(2024, 1, 11)) is None      # 08:00 UTC Jan 11 does not exist
    assert build_row(hourly, "nowhere", dt.date(2024, 1, 5)) is None


def test_no_imputation_a_null_after_the_window_does_not_block_and_before_it_does_not_matter():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)
    nulled = hourly.copy()
    nulled.loc[nulled["time_utc"] >= pd.Timestamp("2024-01-10 09:00", tz="UTC"), VARIABLES] = np.nan
    nulled.loc[nulled["time_utc"] < pd.Timestamp("2024-01-09 21:00", tz="UTC"), VARIABLES] = np.nan
    assert build_row(nulled, "west-tehran", day) == build_row(hourly, "west-tehran", day)


# ---------------------------------------------------------------- season

def test_season_uses_the_target_date():
    hourly = make_hourly()
    day = dt.date(2024, 1, 10)                       # target 2024-01-11 = day of year 11
    row = build_row(hourly, "west-tehran", day)
    angle = 2 * np.pi * 11 / 365.25
    assert row["season_sin"] == pytest.approx(np.sin(angle))
    assert row["season_cos"] == pytest.approx(np.cos(angle))
    assert row["season_sin"] ** 2 + row["season_cos"] ** 2 == pytest.approx(1.0)


# ---------------------------------------------------------------- build_dataset

def test_dataset_has_one_row_per_cell_day_with_a_label_and_a_complete_window():
    hourly = make_hourly(days=12)
    labels = daily_labels(hourly)
    ds = build_dataset(hourly, labels)
    assert not ds.duplicated(["cell_id", "day"]).any()
    assert ds["y"].dtype == "int64"
    for cell in CELLS:
        days = ds.loc[ds["cell_id"] == cell, "day"]
        # window needs D-1 21:00 .. D 08:00 (so D >= Jan 2) and a label for D+1 (so D+1 <= last labelled day)
        assert days.min() == dt.date(2024, 1, 2)
        cell_labels = labels[labels["cell_id"] == cell]["date"]
        assert days.max() == cell_labels.max() - dt.timedelta(days=1)
        assert len(days) == len(set(days))
    # y is the label of D+1
    merged = ds.merge(labels, left_on=["cell_id", "target_date"], right_on=["cell_id", "date"], suffixes=("", "_l"))
    assert len(merged) == len(ds)
    assert (merged["y"] == merged["y_l"]).all()


def test_dataset_skips_days_without_a_label_or_a_complete_window():
    hourly = make_hourly(days=12)
    gap = (hourly["cell_id"] == "west-tehran") & (hourly["time_utc"] == pd.Timestamp("2024-01-05 02:00", tz="UTC"))
    hourly = hourly[~gap]
    ds = build_dataset(hourly, daily_labels(hourly))
    days = set(ds.loc[ds["cell_id"] == "west-tehran", "day"])
    assert dt.date(2024, 1, 5) not in days                           # window of Jan 5 has the hole
    assert dt.date(2024, 1, 4) in days and dt.date(2024, 1, 6) in days
    labels = daily_labels(hourly)
    no_label = labels[~((labels["cell_id"] == "west-tehran") & (labels["date"] == dt.date(2024, 1, 8)))]
    ds2 = build_dataset(hourly, no_label)
    assert dt.date(2024, 1, 7) not in set(ds2.loc[ds2["cell_id"] == "west-tehran", "day"])


def test_build_row_and_build_dataset_agree_exactly():
    hourly = make_hourly(days=60, seed=3)
    # real-shaped holes: a few nulls and a few missing rows
    rng = np.random.default_rng(9)
    for _ in range(25):
        i = rng.integers(0, len(hourly))
        hourly.loc[hourly.index[i], VARIABLES[rng.integers(0, len(VARIABLES))]] = np.nan
    hourly = hourly.drop(hourly.index[rng.integers(0, len(hourly), size=10)]).sample(frac=1.0, random_state=1)
    ds = build_dataset(hourly, daily_labels(hourly))
    assert len(ds) > 100
    sample = ds.sample(n=60, random_state=0)
    for _, expect in sample.iterrows():
        row = build_row(hourly, expect["cell_id"], expect["day"])
        assert row is not None
        for key in AUDIT_COLUMNS + FEATURES:
            assert row[key] == expect[key], key
    # and every day build_row accepts is in the dataset when it has a label
    labels = daily_labels(hourly)
    have = set(zip(labels["cell_id"], labels["date"]))
    in_ds = set(zip(ds["cell_id"], ds["day"]))
    for cell in CELLS:
        for offset in range(1, 59):
            d = dt.date(2024, 1, 1) + dt.timedelta(days=offset)
            accepted = build_row(hourly, cell, d) is not None and (cell, d + dt.timedelta(days=1)) in have
            assert accepted == ((cell, d) in in_ds), (cell, d)


def test_inputs_are_not_modified_and_row_order_of_input_does_not_matter():
    hourly = make_hourly(days=15)
    labels = daily_labels(hourly)
    h0, l0 = hourly.copy(), labels.copy()
    a = build_dataset(hourly, labels)
    pd.testing.assert_frame_equal(hourly, h0)
    pd.testing.assert_frame_equal(labels, l0)
    shuffled = hourly.sample(frac=1.0, random_state=5)
    b = build_dataset(shuffled, labels.sample(frac=1.0, random_state=5))
    pd.testing.assert_frame_equal(a, b)
    assert list(a["cell_id"]) == sorted(a["cell_id"])


def test_naive_times_are_rejected():
    hourly = make_hourly(days=5)
    hourly["time_utc"] = hourly["time_utc"].dt.tz_localize(None)
    with pytest.raises(ValueError, match="timezone"):
        build_dataset(hourly, pd.DataFrame({"cell_id": [], "date": [], "y": []}))
    with pytest.raises(ValueError, match="timezone"):
        build_row(hourly, "west-tehran", dt.date(2024, 1, 3))


def test_duplicate_stamps_are_rejected():
    hourly = make_hourly(days=5)
    doubled = pd.concat([hourly, hourly.iloc[[100]]], ignore_index=True)
    with pytest.raises(ValueError, match="duplicate"):
        build_dataset(doubled, daily_labels(hourly))


def test_full_history_scale_builds_fast():
    import time
    hourly = make_hourly(start="2022-08-04", days=1550, cells=[f"c{i}" for i in range(12)])
    labels = daily_labels(hourly)
    t0 = time.perf_counter()
    ds = build_dataset(hourly, labels)
    elapsed = time.perf_counter() - t0
    assert len(ds) > 12 * 1450          # 48 summer-time issue days (to 2022-09-21) give no row
    assert elapsed < 30


# ---------------------------------------------------------------- time split

def synthetic_dataset(first="2023-01-02", last="2025-06-30", cells=CELLS):
    """A dataset-shaped frame (target dates only matter for the split)."""
    dates = pd.date_range(first, last, freq="D")
    frames = [pd.DataFrame({"cell_id": c, "target_date": [d.date() for d in dates],
                            "day": [(d - pd.Timedelta(days=1)).date() for d in dates],
                            "x": np.arange(len(dates), dtype=float), "y": 0}) for c in cells]
    return pd.concat(frames, ignore_index=True)


def test_split_order_is_strict_and_matches_the_calendar_rule():
    df = synthetic_dataset()                         # last target date 2025-06-30
    train, selection, held = split_by_time(df)
    t = lambda frame: pd.to_datetime(frame["target_date"])
    assert t(held).min() == pd.Timestamp("2024-07-01")          # last minus 12 months, exclusive
    assert t(held).max() == pd.Timestamp("2025-06-30")
    assert t(selection).min() == pd.Timestamp("2023-12-31")     # 6 months before that, exclusive start
    assert t(selection).max() == pd.Timestamp("2024-06-30")
    assert t(train).min() == pd.Timestamp("2023-01-02")
    assert t(train).max() == pd.Timestamp("2023-12-30")
    assert t(train).max() < t(selection).min() <= t(selection).max() < t(held).min()
    assert len(train) + len(selection) + len(held) == len(df)


def test_split_is_a_partition_and_every_cell_is_in_every_part():
    df = synthetic_dataset(cells=["a", "b", "c"])
    parts = split_by_time(df)
    assert sum(len(p) for p in parts) == len(df)
    for part in parts:
        assert set(part["cell_id"]) == {"a", "b", "c"}
    stacked = pd.concat(parts)
    assert not stacked.duplicated(["cell_id", "target_date"]).any()


def test_split_boundaries_at_month_ends():
    df = synthetic_dataset(first="2022-08-05", last="2026-11-02")
    train, selection, held = split_by_time(df)
    # last target date 2026-11-02: held-out is strictly after 2025-11-02, selection strictly after 2025-05-02
    assert min(held["target_date"]) == dt.date(2025, 11, 3) and max(held["target_date"]) == dt.date(2026, 11, 2)
    assert min(selection["target_date"]) == dt.date(2025, 5, 3) and max(selection["target_date"]) == dt.date(2025, 11, 2)
    assert max(train["target_date"]) == dt.date(2025, 5, 2)


def test_split_does_not_depend_on_row_order():
    df = synthetic_dataset()
    a = split_by_time(df)
    b = split_by_time(df.sample(frac=1.0, random_state=2))
    for x, y in zip(a, b):
        assert set(zip(x["cell_id"], x["target_date"])) == set(zip(y["cell_id"], y["target_date"]))


def test_split_needs_enough_history():
    short = synthetic_dataset(first="2025-01-01", last="2025-12-31")
    with pytest.raises(ValueError, match="history"):
        split_by_time(short)


def test_real_shaped_dataset_splits_with_every_cell_in_every_part():
    hourly = make_hourly(start="2022-08-04", days=900, cells=[f"c{i}" for i in range(4)])
    ds = build_dataset(hourly, daily_labels(hourly))
    train, selection, held = split_by_time(ds)
    for part in (train, selection, held):
        assert set(part["cell_id"]) == {f"c{i}" for i in range(4)}
    assert max(train["target_date"]) < min(selection["target_date"])
    assert max(selection["target_date"]) < min(held["target_date"])


# ---------------------------------------------------------------- scaling uses training rows only

def split_features():
    hourly = make_hourly(start="2022-08-04", days=900, cells=["c0", "c1"], seed=4)
    return split_by_time(build_dataset(hourly, daily_labels(hourly)))


def test_fit_on_train_gives_zero_mean_unit_std_on_train():
    train, _, _ = split_features()
    mu, sigma = zscore_fit(train[FEATURES])
    z = zscore_apply(train[FEATURES], mu, sigma)
    assert z.shape == (len(train), len(FEATURES))
    np.testing.assert_allclose(z.mean(axis=0), 0.0, atol=1e-9)
    np.testing.assert_allclose(z.std(axis=0), 1.0, atol=1e-9)


def test_selection_and_held_out_rows_do_not_change_mu_and_sigma():
    train, selection, held = split_features()
    mu, sigma = zscore_fit(train[FEATURES])
    np.testing.assert_allclose(mu, train[FEATURES].to_numpy().mean(axis=0))
    np.testing.assert_allclose(sigma, train[FEATURES].to_numpy().std(axis=0))
    mu0, sigma0 = mu.copy(), sigma.copy()
    # applying to the other splits (even wildly different ones) leaves the fit alone
    zscore_apply(selection[FEATURES], mu, sigma)
    zscore_apply(held[FEATURES] * 1000.0, mu, sigma)
    np.testing.assert_array_equal(mu, mu0)
    np.testing.assert_array_equal(sigma, sigma0)
    # and the fit is a function of the training rows alone
    held_changed = held.copy()
    held_changed[FEATURES] = held_changed[FEATURES] * 1000.0
    mu2, sigma2 = zscore_fit(split_by_time(pd.concat([train, selection, held_changed]))[0][FEATURES])
    np.testing.assert_array_equal(mu2, mu0)
    np.testing.assert_array_equal(sigma2, sigma0)
    # fitting on everything would give a different answer, so the property is not vacuous
    mu_all, _ = zscore_fit(pd.concat([train, selection, held])[FEATURES])
    assert not np.allclose(mu_all, mu0)


def test_zscore_guards_zero_sigma_and_does_not_modify_inputs():
    X = np.array([[1.0, 5.0], [2.0, 5.0], [3.0, 5.0]])
    X0 = X.copy()
    mu, sigma = zscore_fit(X)
    assert sigma[1] == 1.0 and sigma[0] == pytest.approx(np.std([1, 2, 3]))
    z = zscore_apply(X, mu, sigma)
    assert np.isfinite(z).all() and (z[:, 1] == 0.0).all()
    np.testing.assert_array_equal(X, X0)
    # a zero sigma passed in directly is also guarded
    assert np.isfinite(zscore_apply(X, mu, np.array([1.0, 0.0]))).all()
    # one-dimensional input is a single column
    mu1, sigma1 = zscore_fit([1.0, 2.0, 3.0])
    assert mu1.shape == (1,) and sigma1.shape == (1,)


def test_module_has_lab_markers_for_the_site():
    source = inspect.getsource(features)
    for name in ("build_row", "split_by_time", "zscore"):
        assert f"# lab:{name}" in source
    assert source.count("# endlab") >= 3


# ---------------------------------------------------------------- daylight saving era

def test_issue_days_on_iran_summer_time_are_dropped_by_both_paths():
    # Iran kept +04:30 summer time until 2022-09-21. On those days the 08:00 UTC stamp is 12:30
    # local, past the 12:00 cutoff, so no row may be issued.
    hourly = make_hourly(start="2022-09-10", days=25)
    ds = build_dataset(hourly, daily_labels(hourly))
    assert len(ds) > 0
    assert min(ds["day"]) == dt.date(2022, 9, 22)
    for d in (dt.date(2022, 9, 12), dt.date(2022, 9, 21)):
        assert build_row(hourly, "west-tehran", d) is None
    assert build_row(hourly, "west-tehran", dt.date(2022, 9, 22)) is not None
    for _, expect in ds.iterrows():
        assert build_row(hourly, expect["cell_id"], expect["day"]) is not None


def test_on_standard_time_marks_only_plus_0330_days():
    days = [dt.date(2022, 8, 5), dt.date(2022, 9, 21), dt.date(2022, 9, 22), dt.date(2024, 6, 1)]
    assert features.on_standard_time(days).tolist() == [False, False, True, True]


# ---------------------------------------------------------------- scaling guards

def test_zscore_treats_a_tiny_sigma_as_one():
    X = np.array([[0.1 + 0.2, 1.0], [0.3, 2.0], [0.3, 3.0]])     # first column differs by float noise only
    mu, sigma = zscore_fit(X)
    assert sigma[0] == 1.0
    assert np.isfinite(zscore_apply(X, mu, sigma)).all()
    assert np.abs(zscore_apply(X, mu, np.array([1e-13, 1.0]))[:, 0]).max() < 1e-12


def test_zscore_rejects_nan_sigma():
    X = np.array([[1.0, 2.0], [np.nan, 3.0], [2.0, 4.0]])
    with pytest.raises(ValueError, match="sigma"):
        zscore_fit(X)
    with pytest.raises(ValueError, match="sigma"):
        zscore_apply(np.ones((2, 2)), np.zeros(2), np.array([1.0, np.nan]))
