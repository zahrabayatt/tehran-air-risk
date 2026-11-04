import { sigmoid } from '../engine';
import { fixed } from '../format';
import { lab } from '../snippets';
import type { LabCtx } from '../context';
import type { Stage } from '../types';
import { VIEWS } from '../views';
import { firstDay, modelStats, tex, view } from './shared';

/** Steps 4 to 6: the sigmoid, the logistic model, and the line where its probability is 0.5. */

const r05 = (v: number) => Math.round(v * 20) / 20;

/** Settings of the Logistic model presets, from the best line of the sample. */
export const gentleCurve = (ctx: LabCtx) => {
  const w = r05(ctx.star.w / 3);
  return { w0: w, b0: r05(-w * ctx.star.x0) };
};
export const steepCurve = (ctx: LabCtx) => {
  const w = Math.min(ctx.dom.w[1], r05(ctx.star.w * 2.8));
  return { w0: w, b0: r05(-w * ctx.star.x0) };
};
export const shiftedCurve = (ctx: LabCtx) => ({ w0: r05(ctx.star.w), b0: r05(ctx.star.b - 1.5) });

export const MODEL: Stage[] = [
  {
    part: 'The model',
    week: 'Course 1, Week 3. Sigmoid function.',
    title: 'Sigmoid',
    text: 'The sigmoid squeezes any number into a value between 0 and 1. Move z and watch the output.',
    ctl: ['z'],
    views: [view('g(z)', VIEWS.sigmoidCurve)],
    stats: (_ctx, c) => [
      { k: 'z', v: fixed(c.z, 2) },
      { k: 'g(z)', v: fixed(sigmoid(c.z), 4) },
      { k: 'Class at 0.5', v: sigmoid(c.z) >= 0.5 ? '1' : '0' },
    ],
    notation: [
      { s: tex`g(z)`, m: 'Sigmoid, also called the logistic function', c: 'sigmoid(z)' },
      { s: tex`z`, m: 'Any real number: a score', c: 'z' },
      { s: tex`e`, m: 'Euler’s number, about 2.718', c: 'np.exp' },
    ],
    math: [
      {
        tex: tex`g(z) = \frac{1}{1 + e^{-z}}`,
        why: 'A large positive z makes e^(−z) nearly 0, so g(z) approaches 1. A large negative z makes it huge, so g(z) approaches 0.',
      },
      {
        tex: tex`g(0) = \frac{1}{1 + 1} = 0.5`,
        why: 'The midpoint. The sign of z decides which side of 0.5 the output is on.',
      },
      {
        tex: tex`g(z) = \frac{e^{z}}{1 + e^{z}} \quad \text{for } z < 0`,
        why: 'The same value, rewritten. A computer overflows on e^(−z) when z is very negative, so the code always uses e^(−|z|), which is never above 1.',
      },
    ],
    worked: (_ctx, c) => {
      const e = Math.exp(-c.z);
      return `g(${fixed(c.z, 2)}) = 1 / (1 + e^(${fixed(-c.z, 2)}))\n        = 1 / (1 + ${fixed(e, 4)})\n        = ${fixed(sigmoid(c.z), 4)}`;
    },
    code: [lab('sigmoid')],
    sk: 'from scipy.special import expit\n\nexpit(z)\n# LogisticRegression applies it inside predict_proba',
    skNote: 'scikit-learn does not expose the sigmoid as its own step. SciPy’s expit is the same function, computed in a way that does not overflow.',
    tries: [
      { label: 'z = 0', note: 'Exactly 0.5: the score sits on the dividing line between the two classes.', set: { z: 0 } },
      { label: 'z = 5', note: 'Nearly 1. The curve flattens because it can never pass 1.', set: { z: 5 } },
      { label: 'z = −5', note: 'Nearly 0, and just as flat as on the other side. The curve never reaches 0 itself.', set: { z: -5 } },
    ],
  },
  {
    week: 'Course 1, Week 3. Logistic regression.',
    title: 'Logistic model',
    text: 'A linear score passed through the sigmoid gives a probability. Set w and b and see the curve.',
    wb: true,
    views: [view('Probability curve', VIEWS.probabilityCurve), view('The score z', VIEWS.scoreLine)],
    stats: modelStats,
    notation: [
      { s: tex`z`, m: 'Linear score', c: 'z_i = b + sum(X[i, j] * w[j])' },
      { s: tex`f_{w,b}(x)`, m: 'Estimated probability that y = 1', c: 'sigmoid(z)' },
    ],
    math: [
      { tex: tex`z = w \cdot x + b`, why: 'The same linear formula as before. Now it is only a score, not the answer.' },
      {
        tex: tex`f_{w,b}(x) = g(w \cdot x + b) = \frac{1}{1 + e^{-(w \cdot x + b)}}`,
        why: 'The output reads as P(y = 1 | x; w, b), the chance of a day above 35.4 μg/m³ given today’s inputs.',
      },
      {
        tex: tex`\hat{y} = \begin{cases} 1 & f_{w,b}(x) \ge 0.5 \\ 0 & \text{otherwise} \end{cases}`,
        why: 'This project keeps the cut-off at 0.5 and never changes it.',
      },
    ],
    worked: (ctx, c) => {
      const d = firstDay(ctx);
      const z = c.w * d.x + c.b;
      return `x = ${fixed(d.x, 2)} (${fixed(d.pm, 1)} μg/m³)\nz = ${fixed(c.w, 2)} × ${fixed(d.x, 2)} + (${fixed(c.b, 2)}) = ${fixed(z, 3)}\nf = g(${fixed(z, 3)}) = ${fixed(sigmoid(z), 3)}\nPrediction: y = ${sigmoid(z) >= 0.5 ? 1 : 0}     Actual: y = ${d.y}`;
    },
    code: [lab('predict_proba_loop')],
    sk: 'from sklearn.linear_model import LogisticRegression\n\nmodel = LogisticRegression(penalty=None).fit(X_train, y_train)\nmodel.coef_, model.intercept_\nmodel.predict_proba(X)[:, 1]\nmodel.predict(X)',
    skNote: 'After fitting, coef_ holds w and intercept_ holds b. The last argument switches off an extra term that scikit-learn adds by default, which this Lab introduces later.',
    tries: [
      { label: 'Gentle curve', note: 'A small w makes a soft transition, so the model is rarely confident.', set: gentleCurve },
      { label: 'Steep curve', note: 'A large w makes the curve almost a step, and the model very confident.', set: steepCurve },
      { label: 'Shift the curve', note: 'Changing b moves the curve left or right without changing its steepness.', set: shiftedCurve },
    ],
  },
  {
    week: 'Course 1, Week 3. Decision boundary.',
    title: 'Decision boundary',
    text: 'With two features, the points where the probability equals 0.5 form a line. Move the weights and see it change.',
    ctl: ['w1', 'w2', 'b2'],
    views: [view('PM2.5 and wind', VIEWS.boundaryWind), view('PM2.5 and season', VIEWS.boundarySeason)],
    stats: (_ctx, c) => [
      { k: 'w₁', v: fixed(c.v1, 3) },
      { k: 'w₂', v: fixed(c.v2, 3) },
      { k: 'b', v: fixed(c.vb, 3) },
    ],
    notation: [
      { s: tex`x_1,\; x_2`, m: 'PM2.5 so far today (tens of μg/m³), and a second feature: wind speed, or the time of year (+1 at New Year, −1 at the start of July)', c: 'X[:, 0], X[:, 1]' },
      { s: tex`w_1,\; w_2`, m: 'One weight for each', c: 'w[0], w[1]' },
    ],
    math: [
      {
        tex: tex`g(z) \ge 0.5 \;\iff\; z \ge 0 \;\iff\; w \cdot x + b \ge 0`,
        why: 'The sigmoid crosses 0.5 exactly where z = 0, so the boundary comes from the linear part.',
      },
      {
        tex: tex`w_1 x_1 + w_2 x_2 + b = 0 \;\Rightarrow\; x_2 = -\frac{w_1 x_1 + b}{w_2}`,
        why: 'That is a straight line in the two-feature plane. Days on one side of it are predicted y = 1.',
      },
    ],
    worked: (ctx, c) => {
      const x1 = ctx.star.x0;
      const at = (x: number) => -(c.v1 * x + c.vb) / (Math.abs(c.v2) < 1e-6 ? 1e-6 : c.v2);
      const x2 = at(x1);
      return `Boundary: ${fixed(c.v1, 2)} x₁ + (${fixed(c.v2, 2)}) x₂ + (${fixed(c.vb, 2)}) = 0\nAt x₁ = ${fixed(x1, 2)}:  x₂ = ${Number.isFinite(x2) && Math.abs(x2) < 1e6 ? fixed(x2, 2) : 'off the chart'}`;
    },
    code: [lab('boundary_x2')],
    sk: 'w1, w2 = model.coef_[0]\nb = model.intercept_[0]\nboundary_x2 = -(w1 * x1 + b) / w2',
    skNote: 'scikit-learn gives the same weights through coef_ and intercept_. The plot is drawn by hand.',
    tries: [
      {
        label: 'Pollution only',
        note: 'With w₂ near zero the line is nearly vertical, so only PM2.5 decides.',
        set: (ctx) => ({ v1: r05(ctx.star.w), v2: 0.05, vb: r05(ctx.star.b), view: 0 }),
      },
      {
        label: 'Include wind',
        note: 'Fitted to the sample, the wind weight is close to zero: once PM2.5 is known, wind so far today adds little, so the line stays almost vertical.',
        set: (ctx) => ({ v1: r05(ctx.pair.wind.w[0]), v2: r05(ctx.pair.wind.w[1]), vb: r05(ctx.pair.wind.b), view: 0 }),
      },
      {
        label: 'Include season',
        note: 'Fitted to the sample, the season weight is large and the line tilts steeply: in winter (time of year near +1) a low PM2.5 already means y = 1, in summer only a very high one does.',
        set: (ctx) => ({ v1: r05(ctx.pair.season.w[0]), v2: r05(ctx.pair.season.w[1]), vb: r05(ctx.pair.season.b), view: 1 }),
      },
    ],
  },
];
