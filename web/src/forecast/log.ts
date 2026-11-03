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
}

/**
 * The last 14 target dates (newest first) for one square: the prediction beside the later outcome.
 * A date with a gap, or with no entry for this square, is "none"; it never counts as a match or a miss.
 */
export function forecastLog(entries: Entry[], cellId: string, days = LOG_DAYS): LogRow[] {
  const dates = [...new Set(entries.map((e) => e.target_date))].sort().reverse().slice(0, days);
  const mine = new Map<string, Entry>();
  for (const e of entries) if (e.cell_id === cellId) mine.set(e.target_date, e);
  return dates.map((date) => {
    const e = mine.get(date);
    if (!e || e.gap || e.probability === null) {
      return { date, probability: null, predicted: null, outcome: e?.outcome ?? null, verdict: 'none' as const };
    }
    const predicted = e.predicted ?? (e.probability >= DECISION_POINT ? 1 : 0);
    const verdict: Verdict = e.outcome === null ? 'pending' : e.outcome === predicted ? 'match' : 'miss';
    return { date, probability: e.probability, predicted, outcome: e.outcome, verdict };
  });
}
