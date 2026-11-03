import { describe, expect, it } from 'vitest';
import grid from '../../public/data/grid.json';
import { loadForecastData, parsePredictions } from './data';

const good = {
  issued_at: '2026-11-03T13:30:55Z', target_date: '2026-11-04', cell_id: 'west-tehran', probability: 0.55, predicted: 1,
  model_version: 1, outcome: null, outcome_mean_pm25: null, gap: false, gap_reason: null, cams_forecast_pm25: 31.7,
};

describe('parsePredictions', () => {
  it('reads an empty file as no entries', () => {
    expect(parsePredictions({ schema_version: 1, entries: [] })).toEqual([]);
  });

  it('keeps a good entry unchanged', () => {
    expect(parsePredictions({ schema_version: 1, entries: [good] })).toEqual([good]);
  });

  it('a gap never carries a number', () => {
    const [e] = parsePredictions({ schema_version: 1, entries: [{ ...good, gap: true, probability: 0.9, predicted: 1, cams_forecast_pm25: 20 }] });
    expect(e.gap).toBe(true);
    expect(e.probability).toBeNull();
    expect(e.predicted).toBeNull();
    expect(e.cams_forecast_pm25).toBeNull();
  });

  it('an entry whose probability is missing or out of range becomes a gap instead of a made-up number', () => {
    const rows = parsePredictions({
      schema_version: 1,
      entries: [{ ...good, probability: null }, { ...good, cell_id: 'far-east', probability: 1.4 }, { ...good, cell_id: 'far-west', probability: 'x' }],
    });
    expect(rows.every((r) => r.gap && r.probability === null)).toBe(true);
  });

  it('rejects a file that is not a predictions file', () => {
    expect(() => parsePredictions(null)).toThrow(/predictions/);
    expect(() => parsePredictions({ entries: 'no' })).toThrow(/predictions/);
    expect(() => parsePredictions([good])).toThrow(/predictions/);
    expect(() => parsePredictions({ entries: [{ ...good, target_date: 'tomorrow' }] })).toThrow(/entry 1/);
    expect(() => parsePredictions({ entries: [{ ...good, cell_id: 5 }] })).toThrow(/entry 1/);
  });
});

function fakeFetch(files: Record<string, unknown>) {
  return async (url: string) => {
    const v = files[url.split('/').pop()!];
    if (v === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => v } as Response;
  };
}

describe('loadForecastData', () => {
  it('loads the grid and predictions, and treats model, history and profile as optional', async () => {
    const data = await loadForecastData('/x/', fakeFetch({ 'grid.json': grid, 'predictions.json': { schema_version: 1, entries: [good] } }));
    expect(data.grid).toHaveLength(12);
    expect(data.entries).toHaveLength(1);
    expect(data.model).toBeNull();
    expect(data.history).toBeNull();
    expect(data.profile).toBeNull();
  });

  it('fails with a clear message when predictions.json is missing', async () => {
    await expect(loadForecastData('/x/', fakeFetch({ 'grid.json': grid }))).rejects.toThrow(/Could not load the forecast file/);
  });

  it('fails with a clear message when the grid is missing', async () => {
    await expect(loadForecastData('/x/', fakeFetch({ 'predictions.json': { entries: [] } }))).rejects.toThrow(/Could not load the grid file/);
  });
});
