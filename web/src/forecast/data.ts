import type { Entry, GridCell, HistoryInfo, ModelInfo, ProfileInfo } from './types';

export interface ForecastData {
  grid: GridCell[];
  entries: Entry[];
  /** The frozen model's description, history and profile are optional: the page works without them. */
  model: ModelInfo | null;
  history: HistoryInfo | null;
  profile: ProfileInfo | null;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function parseEntry(raw: unknown, index: number): Entry {
  const fail = (why: string) => new Error(`The predictions file is not readable: entry ${index + 1} ${why}.`);
  if (!isObject(raw)) throw fail('is not an object');
  const { issued_at, target_date, cell_id } = raw;
  if (typeof issued_at !== 'string' || Number.isNaN(Date.parse(issued_at))) throw fail('has no readable issued_at');
  if (typeof target_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(target_date)) throw fail('has no target_date');
  if (typeof cell_id !== 'string' || cell_id === '') throw fail('has no cell_id');

  const outcome: 0 | 1 | null = raw.outcome === 1 ? 1 : raw.outcome === 0 ? 0 : null;
  const base = {
    issued_at,
    target_date,
    cell_id,
    model_version: (raw.model_version as Entry['model_version']) ?? null,
    outcome,
    outcome_mean_pm25: finite(raw.outcome_mean_pm25) ? raw.outcome_mean_pm25 : null,
  };
  const p = raw.probability;
  const usable = raw.gap !== true && finite(p) && p >= 0 && p <= 1;
  if (!usable) {
    // A gap, or a probability that cannot be trusted: no number is shown for this square and day.
    const reason = typeof raw.gap_reason === 'string' ? raw.gap_reason : raw.gap === true ? null : 'unreadable probability';
    return { ...base, probability: null, predicted: null, gap: true, gap_reason: reason, cams_forecast_pm25: null };
  }
  return {
    ...base,
    probability: p,
    predicted: raw.predicted === 0 || raw.predicted === 1 ? raw.predicted : p >= 0.5 ? 1 : 0,
    gap: false,
    gap_reason: null,
    cams_forecast_pm25: finite(raw.cams_forecast_pm25) ? raw.cams_forecast_pm25 : null,
  };
}

/** data/predictions.json: `{schema_version, entries: [...]}`. An empty list means no forecast has been issued yet. */
export function parsePredictions(raw: unknown): Entry[] {
  if (!isObject(raw) || !Array.isArray(raw.entries)) {
    throw new Error('The predictions file is not readable: expected an object with an entries list.');
  }
  return raw.entries.map(parseEntry);
}

function parseGrid(raw: unknown): GridCell[] {
  const cells = isObject(raw) && Array.isArray(raw.cells) ? raw.cells : null;
  const ok =
    cells !== null &&
    cells.length > 0 &&
    cells.every(
      (c) =>
        isObject(c) && typeof c.id === 'string' && typeof c.name === 'string' && finite(c.row) && finite(c.col) &&
        finite(c.lat_min) && finite(c.lat_max) && finite(c.lon_min) && finite(c.lon_max),
    );
  if (!ok) throw new Error('The grid file is not readable.');
  return cells as GridCell[];
}

async function getJson(fetchFn: FetchFn, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function optional<T>(fetchFn: FetchFn, url: string, check: (x: unknown) => x is T): Promise<T | null> {
  try {
    const x = await getJson(fetchFn, url);
    return check(x) ? x : null;
  } catch {
    return null;
  }
}

const isModel = (x: unknown): x is ModelInfo =>
  isObject(x) && Array.isArray(x.features) && isObject(x.cost) && finite(x.cost.held_out) && isObject(x.baselines) &&
  isObject(x.baselines.overall) && isObject(x.baselines.monthly) && typeof x.beats_baselines === 'boolean';
const isHistory = (x: unknown): x is HistoryInfo => isObject(x) && isObject(x.by_month) && isObject(x.by_year);
const isProfile = (x: unknown): x is ProfileInfo =>
  isObject(x) && isObject(x.labelled_range) && finite(x.usable_cell_days) && finite(x.cell_count);

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loads what the Forecast page needs. The grid and the predictions are required; the rest only adds detail. */
export async function loadForecastData(base: string, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<ForecastData> {
  const url = (name: string) => `${base}data/${name}`;
  const [gridRaw, predRaw, model, history, profile] = await Promise.all([
    getJson(fetchFn, url('grid.json')).catch((e: unknown) => {
      throw new Error(`Could not load the grid file (grid.json). ${reason(e)}`);
    }),
    getJson(fetchFn, url('predictions.json'), { cache: 'no-cache' }).catch((e: unknown) => {
      throw new Error(`Could not load the forecast file (predictions.json). ${reason(e)}`);
    }),
    optional(fetchFn, url('model.json'), isModel),
    optional(fetchFn, url('history.json'), isHistory),
    optional(fetchFn, url('profile.json'), isProfile),
  ]);
  return { grid: parseGrid(gridRaw), entries: parsePredictions(predRaw), model, history, profile };
}
