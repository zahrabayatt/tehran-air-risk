import { describe, expect, it } from 'vitest';
import { forecastLog } from './log';
import type { Entry } from './types';

function entry(date: string, cell: string, over: Partial<Entry> = {}): Entry {
  return {
    issued_at: `${date}T10:00:00Z`, target_date: date, cell_id: cell, probability: 0.7, predicted: 1, model_version: 1,
    outcome: 1, outcome_mean_pm25: 40, gap: false, gap_reason: null, cams_forecast_pm25: 30, ...over,
  };
}
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`;

describe('forecastLog', () => {
  it('lists the last 14 target dates, newest first', () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(day(i + 1), 'west-tehran'));
    const rows = forecastLog(entries, 'west-tehran');
    expect(rows).toHaveLength(14);
    expect(rows[0].date).toBe(day(20));
    expect(rows[13].date).toBe(day(7));
  });

  it('marks a match, a miss, and a pending outcome', () => {
    const rows = forecastLog(
      [
        entry(day(1), 'west-tehran', { probability: 0.7, predicted: 1, outcome: 1 }),
        entry(day(2), 'west-tehran', { probability: 0.7, predicted: 1, outcome: 0 }),
        entry(day(3), 'west-tehran', { probability: 0.2, predicted: 0, outcome: 1 }),
        entry(day(4), 'west-tehran', { probability: 0.2, predicted: 0, outcome: 0 }),
        entry(day(5), 'west-tehran', { outcome: null, outcome_mean_pm25: null }),
      ],
      'west-tehran',
    );
    expect(rows.map((r) => r.verdict)).toEqual(['pending', 'match', 'miss', 'miss', 'match']);
    expect(rows[0].outcome).toBeNull();
  });

  it('shows a gap as no forecast, never a number, a hit or a miss', () => {
    const rows = forecastLog(
      [entry(day(1), 'west-tehran', { gap: true, probability: null, predicted: null, outcome: 1, gap_reason: 'api error' })],
      'west-tehran',
    );
    expect(rows[0]).toMatchObject({ verdict: 'none', probability: null, predicted: null });
  });

  it('shows a date with no entry for this cell as no forecast', () => {
    const rows = forecastLog([entry(day(1), 'west-tehran'), entry(day(2), 'east-tehran')], 'west-tehran');
    expect(rows.map((r) => [r.date, r.verdict])).toEqual([[day(2), 'none'], [day(1), 'match']]);
  });

  it('keeps only the chosen cell', () => {
    const rows = forecastLog(
      [entry(day(1), 'west-tehran', { probability: 0.9 }), entry(day(1), 'east-tehran', { probability: 0.1, predicted: 0, outcome: 0 })],
      'east-tehran',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].probability).toBe(0.1);
  });

  it('for a repeated cell and date keeps the entry with the latest issued_at, whatever the order', () => {
    const older = entry(day(1), 'west-tehran', { issued_at: '2026-10-01T09:00:00Z', probability: 0.2, predicted: 0, outcome: 1 });
    const newer = entry(day(1), 'west-tehran', { issued_at: '2026-10-01T10:00:00Z', probability: 0.9, predicted: 1, outcome: 1 });
    for (const entries of [[older, newer], [newer, older]]) {
      const rows = forecastLog(entries, 'west-tehran');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ probability: 0.9, predicted: 1, verdict: 'match' });
    }
  });

  it('is empty when there are no entries', () => {
    expect(forecastLog([], 'west-tehran')).toEqual([]);
  });

  it('falls back to the 0.5 decision point if the stored class is missing', () => {
    const rows = forecastLog([entry(day(1), 'west-tehran', { probability: 0.6, predicted: null, outcome: 0 })], 'west-tehran');
    expect(rows[0].predicted).toBe(1);
    expect(rows[0].verdict).toBe('miss');
  });
});

describe('issued after the day began (M4)', () => {
  it('marks a row whose issued_at is at or after 00:00 Tehran (20:30 UTC the evening before) of its target day', () => {
    const rows = forecastLog(
      [
        entry('2026-11-04', 'west-tehran', { issued_at: '2026-11-03T13:30:55Z' }),          // the usual run
        entry('2026-11-05', 'west-tehran', { issued_at: '2026-11-04T20:29:59Z' }),          // one second before the day began
        entry('2026-11-06', 'west-tehran', { issued_at: '2026-11-05T20:30:00Z' }),          // exactly at Tehran midnight
        entry('2026-11-07', 'west-tehran', { issued_at: '2026-11-07T09:00:00Z' }),          // a manual run on the day itself
      ],
      'west-tehran',
    );
    expect(rows.map((r) => [r.date, r.issuedLate])).toEqual([
      ['2026-11-07', true], ['2026-11-06', true], ['2026-11-05', false], ['2026-11-04', false],
    ]);
  });
  it('is false for a day with no forecast', () => {
    const rows = forecastLog([entry(day(1), 'west-tehran', { gap: true, probability: null, predicted: null })], 'west-tehran');
    expect(rows[0].issuedLate).toBe(false);
  });
});
