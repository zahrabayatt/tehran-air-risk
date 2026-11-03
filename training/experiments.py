"""Teaching code for the Model Lab, one small function per idea.

Each block between `# lab:<name>` and `# endlab` is shown on the Lab page line by line, so it is
plain on purpose. The production code is training/model.py (vectorized), training/features.py and
training/train.py; the Lab also shows blocks from those files. Every function here is run by
tests/test_experiments.py and checked against that code.
"""
from __future__ import annotations

import numpy as np

from training.features import zscore_apply, zscore_fit
from training.model import (EPS, compute_cost_loop, compute_gradient_loop, gradient_descent,
                            predict_proba)


# lab:fit_linear
def fit_linear(x, y):
    x_mean, y_mean = x.mean(), y.mean()
    w = ((x - x_mean) * (y - y_mean)).mean() / ((x - x_mean) ** 2).mean()
    b = y_mean - w * x_mean
    return w, b


def linear_crossing(w, b):
    return (0.5 - b) / w
# endlab


# lab:boundary_x2
def boundary_x2(x1, w, b):
    return -(w[0] * x1 + b) / w[1]
# endlab


# lab:squared_error_cost
def squared_error_cost(X, y, w, b):
    f = predict_proba(X, w, b)
    return ((f - y) ** 2).mean() / 2
# endlab


# lab:logistic_loss
def logistic_loss(f, y):
    return -y * np.log(max(f, EPS)) - (1 - y) * np.log(max(1 - f, EPS))
# endlab


# lab:descent
def descent(X, y, w, b, alpha, num_iters):
    J_history = []
    for _ in range(num_iters):
        dj_dw, dj_db = compute_gradient_loop(X, y, w, b)
        w = w - alpha * dj_dw
        b = b - alpha * dj_db
        J_history.append(compute_cost_loop(X, y, w, b))
    return w, b, J_history
# endlab


# lab:gradient_matrix
def gradient_matrix(X, y, w, b):
    m = X.shape[0]
    err = predict_proba(X, w, b) - y
    dj_dw = X.T @ err / m
    dj_db = err.mean()
    return dj_dw, dj_db
# endlab


# lab:lr_race
def race_learning_rates(X, y, alphas, num_iters=300):
    histories = {}
    for alpha in alphas:
        w0, b0 = np.zeros(X.shape[1]), 0.0
        w, b, J_history = gradient_descent(X, y, w0, b0, alpha, num_iters)
        histories[alpha] = J_history
    return histories
# endlab


# lab:season_features
def season_features(day_of_year):
    angle = 2 * np.pi * day_of_year / 365.25
    return np.sin(angle), np.cos(angle)
# endlab


# lab:poly_features
def poly_features(x1, x2):
    return np.column_stack([x1, x2, x1 ** 2, x1 * x2, x2 ** 2,
                            x1 ** 3, x1 ** 2 * x2, x1 * x2 ** 2, x2 ** 3])
# endlab


# lab:fit_polynomial
def fit_polynomial(x1, x2, y, lambda_, num_iters=2000):
    X = poly_features(x1, x2)
    mu, sigma = zscore_fit(X)
    Z = zscore_apply(X, mu, sigma)
    alpha = 1 / (2.5 + lambda_ / len(y))
    w, b, J_history = gradient_descent(Z, y, np.zeros(Z.shape[1]), 0.0, alpha, num_iters, lambda_)
    return w, b, mu, sigma
# endlab
