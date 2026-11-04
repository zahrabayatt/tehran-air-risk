import { emptyPlot } from '../../components/Plot';
import { DAILY_RUN_TEHRAN, DAILY_RUN_UTC } from '../../config';
import { sandbox } from '../context';
import type { LabCtx } from '../context';
import { fixed, fmt, niceTop } from '../format';
import { AC, INK, MUT, axes, frame, ln, pt } from '../plotkit';
import type { ViewFn } from '../types';

/** Views of the last part. The first three are the frozen model's own numbers from model.json. */

export const BASELINE_NAMES = ['Overall rate', 'Monthly rate', 'Live model'];

export function baselineCosts(ctx: LabCtx): number[] {
  const m = ctx.model;
  return [m.baselines.overall.held_out_cost, m.baselines.monthly.held_out_cost, m.cost.held_out];
}

/** The sentence the page says about the result, true whichever way it went. */
export function verdict(ctx: LabCtx): string {
  const [overall, monthly, model] = baselineCosts(ctx);
  if (ctx.model.beats_baselines && model < overall && model < monthly) {
    return `The live model beats both simple guesses on days it never trained on: ${fixed(model, 3)} against ${fixed(overall, 3)} and ${fixed(monthly, 3)}.`;
  }
  return `The live model does NOT beat both simple guesses on days it never trained on: ${fixed(model, 3)} against ${fixed(overall, 3)} (overall rate) and ${fixed(monthly, 3)} (monthly rate).`;
}

export const costVsGuesses: ViewFn = (ctx) => {
  const costs = baselineCosts(ctx);
  const f = frame([0, 3], [0, niceTop(Math.max(...costs), 4)]);
  const p = emptyPlot();
  p.yTicks = f.yTicks((v) => fixed(v, 2));
  p.xTicks = BASELINE_NAMES.map((l, i) => ({ x: f.x(i + 0.5), y1: f.b.b, y2: f.b.b, ty: f.b.b + 16, label: l }));
  p.bars = costs.map((v, i) => ({ x: f.x(i + 0.2), y: f.y(v), w: f.x(0.6) - f.x(0), h: f.y(0) - f.y(v), fill: i === 2 ? AC : MUT, stroke: 'none', op: 0.9 }));
  p.texts = costs.map((v, i) => ({ x: f.x(i + 0.5), y: f.y(v) - 8, t: fixed(v, 3), anchor: 'middle' as const, size: 14 }));
  p.yLabel = 'Held-out logistic cost, lower is better';
  p.legend = ['The live model’s own held-out year, from model.json', verdict(ctx)];
  return p;
};

/** The held-out probabilities by outcome, drawn on a square-root scale because most days sit in the first bin. */
export const probabilitiesByOutcome: ViewFn = (ctx) => {
  const { bins, counts_y1: yes, counts_y0: no } = ctx.model.held_out_probabilities;
  const top = niceTop(Math.max(...yes, ...no), 4);
  const f = frame([0, bins.length - 1], [0, Math.sqrt(top)]);
  const p = emptyPlot();
  const ticks = [0, 10, 100, 500, 1000, 2000, 3000].filter((v) => v <= top);
  p.yTicks = ticks.map((v) => ({ x1: f.b.l, x2: f.b.r, y: f.y(Math.sqrt(v)), tx: f.b.l - 8, ty: f.y(Math.sqrt(v)) + 4, label: fmt(v) }));
  p.xTicks = bins.slice(0, -1).map((v, i) => ({ x: f.x(i + 0.5), y1: f.b.t, y2: f.b.b, ty: f.b.b + 16, label: fixed(v, 1) }));
  const bar = (count: number, i: number, off: number, fill: string, op: number) => ({
    x: f.x(i) + 3 + off * ((f.x(1) - f.x(0) - 6) / 2),
    y: f.y(Math.sqrt(count)),
    w: (f.x(1) - f.x(0) - 6) / 2 - 1,
    h: f.y(0) - f.y(Math.sqrt(count)),
    fill,
    stroke: 'none',
    op,
  });
  p.bars = no.map((c, i) => bar(c, i, 0, MUT, 0.7)).concat(yes.map((c, i) => bar(c, i, 1, AC, 0.9)));
  p.xLabel = 'Predicted probability (start of each bin)';
  p.yLabel = 'Held-out days (square-root scale)';
  p.legend = [
    'Accent: days that ended above the threshold',
    'Grey: days that ended at or below it',
    `${no.reduce((a, b) => a + b, 0).toLocaleString('en-US')} days at or below, ${yes.reduce((a, b) => a + b, 0).toLocaleString('en-US')} above`,
  ];
  return p;
};

/** The shipped model's candidates that use its features, in order of lambda. */
export function lambdaRows(ctx: LabCtx) {
  const feats = ctx.model.features.join(',');
  return ctx.model.candidates
    .filter((c) => c.features.join(',') === feats && c.train_cost !== null && c.selection_cost !== null)
    .slice()
    .sort((a, b) => a.lambda - b.lambda);
}

export const costByLambda: ViewFn = (ctx) => {
  const rows = lambdaRows(ctx);
  const p = emptyPlot();
  if (rows.length < 2) {
    p.legend = ['The model file has no candidates for this feature set.'];
    return p;
  }
  const costs = rows.flatMap((r) => [r.train_cost as number, r.selection_cost as number]);
  const f = frame([0, rows.length - 1], [0, niceTop(Math.max(...costs), 4)]);
  p.yTicks = f.yTicks((v) => fixed(v, 2));
  p.xTicks = rows.map((r, i) => ({ x: f.x(i), y1: f.b.t, y2: f.b.b, ty: f.b.b + 16, label: fmt(r.lambda) }));
  p.lines = [
    ln(f.path(rows.map((r, i) => [i, r.train_cost as number] as [number, number])), { stroke: INK, dash: '6 4' }),
    ln(f.path(rows.map((r, i) => [i, r.selection_cost as number] as [number, number]))),
  ];
  const chosen = rows.findIndex((r) => r.chosen);
  if (chosen >= 0) p.points = [pt(f, chosen, rows[chosen].selection_cost as number, { r: 7, fill: AC, op: 1 })];
  p.xLabel = 'λ candidates (spaced evenly on the axis)';
  p.yLabel = 'Cost J (live model)';
  p.legend = [
    'Live model: the features and data it was really trained on',
    'Dashed: training cost',
    'Solid: selection cost, on the six months after the training days. λ was chosen here, before the held-out year was looked at.',
    `The selection days are one warm half-year with only ${ctx.selection.positives} positive days out of ${ctx.selection.rows.toLocaleString('en-US')} days, which is little to choose λ with.`,
    'Marker: the λ the live model uses',
  ];
  return p;
};

export const sandboxSplit: ViewFn = (ctx, c) => {
  const r = sandbox(ctx, c.split);
  const costs = [r.overall, r.monthly, r.model];
  const f = frame([0, 3], [0, niceTop(Math.min(Math.max(...costs), 40), 4)]);
  const p = emptyPlot();
  p.yTicks = f.yTicks((v) => fixed(v, v < 10 ? 1 : 0));
  p.xTicks = ['Overall rate', 'Monthly rate', 'Sandbox model'].map((l, i) => ({ x: f.x(i + 0.5), y1: f.b.b, y2: f.b.b, ty: f.b.b + 16, label: l }));
  p.bars = costs.map((v, i) => ({ x: f.x(i + 0.2), y: f.y(Math.min(v, f.yd[1])), w: f.x(0.6) - f.x(0), h: f.y(0) - f.y(Math.min(v, f.yd[1])), fill: i === 2 ? AC : MUT, stroke: 'none', op: 0.9 }));
  p.texts = costs.map((v, i) => ({ x: f.x(i + 0.5), y: f.y(Math.min(v, f.yd[1])) - 8, t: fixed(v, 3), anchor: 'middle' as const, size: 14 }));
  p.yLabel = 'Logistic cost on the later days, lower is better';
  p.legend = [
    `Sandbox illustration on the sample’s training days: the first ${r.train} train, the next ${r.held} stand in for unseen days`,
    'Not the live model’s result',
    `The sandbox uses the live model’s λ = ${ctx.model.hyperparameters.lambda} on only ${r.train} rows, so λ/m is far stronger than in the live model (${ctx.model.rows.train.toLocaleString('en-US')} rows)`,
  ];
  return p;
};

/* ---------- the daily forecast ---------- */

export const pipeline: ViewFn = () => {
  const p = emptyPlot();
  const steps = ['Fetch', 'Build features', 'Predict', 'Fill outcomes', 'Commit', 'Deploy'];
  steps.forEach((t, i) => {
    const x = 40 + i * 110;
    p.bars.push({ x, y: 160, w: 96, h: 60, fill: 'var(--acs)', stroke: INK, op: 0.9 });
    p.texts.push({ x: x + 48, y: 195, t, anchor: 'middle', size: 13 });
    if (i < 5) p.lines.push(ln(`M${x + 96} 190 L${x + 110} 190`, { stroke: INK, width: 1.5 }));
  });
  p.texts.push({ x: 360, y: 130, t: `Every day at ${DAILY_RUN_UTC} UTC (${DAILY_RUN_TEHRAN} Tehran)`, anchor: 'middle', size: 15 });
  p.legend = ['A failed fetch records a gap and never invents a value', 'The model is frozen: the job applies it and never retrains it'];
  return p;
};

export const FEATURE_LABELS = ['PM2.5 mean', 'PM2.5 max', 'PM2.5 last', 'season sin', 'season cos'];

export const frozenWeights: ViewFn = (ctx) => {
  const w = Array.from(ctx.model.weights);
  const m = Math.max(...w.map(Math.abs)) || 1;
  const f = frame([0, w.length], [-m * 1.2, m * 1.2]);
  const p = axes(f, undefined, (v) => fixed(v, 2));
  p.xTicks = w.map((_, i) => ({ x: f.x(i + 0.5), y1: f.b.b, y2: f.b.b, ty: f.b.b + 16, label: FEATURE_LABELS[i] ?? ctx.model.features[i] }));
  p.bars = w.map((v, i) => ({
    x: f.x(i + 0.2), y: v > 0 ? f.y(v) : f.y(0), w: f.x(0.6) - f.x(0), h: Math.abs(f.y(v) - f.y(0)), fill: v > 0 ? AC : MUT, stroke: 'none', op: 0.9,
  }));
  p.texts = w.map((v, i) => ({ x: f.x(i + 0.5), y: (v > 0 ? f.y(v) : f.y(0)) - 8, t: fixed(v, 3), anchor: 'middle' as const, size: 13 }));
  p.yLabel = 'Saved weight, per z-scored feature';
  p.legend = [`Bias b = ${fixed(ctx.model.bias, 3)}. Weights are applied to features scaled with the saved μ and σ.`];
  return p;
};
