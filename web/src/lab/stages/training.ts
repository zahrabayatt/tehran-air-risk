import { timing } from '../context';
import { fixed, count, sciText } from '../format';
import { lab } from '../snippets';
import type { Stage } from '../types';
import { VIEWS } from '../views';
import { slopesAt, tex, trainStats, view } from './shared';

/** Steps 10 to 13: gradient descent, then the shapes of the maths, learning rates and scaling. */

/** Milliseconds as text: more digits when small. */
const ms = (v: number) => `${v < 1 ? v.toFixed(3) : v.toFixed(2)} ms`;

export const TRAINING: Stage[] = [
  {
    part: 'Training',
    week: 'Course 1, Week 3. Gradient descent for logistic regression.',
    title: 'Gradient descent',
    text: 'Choose a start, a learning rate, and the number of iterations. Press Start and every plot follows the training.',
    wb: true,
    train: 'one',
    alpha: { min: -4, max: 1, init: -1 },
    defaults: { alphaExp: -1, iters: '500' },
    views: [
      view('Moving curve', VIEWS.probabilityCurve),
      view('Cost by iteration', VIEWS.costByIteration),
      view('Path on cost map', VIEWS.costMap),
      view('Parameters', VIEWS.parameters),
    ],
    stats: trainStats,
    notation: [
      { s: tex`\alpha`, m: 'Learning rate: the size of every step', c: 'alpha' },
      { s: tex`\dfrac{\partial J}{\partial w}`, m: 'How fast the cost changes as w changes', c: 'dj_dw' },
      { s: tex`\dfrac{\partial J}{\partial b}`, m: 'How fast the cost changes as b changes', c: 'dj_db' },
    ],
    math: [
      {
        tex: tex`\frac{\partial J}{\partial w_j} = \frac{1}{m} \sum_{i} \left( f_{w,b}\!\left(x^{(i)}\right) - y^{(i)} \right) x_j^{(i)} \qquad \frac{\partial J}{\partial b} = \frac{1}{m} \sum_{i} \left( f_{w,b}\!\left(x^{(i)}\right) - y^{(i)} \right)`,
        why: 'These look the same as for a straight line. The difference is inside f, which now includes the sigmoid.',
      },
      {
        tex: tex`w_j := w_j - \alpha\,\frac{\partial J}{\partial w_j} \qquad b := b - \alpha\,\frac{\partial J}{\partial b}`,
        why: 'Compute both slopes first, then update both parameters at once. Repeat.',
      },
    ],
    worked: (ctx, c) => {
      const g = slopesAt(ctx, c);
      return `Iteration ${c.it}:\nw = ${fixed(c.w, 3)} − ${sciText(c.alpha)} × (${fixed(g[0], 3)}) = ${fixed(c.w - c.alpha * g[0], 3)}\nb = ${fixed(c.b, 3)} − ${sciText(c.alpha)} × (${fixed(g[1], 3)}) = ${fixed(c.b - c.alpha * g[1], 3)}`;
    },
    code: [lab('compute_gradient_loop'), lab('descent')],
    sk: 'from sklearn.linear_model import LogisticRegression\n\nmodel = LogisticRegression(penalty=None).fit(X_train, y_train)',
    skNote: 'scikit-learn does not expose this loop. Its default solver, lbfgs, uses a different method with no learning rate to set, and it aims for the same lowest-cost weights that this descent approaches. If you try SGDClassifier, remember it is a different algorithm (one update per day, not per pass) whose curves will differ, and that its alpha argument means something else entirely (the strength of an extra term it adds), not this page’s α.',
    tries: [
      {
        label: 'A good run',
        note: 'The curve settles onto the data as the cost falls and flattens out.',
        set: { w0: 0, b0: 0, alphaExp: -0.5, iters: '800', view: 0 },
        run: true,
      },
      {
        label: 'Very small α',
        note: 'Stable, but barely moved by the end.',
        set: { w0: 0, b0: 0, alphaExp: -3, iters: '800', view: 1 },
        run: true,
      },
      {
        label: 'α too large',
        note: 'The path bounces from side to side instead of settling.',
        set: { w0: 0, b0: 0, alphaExp: 1, iters: '100', view: 2 },
        run: true,
      },
    ],
  },
  {
    week: 'Course 1, Week 2. Vectorization and multiple features.',
    title: 'Vectorization',
    text: 'The real model uses several features and thousands of days. The same calculation, written as one matrix product.',
    ctl: ['m', 'nf'],
    views: [view('Shapes', VIEWS.shapes)],
    stats: (ctx, c) => {
      const v = ctx.model.vectorization;
      const t = timing(ctx, c.m, c.nf);
      return [
        { k: 'Days m', v: count(c.m) },
        { k: 'Features n', v: String(c.nf) },
        { k: 'Multiplications', v: count(c.m * c.nf) },
        { k: `Python loop, ${count(v.elements)} numbers`, v: `${v.loop_ms.toFixed(1)} ms` },
        { k: `NumPy, ${count(v.elements)} numbers`, v: `${v.numpy_ms.toFixed(2)} ms` },
        { k: 'This browser, loops', v: ms(t.loopMs) },
        { k: 'This browser, matrix form', v: ms(t.matrixMs) },
      ];
    },
    notation: [
      { s: tex`X`, m: 'All days, shape (m, n)', c: 'X' },
      { s: tex`\vec{w}`, m: 'All weights, shape (n,)', c: 'w' },
      { s: tex`\vec{f}`, m: 'All probabilities, shape (m,)', c: 'f' },
    ],
    math: [
      { tex: tex`\vec{z} = X\,\vec{w} + b`, why: 'One score for every day. The bias is added to each.' },
      { tex: tex`\vec{f} = g(\vec{z})`, why: 'The sigmoid applies to each score.' },
      {
        tex: tex`\nabla_{w} J = \frac{1}{m} X^{\mathsf{T}} \left( \vec{f} - \vec{y} \right) \qquad \frac{\partial J}{\partial b} = \frac{1}{m} \sum_{i} \left( f^{(i)} - y^{(i)} \right)`,
        why: 'All the slopes at once, replacing the two nested loops.',
      },
    ],
    worked: (_ctx, c) =>
      `X shape: (${c.m}, ${c.nf})\nw shape: (${c.nf},)\nX @ w shape: (${c.m},)\nMultiplications in one pass: ${count(c.m * c.nf)}`,
    code: [lab('compute_gradient_loop'), lab('gradient_matrix'), lab('predict_proba'), lab('time_dot')],
    sk: '# Happens inside every estimator:\nmodel.predict_proba(X)',
    skNote: 'scikit-learn has no separate step for this because it is already vectorized through NumPy. JavaScript has no NumPy: the browser timings compare two plain loops over days and features with two passes over one flat array. They are measured here, now, and show the idea more than NumPy’s speed.',
    tries: [
      {
        label: 'The sample’s size',
        note: 'The sample has 365 days. Compare the two timings below.',
        set: (ctx) => ({ m: ctx.d.n, nf: 5 }),
      },
      {
        label: 'The live model’s size',
        note: 'The live model trained on this many days. The sample repeats its 365 days to reach it, only so the timings are for a calculation of that size.',
        set: (ctx) => ({ m: ctx.model.rows.train, nf: 5 }),
      },
    ],
  },
  {
    week: 'Course 1, Week 2. Learning rate.',
    title: 'Learning rate',
    text: 'Too small is slow. Too large is unstable. Add your own values and press Start to race them.',
    train: 'lrs',
    defaults: { iters: '300' },
    views: [view('Cost curves', VIEWS.learningRates)],
    stats: (_ctx, c) =>
      c.races.length === 0
        ? [{ k: 'Learning rates', v: 'none selected' }]
        : c.races.map((r) => {
            const at = Math.min(c.it, r.run.h.length - 1);
            const stopped = r.run.diverged !== null && c.it >= r.run.diverged;
            return { k: r.label, v: stopped ? `stopped at iteration ${r.run.diverged}` : fixed(r.run.h[at].j, 3) };
          }),
    notation: [{ s: tex`\alpha`, m: 'Learning rate', c: 'alpha' }],
    math: [
      {
        tex: tex`w := w - \alpha\,\frac{\partial J}{\partial w}`,
        why: 'α sets the size of every step. A healthy run shows the cost falling steadily.',
      },
    ],
    worked: (_ctx, c) => {
      const r = c.races[0];
      if (!r) return 'Add a learning rate to race it.';
      const at = Math.min(c.it, r.run.h.length - 1);
      return `${r.label} at iteration ${c.it}:\nJ = ${fixed(r.run.h[at].j, 4)}`;
    },
    code: [lab('lr_race')],
    sk: '# scikit-learn has no equivalent of this race.\n# LogisticRegression (lbfgs) picks its own step sizes,\n# so there is no learning rate to set:\nfrom sklearn.linear_model import LogisticRegression\n\nLogisticRegression(penalty=None, solver="lbfgs")',
    skNote: 'No direct equivalent: a learning-rate race is a way of studying plain gradient descent. SGDClassifier(learning_rate="constant", eta0=...) does have a constant step size called eta0, but it is a different algorithm (one update per day), so the same value is not the same step, its curves will differ, and its alpha argument means something else entirely (the strength of an extra term it adds), not this page’s α.',
    tries: [
      {
        label: 'Race four values',
        note: 'The smallest rate has barely moved by the end, and the larger ones reach a lower cost much sooner.',
        set: { lrs: [0.001, 0.01, 0.1, 1], iters: '300' },
        run: true,
      },
      {
        label: 'Too large',
        note: 'The largest rate makes the cost jump up and down instead of falling steadily. For this cost it bounces rather than growing without limit.',
        set: { lrs: [0.1, 3, 30], iters: '100' },
        run: true,
      },
      {
        label: 'A rate beyond any number',
        note: 'A rate of 1e300 makes the weights overflow at once: their squares no longer fit in a 64-bit number, so the run stops there and says so, instead of drawing numbers that mean nothing. A large but ordinary rate only bounces.',
        set: { lrs: [0.1, 1e300], iters: '50' },
        run: true,
      },
    ],
  },
  {
    week: 'Course 1, Week 2. Feature scaling.',
    title: 'Feature scaling',
    text: 'Pollutants and weather have very different ranges. Train with and without scaling.',
    train: 'scale',
    alpha: { min: -4, max: 1, init: -1 },
    defaults: { alphaExp: -1, iters: '300' },
    views: [view('Before and after', VIEWS.scaleHistogram), view('Train with and without', VIEWS.scaleTraining)],
    stats: (ctx) => [
      { k: 'μ of PM2.5, sample', v: `${fixed(ctx.d.muPm, 1)} μg/m³` },
      { k: 'σ of PM2.5, sample', v: `${fixed(ctx.d.sdPm, 1)} μg/m³` },
      { k: 'μ saved in the live model', v: `${fixed(ctx.model.scaling.mu[0], 1)} μg/m³` },
      { k: 'σ saved in the live model', v: `${fixed(ctx.model.scaling.sigma[0], 1)} μg/m³` },
    ],
    notation: [
      { s: tex`\mu_j`, m: 'Mean of feature j over the training days', c: 'mu' },
      { s: tex`\sigma_j`, m: 'Standard deviation of feature j', c: 'sigma' },
    ],
    math: [
      { tex: tex`x_j := \frac{x_j - \mu_j}{\sigma_j}`, why: 'Center at zero and divide by the spread.' },
      {
        tex: tex`x_{\text{today, scaled}} = \frac{x_{\text{today}} - \mu}{\sigma}`,
        why: 'A forecast made later must reuse the μ and σ saved from the training days, never new ones.',
      },
    ],
    worked: (ctx) => {
      const x = ctx.d.pm[0];
      return `(${fixed(x, 1)} − ${fixed(ctx.d.muPm, 1)}) / ${fixed(ctx.d.sdPm, 1)} = ${fixed((x - ctx.d.muPm) / ctx.d.sdPm, 3)}`;
    },
    code: [lab('zscore')],
    sk: 'from sklearn.preprocessing import StandardScaler\n\nscaler = StandardScaler()\nX_train = scaler.fit_transform(X_train)\nX_new = scaler.transform(X_new)',
    skNote: 'StandardScaler is this same z-score, with the population standard deviation. Fit it on training days only, then reuse it.',
    tries: [
      {
        label: 'Compare at α = 0.1',
        note: 'The scaled run settles quickly, while the raw values make every update overshoot, so the cost jumps around well above the scaled one.',
        set: { alphaExp: -1, iters: '300', view: 1 },
        run: true,
      },
      {
        label: 'A larger α',
        note: 'Scaling lets a rate ten times bigger still settle: the scaled run falls steadily to the lowest cost while the raw run stays far above it.',
        set: { alphaExp: 0, iters: '300', view: 1 },
        run: true,
      },
    ],
  },
];
