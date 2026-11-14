import { expect, test } from '@playwright/test';
import { GITHUB_URL } from '../src/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

test('step 1 renders with no page errors and real code from the repository', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('#/lab');
  await expect(page.getByRole('heading', { level: 2, name: TITLES[0] })).toBeVisible();
  await expect(page.getByText('Step 1 of 17')).toBeVisible();
  await expect(page.locator('.code-block__file a').first()).toHaveAttribute('href', new RegExp(`^${GITHUB_URL}/blob/`));
  expect(errors).toEqual([]);
});

test('the sidebar lists the 17 steps in seven sections and marks the open one', async ({ page }) => {
  await page.goto('#/lab/4');
  const nav = page.getByRole('navigation', { name: 'Steps' });
  await expect(nav.getByRole('link')).toHaveCount(17);
  for (const [i, title] of TITLES.entries()) await expect(nav.getByRole('link', { name: `${i + 1} ${title}`, exact: true })).toBeVisible();
  for (const section of ['The problem', 'The model', 'The cost', 'Training', 'Better inputs', 'Fitting well', 'The result']) {
    await expect(nav.getByText(section, { exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: '4 Sigmoid', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('back and next move between steps, and the ends have only one of them', async ({ page }) => {
  await page.goto('#/lab/1');
  const row = page.getByRole('navigation', { name: 'Previous and next step' });
  await expect(row.getByText(/^←/)).toHaveCount(0);
  await row.getByRole('link', { name: `Next: ${TITLES[1]} →` }).click();
  await expect(page).toHaveURL(/#\/lab\/2$/);
  await expect(page.getByRole('heading', { level: 2, name: TITLES[1] })).toBeVisible();
  await row.getByRole('link', { name: `← ${TITLES[0]}` }).click();
  await expect(page).toHaveURL(/#\/lab\/1$/);
  await page.goto('#/lab/17');
  await expect(page.getByRole('heading', { level: 2, name: TITLES[16] })).toBeVisible();
  await expect(row.getByText(/^Next:/)).toHaveCount(0);
});

test('Lab step 1 counts the unhealthy days at the line and follows the slider', async ({ page }) => {
  await page.goto('#/lab/1');
  const count = page.locator('#count');
  await expect(count).toContainText('352 of 4,968');
  await page.locator('#thr').fill('50');
  await expect(count).not.toContainText('352 of');
  await page.getByRole('button', { name: 'Back to 35.4' }).click();
  await expect(count).toContainText('352 of 4,968');
});

test('Lab step 2 has three cases and the moment changes what is known', async ({ page }) => {
  await page.goto('#/lab/2');
  const cases = page.getByRole('group', { name: 'Example' }).getByRole('button');
  await expect(cases).toHaveCount(3);
  const know = page.locator('#know');
  await expect(know).toContainText('The inputs are fixed');
  const before = await know.innerText();
  const box = (await page.locator('#tl').boundingBox())!;
  // drag the time handle from noon (a quarter of the way along the two days) to the end of tomorrow
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * (60 + 680 / 4) / 760, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 739.5 / 760, y, { steps: 6 });
  await page.mouse.up();
  await expect(know).toContainText("Tomorrow's real air: known");
  expect(await know.innerText()).not.toBe(before);
});

test('Lab step 3 shows the straight line giving chances below 0 and where it switches', async ({ page }) => {
  await page.goto('#/lab/3');
  await expect(page.locator('#kv')).toContainText('1,551');
  await expect(page.locator('#kv')).toContainText('56.1');
});

test('Lab step 4 moves g(z) when z is dragged', async ({ page }) => {
  await page.goto('#/lab/4');
  const kv = page.locator('#kv');
  const before = await kv.innerText();
  const box = (await page.locator('#p').boundingBox())!;
  await page.mouse.move(box.x + box.width * 400 / 760, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 600 / 760, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  expect(await kv.innerText()).not.toBe(before);
  await expect(page.locator('#zv')).not.toHaveText('1.5');
  await expect(page.locator('#p')).toContainText('g(');
});

test('Lab step 5 chips give the four costs', async ({ page }) => {
  await page.goto('#/lab/5');
  const note = page.locator('#pnote');
  for (const [name, cost] of [['Flat curve', '0.2558'], ['Too steep', '0.2115'], ['Shifted right', '0.3340'], ['The best', '0.1614']] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(note).toContainText(`Cost ${cost}`);
  }
});

test('Lab step 6 chips move the switch point and the counts follow', async ({ page }) => {
  await page.goto('#/lab/6');
  await expect(page.locator('#p')).toContainText('Tomorrow');
  await expect(page.locator('figcaption')).toContainText('Right of the line');
  await page.getByRole('button', { name: 'Switch at 1 in 2' }).click();
  await expect(page.locator('#pnote')).toContainText('calls 187 days unhealthy');
  await expect(page.locator('#pnote')).toContainText('misses 204');
  await page.getByRole('button', { name: 'Catch more bad days' }).click();
  await expect(page.locator('#pnote')).toContainText('misses only 132');
  await page.getByRole('button', { name: 'Fewer false alarms' }).click();
  await expect(page.locator('#pnote')).toContainText('Only 3 false alarms');
});

test('Lab step 7 compares the slopes of the two costs', async ({ page }) => {
  await page.goto('#/lab/7');
  await expect(page.locator('#co')).toContainText('11 times');
  await expect(page.locator('#kv')).toContainText('squared error');
});

test('Lab step 8 shows the loss for one day and the cost over all days', async ({ page }) => {
  await page.goto('#/lab/8');
  await expect(page.locator('#kv')).toContainText('0.1614');
  await page.getByRole('button', { name: /Tomorrow was OK/ }).click();
  await expect(page.locator('#kv')).toContainText('OK, y = 0');
});

test('Lab step 9 trains by gradient descent to the best possible cost', async ({ page }) => {
  await page.goto('#/lab/9');
  const choices = page.locator('#aseg button');
  await expect(choices).toHaveText(['0.1', '1', '3', '20', 'Custom']);
  await page.locator('#scrub').fill('300');
  await expect(page.locator('#status')).toContainText('Converged at step 42');
  await expect(page.locator('#hist')).toContainText('best possible cost: 0.1614');
});

test('Lab step 10 shows all 19 inputs and the loop against the dot product', async ({ page }) => {
  const today = JSON.parse(readFileSync(join(process.cwd(), 'public/data/lab-today.json'), 'utf8'));
  await page.goto('#/lab/10');
  await expect(page.locator('#xc .cell')).toHaveCount(today.features.length);
  expect(today.features.length).toBe(19);
  const times = Math.round(today.vec.loop_ms / today.vec.numpy_ms);
  await expect(page.locator('#race')).toContainText(`${times}×`);
  await page.getByRole('button', { name: /Dot product/ }).click();
  await page.locator('#go').click();
  const d = today.days[0];
  const z = d.x.reduce((s: number, v: number, j: number) => s + ((v - today.mu[j]) / today.sigma[j]) * today.w[j], today.b);
  const p = 1 / (1 + Math.exp(-z));
  await expect(page.locator('#sumNote')).toContainText(`about ${Math.round(p * 10)} in 10`, { timeout: 5000 });
  await expect(page.locator('#sumNote')).toContainText(d.y ? 'unhealthy' : 'OK');
});

test('Lab step 10 next day changes the day and the sum', async ({ page }) => {
  await page.goto('#/lab/10');
  await expect(page.locator('#adLab')).toContainText('Day 1 of 8');
  const before = await page.locator('#xc').innerText();
  await page.locator('#go').click();
  await expect(page.locator('#sumNote')).toContainText('in 10', { timeout: 5000 });
  const sum1 = await page.locator('#sum').innerText();
  await page.locator('#nextAd').click();
  await expect(page.locator('#adLab')).toContainText('Day 2 of 8');
  expect(await page.locator('#xc').innerText()).not.toBe(before);
  await expect(page.locator('#sumNote')).toHaveText('press Run');
  await page.locator('#go').click();
  await expect(page.locator('#sumNote')).toContainText('in 10', { timeout: 5000 });
  expect(await page.locator('#sum').innerText()).not.toBe(sum1);
  await page.locator('#prevAd').click();
  await expect(page.locator('#adLab')).toContainText('Day 1 of 8');
});

test('Lab step 11 races four learning rates and flags the one that goes up', async ({ page }) => {
  await page.goto('#/lab/11');
  await expect(page.locator('#lanes button')).toHaveCount(4);
  await page.locator('#scrub').fill('300');
  await expect(page.locator('#board')).toContainText('cost went up at step 3');
  await expect(page.locator('#stk')).toHaveText('300');
});

test('Lab step 12 compares scaled and raw inputs', async ({ page }) => {
  await page.goto('#/lab/12');
  await expect(page.locator('#araw')).toHaveText('0.00005');
  await page.locator('#scrub').fill('1000');
  await expect(page.locator('#rcS')).toContainText('Within 1% of the best since step 180');
  await expect(page.locator('#verdict')).toContainText('Scaled');
});

const readData = (name: string) => JSON.parse(readFileSync(join(process.cwd(), `public/data/${name}.json`), 'utf8'));

test('Lab step 13 names three similar mornings and ranks the input sets from the data', async ({ page }) => {
  const model = readData('model');
  await page.goto('#/lab/13');
  await expect(page.locator('#trio .flat')).toHaveCount(3);
  const note = await page.locator('#trioNote').innerText();
  const pm = [...note.matchAll(/\((\d+), (\d+), (\d+) /g)][0].slice(1).map(Number);
  expect(pm).toHaveLength(3);
  for (const v of pm) {
    expect(v).toBeGreaterThanOrEqual(38);
    expect(v).toBeLessThanOrEqual(48);
  }
  const rungs = page.locator('#ladder .rung');
  await expect(rungs).toHaveCount(5);
  await expect(rungs.first()).toContainText(model.previous.cost.selection.toFixed(4));
  await expect(page.locator('#ladder .rung.live')).toContainText(model.cost.selection.toFixed(4));
  await expect(page.locator('#ladder .rung.live')).toContainText('the weather model');
  const best = (fs: string) => Math.min(...model.candidates.filter((c: { feature_set: string }) => c.feature_set === fs).map((c: { selection_cost: number }) => c.selection_cost));
  const pct = Math.round((1 - best('all_wx') / best('all')) * 100);
  await expect(page.locator('#ladderNote')).toContainText(`Weather lowers the cost by about ${pct}%`);
  await expect(page.locator('#ladderNote')).toContainText('86%');
  await page.getByRole('button', { name: 'On a circle' }).click();
  await expect(page.locator('#yr circle').first()).toBeVisible();
});

test('Lab step 14 shows degree 9 on 60 days as overfit', async ({ page }) => {
  await page.goto('#/lab/14');
  await expect(page.locator('#verdict')).toHaveText(/Underfit|Just right|Overfit/, { timeout: 15000 });
  await page.locator('#deg').fill('9');
  await expect(page.locator('#verdict')).toHaveText('Overfit');
  await expect(page.locator('#ns button.on')).toHaveText('60');
  await expect(page.locator('#wnote')).toContainText('new-days cost rose');
});

test('Lab step 15 has the lambda ticks and lambda 0.01 is just right', async ({ page }) => {
  const model = readData('model');
  await page.goto('#/lab/15');
  await expect(page.locator('.ticks')).toHaveText(/none\s*0\.0001\s*0\.001\s*0\.01\s*0\.1\s*1\s*10/);
  await page.locator('#lam').fill('3');
  await expect(page.locator('#verdict')).toHaveText('Just right');
  const wx = model.candidates.filter((c: { feature_set: string }) => c.feature_set === 'all_wx');
  await expect(page.locator('#live .wr')).toHaveCount(wx.length);
  await expect(page.locator('#live')).toContainText(`${model.cost.selection.toFixed(4)} chosen`);
  await expect(page.locator('#liveNote')).toContainText(wx[0].selection_cost.toFixed(4));
});

test('Lab step 16 reads version 2 and the scikit-learn tile matches the held-out cost', async ({ page }) => {
  const model = readData('model');
  await page.goto('#/lab/16');
  await expect(page.locator('#heldv')).toHaveText(model.cost.held_out.toFixed(4));
  await expect(page.locator('#skv')).toHaveText(model.cost.held_out.toFixed(4));
  expect(Math.abs(model.sklearn_cost.held_out - model.cost.held_out)).toBeLessThan(5e-5);
  await expect(page.locator('#skv')).toHaveText(model.sklearn_cost.held_out.toFixed(4));
  await expect(page.locator('#trainv')).toHaveText(model.cost.train.toFixed(4));
  await expect(page.locator('#selv')).toHaveText(model.cost.selection.toFixed(4));
  await expect(page.locator('.time')).toContainText(model.rows.held_out.toLocaleString('en-US'));
  await expect(page.locator('#cautious')).toContainText('in 10');
  await expect(page.locator('#cautious')).toContainText('The Data page shows this check for every band.');
  await expect(page.locator('#cautious')).not.toContainText('The forecast page says');
  await page.locator('#hist .hb').nth(5).click();
  await expect(page.locator('#bincard h3')).toContainText('Said 5 to 6 in 10');
});

test('Lab step 17 adds up to z and the sigmoid gives the chance of the data', async ({ page }) => {
  const t = readData('lab-today');
  await page.goto('#/lab/17');
  await expect(page.locator('#t tr')).toHaveCount(t.features.length + 2);
  const z = t.x.map((v: number, j: number) => ((v - t.mu[j]) / t.sigma[j]) * t.w[j]);
  const sum = z.reduce((a: number, b: number) => a + b, 0);
  const zz = sum + t.b;
  expect(1 / (1 + Math.exp(-zz))).toBeCloseTo(t.p, 3);
  await expect(page.locator('#kvsum')).toHaveText(sum.toFixed(3).replace('-', '−'));
  await expect(page.locator('#kvz')).toHaveText(zz.toFixed(3).replace('-', '−'));
  await expect(page.locator('#kvp')).toHaveText((1 / (1 + Math.exp(-zz))).toFixed(3));
  await expect(page.locator('#kvp')).toHaveText(t.p.toFixed(3));
  await expect(page.locator('#co')).toContainText(`${Math.round(t.p * 10)} in 10`);
  await expect(page.locator('#co')).toContainText(t.actual > 35.4 ? 'unhealthy' : 'OK');
});
