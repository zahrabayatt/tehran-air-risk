import type { Entry } from './types';

/** The calendar date (YYYY-MM-DD) in Tehran at `now`. Tehran has no daylight saving time, so its day turns over at 20:30 UTC. */
export function tehranToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The newest target date in the file, or null when it is empty. */
export function newestTarget(entries: Entry[]): string | null {
  return entries.reduce<string | null>((a, e) => (a === null || e.target_date > a ? e.target_date : a), null);
}

/** The newest `issued_at` in the file, or null when it is empty. */
export function newestIssued(entries: Entry[]): string | null {
  return entries.reduce<string | null>((a, e) => (a === null || Date.parse(e.issued_at) > Date.parse(a) ? e.issued_at : a), null);
}
