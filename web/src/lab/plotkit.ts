import type { PlotBar, PlotLine, PlotPoint, PlotSpec } from '../components/Plot';
import { emptyPlot } from '../components/Plot';
import { clamp, fmt, range } from './format';

/** The design's canvas: 720 by 400 with room for axis labels. */
export const W = 720;
export const H = 400;
const L = 64;
const R = 20;
const T = 16;
const B = 52;

export const AC = 'var(--ac)';
export const INK = 'var(--ink)';
export const MUT = 'var(--mut)';

export type Box = { l: number; r: number; t: number; b: number };
export type Domain = [number, number];

export const DEFAULT_BOX: Box = { l: L, r: W - R, t: T, b: H - B };

/**
 * Part of a segment inside the domain rectangle, by Liang-Barsky clipping, or null when it
 * misses the rectangle. A line drawn by its two ends alone would bend at the frame if its
 * ends were pushed onto the edge, so lines are clipped instead.
 */
export function clipSegment(
  x0: number, y0: number, x1: number, y1: number, xd: Domain, yd: Domain,
): [number, number, number, number] | null {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, x0 - xd[0]], [dx, xd[1] - x0], [-dy, y0 - yd[0]], [dy, yd[1] - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

export function frame(xd: Domain, yd: Domain, box: Box = DEFAULT_BOX) {
  const x = (v: number) => box.l + ((v - xd[0]) / (xd[1] - xd[0])) * (box.r - box.l);
  const y = (v: number) => box.b - ((v - yd[0]) / (yd[1] - yd[0])) * (box.b - box.t);
  const cx = (v: number) => clamp(x(v), box.l, box.r);
  const cy = (v: number) => clamp(y(v), box.t, box.b);
  const num = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '0');
  return {
    x, y, cx, cy, b: box, xd, yd,
    xTicks: (label: (v: number) => string = fmt) =>
      range(5, (i) => {
        const v = xd[0] + ((xd[1] - xd[0]) * i) / 4;
        return { x: x(v), y1: box.t, y2: box.b, ty: box.b + 16, label: label(v) };
      }),
    yTicks: (label: (v: number) => string = fmt) =>
      range(5, (i) => {
        const v = yd[0] + ((yd[1] - yd[0]) * i) / 4;
        return { x1: box.l, x2: box.r, y: y(v), tx: box.l - 8, ty: y(v) + 4, label: label(v) };
      }),
    /** A polyline through data points, cut wherever it leaves the frame. */
    path: (pts: Array<[number, number]>) => {
      let d = '';
      let open = false;
      for (let i = 1; i < pts.length; i++) {
        const c = clipSegment(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], xd, yd);
        if (!c) {
          open = false;
          continue;
        }
        const startsAtPoint = c[0] === pts[i - 1][0] && c[1] === pts[i - 1][1];
        if (!(open && startsAtPoint)) d += `${d ? ' ' : ''}M${num(x(c[0]))} ${num(y(c[1]))}`;
        d += ` L${num(x(c[2]))} ${num(y(c[3]))}`;
        open = c[2] === pts[i][0] && c[3] === pts[i][1];
      }
      return d;
    },
    /** A straight segment, cut where it leaves the frame. Empty when it is entirely outside. */
    line: (x0: number, y0: number, x1: number, y1: number) => {
      const c = clipSegment(x0, y0, x1, y1, xd, yd);
      return c ? `M${num(x(c[0]))} ${num(y(c[1]))} L${num(x(c[2]))} ${num(y(c[3]))}` : '';
    },
  };
}
export type Frame = ReturnType<typeof frame>;

export const pt = (f: Frame, x: number, y: number, opt: Partial<PlotPoint> = {}): PlotPoint => ({
  cx: f.cx(x), cy: f.cy(y), r: 4, fill: INK, stroke: 'none', op: 0.8, ...opt,
});

export const ln = (d: string, opt: Partial<PlotLine> = {}): PlotLine => ({
  d, stroke: AC, width: 2.5, dash: '', ...opt,
});

/** A new plot with both axes ticked. */
export function axes(f: Frame, xLabel?: (v: number) => string, yLabel?: (v: number) => string): PlotSpec {
  const p = emptyPlot();
  p.xTicks = f.xTicks(xLabel);
  p.yTicks = f.yTicks(yLabel);
  return p;
}

/** Bars for counts in equal bins between lo and hi. */
export function histBars(f: Frame, counts: number[], lo: number, hi: number, fill: string, op = 0.85): PlotBar[] {
  const w = (hi - lo) / counts.length;
  return counts.map((c, i) => ({
    x: f.x(lo + i * w) + 1,
    y: f.cy(c),
    w: Math.max(1, f.x(lo + w) - f.x(lo) - 2),
    h: Math.max(0, f.b.b - f.cy(c)),
    fill,
    stroke: 'none',
    op,
  }));
}

/**
 * The closed curve where the cost is `level` above its lowest value, for a quadratic bowl
 * with second derivatives [a, b, c] (the matrix [[a, b], [b, c]]) centred on `centre`.
 */
export function ellipse(f: Frame, h: [number, number, number], centre: [number, number], level: number): string {
  const pts = range(181, (i) => {
    const t = (i / 180) * Math.PI * 2;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    const q = h[0] * dx * dx + 2 * h[1] * dx * dy + h[2] * dy * dy;
    const r = Math.sqrt((2 * level) / q);
    return [centre[0] + r * dx, centre[1] + r * dy] as [number, number];
  });
  return f.path(pts);
}

/** A vertical bar from zero for each value, as the design draws weights and dot-product terms. */
export function signedBars(f: Frame, values: number[], width = 0.5): PlotBar[] {
  return values.map((v, i) => {
    const base = f.cy(0);
    const top = f.cy(v);
    return {
      x: f.x(i + (1 - width) / 2),
      y: Math.min(base, top),
      w: f.x(width) - f.x(0),
      h: Math.abs(top - base),
      fill: v > 0 ? AC : MUT,
      stroke: 'none',
      op: 0.9,
    };
  });
}

/** Round tick values from lo to hi: steps of 1, 2, 5, 10... chosen so there are at most `max` of them. */
export function evenTicks(lo: number, hi: number, max = 6): number[] {
  const span = hi - lo;
  let step = 1;
  for (const k of [1, 2, 5, 10, 20, 50, 100]) {
    step = k;
    if (span / k <= max) break;
  }
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e9) / 1e9);
  return out;
}

/** Replace the automatic ticks of a plot with ticks at the given data values. */
export function tickAt(
  p: PlotSpec, f: Frame, ticks: { x?: number[]; y?: number[] }, xLabel: (v: number) => string = fmt, yLabel: (v: number) => string = fmt,
): PlotSpec {
  if (ticks.x) p.xTicks = ticks.x.map((v) => ({ x: f.x(v), y1: f.b.t, y2: f.b.b, ty: f.b.b + 16, label: xLabel(v) }));
  if (ticks.y) p.yTicks = ticks.y.map((v) => ({ x1: f.b.l, x2: f.b.r, y: f.y(v), tx: f.b.l - 8, ty: f.y(v) + 4, label: yLabel(v) }));
  return p;
}
