/** Date words for the Forecast page. Tehran is UTC+03:30 all year, so its day turns over at 20:30 UTC. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
const HOURS_48 = 48 * 3_600_000;


function ymd(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** "Wednesday 4 November" for a YYYY-MM-DD date (a calendar date, no time zone involved). */
export function targetDateLabel(date: string): string {
  const p = ymd(date);
  if (!p) return date;
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** "Tue 3 Nov", for the log. */
export function shortDayLabel(date: string): string {
  const p = ymd(date);
  if (!p) return date;
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[weekday].slice(0, 3)} ${p.d} ${MONTHS[p.m - 1].slice(0, 3)}`;
}

/** "3 November, 17:00 Tehran time", whatever time zone the viewer is in. */
export function updatedLabel(issuedAt: string): string {
  const t = Date.parse(issuedAt);
  if (Number.isNaN(t)) return 'time unknown';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]}, ${get('hour')}:${get('minute')} Tehran time`;
}

/** The date of a run in Tehran, "29 October". */
export function runDateLabel(issuedAt: string): string {
  return updatedLabel(issuedAt).split(',')[0];
}

/** True when Tehran's calendar day `date` (YYYY-MM-DD) is already over at `now`: 00:00 Tehran is 20:30 UTC the evening before. */
export function dayHasEnded(date: string, now: Date): boolean {
  if (!ymd(date)) return false;
  const nextMidnight = Date.parse(`${date}T00:00:00+03:30`) + 24 * 3600_000;
  return Number.isFinite(nextMidnight) && now.getTime() >= nextMidnight;
}

/** True when the latest run is more than 48 hours before `now`, or its time cannot be read. */
export function isStale(now: Date, latestIssuedAt: string): boolean {
  const t = Date.parse(latestIssuedAt);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > HOURS_48;
}
