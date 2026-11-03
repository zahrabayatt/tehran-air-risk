import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { codeRows } from '../components/CodeWalkthrough';
import { EXPLANATIONS } from './explanations';
import { allBlocks } from './snippets';
import { STAGES } from './stages';
import { ctx } from './testData';
import { INITIAL, computeCur, reducer } from './state';
import type { LabState } from './types';

const TITLES = [
  'Data', 'Label and timing', 'Why not linear regression?', 'Sigmoid', 'Logistic model', 'Decision boundary',
  'Why not squared error?', 'Logistic loss', 'Cost function', 'Gradient descent', 'Vectorization', 'Learning rate',
  'Feature scaling', 'Feature engineering', 'Overfitting and regularization', 'Held-out result', 'Daily forecast',
];
const WEEKS = [
  'Project data',
  'Project step',
  'Course 1, Week 3. Classification.',
  'Course 1, Week 3. Sigmoid function.',
  'Course 1, Week 3. Logistic regression.',
  'Course 1, Week 3. Decision boundary.',
  'Course 1, Week 3. Logistic loss.',
  'Course 1, Week 3. Logistic loss.',
  'Course 1, Week 3. Cost function.',
  'Course 1, Week 3. Gradient descent for logistic regression.',
  'Course 1, Week 2. Vectorization and multiple features.',
  'Course 1, Week 2. Learning rate.',
  'Course 1, Week 2. Feature scaling.',
  'Course 1, Week 2. Feature engineering.',
  'Course 1, Week 3. Overfitting and regularization.',
  'Project step, using everything above',
  'Project step',
];
const PARTS: Array<[number, string]> = [
  [1, 'The problem'], [4, 'The model'], [7, 'The cost'], [10, 'Training'], [14, 'Generalizing'], [16, 'The result'],
];

const EXCLUDED = /\b(MSE|RMSE|accuracy|precision|recall|F1|ROC|AUC|confusion matrix|threshold analysis|mean squared|root mean|L1 loss|L2 loss)\b/i;
/** A word a step may use only from the step that introduces it (1-based). */
const INTRODUCED: Array<[RegExp, number]> = [
  [/\b(cost|loss)\b/i, 7],
  [/gradient|slope|derivative|∂/i, 10],
  [/learning rate|iteration|descent|diverg|α|\balpha\b/i, 10],
  [/vectoriz|dot product|\bnumpy\b|matrix/i, 11],
  [/z-score|standard deviation|scaling|\bscale/i, 13],
  [/polynomial|degree/i, 15],
  [/overfit|underfit/i, 15],
  [/regulariz|λ|lambda|penalt/i, 15],
  [/held-out|held out|\bsplit|validation|test (set|data|day)|generaliz|selection/i, 16],
  [/baseline|simple guess/i, 16],
];

/** Everything a step says on its own, whatever the settings: copy, math text, notes and code. */
function words(i: number): string {
  const st = STAGES[i];
  const code = st.code.flatMap((b) => b.lines.concat(Object.values(EXPLANATIONS[b.name] ?? {})));
  return [
    // `penalty=None` in a scikit-learn call only switches scikit-learn's extra term off; its note says so without naming it.
    st.week, st.title, st.text, st.sk.replace(/penalty=None/g, ''), st.skNote,
    ...st.views.map((v) => v.label),
    ...st.notation.flatMap((n) => [n.s, n.m, n.c]),
    ...st.math.flatMap((m) => [m.tex, m.why]),
    ...st.tries.flatMap((t) => [t.label, t.note]),
    ...code,
  ].join('\n');
}

describe('the 17 steps', () => {
  it('are in design order, with the design’s week labels', () => {
    expect(STAGES.map((s) => s.title)).toEqual(TITLES);
    expect(STAGES.map((s) => s.week)).toEqual(WEEKS);
  });

  it('sit under six parts', () => {
    expect(STAGES.map((s, i) => (s.part ? i + 1 : 0)).filter(Boolean)).toEqual(PARTS.map((p) => p[0]));
    expect(STAGES.filter((s) => s.part).map((s) => s.part)).toEqual(PARTS.map((p) => p[1]));
  });

  it('show the training bar only at Gradient descent and the training steps after it', () => {
    expect(STAGES.map((s, i) => (s.train ? i + 1 : 0)).filter(Boolean)).toEqual([10, 12, 13]);
    expect(STAGES.map((s) => s.train)).toEqual(
      [...Array(9).fill(undefined), 'one', undefined, 'lrs', 'scale', ...Array(4).fill(undefined)],
    );
    // Steps 1 to 9 have direct sliders only: no learning rate, no iterations, no run.
    for (const s of STAGES.slice(0, 9)) {
      expect(s.alpha, s.title).toBeUndefined();
      expect(s.defaults?.iters, s.title).toBeUndefined();
      expect(s.defaults?.alphaExp, s.title).toBeUndefined();
    }
  });

  it('have views, stats, math, code and presets', () => {
    for (const s of STAGES) {
      expect(s.views.length, s.title).toBeGreaterThan(0);
      expect(s.math.length, s.title).toBeGreaterThan(0);
      expect(s.code.length, s.title).toBeGreaterThan(0);
      expect(s.tries.length, s.title).toBeGreaterThan(0);
      const cur = computeCur(ctx, s, { ...INITIAL, stage: STAGES.indexOf(s) });
      expect(s.stats(ctx, cur).length, s.title).toBeGreaterThan(0);
      expect(s.worked(ctx, cur).length, s.title).toBeGreaterThan(10);
    }
  });

  it('offer no control for the decision threshold, which stays at 0.5', () => {
    const all = JSON.stringify(STAGES.map((s) => [s.ctl, s.wb]));
    expect(all).not.toMatch(/decision/i);
  });
});

describe('teaching order', () => {
  it('no step uses a word before the step that introduces it', () => {
    STAGES.forEach((_, i) => {
      for (const [word, first] of INTRODUCED) {
        if (i + 1 < first) {
          const hit = words(i).match(word);
          expect(hit, `step ${i + 1} (${TITLES[i]}) uses "${hit?.[0]}", introduced at step ${first}`).toBeNull();
        }
      }
    });
  });

  it('the live text of every step also keeps to it', () => {
    STAGES.forEach((st, i) => {
      let s: LabState = { ...INITIAL };
      s = reducer(s, { type: 'goto', stage: i, stages: STAGES });
      st.views.forEach((v, vi) => {
        const c = computeCur(ctx, st, { ...s, view: vi });
        const spec = v.fn(ctx, c);
        const text = [
          ...spec.legend, spec.xLabel, spec.yLabel, ...spec.texts.map((q) => q.t),
          ...spec.xTicks.map((q) => q.label), ...spec.yTicks.map((q) => q.label),
          ...st.stats(ctx, c).flatMap((r) => [r.k, r.v]), st.worked(ctx, c),
        ].join('\n');
        for (const [word, first] of INTRODUCED) {
          if (i + 1 < first) {
            const hit = text.match(word);
            expect(hit, `step ${i + 1} view ${v.label} uses "${hit?.[0]}", introduced at step ${first}`).toBeNull();
          }
        }
      });
    });
  });
});

describe('excluded measures', () => {
  it('never appear in the copy, the math or the code of any step', () => {
    STAGES.forEach((_, i) => expect(words(i), TITLES[i]).not.toMatch(EXCLUDED));
  });
  it('and the live text never uses them either', () => {
    STAGES.forEach((st, i) => {
      st.views.forEach((v, vi) => {
        const s = reducer({ ...INITIAL }, { type: 'goto', stage: i, stages: STAGES });
        const c = computeCur(ctx, st, { ...s, view: vi });
        const spec = v.fn(ctx, c);
        const text = [
          ...spec.legend, spec.xLabel, spec.yLabel, ...spec.texts.map((q) => q.t),
          ...spec.xTicks.map((q) => q.label), ...spec.yTicks.map((q) => q.label),
          ...st.stats(ctx, c).flatMap((r) => [r.k, r.v]), st.worked(ctx, c),
        ].join('\n');
        expect(text, `${TITLES[i]} / ${v.label}`).not.toMatch(EXCLUDED);
      });
    });
  });
});

describe('equations', () => {
  it('every symbol and equation is valid TeX that KaTeX renders', () => {
    for (const st of STAGES) {
      for (const n of st.notation) {
        expect(() => katex.renderToString(n.s, { throwOnError: true }), `${st.title}: ${n.s}`).not.toThrow();
      }
      for (const m of st.math) {
        const html = katex.renderToString(m.tex, { displayMode: true, throwOnError: true });
        expect(html, `${st.title}: ${m.tex}`).toContain('katex');
      }
    }
  });
});

describe('code', () => {
  /** The # lab: names found by reading the Python files directly, not through the build plugin. */
  function namesInPython(): Map<string, string> {
    const found = new Map<string, string>();
    for (const dir of ['training', 'pipeline']) {
      const folder = join(__dirname, '..', '..', '..', dir);
      for (const f of readdirSync(folder).filter((n) => n.endsWith('.py'))) {
        for (const m of readFileSync(join(folder, f), 'utf8').matchAll(/^\s*# lab:([A-Za-z0-9_]+)\s*$/gm)) {
          found.set(m[1], `${dir}/${f}`);
        }
      }
    }
    return found;
  }

  it('every step’s code walkthrough shows a real # lab: block of the Python source', () => {
    const real = namesInPython();
    for (const st of STAGES) {
      expect(st.code.length, st.title).toBeGreaterThan(0);
      for (const b of st.code) {
        expect(real.get(b.name), `${st.title}: ${b.name} is not a # lab: block in training/ or pipeline/`).toBe(b.file);
        expect(b.lines.length, b.name).toBeGreaterThan(1);
        expect(b.file, b.name).toMatch(/^(training|pipeline)\/[a-z_]+\.py$/);
      }
    }
  });

  it('every explanation key is the exact text of a line in its block', () => {
    const byName = new Map(allBlocks().map((b) => [b.name, b]));
    for (const [name, notes] of Object.entries(EXPLANATIONS)) {
      const block = byName.get(name);
      expect(block, `explanations for "${name}" but no such block`).toBeDefined();
      for (const key of Object.keys(notes)) {
        expect(block!.lines, `${name}: no line is exactly ${JSON.stringify(key)}`).toContain(key);
      }
    }
  });

  it('every block a step shows has explanations on its code lines, and unexplained lines are blank', () => {
    for (const st of STAGES) {
      for (const b of st.code) {
        const notes = EXPLANATIONS[b.name] ?? {};
        const rows = codeRows(b, notes);
        expect(rows.filter((r) => r.note !== '').length, `${b.name} has explained lines`).toBeGreaterThan(1);
        for (const r of rows) {
          if (!(r.code in notes)) expect(r.note, `${b.name}: ${r.code}`).toBe('');
        }
        // Every executable line (not the docstring, a comment or a blank) has an explanation.
        let inDoc = false;
        for (const line of b.lines) {
          const t = line.trim();
          const quotes = (t.match(/"""/g) ?? []).length;
          const wasDoc = inDoc;
          if (quotes === 1) inDoc = !inDoc;
          if (wasDoc || quotes > 0 || t === '' || t.startsWith('#')) continue;
          expect(notes[line], `${b.name}: the line ${JSON.stringify(line)} has no explanation`).toBeTruthy();
        }
      }
    }
  });

  it('squeezes runs of blank lines and drops blank edges', () => {
    const rows = codeRows({ name: 'x', file: 'training/x.py', startLine: 1, lines: ['', 'a', '', '', 'b', ''] }, { a: 'first' });
    expect(rows).toEqual([{ code: 'a', note: 'first' }, { code: '', note: '' }, { code: 'b', note: '' }]);
  });
});
