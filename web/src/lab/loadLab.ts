import type { LabInputs, LabModel, PredictionEntry } from './context';
import type { Sample } from './engine';

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, url.endsWith('predictions.json') ? { cache: 'no-cache' } : undefined);
  if (!res.ok) throw new Error(`Could not load ${url.split('/').pop()} (HTTP ${res.status}).`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${url.split('/').pop()} is not valid JSON.`);
  }
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Check the sample the Lab trains on. Throws a readable error. */
export function assertSample(data: unknown): asserts data is Sample {
  const s = data as Partial<Sample> | null;
  if (!s || !Array.isArray(s.rows) || s.rows.length < 20) throw new Error('sample.json is malformed: rows.');
  if (!Array.isArray(s.features) || !Array.isArray(s.train_months)) throw new Error('sample.json is malformed: features or train_months.');
  const need = ['pm2_5_mean', 'pm2_5_max', 'pm2_5_last', 'wind_mean', 'season_sin', 'season_cos', 'pm_tomorrow', 'y'];
  const ok = s.rows.every(
    (r) => need.every((k) => finite((r as unknown as Record<string, unknown>)[k])) && typeof r.target_date === 'string',
  );
  if (!ok) throw new Error('sample.json is malformed: a row has a missing or non-numeric field.');
}

/** Check the frozen model file for the parts the Lab shows. */
export function assertModel(data: unknown): asserts data is LabModel {
  const m = data as Partial<LabModel> | null;
  const ok =
    !!m && Array.isArray(m.features) && Array.isArray(m.weights) && finite(m.bias) && isObject(m.scaling) &&
    Array.isArray(m.scaling.mu) && Array.isArray(m.scaling.sigma) && isObject(m.hyperparameters) &&
    isObject(m.cost) && finite(m.cost.held_out) && isObject(m.baselines) && isObject(m.baselines.overall) &&
    isObject(m.baselines.monthly) && typeof m.beats_baselines === 'boolean' && isObject(m.held_out_probabilities) &&
    Array.isArray(m.candidates) && isObject(m.rows) && isObject(m.vectorization);
  if (!ok) throw new Error('model.json is malformed.');
}

function entriesOf(raw: unknown): PredictionEntry[] {
  if (!isObject(raw) || !Array.isArray(raw.entries)) throw new Error('predictions.json is malformed: expected an entries list.');
  return raw.entries.filter(
    (e): e is PredictionEntry => isObject(e) && typeof e.issued_at === 'string' && typeof e.target_date === 'string',
  );
}

/** Fetch everything the Lab needs: the sample, the frozen model and the forecast log. */
export async function loadLab(base: string): Promise<LabInputs> {
  const url = (f: string) => `${base}data/${f}`;
  const [model, sample, predictions] = await Promise.all([
    getJson(url('model.json')),
    getJson(url('sample.json')),
    getJson(url('predictions.json')),
  ]);
  assertSample(sample);
  assertModel(model);
  return { sample, model, predictions: entriesOf(predictions) };
}
