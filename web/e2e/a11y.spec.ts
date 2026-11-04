import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NOW_FRESH, mixed } from './forecastFixtures';

// Every route, in both themes, at 1280 and 390 wide: no serious or critical axe violation, and no sideways
// page scroll at 390. The Forecast page is opened here on a fixture file with a fixed clock, so it shows
// the same answer on any day; forecast.spec.ts checks its other states (a gap, stale, empty, the CAMS layer).
// The Model Lab is checked here at its opening step, and step by step in the block below.
interface Route {
  name: string;
  hash: string;
  heading: string | RegExp;
  /** Runs before the page loads: serve a fixture file and fix the clock. */
  prepare?: (page: Page) => Promise<void>;
}
const ROUTES: Route[] = [
  {
    name: 'Forecast',
    hash: '#/',
    heading: /^Wednesday 4 November: mixed/,
    prepare: async (page) => {
      await page.route('**/data/predictions.json', (route) => route.fulfill({ json: mixed() }));
      await page.addInitScript((t) => {
        window.__TAR_NOW__ = t;
      }, NOW_FRESH);
    },
  },
  { name: 'Model Lab', hash: '#/lab', heading: 'Model Lab' },
  { name: 'Data', hash: '#/data', heading: 'Modeled air, not measured air' },
];
/** Lab steps that between them show every kind of control, plot, tab and card. */
const LAB_STEPS = [
  'Data',
  'Why not linear regression?',
  'Decision boundary',
  'Cost function',
  'Gradient descent',
  'Vectorization',
  'Learning rate',
  'Feature scaling',
  'Overfitting and regularization',
  'Held-out result',
  'Daily forecast',
];
const LAB: Route = ROUTES[1];
const WIDTHS = [1280, 390];
const THEMES = ['light', 'asphalt'] as const;

async function open(page: Page, route: Route, theme: (typeof THEMES)[number]) {
  const { hash, heading } = route;
  await route.prepare?.(page);
  await page.goto(hash);
  if (theme === 'asphalt') {
    await page.getByRole('button', { name: 'Asphalt' }).click();
    await expect(page.locator('.app')).toHaveClass(/dark/);
  }
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

for (const route of ROUTES) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`${route.name}, ${theme}, ${width}px: no serious or critical accessibility violations`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await open(page, route, theme);
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
        expect(summary).toEqual([]);
      });
    }
  }
}

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`${route.name}, ${theme}: no horizontal page scroll at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, route, theme);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`Model Lab steps, ${theme}, ${width}px: no serious or critical accessibility violations in any tab`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 900 });
      await open(page, LAB, theme);
      await expect(page.getByTestId('plot')).toBeVisible();
      for (const title of LAB_STEPS) {
        await page.getByRole('navigation', { name: 'Lab steps' }).getByRole('button', { name: title, exact: true }).click();
        await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible();
        for (const tab of ['The math', 'The code', 'scikit-learn']) {
          await page.getByRole('group', { name: 'Explanation section' }).getByRole('button', { name: tab }).click();
          const results = await new AxeBuilder({ page }).analyze();
          const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
          expect(summary, `${title}, ${tab}`).toEqual([]);
        }
      }
    });
  }
}

test('Model Lab: no horizontal page scroll at 390px on the long steps, in both themes', async ({ page }) => {
  for (const theme of THEMES) {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, LAB, theme);
    for (const title of ['Gradient descent', 'Learning rate', 'Held-out result', 'Daily forecast']) {
      await page.getByRole('navigation', { name: 'Lab steps' }).getByRole('button', { name: title, exact: true }).click();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `${title}, ${theme}`).toBeLessThanOrEqual(clientWidth);
    }
  }
});
