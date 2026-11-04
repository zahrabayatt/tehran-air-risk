import { mean, fixed, fmt } from '../format';
import { lab } from '../snippets';
import type { Stage } from '../types';
import { VIEWS } from '../views';
import { linearFit } from '../views/problem';
import { tex, view } from './shared';

/** Steps 1 to 3: the data, the label and its timing, and why a straight line is not enough. */

/** The sample day whose next-day PM2.5 is closest to the label threshold: a day worth working through. */
const nearestDay = (tomorrow: number[], t: number) =>
  tomorrow.reduce((best, v, i) => (Math.abs(v - t) < Math.abs(tomorrow[best] - t) ? i : best), 0);

export const PROBLEM: Stage[] = [
  {
    part: 'The problem',
    week: 'Project data',
    title: 'Data',
    text: 'See how PM2.5 behaves over time in West Tehran’s training days. Move the threshold and compare it with the data.',
    ctl: ['thresh'],
    views: [
      view('Time series', VIEWS.series),
      view('By month', VIEWS.months),
      view('Today vs tomorrow', VIEWS.todayTomorrow),
    ],
    stats: (ctx, c) => {
      const above = ctx.d.tomorrow.filter((v) => v > c.thresh).length;
      return [
        { k: 'Sample days', v: String(ctx.d.n) },
        { k: 'Mean PM2.5 of the target day', v: `${fixed(mean(ctx.d.tomorrow), 1)} μg/m³` },
        { k: 'Threshold', v: `${fmt(c.thresh)} μg/m³` },
        { k: 'Days above it', v: `${above} (${fixed((above / ctx.d.n) * 100, 1)}%)` },
      ];
    },
    notation: [
      { s: tex`x`, m: 'Input features known today. Here, PM2.5 so far today', c: 'X_train' },
      { s: tex`y`, m: 'Outcome tomorrow, 0 or 1: is tomorrow’s mean PM2.5 above the threshold', c: 'y_train' },
      { s: tex`m`, m: 'Number of training days', c: 'm = X.shape[0]' },
      { s: tex`x^{(i)},\; y^{(i)}`, m: 'The i-th training day, counting from 0', c: 'X_train[i], y_train[i]' },
    ],
    math: [
      {
        tex: tex`\text{daily PM2.5} = \frac{1}{n_h} \sum_{h \in \text{hours present}} \text{PM2.5}_h \qquad n_h \ge 20`,
        why: 'CAMS gives modelled hourly values. A Tehran-time calendar day is summarised by the mean of the hours that exist, and it counts only when at least 20 of its 24 hours do (n_h ≥ 20).',
      },
      {
        tex: tex`\left(x^{(i)},\; y^{(i)}\right) \quad \text{for } i = 0, 1, \ldots, m-1`,
        why: 'A training set is a list of examples. Each pairs what is known on one day with what happened the next day.',
      },
    ],
    worked: (ctx) => {
      const r = ctx.d.rows[0];
      return `Sample day 0, issued ${r.day}:\nx⁽⁰⁾ = ${fixed(ctx.d.pm[0], 1)} μg/m³ so far today\nTomorrow (${r.target_date}) averaged ${fixed(r.pm_tomorrow, 1)} μg/m³\nm = ${ctx.d.n}`;
    },
    code: [lab('daily_labels')],
    sk: '# No scikit-learn step is needed here.\n# pandas handles inspection:\ndaily.describe()',
    skNote: 'scikit-learn starts once the data is ready to model.',
    tries: [
      {
        label: 'See the seasons',
        note: 'High in winter and low in summer. In West Tehran more than half of the training days from October to March are above 35.4, and fewer than one in ten from May to August. Any useful model has to deal with this yearly pattern.',
        set: { view: 1 },
      },
      {
        label: 'Today predicts tomorrow',
        note: 'Tomorrow tends to resemble today so far: the dots lean along the dotted line. That is why today’s PM2.5 is a useful input.',
        set: { view: 2 },
      },
    ],
  },
  {
    week: 'Project step',
    title: 'Label and timing',
    text: 'Define the two classes, and what the model may know when it predicts. Try other thresholds and cutoffs.',
    ctl: ['thresh', 'cutoff'],
    views: [
      view('Timing', VIEWS.timeline),
      view('Labels', VIEWS.labels),
      view('Class balance', VIEWS.balance),
    ],
    stats: (ctx, c) => [
      { k: 'Threshold', v: `${fmt(c.thresh)} μg/m³` },
      { k: 'Cutoff', v: `${String(c.cutoff).padStart(2, '0')}:00` },
      { k: 'Live model cutoff', v: ctx.model.cutoff },
      { k: 'Sample positive', v: `${fixed(ctx.share(c.thresh) * 100, 1)}%` },
    ],
    notation: [
      { s: tex`y = 1`, m: 'Tomorrow is above the threshold: the positive class', c: '1' },
      { s: tex`y = 0`, m: 'Tomorrow is at or below it: the negative class', c: '0' },
      { s: tex`t_{\text{cutoff}}`, m: 'The moment the forecast is made: 12:00 Tehran time', c: 'CUTOFF' },
    ],
    math: [
      {
        tex: tex`y = \begin{cases} 1 & \text{if tomorrow's mean PM2.5} > 35.4\ \mu\text{g/m}^3 \\ 0 & \text{otherwise} \end{cases}`,
        why: 'A clear definition is what makes this a binary classification. A day with fewer than 20 hourly values gets no label at all.',
      },
      {
        tex: tex`t_{\text{every input}} \;\le\; t_{\text{cutoff}} \;<\; t_{\text{label}}`,
        why: 'Using anything from after the cutoff would be data leakage: great results on history and no use in real life. CAMS’s own forecast of tomorrow is never an input either, or the model would only copy it.',
      },
    ],
    worked: (ctx, c) => {
      const i = nearestDay(ctx.d.tomorrow, c.thresh);
      const v = ctx.d.tomorrow[i];
      return `Sample day closest to your threshold, target ${ctx.d.rows[i].target_date}:\nmean PM2.5 = ${fixed(v, 1)} μg/m³\n${fixed(v, 1)} ${v > c.thresh ? '>' : '≤'} ${fmt(c.thresh)}, so y = ${v > c.thresh ? 1 : 0}`;
    },
    code: [lab('build_row')],
    sk: '# No direct equivalent. Labels come from the problem:\ny = (tomorrow_pm25 > 35.4).astype(int)',
    skNote: 'scikit-learn cannot check time alignment for you, so this project checks it with automated tests (tests/test_leakage.py) that fail if any input is later than the cutoff.',
    tries: [
      {
        label: 'A stricter threshold',
        note: 'Fewer days count as positive, so the classes become uneven.',
        set: { thresh: 55.4, view: 2 },
      },
      {
        label: 'Late cutoff',
        note: 'More hours of information go in, but a late cutoff leaves less time between the forecast and the day it is about.',
        set: { cutoff: 22, view: 0 },
      },
    ],
  },
  {
    week: 'Course 1, Week 3. Classification.',
    title: 'Why not linear regression?',
    text: 'Linear regression can predict numbers, but a yes-or-no target exposes its weakness. Add very polluted days and see what happens.',
    ctl: ['far'],
    views: [view('Linear regression', VIEWS.whyNotLinear)],
    stats: (ctx, c) => {
      const base = linearFit(ctx, 0);
      const now = linearFit(ctx, c.far);
      const flips = ctx.d.x.filter((x) => (base.w * x + base.b >= 0.5) !== (now.w * x + now.b >= 0.5)).length;
      return [
        { k: 'Very polluted days added', v: String(c.far) },
        { k: 'w', v: fixed(now.w, 3) },
        { k: 'Crosses 0.5 at', v: `${fixed(now.cross * 10, 1)} μg/m³` },
        { k: 'Sample days whose answer flips', v: String(flips) },
      ];
    },
    notation: [
      { s: tex`f_{w,b}(x)`, m: 'The line’s output for PM2.5 x', c: 'f_wb' },
      { s: tex`0.5`, m: 'Predict y = 1 when the output is at least 0.5', c: 'f >= 0.5' },
      { s: tex`x_{0.5}`, m: 'Where the line reaches 0.5', c: 'crossing' },
    ],
    math: [
      {
        tex: tex`f_{w,b}(x) = w\,x + b \qquad \text{predict } y = 1 \text{ if } f_{w,b}(x) \ge 0.5`,
        why: 'This can look fine at first, but f(x) can fall below 0 or rise above 1, so it is not a probability.',
      },
      {
        tex: tex`x_{0.5} = \frac{0.5 - b}{w}`,
        why: 'Solve w·x + b = 0.5. Very polluted days are clearly y = 1, yet they still tilt the line and move this crossing, which changes the answer for ordinary days. A classifier should not behave that way.',
      },
    ],
    worked: (ctx, c) => {
      const base = linearFit(ctx, 0);
      const m = linearFit(ctx, c.far);
      return `f(x) = ${fixed(m.w, 3)} x + (${fixed(m.b, 3)})\nf(x) = 0.5 at x = ${fixed(m.cross, 2)}  (${fixed(m.cross * 10, 1)} μg/m³)\nWith no added days it was ${fixed(base.cross, 2)}  (${fixed(base.cross * 10, 1)} μg/m³)`;
    },
    code: [lab('fit_linear')],
    sk: 'from sklearn.linear_model import LinearRegression\n\nm = LinearRegression().fit(X, y)\ny_pred = m.predict(X) >= 0.5',
    skNote: 'scikit-learn will fit this without complaint. It is a modelling mistake, not an error message.',
    tries: [
      {
        label: 'Add five very polluted days',
        note: 'The line tilts and the crossing moves right, so some ordinary days that were on the y = 1 side now fall on the y = 0 side.',
        set: { far: 5, view: 0 },
      },
      {
        label: 'Back to the original days',
        note: 'The crossing returns. A good classifier should not depend on those far points.',
        set: { far: 0, view: 0 },
      },
    ],
  },
];

