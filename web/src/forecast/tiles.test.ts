import { describe, expect, it } from 'vitest';
import grid from '../../public/data/grid.json';
import { makeProjection } from './projection';
import { buildTiles, layerLabel, legendText } from './tiles';
import type { Entry, GridCell } from './types';

const cells = grid.cells as GridCell[];
const proj = makeProjection(cells);

function e(cell: string, over: Partial<Entry> = {}): Entry {
  return {
    issued_at: '2026-11-03T10:00:00Z', target_date: '2026-11-04', cell_id: cell, probability: 0.9, predicted: 1, model_version: 1,
    outcome: null, outcome_mean_pm25: null, gap: false, gap_reason: null, cams_forecast_pm25: 41.26, ...over,
  };
}
const byCell = (entries: Entry[]) => new Map(entries.map((x) => [x.cell_id, x]));

describe('buildTiles', () => {
  it('makes 12 tiles in grid order, one per cell', () => {
    const tiles = buildTiles(cells, byCell([]), 'model', proj, null);
    expect(tiles).toHaveLength(12);
    expect(tiles.map((t) => t.id)).toEqual(cells.map((c) => c.id));
  });

  it('model layer shows the chance, with above and below by the 0.5 decision point', () => {
    const t = buildTiles(cells, byCell([e('west-tehran', { probability: 0.91 }), e('far-east', { probability: 0.04 })]), 'model', proj, null);
    const west = t.find((x) => x.id === 'west-tehran')!;
    const east = t.find((x) => x.id === 'far-east')!;
    expect(west.value).toBe('91%');
    expect(west.word).toBe('▲ Above');
    expect(west.aria).toBe('West Tehran: 91% Above. Model chance that the day averages above 35.4 micrograms per cubic metre.');
    expect(east.value).toBe('4%');
    expect(east.word).toBe('▼ Below');
  });

  it('CAMS layer shows the CAMS forecast and compares it with 35.4', () => {
    const t = buildTiles(cells, byCell([e('west-tehran', { cams_forecast_pm25: 41.26 }), e('far-east', { cams_forecast_pm25: 35.4 })]), 'cams', proj, null);
    const west = t.find((x) => x.id === 'west-tehran')!;
    expect(west.value).toBe('41.3');
    expect(west.word).toBe('▲ Above');
    expect(west.aria).toBe('West Tehran: 41.3 Above. CAMS forecast in micrograms per cubic metre, compared with 35.4.');
    const edge = t.find((x) => x.id === 'far-east')!;
    expect(edge.word).toBe('▼ Below'); // exactly 35.4 is not above 35.4
    expect(edge.aria).toContain('35.4 Below. CAMS forecast');
  });

  it('a gap or missing entry is "No forecast" in both layers, never a number', () => {
    const entries = byCell([e('west-tehran', { gap: true, probability: null, predicted: null, cams_forecast_pm25: 33 })]);
    for (const layer of ['model', 'cams'] as const) {
      const t = buildTiles(cells, entries, layer, proj, null);
      for (const id of ['west-tehran', 'east-tehran']) {
        const tile = t.find((x) => x.id === id)!;
        expect(tile.noData).toBe(true);
        expect(tile.value).toBe('No forecast');
        expect(tile.word).toBe('');
        expect(tile.aria).toBe(`${tile.name}: No forecast`);
        expect(tile.value).not.toMatch(/\d/);
      }
    }
  });

  it('CAMS layer with no CAMS value for a cell says so', () => {
    const t = buildTiles(cells, byCell([e('west-tehran', { cams_forecast_pm25: null })]), 'cams', proj, null);
    const west = t.find((x) => x.id === 'west-tehran')!;
    expect(west.value).toBe('No CAMS value');
    expect(west.noData).toBe(true);
    expect(west.aria).toBe('West Tehran: No CAMS value');
  });

  it('every accessible name contains the text shown in the square, so a voice command by label works', () => {
    for (const layer of ['model', 'cams'] as const) {
      for (const t of buildTiles(cells, byCell([e('west-tehran'), e('far-east', { probability: 0.04, cams_forecast_pm25: 9 })]), layer, proj, null)) {
        expect(t.aria).toContain(t.value);
        if (t.word) expect(t.aria).toContain(t.word.replace(/^[▲▼] /, ''));
      }
    }
  });

  it('marks only the selected tile as pressed', () => {
    const t = buildTiles(cells, byCell([]), 'model', proj, 'east-tehran');
    expect(t.filter((x) => x.pressed).map((x) => x.id)).toEqual(['east-tehran']);
  });
});

describe('layers', () => {
  it('names the layers', () => {
    expect(layerLabel('model')).toBe('Model chance');
    expect(layerLabel('cams')).toBe('CAMS forecast');
  });
  it('legends use 35.4', () => {
    expect(legendText('model')).toContain('35.4 μg/m³');
    expect(legendText('cams')).toContain('35.4 μg/m³');
    expect(legendText('cams')).toMatch(/not used by the model/i);
  });
});
