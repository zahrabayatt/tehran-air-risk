"""Logistic regression with gradient descent, written with NumPy only.

Model:        f(x) = g(w . x + b),   g(z) = 1 / (1 + e^(-z))   (the sigmoid)
Loss:         -y log f - (1 - y) log(1 - f)
Cost:         J = -1/m * sum(y_i log f_i + (1 - y_i) log(1 - f_i))  +  lambda/(2m) * sum(w_j^2)
Gradient:     dJ/dw = 1/m * X^T e + lambda/m * w,   dJ/db = mean(e),   e = f(X) - y

The bias b is never penalized. Shapes: X is (m, n), y is (m,) of 0s and 1s, w is (n,), b is
a scalar. Probabilities are never clipped; only the cost clips the argument of each log at
1e-15, so a probability of exactly 0 or 1 gives a large but finite cost. The vectorized
functions are the production code. The blocks between `# lab:<name>` and `# endlab` are what
the Lab page shows line by line: plain loop versions for teaching, the vectorized versions
beside them, and the descent loop itself.
"""
from __future__ import annotations

import numpy as np

EPS = 1e-15   # smallest value allowed inside a log in the cost


# lab:sigmoid
def sigmoid(z):
    """g(z) = 1 / (1 + e^(-z)), computed so that no exponent is ever positive.

    For z >= 0 it is 1 / (1 + e^(-z)); for z < 0 the same value is e^z / (1 + e^z).
    Both use e^(-|z|), which lies in (0, 1], so z = -1000 or 1000 cannot overflow.
    """
    z = np.asarray(z, dtype=float)
    e = np.exp(-np.abs(z))
    g = np.where(z >= 0, 1 / (1 + e), e / (1 + e))
    return g if g.ndim else float(g)
# endlab


# lab:predict_proba_loop
def predict_proba_loop(X, w, b):
    m, n = X.shape
    p = np.zeros(m)
    for i in range(m):
        z_i = b
        for j in range(n):
            z_i += X[i, j] * w[j]
        p[i] = sigmoid(z_i)
    return p
# endlab


# lab:predict_proba
def predict_proba(X, w, b) -> np.ndarray:
    """Probability that y = 1 for every row of X."""
    return sigmoid(np.asarray(X, dtype=float) @ np.asarray(w, dtype=float) + b)
# endlab


# lab:compute_cost_loop
def compute_cost_loop(X, y, w, b):
    m, n = X.shape
    total = 0.0
    for i in range(m):
        z_i = b
        for j in range(n):
            z_i += X[i, j] * w[j]
        f_i = sigmoid(z_i)
        total += -y[i] * np.log(max(f_i, EPS)) - (1 - y[i]) * np.log(max(1 - f_i, EPS))
    return total / m
# endlab


# lab:compute_cost
def logistic_cost(f, y) -> float:
    """Mean logistic loss of probabilities f against labels y, with no penalty."""
    f = np.asarray(f, dtype=float)
    y = np.asarray(y, dtype=float)
    return float(-np.mean(y * np.log(np.maximum(f, EPS))
                          + (1 - y) * np.log(np.maximum(1 - f, EPS))))


def compute_cost(X, y, w, b, lambda_: float = 0.0) -> float:
    """Logistic cost, with an optional squared penalty on w (not on b)."""
    w = np.asarray(w, dtype=float)
    m = np.asarray(X).shape[0]
    return logistic_cost(predict_proba(X, w, b), y) + lambda_ / (2 * m) * float(w @ w)
# endlab


# lab:compute_gradient_loop
def compute_gradient_loop(X, y, w, b):
    m, n = X.shape
    dj_dw = np.zeros(n)
    dj_db = 0.0
    for i in range(m):
        z_i = b
        for j in range(n):
            z_i += X[i, j] * w[j]
        err = sigmoid(z_i) - y[i]
        for j in range(n):
            dj_dw[j] += err * X[i, j]
        dj_db += err
    return dj_dw / m, dj_db / m
# endlab


# lab:compute_gradient
def compute_gradient(X, y, w, b, lambda_: float = 0.0) -> tuple[np.ndarray, float]:
    """Gradient of compute_cost with respect to w and b."""
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    w = np.asarray(w, dtype=float)
    m = X.shape[0]
    e = predict_proba(X, w, b) - y
    dj_dw = X.T @ e / m + lambda_ / m * w
    dj_db = float(np.mean(e))
    return dj_dw, dj_db
# endlab


# lab:compute_cost_reg
def compute_cost_reg(X, y, w, b, lambda_):
    m, n = X.shape
    cost = compute_cost_loop(X, y, w, b)
    penalty = 0.0
    for j in range(n):
        penalty += w[j] ** 2
    return cost + lambda_ / (2 * m) * penalty
# endlab


# lab:compute_gradient_reg
def compute_gradient_reg(X, y, w, b, lambda_):
    m, n = X.shape
    dj_dw, dj_db = compute_gradient_loop(X, y, w, b)
    for j in range(n):
        dj_dw[j] += lambda_ / m * w[j]
    return dj_dw, dj_db
# endlab


# lab:gradient_descent
def gradient_descent(X, y, w, b, alpha, num_iters, lambda_=0.0):
    """Batch gradient descent. Returns (w, b, J_history).

    J_history[i] is the cost after update i + 1. If an update makes any weight or
    the bias not finite, or makes the sum of squared weights overflow, or makes
    the cost not finite (alpha too large), descent stops at once: the result is
    the last finite (w, b), and J_history holds only finite costs, so
    len(J_history) < num_iters means it diverged on update len(J_history) + 1.
    The parameter check is explicit because the logistic cost itself stays
    finite when probabilities hit 0 or 1 (log arguments are clipped), so without
    it only the lambda * sum(w ** 2) term would notice. The inputs are never modified.
    """
    w = np.array(w, dtype=float)
    b = float(b)
    J_history = []
    with np.errstate(all="ignore"):
        for _ in range(num_iters):
            dj_dw, dj_db = compute_gradient(X, y, w, b, lambda_)
            w_new = w - alpha * dj_dw
            b_new = b - alpha * dj_db
            if not (np.all(np.isfinite(w_new)) and np.isfinite(b_new) and np.isfinite(w_new @ w_new)):
                break
            cost = compute_cost(X, y, w_new, b_new, lambda_)
            if not np.isfinite(cost):
                break
            w, b = w_new, b_new
            J_history.append(cost)
    return w, b, J_history
# endlab
