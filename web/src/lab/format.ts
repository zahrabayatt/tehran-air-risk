/** Small number and list helpers shared by the Lab's views, stages and controls. */

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export const range = <T,>(n: number, f: (i: number) => T): T[] => {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(f(i));
  return out;
};

export const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

export const median = (a: number[]) => {
  const b = a.slice().sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)] || 0;
};

/** The p-th percentile (0 to 100) by linear interpolation. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((x, y) => x - y);
  const pos = (clamp(p, 0, 100) / 100) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Axis tick label. */
export const fmt = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1000) return String(Math.round(v));
  if (a >= 10 || a === 0) return v.toFixed(a >= 100 ? 0 : 1).replace(/\.0$/, '');
  if (a >= 1) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2);
};

/** A number for a stats row: three decimals, exponent form when huge, "overflow" when not a number. */
export const n3 = (v: number): string => {
  if (!Number.isFinite(v)) return 'overflow';
  if (Math.abs(v) >= 1e6) return v.toExponential(2);
  const s = v.toFixed(3);
  return /^-0\.0+$/.test(s) ? s.slice(1) : s;
};

/** Learning rates and penalties: three digits, exponent form when small. */
export const sciText = (v: number): string => {
  if (v >= 0.01) return v.toFixed(v >= 1 ? 2 : 3);
  return v.toExponential(2);
};

/** Fixed decimals that never print "-0.00". */
export const fixed = (v: number, digits: number): string => {
  const s = v.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
};

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};
/** 10 to the power n, written with superscript digits: 10⁻⁴. */
export const pow10Label = (n: number): string => `10${String(n).split('').map((c) => SUP[c] ?? c).join('')}`;

/** A top for an axis that starts at 0: at least v, a round number, divisible into `parts` round steps. */
export function niceTop(v: number, parts = 4): number {
  if (!(v > 0) || !Number.isFinite(v)) return parts;
  const raw = (v * 1.02) / parts;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / e;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].find((s) => s >= m - 1e-9) ?? 10;
  return step * e * parts;
}

export const count = (n: number) => n.toLocaleString('en-US');

/**
 * Axis limits [lo, hi] that contain [lo0, hi0] and split into four round steps, so the five tick
 * labels are round numbers.
 */
export function niceSpan(lo0: number, hi0: number): [number, number] {
  const span = Math.max(hi0 - lo0, 1e-9);
  const raw = (span * 1.05) / 4;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const k of [1, 2, 2.5, 5, 10]) {
    const step = k * e;
    const lo = Math.floor(lo0 / step) * step;
    if (lo + 4 * step >= hi0) return [lo, lo + 4 * step];
  }
  return [lo0, hi0];
}
