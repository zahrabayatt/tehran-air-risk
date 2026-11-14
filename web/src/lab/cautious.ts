/**
 * "Too cautious" bands, shared by Lab step 16 and the Data page so both read the same: a band is too
 * cautious when more days turned unhealthy than the top of the range the model said.
 * Consecutive such bands are joined into runs.
 */
export interface Band {
  /** Bottom and top of the range the model said, as shares (0 to 1). */
  lo: number;
  hi: number;
  /** Share of days in the band that turned unhealthy. */
  s: number;
  /** Days in the band. */
  n: number;
  /** Position of the band; consecutive bands differ by 1. Defaults to the array index. */
  k?: number;
}

export const isOver = (d: Pick<Band, 'hi' | 's' | 'n'>) => d.n > 0 && d.s > d.hi;

export interface Run {
  /** In tenths: 2 means "2 in 10". */
  from: number;
  to: number;
}

export function cautiousRuns(bands: Band[]): Run[] {
  const runs: Band[][] = [];
  bands.forEach((d, i) => {
    if (!isOver(d)) return;
    const last = runs[runs.length - 1];
    const prev = last && last[last.length - 1];
    if (prev && (prev.k ?? bands.indexOf(prev)) === (d.k ?? i) - 1) last.push(d);
    else runs.push([d]);
  });
  return runs.map((g) => ({ from: Math.round(g[0].lo * 10), to: Math.round(g[g.length - 1].hi * 10) }));
}

/** "2 to 3 in 10 and from 4 to 9 in 10": put "from" in front of it. */
export const runsText = (runs: Run[]) => runs.map((r) => `${r.from} to ${r.to} in 10`).join(' and from ');
