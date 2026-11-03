import {
  descend, fitNewton, flatten, gradientLoop, gradientMatrix, jOne, logLoss, polyFeatures, runOne, sigmoid, timeIt, zscore,
  zscoreColumns,
} from './engine';
import type { Matrix, OneRun, Sample, SampleRow, TrainMonth } from './engine';
import { mean, niceTop, percentile } from './format';
import type { Domain } from './plotkit';

/** One entry of data/predictions.json, as far as the Lab reads it. */
export interface PredictionEntry {
  issued_at: string;
  target_date: string;
  gap?: boolean;
}

export interface Candidate {
  feature_set: string;
  features: string[];
  lambda: number;
  diverged: boolean;
  train_cost: number | null;
  selection_cost: number | null;
  chosen: boolean;
}

/** The parts of model/model.json the Lab reads. The Lab never writes any of it. */
export interface LabModel {
  version: number;
  features: string[];
  weights: number[];
  bias: number;
  scaling: { mu: number[]; sigma: number[] };
  hyperparameters: { alpha: number; lambda: number; iterations: number };
  threshold: number;
  decision_threshold: number;
  cutoff: string;
  cost: { train: number; selection: number; held_out: number };
  baselines: {
    overall: { rate: number; held_out_cost: number };
    monthly: { rates: number[]; fallback_months: number[]; held_out_cost: number };
  };
  beats_baselines: boolean;
  sklearn_cost: { held_out: number; train: number; C?: number; max_abs_weight_difference?: number };
  held_out_probabilities: { bins: number[]; counts_y1: number[]; counts_y0: number[] };
  candidates: Candidate[];
  rows: { train: number; selection: number; held_out: number };
  trained_at: string;
  runtime_ms: number;
  environment: { python: string; numpy: string; os: string };
  vectorization: { elements: number; loop_ms: number; numpy_ms: number };
}

export interface LabInputs {
  sample: Sample;
  model: LabModel;
  predictions: PredictionEntry[];
}

/** What the Lab stages work from: the sample's training days as columns. */
export interface LabData {
  rows: SampleRow[];
  n: number;
  /** The names of the fourteen raw features, in sample.json order. */
  features: string[];
  y: number[];
  /** PM2.5 so far today, μg/m³: the mean of the 12 hours before the cutoff. */
  pm: number[];
  /** The same in tens of μg/m³, the x of the early steps. */
  x: number[];
  /** Mean PM2.5 of the target day, μg/m³. */
  tomorrow: number[];
  /** Mean wind speed before the cutoff, in tens of km/h. */
  wind: number[];
  cos: number[];
  sin: number[];
  /** Calendar month (1 to 12) of the target date. */
  month: number[];
  /** PM2.5 z-scored with the sample's own mean and standard deviation. */
  zpm: number[];
  muPm: number;
  sdPm: number;
  /** The five features of the live model, raw and z-scored on the sample. */
  X5: Matrix;
  Z5: Matrix;
  mu5: number[];
  sd5: number[];
}

export function makeLabData(sample: Sample): LabData {
  const rows = sample.rows.map((r) => ({ ...r }));
  const pm = rows.map((r) => r.pm2_5_mean);
  const zp = zscore(pm);
  const X5 = rows.map((r) => [r.pm2_5_mean, r.pm2_5_max, r.pm2_5_last, r.season_sin, r.season_cos]);
  const sc = zscoreColumns(X5);
  return {
    rows,
    n: rows.length,
    features: sample.features.slice(),
    y: rows.map((r) => r.y),
    pm,
    x: pm.map((v) => v / 10),
    tomorrow: rows.map((r) => r.pm_tomorrow),
    wind: rows.map((r) => r.wind_mean / 10),
    cos: rows.map((r) => r.season_cos),
    sin: rows.map((r) => r.season_sin),
    month: rows.map((r) => Number(r.target_date.slice(5, 7))),
    zpm: zp.z,
    muPm: zp.mu,
    sdPm: zp.sd,
    X5,
    Z5: sc.Z,
    mu5: sc.mu,
    sd5: sc.sigma,
  };
}

/** Freeze an object and everything inside it, so any later write throws. */
export function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export interface PredictionSummary {
  logged: number;
  days: number;
  lastIssuedAt: string | null;
}

export function summarizePredictions(entries: PredictionEntry[]): PredictionSummary {
  const made = entries.filter((e) => e.gap !== true);
  const times = entries.map((e) => Date.parse(e.issued_at)).filter(Number.isFinite);
  return {
    logged: made.length,
    days: new Set(made.map((e) => e.target_date)).size,
    lastIssuedAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/** Best weights and bias, found by Newton's method only to frame plots and presets. */
export interface Fit { w: number[]; b: number; j: number }

export interface PolyFitResult {
  w: number[];
  b: number;
  mu: number[];
  sigma: number[];
  lambda: number;
  /** Cost without the penalty, on the days the fit used. */
  plainCost: number;
  history: number[];
  diverged: number | null;
}

export interface SandboxResult {
  train: number;
  held: number;
  /** Logistic cost on the days after the first `train` days. */
  model: number;
  overall: number;
  monthly: number;
  diverged: number | null;
}

export interface Timing { loopMs: number; matrixMs: number; products: number }

export interface LabCtx {
  d: LabData;
  /** A frozen copy of the model: the Lab can read it and cannot change it. */
  model: LabModel;
  predictions: PredictionSummary;
  /** Share of training days above the threshold, by calendar month: West Tehran, and all 12 squares pooled. */
  months: TrainMonth[];
  /** Best one-feature fit on x (PM2.5 in tens), its cost, and where it crosses 0.5. */
  star: { w: number; b: number; j: number; x0: number };
  /** Best two-feature fits: PM2.5 with wind, and PM2.5 with season_cos. */
  pair: { wind: Fit; season: Fit };
  /** Axis domains, from the data. */
  dom: { x: Domain; pm: Domain; wind: Domain; tomorrow: Domain; w: Domain; b: Domain; thresh: Domain };
  /** The 60 days evenly spread through the sample used by the linear-regression step. */
  base: number[];
  /** x of the i-th very polluted day added in the linear-regression step: beyond every real day. */
  farX: (i: number) => number;
  /** The days the polynomial step trains on, and their z-scored features. */
  sub: { idx: number[]; z1: number[]; z2: number[]; y: number[] };
  /** Share of sample days whose target-day PM2.5 is above a threshold. */
  share: (threshold: number) => number;
  memo: <T>(key: string, make: () => T) => T;
}

export const BASE_DAYS = 60;
export const POLY_ITERS = 600;
export const SANDBOX_ITERS = 1500;

export function makeCtx(inputs: LabInputs): LabCtx {
  const d = makeLabData(inputs.sample);
  const model = deepFreeze(JSON.parse(JSON.stringify(inputs.model)) as LabModel);
  const star1 = fitNewton(d.x.map((v) => [v]), d.y);
  const xMax = Math.max(...d.x);
  const stride = Math.max(1, Math.floor(d.n / BASE_DAYS));
  const base = Array.from({ length: Math.min(BASE_DAYS, d.n) }, (_, i) => i * stride);

  const zcos = zscore(d.cos).z;
  const idx: number[] = [];
  for (let i = 4; i < d.n; i += 8) idx.push(i);

  const w1 = star1.w[0];
  const cache = new Map<string, unknown>();
  const memo = <T,>(key: string, make: () => T): T => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key) as T;
  };

  return {
    d,
    model,
    predictions: summarizePredictions(inputs.predictions),
    months: inputs.sample.train_months.map((m) => ({ ...m })),
    star: { w: w1, b: star1.b, j: star1.j, x0: -star1.b / w1 },
    pair: {
      wind: fitNewton(d.x.map((v, i) => [v, d.wind[i]]), d.y),
      season: fitNewton(d.x.map((v, i) => [v, d.cos[i]]), d.y),
    },
    dom: {
      x: [0, niceTop(xMax)],
      pm: [0, niceTop(Math.max(...d.pm, ...d.tomorrow))],
      wind: [0, niceTop(Math.max(...d.wind))],
      tomorrow: [0, niceTop(Math.max(...d.tomorrow))],
      w: [-1, Math.max(2, Math.ceil(3 * w1))],
      b: [Math.min(-2, Math.floor(3.3 * star1.b)), 2],
      // The threshold slider spans the 5th to the 95th percentile of tomorrow's PM2.5, to the nearest 5, and always holds 35.4 and 55.4.
      thresh: [
        Math.min(35, Math.floor(percentile(d.tomorrow, 5) / 5) * 5),
        Math.max(60, Math.ceil(percentile(d.tomorrow, 95) / 5) * 5),
      ],
    },
    base,
    farX: (i) => xMax * 1.2 + i * 0.4,
    sub: { idx, z1: idx.map((i) => d.zpm[i]), z2: idx.map((i) => zcos[i]), y: idx.map((i) => d.y[i]) },
    share: (t) => d.tomorrow.filter((v) => v > t).length / d.n,
    memo,
  };
}

/* ---------- memoized runs, so a replay never recomputes ---------- */

/** Which feature a one-feature run trains on: x (PM2.5 in tens), z (PM2.5 z-scored) or pm (raw μg/m³). */
export type Feature1 = 'x' | 'z' | 'pm';

export function oneRun(ctx: LabCtx, on: Feature1, w0: number, b0: number, alpha: number, iters: number): OneRun {
  return ctx.memo(`one|${on}|${w0}|${b0}|${alpha}|${iters}`, () => {
    const col = on === 'x' ? ctx.d.x : on === 'z' ? ctx.d.zpm : ctx.d.pm;
    return runOne(col, ctx.d.y, w0, b0, alpha, iters);
  });
}

/** Cost of the one-feature model at (w, b) on x. */
export const costAt = (ctx: LabCtx, w: number, b: number) => jOne(ctx.d.x, ctx.d.y, w, b);

/** Season alone: a one-feature logistic fit on season_cos, found by gradient descent. Used to draw the curve. */
export function seasonFit(ctx: LabCtx): { w: number; b: number } {
  return ctx.memo('season-fit', () => {
    const r = descend(ctx.d.cos.map((v) => [v]), ctx.d.y, [0], 0, 0.8, 600);
    const last = r.h[r.h.length - 1];
    return { w: last.w[0], b: last.b };
  });
}

/* ---------- the polynomial step ---------- */

/** Step size for the polynomial fit: half the largest stable one, 1 / (2.5 + lambda / m). */
export const polyAlpha = (lambda: number, rows: number) => 1 / (2.5 + lambda / rows);

export function polyFit(ctx: LabCtx, lambda: number, iters = POLY_ITERS): PolyFitResult {
  return ctx.memo(`poly|${lambda}|${iters}`, () => {
    const { z1, z2, y } = ctx.sub;
    const P = z1.map((v, i) => polyFeatures(v, z2[i]));
    const { Z, mu, sigma } = zscoreColumns(P);
    const r = descend(Z, y, new Array<number>(9).fill(0), 0, polyAlpha(lambda, y.length), iters, lambda);
    const last = r.h[r.h.length - 1];
    const plain = mean(
      Z.map((row, i) => {
        let s = last.b;
        for (let j = 0; j < 9; j++) s += row[j] * last.w[j];
        return logLoss(sigmoid(s), y[i]);
      }),
    );
    return { w: last.w, b: last.b, mu, sigma, lambda, plainCost: plain, history: r.h.slice(1).map((s) => s.j), diverged: r.diverged };
  });
}

/** Probability of the polynomial fit at a point in the (z-scored PM2.5, z-scored season_cos) plane. */
export function polyProb(fit: PolyFitResult, z1: number, z2: number): number {
  const f = polyFeatures(z1, z2);
  let s = fit.b;
  for (let j = 0; j < 9; j++) s += ((f[j] - fit.mu[j]) / fit.sigma[j]) * fit.w[j];
  return sigmoid(s);
}

/* ---------- the sandbox split of the final step ---------- */

const constantCost = (p: number, y: number[]) => mean(y.map((v) => logLoss(p, v)));

/** Train on the sample's first k days with the live model's features, α and λ; judge on the days after them. */
export function sandbox(ctx: LabCtx, k: number): SandboxResult {
  return ctx.memo(`sandbox|${k}`, () => {
    const { d } = ctx;
    const sc = zscoreColumns(d.X5.slice(0, k));
    const h = ctx.model.hyperparameters;
    const run = descend(sc.Z, d.y.slice(0, k), new Array<number>(5).fill(0), 0, h.alpha, SANDBOX_ITERS, h.lambda);
    const last = run.h[run.h.length - 1];
    const heldY = d.y.slice(k);
    const probs = d.X5.slice(k).map((r) => {
      let s = last.b;
      for (let j = 0; j < 5; j++) s += ((r[j] - sc.mu[j]) / sc.sigma[j]) * last.w[j];
      return sigmoid(s);
    });
    const overall = mean(d.y.slice(0, k));
    const byMonth = new Map<number, number[]>();
    d.y.slice(0, k).forEach((v, i) => byMonth.set(d.month[i], [...(byMonth.get(d.month[i]) ?? []), v]));
    const monthlyP = d.month.slice(k).map((mo) => (byMonth.has(mo) ? mean(byMonth.get(mo) as number[]) : overall));
    return {
      train: k,
      held: d.n - k,
      model: mean(probs.map((p, i) => logLoss(p, heldY[i]))),
      overall: constantCost(overall, heldY),
      monthly: mean(monthlyP.map((p, i) => logLoss(p, heldY[i]))),
      diverged: run.diverged,
    };
  });
}

/* ---------- the vectorization step ---------- */

/**
 * The sample's days repeated to `m` rows, with the first `nf` of its fourteen features (in tens, so
 * values stay small), then the gradient timed as plain loops and in matrix form. Measured here, every time.
 */
export function timing(ctx: LabCtx, m: number, nf: number): Timing {
  return ctx.memo(`timing|${m}|${nf}`, () => {
    const names = ctx.d.features;
    const X: Matrix = Array.from({ length: m }, (_, i) => {
      const r = ctx.d.rows[i % ctx.d.n];
      return Array.from({ length: nf }, (__, j) => Number(r[names[j % names.length]]) / 10);
    });
    const y = Array.from({ length: m }, (_, i) => ctx.d.y[i % ctx.d.n]);
    const w = new Array<number>(nf).fill(0.01);
    const flat = flatten(X);
    const yF = Float64Array.from(y);
    const wF = Float64Array.from(w);
    return {
      loopMs: timeIt(() => gradientLoop(X, y, w, 0)),
      matrixMs: timeIt(() => gradientMatrix(flat, yF, wF, 0)),
      products: m * nf,
    };
  });
}
