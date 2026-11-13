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
