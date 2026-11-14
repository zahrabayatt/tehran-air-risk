import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { NOW_FRESH, NOW_STALE, empty, normal, stale, westGap } from './forecastFixtures';

// Every route, in both themes, at 1280 and 390 wide: no serious or critical axe violation, and no sideways
// page scroll at 390. The Forecast page is opened here on a fixture file with a fixed clock, so it shows
// the same answer on any day; its stale, empty and error states are checked here too, and forecast.spec.ts checks
// the other states (a gap, made late, the map).
// The Model Lab is checked here at its opening step, and step by step in the block below.
interface Route {
  name: string;
  hash: string;
  heading: string | RegExp;
  /** Runs before the page loads: serve a fixture file and fix the clock. */
  prepare?: (page: Page) => Promise<void>;
  /** Extra wait for a state whose heading is the same as while loading. */
  ready?: (page: Page) => Promise<void>;
}
/** Serve a fixture (or a failure) as predictions.json and fix the clock, so the Forecast page shows the same state on any day. */
const forecastPage = (body: unknown | 'error', now = NOW_FRESH) => async (page: Page) => {
  await page.route('**/data/predictions.json', (route) =>
    body === 'error' ? route.fulfill({ status: 404, body: 'nope' }) : route.fulfill({ json: body }),
  );
  await page.addInitScript((t) => {
    window.__TAR_NOW__ = t;
  }, now);
};
const ROUTES: Route[] = [
  { name: 'Forecast', hash: '#/', heading: 'Tehran air tomorrow', prepare: forecastPage(normal()) },
  { name: 'Forecast, gap', hash: '#/', heading: 'Tehran air tomorrow', prepare: forecastPage(westGap()) },
  { name: 'Model Lab', hash: '#/lab', heading: 'Model Lab' },
  { name: 'Data', hash: '#/data', heading: 'Where the forecast comes from' },
  { name: 'Forecast, stale', hash: '#/', heading: 'Tehran air', prepare: forecastPage(stale(), NOW_STALE) },
  { name: 'Forecast, empty', hash: '#/', heading: 'Tehran air', prepare: forecastPage(empty()) },
  {
    name: 'Forecast, error',
    hash: '#/',
    heading: 'Tehran air tomorrow',
    prepare: forecastPage('error'),
    ready: async (page) => {
      await expect(page.getByRole('alert')).toContainText('The forecast did not load');
    },
  },
];
const LAB: Route = ROUTES.find((r) => r.name === 'Model Lab') as Route;
const WIDTHS = [1280, 390];
const THEMES = ['dark', 'light'] as const;

async function open(page: Page, route: Route, theme: (typeof THEMES)[number]) {
  const { hash, heading } = route;
  await route.prepare?.(page);
  await page.goto(hash);
  if (theme === 'light') {
    // The choice is remembered, so a page opened again in the same test is already light.
    const toLight = page.getByRole('button', { name: 'Switch to light theme' });
    if (await toLight.count()) await toLight.click();
    await expect(page.locator('.app')).not.toHaveClass(/dark/);
  }
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  await route.ready?.(page);
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

// Every Lab step is different, so each one is checked, with each of its tabs, in both themes at both widths.
const LAB_STEP_COUNT = 17;
const stepRoute = (n: number): Route => ({ ...LAB, hash: `#/lab/${n}` });
const sideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`Model Lab steps, ${theme}, ${width}px: no serious or critical accessibility violations in any tab`, async ({ page }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width, height: 900 });
      for (let n = 1; n <= LAB_STEP_COUNT; n++) {
        await open(page, stepRoute(n), theme);
        await expect(page.locator('#main')).toBeAttached();
        for (const tab of await page.getByRole('tab').allInnerTexts()) {
          await page.getByRole('tab', { name: tab }).click();
          const results = await new AxeBuilder({ page }).analyze();
          const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((x) => x.target.join(' ')).join(' | ')}`);
          expect(summary, `step ${n}, ${tab}`).toEqual([]);
        }
      }
    });
  }
}

test('Model Lab: no horizontal page scroll at 390px on any step, in both themes', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of THEMES) {
    for (let n = 1; n <= LAB_STEP_COUNT; n++) {
      await open(page, stepRoute(n), theme);
      expect(await sideScroll(page), `step ${n}, ${theme}`).toBe(false);
    }
  }
});
