"""The real training run and everything the site reads.

Run with `python -m training.train` (needs data/raw/hourly.csv.gz from pipeline.fetch).
Order of work, which is the point of this file:

1. Fit every candidate (feature set + lambda) on training rows, with scaling fitted on
   training rows, and compare them by plain logistic cost on the selection months.
   `select_candidate` is never handed held-out rows.
2. Train the winner once more, timed with time.perf_counter.
3. Only then evaluate on the held-out year, once: the model, the two baselines (whose
   rates come from training rows only) and scikit-learn for comparison. None of these
   results feeds back into any choice.

Costs are always compared without the lambda penalty, so a large lambda is judged on its
predictions alone. The penalized cost is only what descent minimizes (cost_history).
"""
from __future__ import annotations

import math
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from training.features import FEATURES, split_by_time, zscore_apply, zscore_fit
from training.labels import THRESHOLD
from training.model import compute_cost, gradient_descent, logistic_cost, predict_proba

ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "data" / "raw" / "hourly.csv.gz"
MODEL_PATH = ROOT / "model" / "model.json"
DATA_DIR = ROOT / "web" / "public" / "data"

SEED = 42
CUTOFF_TEXT = "12:00 Asia/Tehran"
DECISION_THRESHOLD = 0.5

# Two feature sets only: the selection months are one warm half-year with few positives,
# so every extra choice is mostly fitted to noise.
FEATURE_SETS = {
    "pm_season": ["pm2_5_mean", "pm2_5_max", "pm2_5_last", "season_sin", "season_cos"],
    "all": list(FEATURES),
}
# Penalty scale: lambda/m is the shrink per unit and m is about 11,400 training rows, so
# lambda below 10 would change nothing visible. 10,000 shrinks the weights hard.
LAMBDAS = (0.0, 10.0, 100.0, 1000.0, 10000.0)
# Smaller feature set and smaller lambda first, so a tie goes to the simpler candidate.
CANDIDATES = tuple((name, lam) for name in FEATURE_SETS for lam in LAMBDAS)

# On z-scored training features the largest eigenvalue of X'X/m (with the bias column) is
# 5.4 for "all", so the logistic cost's curvature is at most 5.4 / 4 + lambda/m, about 2.2
# at lambda 10,000; descent is stable for alpha below 2 / 2.2 = 0.9. At alpha 0.5 every
# candidate's cost changes by less than one part in ten million over its last 100 updates
# after 10,000 updates (checked and stored per candidate as relative_change).
ALPHA = 0.5
ITERATIONS = 10000
CONVERGED_RELATIVE = 1e-7
CONVERGENCE_WINDOW = 100

HISTORY_POINTS = 120
PROBABILITY_BINS = [i / 10 for i in range(11)]


# --- fitting ------------------------------------------------------------------

def _matrix(df: pd.DataFrame, features) -> np.ndarray:
    return df[list(features)].to_numpy(dtype=float)


def fit_candidate(train: pd.DataFrame, features, lambda_: float, alpha: float,
                  iterations: int) -> dict:
    """Train on training rows. Scaling never sees any other row."""
    features = list(features)
    X = _matrix(train, features)
    mu, sigma = zscore_fit(X)
    Z = zscore_apply(X, mu, sigma)
    y = train["y"].to_numpy(dtype=float)
    w, b, history = gradient_descent(Z, y, np.zeros(Z.shape[1]), 0.0, alpha, iterations, lambda_)
    return {"features": features, "lambda": lambda_, "mu": mu, "sigma": sigma, "w": w, "b": b,
            "history": history, "diverged": len(history) < iterations}


def predict_fit(fit: dict, df: pd.DataFrame) -> np.ndarray:
    Z = zscore_apply(_matrix(df, fit["features"]), fit["mu"], fit["sigma"])
    return predict_proba(Z, fit["w"], fit["b"])


def plain_cost(fit: dict, df: pd.DataFrame) -> float:
    """Cost with no penalty, so candidates compare on predictions alone."""
    Z = zscore_apply(_matrix(df, fit["features"]), fit["mu"], fit["sigma"])
    return compute_cost(Z, df["y"].to_numpy(dtype=float), fit["w"], fit["b"], 0.0)


def relative_change(history: list[float], window: int = CONVERGENCE_WINDOW) -> float | None:
    """|J(end - window) - J(end)| / |J(end)|, or None if the run is too short."""
    if len(history) <= window:
        return None
    return abs(history[-window - 1] - history[-1]) / abs(history[-1])


def select_candidate(train: pd.DataFrame, selection: pd.DataFrame, candidates,
                     alpha: float, iterations: int):
    """Fit all candidates on training rows and compare on the selection months.

    Returns (records, best_index). A diverged candidate gets no cost and cannot win.
    best_index is None when all diverged. Ties go to the earlier candidate.
    """
    records, best, best_cost = [], None, math.inf
    for i, (name, lambda_) in enumerate(candidates):
        fit = fit_candidate(train, FEATURE_SETS[name], lambda_, alpha, iterations)
        change = relative_change(fit["history"])
        rec = {"feature_set": name, "features": list(FEATURE_SETS[name]), "lambda": lambda_,
               "diverged": fit["diverged"], "relative_change": change,
               "converged": change is not None and change <= CONVERGED_RELATIVE,
               "train_cost": None, "selection_cost": None, "chosen": False}
        if not fit["diverged"]:
            rec["train_cost"] = plain_cost(fit, train)
            rec["selection_cost"] = plain_cost(fit, selection)
            if rec["selection_cost"] < best_cost:
                best, best_cost = i, rec["selection_cost"]
        records.append(rec)
    if best is not None:
        records[best]["chosen"] = True
    return records, best


# --- baselines ----------------------------------------------------------------

def _months(df: pd.DataFrame) -> np.ndarray:
    return pd.to_datetime(df["target_date"]).dt.month.to_numpy()


# lab:baselines
def fit_baselines(train: pd.DataFrame) -> dict:
    """Two simple guesses, from training rows only.

    overall: the training share of y = 1. monthly: that share within each calendar month
    of the target date; a month with no training rows uses the overall share instead.
    """
    y = train["y"].to_numpy(dtype=float)
    months = _months(train)
    overall = float(y.mean())
    rates, fallback = [], []
    for month in range(1, 13):
        in_month = y[months == month]
        if len(in_month):
            rates.append(float(in_month.mean()))
        else:
            rates.append(overall)
            fallback.append(month)
    return {"overall": {"rate": overall},
            "monthly": {"rates": rates, "fallback_months": fallback}}


def baseline_costs(baselines: dict, df: pd.DataFrame) -> dict:
    """Plain logistic cost of each baseline's constant probabilities on df."""
    y = df["y"].to_numpy(dtype=float)
    monthly = np.array(baselines["monthly"]["rates"])[_months(df) - 1]
    return {"overall": logistic_cost(np.full(len(y), baselines["overall"]["rate"]), y),
            "monthly": logistic_cost(monthly, y)}
# endlab


# --- held-out views and comparisons --------------------------------------------

def probability_bins(p, y, edges=PROBABILITY_BINS) -> dict:
    """Counts of held-out probabilities in ten bins, split by the true label.

    Bins are [0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]; the last includes 1.
    """
    p, y = np.asarray(p, dtype=float), np.asarray(y)
    return {"bins": list(edges),
            "counts_y1": np.histogram(p[y == 1], bins=edges)[0].astype(int).tolist(),
            "counts_y0": np.histogram(p[y == 0], bins=edges)[0].astype(int).tolist()}


def sklearn_comparison(fit: dict, train: pd.DataFrame, held: pd.DataFrame) -> dict:
    """Same features, scaling and penalty under scikit-learn. For comparison only.

    Our J = (1/m) sum loss + (lambda/2m) ||w||^2; sklearn minimizes C sum loss + (1/2) ||w||^2.
    m J = sum loss + (lambda/2) ||w||^2 equals lambda times sklearn's objective when
    C = 1/lambda, so both have the same minimizer. lambda = 0 is penalty=None.
    """
    from sklearn.linear_model import LogisticRegression

    def matrix(df):
        return zscore_apply(_matrix(df, fit["features"]), fit["mu"], fit["sigma"])

    lam = fit["lambda"]
    if lam > 0:
        est = LogisticRegression(C=1.0 / lam, tol=1e-10, max_iter=10000)
    else:
        est = LogisticRegression(penalty=None, tol=1e-10, max_iter=10000)
    est.fit(matrix(train), train["y"].to_numpy(dtype=int))
    w, b = est.coef_[0], float(est.intercept_[0])
    return {"held_out": compute_cost(matrix(held), held["y"].to_numpy(dtype=float), w, b, 0.0),
            "train": compute_cost(matrix(train), train["y"].to_numpy(dtype=float), w, b, 0.0),
            "C": (1.0 / lam) if lam > 0 else None,
            "max_abs_weight_difference": float(np.max(np.abs(w - fit["w"]))),
            "bias_difference": abs(b - fit["b"])}


def _downsample(history: list[float]) -> tuple[list[int], list[float]]:
    """Update numbers spaced evenly on a log scale, where the curve actually moves."""
    n = len(history)
    points = np.unique(np.round(np.geomspace(1, n, HISTORY_POINTS)).astype(int))
    return points.tolist(), [history[i - 1] for i in points]


def _dates(df: pd.DataFrame) -> dict:
    return {"start": str(min(df["target_date"])), "end": str(max(df["target_date"]))}


def predict_from_model(model: dict, df: pd.DataFrame) -> np.ndarray:
    """Probabilities from the exported JSON alone, the way the browser will compute them."""
    Z = zscore_apply(_matrix(df, model["features"]), np.array(model["scaling"]["mu"]),
                     np.array(model["scaling"]["sigma"]))
    return predict_proba(Z, np.array(model["weights"]), model["bias"])


# lab:time_dot
def time_dot(n: int = 1_000_000, seed: int = SEED) -> dict:
    """One dot product of n elements, as a Python loop and as np.dot."""
    rng = np.random.default_rng(seed)
    a, b = rng.random(n).tolist(), rng.random(n).tolist()
    start = time.perf_counter()
    total = 0.0
    for i in range(n):
        total += a[i] * b[i]
    loop_ms = (time.perf_counter() - start) * 1000
    va, vb = np.array(a), np.array(b)
    start = time.perf_counter()
    np.dot(va, vb)
    numpy_ms = (time.perf_counter() - start) * 1000
    return {"elements": n, "loop_ms": loop_ms, "numpy_ms": numpy_ms}
# endlab


# --- the run ------------------------------------------------------------------

def train_model(df: pd.DataFrame, candidates=CANDIDATES, alpha: float = ALPHA,
                iterations: int = ITERATIONS) -> dict:
    """Pick by selection cost, retrain the winner timed, then look at held-out once."""
    train, selection, held = split_by_time(df)

    records, best = select_candidate(train, selection, candidates, alpha, iterations)
    if best is None:
        raise ValueError("every candidate diverged; lower alpha")
    name, lambda_ = candidates[best]
    baselines = fit_baselines(train)                  # training rows only

    start = time.perf_counter()
    final = fit_candidate(train, FEATURE_SETS[name], lambda_, alpha, iterations)
    runtime_ms = (time.perf_counter() - start) * 1000
    change = relative_change(final["history"])

    # Everything is fixed now. The single look at held-out rows:
    held_p = predict_fit(final, held)
    held_cost = plain_cost(final, held)
    base_costs = baseline_costs(baselines, held)
    baselines["overall"]["held_out_cost"] = base_costs["overall"]
    baselines["monthly"]["held_out_cost"] = base_costs["monthly"]

    its, hist = _downsample(final["history"])
    model = {
        "version": 1,
        "feature_set": name,
        "features": final["features"],
        "weights": final["w"].tolist(),
        "bias": final["b"],
        "scaling": {"mu": final["mu"].tolist(), "sigma": final["sigma"].tolist()},
        "hyperparameters": {"alpha": alpha, "lambda": lambda_, "iterations": iterations},
        "threshold": THRESHOLD,
        "decision_threshold": DECISION_THRESHOLD,
        "cutoff": CUTOFF_TEXT,
        "cost": {"train": plain_cost(final, train),
                 "selection": plain_cost(final, selection),
                 "held_out": held_cost},
        "baselines": baselines,
        "beats_baselines": bool(held_cost < base_costs["overall"] and held_cost < base_costs["monthly"]),
        "sklearn_cost": sklearn_comparison(final, train, held),
        "held_out_probabilities": probability_bins(held_p, held["y"].to_numpy()),
        "cost_history": hist,
        "cost_history_iterations": its,
        "convergence": {"rule": f"relative cost change over the last {CONVERGENCE_WINDOW} updates",
                        "limit": CONVERGED_RELATIVE, "relative_change": change,
                        "converged": change is not None and change <= CONVERGED_RELATIVE},
        "rows": {"train": len(train), "selection": len(selection), "held_out": len(held)},
        "date_range": {**_dates(df), "train": _dates(train), "selection": _dates(selection),
                       "held_out": _dates(held)},
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "runtime_ms": runtime_ms,
        "environment": {"python": platform.python_version(), "numpy": np.__version__,
                        "os": platform.platform()},
        "candidates": records,
    }
    return {"model": model, "train": train, "selection": selection, "held_out": held,
            "held_p": held_p}


def main() -> int:
    from pipeline.fetch import read_hourly
    from training.export_data import (build_history, build_profile, build_sample,
                                      write_json)
    from training.features import build_dataset, labelled_windows
    from training.labels import daily_labels

    hourly = read_hourly(RAW_PATH)
    labels = daily_labels(hourly)
    windows = labelled_windows(hourly, labels)
    df = build_dataset(hourly, labels)

    result = train_model(df)
    model, train = result["model"], result["train"]
    model["vectorization"] = time_dot()
    np.testing.assert_allclose(predict_from_model(model, result["held_out"]), result["held_p"],
                               rtol=1e-12)

    sizes = {
        "model/model.json": write_json(MODEL_PATH, model),
        "sample.json": write_json(DATA_DIR / "sample.json", build_sample(train, labels)),
        "history.json": write_json(DATA_DIR / "history.json", build_history(labels)),
        "profile.json": write_json(DATA_DIR / "profile.json", build_profile(
            hourly, labels, windows, df,
            {"train": train, "selection": result["selection"], "held_out": result["held_out"]})),
    }

    print("candidates (selection cost, plain):")
    for c in model["candidates"]:
        print(f"  {c['feature_set']:<10} lambda {c['lambda']:>7g}  train {c['train_cost']:.6f}  "
              f"selection {c['selection_cost']:.6f}  change {c['relative_change']:.2e}"
              f"{'  <- chosen' if c['chosen'] else ''}")
    print("cost:", model["cost"])
    print("baselines:", {k: v["held_out_cost"] for k, v in model["baselines"].items()},
          "fallback months:", model["baselines"]["monthly"]["fallback_months"])
    print("beats_baselines:", model["beats_baselines"])
    print("sklearn:", model["sklearn_cost"])
    print("runtime_ms:", round(model["runtime_ms"], 1), "vectorization:", model["vectorization"])
    print("sizes:", sizes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
