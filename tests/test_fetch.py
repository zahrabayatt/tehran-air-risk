"""Fetch tests. Every test uses a fake transport and a fake sleep: no network, no real waiting."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest
import requests

from pipeline import fetch
from pipeline.fetch import AIR_QUALITY_URL, FORECAST_URL, POLLUTANTS, WEATHER, FetchError, fetch_hourly
from pipeline.grid import CELLS

CELL_IDS = [c["id"] for c in CELLS]


class Resp:
    def __init__(self, status_code=200, payload=None, bad_json=False):
        self.status_code, self.payload, self.bad_json = status_code, payload, bad_json
        self.text = str(payload)

    def json(self):
        if self.bad_json:
            raise ValueError("not json")
        return self.payload


def hour_stamps(start, end):
    stamps = pd.date_range(f"{start} 00:00", f"{end} 23:00", freq="h")
    return [t.strftime("%Y-%m-%dT%H:%M") for t in stamps]


class FakeApi:
    """Plays Open-Meteo: one block per requested location, value = 1000 * location index + hour index."""

    def __init__(self, nulls=None):
        self.calls = []
        self.nulls = nulls or {}  # (variable, location index, hour index) -> None

    def __call__(self, url, params, timeout=None):
        self.calls.append((url, dict(params)))
        names = (POLLUTANTS if url == AIR_QUALITY_URL else WEATHER)
        assert params["hourly"].split(",") == list(names)
        times = hour_stamps(params["start_date"], params["end_date"])
        lats = params["latitude"].split(",")
        blocks = []
        for i, _ in enumerate(lats):
            hourly = {"time": times}
            for v, name in enumerate(names):
                hourly[name] = [None if (name, i, h) in self.nulls else 1000.0 * i + h + v / 10
                                for h in range(len(times))]
            blocks.append({"latitude": float(lats[i]), "utc_offset_seconds": 0, "hourly": hourly})
        return Resp(200, blocks if len(blocks) > 1 else blocks[0])


class Sleeper:
    def __init__(self):
        self.calls = []

    def __call__(self, seconds):
        self.calls.append(seconds)


def run(api, start="2025-01-01", end="2025-01-02", cells=CELLS, **kw):
    sleeper = kw.pop("sleep", None) or Sleeper()
    return fetch_hourly(cells, start, end, get=api, sleep=sleeper, **kw), sleeper


# ------------------------------------------------------------------ happy path
def test_frame_shape_columns_and_utc():
    api = FakeApi()
    df, _ = run(api)
    assert list(df.columns) == ["cell_id", "time_utc", *POLLUTANTS, *WEATHER]
    assert list(POLLUTANTS) == ["pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide", "ozone"]
    assert list(WEATHER) == ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]
    assert len(df) == 12 * 48
    assert str(df["time_utc"].dt.tz) == "UTC"
    assert df["time_utc"].min() == pd.Timestamp("2025-01-01 00:00", tz="UTC")
    assert df["time_utc"].max() == pd.Timestamp("2025-01-02 23:00", tz="UTC")
    assert not df.duplicated(["cell_id", "time_utc"]).any()
    assert set(df["cell_id"]) == set(CELL_IDS)
    assert df[[*POLLUTANTS, *WEATHER]].dtypes.eq("float64").all()


def test_requests_use_cell_centres_utc_and_the_right_models():
    api = FakeApi()
    run(api)
    aq = [p for u, p in api.calls if u == AIR_QUALITY_URL]
    wx = [p for u, p in api.calls if u == FORECAST_URL]
    assert len(aq) == len(wx) == 1
    for p in aq + wx:
        assert p["latitude"] == ",".join(str(c["lat"]) for c in CELLS)
        assert p["longitude"] == ",".join(str(c["lon"]) for c in CELLS)
        assert p["timezone"] == "GMT"
        assert (p["start_date"], p["end_date"]) == ("2025-01-01", "2025-01-02")
    assert aq[0]["domains"] == "cams_global"
    assert wx[0]["models"] == "ecmwf_ifs"
    assert "models" not in aq[0] and "domains" not in wx[0]
    assert FORECAST_URL == "https://historical-forecast-api.open-meteo.com/v1/forecast"
    assert AIR_QUALITY_URL == "https://air-quality-api.open-meteo.com/v1/air-quality"


def test_rows_are_merged_per_cell_and_hour():
    api = FakeApi()
    df, _ = run(api)
    row = df[(df["cell_id"] == CELLS[3]["id"]) & (df["time_utc"] == pd.Timestamp("2025-01-01 05:00", tz="UTC"))]
    assert len(row) == 1
    row = row.iloc[0]
    # location index 3, hour index 5; pollutants and weather come from separate calls
    assert row["pm2_5"] == pytest.approx(3005.0)
    assert row["pm10"] == pytest.approx(3005.1)
    assert row["temperature_2m"] == pytest.approx(3005.0)
    assert row["precipitation"] == pytest.approx(3005.3)


def test_long_ranges_are_split_into_windows():
    api = FakeApi()
    df, sleeper = run(api, start="2025-01-01", end="2025-01-25", window_days=10)
    windows = [(p["start_date"], p["end_date"]) for u, p in api.calls if u == AIR_QUALITY_URL]
    assert windows == [("2025-01-01", "2025-01-10"), ("2025-01-11", "2025-01-20"), ("2025-01-21", "2025-01-25")]
    assert [(p["start_date"], p["end_date"]) for u, p in api.calls if u == FORECAST_URL] == windows
    assert len(df) == 12 * 25 * 24
    assert not df.duplicated(["cell_id", "time_utc"]).any()
    assert df.groupby("cell_id")["time_utc"].apply(lambda s: s.is_monotonic_increasing).all()


def test_accepts_dates_and_timestamps():
    api = FakeApi()
    df, _ = run(api, start=dt.date(2025, 1, 1), end=pd.Timestamp("2025-01-01"))
    assert len(df) == 12 * 24


def test_single_cell_response_is_a_dict_not_a_list():
    api = FakeApi()
    df, _ = run(api, cells=CELLS[:1])
    assert len(df) == 48 and set(df["cell_id"]) == {CELLS[0]["id"]}


def test_pause_between_requests_uses_injected_sleep():
    api = FakeApi()
    _, sleeper = run(api, start="2025-01-01", end="2025-01-20", window_days=10, pause_s=7.0)
    assert sleeper.calls and set(sleeper.calls) == {7.0}


def test_start_after_end_is_an_error():
    with pytest.raises(ValueError):
        run(FakeApi(), start="2025-01-03", end="2025-01-02")


# ------------------------------------------------------------------ nulls
def test_nulls_pass_through_as_nan_without_raising():
    api = FakeApi(nulls={("pm2_5", 2, 0): None, ("pm2_5", 2, 1): None, ("ozone", 0, 7): None,
                         ("temperature_2m", 11, 47): None})
    df, sleeper = run(api)
    assert sleeper.calls == []
    assert len(df) == 12 * 48
    assert df["pm2_5"].isna().sum() == 2
    assert df["ozone"].isna().sum() == 1
    assert df["temperature_2m"].isna().sum() == 1
    bad = df[df["pm2_5"].isna()]
    assert set(bad["cell_id"]) == {CELLS[2]["id"]}
    assert df["pm2_5"].notna().sum() == 12 * 48 - 2    # nothing was filled or interpolated
    assert not df["pm10"].isna().any()


def test_all_null_response_is_all_nan_rows():
    nulls = {(v, i, h): None for v in POLLUTANTS + WEATHER for i in range(12) for h in range(24)}
    df, _ = run(FakeApi(nulls=nulls), start="2025-01-01", end="2025-01-01")
    assert len(df) == 12 * 24
    assert df[[*POLLUTANTS, *WEATHER]].isna().all().all()


# ------------------------------------------------------------------ failures and retries
class Failing:
    """Fails `n` times with `failure`, then behaves like FakeApi."""

    def __init__(self, failure, n=None):
        self.failure, self.n, self.calls, self.ok = failure, n, 0, FakeApi()

    def __call__(self, url, params, timeout=None):
        self.calls += 1
        if self.n is None or self.calls <= self.n:
            if isinstance(self.failure, Exception):
                raise self.failure
            return self.failure
        return self.ok(url, params, timeout)


def test_network_failure_retries_with_sleep_then_raises_fetch_error():
    get = Failing(requests.ConnectionError("down"))
    sleeper = Sleeper()
    with pytest.raises(FetchError, match="down"):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=get, sleep=sleeper, attempts=4)
    assert get.calls == 4
    assert len(sleeper.calls) == 3 and all(s > 0 for s in sleeper.calls)
    assert sleeper.calls == sorted(sleeper.calls) and len(set(sleeper.calls)) == 3   # backoff grows


def test_timeout_is_a_network_failure():
    get = Failing(requests.Timeout("slow"))
    with pytest.raises(FetchError):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=get, sleep=Sleeper(), attempts=2)
    assert get.calls == 2


@pytest.mark.parametrize("status", [500, 502, 503])
def test_server_errors_retry_then_raise(status):
    get = Failing(Resp(status, {"reason": "boom"}))
    sleeper = Sleeper()
    with pytest.raises(FetchError, match=str(status)):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=get, sleep=sleeper, attempts=3)
    assert get.calls == 3 and len(sleeper.calls) == 2


def test_rate_limit_waits_for_the_minute_window_then_raises():
    get = Failing(Resp(429, {"reason": "Minutely API request limit exceeded"}))
    sleeper = Sleeper()
    with pytest.raises(FetchError, match="429"):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=get, sleep=sleeper, attempts=3)
    assert get.calls == 3
    assert len(sleeper.calls) == 2 and min(sleeper.calls) >= 60


@pytest.mark.parametrize("bad", [
    Resp(200, bad_json=True),
    Resp(200, {"error": True, "reason": "Cannot initialize"}),
    Resp(200, {"latitude": 1.0}),                                       # no hourly block
    Resp(200, {"hourly": {"time": ["2025-01-01T00:00"]}}),              # variables missing
    Resp(200, [{"hourly": {"time": []}}]),                              # wrong number of locations
    Resp(200, "just a string"),
])
def test_malformed_body_retries_then_raises(bad):
    get = Failing(bad)
    sleeper = Sleeper()
    with pytest.raises(FetchError):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=get, sleep=sleeper, attempts=3)
    assert get.calls == 3 and len(sleeper.calls) == 2


def test_variable_length_mismatch_is_malformed():
    class Short(FakeApi):
        def __call__(self, url, params, timeout=None):
            r = super().__call__(url, params, timeout)
            blocks = r.payload if isinstance(r.payload, list) else [r.payload]
            blocks[0]["hourly"][POLLUTANTS[0] if url == AIR_QUALITY_URL else WEATHER[0]].pop()
            return r

    with pytest.raises(FetchError):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=Short(), sleep=Sleeper(), attempts=2)


def test_non_utc_response_is_malformed():
    class Shifted(FakeApi):
        def __call__(self, url, params, timeout=None):
            r = super().__call__(url, params, timeout)
            for b in (r.payload if isinstance(r.payload, list) else [r.payload]):
                b["utc_offset_seconds"] = 12600
            return r

    with pytest.raises(FetchError, match="UTC"):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=Shifted(), sleep=Sleeper(), attempts=2)


def test_client_error_is_not_retried():
    get = Failing(Resp(400, {"error": True, "reason": "bad parameter"}))
    sleeper = Sleeper()
    with pytest.raises(FetchError, match="400"):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-02", get=get, sleep=sleeper)
    assert get.calls == 1 and sleeper.calls == []


def test_recovers_after_transient_failures():
    get = Failing(Resp(503, {}), n=2)
    sleeper = Sleeper()
    df = fetch_hourly(CELLS, "2025-01-01", "2025-01-01", get=get, sleep=sleeper, attempts=5)
    assert len(df) == 12 * 24
    assert len(sleeper.calls) == 2


def test_failure_in_a_later_window_raises_not_returns_partial_history():
    api = FakeApi()
    state = {"n": 0}

    def get(url, params, timeout=None):
        state["n"] += 1
        if params["start_date"] == "2025-01-11":
            return Resp(500, {})
        return api(url, params, timeout)

    with pytest.raises(FetchError):
        fetch_hourly(CELLS, "2025-01-01", "2025-01-20", get=get, sleep=Sleeper(), window_days=10, attempts=2)


def test_default_transport_is_requests_get_and_sleep_is_time_sleep(monkeypatch):
    seen = {}

    def fake_get(url, params=None, timeout=None):
        seen.setdefault("urls", []).append(url)
        return FakeApi()(url, params, timeout)

    monkeypatch.setattr(fetch.requests, "get", fake_get)
    monkeypatch.setattr(fetch.time, "sleep", lambda s: pytest.fail("should not sleep on success"))
    df = fetch_hourly(CELLS[:2], "2025-01-01", "2025-01-01")
    assert len(df) == 48 and set(seen["urls"]) == {AIR_QUALITY_URL, FORECAST_URL}


# ------------------------------------------------------------------ files
def test_hourly_csv_round_trip(tmp_path):
    api = FakeApi(nulls={("pm2_5", 0, 3): None})
    df, _ = run(api, cells=CELLS[:2])
    path = tmp_path / "sub" / "hourly.csv.gz"
    fetch.write_hourly(df, path)
    back = fetch.read_hourly(path)
    pd.testing.assert_frame_equal(df, back)
    assert np.isnan(back["pm2_5"].iloc[3])
