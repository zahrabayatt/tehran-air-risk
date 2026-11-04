import { logLoss, sigmoid } from '../engine';
import { fixed } from '../format';
import { lab } from '../snippets';
import type { Stage } from '../types';
import { VIEWS } from '../views';
import { logCost, sqCost } from '../views/shared';
import { costStats, tex, view } from './shared';

/** Steps 7 to 9: why squared error fails, the logistic loss for one example, and the cost for all of them. */

const r05 = (v: number) => Math.round(v * 20) / 20;

export const COST: Stage[] = [
  {
    part: 'The cost',
    week: 'Course 1, Week 3. Logistic loss.',
    title: 'Why not squared error?',
    text: 'Squared error worked for a straight line. With a sigmoid inside it loses its bowl shape, so a better loss is needed.',
    wb: true,
    views: [
      view('Compare the two', VIEWS.squaredVsLogistic),
      view('Squared error surface', VIEWS.squaredSurface),
      view('Logistic cost surface', VIEWS.logisticSurface),
    ],
    stats: (ctx, c) => [
      { k: 'Squared error J', v: fixed(sqCost(ctx, c.w, c.b), 3) },
      { k: 'Logistic J', v: fixed(logCost(ctx, c.w, c.b), 3) },
    ],
    notation: [
      { s: tex`\text{loss}`, m: 'The measure for one example', c: 'loss' },
      { s: tex`J`, m: 'The cost: the average loss over all examples', c: 'cost / m' },
    ],
    math: [
      {
        tex: tex`J_{\text{sq}}(w,b) = \frac{1}{2m} \sum_{i} \left( g\!\left(w\,x^{(i)} + b\right) - y^{(i)} \right)^2`,
        why: 'The same squared-error formula, with the sigmoid inside. The result has flat plateaus.',
      },
      {
        tex: tex`|z| \text{ large} \;\Rightarrow\; g(z) \approx 0 \text{ or } 1, \text{ whatever the exact } z`,
        why: 'On a plateau the cost barely changes however w or b move, so there is no clear direction to improve even when the predictions are wrong.',
      },
    ],
    worked: (ctx, c) =>
      `At w = ${fixed(c.w, 2)}, b = ${fixed(c.b, 2)}:\nSquared error cost: ${fixed(sqCost(ctx, c.w, c.b), 4)}\nLogistic cost:      ${fixed(logCost(ctx, c.w, c.b), 4)}`,
    code: [lab('squared_error_cost')],
    sk: '# scikit-learn’s LogisticRegression always uses the logistic loss.',
    skNote: 'The library makes this choice for you. This step explains why.',
    tries: [
      {
        label: 'A very wrong model',
        note: 'Squared error has flattened out: nudging w hardly changes it. The logistic cost still changes clearly, which is the point.',
        set: (ctx) => ({ w0: ctx.dom.w[0], b0: r05(ctx.star.b * 2), view: 0 }),
      },
    ],
  },
  {
    week: 'Course 1, Week 3. Logistic loss.',
    title: 'Logistic loss',
    text: 'Separate curves for y = 1 and y = 0. A confident wrong answer costs far more. Set a prediction and a label.',
    ctl: ['pv', 'yv'],
    views: [view('Loss curves', VIEWS.lossCurves)],
    stats: (_ctx, c) => [
      { k: 'Prediction f', v: fixed(c.pv, 2) },
      { k: 'Label y', v: String(c.yv) },
      { k: 'Loss', v: fixed(logLoss(c.pv, c.yv), 3) },
    ],
    notation: [
      { s: tex`\log`, m: 'Natural logarithm', c: 'np.log' },
      { s: tex`f,\; y`, m: 'The predicted probability and the true label of one day', c: 'f, y' },
    ],
    math: [
      {
        tex: tex`\text{loss}(f, y) = \begin{cases} -\log(f) & \text{if } y = 1 \\ -\log(1 - f) & \text{if } y = 0 \end{cases}`,
        why: 'If the day was above 35.4 μg/m³ (y = 1), the loss is zero when f = 1 and grows without limit as f approaches 0. The other case mirrors it.',
      },
      {
        tex: tex`\text{loss}(f, y) = -y \log(f) - (1 - y) \log(1 - f)`,
        why: 'The same thing on one line. When y = 1 the second term vanishes. When y = 0 the first term vanishes.',
      },
    ],
    worked: (_ctx, c) =>
      `y = ${c.yv}, f = ${fixed(c.pv, 2)}\nloss = −${c.yv} × log(${fixed(c.pv, 2)}) − ${1 - c.yv} × log(${fixed(1 - c.pv, 2)})\n     = ${fixed(logLoss(c.pv, c.yv), 3)}`,
    code: [lab('logistic_loss')],
    sk: 'from sklearn.metrics import log_loss\n\nlog_loss([y], [f], labels=[0, 1])',
    skNote: 'log_loss averages this over all the examples you pass.',
    tries: [
      { label: 'Confident and right', note: 'Almost no loss: the prediction was 0.95 and the day was above 35.4 μg/m³.', set: { pv: 0.95, yv: 1 } },
      { label: 'Confident and wrong', note: 'A large loss, which is the point: the day was above 35.4 μg/m³ and the prediction was 0.05.', set: { pv: 0.05, yv: 1 } },
      { label: 'Unsure', note: 'A moderate loss either way: a prediction of 0.5 is never very wrong or very right.', set: { pv: 0.5, yv: 0 } },
    ],
  },
  {
    week: 'Course 1, Week 3. Cost function.',
    title: 'Cost function',
    text: 'Average the losses over every day. Move w and b, and watch the marker on the cost shape.',
    wb: true,
    views: [view('J(w) curve', VIEWS.costOfW), view('Cost map', VIEWS.costMap), view('Surface', VIEWS.logisticSurface)],
    stats: costStats,
    notation: [
      { s: tex`J(w,b)`, m: 'Average loss across the training days', c: 'total / m' },
      { s: tex`f^{(i)}`, m: 'The probability for day i', c: 'f_i = sigmoid(z_i)' },
    ],
    math: [
      {
        tex: tex`J(w,b) = \frac{1}{m} \sum_{i=0}^{m-1} \text{loss}\!\left( f_{w,b}\!\left(x^{(i)}\right),\, y^{(i)} \right)`,
        why: 'Loss is for one example, and cost is the average over the training set.',
      },
      {
        tex: tex`J(w,b) = -\frac{1}{m} \sum_{i} \left[ y^{(i)} \log f^{(i)} + \left(1 - y^{(i)}\right) \log\left(1 - f^{(i)}\right) \right]`,
        why: 'The full formula, after substituting the loss. There is no 1/2 here.',
      },
    ],
    worked: (ctx, c) => {
      const l = [0, 1, 2].map((i) => logLoss(sigmoid(c.w * ctx.d.x[i] + c.b), ctx.d.y[i]));
      return `First three losses: ${l.map((v) => fixed(v, 3)).join(', ')}\nAverage over all ${ctx.d.n} days:\nJ = ${fixed(logCost(ctx, c.w, c.b), 3)}`;
    },
    code: [lab('compute_cost_loop')],
    sk: 'from sklearn.metrics import log_loss\n\nlog_loss(y, model.predict_proba(X)[:, 1])',
    skNote: 'log_loss is this same cost function: the mean loss, with nothing added.',
    tries: [
      {
        label: 'Worse boundary',
        note: 'Move b away from its best value and the cost rises.',
        set: (ctx) => ({ w0: r05(ctx.star.w), b0: r05(ctx.star.b - 1.5), view: 0 }),
      },
      {
        label: 'Better boundary',
        note: 'Closer to the lowest point of the cost map, so the cost is lower.',
        set: (ctx) => ({ w0: r05(ctx.star.w), b0: r05(ctx.star.b), view: 1 }),
      },
    ],
  },
];
