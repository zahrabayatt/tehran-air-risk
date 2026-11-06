import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  CELL_IDS, GAPS_IN_WEST_LOG, MISSES_IN_WEST_LOG, NOW_FRESH, NOW_TWO_DAYS, bothAbove, bothBelow, eastGap, empty, mixed, stale,
  tomorrowGaps, twoDays,
} from './forecastFixtures';

const EXCLUDED = /\b(MSE|RMSE|L1|L2|Accuracy|Precision|Recall|F1|ROC-AUC|confusion matrix|hit rate)\b/i;

/** Serve `body` as predictions.json, fix the clock, and open the Forecast page. */
/** Fix the page's clock before it loads (the page reads window.__TAR_NOW__; there is no address parameter). */
async function setNow(page: Page, now: string) {
  await page.addInitScript((t) => {
    window.__TAR_NOW__ = t;
  }, now);
}

async function open(page: Page, body: unknown, now = NOW_FRESH) {
  await page.route('**/data/predictions.json', (route) => route.fulfill({ json: body }));
  await setNow(page, now);
  await page.goto('#/');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Forecast');
}

const squares = (page: Page) => page.getByRole('group', { name: 'Forecast squares' }).getByRole('button');
const square = (page: Page, name: string) => page.getByRole('group', { name: 'Forecast squares' }).getByRole('button', { name: new RegExp(`^${name}:`) });
const layerButton = (page: Page, name: string) => page.getByRole('group', { name: 'Map layer' }).getByRole('button', { name });
const placeSelect = (page: Page) => page.getByLabel('Check a place');
const logRows = (page: Page) => page.getByRole('table', { name: /past forecasts/i }).locator('tbody tr');

test.describe('map squares', () => {
  test('there are 12 squares, each a button with a pressed state and a name', async ({ page }) => {
    await open(page, bothAbove());
    await expect(squares(page)).toHaveCount(12);
    for (let i = 0; i < 12; i++) {
      const b = squares(page).nth(i);
      await expect(b).toHaveAttribute('aria-pressed', /true|false/);
      await expect(b).toHaveAttribute('data-cell', CELL_IDS[i]);
      expect(((await b.getAttribute('aria-label')) ?? '').length).toBeGreaterThan(10);
    }
    await expect(page.locator('[data-cell][aria-pressed="true"]')).toHaveCount(1);
  });

  test('every square can be reached with Tab and chosen with Enter or Space', async ({ page }) => {
    await open(page, bothAbove());
    await expect(square(page, 'East Tehran')).toHaveAttribute('aria-pressed', 'false');
    // Tab through the page until focus reaches the first square, then walk the 12.
    await squares(page).first().focus();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      seen.push((await page.evaluate(() => document.activeElement?.getAttribute('data-cell') ?? '')) as string);
      await page.keyboard.press('Tab');
    }
    expect(seen).toEqual(CELL_IDS);
    await square(page, 'East Tehran').focus();
    await page.keyboard.press('Enter');
    await expect(square(page, 'East Tehran')).toHaveAttribute('aria-pressed', 'true');
    await square(page, 'Far East').focus();
    await page.keyboard.press('Space');
    await expect(square(page, 'Far East')).toHaveAttribute('aria-pressed', 'true');
    await expect(square(page, 'East Tehran')).toHaveAttribute('aria-pressed', 'false');
  });

  test('the squares show the model chance, and say each shares one forecast over about 44 by 36 km', async ({ page }) => {
    await open(page, bothAbove());
    await expect(square(page, 'West Tehran')).toContainText('91%');
    await expect(square(page, 'East Tehran')).toContainText('75%');
    await expect(square(page, 'North Tehran')).toContainText('5%');
    const note = page.getByTestId('map-note');
    await expect(note).toContainText('about 44 by 36 km');
    await expect(note).toContainText('Everywhere inside it shares one forecast');
    await expect(page.locator('main')).not.toContainText('45 km');
  });

  test('draws Tehran from an embedded outline, with no map tiles', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (req) => {
      if (!req.url().startsWith('http://127.0.0.1')) external.push(req.url());
    });
    await open(page, bothAbove());
    await expect(page.locator('svg[data-testid="outline"] path[data-outline]')).toHaveCount(1);
    await expect(page.locator('main img')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(external).toEqual([]);
  });
});

test.describe('place selector', () => {
  test('starts on Azadi Square in West Tehran', async ({ page }) => {
    await open(page, bothAbove());
    await expect(placeSelect(page)).toHaveValue('azadi');
    await expect(square(page, 'West Tehran')).toHaveAttribute('aria-pressed', 'true');
  });

  test('choosing a place selects its cell, found from its coordinates (Shahr-e Rey is East Tehran)', async ({ page }) => {
    await open(page, bothAbove());
    await placeSelect(page).selectOption({ label: 'Shahr-e Rey' });
    await expect(square(page, 'East Tehran')).toHaveAttribute('aria-pressed', 'true');
    await expect(square(page, 'West Tehran')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('cell-card')).toContainText('Shahr-e Rey is in the East Tehran square');
    await placeSelect(page).selectOption({ label: 'Karaj' });
    await expect(square(page, 'Northwest Alborz')).toHaveAttribute('aria-pressed', 'true');
    await placeSelect(page).selectOption({ label: 'Varamin' });
    await expect(square(page, 'Southeast Plain')).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking a square clears the place selector', async ({ page }) => {
    await open(page, bothAbove());
    await expect(placeSelect(page)).toHaveValue('azadi');
    await square(page, 'Far East').click();
    await expect(placeSelect(page)).toHaveValue('');
    await expect(square(page, 'Far East')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cell-card')).toContainText('Far East');
  });
});

test.describe('layers', () => {
  test('the CAMS layer is labelled with 35.4 and shows CAMS values, display only', async ({ page }) => {
    await open(page, bothAbove());
    const legend = page.getByTestId('legend');
    await expect(legend).toContainText('35.4 μg/m³');
    await layerButton(page, 'CAMS forecast').click();
    await expect(layerButton(page, 'CAMS forecast')).toHaveAttribute('aria-pressed', 'true');
    await expect(layerButton(page, 'Model chance')).toHaveAttribute('aria-pressed', 'false');
    await expect(legend).toContainText('35.4 μg/m³');
    await expect(legend).toContainText('not used by the model');
    await expect(square(page, 'West Tehran')).toContainText('41.3');
    await expect(square(page, 'West Tehran')).toHaveAttribute('aria-label', /41\.3 Above\. CAMS forecast in micrograms per cubic metre, compared with 35\.4/);
    await expect(square(page, 'North Tehran')).toHaveAttribute('aria-label', /Below\. CAMS forecast.*35\.4/);
    await layerButton(page, 'Model chance').click();
    await expect(square(page, 'West Tehran')).toContainText('91%');
  });
});

test.describe('city headline', () => {
  test('both above', async ({ page }) => {
    await open(page, bothAbove());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Wednesday 4 November: likely above 35.4 μg/m³ in both West Tehran and East Tehran',
    );
    await expect(page.getByTestId('city-sub')).toContainText('West Tehran 91%, East Tehran 75%');
  });

  test('both below', async ({ page }) => {
    await open(page, bothBelow());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Wednesday 4 November: likely below 35.4 μg/m³ in both West Tehran and East Tehran',
    );
  });

  test('mixed', async ({ page }) => {
    await open(page, mixed());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Wednesday 4 November: mixed, likely above 35.4 μg/m³ in West Tehran and below in East Tehran',
    );
  });

  test('names the target date and shows when the forecast was last updated, in Tehran time', async ({ page }) => {
    await open(page, bothAbove());
    await expect(page.getByTestId('forecast-meta')).toContainText('Forecast for Wednesday 4 November');
    await expect(page.getByTestId('updated')).toHaveText('Updated 3 November, 13:35 Tehran time');
    await expect(page.getByTestId('updated').locator('time')).toHaveAttribute('datetime', '2026-11-03T10:05:00Z');
  });

  test('the selected square shows a model estimate against the 35.4 threshold, not an official alert', async ({ page }) => {
    await open(page, bothAbove());
    const card = page.getByTestId('cell-card');
    await expect(card).toContainText('91%');
    await expect(card).toContainText('a model estimate');
    await expect(card).toContainText('35.4 μg/m³');
    await expect(card).toContainText('PM2.5 so far today, time of year');
    await expect(page.locator('main')).toContainText('not an official alert or medical advice');
    await expect(page.locator('main')).toContainText('modelled air, not readings from Tehran');
    await expect(page.locator('main')).not.toContainText(/unhealthy|EPA/i);
  });

  test('the page title and meta description make no health-category claim either', async ({ page }) => {
    await open(page, bothAbove());
    const title = await page.title();
    const description = (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
    expect(title).toBe('Tehran Air Risk: Forecast');
    expect(description).toContain('35.4 μg/m³');
    expect(`${title} ${description}`).not.toMatch(/unhealthy|EPA/i);
  });
});

test.describe('gaps', () => {
  test('a cell with a gap says no forecast and never shows a number', async ({ page }) => {
    await open(page, eastGap());
    await expect(square(page, 'East Tehran')).toContainText('No forecast');
    await expect(square(page, 'East Tehran')).not.toContainText(/\d/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('no forecast for East Tehran');
    await expect(page.getByTestId('city-sub')).not.toContainText(/East Tehran \d/);
    await square(page, 'East Tehran').click();
    const card = page.getByTestId('cell-card');
    await expect(card).toContainText('No forecast for this square');
    await expect(card).not.toContainText('%');
    await layerButton(page, 'CAMS forecast').click();
    await expect(square(page, 'East Tehran')).toContainText('No forecast');
    await expect(square(page, 'East Tehran')).not.toContainText(/\d/);
  });
});

test.describe('forecast log', () => {
  test('shows the last 14 target dates for the selected square, newest first', async ({ page }) => {
    await open(page, bothAbove());
    await expect(logRows(page)).toHaveCount(14);
    await expect(logRows(page).first()).toContainText('Wed 4 Nov');
    await expect(logRows(page).last()).toContainText('Thu 22 Oct');
    await expect(page.getByRole('table', { name: /past forecasts/i })).not.toContainText('21 Oct');
    await expect(page.getByTestId('log-title')).toContainText('West Tehran');
  });

  test('misses are marked, matches too, pending outcomes say pending and gaps say no forecast', async ({ page }) => {
    await open(page, bothAbove());
    await expect(logRows(page).filter({ hasText: 'Miss' })).toHaveCount(MISSES_IN_WEST_LOG);
    const miss = logRows(page).filter({ hasText: 'Sat 24 Oct' });
    await expect(miss).toContainText('71%');
    await expect(miss).toContainText('▲ Above');
    await expect(miss).toContainText('▼ Below');
    await expect(miss).toContainText('Miss');
    await expect(miss).toHaveAttribute('data-verdict', 'miss');
    await expect(logRows(page).filter({ hasText: 'Tue 27 Oct' })).toHaveAttribute('data-verdict', 'miss');
    await expect(logRows(page).filter({ hasText: 'Tue 3 Nov' })).toHaveAttribute('data-verdict', 'match');
    await expect(logRows(page).first()).toContainText('Pending');
    await expect(logRows(page).first()).toHaveAttribute('data-verdict', 'pending');
    const gaps = logRows(page).filter({ hasText: 'No forecast' });
    await expect(gaps).toHaveCount(GAPS_IN_WEST_LOG);
    await expect(gaps).toHaveAttribute('data-verdict', 'none');
    await expect(gaps).not.toContainText('%');
    await expect(gaps).not.toContainText(/Match|Miss/);
  });

  test('follows the selected square and shows no summary percentage or excluded metric', async ({ page }) => {
    await open(page, bothAbove());
    await square(page, 'East Tehran').click();
    await expect(page.getByTestId('log-title')).toContainText('East Tehran');
    await expect(logRows(page)).toHaveCount(14);
    await expect(logRows(page).filter({ hasText: 'Miss' })).toHaveCount(0);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(EXCLUDED);
    expect(text).not.toMatch(/\b\d+ (of|out of) \d+ (forecasts|days)\b/i);
    expect(text).not.toMatch(/\b(hits?|correct)\b/i);
  });
});

const dayGroup = (page: Page) => page.getByRole('group', { name: 'Forecast day' });
const dayButton = (page: Page, name: string) => dayGroup(page).getByRole('button', { name });
const TODAY = 'Today · Wed 4 Nov';
const TOMORROW = 'Tomorrow · Thu 5 Nov';
const H1_TOMORROW = 'Thursday 5 November: likely below 35.4 μg/m³ in both West Tehran and East Tehran';
const H1_TODAY = 'Wednesday 4 November: mixed, likely above 35.4 μg/m³ in West Tehran and below in East Tehran';

test.describe('day switch', () => {
  test('two forecast days give a labelled group of two pressed buttons, today first', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    await expect(dayGroup(page)).toBeVisible();
    await expect(dayGroup(page).getByRole('button')).toHaveText([TODAY, TOMORROW]);
    for (const b of await dayGroup(page).getByRole('button').all()) await expect(b).toHaveAttribute('aria-pressed', /true|false/);
    await expect(page.getByRole('group', { name: 'Map layer' })).toBeVisible();
  });

  test('opens on tomorrow, the latest day: headline, updated time, tiles and card all describe it', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    await expect(dayButton(page, TOMORROW)).toHaveAttribute('aria-pressed', 'true');
    await expect(dayButton(page, TODAY)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H1_TOMORROW);
    await expect(page.getByTestId('city-sub')).toContainText('West Tehran 8%, East Tehran 20%');
    await expect(page.getByTestId('forecast-meta')).toContainText('Forecast for Thursday 5 November');
    await expect(page.getByTestId('updated')).toHaveText('Updated 4 November, 19:37 Tehran time');
    await expect(page.getByTestId('updated').locator('time')).toHaveAttribute('datetime', '2026-11-04T16:07:00Z');
    await expect(square(page, 'West Tehran')).toContainText('8%');
    await expect(page.getByTestId('cell-card')).toContainText('8%');
    await expect(page.getByTestId('day-ended')).toHaveCount(0);
  });

  test('says on the map which day it shows', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    await expect(page.getByTestId('map-day')).toContainText(TOMORROW);
    await dayButton(page, TODAY).click();
    await expect(page.getByTestId('map-day')).toContainText(TODAY);
  });

  test('switching to today changes the headline, the updated time, the tiles in both layers and the card', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    await dayButton(page, TODAY).click();
    await expect(dayButton(page, TODAY)).toHaveAttribute('aria-pressed', 'true');
    await expect(dayButton(page, TOMORROW)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H1_TODAY);
    await expect(page.getByTestId('city-sub')).toContainText('West Tehran 82%, East Tehran 20%');
    await expect(page.getByTestId('forecast-meta')).toContainText('Forecast for Wednesday 4 November');
    await expect(page.getByTestId('updated')).toHaveText('Updated 3 November, 13:35 Tehran time');
    await expect(square(page, 'West Tehran')).toContainText('82%');
    await expect(square(page, 'West Tehran')).toContainText('Above');
    await expect(square(page, 'North Tehran')).toContainText('5%');
    const card = page.getByTestId('cell-card');
    await expect(card).toContainText('82%');
    await expect(card).toContainText('Likely above 35.4 μg/m³');
    await expect(card).toContainText('41.3 μg/m³');
    await layerButton(page, 'CAMS forecast').click();
    await expect(square(page, 'West Tehran')).toContainText('41.3');
    await expect(square(page, 'North Tehran')).toContainText('12.5');
    await dayButton(page, TOMORROW).click();
    await expect(square(page, 'West Tehran')).toContainText('18.2');
    await expect(square(page, 'North Tehran')).toContainText('9.5');
    await expect(card).toContainText('18.2 μg/m³');
    await layerButton(page, 'Model chance').click();
    await expect(square(page, 'West Tehran')).toContainText('8%');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H1_TOMORROW);
  });

  test('is keyboard operable: Enter and Space press the buttons, Tab moves between them', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    await dayButton(page, TODAY).focus();
    await page.keyboard.press('Enter');
    await expect(dayButton(page, TODAY)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(dayButton(page, TOMORROW)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(dayButton(page, TOMORROW)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H1_TOMORROW);
  });

  test('the place and the chosen square stay put across a day switch', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    await expect(placeSelect(page)).toHaveValue('azadi');
    await dayButton(page, TODAY).click();
    await expect(placeSelect(page)).toHaveValue('azadi');
    await expect(square(page, 'West Tehran')).toHaveAttribute('aria-pressed', 'true');
    await placeSelect(page).selectOption({ label: 'Shahr-e Rey' });
    const place = await placeSelect(page).inputValue();
    await dayButton(page, TOMORROW).click();
    await expect(placeSelect(page)).toHaveValue(place);
    await expect(square(page, 'East Tehran')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('cell-card')).toContainText('Shahr-e Rey is in the East Tehran square');
    await square(page, 'Far East').click();
    await dayButton(page, TODAY).click();
    await expect(square(page, 'Far East')).toHaveAttribute('aria-pressed', 'true');
    await expect(placeSelect(page)).toHaveValue('');
    await expect(page.getByTestId('cell-card')).toContainText('Far East');
    await expect(page.locator('[data-cell][aria-pressed="true"]')).toHaveCount(1);
  });

  test('the forecast log does not change with the day', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    const rows = await logRows(page).allInnerTexts();
    expect(rows).toHaveLength(14);
    await dayButton(page, TODAY).click();
    expect(await logRows(page).allInnerTexts()).toEqual(rows);
    await expect(logRows(page).first()).toContainText('Thu 5 Nov');
  });

  test('a day with only gaps is still offered and shows no-forecast squares, never a number', async ({ page }) => {
    await open(page, tomorrowGaps(), NOW_TWO_DAYS);
    await expect(dayGroup(page).getByRole('button')).toHaveText([TODAY, TOMORROW]);
    await expect(dayButton(page, TOMORROW)).toHaveAttribute('aria-pressed', 'true');
    await expect(squares(page)).toHaveCount(12);
    for (let i = 0; i < 12; i++) {
      await expect(squares(page).nth(i)).toContainText('No forecast');
      await expect(squares(page).nth(i)).not.toContainText(/\d/);
    }
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Thursday 5 November');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('no forecast for West Tehran or East Tehran');
    await expect(page.getByTestId('cell-card')).toContainText('No forecast for this square');
    await dayButton(page, TODAY).click();
    await expect(square(page, 'West Tehran')).toContainText('91%');
    await expect(page.getByTestId('cell-card')).toContainText('91%');
  });

  test('one forecast day: no switch, and the page is as before', async ({ page }) => {
    await open(page, bothAbove(), NOW_FRESH);
    await expect(dayGroup(page)).toHaveCount(0);
    await expect(page.getByTestId('map-day')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Map layer' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Wednesday 4 November: likely above 35.4 μg/m³ in both West Tehran and East Tehran',
    );
  });

  test('a day that has ended is not offered: one day left means no switch and no ended note', async ({ page }) => {
    await open(page, twoDays(), '2026-11-04T20:30:00Z'); // 00:00 on 5 November in Tehran
    await expect(dayGroup(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H1_TOMORROW);
    await expect(page.getByTestId('day-ended')).toHaveCount(0);
  });

  test('one second before the day ends, both days are still offered', async ({ page }) => {
    await open(page, twoDays(), '2026-11-04T20:29:59Z');
    await expect(dayGroup(page).getByRole('button')).toHaveText([TODAY, TOMORROW]);
  });

  test('after midnight the next day is labelled Today', async ({ page }) => {
    const body = twoDays();
    // The 4th has ended; the 5th is today and a 6th is added, so there are two days again.
    body.entries.push(...body.entries.filter((e) => e.target_date === '2026-11-05').map((e) => ({ ...e, target_date: '2026-11-06' })));
    await open(page, body, '2026-11-04T21:00:00Z');
    await expect(dayGroup(page).getByRole('button')).toHaveText(['Today · Thu 5 Nov', 'Tomorrow · Fri 6 Nov']);
  });

  test('when every day has ended, the last forecast is shown with the ended note and no switch', async ({ page }) => {
    await open(page, twoDays(), '2026-11-05T21:00:00Z'); // 00:30 on 6 November in Tehran, 29 hours after the run
    await expect(dayGroup(page)).toHaveCount(0);
    await expect(squares(page)).toHaveCount(12);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(H1_TOMORROW);
    await expect(page.getByTestId('day-ended')).toContainText('Thursday 5 November has ended in Tehran');
  });

  test('a stale file hides the map and the switch, as before', async ({ page }) => {
    await open(page, twoDays(), '2026-11-07T00:00:00Z');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No current forecast');
    await expect(dayGroup(page)).toHaveCount(0);
  });

  test('keeps the copy rules on both days', async ({ page }) => {
    await open(page, twoDays(), NOW_TWO_DAYS);
    for (const day of [TOMORROW, TODAY]) {
      await dayButton(page, day).click();
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(EXCLUDED);
      expect(text).not.toMatch(/unhealthy|EPA/i);
      expect(text).toContain('above 35.4 μg/m³');
      expect(text).toContain('about 44 by 36 km');
      expect(text).toMatch(/model estimate/i);
    }
  });
});

test.describe('delayed runs and finished days', () => {
  test('a day that has ended in Tehran, with a forecast not yet stale, says so', async ({ page }) => {
    await open(page, bothAbove(), '2026-11-04T21:00:00Z'); // 00:30 on 5 November in Tehran
    await expect(squares(page)).toHaveCount(12);
    await expect(page.getByTestId('day-ended')).toContainText('Wednesday 4 November has ended in Tehran');
  });

  test('no such line while the target day is still to come or under way', async ({ page }) => {
    await open(page, bothAbove(), NOW_FRESH);
    await expect(page.getByTestId('day-ended')).toHaveCount(0);
  });

  test('the log title does not promise every forecast was saved before its day, and marks one saved after it began', async ({ page }) => {
    const body = bothAbove();
    const west = body.entries.find((e) => e.cell_id === 'west-tehran' && e.target_date === '2026-11-03')!;
    west.issued_at = '2026-11-03T09:00:00Z'; // a manual run during the day itself
    await open(page, body);
    await expect(page.getByTestId('log-title')).toContainText('Usually saved before the day begins');
    await expect(page.getByTestId('issued-late')).toHaveCount(1);
    await expect(logRows(page).filter({ hasText: 'Tue 3 Nov' })).toContainText('saved after the day began');
  });
});

test.describe('stale and empty', () => {
  test('a forecast older than 48 hours is replaced by a message, the map is hidden, the log stays', async ({ page }) => {
    await open(page, stale());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No current forecast');
    await expect(page.getByRole('alert')).toContainText('more than 48 hours old');
    await expect(page.getByRole('alert')).toContainText('Last run: 29 October');
    await expect(page.getByRole('group', { name: 'Forecast squares' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Map layer' })).toHaveCount(0);
    await expect(page.getByTestId('cell-card')).toHaveCount(0);
    await expect(page.getByTestId('city-sub')).toHaveCount(0);
    await expect(page.getByRole('table', { name: /past forecasts/i })).toBeVisible();
    await expect(logRows(page)).toHaveCount(1);
    await expect(logRows(page).first()).toContainText('Fri 30 Oct');
  });

  test('a forecast exactly 48 hours old is still current', async ({ page }) => {
    await open(page, bothAbove(), '2026-11-05T10:05:00Z');
    await expect(squares(page)).toHaveCount(12);
  });

  test('an empty predictions file explains that no forecasts exist yet', async ({ page }) => {
    await open(page, empty());
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No forecasts yet');
    await expect(page.locator('main')).toContainText('nothing to show');
    await expect(page.getByRole('group', { name: 'Forecast squares' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: /past forecasts/i })).toHaveCount(0);
    await expect(page.getByTestId('log-empty')).toContainText('No forecasts have been recorded yet');
  });

  test('a predictions file that cannot be read shows a clear message and a retry', async ({ page }) => {
    await page.route('**/data/predictions.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
    await setNow(page, NOW_FRESH);
    await page.goto('#/');
    await expect(page.getByRole('alert')).toContainText('The forecast did not load');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('real predictions.json', () => {
  test('the file the daily run committed shows 12 squares and a headline', async ({ page }) => {
    const real = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'data', 'predictions.json'), 'utf8'));
    test.skip(real.entries.length === 0, 'no forecasts have been issued yet');
    const latest = real.entries.map((e: { issued_at: string }) => e.issued_at).sort().at(-1) as string;
    const now = new Date(Date.parse(latest) + 3_600_000).toISOString();
    await setNow(page, now);
    await page.goto('#/');
    await expect(squares(page)).toHaveCount(12);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/West Tehran/);
  });
});

for (const theme of ['dark', 'light'] as const) {
  async function themed(page: Page, body: unknown) {
    await open(page, body);
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Switch to light theme' }).click();
      await expect(page.locator('.app')).not.toHaveClass(/dark/);
    }
    await page.waitForLoadState('networkidle');
  }
  const serious = async (page: Page) => {
    const results = await new AxeBuilder({ page }).analyze();
    return results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  };

  test.describe(`${theme} theme`, () => {
    test('no serious or critical accessibility violations: model layer, 1280px', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await themed(page, bothAbove());
      expect(await serious(page)).toEqual([]);
    });

    test('no serious or critical accessibility violations: CAMS layer with a miss selected, 1280px', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await themed(page, mixed());
      await layerButton(page, 'CAMS forecast').click();
      await square(page, 'East Tehran').click();
      expect(await serious(page)).toEqual([]);
    });

    test('no serious or critical accessibility violations: a square with no forecast, 1280px', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await themed(page, eastGap());
      expect(await serious(page)).toEqual([]);
    });

    test('no serious or critical accessibility violations: stale, 390px', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await themed(page, stale());
      expect(await serious(page)).toEqual([]);
    });

    test('no serious or critical accessibility violations: empty, 1280px', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await themed(page, empty());
      expect(await serious(page)).toEqual([]);
    });

    test('phone width: no sideways scroll, no serious violations, and the answer comes first', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await themed(page, bothAbove());
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      const h1 = await page.getByRole('heading', { level: 1 }).boundingBox();
      const map = await page.getByRole('group', { name: 'Forecast squares' }).boundingBox();
      const date = await page.getByTestId('forecast-meta').boundingBox();
      expect(h1 && map && date).toBeTruthy();
      // Date, then the headline, then the map; the headline is on the first screen.
      expect(date!.y).toBeLessThan(h1!.y);
      expect(h1!.y + h1!.height).toBeLessThan(844);
      expect(h1!.y + h1!.height).toBeLessThanOrEqual(map!.y);
      // The map fits the screen width.
      expect(map!.x).toBeGreaterThanOrEqual(0);
      expect(map!.x + map!.width).toBeLessThanOrEqual(390);
      expect(await serious(page)).toEqual([]);
    });

    test('no serious or critical accessibility violations: the day switch on both days, 1280px', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, twoDays(), NOW_TWO_DAYS);
      if (theme === 'light') {
        await page.getByRole('button', { name: 'Switch to light theme' }).click();
        await expect(page.locator('.app')).not.toHaveClass(/dark/);
      }
      await expect(dayGroup(page)).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await dayButton(page, TODAY).click();
      await layerButton(page, 'CAMS forecast').click();
      expect(await serious(page)).toEqual([]);
    });

    test('phone width: the day switch fits, nothing scrolls sideways, no serious violations', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, twoDays(), NOW_TWO_DAYS);
      if (theme === 'light') {
        await page.getByRole('button', { name: 'Switch to light theme' }).click();
        await expect(page.locator('.app')).not.toHaveClass(/dark/);
      }
      await expect(dayGroup(page)).toBeVisible();
      for (const name of [TODAY, TOMORROW]) {
        const box = await dayButton(page, name).boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const g = await dayGroup(page).boundingBox();
      expect(g!.x + g!.width).toBeLessThanOrEqual(390);
      const fits = () =>
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(await fits()).toBe(true);
      expect(await serious(page)).toEqual([]);
      await dayButton(page, TODAY).click();
      expect(await fits()).toBe(true);
    });

    test('phone width: the long mixed headline and the log do not scroll the page sideways', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await themed(page, mixed());
      await square(page, 'West Tehran').click();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });
}
