import { sigmoid } from '../engine';
import { range } from '../format';
import { INK, MUT, axes, frame, ln, pt, tickAt } from '../plotkit';
import type { ViewFn } from '../types';
import { CLASS_LEGEND, XL, boundaryLine, curvePath, dayDot, halfMark, jitter } from './shared';

/** Views of the second part: the sigmoid, the logistic model and its decision boundary. */

export const sigmoidCurve: ViewFn = (_ctx, c) => {
  const f = frame([-8, 8], [0, 1]);
  const p = axes(f);
  p.lines = [
    ln(f.path(range(120, (i) => {
      const z = -8 + (i / 119) * 16;
      return [z, sigmoid(z)] as [number, number];
    }))),
    ln(f.line(0, 0, 0, 1), { stroke: MUT, dash: '6 4', width: 1 }),
  ];
  p.points = [pt(f, c.z, sigmoid(c.z), { r: 9, fill: INK, op: 1 })];
  p.xLabel = 'z';
  p.yLabel = 'g(z)';
  p.legend = ['Every z maps to between 0 and 1', 'Large dark dot: your z', 'Dashed: z = 0 gives 0.5'];
  return p;
};

export const probabilityCurve: ViewFn = (ctx, c) => {
  const f = frame(ctx.dom.x, [-0.05, 1.05]);
  const p = tickAt(axes(f), f, { y: [0, 0.25, 0.5, 0.75, 1] }, undefined, (v) => String(v));
  p.points = ctx.d.x.map((x, i) => dayDot(f, x, jitter(i, ctx.d.y[i]), ctx.d.y[i]));
  p.lines = [ln(curvePath(f, ctx.dom.x, c.w, c.b)), ...halfMark(f, c.w, c.b)];
  p.xLabel = XL;
  p.yLabel = 'Probability of y = 1';
  p.legend = ['Curve: the current model', 'Dashed: where the curve reaches 0.5', ...CLASS_LEGEND];
  return p;
};

export const scoreLine: ViewFn = (ctx, c) => {
  const f = frame(ctx.dom.x, [-8, 8]);
  const p = axes(f);
  p.lines = [ln(f.line(ctx.dom.x[0], c.w * ctx.dom.x[0] + c.b, ctx.dom.x[1], c.w * ctx.dom.x[1] + c.b)), ln(f.line(ctx.dom.x[0], 0, ctx.dom.x[1], 0), { stroke: MUT, dash: '6 4', width: 1 })];
  p.points = ctx.d.x.map((x, i) => dayDot(f, x, c.w * x + c.b, ctx.d.y[i]));
  p.xLabel = XL;
  p.yLabel = 'z = w · x + b';
  p.legend = ['Line: z, before the sigmoid', 'Dashed: z = 0. Above it the model says y = 1.', 'Scores beyond ±8 are drawn on the edge'];
  return p;
};

/** The decision-boundary step draws the weights on two features. The second one is wind or season. */
function boundaryView(second: 'wind' | 'season'): ViewFn {
  return (ctx, c) => {
    const col = second === 'wind' ? ctx.d.wind : ctx.d.cos;
    const yd: [number, number] = second === 'wind' ? ctx.dom.wind : [-1.1, 1.1];
    const f = frame(ctx.dom.x, yd);
    const p = axes(f);
    p.points = ctx.d.x.map((x, i) => dayDot(f, x, col[i], ctx.d.y[i]));
    p.lines = [ln(boundaryLine(f, c.v1, c.v2, c.vb))];
    p.xLabel = XL;
    p.yLabel = second === 'wind' ? 'Wind speed so far today (tens of km/h)' : 'Time of year: +1 at New Year, −1 at the start of July';
    p.legend = ['Line: where the probability equals 0.5', 'The side where w₁x₁ + w₂x₂ + b is positive is predicted y = 1', ...CLASS_LEGEND];
    return p;
  };
}
export const boundaryWind = boundaryView('wind');
export const boundarySeason = boundaryView('season');
