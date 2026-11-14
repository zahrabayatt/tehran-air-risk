import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  MISSES_IN_WEST_TILES, NOW_FRESH, NOW_LATE, NOW_STALE, TARGET, doc, empty, karajBad, lateV1, lateV2, normal, onTimeV1, stale, westGap,
} from './forecastFixtures';

const EXCLUDED = /\b(MSE|RMSE|L1|L2|Accuracy|Precision|Recall|F1|ROC-AUC|AUC|confusion matrix|hit rate)\b/i;

interface City {
  places: Array<{ id: string; name: string }>;
  hoods: Array<{ n: string; c: string }>;
}
const city = JSON.parse(readFileSync(resolve(process.cwd(), 'src/forecast/city.json'), 'utf8')) as City;
const hoodIndex = (square: string) => city.hoods.findIndex((h) => h.c === square);

/** Fix the page's clock before it loads (the page reads window.__TAR_NOW__; there is no address parameter). */
async function setNow(page: Page, now: string) {
  await page.addInitScript((t) => {
    window.__TAR_NOW__ = t;
  }, now);
}

/** Serve `body` as predictions.json, fix the clock, and open the Forecast page. */
async function open(page: Page, body: unknown, now = NOW_FRESH) {
  await page.route('**/data/predictions.json', (route) => route.fulfill({ json: body }));
  await setNow(page, now);
  await page.goto('#/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tehran air');
}

const placeSelect = (page: Page) => page.getByLabel('Air at');
const answer = (page: Page) => page.getByTestId('answer');
const square = (page: Page) => page.getByTestId('square');
const hood = (page: Page, i: number) => page.locator(`#citysvg path[data-hood="${i}"]`);
const tiles = (page: Page) => page.getByTestId('day-tile');
/** An SVG path can be tiny or partly covered, so the tap is sent to the element itself. */
const tap = (el: Locator) => el.dispatchEvent('click');

test.describe('Forecast page: the answer', () => {
  test('opens on Azadi Square: the day, the square, a plain answer and the chance in tens', async ({ page }) => {
    await open(page, normal());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tehran air tomorrow');
    await expect(placeSelect(page)).toHaveValue('p:azadi');
    await expect(square(page)).toHaveText('in the West Tehran square');
    await expect(page.getByTestId('day')).toHaveText('Thursday 5 November');
    await expect(answer(page)).toHaveText('Probably unhealthy');
    await expect(page.getByTestId('odds')).toHaveText('Chance of unhealthy air: about 8 in 10');
    await expect(page.locator('.dots i')).toHaveCount(10);
    await expect(page.locator('.dots i.on')).toHaveCount(8);
    await expect(page.getByTestId('late-badge')).toHaveCount(0);
  });

  test('the answer card holds no percent and no μg/m³', async ({ page }) => {
    await open(page, normal());
    const card = page.getByTestId('answer-card');
    await expect(card).toBeVisible();
    const text = (await card.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toContain('μg/m³');
    expect(text).not.toContain('%');
    expect(text).not.toMatch(/polluted/i);
  });

  test('picking a landmark sets the card, and the square is found from its coordinates', async ({ page }) => {
    await open(page, normal());
    await placeSelect(page).selectOption({ label: 'Shahr-e Rey' });
    await expect(square(page)).toHaveText('in the East Tehran square');
    await expect(answer(page)).toHaveText('Probably OK');
    await expect(page.getByTestId('odds')).toContainText('about 2 in 10');
    await placeSelect(page).selectOption({ label: 'Karaj' });
    await expect(square(page)).toHaveText('in the Northwest Alborz square');
    await placeSelect(page).selectOption({ label: 'Varamin' });
    await expect(square(page)).toHaveText('in the Southeast Plain square');
  });

  test('picking a neighbourhood sets the card, from the square its neighbourhood belongs to', async ({ page }) => {
    await open(page, normal());
    const i = hoodIndex('north-tehran');
    const name = city.hoods[i].n;
    await placeSelect(page).selectOption({ label: name });
    await expect(square(page)).toHaveText('in the North Tehran square');
    await expect(answer(page)).toHaveText('Probably OK');
    await expect(page.locator('#citysvg path.chosen')).toHaveCount(1);
    await expect(page.getByTestId('parts').locator('[data-cell="north-tehran"]')).toHaveClass(/sel/);
  });

  test('the list holds 7 landmarks and all 377 neighbourhoods', async ({ page }) => {
    await open(page, normal());
    await expect(page.locator('#place optgroup[label="Landmarks"] option')).toHaveCount(7);
    await expect(page.locator('#place optgroup[label="Neighbourhoods"] option')).toHaveCount(377);
  });

  test('CAMS agrees on a day both say Unhealthy, with no explanation to open', async ({ page }) => {
    await open(page, normal());
    await expect(page.getByTestId('cams')).toHaveText('CAMS, the European air forecast, agrees: unhealthy.');
    await expect(page.getByText('Why can they differ?')).toHaveCount(0);
  });

  test('CAMS disagrees: it says so and "Why can they differ?" names the weather the model reads', async ({ page }) => {
    await open(page, normal());
    await placeSelect(page).selectOption({ label: city.hoods[hoodIndex('north-tehran')].n });
    await expect(page.getByTestId('cams')).toContainText('disagrees: it expects unhealthy air here');
    await page.getByText('Why can they differ?').click();
    const t = page.getByTestId('cams');
    await expect(t).toContainText("today's air up to noon");
    await expect(t).toContainText('time of year');
    await expect(t).toContainText("tomorrow's weather forecast from ECMWF");
    await expect(t).toContainText('different sides');
  });

  test('"What counts as unhealthy?" says the line, and links the official forecast', async ({ page }) => {
    await open(page, normal());
    await page.getByText('What counts as unhealthy?').click();
    const link = page.getByRole('link', { name: 'airnow.tehran.ir' }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://airnow.tehran.ir/');
    await expect(page.locator('details', { hasText: 'What counts as unhealthy?' })).toContainText('35.4 μg/m³');
  });

  test('the footer links the official forecast and says it is not an official alert', async ({ page }) => {
    await open(page, normal());
    const foot = page.locator('.foot');
    await expect(foot).toContainText('not an official alert or medical advice');
    await expect(foot.getByRole('link', { name: 'airnow.tehran.ir' })).toHaveAttribute('href', 'https://airnow.tehran.ir/');
    await expect(foot).toContainText('OpenStreetMap');
  });
});

test.describe('Forecast page: the neighbourhood map', () => {
  test('draws 377 neighbourhoods and four seams, coloured by square, with a two-colour legend', async ({ page }) => {
    await open(page, normal());
    await expect(page.locator('#citysvg path[data-hood]')).toHaveCount(377);
    await expect(page.locator('#citysvg path.seams')).toHaveCount(1);
    // West Tehran is Unhealthy, East Tehran OK.
    await expect(hood(page, hoodIndex('west-tehran'))).toHaveClass(/t1/);
    await expect(hood(page, hoodIndex('east-tehran'))).toHaveClass(/t0/);
    const key = page.getByTestId('key');
    await expect(key).toContainText('OK');
    await expect(key).toContainText('Unhealthy');
    await expect(key).not.toContainText('quite sure');
    await expect(key.locator('i')).toHaveCount(2);
  });

  test('tapping a neighbourhood on the map sets the whole page', async ({ page }) => {
    await open(page, normal());
    const i = hoodIndex('east-tehran');
    await tap(hood(page, i));
    await expect(square(page)).toHaveText('in the East Tehran square');
    await expect(answer(page)).toHaveText('Probably OK');
    await expect(placeSelect(page)).toHaveValue(`h:${i}`);
    await expect(page.getByRole('heading', { name: 'The last 8 days in the East Tehran square' })).toBeVisible();
    await expect(page.locator('#citysvg path.chosen')).toHaveCount(1);
    const k = hoodIndex('north-tehran');
    await tap(hood(page, k));
    await expect(square(page)).toHaveText('in the North Tehran square');
    await expect(placeSelect(page)).toHaveValue(`h:${k}`);
  });

  test('draws from an embedded outline, with no map tiles and no outside request', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith('http://127.0.0.1')) external.push(req.url());
    });
    await open(page, normal());
    await expect(page.locator('main img')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(external).toEqual([]);
  });

  test('the four squares of the city say their word and chance, and the outside line names known towns', async ({ page }) => {
    await open(page, normal());
    const parts = page.getByTestId('parts');
    await expect(parts.locator('[data-cell]')).toHaveCount(4);
    await expect(parts.locator('[data-cell="west-tehran"]')).toContainText('174 neighbourhoods');
    await expect(parts.locator('[data-cell="west-tehran"]')).toContainText('Probably unhealthy');
    await expect(parts.locator('[data-cell="west-tehran"]')).toContainText('about 8 in 10');
    await expect(parts.locator('[data-cell="north-tehran"]')).toContainText('1 neighbourhood');
    await expect(page.getByTestId('around')).toHaveText('Outside the city, including Karaj, Damavand and Varamin: OK everywhere.');
  });

  test('names where it is unhealthy outside the city', async ({ page }) => {
    await open(page, karajBad());
    await expect(page.getByTestId('around')).toHaveText('Outside the city: unhealthy around Karaj; OK elsewhere.');
  });

  test('"Why one forecast for so many neighbourhoods?" explains the squares', async ({ page }) => {
    await open(page, normal());
    await page.getByText('Why one forecast for so many neighbourhoods?').click();
    await expect(page.locator('details', { hasText: 'Why one forecast' })).toContainText('about 44 by 36 km');
  });
});

test.describe('Forecast page: the last 8 days', () => {
  test('8 tiles, oldest first, each with the same rows, a mark and "made late" where it applies', async ({ page }) => {
    await open(page, normal());
    await expect(page.getByRole('heading', { name: 'The last 8 days in the West Tehran square' })).toBeVisible();
    await expect(tiles(page)).toHaveCount(8);
    await expect(tiles(page).first()).toContainText('Thu 29 Oct');
    await expect(tiles(page).last()).toContainText('Thu 5 Nov');
    await expect(tiles(page).first()).toContainText('Said');
    await expect(tiles(page).first()).toContainText('Was');
    // Two misses, four hits, a gap (no mark) and a day not over yet (no mark).
    await expect(page.locator('.day .mark.miss')).toHaveCount(MISSES_IN_WEST_TILES);
    await expect(page.locator('.day .mark.ok')).toHaveCount(4);
    await expect(tiles(page).nth(2)).toContainText('no forecast');
    await expect(tiles(page).last()).toContainText('not over');
    await expect(tiles(page).last().locator('.mark')).toHaveCount(0);
    // 4 November was made late.
    await expect(page.locator('.day .late', { hasText: 'made late' })).toHaveCount(1);
    await expect(tiles(page).nth(6)).toContainText('made late');
    await expect(page.locator('main')).toContainText('"Made late" marks a forecast made after its day had begun.');
  });

  test('every tile has the same height, so the rows line up', async ({ page }) => {
    await open(page, normal());
    const heights = await tiles(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
  });

  test('the tiles follow the chosen square', async ({ page }) => {
    await open(page, normal());
    await placeSelect(page).selectOption({ label: 'Shahr-e Rey' });
    await expect(page.getByRole('heading', { name: 'The last 8 days in the East Tehran square' })).toBeVisible();
    await expect(page.locator('.day .mark.miss')).toHaveCount(0);
  });
});

test.describe('Forecast page: made after the day began', () => {
  test('a version 2 forecast marked issued_late shows the badge and says "today"', async ({ page }) => {
    await open(page, lateV2(), NOW_LATE);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tehran air today');
    const badge = page.getByTestId('late-badge');
    await expect(badge).toHaveText('made after the day began');
    await expect(badge).toHaveAttribute('title', /Saved 5 November, 05:30 Tehran time/);
    await expect(tiles(page).last()).toContainText('made late');
  });

  test('a version 1 entry with no issued_late is late when issued after 20:30 UTC the day before', async ({ page }) => {
    await open(page, lateV1(), NOW_LATE);
    await expect(page.getByTestId('late-badge')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tehran air today');
  });

  test('a version 1 entry saved on time has no badge', async ({ page }) => {
    await open(page, onTimeV1());
    await expect(page.getByTestId('late-badge')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tehran air tomorrow');
    // A version 1 forecast is not described as reading weather.
    await placeSelect(page).selectOption({ label: city.hoods[hoodIndex('north-tehran')].n });
    await page.getByText('Why can they differ?').click();
    await expect(page.getByTestId('cams')).not.toContainText('ECMWF');
  });
});

test.describe('Forecast page: gap and stale', () => {
  test('a gap in the chosen square says so in words, shows no answer, and greys that square on the map', async ({ page }) => {
    await open(page, westGap());
    await expect(page.getByTestId('gap')).toContainText('No forecast for this square');
    await expect(page.getByTestId('gap')).toContainText('West Tehran square for Thursday 5 November');
    await expect(page.getByTestId('gap')).toContainText('ECMWF 00 UTC run not published yet');
    await expect(answer(page)).toHaveCount(0);
    await expect(page.getByTestId('odds')).toHaveCount(0);
    await expect(page.getByTestId('answer-card')).toHaveCount(0);
    await expect(hood(page, hoodIndex('west-tehran'))).toHaveClass(/tn/);
    await expect(hood(page, hoodIndex('east-tehran'))).toHaveClass(/t0/);
    await expect(page.getByTestId('key')).toContainText('No forecast');
    await expect(page.getByTestId('parts').locator('[data-cell="west-tehran"]')).toContainText('No forecast');
    // The other squares still answer.
    await tap(hood(page, hoodIndex('east-tehran')));
    await expect(answer(page)).toHaveText('Probably OK');
    // The gap day is a tile with no word said.
    await placeSelect(page).selectOption({ label: 'Azadi Square' });
    await expect(tiles(page).last()).toContainText('no forecast');
  });

  test('a forecast more than 48 hours old is replaced by a message, and the whole map is grey', async ({ page }) => {
    await open(page, stale(), NOW_STALE);
    await expect(page.getByTestId('stale')).toContainText('No current forecast');
    await expect(page.getByTestId('stale')).toContainText('more than 48 hours old');
    await expect(page.getByTestId('stale')).toContainText('4 November');
    await expect(answer(page)).toHaveCount(0);
    await expect(page.getByTestId('answer-card')).toHaveCount(0);
    await expect(page.locator('#citysvg path[data-hood].tn')).toHaveCount(377);
    await expect(page.locator('#citysvg path[data-hood].t0, #citysvg path[data-hood].t1')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tehran air');
  });

  test('exactly 48 hours old is still shown', async ({ page }) => {
    await open(page, normal(), '2026-11-06T10:30:00Z');
    await expect(answer(page)).toBeVisible();
  });

  test('no forecasts yet', async ({ page }) => {
    await open(page, empty());
    await expect(page.getByTestId('no-forecast')).toContainText('No forecasts yet');
    await expect(answer(page)).toHaveCount(0);
    await expect(tiles(page)).toHaveCount(0);
  });

  test('a file that cannot be read shows an error and a way to try again', async ({ page }) => {
    await setNow(page, NOW_FRESH);
    await page.route('**/data/predictions.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
    await page.goto('#/');
    await expect(page.getByRole('alert')).toContainText('The forecast did not load');
    await page.unroute('**/data/predictions.json');
    await page.route('**/data/predictions.json', (route) => route.fulfill({ json: normal() }));
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(answer(page)).toBeVisible();
  });

  test('an incomplete day (gap in every square) still loads the page', async ({ page }) => {
    const rows = normal().entries.map((e) => (e.target_date === TARGET ? { ...e, probability: null, predicted: null, gap: true, gap_reason: 'x', cams_forecast_pm25: null } : e));
    await open(page, doc(rows));
    await expect(page.getByTestId('gap')).toBeVisible();
    await expect(page.locator('#citysvg path[data-hood].tn')).toHaveCount(377);
  });
});

test.describe('Forecast page: words, phone and themes', () => {
  test('uses OK and Unhealthy, never "polluted", no excluded metric names, no em dash', async ({ page }) => {
    await open(page, normal());
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/polluted/i);
    expect(text).not.toMatch(EXCLUDED);
    expect(text).not.toContain('—');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`at 375px in the ${theme} theme: no sideways scroll, day tiles two per row, no serious accessibility violation`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('tar-theme', t), theme);
      await page.setViewportSize({ width: 375, height: 800 });
      await open(page, normal());
      await expect(page.locator('.app')).toHaveClass(theme === 'dark' ? /dark/ : /^((?!dark).)*$/);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      const boxes = await tiles(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) })));
      expect(boxes).toHaveLength(8);
      expect(boxes[0].y).toBe(boxes[1].y);
      expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
      expect(boxes[2].y).toBe(boxes[3].y);
      expect(new Set(boxes.map((b) => b.x)).size).toBe(2);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    });
  }
});
