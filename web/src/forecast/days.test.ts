import { describe, expect, it } from 'vitest';
import { newestIssued, newestTarget, tehranToday } from './days';
import type { Entry } from './types';

function e(target: string, issued: string): Entry {
  return {
    issued_at: issued, target_date: target, cell_id: 'west-tehran', probability: 0.6, predicted: 1, model_version: 2,
    outcome: null, outcome_mean_pm25: null, gap: false, gap_reason: null, cams_forecast_pm25: 30,
  };
}

describe('tehranToday', () => {
  it('is the calendar date in Tehran, not in UTC', () => {
    expect(tehranToday(new Date('2026-11-04T08:00:00Z'))).toBe('2026-11-04');
    expect(tehranToday(new Date('2026-11-04T20:29:59Z'))).toBe('2026-11-04');
    expect(tehranToday(new Date('2026-11-04T20:30:00Z'))).toBe('2026-11-05');
  });
  it('crosses a month end on the Tehran date', () => {
    expect(tehranToday(new Date('2026-11-30T21:00:00Z'))).toBe('2026-12-01');
  });
});

describe('newestTarget and newestIssued', () => {
  const rows = [e('2026-11-04', '2026-11-03T13:30:00Z'), e('2026-11-05', '2026-11-04T10:30:00Z'), e('2026-11-03', '2026-11-02T10:30:00Z')];
  it('find the newest target date and the newest save time', () => {
    expect(newestTarget(rows)).toBe('2026-11-05');
    expect(newestIssued(rows)).toBe('2026-11-04T10:30:00Z');
  });
  it('are null for an empty file', () => {
    expect(newestTarget([])).toBeNull();
    expect(newestIssued([])).toBeNull();
  });
});
