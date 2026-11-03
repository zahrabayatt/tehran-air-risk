import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyFrozen, cost, costLoop, descend, fitLinear, fitNewton, flatten, gradOne, gradient, gradientLoop,
  gradientMatrix, hist, jOne, linearCrossing, logLoss, polyFeatures, predictProba, runOne, sigmoid,
  squaredOne, timeIt, zscore, zscoreColumns, MODEL_FEATURES,
} from './engine';
import type { Matrix, Sample } from './engine';
import fixtures from './fixtures.json';
import sampleJson from '../../public/data/sample.json';
import modelJson from '../../../model/model.json';

const sample = sampleJson as unknown as Sample;
const y = sample.rows.map((r) => r.y as number);
const X5: Matrix = sample.rows.map((r) => MODEL_FEATURES.map((k) => r[k] as number));
const x1: Matrix = sample.rows.map((r) => [r.pm2_5_mean / 10]);
const xs = x1.map((r) => r[0]);
const { Z: Z5 } = zscoreColumns(X5);

/** Within 1e-9 relative, with an absolute floor of 1e-9 for values near zero. */
function close(actual: number, expected: number, what: string) {
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tol);
}
function closeAll(actual: number[], expected: number[], what: string) {
  expect(actual.length, `${what} length`).toBe(expected.length);
  expected.forEach((e, i) => close(actual[i], e, `${what}[${i}]`));
}

afterEach(() => vi.restoreAllMocks());

describe('the sample', () => {
  it('has the rows the fixture was built from', () => {
    expect(sample.rows.length).toBe(fixtures.rows);
    expect(sample.rows.length).toBe(365);
  });
});

describe('sigmoid', () => {
  it('matches Python, is 0.5 at 0, and never overflows', () => {
    for (const c of fixtures.sigmoid) close(sigmoid(c.z), c.g, `g(${c.z})`);
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(-1000)).toBe(0);
    expect(sigmoid(1000)).toBe(1);
    for (const z of [-1e308, -745, 745, 1e308]) expect(Number.isFinite(sigmoid(z))).toBe(true);
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1, 15);
  });
});

describe('logLoss', () => {
  it('matches Python, including the clip at a probability of exactly 0 or 1', () => {
    for (const c of fixtures.loss) close(logLoss(c.f, c.y), c.loss, `loss(${c.f}, ${c.y})`);
    expect(Number.isFinite(logLoss(1, 0))).toBe(true);
    expect(Number.isFinite(logLoss(0, 1))).toBe(true);
    expect(logLoss(0.5, 1)).toBeCloseTo(Math.LN2, 12);
  });
});

describe('zscore', () => {
  it('returns z-values with population mean and standard deviation', () => {
    const r = zscore([1, 2, 3, 4]);
    expect(r.mu).toBe(2.5);
    expect(r.sd).toBeCloseTo(Math.sqrt(1.25), 12);
    expect(r.z[0]).toBeCloseTo(-1.5 / Math.sqrt(1.25), 12);
  });
  it('gives a constant column sd = 1 so nothing divides by zero', () => {
    const r = zscore([7, 7, 7]);
    expect(r.sd).toBe(1);
    expect(r.z).toEqual([0, 0, 0]);
  });
  it('matches the Python scaler on the live model features of the sample', () => {
    const r = zscoreColumns(X5);
    closeAll(r.mu, fixtures.zscore.mu, 'mu');
    closeAll(r.sigma, fixtures.zscore.sigma, 'sigma');
    fixtures.zscore.first.forEach((row, i) => closeAll(r.Z[i], row, `Z[${i}]`));
  });
});

describe('hist', () => {
  it('counts values into equal bins and ignores values outside [lo, hi)', () => {
    expect(hist([0, 0.5, 1.2, 1.9, 2.5, 3, -1, 4], 0, 4, 4)).toEqual([2, 2, 1, 1]);
  });
});

describe('cost and gradient', () => {
  it('match Python at fixed points, in the vectorized and the loop forms', () => {
    for (const p of fixtures.points) {
      close(cost(x1, y, [p.w], p.b), p.cost, `cost (${p.w}, ${p.b})`);
      close(costLoop(x1, y, [p.w], p.b), p.costLoop, `costLoop (${p.w}, ${p.b})`);
      close(jOne(xs, y, p.w, p.b), p.cost, `jOne (${p.w}, ${p.b})`);
      close(squaredOne(xs, y, p.w, p.b), p.squared, `squared (${p.w}, ${p.b})`);
      const g = gradient(x1, y, [p.w], p.b);
      close(g.gw[0], p.gw, 'gw');
      close(g.gb, p.gb, 'gb');
      const l = gradientLoop(x1, y, [p.w], p.b);
      close(l.gw[0], p.gwLoop, 'gwLoop');
      close(l.gb, p.gbLoop, 'gbLoop');
      const [gw, gb] = gradOne(xs, y, p.w, p.b);
      close(gw, p.gw, 'gradOne gw');
      close(gb, p.gb, 'gradOne gb');
    }
  });

  it('the matrix form gives the same slopes as the loops', () => {
    const w = [0.3, -0.2, 0.1, 0.4, 0.9];
    const a = gradient(Z5, y, w, -0.5);
    const m = gradientMatrix(flatten(Z5), Float64Array.from(y), Float64Array.from(w), -0.5);
    closeAll(Array.from(m.gw), a.gw, 'gw');
    close(m.gb, a.gb, 'gb');
  });

  it('the gradient is the slope of the cost (numeric check)', () => {
    const w = [0.4, -0.3, 0.2, 0.1, 0.6];
    const b = -0.2;
    const lam = 25;
    const g = gradient(Z5, y, w, b, lam);
    const h = 1e-6;
    for (let j = 0; j < w.length; j++) {
      const up = w.slice();
      const dn = w.slice();
      up[j] += h;
      dn[j] -= h;
      expect(g.gw[j]).toBeCloseTo((cost(Z5, y, up, b, lam) - cost(Z5, y, dn, b, lam)) / (2 * h), 6);
    }
    expect(g.gb).toBeCloseTo((cost(Z5, y, w, b + h, lam) - cost(Z5, y, w, b - h, lam)) / (2 * h), 6);
  });

  it('the penalty applies to the weights and never to the bias', () => {
    const w = [1, 2, 0, 0, 0];
    const free = cost(Z5, y, w, 3, 0);
    expect(cost(Z5, y, w, 3, 100) - free).toBeCloseTo((100 / (2 * Z5.length)) * 5, 12);
    expect(gradient(Z5, y, w, 3, 100).gb).toBe(gradient(Z5, y, w, 3, 0).gb);
  });

  it('a probability pinned at 0 or 1 still gives a finite cost', () => {
    expect(Number.isFinite(cost(x1, y, [1e6], -3e6))).toBe(true);
    expect(Number.isFinite(cost(x1, y, [-1e6], 3e6))).toBe(true);
  });
});

describe('runOne', () => {
  for (const c of fixtures.runOne) {
    it(`matches Python: ${c.name}`, () => {
      const r = runOne(xs, y, c.w0, c.b0, c.alpha, c.iters);
      expect(r.diverged).toBe(c.divergedAt);
      const states = c.divergedAt ?? c.iters + 1;
      expect(r.h.length).toBe(states);
      close(r.h[0].j, c.j0, 'j0');
      // jHistory[k - 1] is the cost of state k.
      for (let k = 1; k < states; k++) close(r.h[k].j, c.jHistory[k - 1], `j[${k}]`);
      for (const p of c.checkpoints) {
        const h = r.h[p.k];
        close(h.w, p.w as number, `w k=${p.k}`);
        close(h.b, p.b, `b k=${p.k}`);
        close(h.j, p.j, `j k=${p.k}`);
        close(h.gw, p.gw as number, `gw k=${p.k}`);
        close(h.gb, p.gb, `gb k=${p.k}`);
      }
    });
  }

  it('with iters = 0 returns just the starting point', () => {
    const r = runOne(xs, y, 1, -2, 0.1, 0);
    expect(r.h.length).toBe(1);
    expect(r.h[0].w).toBe(1);
    expect(r.h[0].b).toBe(-2);
    expect(r.diverged).toBeNull();
  });

  it('does not change its inputs', () => {
    const xCopy = xs.slice();
    const yCopy = y.slice();
    runOne(xs, y, 0, 0, 0.1, 50);
    expect(xs).toEqual(xCopy);
    expect(y).toEqual(yCopy);
  });
});

describe('descend on many features', () => {
  for (const c of fixtures.runMulti) {
    it(`matches Python: ${c.name}`, () => {
      const X = c.scaled ? Z5 : X5;
      const r = descend(X, y, new Array(X[0].length).fill(0), 0, c.alpha, c.iters, c.lambda);
      expect(r.diverged).toBe(c.divergedAt);
      const states = c.divergedAt ?? c.iters + 1;
      expect(r.h.length).toBe(states);
      close(r.h[0].j, c.j0, 'j0');
      for (let k = 1; k < states; k++) close(r.h[k].j, c.jHistory[k - 1], `j[${k}]`);
      for (const p of c.checkpoints) {
        closeAll(r.h[p.k].w, p.w, `w k=${p.k}`);
        close(r.h[p.k].b, p.b, `b k=${p.k}`);
        closeAll(r.h[p.k].gw, p.gw, `gw k=${p.k}`);
        close(r.h[p.k].gb, p.gb, `gb k=${p.k}`);
      }
    });
  }
});

describe('the polynomial fit', () => {
  const idx = Array.from({ length: 46 }, (_, k) => 4 + 8 * k);
  const zpm = zscore(sample.rows.map((r) => r.pm2_5_mean)).z;
  const zcos = zscore(sample.rows.map((r) => r.season_cos)).z;
  for (const c of fixtures.poly) {
    it(`matches Python: ${c.name}`, () => {
      const P = idx.map((i) => polyFeatures(zpm[i], zcos[i]));
      const { Z, mu, sigma } = zscoreColumns(P);
      closeAll(mu, c.mu, 'mu');
      closeAll(sigma, c.sigma, 'sigma');
      Z.slice(0, 3).forEach((row, i) => closeAll(row, c.first[i], `Z[${i}]`));
      const ys = idx.map((i) => y[i]);
      const alpha = 1 / (2.5 + c.lambda / ys.length);
      close(alpha, c.alpha, 'alpha');
      const r = descend(Z, ys, new Array(9).fill(0), 0, alpha, c.iters, c.lambda);
      expect(r.diverged).toBeNull();
      expect(r.h.length).toBe(c.iters + 1);
      for (let k = 1; k <= c.iters; k++) close(r.h[k].j, c.jHistory[k - 1], `j[${k}]`);
      const last = r.h[r.h.length - 1];
      closeAll(last.w, c.w, 'w');
      close(last.b, c.b, 'b');
      close(cost(Z, ys, last.w, last.b, 0), c.plainCost, 'plain cost');
    });
  }
});

describe('divergence', () => {
  it('stops at once with a huge learning rate, reports the iteration, and keeps every number finite', () => {
    for (const alpha of [1e308, Infinity]) {
      const r = descend(Z5, y, [0, 0, 0, 0, 0], 0, alpha, 100);
      expect(r.diverged).not.toBeNull();
      expect(r.diverged as number).toBeLessThanOrEqual(2);
      expect(r.h.length).toBe(r.diverged);
      for (const s of r.h) {
        expect(Number.isFinite(s.j)).toBe(true);
        expect(s.w.every(Number.isFinite)).toBe(true);
        expect(s.gw.every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(s.b)).toBe(true);
      }
    }
  });

  it('a large but finite rate bounces without stopping, because the logistic cost is bounded', () => {
    const r = runOne(xs, y, 0, 0, 3, 60);
    expect(r.diverged).toBeNull();
    expect(Math.max(...r.h.map((s) => s.j))).toBeLessThan(40);
  });

  it('a run from a non-finite start stops at state 0 with nothing kept', () => {
    const r = runOne(xs, y, NaN, 0, 0.1, 10);
    expect(r.diverged).toBe(0);
    expect(r.h.length).toBe(0);
  });
});

describe('fitLinear and the crossing', () => {
  it('matches the Python least-squares line', () => {
    const f = fitLinear(xs, y);
    close(f.w, fixtures.linear.w, 'w');
    close(f.b, fixtures.linear.b, 'b');
    close(linearCrossing(f.w, f.b), fixtures.linear.crossing, 'crossing');
  });
  it('moves right when far positive days are added', () => {
    const base = fitLinear(xs, y);
    const far = Array.from({ length: 5 }, (_, i) => 13 + i * 0.4);
    const moved = fitLinear(xs.concat(far), y.concat(far.map(() => 1)));
    expect(linearCrossing(moved.w, moved.b)).toBeGreaterThan(linearCrossing(base.w, base.b));
  });
});

describe('polyFeatures', () => {
  it('gives the nine terms up to degree three', () => {
    expect(polyFeatures(2, 3)).toEqual([2, 3, 4, 6, 9, 8, 12, 18, 27]);
  });
});

describe('fitNewton', () => {
  it('finds the lowest cost, which gradient descent approaches from above', () => {
    const star = fitNewton(x1, y);
    const run = runOne(xs, y, 0, 0, 0.3, 400);
    expect(star.j).toBeLessThanOrEqual(run.h[run.h.length - 1].j + 1e-12);
    const [gw, gb] = gradOne(xs, y, star.w[0], star.b);
    expect(Math.abs(gw)).toBeLessThan(1e-8);
    expect(Math.abs(gb)).toBeLessThan(1e-8);
  });
});

describe('applyFrozen', () => {
  const model = modelJson as unknown as Parameters<typeof applyFrozen>[0];
  it('gives the probabilities Python gives for the saved model', () => {
    fixtures.frozen.first.forEach((p, i) => {
      close(applyFrozen(model, X5[i]).p, p, `p[${i}]`);
    });
    closeAll(applyFrozen(model, X5[0]).z, fixtures.frozen.z0, 'z0');
    const f = predictProba(
      X5.map((r) => applyFrozen(model, r).z), Array.from(model.weights), model.bias,
    );
    close(f.reduce((s, v, i) => s + logLoss(v, y[i]), 0) / y.length, fixtures.frozen.cost, 'cost');
  });
  it('never changes the model it is given', () => {
    const before = JSON.stringify(modelJson);
    const frozen = JSON.parse(before) as typeof model;
    applyFrozen(frozen, X5[3]);
    expect(JSON.stringify(frozen)).toBe(before);
  });
});

describe('season features', () => {
  it('the circle formula matches Python', () => {
    for (const s of fixtures.season) {
      const a = (2 * Math.PI * s.day) / 365.25;
      close(Math.sin(a), s.sin, `sin ${s.day}`);
      close(Math.cos(a), s.cos, `cos ${s.day}`);
    }
  });
});

describe('timeIt', () => {
  it('measures a positive, finite time per call', () => {
    const flat = flatten(Z5);
    const t = timeIt(() => gradientMatrix(flat, Float64Array.from(y), new Float64Array(5), 0), 2, 50);
    expect(t).toBeGreaterThan(0);
    expect(Number.isFinite(t)).toBe(true);
  });
});
