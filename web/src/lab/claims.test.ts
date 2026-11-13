import { describe, expect, it } from 'vitest';
import { oneRun, polyFit, polyProb, sandbox, seasonFit } from './context';
import { jOne, sigmoid, squaredOne } from './engine';
import { itersNum } from './state';
import { STAGES } from './stages';
import { ctx } from './testData';
import type { LabState, Try } from './types';
import profile from '../../public/data/profile.json';
import { DAILY_RUN_TEHRAN, DAILY_RUN_UTC } from '../config';
import { baselineCosts, costByLambda, pipeline, verdict } from './views/result';
import { linearFit, trainShares } from './views/problem';

/**
 * Each Try this preset says what it shows. These tests run the preset's settings on the real sample
 * and check that the sentence is true. If the data changes and a sentence stops being true, a test
 * here fails and the note has to be rewritten.
 */

const stage = (title: string) => {
  const s = STAGES.find((q) => q.title === title);
  if (!s) throw new Error(title);
  return s;
};
const preset = (title: string, label: string): Partial<LabState> => {
  const t: Try | undefined = stage(title).tries.find((q) => q.label === label);
  if (!t) throw new Error(`${title}: ${label}`);
  return typeof t.set === 'function' ? t.set(ctx) : t.set;
};
const alphaOf = (p: Partial<LabState>) => 10 ** (p.alphaExp as number);
const itersOf = (p: Partial<LabState>) => itersNum(p.iters as string);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (a: number[], b: number[]) => {
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  a.forEach((v, i) => { sab += (v - ma) * (b[i] - mb); saa += (v - ma) ** 2; sbb += (b[i] - mb) ** 2; });
  return sab / Math.sqrt(saa * sbb);
};

describe('Data presets', () => {
  it('winter months are mostly above 35.4 in West Tehran and summer months almost never', () => {
    const rate = (m: number) => ctx.months.find((x) => x.month === m)!.cell_rate;
    for (const m of [10, 11, 12, 1, 2, 3]) expect(rate(m), `month ${m}`).toBeGreaterThan(0.5);
    for (const m of [5, 6, 7, 8]) expect(rate(m), `month ${m}`).toBeLessThan(0.1);
  });
  it('today so far leans toward tomorrow', () => {
    expect(corr(ctx.d.pm, ctx.d.tomorrow)).toBeGreaterThan(0.5);
  });
  it('West Tehran’s training share above 35.4 is higher than the pooled share of all 12 squares', () => {
    const t = trainShares(ctx);
    expect(Number(t.cell)).toBeGreaterThan(Number(t.pooled));
  });
});

describe('Label and timing presets', () => {
  it('a stricter threshold leaves fewer positive days', () => {
    const p = preset('Label and timing', 'A stricter threshold');
    expect(ctx.share(p.thresh as number)).toBeLessThan(ctx.share(35.4) * 0.7);
  });
  it('the sample’s label at 35.4 is the label stored in sample.json', () => {
    const n = ctx.d.tomorrow.filter((v, i) => (v > 35.4 ? 1 : 0) !== ctx.d.y[i]).length;
    expect(n).toBe(0);
  });
});

describe('Why not linear regression? presets', () => {
  it('five very polluted days move the crossing right and flip ordinary days from 1 to 0', () => {
    const p = preset('Why not linear regression?', 'Add five very polluted days');
    const base = linearFit(ctx, 0);
    const far = linearFit(ctx, p.far as number);
    expect(far.cross).toBeGreaterThan(base.cross + 0.3);
    const flipped = ctx.d.x.filter((x) => base.w * x + base.b >= 0.5 && far.w * x + far.b < 0.5).length;
    expect(flipped).toBeGreaterThan(0);
    expect(linearFit(ctx, (preset('Why not linear regression?', 'Back to the original days').far as number)).cross).toBe(base.cross);
  });
  it('the added days lie beyond every real day', () => {
    expect(ctx.farX(0)).toBeGreaterThan(Math.max(...ctx.d.x));
  });
});

describe('Sigmoid presets', () => {
  it('z = 0 gives exactly 0.5, 5 is nearly 1 and −5 nearly 0', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(5)).toBeGreaterThan(0.99);
    expect(sigmoid(-5)).toBeLessThan(0.01);
  });
});

describe('Logistic model presets', () => {
  const crossing = (w: number, b: number) => -b / w;
  it('a gentle curve is softer than the best one and crosses 0.5 at the same PM2.5', () => {
    const g = preset('Logistic model', 'Gentle curve');
    expect(g.w0 as number).toBeLessThan(ctx.star.w / 2);
    expect(Math.abs(crossing(g.w0 as number, g.b0 as number) - ctx.star.x0)).toBeLessThan(0.1);
  });
  it('a steep curve is much steeper and crosses at the same place', () => {
    const s = preset('Logistic model', 'Steep curve');
    expect(s.w0 as number).toBeGreaterThan(ctx.star.w * 2);
    expect(Math.abs(crossing(s.w0 as number, s.b0 as number) - ctx.star.x0)).toBeLessThan(0.1);
    expect(s.w0 as number).toBeLessThanOrEqual(ctx.dom.w[1]);
    expect(s.b0 as number).toBeGreaterThanOrEqual(ctx.dom.b[0]);
  });
  it('shifting b moves the crossing without changing the steepness', () => {
    const s = preset('Logistic model', 'Shift the curve');
    expect(s.w0).toBeCloseTo(ctx.star.w, 1);
    expect(crossing(s.w0 as number, s.b0 as number)).toBeGreaterThan(ctx.star.x0 + 0.5);
  });
  it('every preset stays inside the sliders', () => {
    for (const label of ['Gentle curve', 'Steep curve', 'Shift the curve']) {
      const p = preset('Logistic model', label);
      expect(p.w0 as number).toBeGreaterThanOrEqual(ctx.dom.w[0]);
      expect(p.w0 as number).toBeLessThanOrEqual(ctx.dom.w[1]);
      expect(p.b0 as number).toBeGreaterThanOrEqual(ctx.dom.b[0]);
      expect(p.b0 as number).toBeLessThanOrEqual(ctx.dom.b[1]);
    }
  });
});

describe('Decision boundary presets', () => {
  const at = (label: string) => preset('Decision boundary', label) as { v1: number; v2: number; vb: number };
  it('Pollution only is almost vertical', () => {
    const p = at('Pollution only');
    expect(Math.abs(p.v2)).toBeLessThan(0.1 * Math.abs(p.v1));
  });
  it('the fitted wind weight is close to zero beside the PM2.5 weight', () => {
    const p = at('Include wind');
    expect(Math.abs(p.v2)).toBeLessThan(0.2 * Math.abs(p.v1));
  });
  it('the fitted season weight is large and the boundary sits at a lower PM2.5 in winter than in summer', () => {
    const p = at('Include season');
    expect(Math.abs(p.v2)).toBeGreaterThan(Math.abs(p.v1));
    const x1At = (cos: number) => -(p.v2 * cos + p.vb) / p.v1;
    expect(x1At(1)).toBeLessThan(x1At(-1) - 3);
    expect(x1At(1)).toBeLessThan(ctx.dom.x[0] + 1);
    expect(x1At(-1)).toBeGreaterThan(Math.max(...ctx.d.x) * 0.8);
  });
  it('all three fit inside the sliders', () => {
    for (const label of ['Pollution only', 'Include wind', 'Include season']) {
      const p = at(label);
      expect(p.v1).toBeGreaterThanOrEqual(ctx.dom.w[0]);
      expect(p.v1).toBeLessThanOrEqual(ctx.dom.w[1]);
      expect(Math.abs(p.v2)).toBeLessThanOrEqual(3);
      expect(p.vb).toBeGreaterThanOrEqual(ctx.dom.b[0]);
      expect(p.vb).toBeLessThanOrEqual(ctx.dom.b[1]);
    }
  });
});

describe('Why not squared error? presets', () => {
  it('A very wrong model: squared error is flat while the logistic cost still changes clearly', () => {
    const p = preset('Why not squared error?', 'A very wrong model');
    const { w0: w, b0: b } = p as { w0: number; b0: number };
    const dSq = Math.abs(squaredOne(ctx.d.x, ctx.d.y, w + 0.5, b) - squaredOne(ctx.d.x, ctx.d.y, w, b));
    const dLg = Math.abs(jOne(ctx.d.x, ctx.d.y, w + 0.5, b) - jOne(ctx.d.x, ctx.d.y, w, b));
    expect(dSq).toBeLessThan(0.005);
    expect(dLg).toBeGreaterThan(20 * dSq);
  });
  it('along w, near the best line, the logistic cost curves upward (a bowl)', () => {
    const w = ctx.star.w;
    const b = ctx.star.b;
    const j = (dw: number) => jOne(ctx.d.x, ctx.d.y, w + dw, b);
    expect(j(-0.3) + j(0.3)).toBeGreaterThan(2 * j(0));
  });
});

describe('Cost function presets', () => {
  it('Worse boundary costs more than Better boundary, and Better is near the lowest cost', () => {
    const worse = preset('Cost function', 'Worse boundary') as { w0: number; b0: number };
    const better = preset('Cost function', 'Better boundary') as { w0: number; b0: number };
    const jw = jOne(ctx.d.x, ctx.d.y, worse.w0, worse.b0);
    const jb = jOne(ctx.d.x, ctx.d.y, better.w0, better.b0);
    expect(jw).toBeGreaterThan(jb + 0.03);
    expect(jb).toBeLessThan(ctx.star.j * 1.01);
  });
});

describe('Logistic loss presets', () => {
  it('confident and right is tiny, confident and wrong is large, unsure is moderate', () => {
    const loss = (f: number, y: number) => -(y * Math.log(f) + (1 - y) * Math.log(1 - f));
    expect(loss(0.95, 1)).toBeLessThan(0.06);
    expect(loss(0.05, 1)).toBeGreaterThan(2.9);
    expect(loss(0.5, 0)).toBeGreaterThan(0.6);
    expect(loss(0.5, 0)).toBeLessThan(0.7);
  });
});

describe('Gradient descent presets', () => {
  const run = (label: string) => {
    const p = preset('Gradient descent', label);
    return oneRun(ctx, 'x', p.w0 as number, p.b0 as number, alphaOf(p), itersOf(p));
  };
  it('a good run falls on every iteration and ends next to the lowest cost', () => {
    const r = run('A good run');
    expect(r.diverged).toBeNull();
    const j = r.h.map((q) => q.j);
    for (let i = 1; i < j.length; i++) expect(j[i]).toBeLessThanOrEqual(j[i - 1] + 1e-12);
    expect(j[j.length - 1]).toBeLessThan(ctx.star.j * 1.01);
    expect(Math.abs(j[j.length - 1] - j[j.length - 21])).toBeLessThan(0.002 * j[j.length - 1]);
  });
  it('a very small rate is stable but the cost is still well above the lowest at the end', () => {
    const r = run('Very small α');
    expect(r.diverged).toBeNull();
    expect(r.h[r.h.length - 1].j).toBeGreaterThan(ctx.star.j * 1.3);
  });
  it('a too large rate bounces: the cost goes up and down and never settles near the lowest', () => {
    const r = run('α too large');
    expect(r.diverged).toBeNull();
    const j = r.h.map((q) => q.j);
    let ups = 0;
    for (let i = 1; i < j.length; i++) if (j[i] > j[i - 1]) ups++;
    expect(ups).toBeGreaterThan(10);
    expect(Math.min(...j.slice(-20))).toBeGreaterThan(ctx.star.j * 1.5);
  });
});

describe('Vectorization presets', () => {
  it('the live model’s size is the number of training days in model.json', () => {
    expect((preset('Vectorization', 'The live model’s size') as { m: number }).m).toBe(ctx.model.rows.train);
    expect((preset('Vectorization', 'The sample’s size') as { m: number }).m).toBe(ctx.d.n);
  });
});

describe('Learning rate presets', () => {
  const race = (label: string) => {
    const p = preset('Learning rate', label);
    const iters = itersOf(p);
    return (p.lrs as number[]).map((a) => ({ a, run: oneRun(ctx, 'x', 0, 0, a, iters) }));
  };
  const last = (r: { run: { h: Array<{ j: number }> } }) => r.run.h[r.run.h.length - 1].j;
  it('Race four values: the smallest barely moves and the larger ones get much lower sooner', () => {
    const r = race('Race four values');
    expect(r.every((x) => x.run.diverged === null)).toBe(true);
    expect(last(r[0])).toBeGreaterThan(0.6);
    expect(last(r[0])).toBeGreaterThan(last(r[1]));
    expect(last(r[1])).toBeGreaterThan(last(r[2]));
    expect(last(r[2])).toBeGreaterThan(last(r[3]) - 0.02);
    expect(last(r[3])).toBeLessThan(ctx.star.j * 1.1);
  });
  it('Too large: the largest rate jumps up and down and its run is not stopped', () => {
    const r = race('Too large');
    const big = r[r.length - 1].run.h.map((q) => q.j);
    expect(r[r.length - 1].run.diverged).toBeNull();
    let ups = 0;
    for (let i = 1; i < big.length; i++) if (big[i] > big[i - 1]) ups++;
    expect(ups).toBeGreaterThan(10);
    expect(r[0].run.diverged).toBeNull();
  });
  it('A rate beyond any number stops at once and the rest of the race goes on', () => {
    const r = race('A rate beyond any number');
    expect(r[1].run.diverged).not.toBeNull();
    expect(r[1].run.diverged as number).toBeLessThanOrEqual(2);
    expect(r[0].run.diverged).toBeNull();
  });
});

describe('Feature scaling presets', () => {
  const both = (label: string) => {
    const p = preset('Feature scaling', label);
    const a = alphaOf(p);
    const n = itersOf(p);
    return { sc: oneRun(ctx, 'z', 0, 0, a, n), raw: oneRun(ctx, 'pm', 0, 0, a, n) };
  };
  const end = (r: { h: Array<{ j: number }> }) => r.h[r.h.length - 1].j;
  it('at α = 0.1 the scaled run settles and the raw run jumps around far above it', () => {
    const { sc, raw } = both('Compare at α = 0.1');
    expect(sc.diverged).toBeNull();
    expect(end(sc)).toBeLessThan(ctx.star.j * 1.02);
    const j = raw.h.map((q) => q.j);
    let ups = 0;
    for (let i = 1; i < j.length; i++) if (j[i] > j[i - 1]) ups++;
    expect(ups).toBeGreaterThan(20);
    expect(Math.min(...j.slice(-50))).toBeGreaterThan(end(sc) * 2);
  });
  it('at α = 1 the scaled run still reaches the lowest cost while the raw run stays far above it', () => {
    const { sc, raw } = both('A larger α');
    expect(sc.diverged).toBeNull();
    expect(end(sc)).toBeLessThan(ctx.star.j * 1.01);
    const j = raw.h.map((q) => q.j);
    expect(Math.min(...j.slice(-50))).toBeGreaterThan(end(sc) * 2);
    const sj = sc.h.map((q) => q.j);
    for (let i = 1; i < sj.length; i++) expect(sj[i]).toBeLessThanOrEqual(sj[i - 1] + 1e-12);
  });
  it('the saved scaling of the live model is for the training days, not this sample', () => {
    expect(ctx.model.scaling.mu[0]).not.toBeCloseTo(ctx.d.muPm, 1);
  });
});

describe('Feature engineering presets', () => {
  const angle = (d: number) => (2 * Math.PI * d) / 365.25;
  it('day 365 is next to day 1 on the circle, though the numbers are far apart', () => {
    const d = Math.hypot(Math.sin(angle(365)) - Math.sin(angle(1)), Math.cos(angle(365)) - Math.cos(angle(1)));
    expect(d).toBeLessThan(0.05);
  });
  it('midsummer days are almost all label 0 in the sample', () => {
    const near = ctx.d.rows.map((_, i) => i).filter((i) => {
      const a = Math.atan2(ctx.d.sin[i], ctx.d.cos[i]);
      return Math.abs(a - Math.atan2(Math.sin(angle(180)), Math.cos(angle(180)))) < 0.4;
    });
    expect(near.length).toBeGreaterThan(20);
    expect(mean(near.map((i) => ctx.d.y[i]))).toBeLessThan(0.1);
  });
  it('season alone already separates the classes: the fitted curve rises with season_cos', () => {
    expect(seasonFit(ctx).w).toBeGreaterThan(1);
  });
});

describe('Overfitting and regularization presets', () => {
  const fit = (label: string) => polyFit(ctx, 10 ** ((preset('Overfitting and regularization', label).lamExp as number)));
  const biggest = (label: string) => Math.max(...fit(label).w.map(Math.abs));
  it('weights shrink as λ rises', () => {
    expect(biggest('Very little')).toBeGreaterThan(biggest('Moderate'));
    expect(biggest('Moderate')).toBeGreaterThan(biggest('Too much'));
    expect(biggest('Too much')).toBeLessThan(0.1);
  });
  it('training cost rises with λ, and Too much has the highest', () => {
    expect(fit('Very little').plainCost).toBeLessThan(fit('Moderate').plainCost);
    expect(fit('Moderate').plainCost).toBeLessThan(fit('Too much').plainCost);
  });
  it('a small λ gives a more bent boundary than a moderate one', () => {
    const { z1, z2 } = ctx.sub;
    const lo = Math.min(...z1) - 0.5, hi = Math.max(...z1) + 0.5;
    const lo2 = Math.min(...z2) - 0.5, hi2 = Math.max(...z2) + 0.5;
    const roughness = (lam: number) => {
      const f = polyFit(ctx, lam);
      let s = 0;
      const N = 30;
      for (let i = 1; i < N - 1; i++) {
        for (let k = 1; k < N - 1; k++) {
          const x = lo + ((hi - lo) * i) / N, y = lo2 + ((hi2 - lo2) * k) / N;
          const hx = (hi - lo) / N, hy = (hi2 - lo2) / N;
          const p = (a: number, b: number) => polyProb(f, a, b);
          s += Math.abs(p(x + hx, y) + p(x - hx, y) - 2 * p(x, y)) + Math.abs(p(x, y + hy) + p(x, y - hy) - 2 * p(x, y));
        }
      }
      return s;
    };
    expect(roughness(0.01)).toBeGreaterThan(roughness(10));
  });
  it('uses 46 days, evenly spread, which is stated on the page', () => {
    expect(ctx.sub.idx.length).toBe(46);
    expect(ctx.sub.idx[1] - ctx.sub.idx[0]).toBe(8);
  });
});

describe('Held-out result', () => {
  it('states the verdict the model file supports, whichever way it went', () => {
    const [overall, monthly, model] = baselineCosts(ctx);
    const wins = model < overall && model < monthly;
    expect(ctx.model.beats_baselines).toBe(wins);
    expect(verdict(ctx)).toContain(wins ? 'beats both' : 'does NOT beat both');
  });
  it('says so plainly when a model does not beat the guesses', () => {
    const lost = { ...ctx, model: { ...ctx.model, beats_baselines: false, cost: { ...ctx.model.cost, held_out: 0.9 } } };
    expect(verdict(lost)).toContain('does NOT beat both');
    expect(verdict(lost)).toContain('0.900');
  });
  it('the cost-by-λ view uses the shipped candidates, and λ was chosen on the selection cost', () => {
    const rows = ctx.model.candidates.filter((c) => c.features.join() === ctx.model.features.join());
    const chosen = rows.find((c) => c.chosen)!;
    expect(chosen.lambda).toBe(ctx.model.hyperparameters.lambda);
    expect(Math.min(...rows.map((r) => r.selection_cost as number))).toBe(chosen.selection_cost);
  });
  it('the sandbox presets train on fewer or more of the sample’s days and open the sandbox view', () => {
    const a = preset('Held-out result', 'Train on less');
    const b = preset('Held-out result', 'Train on more');
    expect(a).toMatchObject({ split: 150, view: 3 });
    expect(b).toMatchObject({ split: 300, view: 3 });
  });
  it('with less training data the sandbox sees fewer seasons, so its costs differ a lot from the longer split', () => {
    const a = sandbox(ctx, 150);
    const b = sandbox(ctx, 300);
    expect(a.held).toBeGreaterThan(b.held);
    expect(Math.abs(a.model - b.model)).toBeGreaterThan(0.05);
  });
  it('the probability bins add up to the held-out days', () => {
    const h = ctx.model.held_out_probabilities;
    const total = h.counts_y1.reduce((a, c) => a + c, 0) + h.counts_y0.reduce((a, c) => a + c, 0);
    expect(total).toBe(ctx.model.rows.held_out);
  });
});

describe('Daily forecast', () => {
  it('summarises the forecast log: the latest run time and how many forecasts were logged', () => {
    expect(ctx.predictions.logged).toBeGreaterThan(0);
    expect(ctx.predictions.lastIssuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
  it('the cutoff is the one the model file records', () => {
    expect(ctx.model.cutoff).toBe('12:00 Asia/Tehran');
  });
});

describe('Held-out step: the selection-set limit', () => {
  it('the cost-by-λ caption says the selection days are a warm half-year with the positive count from profile.json', () => {
    const legend = costByLambda(ctx, {} as never).legend.join('\n');
    expect(legend).toContain(`${profile.splits.selection.positives} positive days`);
    expect(legend).toContain(`${profile.splits.selection.rows.toLocaleString('en-US')} days`);
    expect(legend).toMatch(/warm half-year/);
  });
});

describe('Daily schedule', () => {
  it('the Lab shows the one schedule constant, the first try at 10:30 UTC, with Tehran time derived from it', () => {
    expect(DAILY_RUN_UTC).toBe('10:30');
    expect(DAILY_RUN_TEHRAN).toBe('14:00');
    const pipelineText = pipeline(ctx, {} as never).texts.map((t) => t.t).join(' ');
    expect(pipelineText).toContain(`First try ${DAILY_RUN_UTC} UTC (${DAILY_RUN_TEHRAN} Tehran), up to four a day`);
    const stats = stage('Daily forecast').stats(ctx, {} as never);
    expect(stats.find((r) => r.k === 'Scheduled')?.v).toBe(`First try ${DAILY_RUN_UTC} UTC (${DAILY_RUN_TEHRAN} Tehran), up to four a day`);
  });
});
