import { logLoss } from '../engine';
import { niceTop, range } from '../format';
import { AC, INK, axes, evenTicks, frame, ln, pt, tickAt } from '../plotkit';
import type { Domain } from '../plotkit';
import type { ViewFn } from '../types';
import { logCost, sqCost, surfaceMax, wireframe } from './shared';
import type { LabCtx } from '../context';
import { emptyPlot } from '../../components/Plot';

/** Views of the third part: why squared error is not used, the loss, and the cost. */

export const squaredVsLogistic: ViewFn = (ctx, c) => {
  const wd = ctx.dom.w;
  const ws = range(80, (i) => wd[0] + ((wd[1] - wd[0]) * i) / 79);
  const sq = ws.map((w) => sqCost(ctx, w, c.b));
  const lg = ws.map((w) => logCost(ctx, w, c.b));
  const ms = Math.max(...sq) || 1;
  const ml = Math.max(...lg) || 1;
  const f = frame(wd, [0, 1.2]);
  const p = tickAt(axes(f), f, { x: evenTicks(wd[0], wd[1]) });
  p.lines = [
    ln(f.path(ws.map((w, i) => [w, sq[i] / ms] as [number, number])), { stroke: INK, dash: '6 4' }),
    ln(f.path(ws.map((w, i) => [w, lg[i] / ml] as [number, number]))),
  ];
  p.points = [
    pt(f, c.w, sqCost(ctx, c.w, c.b) / ms, { r: 6, fill: INK, op: 1 }),
    pt(f, c.w, logCost(ctx, c.w, c.b) / ml, { r: 6, fill: AC, op: 1 }),
  ];
  p.xLabel = 'w, with b fixed at its current value';
  p.yLabel = 'Cost, as a share of its largest value here';
  p.legend = ['Dashed: squared error, with flat plateaus', 'Solid: logistic cost, which keeps changing', 'Markers: your w'];
  return p;
};

function surfaceView(which: 'sq' | 'log'): ViewFn {
  return (ctx, c) => {
    const fn = which === 'sq' ? (w: number, b: number) => sqCost(ctx, w, b) : (w: number, b: number) => logCost(ctx, w, b);
    const zmax = ctx.memo(`surface-max|${which}`, () => surfaceMax(ctx, fn));
    const p = emptyPlot();
    const w = wireframe(ctx, fn, zmax, { w: c.w, b: c.b }, c.hist1.length > 1 ? c.hist1 : undefined);
    p.lines = w.lines;
    p.points = w.points;
    p.legend =
      which === 'sq'
        ? ['Height is squared-error cost. With a sigmoid inside, it is not a bowl: it has flat parts.', 'Marker: your w and b']
        : ['Height is logistic cost. One bowl, with no flat parts and no second low point.', 'Marker: your w and b'];
    return p;
  };
}
export const squaredSurface = surfaceView('sq');
export const logisticSurface = surfaceView('log');

export const lossCurves: ViewFn = (_ctx, c) => {
  const f = frame([0, 1], [0, 5]);
  const p = axes(f);
  const xs = range(100, (i) => (i + 0.5) / 100);
  p.lines = [
    ln(f.path(xs.map((q) => [q, logLoss(q, 1)] as [number, number]))),
    ln(f.path(xs.map((q) => [q, logLoss(q, 0)] as [number, number])), { stroke: INK, dash: '6 4' }),
  ];
  p.points = [pt(f, c.pv, logLoss(c.pv, c.yv), { r: 8, fill: c.yv ? AC : INK, op: 1 })];
  p.xLabel = 'f, the predicted probability';
  p.yLabel = 'Loss';
  p.legend = ['Solid: loss when y = 1', 'Dashed: loss when y = 0', 'Marker: your prediction and label (accent for y = 1, dark for y = 0)', 'Losses above 5 are cut off at the frame'];
  return p;
};

export const costOfW: ViewFn = (ctx, c) => {
  const wd = ctx.dom.w;
  const ws = range(81, (i) => wd[0] + ((wd[1] - wd[0]) * i) / 80);
  const js = ws.map((w) => logCost(ctx, w, c.b));
  const f = frame(wd, [0, niceTop(Math.min(Math.max(...js), 8))]);
  const p = tickAt(axes(f), f, { x: evenTicks(wd[0], wd[1]) });
  p.lines = [ln(f.path(ws.map((w, i) => [w, js[i]] as [number, number])))];
  p.points = [pt(f, c.w, logCost(ctx, c.w, c.b), { r: 7, fill: AC, op: 1 })];
  p.xLabel = 'w';
  p.yLabel = 'Cost J';
  p.legend = ['Curve: J(w) with b fixed at its current value', 'Marker: current w'];
  return p;
};

/** A heat map of the cost over w and b: darker is lower. */
export function heatBars(ctx: LabCtx, f: ReturnType<typeof frame>) {
  const [w0, w1] = ctx.dom.w as Domain;
  const [b0, b1] = ctx.dom.b as Domain;
  const NX = 28;
  const NY = 18;
  const cw = (w1 - w0) / NX;
  const ch = (b1 - b0) / NY;
  const cells = ctx.memo('heat-cells', () => {
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < NX; i++) for (let k = 0; k < NY; k++) out.push([i, k, logCost(ctx, w0 + (i + 0.5) * cw, b0 + (k + 0.5) * ch)]);
    return out;
  });
  const lo = Math.min(...cells.map((q) => q[2]));
  const hi = Math.min(lo + 1.2, Math.max(...cells.map((q) => q[2])));
  return cells.map((q) => ({
    x: f.x(w0 + q[0] * cw),
    y: f.y(b0 + (q[1] + 1) * ch),
    w: f.x(w0 + cw) - f.x(w0) + 0.5,
    h: f.y(b0) - f.y(b0 + ch) + 0.5,
    fill: AC,
    stroke: 'none',
    op: Math.min(0.75, Math.max(0.03, 1 - (q[2] - lo) / (hi - lo || 1))),
  }));
}

export const costMap: ViewFn = (ctx, c) => {
  const f = frame(ctx.dom.w, ctx.dom.b);
  const p = tickAt(axes(f), f, { x: evenTicks(ctx.dom.w[0], ctx.dom.w[1]), y: evenTicks(ctx.dom.b[0], ctx.dom.b[1]) });
  p.bars = heatBars(ctx, f);
  p.lines = [ln(f.path(c.hist1.map((q) => [q.w, q.b] as [number, number])), { stroke: INK })];
  p.points = [pt(f, c.w, c.b, { r: 7, fill: INK, op: 1 })];
  p.xLabel = 'w';
  p.yLabel = 'b';
  p.legend = c.hist1.length > 1 ? ['Darker: lower cost', 'Line: the path of gradient descent'] : ['Darker: lower cost', 'Marker: current w and b'];
  return p;
};

