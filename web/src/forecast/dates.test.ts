import { describe, expect, it } from 'vitest';
import { dayHasEnded, isStale, runDateLabel, shortDayLabel, targetDateLabel, updatedLabel } from './dates';

describe('dates', () => {
  it('names the target date with its weekday', () => {
    expect(targetDateLabel('2026-11-04')).toBe('Wednesday 4 November');
    expect(targetDateLabel('2026-12-31')).toBe('Thursday 31 December');
  });
  it('short day for the log', () => {
    expect(shortDayLabel('2026-11-03')).toBe('Tue 3 Nov');
  });
  it('shows the last update in Tehran time, whatever the viewer time zone', () => {
    expect(updatedLabel('2026-11-03T13:30:55Z')).toBe('3 November, 17:00 Tehran time');
    expect(updatedLabel('2026-11-03T21:00:00Z')).toBe('4 November, 00:30 Tehran time');
  });
});

describe('isStale', () => {
  const issued = '2026-11-03T10:00:00Z';
  const at = (iso: string) => new Date(iso);
  it('is fresh up to 48 hours after the latest run, stale after', () => {
    expect(isStale(at('2026-11-04T10:00:00Z'), issued)).toBe(false);
    expect(isStale(at('2026-11-05T10:00:00Z'), issued)).toBe(false);
    expect(isStale(at('2026-11-05T10:00:01Z'), issued)).toBe(true);
  });
  it('treats an unreadable time as stale rather than showing an old forecast', () => {
    expect(isStale(at('2026-11-04T10:00:00Z'), 'not a time')).toBe(true);
  });
});

describe('dayHasEnded (M5)', () => {
  it('is true once the target date is before today in Tehran', () => {
    // 2026-11-04T20:30Z is 00:00 on 5 November in Tehran.
    expect(dayHasEnded('2026-11-04', new Date('2026-11-04T20:29:59Z'))).toBe(false);
    expect(dayHasEnded('2026-11-04', new Date('2026-11-04T20:30:00Z'))).toBe(true);
    expect(dayHasEnded('2026-11-04', new Date('2026-11-03T13:30:00Z'))).toBe(false);
    expect(dayHasEnded('2026-11-04', new Date('2026-11-05T10:00:00Z'))).toBe(true);
  });
  it('is false for an unreadable date', () => {
    expect(dayHasEnded('soon', new Date('2026-11-05T10:00:00Z'))).toBe(false);
  });
});

describe('runDateLabel', () => {
  it('is the date of a run in Tehran', () => {
    expect(runDateLabel('2026-10-29T10:05:00Z')).toBe('29 October');
    expect(runDateLabel('2026-10-29T21:00:00Z')).toBe('30 October');
  });
});
