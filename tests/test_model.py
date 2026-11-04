"""Logistic regression written with NumPy: values, gradients, stability and agreement with scikit-learn."""
from __future__ import annotations

import re
import warnings
from pathlib import Path

import numpy as np
import pytest
from sklearn.linear_model import LogisticRegression

from training import model
from training.model import (compute_cost, compute_gradient, gradient_descent, logistic_cost,
                            predict_proba, sigmoid)

LAB_NAMES = [
    "sigmoid",
    "predict_proba_loop",
    "predict_proba",
    "compute_cost_loop",
    "compute_cost",
    "compute_gradient_loop",
    "compute_gradient",
    "compute_cost_reg",
    "compute_gradient_reg",
    "gradient_descent",
]


def make_data(m=300, n=3, seed=0):
    """Scaled features and labels drawn from a known logistic model, so the classes overlap."""
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(m, n))
    w_true = np.array([1.5, -1.0, 0.5])[:n]
    p = 1 / (1 + np.exp(-(X @ w_true - 0.7)))
    y = (rng.uniform(size=m) < p).astype(float)
    return X, y


def numeric_gradient(X, y, w, b, lambda_, eps=1e-6):
    dw = np.zeros_like(w)
    for j in range(len(w)):
        hi, lo = w.copy(), w.copy()
        hi[j] += eps
        lo[j] -= eps
        dw[j] = (compute_cost(X, y, hi, b, lambda_) - compute_cost(X, y, lo, b, lambda_)) / (2 * eps)
    db = (compute_cost(X, y, w, b + eps, lambda_) - compute_cost(X, y, w, b - eps, lambda_)) / (2 * eps)
    return dw, db


# ---------------------------------------------------------------- sigmoid and probabilities

def test_sigmoid_of_zero_is_one_half():
    assert sigmoid(0) == 0.5
    assert sigmoid(0.0) == 0.5
    assert isinstance(sigmoid(0.0), float)


def test_sigmoid_values_and_symmetry():
    z = np.linspace(-30, 30, 121)
    g = sigmoid(z)
    assert g.shape == z.shape
    assert np.all((g >= 0) & (g <= 1))
    assert np.all(np.diff(g) >= 0)
    np.testing.assert_allclose(g + sigmoid(-z), 1.0, atol=1e-15)
    assert sigmoid(2.0) == pytest.approx(1 / (1 + np.exp(-2.0)))


def test_sigmoid_is_stable_for_extreme_z():
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        with np.errstate(over="raise", invalid="raise", divide="raise"):   # underflow to 0 is fine
            g = sigmoid(np.array([-1000.0, -745.0, 0.0, 745.0, 1000.0]))
            assert sigmoid(1000.0) == 1.0 and sigmoid(-1000.0) == 0.0
    assert np.all(np.isfinite(g))
    assert g[0] == 0.0 and g[-1] == 1.0


def test_predict_proba_shapes_and_values():
    X = np.array([[1.0, 2.0], [3.0, 4.0]])
    w, b = np.array([0.5, -1.0]), 2.0
    out = predict_proba(X, w, b)
    assert out.shape == (2,)
    np.testing.assert_allclose(out, 1 / (1 + np.exp(-(X @ w + b))))


def test_predict_proba_is_not_clipped():
    X = np.array([[1.0], [-1.0]])
    out = predict_proba(X, np.array([1000.0]), 0.0)
    assert out[0] == 1.0 and out[1] == 0.0


# ---------------------------------------------------------------- cost

def test_cost_known_values():
    X = np.zeros((4, 2))
    y = np.array([0.0, 1.0, 1.0, 0.0])
    assert compute_cost(X, y, np.zeros(2), 0.0) == pytest.approx(np.log(2))
    X = np.array([[1.0], [2.0]])
    y = np.array([1.0, 0.0])
    w, b = np.array([0.5]), -0.25
    f = 1 / (1 + np.exp(-(X[:, 0] * 0.5 - 0.25)))
    expect = -np.mean(y * np.log(f) + (1 - y) * np.log(1 - f))
    assert compute_cost(X, y, w, b) == pytest.approx(expect)
    # the penalty is lambda / (2m) * sum(w^2)
    assert compute_cost(X, y, w, b, 3.0) == pytest.approx(expect + 3.0 / 4 * 0.25)


def test_cost_is_finite_when_probabilities_reach_zero_or_one():
    X = np.array([[1.0], [-1.0]])
    w = np.array([1000.0])                  # probabilities are exactly 1.0 and 0.0
    right = compute_cost(X, np.array([1.0, 0.0]), w, 0.0)
    wrong = compute_cost(X, np.array([0.0, 1.0]), w, 0.0)
    assert np.isfinite(right) and np.isfinite(wrong)
    assert right == pytest.approx(0.0, abs=1e-12)
    assert wrong == pytest.approx(-np.log(1e-15))      # clipped inside the log, at 1e-15
    assert logistic_cost(np.array([0.0, 1.0]), np.array([1.0, 0.0])) == pytest.approx(-np.log(1e-15))


def test_logistic_cost_of_constant_probability():
    y = np.array([1.0, 0.0, 0.0, 0.0])
    assert logistic_cost(np.full(4, 0.25), y) == pytest.approx(-(np.log(0.25) + 3 * np.log(0.75)) / 4)


def test_bias_not_in_penalty():
    X, y = make_data(m=50)
    w = np.array([0.3, -0.2, 0.9])
    for b in (0.0, 2.0):
        assert compute_cost(X, y, w, b, 10.0) - compute_cost(X, y, w, b, 0.0) == pytest.approx(
            10.0 / (2 * len(y)) * np.sum(w ** 2))
    _, db0 = compute_gradient(X, y, w, 1.0, 0.0)
    _, db1 = compute_gradient(X, y, w, 1.0, 50.0)
    assert db0 == db1


# ---------------------------------------------------------------- gradient

@pytest.mark.parametrize("lambda_", [0.0, 0.7])
def test_gradient_matches_numeric(lambda_):
    X, y = make_data(m=60)
    w, b = np.array([0.3, -0.2, 0.9]), 0.4
    dw, db = compute_gradient(X, y, w, b, lambda_)
    ndw, ndb = numeric_gradient(X, y, w, b, lambda_)
    assert np.max(np.abs(dw - ndw)) < 1e-5
    assert abs(db - ndb) < 1e-5


def test_loop_versions_match_vectorized():
    X, y = make_data(m=15)
    w, b = np.array([0.3, -0.2, 0.9]), 0.4
    np.testing.assert_allclose(model.predict_proba_loop(X, w, b), predict_proba(X, w, b))
    assert model.compute_cost_loop(X, y, w, b) == pytest.approx(compute_cost(X, y, w, b))
    dw, db = model.compute_gradient_loop(X, y, w, b)
    vdw, vdb = compute_gradient(X, y, w, b)
    np.testing.assert_allclose(dw, vdw)
    assert db == pytest.approx(vdb)
    assert model.compute_cost_reg(X, y, w, b, 0.8) == pytest.approx(compute_cost(X, y, w, b, 0.8))
    dw, db = model.compute_gradient_reg(X, y, w, b, 0.8)
    vdw, vdb = compute_gradient(X, y, w, b, 0.8)
    np.testing.assert_allclose(dw, vdw)
    assert db == pytest.approx(vdb)


def test_loop_cost_is_finite_at_zero_and_one_too():
    X = np.array([[1.0], [-1.0]])
    w = np.array([1000.0])
    loop = model.compute_cost_loop(X, np.array([0.0, 1.0]), w, 0.0)
    assert loop == pytest.approx(compute_cost(X, np.array([0.0, 1.0]), w, 0.0))


# ---------------------------------------------------------------- gradient descent

def test_cost_falls_at_small_alpha():
    X, y = make_data()
    _, _, hist = gradient_descent(X, y, np.zeros(3), 0.0, 0.1, 300)
    assert len(hist) == 300
    assert hist[-1] < hist[0] < np.log(2)
    assert all(b <= a + 1e-12 for a, b in zip(hist, hist[1:]))


def test_penalty_shrinks_weights():
    X, y = make_data()
    w_free, _, _ = gradient_descent(X, y, np.zeros(3), 0.0, 0.5, 2000, 0.0)
    w_reg, _, _ = gradient_descent(X, y, np.zeros(3), 0.0, 0.5, 2000, 100.0)
    assert np.linalg.norm(w_reg) < np.linalg.norm(w_free)


def test_simultaneous_update_single_step():
    X, y = make_data(m=40)
    w, b = np.array([0.1, 0.2, 0.3]), 0.5
    dw, db = compute_gradient(X, y, w, b, 0.2)
    w1, b1, hist = gradient_descent(X, y, w, b, 0.05, 1, 0.2)
    np.testing.assert_allclose(w1, w - 0.05 * dw)
    assert b1 == pytest.approx(b - 0.05 * db)
    assert hist == [pytest.approx(compute_cost(X, y, w1, b1, 0.2))]


def test_two_runs_identical():
    X, y = make_data()
    a = gradient_descent(X, y, np.zeros(3), 0.0, 0.5, 200, 0.3)
    c = gradient_descent(X, y, np.zeros(3), 0.0, 0.5, 200, 0.3)
    assert np.array_equal(a[0], c[0]) and a[1] == c[1] and a[2] == c[2]


def test_inputs_never_mutated():
    X, y = make_data(m=40)
    w, b = np.array([0.1, 0.2, 0.3]), 0.5
    X0, y0, w0 = X.copy(), y.copy(), w.copy()
    w_out, _, _ = gradient_descent(X, y, w, b, 0.05, 20, 0.3)
    assert np.array_equal(X, X0) and np.array_equal(y, y0) and np.array_equal(w, w0)
    assert w_out is not w


def test_divergence_stops_early_with_finite_history_and_no_warning():
    # With a penalty, a huge alpha blows w up until sum(w^2) overflows and the cost is not finite.
    X, y = make_data(m=40)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        w, b, hist = gradient_descent(X, y, np.zeros(3), 0.0, 1e100, 500, 1.0)
    assert 0 < len(hist) < 500
    assert np.all(np.isfinite(hist))
    assert np.all(np.isfinite(w)) and np.isfinite(b)


# ---------------------------------------------------------------- agreement with scikit-learn

# Our cost is J(w, b) = (1/m) sum loss_i + (lambda / 2m) ||w||^2, with b unpenalized.
# scikit-learn's L2 LogisticRegression minimizes C * sum loss_i + (1/2) ||w||^2, also leaving
# the intercept unpenalized (lbfgs). Multiply ours by m: m J = sum loss_i + (lambda / 2) ||w||^2,
# and multiply sklearn's by lambda: lambda C sum loss_i + (lambda / 2) ||w||^2. With C = 1/lambda
# the two are the same function, so they share one minimizer. lambda = 0 is penalty=None.

@pytest.mark.parametrize("lambda_", [0.0, 1.0, 30.0])
def test_matches_sklearn_logistic_regression(lambda_):
    X, y = make_data()
    w, b, hist = gradient_descent(X, y, np.zeros(3), 0.0, 1.0, 20000, lambda_)
    if lambda_ == 0:
        ref = LogisticRegression(penalty=None, tol=1e-12, max_iter=10000)
    else:
        ref = LogisticRegression(C=1 / lambda_, tol=1e-12, max_iter=10000)
    ref.fit(X, y)
    np.testing.assert_allclose(w, ref.coef_[0], atol=1e-6)
    assert abs(b - ref.intercept_[0]) < 1e-6
    assert compute_cost(X, y, w, b, lambda_) <= compute_cost(X, y, ref.coef_[0], ref.intercept_[0], lambda_) + 1e-10


def test_descent_stops_on_overflowing_parameters_even_without_a_penalty():
    X, y = make_data(m=60, n=2)
    # the logistic cost stays finite here (log arguments are clipped), so only the explicit
    # parameter check can stop the run
    w, b, hist = gradient_descent(X, y, np.array([1e200, 0.0]), 0.0, 0.1, 5, 0.0)
    assert hist == []
    assert np.isfinite(w).all() and np.isfinite(b)
    w, b, hist = gradient_descent(X, y, np.zeros(2), 0.0, 1e308, 50, 0.0)
    assert len(hist) < 50 and all(np.isfinite(hist))
    assert np.isfinite(w).all() and np.isfinite(b)


# ---------------------------------------------------------------- lab markers

def test_lab_markers_are_balanced_and_named():
    src = Path(model.__file__).read_text(encoding="utf-8").splitlines()
    names, open_name = [], None
    for line in src:
        s = line.strip()
        m = re.fullmatch(r"# lab:(\w+)", s)
        if m:
            assert open_name is None, "nested lab block"
            open_name = m.group(1)
            names.append(open_name)
        elif s == "# endlab":
            assert open_name is not None, "endlab without lab"
            open_name = None
    assert open_name is None, "unterminated lab block"
    assert sorted(names) == sorted(LAB_NAMES)
