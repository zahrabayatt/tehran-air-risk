import type { LabCtx } from './context';
import { oneRun } from './context';
import { gradOne, jOne } from './engine';
import type { OneState } from './engine';
import { clamp } from './format';
import type { Cur, LabState, Stage } from './types';

export const PICK_NOTE = 'Pick one to see what to look for.';
export const MAX_ITERS = 5000;

export const INITIAL: LabState = {
  stage: 0,
  view: 0,
  learn: 0,
  w0: 0,
  b0: 0,
  v1: 0,
  v2: 0.2,
  vb: 0,
  alphaExp: -1,
  iters: '300',
  it: 0,
  started: false,
  playing: false,
  thresh: 35.4,
  cutoff: 12,
  far: 0,
  z: 0,
  pv: 0.7,
  yv: 1,
  m: 365,
  nf: 5,
  day: 15,
  lamExp: -2,
  split: 250,
  lrs: [0.001, 0.01, 0.1, 1],
  lrInput: '',
  tryNote: PICK_NOTE,
};

/** The iterations box as a whole number from 1 to 5000. A blank or non-numeric box counts as 1. */
export const itersNum = (raw: string): number => Math.round(clamp(Number(raw) || 1, 1, MAX_ITERS));

export type Action =
  | { type: 'goto'; stage: number; stages: Stage[] }
  | { type: 'view'; view: number }
  | { type: 'learn'; learn: 0 | 1 | 2 }
  /** A control that does not affect the run: the threshold, z, the day and so on. */
  | { type: 'set'; patch: Partial<LabState> }
  /** A control that does: moving it throws the run away. */
  | { type: 'clear'; patch: Partial<LabState> }
  | { type: 'start'; reduced: boolean }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'scrub'; it: number }
  | { type: 'advance'; by: number }
  | { type: 'reset'; stage: Stage }
  | { type: 'preset'; patch: Partial<LabState>; note: string; run: boolean; reduced: boolean };

const CLEARED = { started: false, playing: false, it: 0 } as const;

/** Settings a step starts with: its own defaults on top of the shared ones. */
function stageStart(stage: Stage): Partial<LabState> {
  const base: Partial<LabState> = {};
  if (stage.train) {
    base.iters = INITIAL.iters;
    base.alphaExp = stage.alpha?.init ?? INITIAL.alphaExp;
  }
  return { ...base, ...(stage.defaults ?? {}) };
}

export function reducer(s: LabState, a: Action): LabState {
  switch (a.type) {
    case 'goto':
      return { ...s, ...CLEARED, ...stageStart(a.stages[a.stage]), stage: a.stage, view: 0, tryNote: PICK_NOTE };
    case 'view':
      return { ...s, view: a.view };
    case 'learn':
      return { ...s, learn: a.learn };
    case 'set':
      return { ...s, ...a.patch };
    case 'clear':
      return { ...s, ...a.patch, ...CLEARED };
    case 'start': {
      const max = itersNum(s.iters);
      if (a.reduced) return { ...s, started: true, it: max, playing: false };
      return { ...s, started: true, it: s.it >= max ? 0 : s.it, playing: true };
    }
    case 'pause':
      return { ...s, playing: false };
    case 'step':
      return { ...s, started: true, playing: false, it: Math.min(itersNum(s.iters), s.it + 1) };
    case 'scrub':
      return { ...s, started: true, playing: false, it: clamp(Math.round(a.it), 0, itersNum(s.iters)) };
    case 'advance': {
      if (!s.playing) return s;
      const max = itersNum(s.iters);
      const next = s.it + a.by;
      return next >= max ? { ...s, it: max, playing: false } : { ...s, it: next };
    }
    case 'reset':
      return { ...INITIAL, stage: s.stage, view: s.view, learn: s.learn, ...stageStart(a.stage) };
    case 'preset': {
      const next = { ...s, ...CLEARED, ...a.patch, tryNote: a.note };
      if (!a.run) return next;
      const max = itersNum(next.iters);
      return a.reduced ? { ...next, started: true, it: max } : { ...next, started: true, playing: true };
    }
  }
}

/** The learning rate a step trains with. The learning-rate step races every rate in its list. */
export function alphaOf(stage: Stage, s: LabState): number {
  return stage.train === 'lrs' ? (s.lrs[0] ?? 0.001) : 10 ** s.alphaExp;
}

/** The starting point of a one-feature run, with its real cost and slopes. */
function startState(ctx: LabCtx, w: number, b: number): OneState {
  const [gw, gb] = gradOne(ctx.d.x, ctx.d.y, w, b);
  return { w, b, j: jOne(ctx.d.x, ctx.d.y, w, b), gw, gb };
}

/** Everything the views need for the current settings: the run up to the replay position, and plain numbers. */
export function computeCur(ctx: LabCtx, stage: Stage, s: LabState): Cur {
  const iters = itersNum(s.iters);
  const alpha = alphaOf(stage, s);
  const kind = stage.train;
  const lam = 10 ** s.lamExp;

  const races: Cur['races'] =
    kind === 'lrs'
      ? s.lrs.map((a) => ({ label: `α = ${a}`, alpha: a, run: oneRun(ctx, 'x', 0, 0, a, iters) }))
      : kind === 'scale'
        ? [
            { label: 'Scaled PM2.5', alpha, run: oneRun(ctx, 'z', 0, 0, alpha, iters) },
            { label: 'Raw μg/m³', alpha, run: oneRun(ctx, 'pm', 0, 0, alpha, iters) },
          ]
        : [];
  let run = null as Cur['run'];
  if (s.started) {
    if (kind === 'one') run = oneRun(ctx, 'x', s.w0, s.b0, alpha, iters);
    else if (races.length > 0) run = races[0].run;
  }
  const it = run ? Math.min(s.it, iters) : s.started ? Math.min(s.it, iters) : 0;

  const startAt = kind === 'one' || kind === undefined ? startState(ctx, s.w0, s.b0) : startState(ctx, 0, 0);
  let hist1: OneState[] = run ? run.h.slice(0, it + 1) : [startAt];
  if (hist1.length === 0) hist1 = [startAt];
  const last = hist1[hist1.length - 1];
  return {
    view: s.view,
    hist1,
    w: last.w,
    b: last.b,
    j: last.j,
    run,
    races,
    it,
    iters,
    alpha,
    thresh: s.thresh,
    cutoff: s.cutoff,
    far: s.far,
    z: s.z,
    pv: s.pv,
    yv: s.yv,
    v1: s.v1,
    v2: s.v2,
    vb: s.vb,
    m: s.m,
    nf: s.nf,
    day: s.day,
    lam,
    lamExp: s.lamExp,
    split: s.split,
    lrs: s.lrs,
  };
}
