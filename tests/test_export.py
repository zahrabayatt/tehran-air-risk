"""Site data exports: the Lab sample holds training rows only, and every number is computed."""
from __future__ import annotations

import datetime as dt
import json

import numpy as np
import pandas as pd
import pytest

from training import export_data
from training.features import FEATURES, build_dataset, labelled_windows, split_by_time
from training.labels import daily_labels
from tests.test_leakage import make_hourly


@pytest.fixture(scope="module")
def built():
    hourly = make_hourly(start="2022-08-04", days=1100, cells=["west-tehran", "far-east"], seed=7)
    # a hole, so missing hours and incomplete windows are non-zero
    hole = (hourly["cell_id"] == "far-east") & (hourly["time_utc"] == pd.Timestamp("2023-03-01 03:00", tz="UTC"))
    hourly.loc[hole, "pm2_5"] = np.nan
    hourly = hourly.drop(hourly.index[(hourly["cell_id"] == "far-east")
                                      & (hourly["time_utc"] == pd.Timestamp("2023-04-01 05:00", tz="UTC"))])
    labels = daily_labels(hourly)
    windows = labelled_windows(hourly, labels)
    ds = build_dataset(hourly, labels)
    parts = split_by_time(ds)
    return hourly, labels, windows, ds, parts


def test_sample_is_consecutive_training_days_of_one_cell(built):
    _, labels, _, _, (train, selection, held) = built
    out = export_data.build_sample(train, labels, days=365)
    rows = out["rows"]
    assert len(rows) == 365
    days = [dt.date.fromisoformat(r["day"]) for r in rows]
    assert all((b - a).days == 1 for a, b in zip(days, days[1:]))
    train_targets = set(map(str, train.loc[train["cell_id"] == "west-tehran", "target_date"]))
    assert {r["target_date"] for r in rows} <= train_targets
    later = set(map(str, selection["target_date"])) | set(map(str, held["target_date"]))
    assert not {r["target_date"] for r in rows} & later
    assert out["cell"] == "west-tehran"
    assert max(r["target_date"] for r in rows) == str(max(train["target_date"]))   # the latest run


def test_sample_rows_carry_raw_features_and_the_label_day_mean(built):
    _, labels, _, _, (train, _, _) = built
    out = export_data.build_sample(train, labels, days=30)
    lab = labels.set_index(["cell_id", "date"])
    tr = train.set_index(["cell_id", "day"])
    for r in out["rows"]:
        d, t = dt.date.fromisoformat(r["day"]), dt.date.fromisoformat(r["target_date"])
        src = tr.loc[("west-tehran", d)]
        assert r["pm_today"] == pytest.approx(src["pm2_5_mean"], abs=1e-3)
        assert r["pm_tomorrow"] == pytest.approx(lab.loc[("west-tehran", t), "mean_pm25"], abs=1e-3)
        assert r["y"] == int(src["y"]) == int(r["pm_tomorrow"] > 35.4)
        for f in FEATURES:
            assert r[f] == pytest.approx(src[f], abs=1e-4)


def test_sample_month_rates_use_training_rows(built):
    _, labels, _, _, (train, _, _) = built
    out = export_data.build_sample(train, labels, days=30)
    months = pd.to_datetime(train["target_date"]).dt.month
    cell = train["cell_id"] == "west-tehran"
    for item in out["train_months"]:
        m = item["month"]
        assert item["pooled_rate"] == pytest.approx(train.loc[months == m, "y"].mean(), abs=1e-4)
        assert item["cell_rate"] == pytest.approx(train.loc[cell & (months == m), "y"].mean(), abs=1e-4)


def test_history_rates_and_daily_counts(built):
    _, labels, _, _, _ = built
    out = export_data.build_history(labels)
    years = pd.to_datetime(labels["date"]).dt.year
    pooled = {r["year"]: r for r in out["by_year"]["pooled"]}
    for year, rows in labels.groupby(years):
        assert pooled[year]["rate"] == pytest.approx(rows["y"].mean(), abs=1e-4)
        assert pooled[year]["days"] == len(rows)
        assert pooled[year]["positives"] == int(rows["y"].sum())
    months = pd.to_datetime(labels["date"]).dt.month
    for r in out["by_month"]["pooled"]:
        assert r["positives"] == int(labels.loc[months == r["month"], "y"].sum())
    daily = out["daily"]
    assert sum(daily["positive_cells"]) == int(labels["y"].sum())
    assert len(daily["positive_cells"]) == (max(labels["date"]) - min(labels["date"])).days + 1


def test_profile_counts(built):
    hourly, labels, windows, ds, (train, selection, held) = built
    out = export_data.build_profile(hourly, labels, windows, ds,
                                    {"train": train, "selection": selection, "held_out": held})
    assert out["usable_cell_days"] == len(labels)
    assert out["rows"]["dataset"] == len(ds)
    assert out["rows"]["dst_dropped"] == len(windows) - len(ds) > 0
    assert out["rows"]["incomplete_inputs_dropped"] > 0
    assert out["splits"]["train"]["rows"] == len(train)
    for name, part in (("train", train), ("selection", selection), ("held_out", held)):
        assert out["splits"][name]["positives"] == int(part["y"].sum())
    assert sum(y["positives"] for y in out["yearly"]) == int(labels["y"].sum())
    for c in out["cells"]:
        assert c["positives"] == int(labels.loc[labels["cell_id"] == c["id"], "y"].sum())
    assert out["missing_hours"]["count"] >= 2           # one null, one absent row
    assert 0 < out["missing_hours"]["share"] < 1
    assert {c["id"] for c in out["cells"]} == {"west-tehran", "far-east"}
    assert "CC-BY 4.0" in json.dumps(out["sources"])


def test_write_json_refuses_non_finite(tmp_path):
    with pytest.raises(ValueError):
        export_data.write_json(tmp_path / "x.json", {"a": float("nan")})
    size = export_data.write_json(tmp_path / "y.json", {"a": [1, 2.5]})
    assert size == (tmp_path / "y.json").stat().st_size
