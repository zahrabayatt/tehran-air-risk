import type { PlotPoint } from '../../components/Plot';
import type { LabCtx } from '../context';
import { jOne, sigmoid, squaredOne } from '../engine';
import { clamp, range } from '../format';
import { AC, INK, MUT, frame, ln, pt } from '../plotkit';
import type { Domain } from '../plotkit';

/** Labels, legends and small shapes the views share. */

export const XL = 'PM2.5 so far today (tens of μg/m³)';
export const CLASS_LEGEND = ['Filled dot: tomorrow above the threshold', 'Ring: tomorrow at or below it'];

/** A dot for a day: filled for label 1, a ring for label 0, so the class never rests on color alone. */
export function dayDot(f: ReturnType<typeof frame>, x: number, y: number, label: number, opt: Partial<PlotPoint> = {}): PlotPoint {
  return label
    ? pt(f, x, y, { fill: AC, op: 0.9, r: 3.8, ...opt })
    : pt(f, x, y, { fill: 'none', stroke: MUT, op: 1, r: 3.8, ...opt });
}

/** A small, repeatable vertical offset so dots at 0 and 1 do not sit on top of each other. */
export const jitter = (i: number, label: number): number => {
  const j = (((i * 7919) % 17) / 17) * 0.07;
  return label ? 1 - j : j;
};

/** The probability curve g(w x + b) as a path across the x domain. */
export function curvePath(f: ReturnType<typeof frame>, xd: Domain, w: number, b: number, n = 80): string {
  return f.path(range(n, (i) => {
    const x = xd[0] + ((xd[1] - xd[0]) * i) / (n - 1);
    return [x, sigmoid(w * x + b)] as [number, number];
  }));
}

/** Dashed vertical marker where the curve crosses 0.5, when it lies inside the frame. */
export function halfMark(f: ReturnType<typeof frame>, w: number, b: number) {
  if (!(Math.abs(w) > 1e-9)) return [];
  const x = -b / w;
  if (x < f.xd[0] || x > f.xd[1]) return [];
  return [ln(f.line(x, f.yd[0], x, f.yd[1]), { stroke: INK, dash: '6 4', width: 1.5 })];
}

/**
 * The line where w1 x1 + w2 x2 + b = 0, drawn across the frame. A weight on x2 that is nearly
 * zero makes it vertical, so that case is drawn at x1 = -b / w1 instead of dividing by almost zero.
 */
export function boundaryLine(f: ReturnType<typeof frame>, w1: number, w2: number, b: number): string {
  const [x0, x1] = f.xd;
  if (Math.abs(w2) < 1e-6) {
    if (Math.abs(w1) < 1e-9) return '';
    const x = -b / w1;
    return f.line(x, f.yd[0], x, f.yd[1]);
  }
  const at = (x: number) => -(w1 * x + b) / w2;
  return f.line(x0, at(x0), x1, at(x1));
}

/** Cost J(w, b) of the one-feature model on x. */
export const logCost = (ctx: LabCtx, w: number, b: number) => jOne(ctx.d.x, ctx.d.y, w, b);
export const sqCost = (ctx: LabCtx, w: number, b: number) => squaredOne(ctx.d.x, ctx.d.y, w, b);

/** A wireframe of a surface over the w-b domain, as the design draws the cost shapes. */
export function wireframe(
  ctx: LabCtx, fn: (w: number, b: number) => number, zmax: number, mark?: { w: number; b: number }, path?: Array<{ w: number; b: number }>,
) {
  const [w0, w1] = ctx.dom.w;
  const [b0, b1] = ctx.dom.b;
  const cw = (w0 + w1) / 2;
  const cb = (b0 + b1) / 2;
  const hw = (w1 - w0) / 2;
  const hb = (b1 - b0) / 2;
  const N = 16;
  const proj = (u: number, v: number, z: number): [number, number] => [
    360 + (u - v) * 190,
    240 + (u + v) * 72 - Math.min(Math.max(z, 0), 1.25) * 170,
  ];
  const at = (i: number, k: number) => {
    const u = (i / N) * 2 - 1;
    const v = (k / N) * 2 - 1;
    return proj(u, v, fn(cw + u * hw, cb + v * hb) / zmax);
  };
  const dp = (pts: Array<[number, number]>) => pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
  const lines = [];
  for (let i = 0; i <= N; i += 2) {
    lines.push(ln(dp(range(N + 1, (k) => at(i, k))), { stroke: MUT, width: 1 }));
    lines.push(ln(dp(range(N + 1, (k) => at(k, i))), { stroke: MUT, width: 1 }));
  }
  const place = (q: { w: number; b: number }) => {
    const u = clamp((q.w - cw) / hw, -1, 1);
    const v = clamp((q.b - cb) / hb, -1, 1);
    return proj(u, v, fn(cw + u * hw, cb + v * hb) / zmax);
  };
  if (path && path.length > 1) lines.push(ln(dp(path.map(place)), { stroke: INK, width: 2 }));
  const points: PlotPoint[] = [];
  if (mark) {
    const m = place(mark);
    points.push({ cx: m[0], cy: m[1], r: 7, fill: AC, stroke: 'none', op: 1 });
  }
  return { lines, points };
}

/** The largest value of fn on a coarse grid of the w-b domain, used to scale a surface to its frame. */
export function surfaceMax(ctx: LabCtx, fn: (w: number, b: number) => number): number {
  const [w0, w1] = ctx.dom.w;
  const [b0, b1] = ctx.dom.b;
  let m = 0;
  for (let i = 0; i <= 8; i++) {
    for (let k = 0; k <= 8; k++) m = Math.max(m, fn(w0 + ((w1 - w0) * i) / 8, b0 + ((b1 - b0) * k) / 8));
  }
  return m || 1;
}
