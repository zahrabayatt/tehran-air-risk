import { describe, expect, it } from 'vitest';
import { resolveNow } from './now';

const REAL = new Date('2026-11-10T08:00:00Z');

describe('resolveNow', () => {
  it('uses the real time when nothing is set', () => {
    expect(resolveNow(undefined, REAL)).toEqual(REAL);
    expect(resolveNow('', REAL)).toEqual(REAL);
  });
  it('takes the test override', () => {
    expect(resolveNow('2026-11-03T20:00:00Z', REAL)).toEqual(new Date('2026-11-03T20:00:00Z'));
  });
  it('ignores an unreadable or non-string value', () => {
    expect(resolveNow('soon', REAL)).toEqual(REAL);
    expect(resolveNow(12345, REAL)).toEqual(REAL);
  });
});
