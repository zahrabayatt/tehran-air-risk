"""Weather source tests. Fake transport and fake sleep: no network, no real waiting."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline import weather
from pipeline.fetch import FetchError
from pipeline.grid import CELLS
from pipeline.weather import WEATHER_VARS, WX_FEATURES, RunNotAvailable, fetch_run, weather_inputs

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "single_run_2024-03-14.json").read_text())
RUN = dt.date(2024, 3, 14)
TWO_CELLS = [c for c in CELLS if c["id"] in FIXTURE["cells"]]


class Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code, self.payload = status_code, payload
        self.text = str(payload)

    def json(self):
        return self.payload


def run_frame(cells=None):
    cells = cells or TWO_CELLS
    return fetch_run(cells, RUN, get=lambda url, params, timeout: Resp(200, FIXTURE["data"]),
                     sleep=lambda s: None)


def test_weather_inputs_take_hours_21_to_44_of_the_run():
    out = weather_inputs(run_frame(), RUN)
    assert list(out.columns) == ["cell_id", "target_date", "issued_run_utc", *WX_FEATURES]
    assert len(out) == 2
    assert set(out["target_date"]) == {dt.date(2024, 3, 15)}
    for cell_id, block in zip(FIXTURE["cells"], FIXTURE["data"]):
        h = block["hourly"]
        row = out[out["cell_id"] == cell_id].iloc[0]
        window = lambda name: np.array(h[name][21:45], dtype=float)  # noqa: E731
        assert len(window("temperature_2m")) == 24
        assert row["wx_precip"] == pytest.approx(window("precipitation").sum())
        assert row["wx_temp"] == pytest.approx(window("temperature_2m").mean())
        assert row["wx_rh"] == pytest.approx(window("relative_humidity_2m").mean())
        assert row["wx_wind"] == pytest.approx(window("wind_speed_10m").mean())
        assert row["wx_blh"] == pytest.approx(window("boundary_layer_height").mean())


def _with_missing(n):
    frame = run_frame()
    stamps = frame["time_utc"].drop_duplicates().iloc[21:45].iloc[:n]
    frame.loc[frame["time_utc"].isin(stamps), "wind_speed_10m"] = np.nan
    return weather_inputs(frame, RUN)


def test_variable_with_more_than_4_missing_hours_is_nan():
    out = _with_missing(5)
    assert out["wx_wind"].isna().all()
    assert out[["wx_temp", "wx_precip"]].notna().all().all()


def test_variable_with_4_missing_hours_is_kept():
    out = _with_missing(4)
    assert out["wx_wind"].notna().all()


def test_run_without_hours_raises_fetch_error():
    body = {"error": True, "reason": "No data available for this run"}
    calls = []

    def get(url, params, timeout):
        calls.append(params)
        return Resp(400, body)

    with pytest.raises(FetchError):
        fetch_run(TWO_CELLS, RUN, get=get, sleep=lambda s: None)
    assert len(calls) == 1                      # a refused request is not retried
    assert calls[0]["run"] == "2024-03-14T00:00" and calls[0]["models"] == "ecmwf_ifs"
    assert calls[0]["forecast_hours"] == 48 and calls[0]["timezone"] == "GMT"


def test_http_400_is_run_not_available_and_other_failures_are_not():
    """The daily run relies on this split: a run that is not out yet waits, anything else is a failure."""
    def refuse(url, params, timeout):
        return Resp(400, {"error": True, "reason": "requested model run is not available"})

    with pytest.raises(RunNotAvailable) as raised:
        fetch_run(TWO_CELLS, RUN, get=refuse, sleep=lambda s: None)
    assert isinstance(raised.value, FetchError)

    def teapot(url, params, timeout):
        return Resp(418, "no")

    with pytest.raises(FetchError) as other:
        fetch_run(TWO_CELLS, RUN, get=teapot, sleep=lambda s: None)
    assert not isinstance(other.value, RunNotAvailable)


def test_a_repeated_hour_collapses_and_a_conflicting_one_is_an_error():
    block = json.loads(json.dumps(FIXTURE["data"][0]))
    block["hourly"] = {k: v + v[:2] for k, v in block["hourly"].items()}
    frame = fetch_run(TWO_CELLS[:1], RUN, get=lambda url, params, timeout: Resp(200, block), sleep=lambda s: None)
    assert len(frame) == 48 and not frame.duplicated(["cell_id", "time_utc"]).any()
    block["hourly"]["temperature_2m"][-1] += 1.0
    with pytest.raises(FetchError, match="different values"):
        fetch_run(TWO_CELLS[:1], RUN, get=lambda url, params, timeout: Resp(200, block), sleep=lambda s: None)


def test_issued_run_is_00_utc_of_the_issue_day():
    out = weather_inputs(run_frame(), RUN)
    assert set(out["issued_run_utc"]) == {"2024-03-14T00:00Z"}


def test_cli_resumes_from_cache(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "2024-03-14.json").write_text(json.dumps(
        {"run": "2024-03-14", "cells": FIXTURE["cells"], "data": FIXTURE["data"]}))
    twelve = [FIXTURE["data"][i % 2] for i in range(len(CELLS))]
    calls, naps = [], []

    def get(url, params, timeout):
        calls.append(params["run"])
        return Resp(200, twelve)

    out = tmp_path / "weather.csv.gz"
    code = weather.main(["--start", "2024-03-14", "--end", "2024-03-15", "--out", str(out),
                         "--cache", str(cache)], get=get, sleep=naps.append)
    assert code == 0
    assert calls == ["2024-03-15T00:00"]        # the cached day is not requested again
    assert naps == [1.0]
    assert (cache / "2024-03-15.json").exists()
    df = pd.read_csv(out)
    assert sorted(df["issued_run_utc"].unique()) == ["2024-03-14T00:00Z", "2024-03-15T00:00Z"]
    assert len(df) == 2 + len(CELLS)
