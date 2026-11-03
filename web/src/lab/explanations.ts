/**
 * The line-by-line explanations of the code the Lab shows.
 *
 * Code is read from training/*.py and pipeline/*.py at build time (plugins/code-snippets.ts). Each
 * explanation is keyed by the exact text of its line, indentation included. A line with no entry is
 * shown with a blank explanation. stages.test.ts fails if a key stops matching a line, so editing the
 * Python cannot leave an explanation attached to the wrong code.
 */
export const EXPLANATIONS: Record<string, Record<string, string>> = {
  daily_labels: {
    "def daily_labels(hourly: pd.DataFrame, threshold: float = THRESHOLD, min_hours: int = MIN_HOURS) -> pd.DataFrame:": "Takes the hourly values of every square and returns one row per square and Tehran day. The threshold is 35.4 and at least 20 hours must exist.",
    "    \"\"\"Label each (cell, Tehran day) with y = 1 iff the mean PM2.5 is strictly above `threshold`.": "The rule in one sentence: y = 1 only when the day’s mean is strictly above the threshold, so a mean of exactly 35.4 is y = 0.",
    "    times = pd.DatetimeIndex(hourly[\"time_utc\"])": "The hourly timestamps, which are in UTC.",
    "    if times.tz is None:": "A timestamp without a time zone could be read as the wrong day, so it is refused.",
    "        raise ValueError(\"time_utc must be timezone-aware (UTC); got naive timestamps\")": "Stop with a clear message instead of labelling days wrongly.",
    "    frame = pd.DataFrame({": "A small table with the three columns the labels need.",
    "        \"cell_id\": hourly[\"cell_id\"].to_numpy(),": "Which square each hour belongs to.",
    "        \"date\": times.tz_convert(TEHRAN).date,": "Convert each hour to Tehran time and keep its calendar date. This is what makes a day a Tehran day.",
    "        \"pm2_5\": hourly[\"pm2_5\"].to_numpy(dtype=float),": "The PM2.5 value of that hour.",
    "    })": "End of the table.",
    "    daily = (frame.groupby([\"cell_id\", \"date\"], sort=True)[\"pm2_5\"]": "Group the hours by square and day.",
    "             .agg(n=\"count\", mean_pm25=\"mean\").reset_index())": "For each group, count the hours that exist and take their mean.",
    "    daily = daily[daily[\"n\"] >= min_hours].copy()": "Keep only days with at least 20 hours. The rest get no label and are left out.",
    "    daily[\"y\"] = (daily[\"mean_pm25\"].round(_NOISE_DECIMALS) > threshold).astype(\"int64\")": "The label: 1 when the day’s mean is above the threshold, else 0. Rounding first removes tiny floating-point noise, so a mean of exactly 35.4 stays 0.",
    "    return daily[COLUMNS].reset_index(drop=True)": "Return the square, date, label and mean.",
  },

  build_row: {
    "def build_row(hourly: pd.DataFrame, cell_id: str, day) -> dict | None:": "Builds one square’s row of inputs for the day D on which a forecast is made.",
    "    \"\"\"One feature row for `cell_id`, issued at 12:00 Tehran time on the Tehran date `day` (D).": "The row is made at 12:00 Tehran time on day D and describes what is known by then.",
    "    _check_utc(hourly[\"time_utc\"])": "Check that the timestamps carry a time zone.",
    "    day = pd.Timestamp(day).date()": "Turn the day into a plain date.",
    "    if not _issuable([day])[0]:": "On days when Iran still used summer time, the 08:00 UTC hour is already past 12:00 local time, so no row is made.",
    "        return None                                         # summer time: 08:00 UTC is past 12:00": "No row. Nothing is ever filled in.",
    "    last = pd.Timestamp(day, tz=\"UTC\") + _LAST_STAMP": "The last usable hour: 08:00 UTC on day D, which is 11:30 Tehran time.",
    "    stamps = last + pd.to_timedelta(_OFFSETS, unit=\"h\")": "The 12 hourly stamps that end there, starting at 21:00 UTC the evening before.",
    "    cell = hourly[hourly[\"cell_id\"] == cell_id]": "Only this square’s hours.",
    "    inside = cell[cell[\"time_utc\"].isin(stamps)]": "Of those, only the hours inside the window. Anything stamped later is never read, so nothing after the cutoff can leak in.",
    "    if inside[\"time_utc\"].duplicated().any():": "The same hour twice would be a data error.",
    "        raise ValueError(f\"duplicate hourly stamps for cell {cell_id!r} on {day}\")": "Stop and say which square and day.",
    "    window = inside.sort_values(\"time_utc\")": "Put the hours in time order.",
    "    if len(window) < WINDOW_HOURS:": "Fewer than 12 hours exist.",
    "        return None": "No row: a missing hour is never invented.",
    "    values = window[INPUTS].to_numpy(dtype=float)               # (12 hours, 10 inputs)": "The ten input columns for those 12 hours, as numbers.",
    "    if np.isnan(values).any():": "Is any value missing?",
    "    target = day + dt.timedelta(days=1)": "The day being predicted is tomorrow, D+1.",
    "    feats = _features(values.T[None, :, :], pd.DatetimeIndex([target]))": "Turn the window into the 14 features: means, the highest and last PM2.5, and the season sine and cosine of tomorrow.",
    "    row = {\"cell_id\": cell_id, \"day\": day, \"target_date\": target,": "Start the row with identifying and audit fields.",
    "           \"latest_input_utc\": last, \"cutoff_utc\": last + (CUTOFF - _LAST_STAMP)}": "Record the newest input time and the cutoff, so a test can prove no input is later than the cutoff.",
    "    row.update({name: float(feats[name].iloc[0]) for name in FEATURES})": "Add the 14 feature values.",
    "    return row": "The finished row.",
  },

  fit_linear: {
    "def fit_linear(x, y):": "A least-squares straight line through the points (x, y), here with y equal to 0 or 1.",
    "    x_mean, y_mean = x.mean(), y.mean()": "The averages of x and of y.",
    "    w = ((x - x_mean) * (y - y_mean)).mean() / ((x - x_mean) ** 2).mean()": "The weight: how x and y vary together, divided by how much x varies alone.",
    "    b = y_mean - w * x_mean": "The bias that makes the line pass through the average point.",
    "    return w, b": "Both numbers.",
    "def linear_crossing(w, b):": "Where the line reaches the 0.5 cut-off.",
    "    return (0.5 - b) / w": "Solve w·x + b = 0.5 for x.",
  },

  sigmoid: {
    "def sigmoid(z):": "z can be one number or a whole array.",
    "    \"\"\"g(z) = 1 / (1 + e^(-z)), computed so that no exponent is ever positive.": "The formula, written so that the computer never has to raise e to a large positive power.",
    "    z = np.asarray(z, dtype=float)": "Accept a number or an array.",
    "    e = np.exp(-np.abs(z))": "e^(−|z|) is between 0 and 1 whatever z is, so it can never overflow.",
    "    g = np.where(z >= 0, 1 / (1 + e), e / (1 + e))": "For z ≥ 0 use 1 / (1 + e^(−z)). For z < 0 use the equal value e^z / (1 + e^z). Both are written with e^(−|z|).",
    "    return g if g.ndim else float(g)": "A plain float for a single number, an array otherwise.",
  },

  predict_proba_loop: {
    "def predict_proba_loop(X, w, b):": "The probability for every day, with plain loops.",
    "    m, n = X.shape": "m days and n features.",
    "    p = np.zeros(m)": "Space for one probability per day.",
    "    for i in range(m):": "Visit each day.",
    "        z_i = b": "Start the score at the bias.",
    "        for j in range(n):": "Visit each feature.",
    "            z_i += X[i, j] * w[j]": "Add feature j times its weight. Together these build w · x + b one term at a time.",
    "        p[i] = sigmoid(z_i)": "Turn the score into a probability.",
    "    return p": "All m probabilities.",
  },

  boundary_x2: {
    "def boundary_x2(x1, w, b):": "For a value of x₁, the x₂ where the model’s score is exactly zero.",
    "    return -(w[0] * x1 + b) / w[1]": "Solve w₁x₁ + w₂x₂ + b = 0 for x₂. Plot it for a range of x₁ and you get the line.",
  },

  squared_error_cost: {
    "def squared_error_cost(X, y, w, b):": "The squared-error cost, written only to compare with the logistic cost.",
    "    f = predict_proba(X, w, b)": "The model’s probabilities, with the sigmoid inside.",
    "    return ((f - y) ** 2).mean() / 2": "Average squared difference with a 1/2, as for a straight line. It is never used to train this model.",
  },

  logistic_loss: {
    "def logistic_loss(f, y):": "The loss of one prediction f against the true label y.",
    "    return -y * np.log(max(f, EPS)) - (1 - y) * np.log(max(1 - f, EPS))": "The one-line formula. max(…, EPS) keeps the logarithm away from log(0), so a probability of exactly 0 or 1 gives a large but finite loss.",
  },

  compute_cost_loop: {
    "def compute_cost_loop(X, y, w, b):": "The cost J of one choice of w and b, with plain loops.",
    "    m, n = X.shape": "m days and n features.",
    "    total = 0.0": "Running total of the losses.",
    "    for i in range(m):": "Visit each day.",
    "        z_i = b": "Start the score at the bias.",
    "        for j in range(n):": "Visit each feature.",
    "            z_i += X[i, j] * w[j]": "Add feature j times its weight.",
    "        f_i = sigmoid(z_i)": "The probability for day i.",
    "        total += -y[i] * np.log(max(f_i, EPS)) - (1 - y[i]) * np.log(max(1 - f_i, EPS))": "Add this day’s loss.",
    "    return total / m": "The average loss: the cost J.",
  },

  compute_gradient_loop: {
    "def compute_gradient_loop(X, y, w, b):": "The two slopes of the cost at one choice of w and b, with plain loops.",
    "    m, n = X.shape": "m days and n features.",
    "    dj_dw = np.zeros(n)": "One running total for each weight’s slope.",
    "    dj_db = 0.0": "Running total for the slope of b.",
    "    for i in range(m):": "Visit each day.",
    "        z_i = b": "Start the score at the bias.",
    "        for j in range(n):": "Visit each feature.",
    "            z_i += X[i, j] * w[j]": "Add feature j times its weight.",
    "        err = sigmoid(z_i) - y[i]": "The error: the predicted probability minus the true label. This is the only line that differs from a straight line’s version.",
    "            dj_dw[j] += err * X[i, j]": "Add this day’s error times feature j to weight j’s total.",
    "        dj_db += err": "Add this day’s error to the total for b.",
    "    return dj_dw / m, dj_db / m": "Divide by m to average.",
  },

  descent: {
    "def descent(X, y, w, b, alpha, num_iters):": "Start from the given w and b and take num_iters steps of size alpha.",
    "    J_history = []": "Keeps the cost after every step so it can be plotted.",
    "    for _ in range(num_iters):": "One update per iteration.",
    "        dj_dw, dj_db = compute_gradient_loop(X, y, w, b)": "Both slopes, at the current w and b.",
    "        w = w - alpha * dj_dw": "Step w downhill.",
    "        b = b - alpha * dj_db": "Step b downhill, using the slope found before w changed: both parameters are updated together.",
    "        J_history.append(compute_cost_loop(X, y, w, b))": "Record the new cost. It should fall.",
    "    return w, b, J_history": "The final w and b, and the cost after each step.",
  },

  gradient_matrix: {
    "def gradient_matrix(X, y, w, b):": "The same two slopes, with no loop over days or features.",
    "    m = X.shape[0]": "Number of days.",
    "    err = predict_proba(X, w, b) - y": "All m errors in one line.",
    "    dj_dw = X.T @ err / m": "All n weight slopes at once: X transposed times the errors, averaged.",
    "    dj_db = err.mean()": "The slope of b is the average error.",
    "    return dj_dw, dj_db": "Same result as the loops, far faster.",
  },

  predict_proba: {
    "def predict_proba(X, w, b) -> np.ndarray:": "The probability for every day at once.",
    "    \"\"\"Probability that y = 1 for every row of X.\"\"\"": "One line saying what comes back.",
    "    return sigmoid(np.asarray(X, dtype=float) @ np.asarray(w, dtype=float) + b)": "One matrix product gives every score X w + b, then the sigmoid is applied to each.",
  },

  time_dot: {
    "def time_dot(n: int = 1_000_000, seed: int = SEED) -> dict:": "Times one dot product of a million numbers, written two ways.",
    "    \"\"\"One dot product of n elements, as a Python loop and as np.dot.\"\"\"": "What is measured.",
    "    rng = np.random.default_rng(seed)": "A fixed seed, so every run uses the same numbers.",
    "    a, b = rng.random(n).tolist(), rng.random(n).tolist()": "Two vectors of random numbers, kept as Python lists for the loop.",
    "    start = time.perf_counter()": "Start the clock.",
    "    total = 0.0": "Running sum.",
    "    for i in range(n):": "One Python step per element.",
    "        total += a[i] * b[i]": "Multiply a pair and add it to the sum.",
    "    loop_ms = (time.perf_counter() - start) * 1000": "Milliseconds the loop took.",
    "    va, vb = np.array(a), np.array(b)": "The same numbers as NumPy arrays.",
    "    np.dot(va, vb)": "NumPy does the whole dot product in compiled code.",
    "    numpy_ms = (time.perf_counter() - start) * 1000": "Milliseconds NumPy took.",
    "    return {\"elements\": n, \"loop_ms\": loop_ms, \"numpy_ms\": numpy_ms}": "Training saves these numbers in model.json, and this page shows them exactly as measured.",
  },

  lr_race: {
    "def race_learning_rates(X, y, alphas, num_iters=300):": "Runs gradient descent once for each learning rate in the list.",
    "    histories = {}": "One cost history per learning rate.",
    "    for alpha in alphas:": "Visit each rate.",
    "        w0, b0 = np.zeros(X.shape[1]), 0.0": "Every rate starts from the same place: all weights zero.",
    "        w, b, J_history = gradient_descent(X, y, w0, b0, alpha, num_iters)": "Run descent with this rate.",
    "        histories[alpha] = J_history": "Keep its cost history under its rate.",
    "    return histories": "Plot them together to compare.",
  },

  zscore: {
    "def _guard(sigma) -> np.ndarray:": "Protects against dividing by zero.",
    "    sigma = np.asarray(sigma, dtype=float)": "Accept a list or an array.",
    "    if np.isnan(sigma).any():": "A missing value would poison every number.",
    "        raise ValueError(\"sigma is NaN; the training columns must not contain NaN\")": "Stop and say so instead of continuing.",
    "    return np.where(sigma < 1e-12, 1.0, sigma)": "A column that never changes has no spread. Use 1 instead, so nothing divides by zero.",
    "def zscore_fit(X) -> tuple[np.ndarray, np.ndarray]:": "Learn μ and σ for each column from the training days.",
    "    \"\"\"Per-column mean and standard deviation of the TRAINING rows.": "Only training days are used, so nothing from later days leaks into the scaling.",
    "    X = np.asarray(X, dtype=float)": "Accept a list or an array.",
    "    if X.ndim == 1:": "Is it a single column of numbers?",
    "        X = X.reshape(-1, 1)": "Make it a table with one column.",
    "    mu = X.mean(axis=0)": "The mean of each column.",
    "    sigma = _guard(X.std(axis=0))": "The standard deviation of each column, made safe.",
    "    return mu, sigma": "Both are saved with the model.",
    "def zscore_apply(X, mu, sigma) -> np.ndarray:": "Scale any days with a μ and σ that were already learned.",
    "    \"\"\"(X - mu) / sigma, with any sigma below 1e-12 treated as 1. NaN sigma raises ValueError.\"\"\"": "What it returns, in one line.",
    "    return (X - mu) / _guard(sigma)": "(x − μ) / σ for every column at once.",
  },

  season_features: {
    "def season_features(day_of_year):": "Takes the day of the year of the day being predicted.",
    "    angle = 2 * np.pi * day_of_year / 365.25": "Turn the day into an angle. A whole year is one full turn.",
    "    return np.sin(angle), np.cos(angle)": "The point on the circle. Day 365 lands next to day 1.",
  },

  poly_features: {
    "def poly_features(x1, x2):": "Builds new columns from two features.",
    "    return np.column_stack([x1, x2, x1 ** 2, x1 * x2, x2 ** 2,": "Nine columns: the two features, their squares and their product,",
    "                            x1 ** 3, x1 ** 2 * x2, x1 * x2 ** 2, x2 ** 3])": "and the terms of degree three.",
  },

  fit_polynomial: {
    "def fit_polynomial(x1, x2, y, lambda_, num_iters=2000):": "Fits the nine-column model with a penalty of strength lambda_.",
    "    X = poly_features(x1, x2)": "Build the nine columns.",
    "    mu, sigma = zscore_fit(X)": "Learn μ and σ for them: the squares and cubes are on very different scales.",
    "    Z = zscore_apply(X, mu, sigma)": "Scale them.",
    "    alpha = 1 / (2.5 + lambda_ / len(y))": "A learning rate that is safe for the penalty chosen. The stronger the penalty, the smaller the largest safe step.",
    "    w, b, J_history = gradient_descent(Z, y, np.zeros(Z.shape[1]), 0.0, alpha, num_iters, lambda_)": "Gradient descent from zero, now with the penalty switched on.",
    "    return w, b, mu, sigma": "Everything needed to use the fit later.",
  },

  compute_cost_reg: {
    "def compute_cost_reg(X, y, w, b, lambda_):": "The cost with a penalty on large weights.",
    "    m, n = X.shape": "m days and n columns.",
    "    cost = compute_cost_loop(X, y, w, b)": "The usual cost first.",
    "    penalty = 0.0": "Running total of squared weights.",
    "    for j in range(n):": "Visit each weight.",
    "        penalty += w[j] ** 2": "Add its square. The bias b is not included.",
    "    return cost + lambda_ / (2 * m) * penalty": "The cost plus λ / 2m times the sum of squared weights.",
  },

  compute_gradient_reg: {
    "def compute_gradient_reg(X, y, w, b, lambda_):": "The slopes of the penalized cost.",
    "    m, n = X.shape": "m days and n columns.",
    "    dj_dw, dj_db = compute_gradient_loop(X, y, w, b)": "The usual slopes first.",
    "    for j in range(n):": "Visit each weight.",
    "        dj_dw[j] += lambda_ / m * w[j]": "Its slope gets the extra term (λ / m) · wⱼ, which pulls the weight toward zero.",
    "    return dj_dw, dj_db": "The slope of b is unchanged, because b is not penalized.",
  },

  split_by_time: {
    "def split_by_time(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:": "Cuts all days into three parts by date, oldest first.",
    "    \"\"\"(train, selection, held_out) by `target_date`, oldest to newest with no overlap.": "Training, then selection, then held-out: never shuffled.",
    "    if df.empty:": "Nothing to split?",
    "        raise ValueError(\"need more than 18 months of history to split; got no rows\")": "Stop and say what is missing.",
    "    dates = pd.to_datetime(df[\"target_date\"])": "The date each row is about.",
    "    held_after = dates.max() - pd.DateOffset(months=12)": "The held-out year is everything after this date: the last 12 months.",
    "    selection_after = held_after - pd.DateOffset(months=6)": "The six months before that are the selection months, used to choose λ and the features.",
    "    held = df[dates > held_after]": "The held-out days.",
    "    selection = df[(dates > selection_after) & (dates <= held_after)]": "The selection days.",
    "    train = df[dates <= selection_after]": "Everything earlier trains the model.",
    "    if train.empty or selection.empty or held.empty:": "Is any part empty?",
    "        raise ValueError(\"need more than 18 months of history to split into train, \"": "Stop, because a part with no days cannot be used.",
    "                         f\"selection and held-out; got {dates.min().date()} to {dates.max().date()}\")": "The message says which dates were found.",
    "    return (train.reset_index(drop=True), selection.reset_index(drop=True),": "Return the three parts, each numbered from 0 again.",
    "            held.reset_index(drop=True))": "The held-out part comes last.",
  },

  baselines: {
    "def fit_baselines(train: pd.DataFrame) -> dict:": "Two simple guesses, built from the training days only.",
    "    \"\"\"Two simple guesses, from training rows only.": "Neither guess ever sees a later day.",
    "    y = train[\"y\"].to_numpy(dtype=float)": "The training labels.",
    "    months = _months(train)": "The calendar month of each training day.",
    "    overall = float(y.mean())": "Guess 1: always the training share of y = 1.",
    "    rates, fallback = [], []": "Guess 2 gets one rate per month, and a list of months it had to fill in.",
    "    for month in range(1, 13):": "Visit each calendar month.",
    "        in_month = y[months == month]": "The training labels in that month.",
    "        if len(in_month):": "Is there any training day in this month?",
    "            rates.append(float(in_month.mean()))": "Yes: use the training share within the month.",
    "        else:": "No training day in this month.",
    "            rates.append(overall)": "Fall back to the overall share,",
    "            fallback.append(month)": "and remember that this month was filled in.",
    "    return {\"overall\": {\"rate\": overall},": "Both guesses, ready to be saved.",
    "            \"monthly\": {\"rates\": rates, \"fallback_months\": fallback}}": "The monthly guess with the months that used the fallback.",
    "def baseline_costs(baselines: dict, df: pd.DataFrame) -> dict:": "The cost of each guess on any set of days.",
    "    \"\"\"Plain logistic cost of each baseline's constant probabilities on df.\"\"\"": "Plain logistic cost, with no penalty.",
    "    y = df[\"y\"].to_numpy(dtype=float)": "The labels of those days.",
    "    monthly = np.array(baselines[\"monthly\"][\"rates\"])[_months(df) - 1]": "Each day’s monthly guess, picked by its calendar month.",
    "    return {\"overall\": logistic_cost(np.full(len(y), baselines[\"overall\"][\"rate\"]), y),": "The cost of always guessing the overall share.",
    "            \"monthly\": logistic_cost(monthly, y)}": "The cost of the monthly guess.",
  },

  model_probability: {
    "def model_probability(model: dict, row: dict) -> float:": "Applies the saved model to one day’s row of inputs.",
    "    \"\"\"Apply the frozen model to one build_row result: pick model['features'], z-score, sigmoid.\"\"\"": "The three steps, in one line.",
    "    x = np.array([[row[name] for name in model[\"features\"]]], dtype=float)": "Pick the five features the model uses, in the saved order.",
    "    z = zscore_apply(x, np.array(model[\"scaling\"][\"mu\"]), np.array(model[\"scaling\"][\"sigma\"]))": "Scale them with the μ and σ saved at training time.",
    "    return float(predict_proba(z, np.array(model[\"weights\"]), model[\"bias\"])[0])": "Apply the saved weights and bias, then the sigmoid: the probability.",
  },

};
