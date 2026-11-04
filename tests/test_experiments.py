"""The Lab's teaching code agrees with the production code, and its fixtures are current."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
import pytest

from training import experiments, export_lab_fixtures
from training.experiments import (boundary_x2, descent, fit_linear, fit_polynomial,
                                  gradient_matrix, linear_crossing, logistic_loss, poly_features,
                                  race_learning_rates, season_features, squared_error_cost)
from training.features import build_dataset  # noqa: F401  (imported to prove the module loads)
from training.model import (EPS, compute_cost, compute_gradient, gradient_descent,
                            predict_proba)

ROOT = Path(__file__).resolve().parent.parent
NAMES = ["fit_linear", "boundary_x2", "squared_error_cost", "logistic_loss", "descent",
         "gradient_matrix", "lr_race", "season_features", "poly_features", "fit_polynomial"]


def data(m=200, seed=1):
    rng = np.random.default_rng(seed)
    x = rng.uniform(0.5, 9.0, size=m)
    p = 1 / (1 + np.exp(-(1.2 * x - 5)))
    y = (rng.uniform(size=m) < p).astype(float)
    return x, y


def test_lab_markers_are_balanced_and_named():
    names, open_name = [], None
    for line in Path(experiments.__file__).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        m = re.fullmatch(r"# lab:(\w+)", s)
        if m:
            assert open_name is None, "nested lab block"
            open_name = m.group(1)
            names.append(open_name)
        elif s == "# endlab":
            assert open_name is not None
            open_name = None
    assert open_name is None
    assert sorted(names) == sorted(NAMES)


def test_other_files_expose_the_blocks_the_lab_shows():
    expected = {"training/labels.py": "daily_labels", "training/train.py": "time_dot",
                "pipeline/predict.py": "model_probability"}
    for path, name in expected.items():
        text = (ROOT / path).read_text(encoding="utf-8")
        assert f"# lab:{name}\n" in text.replace("\r\n", "\n")
        assert "# endlab" in text


def test_linear_fit_is_least_squares_and_the_crossing_solves_the_threshold():
    x, y = data()
    w, b = fit_linear(x, y)
    ref = np.polyfit(x, y, 1)
    assert w == pytest.approx(ref[0], rel=1e-9)
    assert b == pytest.approx(ref[1], rel=1e-9)
    assert w * linear_crossing(w, b) + b == pytest.approx(0.5)


def test_far_positive_days_move_the_linear_crossing_right():
    x, y = data()
    w, b = fit_linear(x, y)
    far_x = np.concatenate([x, 13 + 0.4 * np.arange(5)])
    far_y = np.concatenate([y, np.ones(5)])
    w2, b2 = fit_linear(far_x, far_y)
    assert linear_crossing(w2, b2) > linear_crossing(w, b)


def test_boundary_is_where_the_score_is_zero():
    w, b = np.array([1.3, -0.4]), -2.0
    x1 = np.linspace(0, 6, 7)
    x2 = boundary_x2(x1, w, b)
    z = w[0] * x1 + w[1] * x2 + b
    np.testing.assert_allclose(z, 0.0, atol=1e-12)
    np.testing.assert_allclose(predict_proba(np.c_[x1, x2], w, b), 0.5)


def test_squared_error_cost_matches_the_definition():
    x, y = data()
    X = x[:, None]
    f = predict_proba(X, np.array([0.7]), -2.0)
    assert squared_error_cost(X, y, np.array([0.7]), -2.0) == pytest.approx(np.sum((f - y) ** 2) / (2 * len(y)))


def test_logistic_loss_values_and_clip():
    assert logistic_loss(0.5, 1) == pytest.approx(np.log(2))
    assert logistic_loss(0.95, 1) < 0.06
    assert logistic_loss(0.05, 1) > 2.9
    # a probability of exactly 0 or 1 gives a large but finite loss
    assert np.isfinite(logistic_loss(1.0, 0)) and logistic_loss(1.0, 0) == pytest.approx(-np.log(EPS))
    assert np.isfinite(logistic_loss(0.0, 1))
    # the mean of the per-example losses is the production cost
    x, y = data(50)
    X = x[:, None]
    f = predict_proba(X, np.array([0.9]), -3.0)
    assert np.mean([logistic_loss(fi, yi) for fi, yi in zip(f, y)]) == pytest.approx(
        compute_cost(X, y, np.array([0.9]), -3.0))


def test_plain_descent_is_the_production_descent_written_with_loops():
    x, y = data(80)
    X = x[:, None]
    w, b, hist = descent(X, y, np.zeros(1), 0.0, 0.1, 25)
    w2, b2, ref = gradient_descent(X, y, np.zeros(1), 0.0, 0.1, 25)
    np.testing.assert_allclose(w, w2, rtol=1e-12)
    assert b == pytest.approx(b2, rel=1e-12)
    np.testing.assert_allclose(hist, ref, rtol=1e-12)


def test_matrix_gradient_is_the_production_gradient():
    x, y = data(80)
    X = np.c_[x, x ** 2 / 10]
    w = np.array([0.4, -0.2])
    dw, db = gradient_matrix(X, y, w, -1.0)
    ref_w, ref_b = compute_gradient(X, y, w, -1.0)
    np.testing.assert_allclose(dw, ref_w, rtol=1e-12)
    assert db == pytest.approx(ref_b, rel=1e-12)


def test_learning_rate_race_uses_the_production_descent():
    x, y = data()
    X = x[:, None]
    hist = race_learning_rates(X, y, [0.001, 0.1], num_iters=40)
    for alpha, h in hist.items():
        _, _, ref = gradient_descent(X, y, np.zeros(1), 0.0, alpha, 40)
        assert h == ref
    assert hist[0.1][-1] < hist[0.001][-1]


def test_season_features_are_a_point_on_the_circle_and_wrap():
    for day in (1, 90, 200, 365):
        s, c = season_features(day)
        assert s * s + c * c == pytest.approx(1.0)
    s0, c0 = season_features(0)
    s1, c1 = season_features(365.25)
    assert (s0, c0) == (pytest.approx(s1, abs=1e-12), pytest.approx(c1))


def test_season_features_match_the_feature_builder():
    import pandas as pd
    from training.features import _features
    day = pd.Timestamp("2025-03-07")
    window = np.ones((1, 10, 12))
    row = _features(window, pd.DatetimeIndex([day]))
    s, c = season_features(day.dayofyear)
    assert row["season_sin"].iloc[0] == pytest.approx(s)
    assert row["season_cos"].iloc[0] == pytest.approx(c)


def test_poly_features_are_the_nine_terms_up_to_degree_three():
    x1, x2 = np.array([2.0, -1.0]), np.array([3.0, 0.5])
    P = poly_features(x1, x2)
    assert P.shape == (2, 9)
    np.testing.assert_allclose(P[0], [2, 3, 4, 6, 9, 8, 12, 18, 27])


def test_a_larger_penalty_shrinks_the_polynomial_weights():
    rng = np.random.default_rng(3)
    x1, x2 = rng.normal(size=120), rng.normal(size=120)
    y = (x1 + 0.5 * x2 + rng.normal(scale=1.0, size=120) > 0).astype(float)
    w_small, *_ = fit_polynomial(x1, x2, y, 0.01)
    w_big, *_ = fit_polynomial(x1, x2, y, 1000.0)
    assert np.abs(w_big).max() < np.abs(w_small).max()


def test_committed_fixtures_are_current():
    sample = json.loads(export_lab_fixtures.SAMPLE_PATH.read_text(encoding="utf-8"))
    model = json.loads(export_lab_fixtures.MODEL_PATH.read_text(encoding="utf-8"))
    fresh = json.loads(json.dumps(export_lab_fixtures.build_fixtures(sample, model), allow_nan=False))
    committed = json.loads(export_lab_fixtures.FIXTURES_PATH.read_text(encoding="utf-8"))
    assert_close_tree(fresh, committed, "rerun: python -m training.export_lab_fixtures")


def test_fixture_runs_stop_where_python_stops():
    fx = json.loads(export_lab_fixtures.FIXTURES_PATH.read_text(encoding="utf-8"))
    diverging = [c for c in fx["runOne"] if c["divergedAt"] is not None]
    assert diverging and all(c["divergedAt"] == len(c["jHistory"]) + 1 for c in diverging)
    assert all(np.isfinite(c["jHistory"]).all() for c in fx["runOne"] + fx["runMulti"])


def assert_close_tree(a, b, path="fixtures", rel=1e-9, abs_=1e-12):
    """Equal structure and strings; numbers equal within a relative tolerance.

    Exact float equality fails across platforms: NumPy on Linux CI and on Windows can differ in the
    last bits of a sum, so regenerated fixtures are compared with a tolerance far below anything shown.
    """
    if isinstance(a, dict) and isinstance(b, dict):
        assert a.keys() == b.keys(), f"{path}: keys differ"
        for k in a:
            assert_close_tree(a[k], b[k], f"{path}.{k}", rel, abs_)
    elif isinstance(a, list) and isinstance(b, list):
        assert len(a) == len(b), f"{path}: lengths differ"
        for i, (x, y) in enumerate(zip(a, b)):
            assert_close_tree(x, y, f"{path}[{i}]", rel, abs_)
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        assert math.isclose(a, b, rel_tol=rel, abs_tol=abs_), f"{path}: {a} != {b}"
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"
