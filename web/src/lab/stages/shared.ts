import { gradOne, jOne, sigmoid } from '../engine';
import { fixed, n3 } from '../format';
import type { LabCtx } from '../context';
import type { Cur, Stat, ViewFn } from '../types';

/** Write TeX without doubling every backslash. */
export const tex = String.raw;

export const view = (label: string, fn: ViewFn) => ({ label, fn });

/** Day 1 of the sample, the example row of the model steps. */
export const firstDay = (ctx: LabCtx) => ({ x: ctx.d.x[0], pm: ctx.d.pm[0], y: ctx.d.y[0] });

export const costAt = (ctx: LabCtx, c: Cur) => jOne(ctx.d.x, ctx.d.y, c.w, c.b);
export const slopesAt = (ctx: LabCtx, c: Cur) => gradOne(ctx.d.x, ctx.d.y, c.w, c.b);

export const modelStats = (ctx: LabCtx, c: Cur): Stat[] => {
  const { x } = firstDay(ctx);
  const z = c.w * x + c.b;
  return [
    { k: 'w', v: fixed(c.w, 2) },
    { k: 'b', v: fixed(c.b, 2) },
    { k: 'First day, z', v: fixed(z, 3) },
    { k: 'First day, f', v: fixed(sigmoid(z), 3) },
  ];
};

export const costStats = (ctx: LabCtx, c: Cur): Stat[] => [
  { k: 'w', v: fixed(c.w, 2) },
  { k: 'b', v: fixed(c.b, 2) },
  { k: 'Cost J', v: n3(costAt(ctx, c)) },
];

export const trainStats = (ctx: LabCtx, c: Cur): Stat[] => {
  const g = slopesAt(ctx, c);
  return [
    { k: 'Cost J', v: n3(costAt(ctx, c)) },
    { k: 'w', v: fixed(c.w, 3) },
    { k: 'b', v: fixed(c.b, 3) },
    { k: '∂J/∂w', v: n3(g[0]) },
    { k: '∂J/∂b', v: n3(g[1]) },
  ];
};

/** A time as "2026-11-03 13:30 UTC" and the same moment in Tehran (UTC+03:30, no daylight saving). */
export function runTime(iso: string | null): string {
  if (!iso) return 'none yet';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const at = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  return `${at(t)} UTC (${at(t + 3.5 * 3600_000).slice(11)} Tehran)`;
}
