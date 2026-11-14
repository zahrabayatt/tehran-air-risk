import city from './city.json';
import { shortDayLabel } from './dates';
import { tehranToday } from './days';
import type { CellId, Entry } from './types';

/** The line between OK and Unhealthy: the day's mean PM2.5 above this, in micrograms per cubic metre. */
export const THRESHOLD = 35.4;
/** A chance of this or more is called Unhealthy. */
export const DECISION_POINT = 0.5;

export type Word = 'OK' | 'Unhealthy';

export interface DayTile {
  /** YYYY-MM-DD, the day being forecast. */
  date: string;
  /** What the forecast said, or null for a day with no forecast (a gap). */
  said: Word | null;
  /** What the day turned out to be, or null while the day is not over. */
  was: Word | null;
  /** Whether it said the right word, or null when either is missing. */
  right: boolean | null;
  /** The forecast was made after its day had begun. */
  late: boolean;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

type Box = readonly number[];
const inBox = (lon: number, lat: number, b: Box) => lon >= b[0] && lon < b[2] && lat >= b[1] && lat < b[3];

export const CELLS = city.cells as ReadonlyArray<{ id: CellId; name: string; box: Box }>;
export const PLACES = city.places as ReadonlyArray<Place>;
export const HOODS = city.hoods as ReadonlyArray<{ n: string; c: CellId; s: number; g: number[][][] }>;

export const cellName = (id: CellId): string => CELLS.find((c) => c.id === id)?.name ?? id;

/** The square holding a landmark, by its coordinates. */
function cellOfPlace(p: Place): CellId {
  const c = CELLS.find((x) => inBox(p.lon, p.lat, x.box));
  if (!c) throw new Error(`${p.name} is outside every square`);
  return c.id;
}

/**
 * The forecast square for a choice. Accepts the keys the page uses ("p:azadi" for a landmark, "h:12" for the neighbourhood
 * at that place in city.json), and also a landmark's or neighbourhood's name. A landmark is placed by its coordinates, a
 * neighbourhood by its own square, `c`.
 */
export function squareFor(placeOrHood: string): CellId {
  const m = /^([ph]):(.+)$/.exec(placeOrHood);
  if (m && m[1] === 'p') {
    const p = PLACES.find((x) => x.id === m[2]);
    if (p) return cellOfPlace(p);
  } else if (m && m[1] === 'h') {
    const h = /^\d+$/.test(m[2]) ? HOODS[Number(m[2])] : undefined;
    if (h) return h.c;
  } else {
    const p = PLACES.find((x) => x.name === placeOrHood);
    if (p) return cellOfPlace(p);
    const h = HOODS.find((x) => x.n === placeOrHood);
    if (h) return h.c;
  }
  throw new Error(`No landmark or neighbourhood called "${placeOrHood}"`);
}

/** The squares Tehran falls in, in a fixed order: the ones that hold at least one neighbourhood. */
export const CITY_SQUARES: CellId[] = ['west-tehran', 'east-tehran', 'north-tehran', 'northeast-tehran'].filter((id) =>
  HOODS.some((h) => h.c === id),
);

/** The chance of unhealthy air as a whole number from 0 to 10. */
export const chanceInTen = (p: number): number => Math.min(10, Math.max(0, Math.round(p * 10)));

/** "about 2 in 10", but never a rounded-off certainty. */
export function chanceText(p: number): string {
  const n = chanceInTen(p);
  return n === 0 ? 'less than 1 in 10' : n === 10 ? 'more than 9 in 10' : `about ${n} in 10`;
}

export const answer = (p: number): Word => (p >= DECISION_POINT ? 'Unhealthy' : 'OK');

const DAY_MS = 24 * 3_600_000;

/**
 * A forecast made after its day began: `issued_late` when the entry carries it, else issued later than 20:30 UTC on the
 * day before the target (00:00 in Tehran).
 */
export function isLate(e: Entry): boolean {
  if (typeof e.issued_late === 'boolean') return e.issued_late;
  const dayBefore = Date.parse(`${e.target_date}T20:30:00Z`) - DAY_MS;
  return Date.parse(e.issued_at) > dayBefore;
}

/** An entry that carries a usable chance (not a gap). */
export const isForecast = (e: Entry | undefined): e is Entry & { probability: number } =>
  e !== undefined && !e.gap && e.probability !== null;

/** The newest entry per square for one target date. */
export function currentEntries(entries: Entry[], target: string): Map<CellId, Entry> {
  const out = new Map<CellId, Entry>();
  for (const e of entries) {
    if (e.target_date !== target) continue;
    const prev = out.get(e.cell_id);
    if (!prev || Date.parse(e.issued_at) >= Date.parse(prev.issued_at)) out.set(e.cell_id, e);
  }
  return out;
}

/** The last `n` days of one square, oldest first, one tile per day. */
export function lastDays(entries: Entry[], cell: CellId, n = 8): DayTile[] {
  const byDate = new Map<string, Entry>();
  for (const e of entries) {
    if (e.cell_id !== cell) continue;
    const prev = byDate.get(e.target_date);
    if (!prev || Date.parse(e.issued_at) >= Date.parse(prev.issued_at)) byDate.set(e.target_date, e);
  }
  return [...byDate.keys()]
    .sort()
    .slice(-n)
    .map((date) => {
      const e = byDate.get(date) as Entry;
      const said = isForecast(e) ? answer(e.probability) : null;
      const was: Word | null = e.outcome === null ? null : e.outcome === 1 ? 'Unhealthy' : 'OK';
      return { date, said, was, right: said === null || was === null ? null : said === was, late: isLate(e) };
    });
}

/**
 * The line under the city map about the squares outside it. Names a town people know where one lies in the square, else
 * the square itself.
 */
export function outsideLine(entries: Entry[], target: string): string {
  const now = currentEntries(entries, target);
  const outside = CELLS.filter((c) => !CITY_SQUARES.includes(c.id));
  const townIn = (c: (typeof CELLS)[number]) => PLACES.find((q) => inBox(q.lon, q.lat, c.box));
  const where = (c: (typeof CELLS)[number]) => {
    const q = townIn(c);
    return q ? `around ${q.name}` : `in the ${c.name} square`;
  };
  const bad = outside.filter((c) => {
    const e = now.get(c.id);
    return isForecast(e) && e.probability >= DECISION_POINT;
  });
  const missing = outside.filter((c) => !isForecast(now.get(c.id)));
  if (bad.length === 0 && missing.length === 0) {
    const towns = outside.map(townIn).filter((q): q is Place => q !== undefined).map((q) => q.name);
    return `Outside the city, including ${towns.slice(0, -1).join(', ')} and ${towns[towns.length - 1]}: OK everywhere.`;
  }
  const parts: string[] = [];
  if (bad.length) parts.push(`unhealthy ${bad.map(where).join(', ')}`);
  if (missing.length) parts.push(`no forecast ${missing.map(where).join(', ')}`);
  return `Outside the city: ${parts.join('; ')}; OK elsewhere.`;
}

/** The "Why can they differ?" text, matched to what the saved forecast's model read. */
export function whyDiffer(e: Pick<Entry, 'model_version'>): string {
  const cams = 'CAMS works out how pollution will move across the whole region, hour by hour.';
  if (Number(e.model_version) === 1) {
    return `Both look at tomorrow in different ways. ${cams} Our model reads today's air up to noon and the time of year, and answers from patterns it learned in past Tehran days. Near the line, the two can land on different sides.`;
  }
  return `Both look at tomorrow's weather, in different ways. ${cams} Our model reads today's air up to noon, the time of year and tomorrow's weather forecast from ECMWF, and answers from patterns it learned in past Tehran days. Near the line, the two can land on different sides.`;
}

/** The page's title: "tomorrow" while the day is still to come, "today" when it is under way or made late. */
export function pageTitle(target: string, late: boolean, now: Date): string {
  const today = tehranToday(now);
  if (target > today) return late ? 'Tehran air today' : 'Tehran air tomorrow';
  if (target === today) return 'Tehran air today';
  return `Tehran air on ${shortDayLabel(target)}`;
}
