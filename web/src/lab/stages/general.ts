import { polyFit } from '../context';
import { fixed, sciText } from '../format';
import { lab } from '../snippets';
import type { Stage } from '../types';
import { VIEWS } from '../views';
import { tex, view } from './shared';

/** Steps 14 and 15: feature engineering, and a penalty on large weights. */

const YEAR = 365.25;
const angle = (day: number) => (2 * Math.PI * day) / YEAR;

export const BETTER_FEATURES: Stage[] = [
  {
    part: 'Better features',
    week: 'Course 1, Week 2. Feature engineering.',
    title: 'Feature engineering',
    text: 'A plain day number puts December far from January. Sine and cosine fix that. Move the day and see it on the circle.',
    ctl: ['day'],
    views: [view('Season circle', VIEWS.seasonCircle), view('Season alone', VIEWS.seasonAlone)],
    stats: (_ctx, c) => [
      { k: 'Day of year', v: String(c.day) },
      { k: 'x_sin', v: fixed(Math.sin(angle(c.day)), 3) },
      { k: 'x_cos', v: fixed(Math.cos(angle(c.day)), 3) },
    ],
    notation: [
      { s: tex`x_{\sin},\; x_{\cos}`, m: 'Position of the target day on the yearly cycle', c: 'season_sin, season_cos' },
    ],
    math: [
      {
        tex: tex`x_{\sin} = \sin\!\left( \frac{2\pi \cdot \text{day}}{365.25} \right) \qquad x_{\cos} = \cos\!\left( \frac{2\pi \cdot \text{day}}{365.25} \right)`,
        why: 'Both are needed: together they give each day a unique point on a circle, so the last day of the year sits next to the first. The day is the day of year of the day being predicted.',
      },
      {
        tex: tex`z = w_1 x_1 + \cdots + w_{\sin}\, x_{\sin} + w_{\cos}\, x_{\cos} + b`,
        why: 'Still a linear score. Only the inputs are transformed.',
      },
    ],
    worked: (_ctx, c) =>
      `Day ${c.day}:\nx_sin = sin(2π × ${c.day} / 365.25) = ${fixed(Math.sin(angle(c.day)), 3)}\nx_cos = cos(2π × ${c.day} / 365.25) = ${fixed(Math.cos(angle(c.day)), 3)}`,
    code: [lab('season_features')],
    sk: 'import numpy as np\nfrom sklearn.preprocessing import FunctionTransformer\n\ndef season_columns(days):\n    a = 2 * np.pi * days / 365.25\n    return np.column_stack([np.sin(a), np.cos(a)])\n\nFunctionTransformer(season_columns)',
    skNote: 'scikit-learn has no ready-made seasonal-circle feature. FunctionTransformer only wraps your own function so it can sit in a pipeline.',
    tries: [
      {
        label: 'New Year’s Eve',
        note: 'Day 365 sits right next to day 1 on the circle, though the numbers are far apart.',
        set: { day: 365, view: 0 },
      },
      {
        label: 'Midsummer',
        note: 'The opposite side of the circle from January, and in these days almost every dot is a ring: mostly clean days.',
        set: { day: 180, view: 0 },
      },
    ],
  },
  {
    week: 'Course 1, Week 3. Overfitting and regularization.',
    title: 'Overfitting and regularization',
    text: 'Extra polynomial features let the boundary bend around single days. Raise λ and watch the boundary smooth out.',
    ctl: ['lam'],
    views: [view('Boundary', VIEWS.polyBoundary), view('Weight sizes', VIEWS.weightBars)],
    stats: (ctx, c) => {
      const fit = polyFit(ctx, c.lam);
      return [
        { k: 'λ', v: sciText(c.lam) },
        { k: 'Days used', v: String(ctx.sub.idx.length) },
        { k: 'Training cost', v: fixed(fit.plainCost, 3) },
        { k: 'Largest |w|', v: fixed(Math.max(...fit.w.map(Math.abs)), 2) },
      ];
    },
    notation: [
      { s: tex`\lambda`, m: 'Regularization strength', c: 'lambda_' },
      { s: tex`x_1^2,\; x_1 x_2,\; x_1^3,\; \ldots`, m: 'Polynomial terms built from two features', c: 'poly_features(x1, x2)' },
    ],
    math: [
      {
        tex: tex`J(w,b) = -\frac{1}{m} \sum_{i} \left[ y^{(i)} \log f^{(i)} + \left(1 - y^{(i)}\right) \log\left(1 - f^{(i)}\right) \right] + \frac{\lambda}{2m} \sum_{j} w_j^2`,
        why: 'The added term keeps the weights small. The bias b is not penalized.',
      },
      {
        tex: tex`\frac{\partial J}{\partial w_j} = \frac{1}{m} \sum_{i} \left( f^{(i)} - y^{(i)} \right) x_j^{(i)} + \frac{\lambda}{m}\, w_j`,
        why: 'Only the slopes for the weights change; the slope for b does not.',
      },
    ],
    worked: (ctx, c) => {
      const fit = polyFit(ctx, c.lam);
      const sq = fit.w.reduce((a, v) => a + v * v, 0);
      const m = ctx.sub.idx.length;
      return `Σⱼ wⱼ² = ${fixed(sq, 3)}\nPenalty = ${sciText(c.lam)} / (2 × ${m}) × ${fixed(sq, 3)} = ${fixed((c.lam / (2 * m)) * sq, 4)}`;
    },
    code: [lab('poly_features'), lab('fit_polynomial'), lab('compute_cost_reg'), lab('compute_gradient_reg')],
    sk: 'from sklearn.linear_model import LogisticRegression\n\nmodel = LogisticRegression(C=1 / lambda_).fit(X, y)',
    skNote: 'With this cost function, C equals 1 / λ, so a larger C means weaker regularization. scikit-learn’s own default is C = 1.0 with a squared-weights (L2) penalty and the lbfgs solver; with lbfgs the intercept is not penalized, as here.',
    tries: [
      {
        label: 'Very little',
        note: 'The boundary bends around individual days, and the weights are the largest of the three settings.',
        set: { lamExp: -2, view: 0 },
      },
      {
        label: 'Moderate',
        note: 'A smoother boundary and smaller weights.',
        set: { lamExp: 1, view: 0 },
      },
      {
        label: 'Too much',
        note: 'Every weight shrinks toward zero. The model becomes too simple and underfits: its training cost is the highest of the three.',
        set: { lamExp: 3, view: 1 },
      },
    ],
  },
];
