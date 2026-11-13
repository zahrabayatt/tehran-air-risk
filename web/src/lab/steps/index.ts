import { lab } from '../snippets';
import type { Snippet } from '../snippets';

/** What a step module exports (see step1.js and the others). */
export interface StepModule {
  /** The step's interactive card(s), from its approved design draft. */
  html: string;
  /** The math tab: KaTeX targets (m1, m2, ...) and one plain sentence each. */
  mathHtml: string;
  /** The scikit-learn tab, only where a real equivalent exists. Empty otherwise. */
  skHtml: string;
  mount(ctx: StepContext): () => void;
}

export interface StepContext {
  /** The data file a step reads, by name (lab/data.ts), fetched once and shared. */
  load(name: string): Promise<unknown>;
  /** Timers, animation frames and window listeners that stop when the step is left. */
  scope(): {
    setTimeout(fn: () => void, ms?: number): number;
    requestAnimationFrame(fn: FrameRequestCallback): number;
    cancelAnimationFrame(id: number): void;
    win: { addEventListener(type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): void };
    dispose(): void;
  };
}

export type StepSection =
  | 'The problem'
  | 'The model'
  | 'The cost'
  | 'Training'
  | 'Better inputs'
  | 'Fitting well'
  | 'The result';

export interface StepInfo {
  n: number;
  title: string;
  section: StepSection;
  /** The real project code this step explains, line by line. */
  code: () => Snippet[];
  load: () => Promise<StepModule>;
}

export const STEPS: StepInfo[] = [
  { n: 1, title: 'Data', section: 'The problem', code: () => [lab('daily_labels')], load: () => import('./step1.js') },
  { n: 2, title: 'The question and its timing', section: 'The problem', code: () => [lab('build_row'), lab('weather_inputs')], load: () => import('./step2.js') },
  { n: 3, title: 'Why not a straight line?', section: 'The problem', code: () => [lab('fit_linear')], load: () => import('./step3.js') },
  { n: 4, title: 'Sigmoid', section: 'The model', code: () => [lab('sigmoid')], load: () => import('./step4.js') },
  { n: 5, title: 'Logistic model', section: 'The model', code: () => [lab('predict_proba')], load: () => import('./step5.js') },
  { n: 6, title: 'Decision boundary', section: 'The model', code: () => [lab('boundary_x2')], load: () => import('./step6.js') },
  { n: 7, title: 'Why not squared error?', section: 'The cost', code: () => [lab('squared_error_cost')], load: () => import('./step7.js') },
  { n: 8, title: 'Logistic loss and cost', section: 'The cost', code: () => [lab('logistic_loss'), lab('compute_cost')], load: () => import('./step8.js') },
  { n: 9, title: 'Gradient descent', section: 'Training', code: () => [lab('gradient_descent')], load: () => import('./step9.js') },
  { n: 10, title: 'Vectorization', section: 'Training', code: () => [lab('predict_proba_loop'), lab('predict_proba'), lab('time_dot')], load: () => import('./step10.js') },
  { n: 11, title: 'Learning rate', section: 'Training', code: () => [lab('lr_race')], load: () => import('./step11.js') },
  { n: 12, title: 'Feature scaling', section: 'Training', code: () => [lab('zscore')], load: () => import('./step12.js') },
  { n: 13, title: 'Feature engineering', section: 'Better inputs', code: () => [lab('season_features'), lab('weather_inputs')], load: () => import('./step13.js') },
  { n: 14, title: 'Overfitting', section: 'Fitting well', code: () => [lab('poly_features'), lab('fit_polynomial')], load: () => import('./step14.js') },
  { n: 15, title: 'Regularization', section: 'Fitting well', code: () => [lab('compute_cost_reg'), lab('compute_gradient_reg')], load: () => import('./step15.js') },
  { n: 16, title: 'Held-out result', section: 'The result', code: () => [lab('split_by_time'), lab('probability_bins')], load: () => import('./step16.js') },
  { n: 17, title: "Today's forecast", section: 'The result', code: () => [lab('model_probability')], load: () => import('./step17.js') },
];
