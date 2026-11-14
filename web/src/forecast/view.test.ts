import { describe, expect, it } from 'vitest';
import city from './city.json';
import type { Entry } from './types';
import {
  answer, chanceInTen, chanceText, currentEntries, isLate, lastDays, outsideLine, pageTitle, squareFor, whyDiffer,
} from './view';

const CELLS = city.cells.map((c) => c.id);
const CITY_SQUARES = ['west-tehran', 'east-tehran', 'north-tehran', 'northeast-tehran'];

function e(target: string, cell: string, p: number | null, over: Partial<Entry> = {}): Entry {
  const prev = new Date(`${target}T10:30:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return {
    issued_at: prev.toISOString().replace('.000Z', 'Z'),
    target_date: target,
    cell_id: cell,
    probability: p,
    predicted: p === null ? null : p >= 0.5 ? 1 : 0,
    model_version: 2,
    outcome: null,
    outcome_mean_pm25: null,
    gap: p === null,
    gap_reason: p === null ? 'ECMWF 00 UTC run not published yet' : null,
    cams_forecast_pm25: p === null ? null : 20,
    ...over,
  };
}

describe('chanceInTen', () => {
  it('rounds to a whole number from 0 to 10', () => {
    expect(chanceInTen(0)).toBe(0);
    expect(chanceInTen(0.05)).toBe(1);
    expect(chanceInTen(0.049)).toBe(0);
    expect(chanceInTen(0.2)).toBe(2);
    expect(chanceInTen(0.5)).toBe(5);
    expect(chanceInTen(0.96)).toBe(10);
    expect(chanceInTen(1)).toBe(10);
  });
  it('never leaves 0 to 10', () => {
    expect(chanceInTen(-0.3)).toBe(0);
    expect(chanceInTen(1.4)).toBe(10);
  });
});

describe('chanceText', () => {
  it('says "about N in 10", and does not claim a certainty', () => {
    expect(chanceText(0.2)).toBe('about 2 in 10');
    expect(chanceText(0.05)).toBe('about 1 in 10');
    expect(chanceText(0.01)).toBe('less than 1 in 10');
    expect(chanceText(0.97)).toBe('more than 9 in 10');
  });
});

describe('answer', () => {
  it('is Unhealthy from 0.5 up and OK below', () => {
    expect(answer(0.5)).toBe('Unhealthy');
    expect(answer(0.4999)).toBe('OK');
    expect(answer(0.9)).toBe('Unhealthy');
    expect(answer(0)).toBe('OK');
  });
});

describe('squareFor', () => {
  it('finds a landmark by its coordinates', () => {
    expect(squareFor('p:azadi')).toBe('west-tehran');
    expect(squareFor('p:rey')).toBe('east-tehran');
    expect(squareFor('p:karaj')).toBe('northwest-alborz');
    expect(squareFor('p:varamin')).toBe('southeast-plain');
    expect(squareFor('p:damavand')).toBe('far-east');
  });
  it('takes a neighbourhood from its own square, c', () => {
    city.hoods.forEach((h, i) => expect(squareFor(`h:${i}`)).toBe(h.c));
  });
  it('also knows a landmark or neighbourhood by name', () => {
    expect(squareFor('Azadi Square')).toBe('west-tehran');
    expect(squareFor(city.hoods[0].n)).toBe(city.hoods[0].c);
  });
  it('refuses a name it does not know', () => {
    expect(() => squareFor('p:nowhere')).toThrow();
    expect(() => squareFor('Atlantis')).toThrow();
  });
  it('every landmark falls in one of the 12 squares', () => {
    for (const p of city.places) expect(CELLS).toContain(squareFor(`p:${p.id}`));
  });
});

describe('isLate', () => {
  it('uses issued_late when the entry carries it', () => {
    expect(isLate(e('2026-11-05', 'west-tehran', 0.3, { issued_late: true }))).toBe(true);
    expect(isLate(e('2026-11-05', 'west-tehran', 0.3, { issued_late: false, issued_at: '2026-11-05T01:00:00Z' }))).toBe(false);
  });
  it('derives it when absent: issued after 20:30 UTC on the day before the target', () => {
    expect(isLate(e('2026-11-05', 'west-tehran', 0.3, { issued_at: '2026-11-04T20:30:00Z' }))).toBe(false);
    expect(isLate(e('2026-11-05', 'west-tehran', 0.3, { issued_at: '2026-11-04T20:30:01Z' }))).toBe(true);
    expect(isLate(e('2026-11-05', 'west-tehran', 0.3, { issued_at: '2026-11-05T05:00:00Z' }))).toBe(true);
    expect(isLate(e('2026-11-05', 'west-tehran', 0.3, { issued_at: '2026-11-04T10:30:00Z' }))).toBe(false);
  });
});

describe('lastDays', () => {
  const entries = [
    e('2026-10-28', 'west-tehran', 0.9, { outcome: 1 }),
    e('2026-10-29', 'west-tehran', 0.2, { outcome: 1 }),
    e('2026-10-30', 'west-tehran', null, { outcome: 0 }),
    e('2026-10-31', 'west-tehran', 0.55, { outcome: 0 }),
    e('2026-11-01', 'west-tehran', 0.05, { outcome: 0 }),
    e('2026-11-02', 'west-tehran', 0.1, { outcome: 0 }),
    e('2026-11-03', 'west-tehran', 0.1, { outcome: 0 }),
    e('2026-11-04', 'west-tehran', 0.3, { outcome: 0 }),
    e('2026-11-05', 'west-tehran', 0.6, { issued_late: true }),
    e('2026-11-05', 'east-tehran', 0.1),
  ];
  it('returns the last 8 days of one square, oldest first', () => {
    const t = lastDays(entries, 'west-tehran');
    expect(t).toHaveLength(8);
    expect(t.map((x) => x.date)).toEqual([
      '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05',
    ]);
  });
  it('says, was, right: a miss, a hit, a day not over yet', () => {
    const t = lastDays(entries, 'west-tehran');
    expect(t[0]).toEqual({ date: '2026-10-29', said: 'OK', was: 'Unhealthy', right: false, late: false });
    expect(t[2]).toEqual({ date: '2026-10-31', said: 'Unhealthy', was: 'OK', right: false, late: false });
    expect(t[3].right).toBe(true);
    expect(t[7]).toEqual({ date: '2026-11-05', said: 'Unhealthy', was: null, right: null, late: true });
  });
  it('a gap says nothing and is neither right nor wrong', () => {
    const gap = lastDays(entries, 'west-tehran')[1];
    expect(gap).toEqual({ date: '2026-10-30', said: null, was: 'OK', right: null, late: false });
  });
  it('p 0.05 reads as a forecast of OK, 0.5 as Unhealthy', () => {
    const t = lastDays(entries, 'west-tehran');
    expect(t[3].said).toBe('OK');
    expect(lastDays([e('2026-11-05', 'west-tehran', 0.5)], 'west-tehran')[0].said).toBe('Unhealthy');
  });
  it('shows fewer when fewer exist, honours n, and keeps the newest of two entries for a day', () => {
    expect(lastDays(entries, 'east-tehran')).toHaveLength(1);
    expect(lastDays(entries, 'west-tehran', 3)).toHaveLength(3);
    expect(lastDays([], 'west-tehran')).toEqual([]);
    const twice = [
      e('2026-11-05', 'west-tehran', 0.1, { issued_at: '2026-11-04T10:30:00Z' }),
      e('2026-11-05', 'west-tehran', 0.9, { issued_at: '2026-11-04T14:30:00Z' }),
    ];
    expect(lastDays(twice, 'west-tehran')).toHaveLength(1);
    expect(lastDays(twice, 'west-tehran')[0].said).toBe('Unhealthy');
  });
});

describe('currentEntries', () => {
  it('the newest entry per square for one target date', () => {
    const m = currentEntries(
      [
        e('2026-11-05', 'west-tehran', 0.1, { issued_at: '2026-11-04T10:30:00Z' }),
        e('2026-11-05', 'west-tehran', 0.9, { issued_at: '2026-11-04T12:30:00Z' }),
        e('2026-11-04', 'west-tehran', 0.3),
      ],
      '2026-11-05',
    );
    expect(m.size).toBe(1);
    expect(m.get('west-tehran')?.probability).toBe(0.9);
  });
});

describe('outsideLine', () => {
  const everyone = (p: number | null, except: Record<string, number | null> = {}) =>
    CELLS.map((c) => e('2026-11-05', c, c in except ? except[c] : p));
  it('says OK everywhere when no square outside the city is unhealthy', () => {
    expect(outsideLine(everyone(0.1, { 'west-tehran': 0.9 }), '2026-11-05')).toBe(
      'Outside the city, including Karaj, Damavand and Varamin: OK everywhere.',
    );
  });
  it('names where it is unhealthy, by a town where one lies in the square', () => {
    const line = outsideLine(everyone(0.1, { 'northwest-alborz': 0.8 }), '2026-11-05');
    expect(line).toBe('Outside the city: unhealthy around Karaj; OK elsewhere.');
  });
  it('names a square with no town by its square', () => {
    const line = outsideLine(everyone(0.1, { 'south-central': 0.9 }), '2026-11-05');
    expect(line).toContain('in the South Central square');
    expect(line).toContain('unhealthy');
  });
  it('says so when a square outside the city has no forecast', () => {
    const line = outsideLine(everyone(0.1, { 'far-east': null }), '2026-11-05');
    expect(line).toContain('no forecast around Damavand');
    expect(line).not.toContain('OK everywhere');
  });
  it('does not count the four squares of the city', () => {
    const entries = CELLS.map((c) => e('2026-11-05', c, CITY_SQUARES.includes(c) ? 0.9 : 0.1));
    expect(outsideLine(entries, '2026-11-05')).toContain('OK everywhere');
  });
});

describe('whyDiffer', () => {
  it("names what the model reads (today's air, the season, tomorrow's ECMWF weather) and what CAMS does", () => {
    const t = whyDiffer(e('2026-11-05', 'west-tehran', 0.3));
    expect(t).toMatch(/today's air up to noon/);
    expect(t).toMatch(/time of year/);
    expect(t).toMatch(/ECMWF/);
    expect(t).toMatch(/tomorrow's weather forecast/);
    expect(t).toMatch(/CAMS/);
    expect(t).toMatch(/different sides/);
  });
  it('does not claim weather for a version 1 forecast', () => {
    const t = whyDiffer(e('2026-11-05', 'west-tehran', 0.3, { model_version: 1 }));
    expect(t).not.toMatch(/ECMWF/);
    expect(t).toMatch(/time of year/);
  });
  it('has no em dash', () => {
    expect(whyDiffer(e('2026-11-05', 'west-tehran', 0.3))).not.toContain('—');
  });
});

describe('pageTitle', () => {
  const now = new Date('2026-11-04T08:00:00Z');
  it('says tomorrow for a day still to come, today for one made late', () => {
    expect(pageTitle('2026-11-05', false, now)).toBe('Tehran air tomorrow');
    expect(pageTitle('2026-11-04', true, now)).toBe('Tehran air today');
    expect(pageTitle('2026-11-04', false, now)).toBe('Tehran air today');
  });
  it('names the day when it is already over', () => {
    expect(pageTitle('2026-11-02', false, now)).toBe('Tehran air on Mon 2 Nov');
  });
});
