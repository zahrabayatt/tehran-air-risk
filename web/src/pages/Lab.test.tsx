import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceLink } from '../components/CodeWalkthrough';
import { oneRun, polyFit, sandbox, timing } from '../lab/context';
import { INITIAL, computeCur, reducer } from '../lab/state';
import { STAGES } from '../lab/stages';
import { ctx, inputs } from '../lab/testData';
import { Lab } from './Lab';

/** A fake animation clock: frames run when the test says so, and cancelled frames never run. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.fn((cb: FrameRequestCallback) => {
    pending.set(next, cb);
    return next++;
  });
  const cancel = vi.fn((id: number) => void pending.delete(id));
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    request,
    cancel,
    pending: () => pending.size,
    /** Run every waiting frame, 40 ms apart. */
    tick(times = 1) {
      for (let i = 0; i < times; i++) {
        now += 40;
        const run = [...pending.entries()];
        pending.clear();
        act(() => run.forEach(([, cb]) => cb(now)));
      }
    },
  };
}

const gotoStep = (title: string) => fireEvent.click(screen.getByRole('button', { name: title }));
const replay = () => screen.getByTestId('replay-label').textContent ?? '';
const worked = () => screen.getByTestId('worked').textContent ?? '';
const stat = (key: string) => {
  const dt = [...screen.getByTestId('stats').querySelectorAll('dt')].find((e) => e.textContent === key);
  return dt?.nextElementSibling?.textContent ?? '';
};
const slide = (label: string | RegExp, value: number) => fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the training bar', () => {
  it('shows Start only from Gradient descent onward, and only on the training steps', () => {
    render(<Lab inputs={inputs} />);
    const training = ['Gradient descent', 'Learning rate', 'Feature scaling'];
    STAGES.forEach((st, i) => {
      gotoStep(st.title);
      const expected = training.includes(st.title) ? 1 : 0;
      expect(screen.queryAllByRole('button', { name: 'Start' }).length, `step ${i + 1} ${st.title}`).toBe(expected);
      expect(screen.queryAllByLabelText('Iterations').length, `step ${i + 1} iterations`).toBe(expected);
      expect(screen.queryAllByTestId('train-bar').length, `step ${i + 1} bar`).toBe(expected);
      if (i < 9) {
        expect(screen.queryByLabelText(/Learning rate/), `step ${i + 1} α`).toBeNull();
        expect(screen.queryByRole('button', { name: 'Step' }), `step ${i + 1} Step`).toBeNull();
      }
    });
  }, 30_000);

  it('opens at step 1 of 17', () => {
    render(<Lab inputs={inputs} />);
    expect(screen.getByTestId('step-status').textContent).toMatch(/^Step 1 of 17\. Project data/);
  });
});

describe('the worked example follows the controls', () => {
  it('Why not linear regression?: adding very polluted days moves the crossing to the right', () => {
    render(<Lab inputs={inputs} />);
    gotoStep('Why not linear regression?');
    const before = parseFloat(stat('Crosses 0.5 at'));
    expect(before).toBeGreaterThan(0);
    const textBefore = worked();
    slide('Very polluted days added', 5);
    const after = parseFloat(stat('Crosses 0.5 at'));
    expect(after).toBeGreaterThan(before + 1);
    expect(worked()).not.toBe(textBefore);
    slide('Very polluted days added', 0);
    expect(parseFloat(stat('Crosses 0.5 at'))).toBeCloseTo(before, 6);
  });

  it('Sigmoid: z changes g(z) and the worked example', () => {
    render(<Lab inputs={inputs} />);
    gotoStep('Sigmoid');
    expect(worked()).toContain('g(0.00)');
    expect(stat('g(z)')).toBe('0.5000');
    slide('Value of z', 2);
    expect(worked()).toContain('g(2.00)');
    expect(worked()).toContain('0.8808');
    expect(stat('g(z)')).toBe('0.8808');
    expect(stat('Class at 0.5')).toBe('1');
    slide('Value of z', -3);
    expect(stat('Class at 0.5')).toBe('0');
    expect(worked()).toContain('0.0474');
  });

  it('Logistic loss: the probability and the label change the loss and the worked example', () => {
    render(<Lab inputs={inputs} />);
    gotoStep('Logistic loss');
    slide(/Predicted probability/, 0.95);
    expect(stat('Loss')).toBe('0.051');
    expect(worked()).toContain('f = 0.95');
    slide(/Predicted probability/, 0.05);
    expect(stat('Loss')).toBe('2.996');
    slide(/Actual label/, 0);
    expect(stat('Label y')).toBe('0');
    expect(stat('Loss')).toBe('0.051');
    expect(worked()).toContain('y = 0');
  });

  it('Logistic model: w and b change the first-day score', () => {
    render(<Lab inputs={inputs} />);
    gotoStep('Logistic model');
    const before = worked();
    slide('Weight w', 2);
    slide('Bias b', -6);
    expect(worked()).not.toBe(before);
    expect(worked()).toContain('2.00');
    expect(worked()).toContain('-6.00');
  });
});

describe('the animation', () => {
  it('advances one animation frame at a time and stops when the run ends', () => {
    const frames = fakeFrames();
    render(<Lab inputs={inputs} />);
    gotoStep('Gradient descent');
    fireEvent.change(screen.getByLabelText('Iterations'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(replay()).toBe('Replay: iteration 0 of 30');
    frames.tick(3);
    expect(replay()).not.toBe('Replay: iteration 0 of 30');
    frames.tick(60);
    expect(replay()).toBe('Replay: iteration 30 of 30');
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(frames.pending()).toBe(0);
  });

  it('cancels the pending frame when the page unmounts', () => {
    const frames = fakeFrames();
    const { unmount } = render(<Lab inputs={inputs} />);
    gotoStep('Gradient descent');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    frames.tick(2);
    expect(frames.pending()).toBe(1);
    const before = frames.request.mock.calls.length;
    unmount();
    expect(frames.cancel).toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
    frames.tick(3);
    expect(frames.request.mock.calls.length).toBe(before);
  });

  it('stops asking for frames while paused', () => {
    const frames = fakeFrames();
    render(<Lab inputs={inputs} />);
    gotoStep('Gradient descent');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    frames.tick(2);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(frames.pending()).toBe(0);
    const at = replay();
    frames.tick(5);
    expect(replay()).toBe(at);
  });

  it('jumps to the end at once when the person prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    const frames = fakeFrames();
    render(<Lab inputs={inputs} />);
    gotoStep('Gradient descent');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(replay()).toBe('Replay: iteration 500 of 500');
    expect(frames.request).not.toHaveBeenCalled();
  });
});

describe('divergence in the page', () => {
  it('a huge learning rate added to the race stops and says where, without a non-number on the page', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    render(<Lab inputs={inputs} />);
    gotoStep('Learning rate');
    fireEvent.change(screen.getByLabelText('New learning rate'), { target: { value: '1e300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    const status = screen.getByTestId('run-status').textContent ?? '';
    expect(status).toMatch(/Stopped: .*α = 1e\+300 at iteration \d+/);
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/);
    expect(document.querySelector('svg [d*="NaN"]')).toBeNull();
  });
});

describe('the sandbox never changes the frozen model', () => {
  it('the model the Lab was given, and the copy it works on, are unchanged after every step, view, preset and run', () => {
    const snapshot = JSON.stringify(inputs.model);
    const frozenSnapshot = JSON.stringify(ctx.model);
    expect(Object.isFrozen(ctx.model)).toBe(true);
    expect(Object.isFrozen(ctx.model.weights)).toBe(true);
    expect(Object.isFrozen(ctx.model.scaling.mu)).toBe(true);
    expect(() => {
      (ctx.model.weights as number[])[0] = 99;
    }).toThrow();
    expect(() => {
      (ctx.model as { bias: number }).bias = 99;
    }).toThrow();

    STAGES.forEach((st, i) => {
      let s = reducer({ ...INITIAL }, { type: 'goto', stage: i, stages: STAGES });
      for (const t of st.tries) {
        const patch = typeof t.set === 'function' ? t.set(ctx) : t.set;
        s = reducer(s, { type: 'preset', patch, note: t.note, run: !!t.run, reduced: true });
        const c = computeCur(ctx, st, s);
        st.views.forEach((v) => v.fn(ctx, c));
        st.stats(ctx, c);
        st.worked(ctx, c);
      }
      if (st.train) {
        s = reducer(s, { type: 'start', reduced: true });
        const c = computeCur(ctx, st, s);
        st.views.forEach((v) => v.fn(ctx, c));
      }
    });
    oneRun(ctx, 'x', 0, 0, 0.5, 300);
    polyFit(ctx, 3);
    sandbox(ctx, 200);
    timing(ctx, 100, 5);

    expect(JSON.stringify(inputs.model)).toBe(snapshot);
    expect(JSON.stringify(ctx.model)).toBe(frozenSnapshot);
    expect(frozenSnapshot).toBe(snapshot);
  });

  it('driving the page itself leaves it unchanged too', () => {
    const snapshot = JSON.stringify(inputs.model);
    render(<Lab inputs={inputs} />);
    for (const st of STAGES) {
      gotoStep(st.title);
      if (st.train) fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    }
    expect(JSON.stringify(inputs.model)).toBe(snapshot);
  }, 30_000);
});

describe('measured values', () => {
  it('the vectorization step shows the stored Python timings and live browser timings', () => {
    render(<Lab inputs={inputs} />);
    gotoStep('Vectorization');
    const m = inputs.model.vectorization;
    expect(stat('Python loop, 1,000,000 numbers')).toBe(`${m.loop_ms.toFixed(1)} ms`);
    expect(stat('NumPy, 1,000,000 numbers')).toBe(`${m.numpy_ms.toFixed(2)} ms`);
    expect(stat('This browser, loops')).toMatch(/^[\d.]+ ms$/);
    expect(stat('This browser, matrix form')).toMatch(/^[\d.]+ ms$/);
    expect(document.body.textContent).not.toContain('[measured]');
  });
});

describe('code links', () => {
  const block = { name: 'x', file: 'training/model.py', startLine: 10, lines: ['a', 'b', 'c'] };
  it('exist only when the repository address is set', () => {
    expect(sourceLink('', block)).toBeNull();
    const base = `https://github.com/me/repo/blob/${__COMMIT__}/training/model.py#L10-L12`;
    expect(sourceLink('https://github.com/me/repo', block)).toBe(base);
    expect(sourceLink('https://github.com/me/repo/', block)).toBe(base);
  });
});
