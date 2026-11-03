import type { Snippet } from 'virtual:lab-snippets';
import type { PlotSpec } from '../components/Plot';
import type { LabCtx } from './context';
import type { OneRun, OneState } from './engine';

/** What the person has set. Every control and the run's position live here. */
export interface LabState {
  stage: number;
  view: number;
  /** Which explanation tab: 0 math, 1 code, 2 scikit-learn. */
  learn: 0 | 1 | 2;
  /** Starting weight and bias of the one-feature model: the sliders of the model, cost and training steps. */
  w0: number;
  b0: number;
  /** The decision-boundary step: two weights and a bias. */
  v1: number;
  v2: number;
  vb: number;
  /** log10 of the learning rate. */
  alphaExp: number;
  /** The iterations box as typed. Clamped to 1 through 5000 whenever it is used. */
  iters: string;
  /** Position of the replay, 0 to iters. */
  it: number;
  /** True once a run exists for these settings. Moving w, b, alpha or the iterations clears it. */
  started: boolean;
  playing: boolean;
  /** PM2.5 threshold of the data and label steps, in μg/m³. */
  thresh: number;
  /** Cutoff hour of the timing view. */
  cutoff: number;
  /** Very polluted days added in the linear-regression step. */
  far: number;
  z: number;
  /** The loss step: predicted probability and label. */
  pv: number;
  yv: 0 | 1;
  /** The vectorization step: number of days and of features. */
  m: number;
  nf: number;
  /** Day of year of the feature-engineering step. */
  day: number;
  /** log10 of the regularization strength. */
  lamExp: number;
  /** Sandbox: number of the sample's first days used for training. */
  split: number;
  lrs: number[];
  lrInput: string;
  tryNote: string;
}

/** The current point of the run, plus every setting the views need, resolved to numbers. */
export interface Cur {
  view: number;
  /** One-feature states of the main run up to the replay position (or the start point before a run). */
  hist1: OneState[];
  w: number;
  b: number;
  /** Cost at the current point. */
  j: number;
  /** The main run, or null before Start. */
  run: OneRun | null;
  /** Every run drawn together: the learning-rate race, or scaled against raw. Empty elsewhere. */
  races: Array<{ label: string; alpha: number; run: OneRun }>;
  it: number;
  iters: number;
  alpha: number;
  thresh: number;
  cutoff: number;
  far: number;
  z: number;
  pv: number;
  yv: 0 | 1;
  v1: number;
  v2: number;
  vb: number;
  m: number;
  nf: number;
  day: number;
  lam: number;
  lamExp: number;
  split: number;
  lrs: number[];
}

export type ViewFn = (ctx: LabCtx, c: Cur) => PlotSpec;
export interface Stat { k: string; v: string }
export type CtlName =
  | 'w' | 'b' | 'w1' | 'w2' | 'b2' | 'thresh' | 'cutoff' | 'far' | 'z' | 'pv' | 'yv' | 'm' | 'nf' | 'day' | 'lam' | 'split';

/** A symbol (TeX), what it means here, and its name in the code. */
export interface Notation { s: string; m: string; c: string }
/** One equation (TeX) and why it looks the way it does. */
export interface MathStep { tex: string; why: string }

export interface Try {
  label: string;
  note: string;
  set: Partial<LabState> | ((ctx: LabCtx) => Partial<LabState>);
  /** Press Start after applying the settings. */
  run?: boolean;
}

/** Exponent limits of the learning-rate slider and where it starts. */
export interface AlphaRange { min: number; max: number; init: number }

/**
 * What a training step runs. 'one': one run from the w and b sliders. 'lrs': one run per learning
 * rate in the list, all from zero. 'scale': the same run on scaled and on raw PM2.5.
 */
export type TrainKind = 'one' | 'lrs' | 'scale';

export interface Stage {
  /** Heading above this step in the list, for the first step of a part. */
  part?: string;
  week: string;
  title: string;
  text: string;
  /** Shows the w and b sliders (the one-feature model). */
  wb?: boolean;
  /** Shows the training bar: Start, Pause, Step, Reset, iterations and the replay slider. */
  train?: TrainKind;
  alpha?: AlphaRange;
  /** Settings applied on arrival. */
  defaults?: Partial<LabState>;
  /** Extra controls; a function when they depend on the plot view. */
  ctl?: CtlName[] | ((view: number) => CtlName[]);
  views: Array<{ label: string; fn: ViewFn }>;
  stats: (ctx: LabCtx, c: Cur) => Stat[];
  notation: Notation[];
  math: MathStep[];
  /** Worked example with the live numbers. */
  worked: (ctx: LabCtx, c: Cur) => string;
  /** Code blocks read from the Python source. */
  code: Snippet[];
  sk: string;
  skNote: string;
  tries: Try[];
}
