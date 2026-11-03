"""Write Lab engine fixtures: what training/model.py computes on the site's sample.

The Lab page runs gradient descent in the browser (web/src/lab/engine.ts). This script runs the
same experiments through training/model.py and training/experiments.py on
web/public/data/sample.json and the frozen model.json, and writes web/src/lab/fixtures.json. The
web tests replay each experiment in TypeScript and compare within 1e-9 relative.
Rerun it whenever sample.json or model.json changes.

    python -m training.export_lab_fixtures

State indexing. A run of `iters` updates has iters + 1 states, 0 to iters. State k is the point
after k updates, so state 0 is the starting point. jHistory[k - 1] is the cost of state k
(model.gradient_descent's J_history), and a checkpoint holds the exact point and gradient of
state k. `divergedAt` is the first state whose cost is not finite (Python stops there), or None.
The browser stops there too and keeps only the states before it.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from training.experiments import (  # noqa: E402
    fit_linear, linear_crossing, logistic_loss, poly_features, season_features, squared_error_cost)
from training.features import zscore_apply, zscore_fit  # noqa: E402
from training.model import (  # noqa: E402
    compute_cost, compute_cost_loop, compute_gradient, compute_gradient_loop, gradient_descent,
    predict_proba, sigmoid)

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_PATH = ROOT / "web" / "public" / "data" / "sample.json"
MODEL_PATH = ROOT / "model" / "model.json"
FIXTURES_PATH = ROOT / "web" / "src" / "lab" / "fixtures.json"
MODEL_FEATURES = ["pm2_5_mean", "pm2_5_max", "pm2_5_last", "season_sin", "season_cos"]

# (name, w0, b0, alpha, iters). One feature: x = pm2_5_mean / 10, the x of the early steps.
RUN_ONE = [
    ("slow", 0.0, 0.0, 0.01, 300),
    ("start-away", 3.0, -8.0, 0.1, 200),
    ("good", 0.0, 0.0, 0.3, 400),
    ("bounces", 0.0, 0.0, 3.0, 60),
    ("diverges", 0.0, 0.0, 1e308, 40),
]
# (name, scaled, alpha, lambda, iters). The five features of the live model, starting from zero.
RUN_MULTI = [
    ("scaled", True, 0.5, 0.0, 300),
    ("scaled-penalty", True, 0.5, 100.0, 300),
    ("scaled-small-alpha", True, 0.02, 0.0, 200),
    ("raw", False, 0.0005, 0.0, 200),
]
# (name, lambda, iters). Degree 3 in the z-scored PM2.5 mean and season_cos, 46 evenly spaced sample
# days, with the step size experiments.fit_polynomial uses: 1 / (2.5 + lambda / m).
POLY = [
    ("light-penalty", 0.01, 600),
    ("heavy-penalty", 1000.0, 600),
]
POLY_DAYS = list(range(4, 365, 8))
SIGMOID_Z = [-800.0, -40.0, -5.0, -1.0, 0.0, 0.3, 2.0, 17.0, 800.0]
LOSS_PAIRS = [(0.95, 1), (0.05, 1), (0.5, 0), (0.999999, 0), (1.0, 0), (0.0, 1), (0.3, 1), (0.3, 0)]
DAYS = [1, 15, 100, 180, 300, 365]


def diverged_at(j0: float, history: list[float], iters: int) -> int | None:
    states = [j0] + list(history)
    for i, c in enumerate(states):
        if not math.isfinite(c):
            return i
    return len(states) if len(history) < iters else None


def checkpoint_ks(iters: int, limit: int | None) -> list[int]:
    ks = sorted({0, 1, 2, 10, iters // 2, iters})
    return [k for k in ks if k <= iters and (limit is None or k < limit)]


def descend(X, y, w0, b0, alpha, iters, lam=0.0) -> dict:
    """The model.py descent, summarized as the fixtures need it."""
    w0 = np.asarray(w0, dtype=float)
    _, _, history = gradient_descent(X, y, w0, b0, alpha, iters, lam)
    j0 = compute_cost(X, y, w0, b0, lam)
    at = diverged_at(j0, history, iters)
    checkpoints = []
    for k in checkpoint_ks(iters, at):
        w, b, _ = gradient_descent(X, y, w0, b0, alpha, k, lam)
        gw, gb = compute_gradient(X, y, w, b, lam)
        checkpoints.append({"k": k, "w": [float(v) for v in w], "b": float(b),
                            "j": float(compute_cost(X, y, w, b, lam)),
                            "gw": [float(v) for v in gw], "gb": float(gb)})
    return {"alpha": alpha, "lambda": lam, "iters": iters, "divergedAt": at,
            "jHistory": [float(c) for c in history], "j0": float(j0), "checkpoints": checkpoints}


def load_arrays(sample: dict) -> dict:
    rows = sample["rows"]
    X5 = np.array([[r[c] for c in MODEL_FEATURES] for r in rows], dtype=float)
    y = np.array([r["y"] for r in rows], dtype=float)
    return {"rows": rows, "X5": X5, "y": y, "pm": X5[:, 0],
            "x": X5[:, [0]] / 10.0, "cos": X5[:, 4]}


def run_one_case(a, name, w0, b0, alpha, iters) -> dict:
    case = descend(a["x"], a["y"], [w0], b0, alpha, iters)
    for c in case["checkpoints"]:  # one feature: w and gw are single numbers
        c["w"], c["gw"] = c["w"][0], c["gw"][0]
    return {"name": name, "w0": w0, "b0": b0, **case}


def run_multi_case(a, Z5, name, scaled, alpha, lam, iters) -> dict:
    X = Z5 if scaled else a["X5"]
    case = descend(X, a["y"], np.zeros(X.shape[1]), 0.0, alpha, iters, lam)
    return {"name": name, "scaled": scaled, **case}


def poly_case(a, name, lam, iters) -> dict:
    zpm = zscore_apply(a["pm"][:, None], *zscore_fit(a["pm"][:, None]))[:, 0][POLY_DAYS]
    zcos = zscore_apply(a["cos"][:, None], *zscore_fit(a["cos"][:, None]))[:, 0][POLY_DAYS]
    y = a["y"][POLY_DAYS]
    X = poly_features(zpm, zcos)
    mu, sigma = zscore_fit(X)
    Z = zscore_apply(X, mu, sigma)
    alpha = 1 / (2.5 + lam / len(y))
    w, b, history = gradient_descent(Z, y, np.zeros(Z.shape[1]), 0.0, alpha, iters, lam)
    return {"name": name, "lambda": lam, "alpha": alpha, "iters": iters,
            "mu": [float(v) for v in mu], "sigma": [float(v) for v in sigma],
            "w": [float(v) for v in w], "b": float(b),
            "jHistory": [float(c) for c in history],
            "plainCost": float(compute_cost(Z, y, w, b, 0.0)),
            "first": [[float(v) for v in r] for r in Z[:3]]}


def point_checks(a) -> list[dict]:
    """Cost and gradient at fixed points: vectorized, loop versions, and the squared-error cost."""
    out = []
    for w, b in [(0.0, 0.0), (1.27, -4.67), (-1.0, 2.0), (4.0, -10.0), (60.0, -300.0)]:
        wv = np.array([w])
        g = compute_gradient(a["x"], a["y"], wv, b)
        gl = compute_gradient_loop(a["x"], a["y"], wv, b)
        out.append({"w": w, "b": b,
                    "cost": float(compute_cost(a["x"], a["y"], wv, b)),
                    "costLoop": float(compute_cost_loop(a["x"], a["y"], wv, b)),
                    "squared": float(squared_error_cost(a["x"], a["y"], wv, b)),
                    "gw": float(g[0][0]), "gb": float(g[1]),
                    "gwLoop": float(gl[0][0]), "gbLoop": float(gl[1])})
    return out


def build_fixtures(sample: dict, model: dict) -> dict:
    a = load_arrays(sample)
    mu, sigma = zscore_fit(a["X5"])
    Z5 = zscore_apply(a["X5"], mu, sigma)
    w, b = fit_linear(a["x"][:, 0], a["y"])
    frozen_mu, frozen_sigma = np.array(model["scaling"]["mu"]), np.array(model["scaling"]["sigma"])
    frozen_z = zscore_apply(a["X5"], frozen_mu, frozen_sigma)
    frozen_p = predict_proba(frozen_z, np.array(model["weights"]), model["bias"])
    return {
        "rows": len(a["y"]),
        "sigmoid": [{"z": z, "g": float(sigmoid(z))} for z in SIGMOID_Z],
        "loss": [{"f": f, "y": y, "loss": float(logistic_loss(f, y))} for f, y in LOSS_PAIRS],
        "zscore": {"columns": MODEL_FEATURES, "mu": [float(v) for v in mu],
                   "sigma": [float(v) for v in sigma],
                   "first": [[float(v) for v in r] for r in Z5[:5]]},
        "points": point_checks(a),
        "linear": {"w": float(w), "b": float(b), "crossing": float(linear_crossing(w, b))},
        "runOne": [run_one_case(a, *c) for c in RUN_ONE],
        "runMulti": [run_multi_case(a, Z5, *c) for c in RUN_MULTI],
        "poly": [poly_case(a, *c) for c in POLY],
        "season": [{"day": d, "sin": float(season_features(d)[0]), "cos": float(season_features(d)[1])}
                   for d in DAYS],
        "frozen": {"first": [float(v) for v in frozen_p[:5]],
                   "cost": float(compute_cost(frozen_z, a["y"], np.array(model["weights"]),
                                              model["bias"], 0.0)),
                   "z0": [float(v) for v in frozen_z[0]]},
    }


def main() -> None:
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    fx = build_fixtures(sample, model)
    FIXTURES_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES_PATH.write_text(json.dumps(fx, indent=1, allow_nan=False) + "\n",
                             encoding="utf-8", newline="\n")
    print(f"wrote {len(fx['runOne'])} runOne, {len(fx['runMulti'])} runMulti, "
          f"{len(fx['poly'])} poly cases to {FIXTURES_PATH}")


if __name__ == "__main__":
    main()
