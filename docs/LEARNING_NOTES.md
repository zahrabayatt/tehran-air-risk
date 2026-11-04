# Learning notes

Technical explanations of the Course 1 concepts this project uses, tied to the code and to the course week each belongs to. Each section ends with an empty "In my own words" heading. The author writes those; they are left blank on purpose.

Notation: `m` is the number of training rows, `n` the number of features, `x` one row of features, `y` the label (1 when tomorrow's mean PM2.5 is above 35.4 μg/m³, otherwise 0), `w` the weights, `b` the bias, `f(x)` the model's probability that `y = 1`. Code paths are relative to the repository root.

## Classification and the label (Course 1, Week 3)

Classification predicts one of a few classes instead of a number. Here there are two: `y = 1` when the Tehran-day mean PM2.5 of the next day is above 35.4 μg/m³, `y = 0` otherwise. `daily_labels` in `training/labels.py` builds the label from the hourly values: it takes each cell's Tehran calendar day, needs at least 20 of 24 hourly values, and marks the day positive only when the mean is strictly above 35.4. A mean of exactly 35.4 is negative, and `tests/test_labels.py` checks the edge, including floating-point noise around it.

The classes are not balanced: 7.0% of the 18,624 labelled cell-days are positive. That is why the baselines on the Data page and in the data card matter, because a model that always said "no" would already be right on most days.

### In my own words

## Why a straight line is not enough (Course 1, Week 3)

Linear regression could be fitted to 0/1 labels, but its output is not a probability and the line it draws is pulled around by days far from the threshold. The Lab's "Why not linear regression?" step fits a least-squares line to a small sample (`fit_linear` in `training/experiments.py`), shows where it crosses 0.5, and lets the visitor add very polluted days, which tilt the line and move the crossing point, so some ordinary days change side although they did not change. `tests/test_experiments.py` checks both the fit and the shift.

### In my own words

## Sigmoid function (Course 1, Week 3)

The sigmoid squeezes any number into the open range from 0 to 1, so the model's output can be read as a probability:

```text
g(z) = 1 / (1 + e^(-z))
```

`sigmoid` in `training/model.py` computes it with `e^(-|z|)` for both signs of `z`, so an extreme score such as -1000 or 1000 cannot overflow. `g(0)` is exactly 0.5, and `g(-z) = 1 - g(z)`; `tests/test_model.py` checks both, and the extreme values. The site does the same in TypeScript (`sigmoid` in `web/src/lab/engine.ts`).

### In my own words

## Logistic regression model (Course 1, Week 3)

The model takes the same weighted sum as linear regression and passes it through the sigmoid:

```text
f(x) = g(w . x + b),   g(z) = 1 / (1 + e^(-z))
```

`predict_proba` in `training/model.py` is this for every row at once, `X @ w + b` followed by the sigmoid. The deployed model has five weights, on z-scored features: `pm2_5_mean` 0.30, `pm2_5_max` 1.03, `pm2_5_last` 0.17, `season_sin` 0.08, `season_cos` 0.63, and a bias of -3.69 (`model/model.json`). The bias is negative because most days are negative. A weight says how much the score moves when its feature rises by one standard deviation with the others held fixed; it describes a pattern in this data, not a cause. The daily run (`pipeline/predict.py`) applies exactly these numbers, read from the file.

### In my own words

## Decision boundary (Course 1, Week 3)

The model says "class 1" when `f(x) >= 0.5`, which is the same as `w . x + b >= 0`. The set of points where the score is exactly zero is the decision boundary: a line with two features, a plane with three. `boundary_x2` in `training/experiments.py` solves for it in the Lab's two-feature view. The threshold on the probability is fixed at 0.5 (`DECISION_THRESHOLD` in `training/train.py`) and is stored in the forecast as the predicted class. Changing it to study its effects is out of scope for this project.

### In my own words

## Logistic loss and the cost function (Course 1, Week 3)

Squared error on a sigmoid output loses its bowl shape, with flat stretches where gradient descent can stall. The logistic loss for one day is `-log(f)` when `y = 1` and `-log(1 - f)` when `y = 0`: a confident wrong answer costs a lot, a confident right one costs almost nothing. Averaged over all days, with the penalty described below:

```text
J(w, b) = -1/m * sum( y*log(f) + (1 - y)*log(1 - f) )  +  lambda/(2m) * sum(w_j^2)
```

`compute_cost` and `logistic_cost` in `training/model.py` are this. Probabilities are never clipped; only the argument of each log is held at 1e-15 or above, so a probability of exactly 0 or 1 gives a large but finite cost (checked in `tests/test_model.py`). The Lab's "Why not squared error?" step compares the two costs on the same sample (`squared_error_cost` in `training/experiments.py`).

The cost is also how the result is reported: the held-out cost of the model (0.1515) is compared with the cost of always guessing the overall training rate (0.3077) and of guessing each calendar month's training rate (0.2950).

### In my own words

## Gradient descent for logistic regression (Course 1, Week 3)

The update has the same shape as in linear regression; only `f` differs:

```text
dJ/dw_j = 1/m * sum over rows of (f(x_i) - y_i) * x_ij  +  lambda/m * w_j
dJ/db   = 1/m * sum over rows of (f(x_i) - y_i)
w_j := w_j - alpha * dJ/dw_j       b := b - alpha * dJ/db
```

All parameters are updated together from the same old values. `compute_gradient` and `gradient_descent` in `training/model.py` do this on all rows each step. If an update makes a parameter or the cost not finite, descent stops and returns the last finite parameters, so a diverging run cannot poison later code. How it was checked: the analytic gradient matches a numeric one (`test_gradient_matches_numeric`), one step updates all parameters from the same starting point, cost falls at a small learning rate, repeat runs are identical, and the result matches scikit-learn's logistic regression (the deployed fit differs from it by at most 1.2e-7 in any weight).

### In my own words

## Vectorization and multiple features (Course 1, Week 2)

With several features, `w` is a vector and the same formulas hold with one gradient per weight. A dot product written as a Python loop touches one number at a time; `X @ w` hands the whole operation to NumPy. `predict_proba_loop`, `compute_cost_loop` and `compute_gradient_loop` in `training/model.py` are the loop versions, and `test_loop_versions_match_vectorized` shows they give the same numbers. The Lab's Vectorization step times a loop against NumPy in the browser and shows the training run's own measurement (`vectorization` in `model/model.json`), not a typed-in number.

### In my own words

## Learning rate (Course 1, Week 2)

`alpha` sets the step size. Too small and the cost falls slowly; too large and each step overshoots, the cost rises, and the run diverges. Training here uses `alpha = 0.5` for 10,000 updates on scaled features. Every candidate settled: the cost changed by less than one part in ten million over its last 100 updates (stored per candidate in `model/model.json`). `race_learning_rates` in `training/experiments.py` runs several rates side by side for the Lab's Learning rate step, using the production descent.

### In my own words

## Feature scaling (Course 1, Week 2)

The inputs have very different sizes: PM2.5 in tens of μg/m³, a sine between -1 and 1. Z-score scaling gives each column a mean of 0 and a standard deviation of 1:

```text
x_scaled = (x - mu) / sigma
```

`zscore_fit` and `zscore_apply` in `training/features.py` do this. `mu` and `sigma` come from training rows only and are stored in `model.json`, so the daily run scales a new row with the same numbers. A column with no spread gets `sigma = 1` instead of dividing by zero. `tests/test_leakage.py` checks that the selection and held-out rows change neither `mu` nor `sigma`.

### In my own words

## Feature engineering (Course 1, Week 2)

A new column built from the data can give a model something it cannot make from the raw columns. Here the day of year is turned into `sin(2π · day / 365.25)` and `cos(2π · day / 365.25)`, so December and January sit next to each other instead of at opposite ends of a number line (`season_sin` and `season_cos` in `training/features.py`; `test_season_features_match_the_feature_builder` checks the Lab's version against it). The other engineered columns are window summaries: the mean, highest and latest PM2.5 of the 12 hours before the 12:00 cutoff.

Leakage is the main risk with engineered features. `tests/test_leakage.py` changes any value stamped at or after 09:00 UTC (after the cutoff) and checks that the row does not move, and checks that the label day's own PM2.5 cannot reach the features. Higher-degree terms of two features are in the Lab as a sandbox only (`poly_features`); the deployed model does not use them.

### In my own words

## Overfitting and regularization (Course 1, Week 3)

A model flexible enough to follow every training point, noise included, does well on training days and worse on new ones (overfitting, high variance). Remedies are more data, fewer features, or regularization, which adds a penalty on the size of the weights to the cost so that large weights must earn their place:

```text
J(w, b) = logistic cost  +  lambda/(2m) * sum(w_j^2)
```

The bias is not penalized (`test_bias_not_in_penalty`). `lambda` was chosen on the selection months from 0, 10, 100, 1,000 and 10,000 for two feature sets; the winner is `lambda = 100` on the five-feature set (selection cost 0.0912). The larger fourteen-feature set fits the training days better (0.1273 at `lambda = 0`) but scored worse on the selection months (0.0937). `compute_cost_reg` and `compute_gradient_reg` in `training/model.py` are the penalized versions, and `fit_polynomial` in `training/experiments.py` lets the Lab show the shrinking on a small sample.

A caution that belongs here: the selection months are one warm half-year with 85 positive days, so this choice rests on little data.

### In my own words

## Keeping the test honest: the time split and the baselines (project practice)

This is not a named course concept; it is how the project avoids fooling itself. Days are split in time order: training days first, then six months of selection days to choose settings, then the final twelve months held out and looked at once. The model is pooled across the twelve squares, so every square appears in all three parts. The baselines (the overall training rate and each calendar month's training rate) are fitted on training rows only and scored on the same held-out days with the same cost. `tests/test_train.py` checks that changing held-out labels changes nothing but held-out costs. If the model had not beaten both baselines, the site would say so; today it does (0.1515 against 0.3077 and 0.2950).

### In my own words
