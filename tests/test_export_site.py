"""The JSON files the Lab, Forecast and Data pages read (training/export_site.py)."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from tests.test_scope import NAMES_ANY_CASE, NAMES_CAPITALISED
from training import export_site
from training.features import FEATURES, WX_FEATURES

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
FILES = ["lab-days", "lab-timing", "lab-rows", "lab-today", "data-page"]
COLS = ["pm2_5_mean", "pm2_5_max", "pm2_5_last", "season_sin", "season_cos",
        "wx_wind", "wx_blh", "wx_precip", "wx_temp", "wx_rh", "y", "cell", "doy"]


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def model_json():
    return json.loads((ROOT / "model" / "model.json").read_text(encoding="utf-8"))


def frame(n=6, seed=1):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({f: rng.normal(20, 5, n) for f in FEATURES + WX_FEATURES})
    df["cell_id"] = ["west-tehran", "east-tehran"] * (n // 2)
    df["target_date"] = list(pd.to_datetime(["2024-03-15", "2024-03-16", "2024-03-17"] * (n // 3)).date)
    df["y"] = [0, 1] * (n // 2)
    return df


def model_stub():
    feats = FEATURES + WX_FEATURES

    def cand(lam, tr, se):
        return {"feature_set": "all_wx", "features": feats, "lambda": lam,
                "train_cost": tr, "selection_cost": se, "weights": [0.5] * 19, "bias": 0.1}

    return {"candidates": [{"feature_set": "pm_season", "features": feats[:5], "lambda": 0.0,
                            "train_cost": 1.0, "selection_cost": 1.0, "weights": [0.0] * 5, "bias": 0.0},
                           cand(0.0, 0.11, 0.09), cand(10.0, 0.115, 0.087)]}


# --- shape ---------------------------------------------------------------------

def test_lab_rows_shape_matches_the_draft():
    cells = ["east-tehran", "west-tehran"]
    out = export_site.build_rows(frame(), frame(6, 2), model_stub(), cells)
    assert list(out) == ["cells", "train", "sel", "reg"]
    assert out["cells"] == cells
    assert out["train"]["cols"] == COLS and out["sel"]["cols"] == COLS
    assert len(out["train"]["rows"]) == 6 and all(len(r) == 13 for r in out["train"]["rows"])
    r0 = out["train"]["rows"][0]
    assert r0[11] == cells.index("west-tehran") and r0[12] == 75 and r0[10] in (0, 1)
    assert out["reg"]["features"] == FEATURES + WX_FEATURES
    assert [r["lambda"] for r in out["reg"]["rows"]] == [0.0, 10.0]      # the all_wx candidates only
    assert list(out["reg"]["rows"][1]) == ["lambda", "train", "sel", "w"]
    assert len(out["reg"]["rows"][1]["w"]) == 19


def test_timing_cases_have_the_draft_keys():
    t = load("lab-timing")
    assert [c["key"] for c in t] == ["cleans", "builds", "stays"]
    assert [c["target"] for c in t] == ["2025-03-02", "2024-11-07", "2024-11-10"]
    for c in t:
        assert list(c) == ["key", "title", "today", "target", "pm", "wx", "tomorrow_mean"]
        assert len(c["pm"]) == 48 and len(c["wx"]) == 45
        assert c["pm"][0][0] == 0.5 and c["pm"][-1][0] == 47.5
        assert c["wx"][0][0] == 3.5 and c["wx"][0][3] is None and len(c["wx"][1]) == 4


def test_days_cover_every_training_day_of_every_square():
    d = load("lab-days")
    assert list(d) == ["days", "cells", "m"]
    assert len(d["cells"]) == 12 and d["m"] == len(d["days"]) * 12
    assert d["days"][0] == "2024-03-15" and d["days"][-1] == "2025-05-02"
    for c in d["cells"]:
        assert set(c) == {"id", "name", "tomorrow", "today"}
        assert len(c["tomorrow"]) == len(c["today"]) == len(d["days"])


# --- the real export -------------------------------------------------------------

def test_lab_rows_counts():
    r = load("lab-rows")
    assert len(r["train"]["rows"]) == 4968
    assert sum(row[10] for row in r["train"]["rows"]) == 352
    assert len(r["sel"]["rows"]) == 2208 and sum(row[10] for row in r["sel"]["rows"]) == 85
    assert len(r["reg"]["rows"]) == 5
    chosen = [c for c in model_json()["candidates"] if c["chosen"]][0]
    row = [x for x in r["reg"]["rows"] if x["lambda"] == chosen["lambda"]][0]
    assert row["sel"] == pytest.approx(chosen["selection_cost"], abs=1e-5)


def test_lab_today_comes_from_model_version_2():
    model = model_json()
    assert model["version"] == 2
    t = load("lab-today")
    assert t["cell"] == "West Tehran"
    assert t["features"] == model["features"] and len(t["features"]) == 19
    assert t["w"] == model["weights"] and t["b"] == model["bias"] and t["lambda"] == 10.0
    assert t["mu"] == model["scaling"]["mu"] and t["sigma"] == model["scaling"]["sigma"]
    z = (np.array(t["x"]) - np.array(t["mu"])) / np.array(t["sigma"])
    p = 1 / (1 + math.exp(-(z @ np.array(t["w"]) + t["b"])))
    assert t["p"] == pytest.approx(p, abs=1e-4)
    assert t["held"]["cost"] == model["cost"]["held_out"]
    assert t["held"]["rows"] == model["rows"]["held_out"]
    assert t["held"]["base"] == {"overall": model["baselines"]["overall"]["held_out_cost"],
                                 "monthly": model["baselines"]["monthly"]["held_out_cost"]}
    assert t["held"]["calib"]["counts_y1"] == model["held_out_probabilities"]["counts_y1"]
    assert t["vec"] == model["vectorization"]
    assert t["target"] > t["day"] and t["actual"] > 0


def test_data_page_has_no_excluded_names():
    page = load("data-page")
    assert set(page) == {"facts", "rows", "splits", "cells", "by_month", "calib", "cost", "baselines"}
    for name in FILES:
        text = (DATA / f"{name}.json").read_text(encoding="utf-8")
        assert not NAMES_ANY_CASE.search(text) and not NAMES_CAPITALISED.search(text), name
        assert "\u2014" not in text


def test_data_page_numbers_agree_with_the_profile_and_model():
    page = load("data-page")
    prof = json.loads((DATA / "profile.json").read_text(encoding="utf-8"))
    model = model_json()
    assert page["facts"]["square_days"] == prof["usable_cell_days"]
    assert page["facts"]["days_per_square"] * 12 == prof["usable_cell_days"]
    assert page["splits"]["train"]["rows"] == model["rows"]["train"] == 4968
    assert page["rows"]["dataset"] - page["rows"]["no_weather_dropped"] == prof["rows"]["dataset"]
    assert len(page["calib"]) == 10 and page["calib"][0]["from"] == 0.0 and page["calib"][-1]["to"] == 1.0
    assert sum(c["yes"] for c in page["calib"]) == prof["splits"]["held_out"]["positives"]
    assert page["cost"] == model["cost"]
    assert set(page["by_month"]) == {c["id"] for c in page["cells"]} | {"pooled"}
    assert all(len(v) == 12 for v in page["by_month"].values())


def test_no_em_dashes_in_the_exporter():
    assert "\u2014" not in (ROOT / "training" / "export_site.py").read_text(encoding="utf-8")


def test_lab_today_has_eight_browsable_training_days():
    t = load("lab-today")
    days = t["days"]
    assert len(days) == 8
    assert all(len(d["x"]) == 19 for d in days)
    assert {d["y"] for d in days} == {0, 1}
    assert sum(d["y"] for d in days) == 4
    assert [d["x"][t["features"].index("pm2_5_mean")] for d in days] == sorted(
        d["x"][t["features"].index("pm2_5_mean")] for d in days)
    # the inputs are in the model's feature order: a day's rows match the exported training rows
    rows = load("lab-rows")["train"]
    cols = rows["cols"]
    for d in days:
        match = [r for r in rows["rows"] if r[cols.index("doy")] == d["doy"] and r[cols.index("y")] == d["y"]
                 and r[cols.index("cell")] == 11
                 and abs(r[cols.index("pm2_5_mean")] - d["x"][t["features"].index("pm2_5_mean")]) < 1e-2]
        assert match, d["doy"]
    assert t["features"] == model_json()["features"]
