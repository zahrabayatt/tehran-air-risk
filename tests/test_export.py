"""Site data exports: every number is computed."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from training import export_data
from training.features import build_dataset, labelled_windows, split_by_time
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


def test_committed_profile_lists_the_same_sources_as_the_exporter():
    """profile.json is written from export_data.SOURCES; the committed copy must not drift from it."""
    import json
    from pathlib import Path
    profile = json.loads((Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "profile.json").read_text(encoding="utf-8"))
    assert profile["sources"] == export_data.SOURCES
    assert "ECMWF" in profile["sources"][1]["attribution"]


def test_profile_counts_weather_drops(built):
    hourly, labels, windows, ds, (train, selection, held) = built
    parts = {"train": train, "selection": selection, "held_out": held}
    base = export_data.build_profile(hourly, labels, windows, ds, parts)
    assert base["rows"]["no_weather_dropped"] == 0
    assert base["weather_first_target"] == "2024-03-15"
    with_wx = export_data.build_profile(hourly, labels, windows, ds.iloc[:-7], parts, no_weather_dropped=7)
    assert with_wx["rows"]["no_weather_dropped"] == 7
    for k in ("dst_dropped", "incomplete_inputs_dropped"):
        assert with_wx["rows"][k] == base["rows"][k]
