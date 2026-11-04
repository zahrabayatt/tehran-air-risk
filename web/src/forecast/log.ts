import { DECISION_POINT } from './headline';
import type { Entry } from './types';

export const LOG_DAYS = 14;

export type Verdict = 'match' | 'miss' | 'pending' | 'none';

export interface LogRow {
  /** Target date, YYYY-MM-DD. */
  date: string;
  probability: number | null;
  predicted: 0 | 1 | null;
  outcome: 0 | 1 | null;
  /** `none` is a gap or a date with no entry: not a hit, not a miss. */
  verdict: Verdict;
  /** The forecast was saved at or after 00:00 Tehran of its target day (a delayed or manual run). */
  issuedLate: boolean;
}

/** 00:00 Tehran of a YYYY-MM-DD date (20:30 UTC the evening before), as a time in ms. */
const tehranDayStart = (date: string) => Date.parse(`${date}T00:00:00+03:30`);

/**
 * The last 14 target dates (newest first) for one square: the prediction beside the later outcome.
 * A date with a gap, or with no entry for this square, is "none"; it never counts as a match or a miss.
 */
export function forecastLog(entries: Entry[], cellId: string, days = LOG_DAYS): LogRow[] {
  const dates = [...new Set(entries.map((e) => e.target_date))].sort().reverse().slice(0, days);
  const mine = new Map<string, Entry>();
  // One entry per (cell, date) is expected; if a date repeats, the latest run wins (same rule as the map).
  for (const e of entries) {
    if (e.cell_id !== cellId) continue;
    const prev = mine.get(e.target_date);
    if (!prev || Date.parse(e.issued_at) >= Date.parse(prev.issued_at)) mine.set(e.target_date, e);
  }
  return dates.map((date) => {
    const e = mine.get(date);
    if (!e || e.gap || e.probability === null) {
      return { date, probability: null, predicted: null, outcome: e?.outcome ?? null, verdict: 'none' as const, issuedLate: false };
    }
    const predicted = e.predicted ?? (e.probability >= DECISION_POINT ? 1 : 0);
    const verdict: Verdict = e.outcome === null ? 'pending' : e.outcome === predicted ? 'match' : 'miss';
    const issuedLate = Date.parse(e.issued_at) >= tehranDayStart(date);
    return { date, probability: e.probability, predicted, outcome: e.outcome, verdict, issuedLate };
  });
}
