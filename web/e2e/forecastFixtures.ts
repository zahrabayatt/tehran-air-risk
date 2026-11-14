// Predictions files for the Forecast page tests. Each builder returns a whole predictions.json document.
// A test serves one of them in place of the real file and fixes the clock with window.__TAR_NOW__.

export const CELL_IDS = [
  'northwest-alborz', 'north-tehran', 'northeast-tehran', 'far-northeast',
  'far-west', 'west-tehran', 'east-tehran', 'far-east',
  'southwest-plain', 'south-central', 'southeast-plain', 'far-southeast',
];

export interface FixtureEntry {
  issued_at: string;
  target_date: string;
  cell_id: string;
  probability: number | null;
  predicted: 0 | 1 | null;
  model_version: number;
  outcome: 0 | 1 | null;
  outcome_mean_pm25: number | null;
  gap: boolean;
  gap_reason: string | null;
  cams_forecast_pm25: number | null;
  issued_late?: boolean;
}

export const doc = (entries: FixtureEntry[]) => ({ schema_version: 1, entries });

interface Opts {
  cams?: number | null;
  /** When the forecast was saved. Default: 10:30 UTC the day before the target. */
  issued?: string;
  version?: number;
  /** Version 2 entries carry this flag; version 1 entries never do. */
  late?: boolean;
}

/** One cell, one day. A null probability is a gap. */
function entry(date: string, cell: string, probability: number | null, outcome: 0 | 1 | null, o: Opts = {}): FixtureEntry {
  const prev = new Date(`${date}T10:30:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const version = o.version ?? 2;
  const out: FixtureEntry = {
    issued_at: o.issued ?? prev.toISOString().replace('.000Z', 'Z'),
    target_date: date,
    cell_id: cell,
    probability,
    predicted: probability === null ? null : probability >= 0.5 ? 1 : 0,
    model_version: version,
    outcome,
    outcome_mean_pm25: outcome === null ? null : outcome === 1 ? 41.2 : 18.4,
    gap: probability === null,
    gap_reason: probability === null ? 'ECMWF 00 UTC run not published yet' : null,
    cams_forecast_pm25: probability === null ? null : (o.cams ?? 20),
  };
  if (version >= 2) out.issued_late = o.late ?? false;
  return out;
}

// West Tehran's past days: [target date, probability or null for a gap, outcome].
// Misses: 30 Oct (said Unhealthy, was OK) and 2 Nov (said OK, was Unhealthy). 31 Oct is a gap.
// 4 Nov was made late. The 27 Oct entry is the 9th newest day with 5 Nov: it must not appear in the 8 tiles.
export const WEST_HISTORY: Array<[string, number | null, 0 | 1]> = [
  ['2026-10-27', 0.2, 0],
  ['2026-10-28', 0.3, 0],
  ['2026-10-29', 0.62, 1],
  ['2026-10-30', 0.71, 0],
  ['2026-10-31', null, 1],
  ['2026-11-01', 0.15, 0],
  ['2026-11-02', 0.44, 1],
  ['2026-11-03', 0.12, 0],
  ['2026-11-04', 0.66, 1],
];
export const MISSES_IN_WEST_TILES = 2;

export const TARGET = '2026-11-05';
/** 4 November 12:00 UTC is 15:30 in Tehran: the forecast for the 5th, saved at 14:00 Tehran, is for tomorrow. */
export const NOW_FRESH = '2026-11-04T12:00:00Z';
/** More than 48 hours after the 4 November 10:30 UTC run. */
export const NOW_STALE = '2026-11-07T10:00:00Z';
/** 5 November 06:00 UTC is 09:30 in Tehran, after a forecast saved at 02:00 UTC (05:30 Tehran) that day. */
export const NOW_LATE = '2026-11-05T06:00:00Z';

interface Day {
  west?: number | null;
  east?: number | null;
  north?: number | null;
  northeast?: number | null;
  /** Probability for every other square. */
  rest?: number | null;
  northwestAlborz?: number | null;
  /** CAMS values. */
  westCams?: number;
  eastCams?: number;
  northCams?: number;
}

function history(): FixtureEntry[] {
  const out: FixtureEntry[] = [];
  for (const [d, p, o] of WEST_HISTORY) {
    out.push(entry(d, 'west-tehran', p, o, d === '2026-11-04' ? { late: true, issued: '2026-11-04T02:00:00Z' } : {}));
    // The other squares had quiet days, all forecast correctly.
    for (const c of CELL_IDS) if (c !== 'west-tehran') out.push(entry(d, c, c === 'east-tehran' ? 0.12 : 0.04, 0));
  }
  return out;
}

/** The forecast for 5 November: West Tehran Unhealthy (CAMS agrees), East Tehran OK, North Tehran OK but CAMS disagrees. */
export function forTarget(day: Day, o: Opts = {}): FixtureEntry[] {
  const rest = day.rest === undefined ? 0.05 : day.rest;
  return CELL_IDS.map((c) => {
    switch (c) {
      case 'west-tehran': return entry(TARGET, c, day.west === undefined ? 0.82 : day.west, null, { ...o, cams: day.westCams ?? 41.26 });
      case 'east-tehran': return entry(TARGET, c, day.east === undefined ? 0.2 : day.east, null, { ...o, cams: day.eastCams ?? 30.4 });
      case 'north-tehran': return entry(TARGET, c, day.north === undefined ? 0.3 : day.north, null, { ...o, cams: day.northCams ?? 40.2 });
      case 'northeast-tehran': return entry(TARGET, c, day.northeast === undefined ? 0.1 : day.northeast, null, { ...o, cams: 12.5 });
      case 'northwest-alborz': return entry(TARGET, c, day.northwestAlborz === undefined ? rest : day.northwestAlborz, null, { ...o, cams: 12.5 });
      default: return entry(TARGET, c, rest, null, { ...o, cams: 12.5 });
    }
  });
}

/** The usual day: forecast saved 10:30 UTC on 4 November for 5 November. */
export const normal = () => doc([...history(), ...forTarget({})]);
/** West Tehran has a gap for the day; the other squares have forecasts. */
export const westGap = () => doc([...history(), ...forTarget({ west: null })]);
/** Karaj's square says Unhealthy. */
export const karajBad = () => doc([...history(), ...forTarget({ northwestAlborz: 0.8 })]);
/** The last forecast was made on 4 November, so with NOW_STALE it is more than 48 hours old. */
export const stale = normal;
export const empty = () => doc([]);
/** Version 2 forecast saved at 02:00 UTC on 5 November (05:30 Tehran), after its day began, marked issued_late. */
export const lateV2 = () => doc([...history(), ...forTarget({}, { late: true, issued: '2026-11-05T02:00:00Z' })]);
/** A version 1 forecast saved late, with no issued_late field at all: the page works it out from issued_at. */
export const lateV1 = () => doc([...history(), ...forTarget({}, { version: 1, issued: '2026-11-05T02:00:00Z' })]);
/** A version 1 forecast saved on time, no issued_late field: not late. */
export const onTimeV1 = () => doc([...history(), ...forTarget({}, { version: 1 })]);
