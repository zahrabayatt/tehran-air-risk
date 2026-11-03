import { expect, test, type Locator, type Page } from '@playwright/test';

const TITLES = [
  'Data',
  'Label and timing',
  'Why not linear regression?',
  'Sigmoid',
  'Logistic model',
  'Decision boundary',
  'Why not squared error?',
  'Logistic loss',
  'Cost function',
  'Gradient descent',
  'Vectorization',
  'Learning rate',
  'Feature scaling',
  'Feature engineering',
  'Overfitting and regularization',
  'Held-out result',
  'Daily forecast',
];
const PARTS = ['The problem', 'The model', 'The cost', 'Training', 'Generalizing', 'The result'];
/** Steps that show the training bar. Gradient descent is the first. */
const TRAINING = [10, 12, 13];
const EXCLUDED = /\b(MSE|RMSE|accuracy|precision|recall|F1|ROC|AUC|confusion matrix|threshold analysis|mean squared|root mean|L1 loss|L2 loss)\b/i;
/** A word a step may use only from the step that introduces it. */
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

const steps = (page: Page) => page.getByRole('navigation', { name: 'Lab steps' });
const status = (page: Page) => page.getByTestId('step-status');
const plot = (page: Page) => page.getByTestId('plot').locator('svg');
const stats = (page: Page) => page.getByTestId('stats');
const runStatus = (page: Page) => page.getByTestId('run-status');
const tryNote = (page: Page) => page.getByTestId('try-note');
const stat = (page: Page, key: string) => stats(page).locator(`div:has(> dt:text-is("${key}")) > dd`);

/** The text of the whole page except the step list and the pager, whose titles name every step. */
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('nav[aria-label="Lab steps"], nav[aria-label="Step navigation"], script, style').forEach((n) => n.remove());
    return body.textContent ?? '';
  });
}

async function goStep(page: Page, n: number) {
  await steps(page).getByRole('button', { name: TITLES[n - 1], exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: TITLES[n - 1], exact: true })).toBeVisible();
}

/** Set a range or number input the way a user drag would: through the input event. */
async function setInput(input: Locator, value: number | string) {
  await input.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** Every attribute of every element in the plot, to look for values that are not numbers. */
async function badPlotValues(page: Page): Promise<string[]> {
  return plot(page).evaluate((svg) => {
    const bad: string[] = [];
    for (const el of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
      for (const a of Array.from(el.attributes)) {
        if (/NaN|Infinity|undefined|null/.test(a.value)) bad.push(`${el.tagName}[${a.name}]=${a.value.slice(0, 60)}`);
      }
      if (/NaN|Infinity|undefined/.test(el.textContent ?? '') && el.children.length === 0) {
        bad.push(`${el.tagName} text ${el.textContent}`);
      }
    }
    return bad;
  });
}
const drawn = (page: Page) => plot(page).locator('circle, path, rect, text').count();

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function viewNames(page: Page): Promise<string[]> {
  return page.getByRole('group', { name: 'Plot view' }).getByRole('button').allInnerTexts();
}
async function triesCount(page: Page): Promise<number> {
  return page.getByRole('group', { name: 'Try this' }).getByRole('button').count();
}

test.beforeEach(async ({ page }) => {
  await page.goto('#/lab');
  await expect(page.getByRole('heading', { level: 1, name: 'Model Lab' })).toBeVisible();
  await expect(page.getByTestId('plot')).toBeVisible();
});

test('lists the 17 steps in design order under six parts', async ({ page }) => {
  const names = await steps(page).getByRole('button').evaluateAll((els) =>
    els.map((e) => (e.textContent ?? '').replace(/^\d+/, '')),
  );
  expect(names).toEqual(TITLES);
  for (const part of PARTS) {
    await expect(steps(page).getByText(part, { exact: true })).toBeAttached();
  }
});

test('opens at step 1 of 17', async ({ page }) => {
  await expect(status(page)).toContainText('Step 1 of 17');
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Data');
  await expect(steps(page).getByRole('button', { name: 'Data', exact: true })).toHaveAttribute('aria-current', 'step');
});

test('Next and Previous move one step at a time', async ({ page }) => {
  const pager = page.getByRole('navigation', { name: 'Step navigation' });
  await expect(pager.getByRole('button', { name: /Previous|←/ })).toHaveCount(0);
  await pager.getByRole('button', { name: 'Next: Label and timing →' }).click();
  await expect(status(page)).toContainText('Step 2 of 17');
  await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('Label and timing');
  await pager.getByRole('button', { name: '← Data' }).click();
  await expect(status(page)).toContainText('Step 1 of 17');
  for (let i = 1; i < 17; i++) await pager.getByRole('button', { name: /^Next:/ }).click();
  await expect(status(page)).toContainText('Step 17 of 17');
  await expect(pager.getByRole('button', { name: /^Next:/ })).toHaveCount(0);
});

test('Start and the training bar exist only from step 10, Gradient descent', async ({ page }) => {
  for (let n = 1; n <= 17; n++) {
    await goStep(page, n);
    const expected = TRAINING.includes(n) ? 1 : 0;
    await expect(page.getByRole('button', { name: 'Start', exact: true }), `step ${n}`).toHaveCount(expected);
    await expect(page.getByTestId('train-bar'), `step ${n}`).toHaveCount(expected);
    await expect(page.getByLabel('Iterations', { exact: true }), `step ${n}`).toHaveCount(expected);
    if (n < 10) await expect(page.getByLabel(/Learning rate/), `step ${n}`).toHaveCount(0);
  }
});

test('Start animates the cost and the run ends with a lower cost', async ({ page }) => {
  await goStep(page, 10);
  const before = (await stat(page, 'Cost J').innerText()).trim();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => (await stat(page, 'Cost J').innerText()).trim()).not.toBe(before);
  const mid = Number(await stat(page, 'Cost J').innerText());
  await expect(runStatus(page)).toContainText(/^Ran on \d+ sample days in [\d.]+ ms, measured in this browser/);
  const after = Number(await stat(page, 'Cost J').innerText());
  expect(after).toBeLessThan(Number(before));
  expect(after).toBeLessThanOrEqual(mid);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('Pause, Resume, Step and Reset work', async ({ page }) => {
  await goStep(page, 10);
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(page.getByText(/Replay: iteration 1 of/)).toBeVisible();
  await expect(page.getByTestId('run-status')).toHaveText('Paused at iteration 1 of 500.');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  const paused = await page.getByTestId('replay-label').innerText();
  await page.waitForTimeout(300);
  expect(await page.getByTestId('replay-label').innerText()).toBe(paused);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(runStatus(page)).toContainText('Ran on');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(runStatus(page)).toHaveText('Press Start to train with these settings.');
  await expect(page.getByText(/Replay: iteration 0 of/)).toBeVisible();
});

test('a huge learning rate added to the race stops with a message and keeps the plots finite', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goStep(page, 12);
  await page.getByLabel('New learning rate').fill('1e300');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(runStatus(page)).toContainText(/Stopped: .*α = 1e\+300 at iteration \d+/);
  expect(await badPlotValues(page)).toEqual([]);
  await expect(stats(page)).not.toContainText(/NaN|Infinity/);
  await expect(stat(page, 'α = 1e+300')).toContainText('stopped at iteration');
});

test('the largest Gradient descent rate bounces without a stop and keeps every plot finite', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goStep(page, 10);
  await setInput(page.getByLabel('Learning rate α'), 1);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(runStatus(page)).toContainText('Ran on');
  for (let v = 0; v < (await viewNames(page)).length; v++) {
    await page.getByRole('group', { name: 'Plot view' }).getByRole('button').nth(v).click();
    expect(await badPlotValues(page)).toEqual([]);
  }
});

test('the replay slider scrubs a finished run', async ({ page }) => {
  await goStep(page, 10);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(runStatus(page)).toContainText('Ran on');
  const end = (await stat(page, 'Cost J').innerText()).trim();
  await setInput(page.getByLabel(/^Replay: iteration/), 0);
  await expect(stat(page, 'Cost J')).not.toHaveText(end);
});

test('reduced motion jumps straight to the end', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goStep(page, 10);
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(runStatus(page)).toContainText('Ran on');
  await expect(page.getByText(/Replay: iteration 500 of 500/)).toBeVisible();
});

test('the iterations box clamps to 1 through 5000', async ({ page }) => {
  await goStep(page, 10);
  const box = page.getByLabel('Iterations', { exact: true });
  await box.fill('99999');
  await box.blur();
  await expect(box).toHaveValue('5000');
  await box.fill('0');
  await box.blur();
  await expect(box).toHaveValue('1');
  await box.fill('37');
  await box.blur();
  await expect(page.getByText(/Replay: iteration 0 of 37/)).toBeVisible();
});

test('moving w or b clears the run', async ({ page }) => {
  await goStep(page, 10);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(runStatus(page)).toContainText('Ran on');
  await setInput(page.getByLabel('Weight w', { exact: true }), 2);
  await expect(runStatus(page)).toHaveText('Press Start to train with these settings.');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(runStatus(page)).toContainText('Ran on');
  await setInput(page.getByLabel('Bias b', { exact: true }), -3);
  await expect(runStatus(page)).toHaveText('Press Start to train with these settings.');
});

test('each plot tab switches the plot', async ({ page }) => {
  for (const n of [1, 6, 7, 10, 16]) {
    await goStep(page, n);
    const names = await viewNames(page);
    expect(names.length).toBeGreaterThan(1);
    const labels = new Set<string | null>();
    for (let v = 0; v < names.length; v++) {
      const btn = page.getByRole('group', { name: 'Plot view' }).getByRole('button').nth(v);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await expect(plot(page)).toHaveAttribute('aria-label', `${TITLES[n - 1]}: ${names[v]}`);
      labels.add(await plot(page).getAttribute('aria-label'));
    }
    expect(labels.size).toBe(names.length);
  }
});

test('the worked example is live and follows the controls', async ({ page }) => {
  await goStep(page, 5);
  const worked = page.getByTestId('worked');
  const before = await worked.innerText();
  expect(before).toMatch(/Actual: y = [01]/);
  await setInput(page.getByLabel('Weight w', { exact: true }), 2);
  await expect(worked).not.toHaveText(before);
  expect(await worked.innerText()).toContain('2.00');
  const mid = await worked.innerText();
  await setInput(page.getByLabel('Bias b', { exact: true }), -6);
  await expect(worked).not.toHaveText(mid);
  expect(await worked.innerText()).toContain('-6.00');

  await goStep(page, 4);
  await setInput(page.getByLabel('Value of z', { exact: true }), 2);
  await expect(worked).toContainText('g(2.00)');
  await expect(worked).toContainText('0.8808');
  await expect(stat(page, 'g(z)')).toHaveText('0.8808');

  await goStep(page, 8);
  await setInput(page.getByLabel(/Predicted probability/), 0.05);
  await expect(stat(page, 'Loss')).toHaveText('2.996');
  await setInput(page.getByLabel(/Actual label/), 0);
  await expect(stat(page, 'Loss')).toHaveText('0.051');
  await expect(worked).toContainText('y = 0');
});

test('adding very polluted days moves the line’s crossing to the right', async ({ page }) => {
  await goStep(page, 3);
  const before = Number.parseFloat(await stat(page, 'Crosses 0.5 at').innerText());
  await setInput(page.getByLabel('Very polluted days added'), 5);
  const after = Number.parseFloat(await stat(page, 'Crosses 0.5 at').innerText());
  expect(after).toBeGreaterThan(before + 3);
  await expect(page.getByTestId('worked')).toContainText('With no added days');
});

test('stats panels show the live w, b and cost', async ({ page }) => {
  await goStep(page, 9);
  const cost = (await stat(page, 'Cost J').innerText()).trim();
  await setInput(page.getByLabel('Weight w', { exact: true }), 2.5);
  await expect(stat(page, 'w')).toHaveText('2.50');
  await expect(stat(page, 'Cost J')).not.toHaveText(cost);
});

test('equations render through KaTeX on every step', async ({ page }) => {
  for (let n = 1; n <= 17; n++) {
    await goStep(page, n);
    const math = page.getByTestId('math-tab');
    await expect(math, `step ${n}`).toBeVisible();
    expect(await math.locator('.katex').count(), `step ${n}`).toBeGreaterThan(0);
    expect(await math.locator('.katex-error').count(), `step ${n}`).toBe(0);
  }
});

test('the explanation tabs switch between math, code and scikit-learn', async ({ page }) => {
  await goStep(page, 5);
  const group = page.getByRole('group', { name: 'Explanation section' });
  await expect(page.getByTestId('math-tab')).toBeVisible();
  await group.getByRole('button', { name: 'The code' }).click();
  await expect(group.getByRole('button', { name: 'The code' })).toHaveAttribute('aria-pressed', 'true');
  const code = page.getByTestId('code-tab');
  await expect(code).toContainText('def predict_proba_loop(X, w, b):');
  await expect(code).toContainText('z_i += X[i, j] * w[j]');
  await expect(code).toContainText('Add feature j times its weight.');
  await expect(page.getByTestId('math-tab')).toHaveCount(0);
  await group.getByRole('button', { name: 'scikit-learn' }).click();
  await expect(page.getByTestId('sk-tab')).toContainText('LogisticRegression');
});

test('code rows come from the repository, with the file named and no link without a repository URL', async ({ page }) => {
  await goStep(page, 15);
  await page.getByRole('button', { name: 'The code' }).click();
  const code = page.getByTestId('code-tab');
  await expect(code).toContainText('def compute_cost_reg(X, y, w, b, lambda_):');
  await expect(code).toContainText('training/model.py');
  await expect(code).toContainText('training/experiments.py');
  await expect(code.getByRole('link')).toHaveCount(0);
});

test('every step and every plot view draws finite numbers', async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = watchErrors(page);
  for (let n = 1; n <= 17; n++) {
    await goStep(page, n);
    const names = await viewNames(page);
    expect(names.length, `step ${n}`).toBeGreaterThan(0);
    for (let withRun = 0; withRun < (TRAINING.includes(n) ? 2 : 1); withRun++) {
      if (withRun) await page.getByRole('button', { name: 'Start', exact: true }).click();
      for (let v = 0; v < names.length; v++) {
        await page.getByRole('group', { name: 'Plot view' }).getByRole('button').nth(v).click();
        expect(await badPlotValues(page), `step ${n} view ${names[v]}`).toEqual([]);
        expect(await drawn(page), `step ${n} view ${names[v]} draws something`).toBeGreaterThan(3);
        const text = await stats(page).innerText();
        expect(text, `step ${n} stats`).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  }
  expect(errors).toEqual([]);
});

for (let n = 1; n <= 17; n++) {
  test(`step ${n} presets run without errors`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goStep(page, n);
    const count = await triesCount(page);
    expect(count, `step ${n} has Try this presets`).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const btn = page.getByRole('group', { name: 'Try this' }).getByRole('button').nth(i);
      const label = (await btn.innerText()).trim();
      await btn.click();
      const note = (await tryNote(page).innerText()).trim();
      expect(note.length, `${label}: note`).toBeGreaterThan(20);
      expect(note, `${label}: note`).not.toMatch(/Pick one to see/);
      if (TRAINING.includes(n)) {
        await expect(runStatus(page), `${label}`).toContainText(/Ran on|Stopped/);
      }
      for (let v = 0; v < (await viewNames(page)).length; v++) {
        await page.getByRole('group', { name: 'Plot view' }).getByRole('button').nth(v).click();
        expect(await badPlotValues(page), `${label}`).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('the sandbox label is always visible', async ({ page }) => {
  for (const n of [1, 6, 10, 16]) {
    await goStep(page, n);
    await expect(page.getByTestId('sandbox-label')).toBeVisible();
    await expect(page.getByTestId('sandbox-label')).toContainText('Sandbox: does not affect the live model');
  }
});

test('the held-out step shows the frozen model’s own numbers and says plainly how it did', async ({ page }) => {
  const model = await (await page.request.get('data/model.json')).json();
  await goStep(page, 16);
  await expect(plot(page)).toHaveAttribute('aria-label', 'Held-out result: Cost vs simple guesses');
  await expect(stat(page, 'Live model')).toHaveText(model.cost.held_out.toFixed(3));
  await expect(stat(page, 'Overall-rate guess')).toHaveText(model.baselines.overall.held_out_cost.toFixed(3));
  await expect(stat(page, 'Monthly-rate guess')).toHaveText(model.baselines.monthly.held_out_cost.toFixed(3));
  const wins = model.cost.held_out < model.baselines.overall.held_out_cost && model.cost.held_out < model.baselines.monthly.held_out_cost;
  expect(wins).toBe(model.beats_baselines);
  await expect(stat(page, 'Beats both?')).toHaveText(wins ? 'Yes' : 'No');
  await expect(page.getByTestId('plot')).toContainText(wins ? 'beats both simple guesses' : 'does NOT beat both simple guesses');
  await expect(page.getByTestId('worked')).toContainText(wins ? 'beats both' : 'does NOT beat both');

  await page.getByRole('group', { name: 'Plot view' }).getByRole('button', { name: 'Probabilities by outcome' }).click();
  await expect(stat(page, 'Held-out days')).toHaveText(model.rows.held_out.toLocaleString('en-US'));
  await page.getByRole('group', { name: 'Plot view' }).getByRole('button', { name: 'Cost by λ' }).click();
  await expect(stat(page, 'Live model λ')).toHaveText(String(model.hyperparameters.lambda));
  const chosen = model.candidates.find((c: { chosen: boolean; features: string[] }) => c.chosen);
  await expect(stat(page, 'Selection cost')).toHaveText(chosen.selection_cost.toFixed(3));
});

test('the split slider exists only in the sandbox view, is labelled as a sandbox, and never touches the live numbers', async ({ page }) => {
  await goStep(page, 16);
  await expect(page.getByLabel(/days of the sample used for training/i)).toHaveCount(0);
  const live = await stats(page).innerText();
  await page.getByRole('group', { name: 'Plot view' }).getByRole('button', { name: 'Sandbox: move the split' }).click();
  const slider = page.getByLabel(/days of the sample used for training/i);
  await expect(slider).toBeVisible();
  await expect(page.getByTestId('controls')).toContainText('Sandbox');
  await expect(page.getByTestId('plot')).toContainText('Not the live model’s result');
  const before = await stats(page).innerText();
  await setInput(slider, 150);
  await expect(stats(page)).not.toHaveText(before);
  await expect(stat(page, 'Sandbox training days')).toHaveText('150');
  await page.getByRole('group', { name: 'Plot view' }).getByRole('button', { name: 'Cost vs simple guesses' }).click();
  expect(await stats(page).innerText()).toBe(live);
});

test('steps 1 to 15 show no held-out result, split, or training-run details anywhere on the page', async ({ page }) => {
  for (let n = 1; n <= 15; n++) {
    await goStep(page, n);
    for (let v = 0; v < (await viewNames(page)).length; v++) {
      await page.getByRole('group', { name: 'Plot view' }).getByRole('button').nth(v).click();
      const text = await pageText(page);
      expect(text, `step ${n}`).not.toMatch(/held-out|held out|test cost|generaliz|selection|\bsplit/i);
    }
    await expect(page.getByTestId('live-run')).toHaveCount(0);
    await expect(page.getByTestId('vs-sklearn')).toHaveCount(0);
    await expect(page.getByTestId('run-it')).toContainText('python -m training.train');
  }
});

test('the live training card shows measured values from model.json on the last two steps', async ({ page }) => {
  const model = await (await page.request.get('data/model.json')).json();
  for (const n of [16, 17]) {
    await goStep(page, n);
    const card = page.getByTestId('live-run');
    await expect(card).toContainText('Live model training run');
    const text = await card.innerText();
    expect(text).not.toContain('[measured]');
    expect(text).toContain(model.rows.train.toLocaleString('en-US'));
    expect(text).toContain(model.rows.held_out.toLocaleString('en-US'));
    expect(text).toContain(model.hyperparameters.iterations.toLocaleString('en-US'));
    expect(text).toContain(model.environment.numpy);
    const cmp = await page.getByTestId('vs-sklearn').innerText();
    expect(cmp).not.toContain('[measured]');
    expect(cmp).toContain(model.cost.held_out.toFixed(6));
    expect(cmp).toContain(model.sklearn_cost.held_out.toFixed(6));
    await expect(page.getByTestId('run-it')).toContainText('python -m training.train');
  }
});

test('the vectorization step shows the Python timings from model.json and measures the browser live', async ({ page }) => {
  const model = await (await page.request.get('data/model.json')).json();
  expect(model.vectorization.loop_ms).toBeGreaterThan(model.vectorization.numpy_ms);
  await goStep(page, 11);
  const numpy = await stat(page, 'NumPy, 1,000,000 numbers').innerText();
  const loop = await stat(page, 'Python loop, 1,000,000 numbers').innerText();
  expect(numpy).toBe(`${model.vectorization.numpy_ms.toFixed(2)} ms`);
  expect(loop).toBe(`${model.vectorization.loop_ms.toFixed(1)} ms`);
  const browserLoop = await stat(page, 'This browser, loops').innerText();
  const browserMatrix = await stat(page, 'This browser, matrix form').innerText();
  expect(browserLoop).toMatch(/^[\d.]+ ms$/);
  expect(browserMatrix).toMatch(/^[\d.]+ ms$/);
  expect(Number.parseFloat(browserLoop)).toBeGreaterThan(0);
  expect(Number.parseFloat(browserMatrix)).toBeGreaterThan(0);
  expect(numpy + loop + browserLoop + browserMatrix).not.toContain('[measured]');
  // A bigger problem is measured again, so the browser numbers are not typed in.
  await setInput(page.getByLabel('Days m', { exact: true }), 6000);
  await expect(stat(page, 'Multiplications')).toHaveText('30,000');
  const bigger = await stat(page, 'This browser, loops').innerText();
  expect(Number.parseFloat(bigger)).toBeGreaterThan(Number.parseFloat(browserLoop));
});

test('the daily forecast step reads the forecast log and explains the frozen model and the cutoff', async ({ page }) => {
  const model = await (await page.request.get('data/model.json')).json();
  const log = await (await page.request.get('data/predictions.json')).json();
  const made = log.entries.filter((e: { gap?: boolean }) => e.gap !== true);
  await goStep(page, 17);
  await expect(stat(page, 'Forecasts logged')).toHaveText(made.length.toLocaleString('en-US'));
  await expect(stat(page, 'Days forecast')).toHaveText(
    new Set(made.map((e: { target_date: string }) => e.target_date)).size.toLocaleString('en-US'),
  );
  const last = new Date(Math.max(...log.entries.map((e: { issued_at: string }) => Date.parse(e.issued_at)))).toISOString();
  await expect(stat(page, 'Last run')).toContainText(`${last.slice(0, 10)} ${last.slice(11, 16)} UTC`);
  await expect(stat(page, 'Inputs up to')).toHaveText(model.cutoff);
  await expect(stat(page, 'Scheduled')).toContainText('10:00 UTC');
  await expect(page.getByTestId('worked')).toContainText(`Frozen model v${model.version}`);
  await expect(page.getByTestId('worked')).toContainText(model.weights[0].toFixed(3));
  const text = await pageText(page);
  expect(text).toMatch(/CAMS’s own forecast of tomorrow is never an input/);
  await page.getByRole('group', { name: 'Plot view' }).getByRole('button', { name: 'Frozen model' }).click();
  await expect(page.getByTestId('plot')).toContainText(model.bias.toFixed(3));
});

test('no excluded measure appears on any step', async ({ page }) => {
  for (let n = 1; n <= 17; n++) {
    await goStep(page, n);
    for (const tab of ['The math', 'The code', 'scikit-learn']) {
      await page.getByRole('group', { name: 'Explanation section' }).getByRole('button', { name: tab }).click();
      expect(await page.locator('main').innerText(), `step ${n} ${tab}`).not.toMatch(EXCLUDED);
    }
  }
});

test('there is no slider for the decision threshold, which stays at 0.5', async ({ page }) => {
  for (let n = 1; n <= 17; n++) {
    await goStep(page, n);
    await expect(page.getByLabel(/decision threshold|cut-off for the class/i), `step ${n}`).toHaveCount(0);
  }
});

test('no step uses a word before the step that introduces it', async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (let n = 1; n <= 17; n++) {
    await goStep(page, n);
    const seen: string[] = [];
    const read = async () => seen.push(await pageText(page));
    const views = (await viewNames(page)).length;
    for (let v = 0; v < views; v++) {
      await page.getByRole('group', { name: 'Plot view' }).getByRole('button').nth(v).click();
      await read();
    }
    for (const tab of ['The math', 'The code', 'scikit-learn']) {
      await page.getByRole('group', { name: 'Explanation section' }).getByRole('button', { name: tab }).click();
      await read();
    }
    const tries = await triesCount(page);
    for (let i = 0; i < tries; i++) {
      await page.getByRole('group', { name: 'Try this' }).getByRole('button').nth(i).click();
      await read();
    }
    const text = seen.join('\n').replace(/penalty=None/g, '');
    for (const [word, first] of INTRODUCED) {
      if (n < first) {
        const hit = text.match(word);
        expect(hit, `step ${n} uses "${hit?.[0]}" which step ${first} introduces`).toBeNull();
      }
    }
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the page does not scroll sideways and the step list scrolls on its own', async ({ page }) => {
    for (const n of [1, 4, 6, 9, 10, 11, 12, 15, 16, 17]) {
      await goStep(page, n);
      for (const tab of ['The math', 'The code', 'scikit-learn']) {
        await page.getByRole('group', { name: 'Explanation section' }).getByRole('button', { name: tab }).click();
        const w = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          inner: window.innerWidth,
        }));
        expect(w.scroll, `step ${n} ${tab}`).toBeLessThanOrEqual(w.inner);
      }
    }
    const list = await steps(page).evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      direction: getComputedStyle(el).flexDirection,
    }));
    expect(list.direction).toBe('row');
    expect(['auto', 'scroll']).toContain(list.overflowX);
    expect(list.scrollW).toBeGreaterThan(list.clientW);
  });
});

test.describe('on a narrow tablet', () => {
  test.use({ viewport: { width: 800, height: 900 } });

  test('the step list is one horizontally scrolling row without part headers', async ({ page }) => {
    const list = await steps(page).evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      direction: getComputedStyle(el).flexDirection,
      tops: Array.from(el.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top)),
      heads: Array.from(el.querySelectorAll('.lab-steps__head')).map((h) => getComputedStyle(h).display),
    }));
    expect(list.direction).toBe('row');
    expect(['auto', 'scroll']).toContain(list.overflowX);
    expect(list.scrollW).toBeGreaterThan(list.clientW);
    expect(new Set(list.tops).size).toBe(1);
    expect(list.heads.length).toBeGreaterThan(0);
    expect(list.heads.every((d) => d === 'none')).toBe(true);
    const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(w.scroll).toBeLessThanOrEqual(w.inner);
  });
});
