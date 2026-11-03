import { describe, expect, it } from 'vitest';
import type { PlotSpec } from '../components/Plot';
import { oneRun, polyFit, sandbox } from './context';
import { clipSegment } from './plotkit';
import { INITIAL, computeCur, reducer } from './state';
import { STAGES } from './stages';
import { ctx } from './testData';
import type { Cur, LabState } from './types';

/** Every number a plot would hand to the SVG, as text, plus its labels. */
function strings(p: PlotSpec): string[] {
  return [
    ...p.points.flatMap((q) => [q.cx, q.cy, q.r, q.op]),
    ...p.bars.flatMap((q) => [q.x, q.y, q.w, q.h, q.op]),
    ...p.xTicks.flatMap((q) => [q.x, q.y1, q.y2, q.ty]),
    ...p.yTicks.flatMap((q) => [q.x1, q.x2, q.y, q.tx, q.ty]),
    ...p.texts.flatMap((q) => [q.x, q.y, q.size]),
  ].map(String);
}
const nonFinite = (p: PlotSpec) => [
  ...strings(p).filter((v) => !Number.isFinite(Number(v))),
  ...p.lines.map((l) => l.d).filter((d) => /NaN|Infinity|undefined/.test(d)),
  ...[...p.xTicks.map((t) => t.label), ...p.yTicks.map((t) => t.label), ...p.legend, p.xLabel, p.yLabel, ...p.texts.map((t) => t.t)].filter(
    (t) => /NaN|Infinity|undefined/.test(t),
  ),
];
const area = (p: PlotSpec) => p.points.length + p.lines.filter((l) => l.d).length + p.bars.length + p.texts.length;

function at(stage: number, patch: Partial<LabState>, reduced = true): { s: LabState; c: Cur } {
  let s = reducer({ ...INITIAL }, { type: 'goto', stage, stages: STAGES });
  s = { ...s, ...patch };
  if (STAGES[stage].train) s = reducer(s, { type: 'start', reduced });
  return { s, c: computeCur(ctx, STAGES[stage], s) };
}

/** Settings that stress each control at its limits, applied to every step. */
const STRESS: Array<Partial<LabState>> = [
  {},
  { thresh: 10, cutoff: 2, far: 0, z: -8, pv: 0.01, yv: 0, m: 10, nf: 1, day: 1, lamExp: -2, split: 90, w0: -1, b0: -12, v1: -1, v2: -3, vb: -12 },
  { thresh: 90, cutoff: 22, far: 5, z: 8, pv: 0.99, yv: 1, m: 11436, nf: 14, day: 365, lamExp: 3, split: 330, w0: 4, b0: 2, v1: 4, v2: 3, vb: 2 },
  { alphaExp: 1, iters: '5000' },
  { alphaExp: -4, iters: '1' },
  { lrs: [], iters: '50' },
  { lrs: [1e-9, 5, 100, 1e300], iters: '30' },
];

describe('every view of every step', () => {
  STAGES.forEach((stage, si) => {
    stage.views.forEach((view, vi) => {
      it(`step ${si + 1} "${view.label}" draws finite numbers under stress`, () => {
        STRESS.forEach((patch, k) => {
          for (const state of [{ ...patch, view: vi }, { ...patch, view: vi, it: 3 }]) {
            const { c } = at(si, state, true);
            const spec = view.fn(ctx, c);
            expect(nonFinite(spec), `settings #${k}`).toEqual([]);
            const noRaces = stage.train === 'lrs' && state.lrs?.length === 0;
            expect(area(spec), `settings #${k} draws something`).toBeGreaterThanOrEqual(noRaces ? 0 : 1);
            const { c: before } = at(si, { ...state, started: false }, true);
            const idle = view.fn(ctx, { ...before, view: vi });
            expect(nonFinite(idle), `settings #${k} before a run`).toEqual([]);
            const stats = stage.stats(ctx, c).flatMap((r) => [r.k, r.v]).join(' ');
            expect(stats, `settings #${k} stats`).not.toMatch(/NaN|Infinity|undefined/);
            expect(stage.worked(ctx, c), `settings #${k} worked`).not.toMatch(/NaN|Infinity|undefined/);
          }
        });
      });
    });
  });
});

describe('divergence', () => {
  const si = STAGES.findIndex((s) => s.title === 'Learning rate');
  it('a huge learning rate stops the run at once and keeps every plot finite', () => {
    const { s, c } = at(si, { lrs: [0.01, 1e300], iters: '200' });
    const huge = c.races[1];
    expect(huge.run.diverged).not.toBeNull();
    expect(huge.run.h.length).toBe(huge.run.diverged);
    expect(huge.run.h.every((q) => Number.isFinite(q.j) && Number.isFinite(q.w) && Number.isFinite(q.b))).toBe(true);
    expect(c.races[0].run.diverged).toBeNull();
    for (const v of STAGES[si].views) expect(nonFinite(v.fn(ctx, c)), v.label).toEqual([]);
    expect(s.it).toBe(200);
  });

  it('on the Gradient descent step, even a very large rate keeps plots finite (the logistic cost bounces, it does not blow up)', () => {
    const gd = STAGES.findIndex((x) => x.title === 'Gradient descent');
    const { c } = at(gd, { alphaExp: 1, iters: '400' });
    expect(c.hist1.every((q) => Number.isFinite(q.j))).toBe(true);
    for (const v of STAGES[gd].views) expect(nonFinite(v.fn(ctx, c)), v.label).toEqual([]);
  });
});

describe('plot helpers', () => {
  it('cut a line where it leaves the frame', () => {
    expect(clipSegment(-5, 5, 15, 5, [0, 10], [0, 10])).toEqual([0, 5, 10, 5]);
    expect(clipSegment(-5, -5, -1, -1, [0, 10], [0, 10])).toBeNull();
    expect(clipSegment(0, 0, 10, 10, [0, 10], [0, 10])).toEqual([0, 0, 10, 10]);
    expect(clipSegment(Number.NaN, 0, 1, 1, [0, 10], [0, 10])).toBeNull();
  });
});

describe('memoized fits', () => {
  it('are shared per setting', () => {
    expect(oneRun(ctx, 'x', 0, 0, 0.1, 50)).toBe(oneRun(ctx, 'x', 0, 0, 0.1, 50));
    expect(oneRun(ctx, 'x', 0, 0, 0.1, 50)).not.toBe(oneRun(ctx, 'z', 0, 0, 0.1, 50));
    expect(polyFit(ctx, 10)).toBe(polyFit(ctx, 10));
    expect(polyFit(ctx, 10)).not.toBe(polyFit(ctx, 1));
    expect(sandbox(ctx, 250)).toBe(sandbox(ctx, 250));
  });

  it('the polynomial fit stays finite for every lambda on the slider', () => {
    for (let e = -2; e <= 3; e += 0.5) {
      const fit = polyFit(ctx, 10 ** e);
      expect(fit.diverged, `lambda 10^${e}`).toBeNull();
      expect(fit.w.every(Number.isFinite) && Number.isFinite(fit.b) && Number.isFinite(fit.plainCost)).toBe(true);
    }
  });

  it('the sandbox split stays finite at every training length on its slider', () => {
    for (let k = 90; k <= 330; k += 10) {
      const r = sandbox(ctx, k);
      expect(r.diverged).toBeNull();
      for (const v of [r.model, r.overall, r.monthly]) expect(Number.isFinite(v), `k=${k}`).toBe(true);
    }
  });
});
