# Learning Progress and Scope Tracker

This file records which course concepts have been studied and implemented in this project. It is updated only where a concept is really implemented: a visitor can see it, the code exists, and a test checks it.

## Status definitions

- [ ] Not studied / not implemented.
- [~] Currently studying or planning the implementation.
- [x] Studied and implemented.

Do not mark a concept complete just because a placeholder or static explanation exists. The implementation should demonstrate the concept correctly.

Step names below are the steps of the Model Lab on the site. Code paths are relative to the repository root.

## Linear Regression: House Price Estimator

Linear regression lives in the separate `tehran-house-price` project and is tracked in that repository. This project uses a least-squares line in one Lab step only, to show why it is not enough for a yes-or-no target, so no linear regression concept is marked here.

## Logistic Regression: Air Quality Risk Predictor

| Concept | Status | Implementation notes |
|---|---|---|
| Classification | [x] | Lab steps Data, Label and timing, and Why not linear regression? The label (1 when the next Tehran day's mean PM2.5 is above 35.4 μg/m³) is built by `daily_labels` in `training/labels.py` and checked at its edges in `tests/test_labels.py`. The Lab step adds very polluted days to a least-squares line (`fit_linear` in `training/experiments.py`) and shows the crossing point move. |
| Sigmoid function | [x] | Lab step Sigmoid. Code: `sigmoid` in `training/model.py`, `sigmoid` in `web/src/lab/engine.ts`. Checked: g(0) is 0.5, g(-z) is 1 - g(z), no overflow at 1000 or -1000 (`tests/test_model.py`). |
| Logistic regression model | [x] | Lab step Logistic model. Code: `predict_proba` in `training/model.py`; the daily run applies the frozen weights in `pipeline/predict.py`. Five weights and a bias are in `model/model.json`. |
| Decision boundary | [x] | Lab step Decision boundary: the boundary where the score is zero, moved by the weights. Code: `boundary_x2` in `training/experiments.py`; the fixed 0.5 threshold is `DECISION_THRESHOLD` in `training/train.py`. |
| Logistic loss and cost function | [x] | Lab steps Why not squared error?, Logistic loss and Cost function, with both cost surfaces side by side. Code: `logistic_cost`, `compute_cost` in `training/model.py`, `squared_error_cost` in `training/experiments.py`. Checked against hand-computed values and for a finite cost at probabilities of exactly 0 and 1 (`tests/test_model.py`). |
| Gradient descent for logistic regression | [x] | Lab step Gradient descent: run, pause, step, reset, replay. Code: `compute_gradient`, `gradient_descent` in `training/model.py`. Checked: the analytic gradient equals a numeric gradient; one step updates all parameters together; divergence stops early; the result matches scikit-learn within 1.2e-7 per weight. |
| Multiple features | [x] | The deployed model reads five features of fourteen candidates built in `training/features.py` (`FEATURES`), chosen on the selection months. |
| Vectorization | [x] | Lab step Vectorization: loop against NumPy, with the run times measured when the model was trained. Code: the `*_loop` functions in `training/model.py`. Checked: loop and vectorized results match (`test_loop_versions_match_vectorized`). |
| Learning rate | [x] | Lab step Learning rate: several rates side by side. Code: `race_learning_rates` in `training/experiments.py`; training uses `alpha = 0.5` (`ALPHA` in `training/train.py`) and every candidate settles. |
| Feature scaling | [x] | Lab step Feature scaling: z-scores and their effect on training. Code: `zscore_fit`, `zscore_apply` in `training/features.py`. Statistics come from training rows only (`tests/test_leakage.py`); a zero spread does not divide by zero. |
| Feature engineering | [x] | Lab step Feature engineering. The deployed model uses the sine and cosine of the day of year and window summaries of PM2.5 built in `training/features.py`; leakage tests change late values and check that the row does not move. |
| Polynomial features | [x] | Lab sandbox only (steps Feature engineering and Overfitting and regularization): terms up to degree 3 of two features. Code: `poly_features`, `fit_polynomial` in `training/experiments.py`. The deployed model does not use them. |
| Overfitting / underfitting | [x] | Lab step Overfitting and regularization: under, right and over fits on a small sample, and the time split used by the real run (`split_by_time` in `training/features.py`). |
| Regularization | [x] | Lab step Overfitting and regularization: the penalty `lambda` shrinks weights, never the bias. Code: `compute_cost_reg`, `compute_gradient_reg` in `training/model.py`. The deployed model uses `lambda = 100`, chosen on the selection months; the shrinking is tested (`test_penalty_shrinks_weights`). |

### Project steps (not course concepts)

| Step | Status | Implementation notes |
|---|---|---|
| Held-out result against two simple guesses | [x] | Lab step Held-out result and the Forecast page. Code: `fit_baselines`, `baseline_costs` in `training/train.py`. The model's cost is 0.1515 against 0.3077 (overall rate) and 0.2950 (monthly rate). The baselines use training rows only (`tests/test_train.py`). |
| Daily forecast | [x] | Lab step Daily forecast and the Forecast page. Code: `pipeline/predict.py`, `pipeline/fill_outcomes.py`; the schedule is `.github/workflows/daily.yml`. A failed fetch records a gap and invents nothing (`tests/test_pipeline.py`). |

## Not part of the current scope

Out of scope until studied and added on purpose: Accuracy, Precision, Recall, F1-score, Confusion matrix, Decision threshold analysis, ROC-AUC, and named error metrics such as MSE, RMSE and MAE. The only measure of fit is the logistic cost, compared with two simple guesses. The decision threshold on the probability stays at 0.5.

Revisit this list only when these topics are covered in the course.

## In my own words

The author writes these. They are left empty on purpose.

| Concept | In my own words |
|---|---|
| Classification | |
| Sigmoid function | |
| Logistic regression model | |
| Decision boundary | |
| Logistic loss and cost function | |
| Gradient descent for logistic regression | |
| Multiple features | |
| Vectorization | |
| Learning rate | |
| Feature scaling | |
| Feature engineering | |
| Polynomial features | |
| Overfitting / underfitting | |
| Regularization | |

## Update log

| Date | Course concept learned | Project updated | What changed |
|---|---|---|---|
| 2026-11-03 | Classification: labels and inputs at a fixed cutoff | tehran-air-risk | Daily labels with the 20-of-24 rule, features built only from hours up to the cutoff, and leakage tests. The summer-time rows (576) were dropped the same day. |
| 2026-11-03 | Logistic regression: sigmoid, logistic cost, gradient descent, vectorization, feature scaling, regularization | tehran-air-risk | Training from scratch in NumPy with a time split, ten candidates compared on the selection months, two baselines, and a scikit-learn check. Held-out cost 0.1515 against 0.3077 and 0.2950. |
| 2026-11-03 | Using the model: a daily forecast | tehran-air-risk | The scheduled run, gap handling and outcome filling, then the Forecast page and the Model Lab (17 steps). |
| 2026-11-04 | Reading the data honestly | tehran-air-risk | The Data page, the scope and delivery checks, CI and the Pages workflow, and the docs. The Lab's overflow stop was made independent of the penalty term. |

## Notes for every update

For each new concept, record:

1. What the concept means in my own words.
2. Which project demonstrates it.
3. What the visitor can see or interact with.
4. Where the relevant code is located.
5. How I checked that the implementation is correct.
