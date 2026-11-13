import { expect, test } from '@playwright/test';
import { GITHUB_URL } from '../src/config';

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
