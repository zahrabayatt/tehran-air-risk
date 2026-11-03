"""The training run: baselines from training rows only, selection never sees held-out, model.json schema."""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd
import pytest

from training import train
from training.features import FEATURES
from training.model import logistic_cost

BANNED = ("accuracy", "precision", "recall", "f1", "roc", "auc", "confusion", "mse", "rmse", "l1")


def synthetic_dataset(first="2022-10-01", last="2025-09-30", cells=("c0", "c1"), seed=0):
    """Dataset-shaped rows with a real link between PM2.5 today and the label tomorrow."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(first, last, freq="D")
    frames = []
    for cell in cells:
        n = len(dates)
        f = pd.DataFrame({"cell_id": cell,
                          "day": [(d - pd.Timedelta(days=1)).date() for d in dates],
                          "target_date": [d.date() for d in dates]})
        for name in FEATURES:
            f[name] = rng.normal(20.0, 5.0, size=n)
        angle = 2 * np.pi * np.asarray(dates.dayofyear, dtype=float) / 365.25
        f["season_sin"], f["season_cos"] = np.sin(angle), np.cos(angle)
        z = 0.4 * (f["pm2_5_mean"] - 24.0) + 1.0 * f["season_cos"]
        f["y"] = (rng.uniform(size=n) < 1 / (1 + np.exp(-z))).astype("int64")
        frames.append(f)
    return pd.concat(frames, ignore_index=True)


SMALL = dict(candidates=(("pm_season", 0.0), ("all", 0.0), ("all", 100.0)), alpha=0.5, iterations=400)


# ---------------------------------------------------------------- baselines

def test_overall_and_monthly_rates_come_from_training_rows():
    df = synthetic_dataset()
    tr = df.iloc[:400]
    base = train.fit_baselines(tr)
    assert base["overall"]["rate"] == pytest.approx(tr["y"].mean())
    months = pd.to_datetime(tr["target_date"]).dt.month
    for m in range(1, 13):
        rows = tr[months == m]
        expect = rows["y"].mean() if len(rows) else tr["y"].mean()
        assert base["monthly"]["rates"][m - 1] == pytest.approx(expect)
    assert len(base["monthly"]["rates"]) == 12


def test_month_without_training_rows_falls_back_to_overall_and_is_recorded():
    df = synthetic_dataset()
    tr = df[pd.to_datetime(df["target_date"]).dt.month != 3]
    base = train.fit_baselines(tr)
    assert base["monthly"]["fallback_months"] == [3]
    assert base["monthly"]["rates"][2] == pytest.approx(base["overall"]["rate"])


def test_baseline_cost_is_plain_logistic_cost_of_the_rate():
    df = synthetic_dataset()
    tr, held = df.iloc[:500], df.iloc[1500:]
    base = train.fit_baselines(tr)
    costs = train.baseline_costs(base, held)
    y = held["y"].to_numpy(float)
    assert costs["overall"] == pytest.approx(logistic_cost(np.full(len(y), base["overall"]["rate"]), y))
    months = pd.to_datetime(held["target_date"]).dt.month.to_numpy()
    rates = np.array(base["monthly"]["rates"])[months - 1]
    assert costs["monthly"] == pytest.approx(logistic_cost(rates, y))


def test_a_rate_of_zero_gives_a_finite_baseline_cost():
    df = synthetic_dataset().iloc[:200].copy()
    df["y"] = 0
    held = synthetic_dataset().iloc[200:400]
    costs = train.baseline_costs(train.fit_baselines(df), held)
    assert np.isfinite(costs["overall"]) and np.isfinite(costs["monthly"])


# ---------------------------------------------------------------- the run

def _run(df):
    return train.train_model(df, **SMALL)


def test_changing_held_out_labels_changes_nothing_but_held_out_costs():
    df = synthetic_dataset()
    a = _run(df)["model"]
    flipped = df.copy()
    held_dates = set(_run(df)["held_out"]["target_date"])
    mask = flipped["target_date"].isin(held_dates)
    flipped.loc[mask, "y"] = 1 - flipped.loc[mask, "y"]
    b = _run(flipped)["model"]
    assert a["baselines"]["overall"]["rate"] == b["baselines"]["overall"]["rate"]
    assert a["baselines"]["monthly"]["rates"] == b["baselines"]["monthly"]["rates"]
    assert a["weights"] == b["weights"] and a["bias"] == b["bias"]
    assert a["feature_set"] == b["feature_set"]
    assert a["hyperparameters"] == b["hyperparameters"]
    assert [c["selection_cost"] for c in a["candidates"]] == [c["selection_cost"] for c in b["candidates"]]
    assert a["cost"]["held_out"] != b["cost"]["held_out"]
    assert a["baselines"]["overall"]["held_out_cost"] != b["baselines"]["overall"]["held_out_cost"]


def test_selection_and_held_out_rows_do_not_change_scaling():
    df = synthetic_dataset()
    res = _run(df)
    tr = res["train"]
    mu = np.array(res["model"]["scaling"]["mu"])
    np.testing.assert_allclose(mu, tr[res["model"]["features"]].to_numpy().mean(axis=0))


def test_model_json_schema_and_determinism():
    df = synthetic_dataset()
    a, b = _run(df)["model"], _run(df)["model"]
    keys = {"version", "features", "feature_set", "weights", "bias", "scaling", "hyperparameters",
            "cost", "sklearn_cost", "cost_history", "cost_history_iterations", "rows", "date_range",
            "trained_at", "runtime_ms", "environment", "candidates", "baselines", "beats_baselines",
            "threshold", "decision_threshold", "cutoff", "held_out_probabilities", "convergence"}
    assert keys <= set(a)
    assert not {"location", "held_out_gap", "unit"} & set(a)
    for k in ("trained_at", "runtime_ms", "environment"):
        a.pop(k), b.pop(k)
    assert a == b
    assert a["threshold"] == 35.4 and a["decision_threshold"] == 0.5
    assert a["cutoff"] == "12:00 Asia/Tehran"
    assert set(a["cost"]) == {"train", "selection", "held_out"}
    assert isinstance(a["beats_baselines"], bool)
    assert a["beats_baselines"] == (a["cost"]["held_out"] < a["baselines"]["overall"]["held_out_cost"]
                                    and a["cost"]["held_out"] < a["baselines"]["monthly"]["held_out_cost"])
    assert len(a["weights"]) == len(a["features"]) == len(a["scaling"]["mu"])
    assert len(a["cost_history"]) == len(a["cost_history_iterations"])
    assert len(a["candidates"]) == 3 and sum(c["chosen"] for c in a["candidates"]) == 1
    hp = a["held_out_probabilities"]
    assert hp["bins"] == pytest.approx([i / 10 for i in range(11)])
    assert sum(hp["counts_y1"]) + sum(hp["counts_y0"]) == a["rows"]["held_out"]
    json.dumps(a, allow_nan=False)                  # every number is finite
    tokens = {t for k in _keys(a) for t in re.split(r"[^a-z0-9]+", k)}
    assert not tokens & set(BANNED)


def test_chosen_candidate_has_the_lowest_selection_cost():
    m = _run(synthetic_dataset())["model"]
    best = min(m["candidates"], key=lambda c: c["selection_cost"])
    assert best["chosen"]
    assert m["feature_set"] == best["feature_set"] and m["hyperparameters"]["lambda"] == best["lambda"]


def test_held_out_probability_bins():
    out = train.probability_bins(np.array([0.0, 0.05, 0.1, 0.95, 1.0]), np.array([0, 1, 0, 1, 1]))
    assert out["counts_y0"] == [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]
    assert out["counts_y1"] == [1, 0, 0, 0, 0, 0, 0, 0, 0, 2]


def _keys(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k.lower()
            yield from _keys(v)
    elif isinstance(node, list):
        for v in node:
            yield from _keys(v)
