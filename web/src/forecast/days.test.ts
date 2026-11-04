import { describe, expect, it } from 'vitest';
import { offeredDays, tehranToday } from './days';
import type { Entry } from './types';

function e(date: string, issued: string, gap = false, cell = 'west-tehran'): Entry {
  return {
    issued_at: issued,
    target_date: date,
    cell_id: cell,
    probability: gap ? null : 0.6,
    predicted: gap ? null : 1,
    model_version: 1,
    outcome: null,
    outcome_mean_pm25: null,
    gap,
    gap_reason: gap ? 'no data returned' : null,
    cams_forecast_pm25: gap ? null : 30,
  };
}

const RUN3 = '2026-11-03T13:30:00Z';
const RUN4 = '2026-11-04T16:07:00Z';
const TWO = [e('2026-11-04', RUN3), e('2026-11-05', RUN4)];
const dates = (xs: ReturnType<typeof offeredDays>) => xs.map((d) => d.date);

describe('tehranToday', () => {
  it('is the calendar date in Tehran, not in UTC', () => {
    expect(tehranToday(new Date('2026-11-04T08:00:00Z'))).toBe('2026-11-04');
    expect(tehranToday(new Date('2026-11-04T20:29:59Z'))).toBe('2026-11-04');
    expect(tehranToday(new Date('2026-11-04T20:30:00Z'))).toBe('2026-11-05');
  });
});

describe('offeredDays', () => {
  it('offers today and tomorrow, oldest first, labelled against Tehran today', () => {
    const days = offeredDays([...TWO].reverse(), new Date('2026-11-04T17:00:00Z'));
    expect(dates(days)).toEqual(['2026-11-04', '2026-11-05']);
    expect(days.map((d) => d.label)).toEqual(['Today · Wed 4 Nov', 'Tomorrow · Thu 5 Nov']);
  });

  it('keeps a day offered at 20:29:59Z, the last second of that Tehran day', () => {
    expect(dates(offeredDays(TWO, new Date('2026-11-04T20:29:59Z')))).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('drops a day at 20:30:00Z, when it ends in Tehran, and relabels the next one as today', () => {
    const days = offeredDays(TWO, new Date('2026-11-04T20:30:00Z'));
    expect(dates(days)).toEqual(['2026-11-05']);
    expect(days[0].label).toBe('Today · Thu 5 Nov');
  });

  it('offers a single day when only one is left', () => {
    expect(dates(offeredDays([e('2026-11-04', RUN3)], new Date('2026-11-04T08:00:00Z')))).toEqual(['2026-11-04']);
  });

  it('offers nothing when every target date has ended', () => {
    expect(offeredDays(TWO, new Date('2026-11-05T20:30:00Z'))).toEqual([]);
    expect(offeredDays([], new Date('2026-11-04T08:00:00Z'))).toEqual([]);
  });

  it('offers a day that has only gap entries', () => {
    const days = offeredDays([e('2026-11-04', RUN3), e('2026-11-05', RUN4, true)], new Date('2026-11-04T08:00:00Z'));
    expect(dates(days)).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('lists each date once and reports its latest issued_at', () => {
    const days = offeredDays(
      [e('2026-11-05', '2026-11-04T10:00:00Z'), e('2026-11-05', RUN4, false, 'east-tehran'), e('2026-11-05', '2026-11-04T12:00:00Z', false, 'far-east')],
      new Date('2026-11-04T08:00:00Z'),
    );
    expect(days).toHaveLength(1);
    expect(days[0].issuedAt).toBe(RUN4);
  });

  it('ignores past dates that are still in the log', () => {
    const days = offeredDays([e('2026-11-02', '2026-11-01T10:00:00Z'), e('2026-11-03', '2026-11-02T10:00:00Z'), ...TWO], new Date('2026-11-04T08:00:00Z'));
    expect(dates(days)).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('labels a date further ahead with its day only', () => {
    const days = offeredDays([e('2026-11-07', RUN4)], new Date('2026-11-04T08:00:00Z'));
    expect(days[0].label).toBe('Sat 7 Nov');
  });

  it('uses the Tehran date around midnight, across a month end', () => {
    const entries = [e('2026-11-30', RUN3), e('2026-12-01', RUN4)];
    const days = offeredDays(entries, new Date('2026-11-30T21:00:00Z')); // 00:30 on 1 December in Tehran
    expect(days.map((d) => d.label)).toEqual(['Today · Tue 1 Dec']);
  });
});
