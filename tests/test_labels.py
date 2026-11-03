"""Label tests: Tehran-calendar-day means of PM2.5, the 35.4 threshold and the 20-hour rule."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from training.labels import daily_labels


def hours(values, start="2025-01-10 21:00", cell_id="west-tehran"):
    """One cell's consecutive UTC hours starting at `start` (UTC), one value per hour."""
    times = pd.date_range(start, periods=len(values), freq="h", tz="UTC")
    return pd.DataFrame({"cell_id": cell_id, "time_utc": times, "pm2_5": list(values)})


def test_output_shape():
    out = daily_labels(hours([10.0] * 24))
    assert list(out.columns) == ["cell_id", "date", "y", "mean_pm25"]
    assert len(out) == 1
    row = out.iloc[0]
    assert row["cell_id"] == "west-tehran"
    assert row["date"] == dt.date(2025, 1, 11)
    assert isinstance(row["date"], dt.date)
    assert out["y"].dtype == "int64"
    assert row["mean_pm25"] == pytest.approx(10.0)


def test_nineteen_hours_gives_no_label():
    assert daily_labels(hours([50.0] * 19)).empty


def test_twenty_hours_is_enough():
    out = daily_labels(hours([50.0] * 20))
    assert len(out) == 1 and out.iloc[0]["y"] == 1


def test_nan_hours_do_not_count_toward_min_hours():
    values = [50.0] * 19 + [np.nan] * 5          # 24 rows, 19 non-null
    assert daily_labels(hours(values)).empty
    values = [50.0] * 20 + [np.nan] * 4          # 24 rows, 20 non-null
    out = daily_labels(hours(values))
    assert len(out) == 1
    assert out.iloc[0]["mean_pm25"] == pytest.approx(50.0)  # mean over the non-null hours only


def test_mean_exactly_at_threshold_is_negative():
    out = daily_labels(hours([35.4] * 24))
    assert out.iloc[0]["y"] == 0


def test_mean_at_threshold_despite_float_noise_is_negative():
    # These 22 values average to exactly 35.4 (11 pairs placed symmetrically around it),
    # but the float mean comes out as 35.400000000000006, which a bare `>` would call positive.
    values = [34.2, 36.0, 25.4, 36.6, 35.7, 42.6, 45.4, 28.2, 35.1, 27.1, 35.2,
              43.7, 38.5, 35.6, 28.7, 34.8, 34.1, 36.7, 42.1, 29.2, 32.3, 41.6]
    assert sum(round(v * 10) for v in values) == 22 * 354          # exact in integer tenths
    frame = hours(values)
    assert frame.groupby("cell_id")["pm2_5"].mean().iloc[0] > 35.4  # the noise is really there
    out = daily_labels(frame)
    assert out.iloc[0]["y"] == 0


def test_mean_just_above_threshold_is_positive():
    out = daily_labels(hours([35.41] * 24))
    assert out.iloc[0]["y"] == 1
    assert out.iloc[0]["mean_pm25"] == pytest.approx(35.41)


def test_mean_just_below_threshold_is_negative():
    assert daily_labels(hours([35.39] * 24)).iloc[0]["y"] == 0


def test_custom_threshold_and_min_hours():
    out = daily_labels(hours([20.0] * 12), threshold=15.0, min_hours=10)
    assert len(out) == 1 and out.iloc[0]["y"] == 1


@pytest.mark.parametrize("winter_or_summer", ["2025-01-09 21:00", "2025-07-09 21:00"])
def test_days_are_asia_tehran_days(winter_or_summer):
    # 48 hours from 21:00 UTC. 21:00 UTC is 00:30 Tehran (UTC+03:30, no daylight saving),
    # so the first 24 hours are one Tehran day and the next 24 the following one.
    values = [10.0] * 24 + [50.0] * 24
    out = daily_labels(hours(values, start=winter_or_summer)).reset_index(drop=True)
    first = pd.Timestamp(winter_or_summer).date() + dt.timedelta(days=1)
    assert list(out["date"]) == [first, first + dt.timedelta(days=1)]
    assert list(out["y"]) == [0, 1]
    assert list(out["mean_pm25"]) == pytest.approx([10.0, 50.0])


def test_2000_utc_belongs_to_same_tehran_day_and_2100_utc_to_the_next():
    d = pd.Timestamp("2025-03-10", tz="UTC")
    # Full Tehran day D = 21:00 UTC (D-1) .. 20:00 UTC (D), all 10; plus one hour at 21:00 UTC on D.
    day = pd.date_range(d - pd.Timedelta(hours=3), periods=24, freq="h")
    assert day[-1] == d + pd.Timedelta(hours=20)
    frame = pd.DataFrame({"cell_id": "a", "time_utc": day, "pm2_5": 10.0})
    out = daily_labels(frame)
    assert list(out["date"]) == [dt.date(2025, 3, 10)]          # 20:00 UTC is still day D (23:30 Tehran)
    # The 21:00 UTC hour opens day D+1: alone it is 1 hour, so it is dropped, and it must not
    # change the mean of day D.
    extra = pd.DataFrame({"cell_id": "a", "time_utc": [d + pd.Timedelta(hours=21)], "pm2_5": [1000.0]})
    both = daily_labels(pd.concat([frame, extra], ignore_index=True))
    assert list(both["date"]) == [dt.date(2025, 3, 10)]
    assert both.iloc[0]["mean_pm25"] == pytest.approx(10.0)
    # With 20 hours of D+1 present it becomes its own labelled day.
    nxt = pd.DataFrame({"cell_id": "a", "time_utc": pd.date_range(d + pd.Timedelta(hours=21), periods=20, freq="h"),
                        "pm2_5": 1000.0})
    out2 = daily_labels(pd.concat([frame, nxt], ignore_index=True))
    assert list(out2["date"]) == [dt.date(2025, 3, 10), dt.date(2025, 3, 11)]
    assert list(out2["y"]) == [0, 1]


def test_utc_date_is_not_the_label_date():
    # 21:00 UTC on Jan 10 .. 20:00 UTC on Jan 11 is Tehran Jan 11; a UTC grouping would split it in two.
    out = daily_labels(hours([40.0] * 24, start="2025-01-10 21:00"))
    assert list(out["date"]) == [dt.date(2025, 1, 11)]


def test_cells_are_labelled_independently():
    a = hours([10.0] * 24, cell_id="a")
    b = hours([60.0] * 24, cell_id="b")
    c = hours([60.0] * 5, cell_id="c")            # too few hours
    out = daily_labels(pd.concat([b, c, a], ignore_index=True))
    assert list(out["cell_id"]) == ["a", "b"]
    assert list(out["y"]) == [0, 1]


def test_other_columns_are_ignored_and_input_is_not_modified():
    frame = hours([10.0] * 24)
    frame["ozone"] = 1.0
    before = frame.copy()
    daily_labels(frame)
    pd.testing.assert_frame_equal(frame, before)


def test_naive_times_are_rejected():
    frame = hours([10.0] * 24)
    frame["time_utc"] = frame["time_utc"].dt.tz_localize(None)
    with pytest.raises(ValueError, match="timezone"):
        daily_labels(frame)


def test_empty_input_gives_empty_labels_with_columns():
    out = daily_labels(hours([]))
    assert out.empty
    assert list(out.columns) == ["cell_id", "date", "y", "mean_pm25"]
