import { sandbox } from '../context';
import { applyFrozen } from '../engine';
import { count, fixed } from '../format';
import { lab } from '../snippets';
import type { Stage } from '../types';
import { VIEWS } from '../views';
import { DAILY_RUN_TEHRAN, DAILY_RUN_UTC } from '../../config';
import { baselineCosts, lambdaRows, verdict } from '../views/result';
import { FEATURE_LABELS } from '../views/result';
import { runTime, tex, view } from './shared';

/** Steps 16 and 17: the frozen model against simple guesses, and the daily job that applies it. */

export const RESULT: Stage[] = [
  {
    part: 'The result',
    week: 'Project step, using everything above',
    title: 'Held-out result',
    text: 'Is the live model better than simple guesses on days it never trained on? The first three views show the frozen model’s own numbers. If it were not better, this page would say so. The last view is a sandbox on the small sample, labelled as one.',
    ctl: (v) => (v === 3 ? ['split'] : []),
    views: [
      view('Cost vs simple guesses', VIEWS.costVsGuesses),
      view('Probabilities by outcome', VIEWS.probabilitiesByOutcome),
      view('Cost by λ', VIEWS.costByLambda),
      view('Sandbox: move the split', VIEWS.sandboxSplit),
    ],
    stats: (ctx, c) => {
      const m = ctx.model;
      const [overall, monthly, model] = baselineCosts(ctx);
      if (c.view === 3) {
        const r = sandbox(ctx, c.split);
        return [
          { k: 'Sandbox training days', v: String(r.train) },
          { k: 'Sandbox later days', v: String(r.held) },
          { k: 'Overall-rate guess', v: fixed(r.overall, 3) },
          { k: 'Monthly-rate guess', v: fixed(r.monthly, 3) },
          { k: 'Sandbox model', v: fixed(r.model, 3) },
        ];
      }
      if (c.view === 2) {
        const chosen = lambdaRows(ctx).find((r) => r.chosen);
        return [
          { k: 'Live model λ', v: String(m.hyperparameters.lambda) },
          { k: 'Training cost', v: chosen ? fixed(chosen.train_cost as number, 3) : 'unknown' },
          { k: 'Selection cost', v: chosen ? fixed(chosen.selection_cost as number, 3) : 'unknown' },
        ];
      }
      if (c.view === 1) {
        const yes = m.held_out_probabilities.counts_y1.reduce((a, b) => a + b, 0);
        const no = m.held_out_probabilities.counts_y0.reduce((a, b) => a + b, 0);
        return [
          { k: 'Held-out days', v: count(m.rows.held_out) },
          { k: 'Days that ended above', v: count(yes) },
          { k: 'Days that ended at or below', v: count(no) },
        ];
      }
      return [
        { k: 'Training days', v: count(m.rows.train) },
        { k: 'Held-out days', v: count(m.rows.held_out) },
        { k: 'Overall-rate guess', v: fixed(overall, 3) },
        { k: 'Monthly-rate guess', v: fixed(monthly, 3) },
        { k: 'Live model', v: fixed(model, 3) },
        { k: 'Beats both?', v: m.beats_baselines && model < overall && model < monthly ? 'Yes' : 'No' },
      ];
    },
    notation: [
      { s: tex`p_{\text{overall}}`, m: 'Share of positive training days: the first simple guess', c: 'overall' },
      { s: tex`p_{\text{month}}`, m: 'Share of positive training days in that calendar month: the second guess', c: 'monthly' },
      { s: tex`J_{\text{held-out}}`, m: 'Cost on the final year, which no choice used', c: 'held_out' },
    ],
    math: [
      {
        tex: tex`J_{\text{guess}} = -\frac{1}{m} \sum_{i} \left[ y^{(i)} \log p + \left(1 - y^{(i)}\right) \log(1 - p) \right]`,
        why: 'The same cost, but with a fixed guess p instead of the model. It gives the model a fair number to beat, on the same days.',
      },
      {
        tex: tex`\text{the model wins} \iff J_{\text{held-out}} < J_{\text{guess}} \text{ for both guesses}`,
        why: 'Lower cost is better. The held-out year is looked at once, after every choice is made, and nothing is tuned to change the answer.',
      },
    ],
    worked: (ctx) => {
      const [overall, monthly, model] = baselineCosts(ctx);
      return `Overall rate: ${fixed(overall, 3)}\nMonthly rate: ${fixed(monthly, 3)}\nLive model:   ${fixed(model, 3)}\n\n${verdict(ctx)}`;
    },
    code: [lab('split_by_time'), lab('baselines')],
    sk: 'from sklearn.dummy import DummyClassifier\nfrom sklearn.metrics import log_loss\n\nbase = DummyClassifier(strategy="prior").fit(X_train, y_train)\nlog_loss(y_later, base.predict_proba(X_later)[:, 1])',
    skNote: 'DummyClassifier gives the overall-rate guess; the monthly guess has no ready-made equivalent. Days stay in time order here instead of a random train_test_split, because the aim is to forecast the future.',
    tries: [
      {
        label: 'Train on less',
        note: 'Sandbox only: with fewer of the sample’s days to train on, the later days include seasons the model never saw, and the costs change a lot.',
        set: { split: 150, view: 3 },
      },
      {
        label: 'Train on more',
        note: 'Sandbox only: with more days to train on, fewer later days remain to check, so the comparison rests on less.',
        set: { split: 300, view: 3 },
      },
    ],
  },
  {
    week: 'Project step',
    title: 'Daily forecast',
    text: 'One scheduled job applies the frozen model to the day’s inputs and publishes the forecast. It never retrains, and CAMS’s own forecast of tomorrow is never an input.',
    views: [view('Pipeline', VIEWS.pipeline), view('Frozen model', VIEWS.frozenWeights)],
    stats: (ctx) => [
      { k: 'Scheduled', v: `${DAILY_RUN_UTC} UTC (${DAILY_RUN_TEHRAN} Tehran)` },
      { k: 'Inputs up to', v: ctx.model.cutoff },
      { k: 'Last run', v: runTime(ctx.predictions.lastIssuedAt) },
      { k: 'Forecasts logged', v: count(ctx.predictions.logged) },
      { k: 'Days forecast', v: count(ctx.predictions.days) },
      { k: 'Model version', v: String(ctx.model.version) },
    ],
    notation: [
      { s: tex`\vec{w}_{\text{frozen}},\; b_{\text{frozen}}`, m: 'Saved weights and bias. They are never retrained by the daily job', c: 'model["weights"], model["bias"]' },
      { s: tex`\mu_j,\; \sigma_j`, m: 'The saved training means and standard deviations', c: 'model["scaling"]' },
    ],
    math: [
      {
        tex: tex`z_j = \frac{x_j - \mu_j}{\sigma_j}`,
        why: 'Each day’s inputs are scaled with the same saved μ and σ, never with numbers from that day.',
      },
      {
        tex: tex`f_{\text{today}} = g\!\left( \vec{w}_{\text{frozen}} \cdot \vec{z} + b_{\text{frozen}} \right)`,
        why: `Each day uses the same parameters, so the results stay comparable from day to day. Inputs stop at 12:00 Tehran time; the job runs at ${DAILY_RUN_TEHRAN} Tehran time.`,
      },
    ],
    worked: (ctx) => {
      const r = ctx.d.rows[ctx.d.n - 1];
      const raw = ctx.model.features.map((f) => Number(r[f]));
      const out = applyFrozen(ctx.model, raw);
      const lines = ctx.model.features.map(
        (f, j) => `${(FEATURE_LABELS[j] ?? f).padEnd(11)} ${fixed(raw[j], 2).padStart(8)} → z ${fixed(out.z[j], 3).padStart(7)} × w ${fixed(ctx.model.weights[j], 3)}`,
      );
      return `Frozen model v${ctx.model.version}, applied to sample day ${r.day}:\n${lines.join('\n')}\nscore = ${fixed(out.score, 3)}   (bias ${fixed(ctx.model.bias, 3)} included)\nf = g(${fixed(out.score, 3)}) = ${fixed(out.p, 4)}`;
    },
    code: [lab('model_probability'), lab('predict_proba')],
    sk: 'import joblib\n\nmodel = joblib.load("model.joblib")\nmodel.predict_proba(X_today)[:, 1]',
    skNote: 'A scikit-learn model could be saved this way. This project stores plain JSON so anyone can read the numbers.',
    tries: [
      {
        label: 'See the frozen weights',
        note: 'These saved weights, with the saved μ and σ, are all the daily job uses to turn the day’s inputs into a probability.',
        set: { view: 1 },
      },
      {
        label: 'See the pipeline',
        note: 'Fetch, features, prediction, outcomes for earlier days, commit and deploy. The Forecast page shows each prediction beside what happened.',
        set: { view: 0 },
      },
    ],
  },
];
