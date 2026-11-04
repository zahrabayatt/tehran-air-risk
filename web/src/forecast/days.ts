import { dayHasEnded, shortDayLabel } from './headline';
import type { Entry } from './types';

/** One target date the Forecast page can show. */
export interface OfferedDay {
  /** YYYY-MM-DD, a Tehran calendar day. */
  date: string;
  /** "Today · Wed 4 Nov", "Tomorrow · Thu 5 Nov", or just "Sat 7 Nov" further ahead. */
  label: string;
  /** The latest issued_at among this date's entries. */
  issuedAt: string;
}

const DAY_MS = 24 * 3_600_000;

/** The calendar date (YYYY-MM-DD) in Tehran at `now`. Tehran has no daylight saving time, so its day turns over at 20:30 UTC. */
export function tehranToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Every target date whose Tehran day has not ended at `now`, oldest first. Normally that is today and tomorrow.
 * A date counts if it has any entry, including only gaps: its squares then say "no forecast".
 */
export function offeredDays(entries: Entry[], now: Date): OfferedDay[] {
  const latest = new Map<string, string>();
  for (const e of entries) {
    if (dayHasEnded(e.target_date, now)) continue;
    const prev = latest.get(e.target_date);
    if (prev === undefined || Date.parse(e.issued_at) > Date.parse(prev)) latest.set(e.target_date, e.issued_at);
  }
  const today = tehranToday(now);
  const tomorrow = addDays(today, 1);
  return [...latest.keys()]
    .sort()
    .map((date) => {
      const short = shortDayLabel(date);
      const label = date === today ? `Today · ${short}` : date === tomorrow ? `Tomorrow · ${short}` : short;
      return { date, label, issuedAt: latest.get(date) as string };
    });
}
