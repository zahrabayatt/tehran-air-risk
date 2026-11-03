import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The Forecast page has its own accessibility tests (forecast.spec.ts) because they need fixture data.
// Model Lab and Data are placeholders until their tasks; their entries here are replaced then.
const ROUTES = [
  { name: 'Model Lab', hash: '#/lab', heading: 'Model Lab' },
  { name: 'Data', hash: '#/data', heading: 'Data' },
];
const WIDTHS = [1280, 390];
const THEMES = ['light', 'asphalt'] as const;

async function open(page: Page, hash: string, heading: string, theme: (typeof THEMES)[number]) {
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
        await open(page, route.hash, route.heading, theme);
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
      await open(page, route.hash, route.heading, theme);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
}
