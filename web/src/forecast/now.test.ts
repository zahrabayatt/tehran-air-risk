import { describe, expect, it } from 'vitest';
import { resolveNow } from './now';

const REAL = new Date('2026-11-10T08:00:00Z');

describe('resolveNow', () => {
  it('uses the real time by default', () => {
    expect(resolveNow('', REAL)).toEqual(REAL);
  });
  it('takes a time from the now parameter (for tests)', () => {
    expect(resolveNow('?now=2026-11-03T20:00:00Z', REAL)).toEqual(new Date('2026-11-03T20:00:00Z'));
  });
  it('ignores an unreadable value', () => {
    expect(resolveNow('?now=soon', REAL)).toEqual(REAL);
  });
});
