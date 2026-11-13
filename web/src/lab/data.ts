/**
 * The Model Lab's data, fetched once and shared by every step.
 *
 * The files are written by training/export_site.py into web/public/data (model.json is copied there by
 * scripts/sync-data.mjs, which never clears the folder):
 * lab-days.json (each square's morning PM2.5 on every training day), lab-timing.json (three
 * worked days, hour by hour), lab-rows.json (the training and selection rows the model reads),
 * lab-today.json (one worked forecast for the current model) and model.json (the frozen model).
 * A step asks for a file by name with ctx.load(name) and reads it as the file is written.
 */

const BASE = import.meta.env.BASE_URL;

export type LabDataName = 'lab-days' | 'lab-timing' | 'lab-rows' | 'lab-today' | 'model';

const FILES: Record<LabDataName, string> = {
  'lab-days': 'lab-days.json',
  'lab-timing': 'lab-timing.json',
  'lab-rows': 'lab-rows.json',
  'lab-today': 'lab-today.json',
  model: 'model.json',
};

const cache = new Map<string, Promise<unknown>>();

/** The parsed file, fetched on the first ask. A failed load is forgotten, so asking again tries again. */
export function loadStepData(name: LabDataName): Promise<unknown> {
  const file = FILES[name];
  if (!file) return Promise.reject(new Error(`The Lab has no data called ${name}.`));
  let p = cache.get(file);
  if (!p) {
    p = fetch(`${BASE}data/${file}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${file} (${r.status}).`);
      return r.json() as Promise<unknown>;
    });
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

/**
 * Timers, animation frames and window listeners a step starts, so leaving the step stops them all.
 * A step uses these in place of the browser's own functions.
 */
export function createScope() {
  const timers = new Set<number>();
  const frames = new Set<number>();
  const offs: Array<() => void> = [];
  let live = true;
  return {
    setTimeout(fn: () => void, ms?: number): number {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (live) fn();
      }, ms);
      timers.add(id);
      return id;
    },
    requestAnimationFrame(fn: FrameRequestCallback): number {
      const id = window.requestAnimationFrame((t) => {
        frames.delete(id);
        if (live) fn(t);
      });
      frames.add(id);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      frames.delete(id);
      window.cancelAnimationFrame(id);
    },
    win: {
      addEventListener(type: string, fn: EventListener, opts?: AddEventListenerOptions | boolean): void {
        window.addEventListener(type, fn, opts);
        offs.push(() => window.removeEventListener(type, fn, opts));
      },
    },
    dispose(): void {
      live = false;
      timers.forEach((id) => window.clearTimeout(id));
      frames.forEach((id) => window.cancelAnimationFrame(id));
      offs.forEach((off) => off());
    },
  };
}
