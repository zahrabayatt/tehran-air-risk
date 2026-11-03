// Predictions files for the Forecast page tests. Each builder returns a whole predictions.json document.
// A test serves one of them in place of the real file and sets the clock with the `now` query parameter.

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
}

export const doc = (entries: FixtureEntry[]) => ({ schema_version: 1, entries });

/** One cell, one day. A null probability is a gap. */
function entry(
  date: string, cell: string, probability: number | null, outcome: 0 | 1 | null, cams: number | null = 20, issued?: string,
): FixtureEntry {
  const prev = new Date(`${date}T10:05:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return {
    issued_at: issued ?? prev.toISOString().replace('.000Z', 'Z'),
    target_date: date,
    cell_id: cell,
    probability,
    predicted: probability === null ? null : probability >= 0.5 ? 1 : 0,
    model_version: 1,
    outcome,
    outcome_mean_pm25: outcome === null ? null : outcome === 1 ? 41.2 : 18.4,
    gap: probability === null,
    gap_reason: probability === null ? 'no data returned' : null,
    cams_forecast_pm25: probability === null ? null : cams,
  };
}

// West Tehran's past days: [target date, probability or null for a gap, outcome].
// Misses: 24 Oct (said above, was below) and 27 Oct (said below, was above). 25 Oct is a gap.
export const WEST_HISTORY: Array<[string, number | null, 0 | 1]> = [
  ['2026-10-21', 0.2, 0], // the 15th newest date: must not appear in a 14-row log
  ['2026-10-22', 0.3, 0],
  ['2026-10-23', 0.62, 1],
  ['2026-10-24', 0.71, 0],
  ['2026-10-25', null, 1],
  ['2026-10-26', 0.15, 0],
  ['2026-10-27', 0.44, 1],
  ['2026-10-28', 0.58, 1],
  ['2026-10-29', 0.8, 1],
  ['2026-10-30', 0.83, 1],
  ['2026-10-31', 0.12, 0],
  ['2026-11-01', 0.55, 1],
  ['2026-11-02', 0.09, 0],
  ['2026-11-03', 0.66, 1],
];

export const MISSES_IN_WEST_LOG = 2;
export const GAPS_IN_WEST_LOG = 1;

interface LatestOpts {
  west: number | null;
  east: number | null;
  /** Probability for every other square. */
  rest?: number;
  westCams?: number;
  eastCams?: number;
}

/** The forecast for Wednesday 4 November (issued 3 November 10:05 UTC = 13:35 Tehran) plus the past days. */
export function withHistory(latest: LatestOpts): FixtureEntry[] {
  const target = '2026-11-04';
  const rest = latest.rest ?? 0.05;
  const out: FixtureEntry[] = [];
  for (const [d, p, o] of WEST_HISTORY) out.push(entry(d, 'west-tehran', p, o));
  // East Tehran and the other squares had quiet days, all forecast correctly.
  for (const [d] of WEST_HISTORY) {
    for (const c of CELL_IDS) if (c !== 'west-tehran') out.push(entry(d, c, c === 'east-tehran' ? 0.12 : 0.04, 0));
  }
  for (const c of CELL_IDS) {
    if (c === 'west-tehran') out.push(entry(target, c, latest.west, null, latest.westCams ?? 41.26));
    else if (c === 'east-tehran') out.push(entry(target, c, latest.east, null, latest.eastCams ?? 30.4));
    else out.push(entry(target, c, rest, null, 12.5));
  }
  return out;
}

/** Fixed clocks. Tehran is UTC+3:30, so 4 Nov 08:00 UTC is 11:30 on 4 November in Tehran. */
export const NOW_FRESH = '2026-11-04T08:00:00Z';
/** More than 48 hours after the 3 November 10:05 UTC run. */
export const NOW_STALE = '2026-11-05T10:06:00Z';

export const bothAbove = () => doc(withHistory({ west: 0.91, east: 0.75 }));
export const bothBelow = () => doc(withHistory({ west: 0.08, east: 0.2, westCams: 18.2, eastCams: 15 }));
export const mixed = () => doc(withHistory({ west: 0.82, east: 0.2 }));
export const eastGap = () => doc(withHistory({ west: 0.91, east: null }));
export const empty = () => doc([]);
/** The last run was on 29 October: stale on 3 November. */
export const stale = () =>
  doc(CELL_IDS.map((c) => entry('2026-10-30', c, c === 'west-tehran' ? 0.9 : 0.05, null, 30, '2026-10-29T10:05:00Z')));
