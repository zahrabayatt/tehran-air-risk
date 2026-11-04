import { describe, expect, it } from 'vitest';
import { cityHeadline, dayHasEnded, formatPercent, isStale, shortDayLabel, targetDateLabel, updatedLabel } from './headline';

const f = (probability: number) => ({ kind: 'forecast' as const, probability });
const none = { kind: 'none' as const };
const DATE = 'Wednesday 4 November';

describe('cityHeadline', () => {
  it('both above', () => {
    const h = cityHeadline(f(0.91), f(0.75), DATE);
    expect(h.kind).toBe('both-above');
    expect(h.title).toBe('Wednesday 4 November: likely above 35.4 μg/m³ in both West Tehran and East Tehran');
    expect(h.sub).toContain('West Tehran 91%');
    expect(h.sub).toContain('East Tehran 75%');
  });

  it('both below', () => {
    const h = cityHeadline(f(0.08), f(0.2), DATE);
    expect(h.kind).toBe('both-below');
    expect(h.title).toBe('Wednesday 4 November: likely below 35.4 μg/m³ in both West Tehran and East Tehran');
  });

  it('mixed names which side is which', () => {
    const a = cityHeadline(f(0.8), f(0.2), DATE);
    expect(a.kind).toBe('mixed');
    expect(a.title).toBe('Wednesday 4 November: mixed, likely above 35.4 μg/m³ in West Tehran and below in East Tehran');
    const b = cityHeadline(f(0.2), f(0.8), DATE);
    expect(b.title).toBe('Wednesday 4 November: mixed, likely above 35.4 μg/m³ in East Tehran and below in West Tehran');
  });

  it('exactly 50% counts as above, the decision point', () => {
    expect(cityHeadline(f(0.5), f(0.5), DATE).kind).toBe('both-above');
  });

  it('never invents a side when a cell has no forecast', () => {
    const h = cityHeadline(f(0.9), none, DATE);
    expect(h.kind).toBe('incomplete');
    expect(h.title).toContain('no forecast for East Tehran');
    expect(h.sub).not.toMatch(/East Tehran \d/);
    const both = cityHeadline(none, none, DATE);
    expect(both.title).toContain('no forecast for West Tehran or East Tehran');
  });

  it('is a model estimate and does not claim an official category', () => {
    for (const h of [cityHeadline(f(0.9), f(0.9), DATE), cityHeadline(f(0.1), f(0.1), DATE)]) {
      expect(h.sub).toMatch(/model estimate/i);
      expect(`${h.title} ${h.sub}`).not.toMatch(/unhealthy|EPA|official category/i);
    }
  });
});

describe('formatPercent', () => {
  it('rounds, and never shows a certainty the model does not have', () => {
    expect(formatPercent(0.5505)).toBe('55%');
    expect(formatPercent(0.0087)).toBe('1%');
    expect(formatPercent(0.003)).toBe('<1%');
    expect(formatPercent(0.9991)).toBe('>99%');
    expect(formatPercent(0)).toBe('<1%');
  });
});

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
