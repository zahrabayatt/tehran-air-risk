export const THRESHOLD_TEXT = '35.4 μg/m³';
/** The fixed decision point: a chance of 50% or more is "above". */
export const DECISION_POINT = 0.5;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
const HOURS_48 = 48 * 3_600_000;

/** A probability as a percentage, never rounding to a certainty the model does not claim. */
export function formatPercent(p: number): string {
  if (p < 0.005) return '<1%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

export type CellForecast = { kind: 'forecast'; probability: number } | { kind: 'none' };

export interface CityHeadline {
  kind: 'both-above' | 'both-below' | 'mixed' | 'incomplete';
  title: string;
  sub: string;
}

const WEST = 'West Tehran';
const EAST = 'East Tehran';

/**
 * The one-line answer for the city: the West Tehran and East Tehran squares, which hold the city.
 * Three wordings (both above, both below, mixed) plus an honest one when a square has no forecast.
 */
export function cityHeadline(west: CellForecast, east: CellForecast, dateLabel: string): CityHeadline {
  const above = (f: CellForecast) => f.kind === 'forecast' && f.probability >= DECISION_POINT;
  const estimate = (parts: string[]) =>
    `Model estimate of the chance that the day's average PM2.5 is above ${THRESHOLD_TEXT}: ${parts.join(', ')}.`;

  if (west.kind === 'forecast' && east.kind === 'forecast') {
    const sub = estimate([`${WEST} ${formatPercent(west.probability)}`, `${EAST} ${formatPercent(east.probability)}`]);
    if (above(west) && above(east)) {
      return { kind: 'both-above', title: `${dateLabel}: likely above ${THRESHOLD_TEXT} in both ${WEST} and ${EAST}`, sub };
    }
    if (!above(west) && !above(east)) {
      return { kind: 'both-below', title: `${dateLabel}: likely below ${THRESHOLD_TEXT} in both ${WEST} and ${EAST}`, sub };
    }
    const [hi, lo] = above(west) ? [WEST, EAST] : [EAST, WEST];
    return { kind: 'mixed', title: `${dateLabel}: mixed, likely above ${THRESHOLD_TEXT} in ${hi} and below in ${lo}`, sub };
  }

  // One or both squares have no forecast: say so, and state nothing about them.
  const missing = [west.kind === 'none' ? WEST : null, east.kind === 'none' ? EAST : null].filter(Boolean) as string[];
  const known: string[] = [];
  const phrases: string[] = [];
  for (const [name, f] of [[WEST, west], [EAST, east]] as const) {
    if (f.kind === 'forecast') {
      known.push(`${name} ${formatPercent(f.probability)}`);
      phrases.push(`${name} likely ${above(f) ? 'above' : 'below'} ${THRESHOLD_TEXT}`);
    }
  }
  const gaps = `no forecast for ${missing.join(' or ')}`;
  return {
    kind: 'incomplete',
    title: `${dateLabel}: ${phrases.length ? `${phrases.join('; ')}; ` : ''}${gaps}`,
    sub: known.length ? estimate(known) : 'The model made no estimate for these squares.',
  };
}

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
