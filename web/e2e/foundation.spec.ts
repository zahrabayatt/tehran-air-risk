import { expect, test } from '@playwright/test';
import { GITHUB_URL, HOUSE_URL as SIBLING } from '../src/config';

// The Forecast heading is the day's headline, so its text is tested in forecast.spec.ts.
const ROUTES = [
  { hash: '#/', heading: null, nav: 'Forecast' },
  { hash: '#/lab', heading: 'Model Lab', nav: 'Model Lab' },
  { hash: '#/data', heading: 'Modeled air, not measured air', nav: 'Data' },
];

for (const r of ROUTES) {
  test(`route ${r.hash} shows its heading`, async ({ page }) => {
    await page.goto(r.hash);
    const h1 = page.getByRole('heading', { level: 1 });
    if (r.heading) await expect(h1).toHaveText(r.heading);
    else await expect(h1).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: r.nav })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
}

test('every page sets its own document title', async ({ page }) => {
  for (const [hash, title] of [['#/', 'Tehran Air Risk: Forecast'], ['#/lab', 'Tehran Air Risk: Model Lab'], ['#/data', 'Tehran Air Risk: Data']]) {
    await page.goto(hash);
    await expect(page).toHaveTitle(title);
  }
});

test('pill navigation moves between routes', async ({ page }) => {
  await page.goto('#/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Model Lab' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Model Lab' })).toBeVisible();
  await nav.getByRole('link', { name: 'Data' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Modeled air, not measured air' })).toBeVisible();
});

test('theme button switches and survives a reload', async ({ page }) => {
  await page.goto('#/');
  const app = page.locator('.app');
  await expect(app).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Asphalt' }).click();
  await expect(app).toHaveClass(/dark/);
  await expect(page.getByRole('button', { name: 'Light' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.app')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('.app')).not.toHaveClass(/dark/);
});

test('footer names the author, credits the sources and links to the code and the other project', async ({ page }) => {
  await page.goto('#/');
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('Built by Zahra Bayat.');
  await expect(footer).toContainText('CAMS via Open-Meteo');
  await expect(footer).toContainText('ECMWF via Open-Meteo');
  await expect(footer).toContainText('Both CC-BY 4.0');
  await expect(footer).toContainText('OpenStreetMap contributors, ODbL');
  const hrefs = await footer.getByRole('link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.some((h) => h.startsWith(GITHUB_URL))).toBe(true);
  expect(hrefs.some((h) => h.startsWith(SIBLING))).toBe(true);
  for (const h of hrefs) expect(h.startsWith(GITHUB_URL) || h.startsWith(SIBLING), h).toBe(true);
});

test('fonts are self-hosted', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1')) external.push(req.url());
  });
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
});
