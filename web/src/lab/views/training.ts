import { emptyPlot } from '../../components/Plot';
import { hist } from '../engine';
import { fixed, niceSpan, niceTop } from '../format';
import { AC, INK, MUT, axes, evenTicks, frame, histBars, ln, pt, tickAt } from '../plotkit';
import type { ViewFn } from '../types';

/** Views of the fourth part: gradient descent, the shapes of the maths, learning rates and scaling. */

export const costByIteration: ViewFn = (_ctx, c) => {
  const top = niceTop(Math.max((c.hist1[0]?.j ?? Math.LN2) * 1.05, 1));
  const f = frame([0, c.iters], [0, top]);
  const p = axes(f);
  p.lines = [ln(f.path(c.hist1.map((q, i) => [i, q.j] as [number, number])))];
  p.points = [pt(f, c.it, c.j, { r: 6, fill: AC, op: 1 })];
  p.xLabel = 'Iteration';
  p.yLabel = 'Cost J';
  p.legend = ['Should fall on almost every iteration. Jumping up and down means α is too large.'];
  return p;
};

export const parameters: ViewFn = (ctx, c) => {
  const vals = c.hist1.flatMap((q) => [q.w, q.b]).concat([ctx.star.w, ctx.star.b, 0]);
  const [lo, hi] = niceSpan(Math.max(-60, Math.min(...vals)), Math.min(60, Math.max(...vals)));
  const f = frame([0, c.iters], [lo, hi]);
  const p = axes(f);
  p.lines = [
    ln(f.path(c.hist1.map((q, i) => [i, q.w] as [number, number]))),
    ln(f.path(c.hist1.map((q, i) => [i, q.b] as [number, number])), { stroke: INK, dash: '6 4' }),
  ];
  p.xLabel = 'Iteration';
  p.yLabel = 'Parameter value';
  p.legend = ['Solid: w', 'Dashed: b'];
  return p;
};

export const shapes: ViewFn = (_ctx, c) => {
  const p = emptyPlot();
  const box = (x: number, y: number, w: number, h: number, t: string, sub: string) => {
    p.bars.push({ x, y, w, h, fill: 'var(--acs)', stroke: INK, op: 0.9 });
    p.texts.push({ x: x + w / 2, y: y + h / 2 + 5, t, anchor: 'middle', size: 18 });
    p.texts.push({ x: x + w / 2, y: y + h + 22, t: sub, anchor: 'middle', size: 13 });
  };
  const bw = 60 + c.nf * 8;
  const bh = 90 + Math.log10(Math.max(c.m, 10)) * 30;
  box(30, 50, bw, bh, 'X', `${c.m} × ${c.nf}`);
  p.texts.push({ x: 48 + bw, y: 50 + bh / 2 + 6, t: '·', anchor: 'middle', size: 30 });
  box(66 + bw, 90, 46, 40 + c.nf * 4, 'w', `${c.nf} × 1`);
  p.texts.push({ x: 140 + bw, y: 50 + bh / 2 + 6, t: '+ b', anchor: 'middle', size: 18 });
  p.texts.push({ x: 190 + bw, y: 50 + bh / 2 + 6, t: 'g( )', anchor: 'middle', size: 18 });
  box(228 + bw, 50, 56, bh, 'f', `${c.m} × 1`);
  p.legend = ['One matrix product, then the sigmoid on each result'];
  return p;
};

const RACE_STYLES: Array<[string, string, string]> = [
  [MUT, '2 4', 'dotted grey'], [INK, '6 4', 'dashed dark'], [AC, '', 'solid accent'],
  [MUT, '', 'solid grey'], [INK, '2 2', 'fine dotted dark'], [AC, '8 3', 'long dash accent'],
];

export const learningRates: ViewFn = (_ctx, c) => {
  const f = frame([0, c.iters], [0, 1.5]);
  const p = axes(f);
  p.lines = c.races.map((r, i) => {
    const st = RACE_STYLES[i % RACE_STYLES.length];
    return ln(f.path(r.run.h.slice(0, c.it + 1).map((q, k) => [k, q.j] as [number, number])), { stroke: st[0], dash: st[1], width: 2 });
  });
  p.points = c.races.flatMap((r, i) => {
    const q = r.run.h[Math.min(c.it, r.run.h.length - 1)];
    return q ? [pt(f, Math.min(c.it, r.run.h.length - 1), q.j, { r: 5, fill: RACE_STYLES[i % RACE_STYLES.length][0], op: 1 })] : [];
  });
  p.xLabel = 'Iteration';
  p.yLabel = 'Cost J';
  p.legend = c.races.map((r, i) => `${RACE_STYLES[i % RACE_STYLES.length][2]}: ${r.label}`);
  const cut = c.races.some((r) => r.run.h.some((q) => q.j > 1.5));
  if (cut) p.legend.push('Costs above 1.5 are cut off at the frame');
  const stopped = c.races.filter((r) => r.run.diverged !== null && c.it >= r.run.diverged);
  if (stopped.length > 0) p.legend.push(`Stopped (the weights overflowed a 64-bit number): ${stopped.map((r) => r.label).join(', ')}`);
  return p;
};

export const scaleHistogram: ViewFn = (ctx) => {
  const zs = ctx.d.zpm;
  const zlo = Math.floor(Math.min(...zs));
  const zhi = Math.ceil(Math.max(...zs));
  const p = emptyPlot();
  const c1 = hist(ctx.d.pm, 0, ctx.dom.pm[1], 12);
  const c2 = hist(zs, zlo, zhi, 12);
  const top = niceTop(Math.max(...c1, ...c2));
  const g1 = frame([0, ctx.dom.pm[1]], [0, top], { l: 64, r: 370, t: 34, b: 348 });
  const g2 = frame([zlo, zhi], [0, top], { l: 420, r: 700, t: 34, b: 348 });
  p.bars = histBars(g1, c1, 0, ctx.dom.pm[1], MUT).concat(histBars(g2, c2, zlo, zhi, AC));
  p.yTicks = g1.yTicks();
  p.xTicks = tickAt(emptyPlot(), g1, { x: evenTicks(0, ctx.dom.pm[1]) }).xTicks.concat(tickAt(emptyPlot(), g2, { x: evenTicks(zlo, zhi) }).xTicks);
  p.texts = [
    { x: 217, y: 22, t: 'Before: PM2.5 in μg/m³', anchor: 'middle', size: 14 },
    { x: 560, y: 22, t: 'After: (x − μ) / σ', anchor: 'middle', size: 14 },
  ];
  p.yLabel = 'Days';
  p.legend = ['Same shape, comparable range', `Sample mean ${fixed(ctx.d.muPm, 1)} μg/m³, spread ${fixed(ctx.d.sdPm, 1)} μg/m³`];
  return p;
};

export const scaleTraining: ViewFn = (_ctx, c) => {
  const f = frame([0, c.iters], [0, 3]);
  const p = axes(f);
  const [sc, raw] = c.races;
  p.lines = [
    ln(f.path(sc.run.h.slice(0, c.it + 1).map((q, i) => [i, q.j] as [number, number]))),
    ln(f.path(raw.run.h.slice(0, c.it + 1).map((q, i) => [i, q.j] as [number, number])), { stroke: INK, dash: '6 4' }),
  ];
  const at = (r: typeof sc) => r.run.h[Math.min(c.it, r.run.h.length - 1)];
  p.points = [pt(f, Math.min(c.it, sc.run.h.length - 1), at(sc).j, { r: 5, fill: AC, op: 1 }), pt(f, Math.min(c.it, raw.run.h.length - 1), at(raw).j, { r: 5, fill: INK, op: 1 })];
  p.xLabel = 'Iteration';
  p.yLabel = 'Cost J';
  p.legend = ['Solid: scaled PM2.5', 'Dashed: raw μg/m³', 'Same α for both. Costs above 3 are cut off at the frame.'];
  return p;
};
