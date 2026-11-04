/**
 * The Lab's math, in plain TypeScript with no React and no imports.
 *
 * Everything here runs on the sample rows in sample.json (training days only). The only function that
 * touches the frozen model is applyFrozen, which reads its numbers and never writes them. Nothing here
 * changes its inputs, so a Lab experiment cannot disturb the Forecast page.
 *
 * The maths is training/model.py, line for line:
 *   sigmoid   g(z) = 1 / (1 + e^-z), computed from e^-|z| so no exponent is ever positive
 *   cost      J = -1/m * sum(y log f + (1 - y) log(1 - f)) + lambda/(2m) * sum(w^2)
 *   gradient  dJ/dw = X^T (f - y) / m + lambda/m * w,   dJ/db = mean(f - y)
 * Probabilities are never clipped; only the argument of each log is clipped at EPS inside the cost.
 * The bias b is never penalized. web/src/lab/engine.test.ts compares with Python within 1e-9 relative.
 *
 * Runs are numbered by state. A run of `iters` updates has iters + 1 states, 0 to iters: state k is
 * the point after k updates, and state 0 is the starting point. A run stops at the first state whose
 * cost, weights or bias are not finite. That state is not kept, and `diverged` is its number, so
 * `h.length === diverged`. A run that finishes has `diverged === null`. Every kept number is finite.
 */

/** Smallest value allowed inside a log, as in training/model.py. */
export const EPS = 1e-15;

/** One row of sample.json. The sample is West Tehran's training days only. */
export interface SampleRow {
  day: string;
  target_date: string;
  pm_today: number;
  pm_tomorrow: number;
  y: 0 | 1;
  pm2_5_mean: number;
  pm2_5_max: number;
  pm2_5_last: number;
  wind_mean: number;
  season_sin: number;
  season_cos: number;
  [feature: string]: number | string;
}

export interface TrainMonth {
  month: number;
  pooled_rate: number;
  pooled_days: number;
  cell_rate: number;
  cell_days: number;
}

/** The shape of web/public/data/sample.json. */
export interface Sample {
  cell: string;
  cell_name: string;
  split: string;
  rule: string;
  start: string;
  end: string;
  days: number;
  positive_share: number;
  threshold: number;
  features: string[];
  rows: SampleRow[];
  train_months: TrainMonth[];
}

export type Matrix = number[][];

/** The five features of the live model, in the order of model.json. */
export const MODEL_FEATURES = ['pm2_5_mean', 'pm2_5_max', 'pm2_5_last', 'season_sin', 'season_cos'] as const;

export interface State { w: number[]; b: number; j: number; gw: number[]; gb: number }
export interface Run { h: State[]; diverged: number | null; ms: number }
export interface OneState { w: number; b: number; j: number; gw: number; gb: number }
export interface OneRun { h: OneState[]; diverged: number | null; ms: number }

/* ---------- the sigmoid and the loss ---------- */

/** g(z) = 1 / (1 + e^-z) without overflow: for z >= 0 it is 1/(1 + e^-z), for z < 0 it is e^z/(1 + e^z). */
export function sigmoid(z: number): number {
  const e = Math.exp(-Math.abs(z));
  return z >= 0 ? 1 / (1 + e) : e / (1 + e);
}

/** Loss of one prediction f against the label y. Only the log's argument is clipped. */
export function logLoss(f: number, y: number): number {
  return -y * Math.log(Math.max(f, EPS)) - (1 - y) * Math.log(Math.max(1 - f, EPS));
}

/* ---------- many features, rows as arrays ---------- */

/** Probability of y = 1 for every row. */
export function predictProba(X: Matrix, w: number[], b: number): number[] {
  const out = new Array<number>(X.length);
  for (let i = 0; i < X.length; i++) {
    const row = X[i];
    let z = b;
    for (let j = 0; j < w.length; j++) z += row[j] * w[j];
    out[i] = sigmoid(z);
  }
  return out;
}

/** Mean loss over the rows, plus lambda/(2m) times the sum of squared weights. */
export function cost(X: Matrix, y: number[], w: number[], b: number, lambda = 0): number {
  const f = predictProba(X, w, b);
  let s = 0;
  for (let i = 0; i < f.length; i++) s += logLoss(f[i], y[i]);
  let penalty = 0;
  for (let j = 0; j < w.length; j++) penalty += w[j] * w[j];
  return s / X.length + (lambda / (2 * X.length)) * penalty;
}

/** Gradient of cost with respect to w and b. */
export function gradient(X: Matrix, y: number[], w: number[], b: number, lambda = 0): { gw: number[]; gb: number } {
  const m = X.length;
  const n = w.length;
  const f = predictProba(X, w, b);
  const gw = new Array<number>(n).fill(0);
  let gb = 0;
  for (let i = 0; i < m; i++) {
    const e = f[i] - y[i];
    const row = X[i];
    for (let j = 0; j < n; j++) gw[j] += e * row[j];
    gb += e;
  }
  for (let j = 0; j < n; j++) gw[j] = gw[j] / m + (lambda / m) * w[j];
  return { gw, gb: gb / m };
}

/** The plain-loop cost, written as training/model.py's compute_cost_loop is: day by day, feature by feature. */
export function costLoop(X: Matrix, y: number[], w: number[], b: number): number {
  const m = X.length;
  const n = w.length;
  let total = 0;
  for (let i = 0; i < m; i++) {
    let z = b;
    for (let j = 0; j < n; j++) z += X[i][j] * w[j];
    total += logLoss(sigmoid(z), y[i]);
  }
  return total / m;
}

/** The plain-loop gradient, as compute_gradient_loop. */
export function gradientLoop(X: Matrix, y: number[], w: number[], b: number): { gw: number[]; gb: number } {
  const m = X.length;
  const n = w.length;
  const gw = new Array<number>(n).fill(0);
  let gb = 0;
  for (let i = 0; i < m; i++) {
    let z = b;
    for (let j = 0; j < n; j++) z += X[i][j] * w[j];
    const err = sigmoid(z) - y[i];
    for (let j = 0; j < n; j++) gw[j] += err * X[i][j];
    gb += err;
  }
  return { gw: gw.map((v) => v / m), gb: gb / m };
}

/* ---------- gradient descent ---------- */

const allFinite = (v: number[]) => v.every(Number.isFinite);

const sumSquares = (v: number[]) => v.reduce((s, x) => s + x * x, 0);

/**
 * Batch gradient descent from (w0, b0), keeping every state. Stops at the first state where a weight
 * or the bias is not finite, the sum of squared weights overflows a 64-bit number, or the cost is not
 * finite, exactly as training/model.py does. The parameter check is explicit: the logistic cost itself
 * stays finite when a probability reaches 0 or 1 (only the log's argument is clipped), so without it
 * only the lambda * sum(w^2) term would notice, and not at all when lambda is 0.
 */
export function descend(X: Matrix, y: number[], w0: number[], b0: number, alpha: number, iters: number, lambda = 0): Run {
  const t0 = performance.now();
  const h: State[] = [];
  let diverged: number | null = null;
  let w = w0.slice();
  let b = b0;
  for (let i = 0; i <= iters; i++) {
    const j = cost(X, y, w, b, lambda);
    if (!allFinite(w) || !Number.isFinite(b) || !Number.isFinite(sumSquares(w)) || !Number.isFinite(j)) { diverged = i; break; }
    const g = gradient(X, y, w, b, lambda);
    h.push({ w: w.slice(), b, j, gw: g.gw, gb: g.gb });
    w = w.map((v, k) => v - alpha * g.gw[k]);
    b -= alpha * g.gb;
  }
  return { h, diverged, ms: performance.now() - t0 };
}

/** The same descent for one feature, with w and the slope as single numbers. */
export function runOne(x: number[], y: number[], w0: number, b0: number, alpha: number, iters: number): OneRun {
  const r = descend(x.map((v) => [v]), y, [w0], b0, alpha, iters, 0);
  return {
    h: r.h.map((s) => ({ w: s.w[0], b: s.b, j: s.j, gw: s.gw[0], gb: s.gb })),
    diverged: r.diverged,
    ms: r.ms,
  };
}

/* ---------- one feature, fast ---------- */

/** Cost of f(x) = g(w x + b) on one feature. */
export function jOne(x: number[], y: number[], w: number, b: number): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += logLoss(sigmoid(w * x[i] + b), y[i]);
  return s / x.length;
}

/** Gradient [dJ/dw, dJ/db] of jOne. */
export function gradOne(x: number[], y: number[], w: number, b: number): [number, number] {
  let gw = 0;
  let gb = 0;
  for (let i = 0; i < x.length; i++) {
    const e = sigmoid(w * x[i] + b) - y[i];
    gw += e * x[i];
    gb += e;
  }
  return [gw / x.length, gb / x.length];
}

/** The squared-error cost with a sigmoid inside, 1/(2m) sum (f - y)^2, for the comparison step only. */
export function squaredOne(x: number[], y: number[], w: number, b: number): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    const e = sigmoid(w * x[i] + b) - y[i];
    s += e * e;
  }
  return s / (2 * x.length);
}

/* ---------- the pieces around the training ---------- */

const mean = (v: number[]) => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s / v.length;
};

/** Population mean and standard deviation. A (nearly) constant column gets sd = 1, as zscore_fit does. */
export function zscore(v: number[]): { z: number[]; mu: number; sd: number } {
  const mu = mean(v);
  let s = 0;
  for (let i = 0; i < v.length; i++) s += (v[i] - mu) * (v[i] - mu);
  let sd = Math.sqrt(s / v.length);
  if (sd < 1e-12) sd = 1;
  return { z: v.map((e) => (e - mu) / sd), mu, sd };
}

/** z-scored columns of X, with each column's mean and standard deviation. */
export function zscoreColumns(X: Matrix): { Z: Matrix; mu: number[]; sigma: number[] } {
  const n = X[0].length;
  const cols = Array.from({ length: n }, (_, j) => zscore(X.map((r) => r[j])));
  return { Z: X.map((_, i) => cols.map((c) => c.z[i])), mu: cols.map((c) => c.mu), sigma: cols.map((c) => c.sd) };
}

/** Counts of values in `bins` equal bins over [lo, hi). Values outside are ignored. */
export function hist(vals: number[], lo: number, hi: number, bins: number): number[] {
  const c = new Array<number>(bins).fill(0);
  for (const v of vals) {
    const i = Math.floor(((v - lo) / (hi - lo)) * bins);
    if (i >= 0 && i < bins) c[i]++;
  }
  return c;
}

/** Least-squares line through (xs, ys), as training/experiments.py fit_linear. */
export function fitLinear(xs: number[], ys: number[]): { w: number; b: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const w = sxy / (sxx || 1e-12);
  return { w, b: my - w * mx };
}

/** Where w x + b reaches 0.5. */
export const linearCrossing = (w: number, b: number) => (0.5 - b) / (w || 1e-12);

/** The nine terms up to degree three of two features, as training/experiments.py poly_features. */
export const polyFeatures = (x1: number, x2: number): number[] => [
  x1, x2, x1 * x1, x1 * x2, x2 * x2, x1 * x1 * x1, x1 * x1 * x2, x1 * x2 * x2, x2 * x2 * x2,
];

/**
 * The best weights and bias by Newton's method, found only to frame the plots (slider ranges and
 * presets). It plays no part in what the Lab teaches or in any run the visitor starts.
 */
export function fitNewton(X: Matrix, y: number[], lambda = 0, rounds = 60): { w: number[]; b: number; j: number } {
  const m = X.length;
  const n = X[0].length;
  const p = n + 1;
  let th = new Array<number>(p).fill(0);
  for (let r = 0; r < rounds; r++) {
    const w = th.slice(0, n);
    const f = predictProba(X, w, th[n]);
    const g = new Array<number>(p).fill(0);
    const H = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < m; i++) {
      const a = [...X[i], 1];
      const e = f[i] - y[i];
      const s = f[i] * (1 - f[i]);
      for (let u = 0; u < p; u++) {
        g[u] += (e * a[u]) / m;
        for (let v = 0; v < p; v++) H[u][v] += (s * a[u] * a[v]) / m;
      }
    }
    for (let u = 0; u < n; u++) { g[u] += (lambda / m) * th[u]; H[u][u] += lambda / m; }
    for (let u = 0; u < p; u++) H[u][u] += 1e-10;
    const step = solve(H, g);
    th = th.map((v, k) => v - step[k]);
    if (step.every((v) => Math.abs(v) < 1e-12)) break;
  }
  const w = th.slice(0, n);
  return { w, b: th[n], j: cost(X, y, w, th[n], lambda) };
}

/** Solve A x = r by Gaussian elimination with partial pivoting. */
function solve(A: number[][], r: number[]): number[] {
  const n = r.length;
  const M = A.map((row, i) => [...row, r[i]]);
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[best][c])) best = i;
    [M[c], M[best]] = [M[best], M[c]];
    const d = M[c][c] || 1e-12;
    for (let i = c + 1; i < n; i++) {
      const k = M[i][c] / d;
      for (let j = c; j <= n; j++) M[i][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / (M[i][i] || 1e-12);
  }
  return x;
}

/* ---------- the frozen model, applied ---------- */

/** What model.json holds that applying the model needs. */
export interface Frozen {
  features: readonly string[];
  weights: readonly number[];
  bias: number;
  scaling: { mu: readonly number[]; sigma: readonly number[] };
}

/** z-score the raw features with the saved mu and sigma, then g(w . z + b). Never writes to `model`. */
export function applyFrozen(model: Frozen, raw: readonly number[]): { z: number[]; score: number; p: number } {
  const z = raw.map((v, j) => (v - model.scaling.mu[j]) / (model.scaling.sigma[j] < 1e-12 ? 1 : model.scaling.sigma[j]));
  let score = model.bias;
  for (let j = 0; j < z.length; j++) score += z[j] * model.weights[j];
  return { z, score, p: sigmoid(score) };
}

/* ---------- timing the matrix form against the loops, measured in this browser ---------- */

/** The matrix flattened row by row into one typed array, for the matrix-form gradient. */
export function flatten(X: Matrix): { data: Float64Array; m: number; n: number } {
  const m = X.length;
  const n = X[0].length;
  const data = new Float64Array(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) data[i * n + j] = X[i][j];
  return { data, m, n };
}

/**
 * The gradient in matrix form: first the scores z = X w + b for every day, then the slopes
 * X^T (f - y) / m, each one tight pass over one flat array. Same numbers as `gradient`.
 */
export function gradientMatrix(flat: { data: Float64Array; m: number; n: number }, y: Float64Array, w: Float64Array, b: number): { gw: Float64Array; gb: number } {
  const { data, m, n } = flat;
  const err = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let z = b;
    const o = i * n;
    for (let j = 0; j < n; j++) z += data[o + j] * w[j];
    err[i] = sigmoid(z) - y[i];
  }
  const gw = new Float64Array(n);
  let gb = 0;
  for (let i = 0; i < m; i++) {
    const o = i * n;
    const e = err[i];
    for (let j = 0; j < n; j++) gw[j] += e * data[o + j];
    gb += e;
  }
  for (let j = 0; j < n; j++) gw[j] /= m;
  return { gw, gb: gb / m };
}

/** Milliseconds per call of `fn`, measured by repeating it until at least `minMs` have passed. */
export function timeIt(fn: () => unknown, minMs = 25, maxCalls = 2000): number {
  fn(); // warm up
  const t0 = performance.now();
  let calls = 0;
  let elapsed = 0;
  do {
    fn();
    calls++;
    elapsed = performance.now() - t0;
  } while (elapsed < minMs && calls < maxCalls);
  return elapsed / calls;
}
