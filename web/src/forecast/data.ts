import type { Entry } from './types';

export interface ForecastData {
  entries: Entry[];
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
    // Only version 2 entries carry it; for the others the page works it out from issued_at.
    ...(typeof raw.issued_late === 'boolean' ? { issued_late: raw.issued_late } : {}),
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

async function getJson(fetchFn: FetchFn, url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchFn(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Loads what the Forecast page needs: data/predictions.json. */
export async function loadForecastData(base: string, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<ForecastData> {
  const raw = await getJson(fetchFn, `${base}data/predictions.json`, { cache: 'no-cache' }).catch((e: unknown) => {
    throw new Error(`Could not load the forecast file (predictions.json). ${e instanceof Error ? e.message : String(e)}`);
  });
  return { entries: parsePredictions(raw) };
}
