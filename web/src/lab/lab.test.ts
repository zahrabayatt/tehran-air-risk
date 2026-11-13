import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScope, loadStepData } from './data';
import { EXPLANATIONS } from './explanations';
import { allBlocks } from './snippets';
import { STEPS } from './steps';

const TITLES = [
  'Data',
  'The question and its timing',
  'Why not a straight line?',
  'Sigmoid',
  'Logistic model',
  'Decision boundary',
  'Why not squared error?',
  'Logistic loss and cost',
  'Gradient descent',
  'Vectorization',
  'Learning rate',
  'Feature scaling',
  'Feature engineering',
  'Overfitting',
  'Regularization',
  'Held-out result',
  "Today's forecast",
];
const SECTIONS = [
  ['The problem', 3],
  ['The model', 3],
  ['The cost', 2],
  ['Training', 4],
  ['Better inputs', 1],
  ['Fitting well', 2],
  ['The result', 2],
] as const;

describe('the Lab steps', () => {
  it('has 17 steps in the draft order and sections', () => {
    expect(STEPS.map((s) => s.n)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect(STEPS.map((s) => s.title)).toEqual(TITLES);
    expect(STEPS.map((s) => s.section)).toEqual(SECTIONS.flatMap(([name, k]) => Array<string>(k).fill(name)));
  });

  it('every step names lab code that exists', () => {
    for (const s of STEPS) {
      let blocks: ReturnType<typeof s.code> = [];
      expect(() => (blocks = s.code()), `step ${s.n}`).not.toThrow();
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(b.file).toMatch(/^(training|pipeline)\/[a-z_]+\.py$/);
    }
  });

  it('has no explanation left on a line that is not in the code', () => {
    const byName = Object.fromEntries(allBlocks().map((b) => [b.name, b]));
    for (const [name, lines] of Object.entries(EXPLANATIONS)) {
      if (!byName[name]) continue; // explanations of blocks no step shows are kept for reuse
      for (const line of Object.keys(lines)) expect(byName[name].lines, `${name}: ${line}`).toContain(line);
    }
  });

  it('every step module has markup, the math and scikit-learn tabs as strings, and a mount function', async () => {
    for (const s of STEPS) {
      const mod = await s.load();
      expect(mod.html).toContain('id="main"');
      expect(mod.html).toContain(s.title);
      expect(typeof mod.mathHtml).toBe('string');
      expect(typeof mod.skHtml).toBe('string');
      expect(typeof mod.mount).toBe('function');
      expect(mod.html).not.toContain('\u2014');
    }
  });

  it('a step that is left stops: mount returns a function', async () => {
    const mod = await STEPS[0].load();
    const stop = mod.mount({ load: () => new Promise(() => {}), scope: createScope });
    expect(typeof stop).toBe('function');
    stop();
  });
});

describe('the Lab data', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches each file once, from the data folder, and caches it', async () => {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => ({ url }) }));
    vi.stubGlobal('fetch', fetchMock);
    const names = ['lab-days', 'lab-timing', 'lab-rows', 'lab-today', 'model'] as const;
    for (const name of names) {
      const first = (await loadStepData(name)) as { url: string };
      expect(first.url).toMatch(new RegExp(`data/${name}\.json$`));
      expect(await loadStepData(name)).toBe(first);
    }
    expect(fetchMock).toHaveBeenCalledTimes(names.length);
  });

  it('rejects an unknown name', async () => {
    await expect(loadStepData('nope' as never)).rejects.toThrow(/no data called nope/);
  });

  it('says which file did not load, and tries again the next time', async () => {
    vi.resetModules();
    const fresh = await import('./data');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fresh.loadStepData('lab-days')).rejects.toThrow('Could not load lab-days.json (404).');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) })));
    await expect(fresh.loadStepData('lab-days')).resolves.toEqual({ ok: 1 });
  });

  it('reads the committed files in the shape the drafts use', () => {
    const read = (f: string) => JSON.parse(readFileSync(resolve(__dirname, `../../public/data/${f}.json`), 'utf8'));
    const rows = read('lab-rows');
    expect(rows.train.cols.length).toBeGreaterThan(0);
    expect(rows.train.rows.length).toBeGreaterThan(rows.sel.rows.length);
    expect(read('model').features.length).toBeGreaterThan(0);
  });

  it('stops a step’s timers when it is left', async () => {
    const s = createScope();
    let ran = false;
    s.setTimeout(() => {
      ran = true;
    }, 0);
    s.dispose();
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(false);
  });

  it('removes a step’s window listeners when it is left', () => {
    const s = createScope();
    const fn = vi.fn();
    s.win.addEventListener('pointermove', fn);
    window.dispatchEvent(new Event('pointermove'));
    s.dispose();
    window.dispatchEvent(new Event('pointermove'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Lab colours', () => {
  it('every colour a step uses is defined somewhere', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
    const steps = STEPS.map((s) => read(`steps/step${s.n}.js`)).join('\n') + read('bowl.js') + read('kit.js');
    const css = read('lab-steps.css') + read('../pages/lab.css') + read('../theme/tokens.css');
    const used = new Set([...(steps + css).matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    const defined = new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g), ...steps.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it('no colour token is defined as var() of itself, which would make it invalid', () => {
    const css = readFileSync(resolve(__dirname, 'lab-steps.css'), 'utf8') + readFileSync(resolve(__dirname, '../pages/lab.css'), 'utf8');
    const selfRef = [...css.matchAll(/--([a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\)/g)].filter((m) => m[1] === m[2]).map((m) => m[1]);
    expect(selfRef).toEqual([]);
  });
});
