"""Daily pipeline tests. Every test injects a fake transport and a fake sleep: no network, no waiting.

The fake plays Open-Meteo for the three endpoints the pipeline may call (air quality, the
historical forecast API used in training, and the live forecast API that is the fallback for
weather). Values are simple functions of the UTC hour so expected probabilities can be worked
out independently from model/model.json.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from pipeline import fill_outcomes, predict, store
from pipeline.fetch import AIR_QUALITY_URL, FORECAST_URL, POLLUTANTS, WEATHER, FetchError, fetch_hourly
from pipeline.grid import CELLS

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "model" / "model.json"
LIVE_URL = predict.LIVE_FORECAST_URL
CELL_IDS = [c["id"] for c in CELLS]
BY_COORD = {(str(c["lat"]), str(c["lon"])): c["id"] for c in CELLS}
UTC = "UTC"

# 10:05 UTC on 2026-11-03 is 13:35 in Tehran: issue date 2026-11-03, target 2026-11-04.
NOW = pd.Timestamp("2026-11-03T10:05:00Z")
ISSUE, TARGET = "2026-11-03", "2026-11-04"


class Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code, self.payload, self.text = status_code, payload, str(payload)[:100]

    def json(self):
        return self.payload


def default_pm25(cell_id, ts):
    return 30.0 + ts.hour


class FakeApi:
    """One block per requested location; every hour of start_date..end_date (UTC) unless dropped.

    `pm25(cell_id, ts)` gives PM2.5; `fail(kind, cell_ids)` returns True to answer HTTP 500;
    `drop(kind, cell_id, ts)` removes a stamp from that cell's block; `null(kind, cell_id, name, ts)`
    makes a value null. kind is "air", "hf" or "live".
    """

    def __init__(self, pm25=default_pm25, fail=None, drop=None, null=None, duplicate_stamps=False,
                 duplicate_shift=0.0):
        self.pm25, self.fail, self.drop, self.null = pm25, fail, drop, null
        self.duplicate_stamps, self.duplicate_shift = duplicate_stamps, duplicate_shift
        self.calls = []

    @staticmethod
    def kind(url):
        return {AIR_QUALITY_URL: "air", FORECAST_URL: "hf", LIVE_URL: "live"}[url]

    def value(self, name, cell_id, ts):
        if name == "pm2_5":
            return self.pm25(cell_id, ts)
        base = {"pm10": 60, "nitrogen_dioxide": 20, "sulphur_dioxide": 5, "carbon_monoxide": 300,
                "ozone": 50, "temperature_2m": 12, "relative_humidity_2m": 55, "wind_speed_10m": 8,
                "precipitation": 0.0}[name]
        return base + 0.1 * ts.hour

    def __call__(self, url, params, timeout=None):
        self.calls.append((url, dict(params)))
        kind = self.kind(url)
        ids = [BY_COORD[(la, lo)] for la, lo in zip(params["latitude"].split(","), params["longitude"].split(","))]
        if self.fail and self.fail(kind, ids):
            return Resp(500, "boom")
        names = POLLUTANTS if kind == "air" else WEATHER
        assert params["hourly"].split(",") == list(names)
        stamps = pd.date_range(f"{params['start_date']} 00:00", f"{params['end_date']} 23:00", freq="h", tz=UTC)
        blocks = []
        for cell_id in ids:
            keep = [t for t in stamps if not (self.drop and self.drop(kind, cell_id, t))]
            n_original = len(keep)
            if self.duplicate_stamps:
                keep = keep + keep[:30]
            hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in keep]}
            for name in names:
                hourly[name] = [None if (self.null and self.null(kind, cell_id, name, t))
                                else float(self.value(name, cell_id, t)) + (self.duplicate_shift if i >= n_original else 0.0)
                                for i, t in enumerate(keep)]
            blocks.append({"utc_offset_seconds": 0, "hourly": hourly})
        return Resp(200, blocks if len(blocks) > 1 else blocks[0])

    def urls(self, kind):
        return [p for u, p in self.calls if self.kind(u) == kind]


class Sleeper:
    def __init__(self):
        self.calls = []

    def __call__(self, seconds):
        self.calls.append(seconds)


def go(tmp_path, api, now=NOW, name="predictions.json"):
    path = tmp_path / name
    new = predict.run(now=now, get=api, sleep=Sleeper(), predictions_path=path, model_path=MODEL_PATH)
    return new, path


def saved(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))["entries"]


def expected_probability(pm_values, target_date):
    """Independent re-derivation from model/model.json: features -> z-scores -> sigmoid."""
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    doy = pd.Timestamp(target_date).dayofyear
    angle = 2 * np.pi * doy / 365.25
    feats = {"pm2_5_mean": np.mean(pm_values), "pm2_5_max": np.max(pm_values), "pm2_5_last": pm_values[-1],
             "season_sin": np.sin(angle), "season_cos": np.cos(angle)}
    x = np.array([feats[f] for f in model["features"]])
    z = (x - np.array(model["scaling"]["mu"])) / np.array(model["scaling"]["sigma"])
    return float(1 / (1 + np.exp(-(z @ np.array(model["weights"]) + model["bias"]))))


WINDOW_PM = [30.0 + h for h in (21, 22, 23, *range(0, 9))]   # default_pm25 over the 12 stamps


def by_cell(entries):
    return {e["cell_id"]: e for e in entries}


# ------------------------------------------------------------------ Tehran dates (ruling 2)
@pytest.mark.parametrize("utc, issue", [
    ("2026-11-03T08:00:00Z", "2026-11-02"),   # 11:30 Tehran: before noon
    ("2026-11-03T08:29:59Z", "2026-11-02"),   # 11:59:59
    ("2026-11-03T08:30:00Z", "2026-11-03"),   # 12:00 Tehran exactly
    ("2026-11-03T09:00:00Z", "2026-11-03"),   # 12:30
    ("2026-11-03T10:00:00Z", "2026-11-03"),   # the workflow's usual time, 13:30
    ("2026-11-03T20:29:00Z", "2026-11-03"),   # 23:59 Tehran, same Tehran day
    ("2026-11-03T23:50:00Z", "2026-11-03"),   # 03:20 on the 4th in Tehran: still the 3rd's forecast
    ("2026-11-04T00:10:00Z", "2026-11-03"),   # 03:40 on the 4th
])
def test_issue_date_follows_tehran_clock_not_utc_date(utc, issue):
    assert store.issue_date(pd.Timestamp(utc)).isoformat() == issue


def test_issue_date_accepts_any_timezone_and_rejects_naive():
    assert store.issue_date(pd.Timestamp("2026-11-03T12:30:00+03:30")).isoformat() == "2026-11-03"
    assert store.issue_date(pd.Timestamp("2026-11-03T11:30:00+03:30")).isoformat() == "2026-11-02"
    with pytest.raises(ValueError):
        store.issue_date(pd.Timestamp("2026-11-03T10:00:00"))


@pytest.mark.parametrize("utc, issue, target", [
    ("2026-11-03T23:50:00Z", "2026-11-03", "2026-11-04"),
    ("2026-11-04T00:10:00Z", "2026-11-03", "2026-11-04"),
    ("2026-11-03T08:00:00Z", "2026-11-02", "2026-11-03"),
    ("2026-11-03T09:00:00Z", "2026-11-03", "2026-11-04"),
])
def test_run_near_midnight_utc_targets_the_tehran_date(tmp_path, utc, issue, target):
    api = FakeApi()
    new, path = go(tmp_path, api, now=pd.Timestamp(utc))
    assert {e["target_date"] for e in new} == {target}
    # the live fetch covers UTC days D-1 .. D+1 (D+1 holds the CAMS forecast for the target day)
    d = pd.Timestamp(issue)
    for params in api.urls("air") + api.urls("hf"):
        assert (params["start_date"], params["end_date"]) == ((d - pd.Timedelta(days=1)).date().isoformat(),
                                                              (d + pd.Timedelta(days=1)).date().isoformat())
    assert all(e["issued_at"] == pd.Timestamp(utc).strftime("%Y-%m-%dT%H:%M:%SZ") for e in new)


# ------------------------------------------------------------------ happy path
def test_all_cells_get_a_forecast_with_the_documented_fields(tmp_path):
    api = FakeApi()
    new, path = go(tmp_path, api)
    assert len(new) == 12 and sorted(e["cell_id"] for e in new) == sorted(CELL_IDS)
    want = expected_probability(WINDOW_PM, TARGET)
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    for e in new:
        assert list(e) == ["issued_at", "target_date", "cell_id", "probability", "predicted", "model_version",
                           "outcome", "outcome_mean_pm25", "gap", "gap_reason", "cams_forecast_pm25"]
        assert e["issued_at"] == "2026-11-03T10:05:00Z"
        assert e["target_date"] == TARGET
        assert e["probability"] == pytest.approx(want, abs=5e-5)     # stored with 4 decimals
        assert e["predicted"] == int(e["probability"] >= 0.5)
        assert e["model_version"] == model["version"]
        assert e["outcome"] is None and e["outcome_mean_pm25"] is None
        assert e["gap"] is False and e["gap_reason"] is None
        assert e["cams_forecast_pm25"] == pytest.approx(41.5)        # mean of the 24 Tehran target-day hours
    assert saved(path) == new
    assert [(e["target_date"], e["cell_id"]) for e in new] == sorted((e["target_date"], e["cell_id"]) for e in new)
    # one air-quality request and one historical-forecast request cover all 12 cells; no live fallback
    assert len(api.urls("air")) == len(api.urls("hf")) == 1 and api.urls("live") == []


def test_requests_use_the_training_sources(tmp_path):
    api = FakeApi()
    go(tmp_path, api)
    (air,), (hf,) = api.urls("air"), api.urls("hf")
    assert air["domains"] == "cams_global" and hf["models"] == "ecmwf_ifs"
    assert air["timezone"] == hf["timezone"] == "GMT"
    assert air["latitude"] == ",".join(str(c["lat"]) for c in CELLS)


def test_high_pm_gives_predicted_one(tmp_path):
    api = FakeApi(pm25=lambda c, t: 90.0)
    new, _ = go(tmp_path, api)
    assert all(e["predicted"] == 1 and e["probability"] > 0.5 for e in new)
    assert all(e["probability"] == pytest.approx(expected_probability([90.0] * 12, TARGET), abs=5e-5) for e in new)


# ------------------------------------------------------------------ model use (ruling 6)
def test_model_file_is_never_modified(tmp_path):
    before = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    mtime = MODEL_PATH.stat().st_mtime_ns
    go(tmp_path, FakeApi())
    go(tmp_path, FakeApi(fail=lambda k, ids: True))
    assert hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() == before
    assert MODEL_PATH.stat().st_mtime_ns == mtime


def test_cams_forecast_for_the_target_day_is_not_an_input(tmp_path):
    base, _ = go(tmp_path, FakeApi(), name="a.json")
    # everything from 09:00 UTC on the issue date onward (after the cutoff) is changed wildly
    late = pd.Timestamp("2026-11-03T09:00:00Z")
    changed, _ = go(tmp_path, FakeApi(pm25=lambda c, t: 999.0 if t >= late else 30.0 + t.hour), name="b.json")
    assert [e["probability"] for e in changed] == [e["probability"] for e in base]
    assert [e["predicted"] for e in changed] == [e["predicted"] for e in base]
    assert all(e["cams_forecast_pm25"] != b["cams_forecast_pm25"] for e, b in zip(changed, base))
    # target-day hours only (21:00 UTC on the issue date onward)
    target_hours = pd.Timestamp("2026-11-03T21:00:00Z")
    changed2, _ = go(tmp_path, FakeApi(pm25=lambda c, t: 5.0 if t >= target_hours else 30.0 + t.hour), name="c.json")
    assert [e["probability"] for e in changed2] == [e["probability"] for e in base]
    assert all(e["cams_forecast_pm25"] == pytest.approx(5.0) for e in changed2)


def test_probability_uses_the_model_features_from_build_row(tmp_path):
    # a hotter morning in one cell only changes that cell
    api = FakeApi(pm25=lambda c, t: 80.0 if (c == "west-tehran" and t.day == 3 and t.hour <= 8) else 30.0 + t.hour)
    new, _ = go(tmp_path, api)
    cells = by_cell(new)
    assert cells["west-tehran"]["probability"] > cells["east-tehran"]["probability"]
    assert cells["east-tehran"]["probability"] == pytest.approx(expected_probability(WINDOW_PM, TARGET), abs=5e-5)


# ------------------------------------------------------------------ gaps (ruling 4)
def assert_gap(e, reason_contains=None):
    assert e["gap"] is True and e["probability"] is None and e["predicted"] is None
    assert e["outcome"] is None
    assert isinstance(e["gap_reason"], str) and e["gap_reason"]
    if reason_contains:
        assert reason_contains in e["gap_reason"]


def test_api_failure_writes_gaps_with_no_probability(tmp_path):
    api = FakeApi(fail=lambda kind, ids: True)
    new, path = go(tmp_path, api)
    assert len(new) == 12 and sorted(e["cell_id"] for e in new) == sorted(CELL_IDS)
    for e in new:
        assert_gap(e)
        assert e["model_version"] is not None and e["target_date"] == TARGET
    assert saved(path) == new
    assert len(api.calls) < 80    # retries are bounded; a dead API is not hammered endlessly


def test_retries_then_recovers_from_a_transient_failure(tmp_path):
    state = {"n": 0}

    def flaky(kind, ids):
        state["n"] += 1
        return state["n"] <= 2

    new, _ = go(tmp_path, FakeApi(fail=flaky))
    assert all(not e["gap"] for e in new)


def test_one_cell_failing_does_not_drop_the_others(tmp_path):
    api = FakeApi(fail=lambda kind, ids: "far-east" in ids)
    new, path = go(tmp_path, api)
    cells = by_cell(new)
    assert len(new) == 12
    assert_gap(cells["far-east"])
    assert all(not e["gap"] and e["probability"] is not None for c, e in cells.items() if c != "far-east")


def test_dead_api_stops_per_cell_retries_early(tmp_path):
    api = FakeApi(fail=lambda kind, ids: True)
    new, _ = go(tmp_path, api)
    assert all(e["gap"] for e in new)
    assert any("stopped" in e["gap_reason"] for e in new)


def test_null_values_in_the_window_make_a_gap(tmp_path):
    api = FakeApi(null=lambda kind, c, name, t: c == "north-tehran" and name == "pm2_5" and t.hour == 3 and t.day == 3)
    new, _ = go(tmp_path, api)
    cells = by_cell(new)
    assert_gap(cells["north-tehran"], "pm2_5")
    assert sum(e["gap"] for e in new) == 1


def test_short_time_axis_for_one_cell_is_a_gap_not_a_guess(tmp_path):
    # the response for this cell ends at 05:00 UTC on the issue date: 3 of the 12 pre-cutoff stamps missing
    api = FakeApi(drop=lambda kind, c, t: c == "far-west" and t >= pd.Timestamp("2026-11-03T06:00:00Z"))
    new, _ = go(tmp_path, api)
    cells = by_cell(new)
    assert_gap(cells["far-west"], "time axis")
    assert "9 of 12" in cells["far-west"]["gap_reason"]
    assert sum(e["gap"] for e in new) == 1


def test_short_time_axis_for_every_cell(tmp_path):
    api = FakeApi(drop=lambda kind, c, t: t >= pd.Timestamp("2026-11-03T05:00:00Z"))
    new, _ = go(tmp_path, api)
    assert len(new) == 12 and all(e["gap"] for e in new)


def test_weather_missing_in_the_window_is_a_gap(tmp_path):
    # no weather anywhere: the historical API and the live fallback both come back null
    api = FakeApi(null=lambda kind, c, name, t: kind in ("hf", "live") and name == "temperature_2m")
    new, _ = go(tmp_path, api)
    assert all(e["gap"] and "temperature_2m" in e["gap_reason"] for e in new)


def test_summer_time_issue_day_is_a_gap_not_a_crash(tmp_path):
    new, _ = go(tmp_path, FakeApi(), now=pd.Timestamp("2022-06-15T10:00:00Z"))
    assert len(new) == 12 and all(e["gap"] for e in new)


def test_duplicate_stamps_in_a_response_are_deduplicated(tmp_path):
    new, _ = go(tmp_path, FakeApi(duplicate_stamps=True))
    assert len(new) == 12 and all(not e["gap"] for e in new)
    assert new[0]["probability"] == pytest.approx(expected_probability(WINDOW_PM, TARGET), abs=5e-5)


def test_conflicting_duplicate_stamps_are_an_error_not_a_guess(tmp_path):
    with pytest.raises(FetchError, match="different values"):
        fetch_hourly(CELLS[:2], "2026-11-01", "2026-11-01", get=FakeApi(duplicate_stamps=True, duplicate_shift=1.0),
                     sleep=Sleeper())
    # identical repeats collapse to one row per hour
    df = fetch_hourly(CELLS[:2], "2026-11-01", "2026-11-01", get=FakeApi(duplicate_stamps=True), sleep=Sleeper())
    assert len(df) == 2 * 24 and not df.duplicated(["cell_id", "time_utc"]).any()
    # through the pipeline the conflict is recorded as gaps, never as a forecast
    new, _ = go(tmp_path, FakeApi(duplicate_stamps=True, duplicate_shift=1.0))
    assert len(new) == 12 and all(e["gap"] and "different values" in e["gap_reason"] for e in new)


def test_a_null_repeated_against_a_number_is_a_conflict():
    key = {"cell_id": ["a", "a"], "time_utc": pd.to_datetime(["2026-11-01 00:00"] * 2, utc=True)}
    from pipeline.fetch import _collapse_duplicates
    with pytest.raises(FetchError):
        _collapse_duplicates(pd.DataFrame({**key, "pm2_5": [1.0, np.nan]}), ["pm2_5"], "test")
    both_null = _collapse_duplicates(pd.DataFrame({**key, "pm2_5": [np.nan, np.nan]}), ["pm2_5"], "test")
    assert len(both_null) == 1


# ------------------------------------------------------------------ weather fallback (ruling 3)
def test_historical_forecast_lag_falls_back_to_the_live_forecast_api(tmp_path):
    lag = pd.Timestamp("2026-11-03T00:00:00Z")
    api = FakeApi(null=lambda kind, c, name, t: kind == "hf" and t >= lag and name != "pm2_5")
    new, _ = go(tmp_path, api)
    assert all(not e["gap"] for e in new)
    (live,) = api.urls("live")
    assert live["models"] == "ecmwf_ifs" and live["timezone"] == "GMT" and "domains" not in live
    assert (live["start_date"], live["end_date"]) == ("2026-11-02", "2026-11-03")
    assert new[0]["probability"] == pytest.approx(expected_probability(WINDOW_PM, TARGET), abs=5e-5)


def test_live_fallback_only_fills_missing_weather_and_keeps_the_historical_values():
    primary = pd.DataFrame({
        "cell_id": ["a", "a"], "time_utc": pd.to_datetime(["2026-11-03 01:00", "2026-11-03 02:00"], utc=True),
        "pm2_5": [1.0, 2.0], "temperature_2m": [10.0, np.nan]})
    live = pd.DataFrame({
        "cell_id": ["a", "a", "a"], "time_utc": pd.to_datetime(["2026-11-03 01:00", "2026-11-03 02:00", "2026-11-03 02:00"], utc=True),
        "temperature_2m": [99.0, 11.0, 11.0]})
    out = predict.fill_weather(primary, live)
    assert out.loc[out["time_utc"] == pd.Timestamp("2026-11-03 01:00", tz="UTC"), "temperature_2m"].item() == 10.0
    assert out.loc[out["time_utc"] == pd.Timestamp("2026-11-03 02:00", tz="UTC"), "temperature_2m"].item() == 11.0
    assert not out.duplicated(["cell_id", "time_utc"]).any() and len(out) == 2


# ------------------------------------------------------------------ rerun and merge (ruling 5)
def test_rerun_replaces_instead_of_duplicating(tmp_path):
    api = FakeApi()
    _, path = go(tmp_path, api)
    later = pd.Timestamp("2026-11-03T14:00:00Z")
    new, _ = go(tmp_path, FakeApi(pm25=lambda c, t: 80.0), now=later)
    entries = saved(path)
    assert len(entries) == 12
    assert {e["issued_at"] for e in entries} == {"2026-11-03T14:00:00Z"}
    assert entries[0]["probability"] > 0.5


def test_rerun_never_replaces_a_good_entry_with_a_gap(tmp_path):
    _, path = go(tmp_path, FakeApi())
    good = saved(path)
    go(tmp_path, FakeApi(fail=lambda k, ids: True), now=pd.Timestamp("2026-11-03T14:00:00Z"))
    assert saved(path) == good


def test_rerun_can_replace_a_gap_with_a_good_entry(tmp_path):
    _, path = go(tmp_path, FakeApi(fail=lambda k, ids: True))
    assert all(e["gap"] for e in saved(path))
    go(tmp_path, FakeApi(), now=pd.Timestamp("2026-11-03T14:00:00Z"))
    entries = saved(path)
    assert len(entries) == 12 and all(not e["gap"] for e in entries)


def test_rerun_mixed_keeps_good_and_upgrades_gaps(tmp_path):
    _, path = go(tmp_path, FakeApi(fail=lambda k, ids: "far-east" in ids))
    go(tmp_path, FakeApi(fail=lambda k, ids: "west-tehran" in ids), now=pd.Timestamp("2026-11-03T14:00:00Z"))
    cells = by_cell(saved(path))
    assert len(cells) == 12 and not cells["far-east"]["gap"] and not cells["west-tehran"]["gap"]
    assert cells["west-tehran"]["issued_at"] == "2026-11-03T10:05:00Z"      # the good one was kept
    assert cells["far-east"]["issued_at"] == "2026-11-03T14:00:00Z"         # the gap was upgraded


def test_a_new_day_appends_and_old_entries_stay(tmp_path):
    _, path = go(tmp_path, FakeApi())
    go(tmp_path, FakeApi(), now=pd.Timestamp("2026-11-04T10:05:00Z"))
    entries = saved(path)
    assert len(entries) == 24
    assert [e["target_date"] for e in entries] == [TARGET] * 12 + ["2026-11-05"] * 12
    keys = [(e["target_date"], e["cell_id"]) for e in entries]
    assert keys == sorted(keys) and len(set(keys)) == 24


def test_merge_is_idempotent_and_deduplicates_incoming_keys():
    a = {"target_date": TARGET, "cell_id": "x", "gap": False, "issued_at": "t1", "probability": 0.1}
    b = {**a, "issued_at": "t2", "probability": 0.2}
    merged = store.merge([], [a, b])
    assert len(merged) == 1 and merged[0]["issued_at"] == "t2"
    assert store.merge(merged, []) == merged
    assert store.merge(merged, merged) == merged


def test_existing_file_is_read_and_corrupt_file_is_not_overwritten(tmp_path):
    path = tmp_path / "predictions.json"
    assert store.load(path) == []                    # first deploy: no file yet
    path.write_text('{"entries": []}', encoding="utf-8")
    assert store.load(path) == []
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        store.load(path)
    with pytest.raises(ValueError):
        predict.run(now=NOW, get=FakeApi(), sleep=Sleeper(), predictions_path=path, model_path=MODEL_PATH)
    assert path.read_text(encoding="utf-8") == "{not json"


def test_saved_file_format_is_stable_and_small(tmp_path):
    _, path = go(tmp_path, FakeApi())
    text = path.read_text(encoding="utf-8")
    doc = json.loads(text)
    assert list(doc) == ["schema_version", "entries"] and doc["schema_version"] == 1
    assert text.endswith("\n") and text.count("\n") == 12 + 2     # one entry per line
    before = text
    store.save(path, store.load(path))
    assert path.read_text(encoding="utf-8") == before


def test_only_the_predictions_file_is_written(tmp_path):
    go(tmp_path, FakeApi())
    assert [p.name for p in tmp_path.iterdir()] == ["predictions.json"]


# ------------------------------------------------------------------ outcomes (ruling 7)
def entry(cell_id="west-tehran", target=TARGET, gap=False, probability=0.7):
    return {"issued_at": "2026-11-03T10:05:00Z", "target_date": target, "cell_id": cell_id,
            "probability": None if gap else probability, "predicted": None if gap else int(probability >= 0.5),
            "model_version": 1, "outcome": None, "outcome_mean_pm25": None, "gap": gap,
            "gap_reason": "x" if gap else None, "cams_forecast_pm25": 40.0}


def day_api(mean=50.0, bad_hours=0, **kw):
    """Air quality for Tehran days: every hour `mean`, the first `bad_hours` hours of each Tehran day null."""
    def null(kind, c, name, t):
        local_hour = (t + pd.Timedelta(hours=3, minutes=30)).hour
        return name == "pm2_5" and local_hour < bad_hours
    return FakeApi(pm25=lambda c, t: mean, null=null, **kw)


def fill(tmp_path, entries, api, now):
    path = tmp_path / "predictions.json"
    store.save(path, entries)
    n = fill_outcomes.run(now=pd.Timestamp(now), get=api, sleep=Sleeper(), predictions_path=path)
    return n, saved(path), path


def test_outcome_filled_once_the_tehran_day_has_ended(tmp_path):
    api = day_api(50.0)
    # Tehran midnight after 2026-11-04 is 2026-11-04T20:30Z
    n, entries, _ = fill(tmp_path, [entry()], api, "2026-11-04T20:30:00Z")
    assert n == 1
    assert entries[0]["outcome"] == 1 and entries[0]["outcome_mean_pm25"] == pytest.approx(50.0)
    assert entries[0]["probability"] == 0.7 and entries[0]["predicted"] == 1     # forecast untouched
    (air,) = api.urls("air")
    assert (air["start_date"], air["end_date"]) == ("2026-11-03", "2026-11-04")
    assert api.urls("hf") == [] and api.urls("live") == []                         # pollutants only


def test_outcome_not_filled_while_the_target_day_is_still_running(tmp_path):
    api = day_api(50.0)
    n, entries, _ = fill(tmp_path, [entry()], api, "2026-11-04T20:29:59Z")       # 23:59:59 in Tehran
    assert n == 0 and entries[0]["outcome"] is None and entries[0]["outcome_mean_pm25"] is None
    assert api.calls == []
    # and nothing for a target day in the future
    n, entries, _ = fill(tmp_path, [entry(target="2026-11-09")], api, "2026-11-04T23:00:00Z")
    assert n == 0 and api.calls == []


def test_outcome_threshold_is_strictly_above_35_4(tmp_path):
    for mean, want in ((35.4, 0), (35.5, 1), (10.0, 0)):
        _, entries, _ = fill(tmp_path, [entry()], day_api(mean), "2026-11-05T08:00:00Z")
        assert entries[0]["outcome"] == want, mean


def test_outcome_needs_twenty_hours_of_data(tmp_path):
    n, entries, _ = fill(tmp_path, [entry()], day_api(50.0, bad_hours=5), "2026-11-05T08:00:00Z")   # 19 hours
    assert n == 0 and entries[0]["outcome"] is None
    n, entries, _ = fill(tmp_path, [entry()], day_api(50.0, bad_hours=4), "2026-11-05T08:00:00Z")   # 20 hours
    assert n == 1 and entries[0]["outcome"] == 1


def test_outcome_is_per_cell(tmp_path):
    api = FakeApi(pm25=lambda c, t: 80.0 if c == "west-tehran" else 10.0)
    _, entries, _ = fill(tmp_path, [entry("west-tehran"), entry("east-tehran")], api, "2026-11-05T08:00:00Z")
    assert {e["cell_id"]: e["outcome"] for e in entries} == {"west-tehran": 1, "east-tehran": 0}
    assert len(api.urls("air")) == 1


def test_gap_entries_get_an_outcome_but_never_a_probability(tmp_path):
    _, entries, _ = fill(tmp_path, [entry(gap=True)], day_api(50.0), "2026-11-05T08:00:00Z")
    e = entries[0]
    assert e["gap"] is True and e["probability"] is None and e["predicted"] is None
    assert e["outcome"] == 1


def test_fill_is_idempotent_and_does_not_refetch(tmp_path):
    api = day_api(50.0)
    _, first, path = fill(tmp_path, [entry(), entry(target="2026-11-06")], api, "2026-11-05T08:00:00Z")
    text = path.read_text(encoding="utf-8")
    calls = len(api.calls)
    n = fill_outcomes.run(now=pd.Timestamp("2026-11-05T08:00:00Z"), get=api, sleep=Sleeper(), predictions_path=path)
    assert n == 0 and path.read_text(encoding="utf-8") == text and len(api.calls) == calls
    assert [e["outcome"] for e in first] == [1, None]


def test_fill_leaves_entries_alone_when_the_fetch_fails(tmp_path):
    api = FakeApi(fail=lambda k, ids: True)
    path = tmp_path / "predictions.json"
    store.save(path, [entry()])
    before = path.read_text(encoding="utf-8")
    with pytest.raises(FetchError):
        fill_outcomes.run(now=pd.Timestamp("2026-11-05T08:00:00Z"), get=api, sleep=Sleeper(), predictions_path=path)
    assert path.read_text(encoding="utf-8") == before


def test_fill_with_no_file_or_no_entries_is_a_noop(tmp_path):
    api = FakeApi()
    assert fill_outcomes.run(now=NOW, get=api, sleep=Sleeper(), predictions_path=tmp_path / "none.json") == 0
    assert api.calls == [] and not (tmp_path / "none.json").exists()


def test_fill_does_not_touch_the_model(tmp_path):
    before = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    fill(tmp_path, [entry()], day_api(50.0), "2026-11-05T08:00:00Z")
    assert hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() == before


# ------------------------------------------------------------------ fetch options used by the pipeline
def test_fetch_hourly_can_ask_for_pollutants_or_weather_alone_and_swap_the_weather_url():
    api = FakeApi()
    air = fetch_hourly(CELLS[:2], "2026-11-01", "2026-11-01", get=api, sleep=Sleeper(), sources=("air",))
    assert list(air.columns) == ["cell_id", "time_utc", *POLLUTANTS] and api.urls("hf") == []
    wx = fetch_hourly(CELLS[:2], "2026-11-01", "2026-11-01", get=api, sleep=Sleeper(),
                      sources=("weather",), weather_url=LIVE_URL)
    assert list(wx.columns) == ["cell_id", "time_utc", *WEATHER] and len(api.urls("live")) == 1
    both = fetch_hourly(CELLS[:2], "2026-11-01", "2026-11-01", get=api, sleep=Sleeper())
    assert list(both.columns)[2:] == [*POLLUTANTS, *WEATHER]
    with pytest.raises(ValueError):
        fetch_hourly(CELLS[:2], "2026-11-01", "2026-11-01", get=api, sleep=Sleeper(), sources=("radar",))


# ------------------------------------------------------------------ workflow file
WORKFLOW = ROOT / ".github" / "workflows" / "daily.yml"


def test_workflow_schedule_commit_scope_and_deploy():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "cron: '0 10 * * *'" in text and "workflow_dispatch:" in text
    assert "python -m pipeline.predict" in text and "python -m pipeline.fill_outcomes" in text
    assert text.count("git add") == 1 and "git add data/predictions.json" in text
    assert "github-actions[bot]" in text
    assert "git diff --cached --quiet" in text            # no commit when nothing changed
    assert "concurrency:" in text and "cancel-in-progress: false" in text
    assert "pnpm build" in text and "upload-pages-artifact" in text and "deploy-pages" in text
    assert "package_json_file: web/package.json" in text and "path: web/dist" in text
    assert text.index("git commit") < text.index("git push") < text.index("pnpm build")
    for line in text.splitlines():
        if "uses:" in line:
            assert "@v" in line and line.split("@v")[1].count(".") == 2, f"unpinned action: {line.strip()}"


# ------------------------------------------------------------------ live vs history measurement
def test_compare_reports_mean_and_max_absolute_difference_and_skips_nulls():
    from pipeline.compare_live import compare
    t = pd.to_datetime(["2026-11-01 00:00", "2026-11-01 01:00", "2026-11-01 02:00", "2026-11-01 03:00"], utc=True)
    a = pd.DataFrame({"cell_id": "x", "time_utc": t, "pm2_5": [10.0, 12.0, np.nan, 20.0]})
    b = pd.DataFrame({"cell_id": "x", "time_utc": t, "pm2_5": [10.0, 11.0, 5.0, 17.0]})
    (r,) = compare(a, b, ["pm2_5"])
    assert r["hours"] == 3 and r["null_either"] == 1
    assert r["mean_abs"] == pytest.approx(4 / 3) and r["max_abs"] == pytest.approx(3.0)


def test_measure_and_profile_section(tmp_path):
    from pipeline import compare_live
    from pipeline.fetch import write_hourly
    history_path = tmp_path / "hourly.csv.gz"
    write_hourly(fetch_hourly(CELLS, "2026-10-25", "2026-11-02", get=FakeApi(), sleep=Sleeper()), history_path)
    api = FakeApi(pm25=lambda c, t: 31.0 + t.hour)        # live PM2.5 is 1.0 above the cache everywhere
    result = compare_live.measure(NOW, days=3, get=api, sleep=Sleeper(), history_path=history_path,
                                  model_path=MODEL_PATH, pause_s=0)
    pm = {r["variable"]: r for r in result["pollutants_air_quality_vs_cache"]}
    assert pm["pm2_5"]["mean_abs"] == pytest.approx(1.0) and pm["pm2_5"]["max_abs"] == pytest.approx(1.0)
    assert pm["pm10"]["max_abs"] == pytest.approx(0.0)
    wx = {r["variable"]: r for r in result["weather_live_vs_historical"]}
    assert set(wx) == set(WEATHER) and all(r["max_abs"] == 0 and r["hours"] > 0 for r in wx.values())
    assert result["probability"]["rows"] > 0 and result["probability"]["max_abs"] > 0
    section = compare_live.render(result)
    assert section.startswith(compare_live.BEGIN) and "## Live vs history" in section
    profile = "# Data profile\n\n## Weather\n\ntext\n\n## Reproduce\n\ncmd\n"
    spliced = compare_live.splice(profile, section)
    assert spliced.index("## Live vs history") < spliced.index("## Reproduce")
    assert compare_live.splice(spliced, section) == spliced                      # replacing is idempotent
    assert compare_live.extract_section(spliced) == section.rstrip("\n") + "\n"


def job_permissions(text: str) -> dict:
    """Each job's own `permissions:` mapping, read from the workflow text (PyYAML is not a project dependency)."""
    jobs_text = text.split("\njobs:\n", 1)[1]
    out, current, in_perm = {}, None, False
    for line in jobs_text.splitlines():
        if line and not line.startswith(" "):
            break
        if line.startswith("  ") and not line.startswith("   ") and line.strip().endswith(":"):
            current, in_perm = line.strip()[:-1], False
            out[current] = {}
        elif current and line.startswith("    permissions:"):
            in_perm = True
        elif current and in_perm and line.startswith("      ") and ":" in line:
            k, v = line.strip().split(":", 1)
            out[current][k] = v.strip()
        elif line.startswith("    ") and not line.startswith("      "):
            in_perm = False
    return out


def test_each_job_has_exactly_the_permissions_it_needs():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "\npermissions:\n  contents: read\n" in text            # the default for everything else
    assert job_permissions(text) == {
        "forecast": {"contents": "write"},
        "build": {"contents": "read", "pages": "write"},         # actions/configure-pages
        "deploy": {"pages": "write", "id-token": "write"},       # actions/deploy-pages
    }
