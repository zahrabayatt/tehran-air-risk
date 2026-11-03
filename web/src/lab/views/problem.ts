import { emptyPlot } from '../../components/Plot';
import { fitLinear, linearCrossing } from '../engine';
import { fixed, fmt, niceTop } from '../format';
import { AC, INK, MUT, axes, frame, ln, pt, tickAt } from '../plotkit';
import type { ViewFn } from '../types';
import { XL, dayDot, jitter } from './shared';

/** Views of the first part: the data, the label and the timing, and why a line is not enough. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const series: ViewFn = (ctx, c) => {
  const n = ctx.d.n;
  const f = frame([0, n - 1], ctx.dom.tomorrow);
  const p = axes(f);
  p.lines = [
    ln(f.path(ctx.d.tomorrow.map((v, i) => [i, v] as [number, number])), { width: 1.5 }),
    ln(f.line(0, c.thresh, n - 1, c.thresh), { stroke: INK, dash: '6 4', width: 1.5 }),
  ];
  p.xLabel = 'Day of the sample';
  p.yLabel = 'Mean PM2.5 of the target day (μg/m³)';
  const rows = ctx.d.rows;
  p.legend = [
    `${n} consecutive training days of West Tehran, target days ${rows[0].target_date} to ${rows[n - 1].target_date}`,
    'Dashed: your threshold',
  ];
  return p;
};

export const months: ViewFn = (ctx) => {
  const f = frame([0, 12], [0, 100]);
  const p = emptyPlot();
  p.yTicks = f.yTicks();
  p.xTicks = MONTHS.map((l, i) => ({ x: f.x(i + 0.5), y1: f.b.b, y2: f.b.b, ty: f.b.b + 16, label: l }));
  const slot = f.x(1) - f.x(0);
  const bar = (month: number, share: number, off: number, fill: string, op: number) => ({
    x: f.x(month - 1) + 4 + off * ((slot - 8) / 2),
    y: f.y(share * 100),
    w: (slot - 8) / 2 - 1,
    h: f.y(0) - f.y(share * 100),
    fill,
    stroke: 'none',
    op,
  });
  p.bars = ctx.months.flatMap((m) => [bar(m.month, m.cell_rate, 0, AC, 0.9), bar(m.month, m.pooled_rate, 1, MUT, 0.7)]);
  p.xLabel = 'Calendar month of the target day';
  p.yLabel = 'Share of days above 35.4 (%)';
  p.legend = [
    'Accent: West Tehran, training days',
    'Grey: all 12 squares pooled, training days',
    'Real data from the training days, at the label’s 35.4 μg/m³',
  ];
  return p;
};

export const todayTomorrow: ViewFn = (ctx, c) => {
  const top = ctx.dom.pm[1];
  const f = frame([0, top], [0, top]);
  const p = axes(f);
  p.points = ctx.d.pm.map((v, i) => pt(f, v, ctx.d.tomorrow[i], { r: 3.5, op: 0.6 }));
  p.lines = [
    ln(f.line(0, c.thresh, top, c.thresh), { stroke: INK, dash: '6 4', width: 1.5 }),
    ln(f.line(0, 0, top, top), { stroke: MUT, dash: '2 4', width: 1.2 }),
  ];
  p.xLabel = 'PM2.5 so far today, mean of the hours before the cutoff (μg/m³)';
  p.yLabel = 'Mean PM2.5 of tomorrow (μg/m³)';
  p.legend = ['Each dot is one day', 'Dashed: your threshold', 'Dotted: tomorrow equal to today so far'];
  return p;
};

export const timeline: ViewFn = (_ctx, c) => {
  const p = emptyPlot();
  const y = 190;
  const x0 = 70;
  const x1 = 660;
  const tx = (h: number) => x0 + (h / 48) * (x1 - x0);
  const seg = (a: number, b: number, fill: string, op: number) => ({ x: tx(a), y: y - 22, w: tx(b) - tx(a), h: 44, fill, stroke: 'none', op });
  p.bars = [seg(0, c.cutoff, AC, 0.7), seg(c.cutoff, 24, MUT, 0.18), seg(24, 48, AC, 0.25)];
  const label = (x: number, yy: number, t: string, anchor: 'start' | 'middle' | 'end', size = 13) => ({ x, y: yy, t, anchor, size });
  p.texts = [
    label(tx(c.cutoff / 2), y + 5, c.cutoff >= 4 ? 'Inputs' : '', 'middle', 14),
    label(tx((c.cutoff + 24) / 2), y + 5, 'Not used', 'middle', 14),
    label(tx(36), y + 5, 'Target day', 'middle', 14),
    label(tx(0), y + 50, 'Today 00:00', 'start'),
    label(tx(c.cutoff), y - 50, `Cutoff ${String(c.cutoff).padStart(2, '0')}:00`, 'middle'),
    label(tx(24), y + 50, 'Tomorrow 00:00', 'middle'),
    label(tx(48), y + 50, 'Tomorrow 24:00', 'end'),
  ].filter((t) => t.t !== '');
  p.lines = [ln(`M${tx(c.cutoff)} ${y - 42} L${tx(c.cutoff)} ${y + 22}`, { stroke: INK, width: 2 })];
  p.legend = [
    'Nothing after the cutoff can enter the model',
    'The live model’s cutoff is 12:00 Tehran time, and CAMS’s own forecast of tomorrow is never an input',
  ];
  return p;
};

export const labels: ViewFn = (ctx, c) => {
  const n = ctx.d.n;
  const f = frame([0, n - 1], ctx.dom.tomorrow);
  const p = axes(f);
  p.points = ctx.d.tomorrow.map((v, i) => dayDot(f, i, v, v > c.thresh ? 1 : 0));
  p.lines = [ln(f.line(0, c.thresh, n - 1, c.thresh), { stroke: INK, dash: '6 4', width: 1.5 })];
  p.xLabel = 'Day of the sample';
  p.yLabel = 'Mean PM2.5 of the target day (μg/m³)';
  p.legend = ['Filled dot: label 1', 'Ring: label 0', 'Dashed: your threshold'];
  return p;
};

export const balance: ViewFn = (ctx, c) => {
  const share = ctx.share(c.thresh) * 100;
  const f = frame([0, 2], [0, 100]);
  const p = emptyPlot();
  p.yTicks = f.yTicks();
  p.xTicks = [
    { x: f.x(0.5), y1: f.b.b, y2: f.b.b, ty: f.b.b + 16, label: 'y = 1: above' },
    { x: f.x(1.5), y1: f.b.b, y2: f.b.b, ty: f.b.b + 16, label: 'y = 0: at or below' },
  ];
  p.bars = [
    { x: f.x(0.2), y: f.y(share), w: f.x(0.8) - f.x(0.2), h: f.y(0) - f.y(share), fill: AC, stroke: 'none', op: 0.9 },
    { x: f.x(1.2), y: f.y(100 - share), w: f.x(1.8) - f.x(1.2), h: f.y(0) - f.y(100 - share), fill: MUT, stroke: 'none', op: 0.8 },
  ];
  p.texts = [
    { x: f.x(0.5), y: f.y(share) - 8, t: `${share.toFixed(1)}%`, anchor: 'middle', size: 15 },
    { x: f.x(1.5), y: f.y(100 - share) - 8, t: `${(100 - share).toFixed(1)}%`, anchor: 'middle', size: 15 },
  ];
  p.yLabel = 'Share of sample days (%)';
  const w = trainShares(ctx);
  p.legend = [
    `This sample at ${fmt(c.thresh)} μg/m³ (West Tehran, ${ctx.d.n} days)`,
    `At 35.4: West Tehran, all its training days ${w.cell}%. All 12 squares pooled, training days ${w.pooled}%.`,
  ];
  return p;
};

/** Share of training days above 35.4 by square, from the months table, as whole-percent text. */
export function trainShares(ctx: { months: Array<{ cell_rate: number; cell_days: number; pooled_rate: number; pooled_days: number }> }) {
  const sum = (rate: 'cell_rate' | 'pooled_rate', days: 'cell_days' | 'pooled_days') => {
    const total = ctx.months.reduce((s, m) => s + m[days], 0);
    return (ctx.months.reduce((s, m) => s + m[rate] * m[days], 0) / total) * 100;
  };
  return { cell: fixed(sum('cell_rate', 'cell_days'), 1), pooled: fixed(sum('pooled_rate', 'pooled_days'), 1) };
}

/** The days used by the linear-regression step: 60 spread through the sample, plus `far` very polluted days. */
export function linearSet(ctx: Parameters<ViewFn>[0], far: number): { xs: number[]; ys: number[] } {
  const xs = ctx.base.map((i) => ctx.d.x[i]);
  const ys = ctx.base.map((i) => ctx.d.y[i]);
  for (let i = 0; i < far; i++) {
    xs.push(ctx.farX(i));
    ys.push(1);
  }
  return { xs, ys };
}

export function linearFit(ctx: Parameters<ViewFn>[0], far: number) {
  const { xs, ys } = linearSet(ctx, far);
  const m = fitLinear(xs, ys);
  return { ...m, cross: linearCrossing(m.w, m.b), xs, ys };
}

export const whyNotLinear: ViewFn = (ctx, c) => {
  const top = niceTop(ctx.farX(4) + 0.4, 4);
  const f = frame([0, top], [-0.2, 1.3]);
  const p = tickAt(axes(f), f, { y: [0, 0.5, 1] }, fmt, (v) => String(v));
  const m = linearFit(ctx, c.far);
  p.points = m.xs.map((x, i) => dayDot(f, x, m.ys[i] === 1 ? jitter(i, 1) : jitter(i, 0), m.ys[i]));
  p.lines = [
    ln(f.line(0, m.b, top, m.w * top + m.b)),
    ln(f.line(0, 0.5, top, 0.5), { stroke: MUT, dash: '2 4', width: 1.5 }),
    ln(f.line(m.cross, -0.2, m.cross, 1.3), { stroke: INK, dash: '6 4', width: 2 }),
  ];
  p.xLabel = XL;
  p.yLabel = 'y';
  p.legend = [
    'Line: linear regression',
    'Dotted: 0.5',
    'Dashed: where the line reaches 0.5',
    'Filled dot: y = 1. Ring: y = 0.',
    c.far > 0 ? `${c.far} very polluted day${c.far === 1 ? '' : 's'} added beyond every real one: the crossing moves right` : '60 real training days, spread through the year',
  ];
  return p;
};
