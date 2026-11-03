import { seasonFit, polyFit, polyProb } from '../context';
import { sigmoid } from '../engine';
import { fixed, range } from '../format';
import { AC, INK, MUT, axes, frame, ln, pt, tickAt } from '../plotkit';
import { emptyPlot } from '../../components/Plot';
import type { ViewFn } from '../types';
import { CLASS_LEGEND, dayDot, jitter } from './shared';

/** Views of the fifth part: the season features, and the polynomial with its penalty. */

export const seasonCircle: ViewFn = (ctx, c) => {
  const f = frame([-1.3, 1.3], [-1.3, 1.3], { l: 190, r: 530, t: 16, b: 348 });
  const p = emptyPlot();
  p.points = ctx.d.sin.map((s, i) => dayDot(f, s, ctx.d.cos[i], ctx.d.y[i], { r: 3.4 }));
  const a = (2 * Math.PI * c.day) / 365.25;
  p.points.push(pt(f, Math.sin(a), Math.cos(a), { r: 9, fill: INK, op: 1 }));
  p.lines = [ln(f.path(range(73, (i) => [Math.sin((i / 72) * 2 * Math.PI), Math.cos((i / 72) * 2 * Math.PI)] as [number, number])), { stroke: MUT, width: 1, dash: '2 4' })];
  p.texts = [
    { x: 360, y: 34, t: 'January', anchor: 'middle', size: 13 },
    { x: 360, y: 340, t: 'July', anchor: 'middle', size: 13 },
  ];
  p.xLabel = 'sin(2π · day / 365.25)';
  p.yLabel = 'cos(2π · day / 365.25)';
  p.legend = ['The last day of the year sits next to the first here', 'Large dark dot: your day', ...CLASS_LEGEND];
  return p;
};

export const seasonAlone: ViewFn = (ctx) => {
  const f = frame([-1, 1], [-0.05, 1.05]);
  const m = seasonFit(ctx);
  const p = tickAt(axes(f), f, { y: [0, 0.25, 0.5, 0.75, 1] }, undefined, (v) => String(v));
  p.points = ctx.d.cos.map((x, i) => dayDot(f, x, jitter(i, ctx.d.y[i]), ctx.d.y[i]));
  p.lines = [ln(f.path(range(60, (i) => {
    const x = -1 + (i / 59) * 2;
    return [x, sigmoid(m.w * x + m.b)] as [number, number];
  })))];
  p.xLabel = 'season_cos, near +1 in winter and −1 in summer';
  p.yLabel = 'Probability of y = 1';
  p.legend = ['Curve: a logistic model that uses the season alone', ...CLASS_LEGEND];
  return p;
};

/** Domain of the z-scored plane the polynomial step draws in. */
function planeDomains(ctx: Parameters<ViewFn>[0]) {
  const { z1, z2 } = ctx.sub;
  const lo = (v: number[]) => Math.floor(Math.min(...v) * 2 - 0.5) / 2;
  const hi = (v: number[]) => Math.ceil(Math.max(...v) * 2 + 0.5) / 2;
  return { x: [lo(z1), hi(z1)] as [number, number], y: [lo(z2), hi(z2)] as [number, number] };
}

export const polyBoundary: ViewFn = (ctx, c) => {
  const fit = polyFit(ctx, c.lam);
  const dom = planeDomains(ctx);
  const f = frame(dom.x, dom.y);
  const p = axes(f, (v) => fixed(v, 1), (v) => fixed(v, 1));
  const N = 34;
  const cw = (f.b.r - f.b.l) / N;
  const ch = (f.b.b - f.b.t) / N;
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      const x = dom.x[0] + ((i + 0.5) * (dom.x[1] - dom.x[0])) / N;
      const y = dom.y[0] + ((k + 0.5) * (dom.y[1] - dom.y[0])) / N;
      if (polyProb(fit, x, y) >= 0.5) p.bars.push({ x: f.b.l + i * cw, y: f.b.b - (k + 1) * ch, w: cw + 0.5, h: ch + 0.5, fill: AC, stroke: 'none', op: 0.2 });
    }
  }
  p.points = ctx.sub.z1.map((x, i) => dayDot(f, x, ctx.sub.z2[i], ctx.sub.y[i], { r: 4.5 }));
  p.xLabel = 'PM2.5 so far today (z-score)';
  p.yLabel = 'season_cos (z-score)';
  p.legend = [
    `Dots: ${ctx.sub.idx.length} days taken evenly from the sample, the days this fit trains on`,
    'Shaded: where the model predicts y = 1',
    'A small λ lets the shaded region bend around single days. A larger λ gives a smoother boundary.',
    ...CLASS_LEGEND,
  ];
  return p;
};

export const weightBars: ViewFn = (ctx, c) => {
  const a = polyFit(ctx, 0.01).w;
  const b = polyFit(ctx, c.lam).w;
  const m = Math.max(...a.concat(b).map(Math.abs)) || 1;
  const f = frame([0.5, 9.5], [-m * 1.1, m * 1.1]);
  const p = emptyPlot();
  p.yTicks = f.yTicks((v) => fixed(v, 1));
  const names = ['x₁', 'x₂', 'x₁²', 'x₁x₂', 'x₂²', 'x₁³', 'x₁²x₂', 'x₁x₂²', 'x₂³'];
  p.xTicks = names.map((t, i) => ({ x: f.x(i + 1), y1: f.b.t, y2: f.b.b, ty: f.b.b + 16, label: t }));
  const bar = (v: number, i: number, off: number, fill: string) => ({
    x: f.x(i + 1) + off,
    y: v > 0 ? f.y(v) : f.y(0),
    w: 18,
    h: Math.abs(f.y(v) - f.y(0)),
    fill,
    stroke: 'none',
    op: 1,
  });
  p.bars = a.map((v, i) => bar(v, i, -19, MUT)).concat(b.map((v, i) => bar(v, i, 1, AC)));
  p.yLabel = 'Weight value';
  p.legend = ['Grey (left of each pair): λ = 0.01', 'Accent (right): your λ', 'x₁ is PM2.5 and x₂ is season_cos, both z-scored'];
  return p;
};

