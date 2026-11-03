import { describe, expect, it } from 'vitest';
import grid from '../../public/data/grid.json';
import fixture from './cellFixture.json';
import placesDoc from './places.json';
import { cellFor, placeCell } from './cells';
import type { GridCell } from './types';

const cells = grid.cells as GridCell[];

describe('cellFor', () => {
  it('has the 12 cells of pipeline/grid.py', () => {
    expect(cells).toHaveLength(12);
    expect(new Set(cells.map((c) => c.id)).size).toBe(12);
  });

  it('agrees with Python cell_for on every fixture point (centres, edges, corners, nudges, outside)', () => {
    expect(fixture.points.length).toBeGreaterThan(100);
    const wrong = fixture.points
      .filter((p) => (cellFor(cells, p.lat, p.lon)?.id ?? null) !== p.cell)
      .map((p) => `${p.what} (${p.lat}, ${p.lon}): expected ${p.cell}, got ${cellFor(cells, p.lat, p.lon)?.id ?? null}`);
    expect(wrong).toEqual([]);
  });

  it('puts a point on a boundary in the cell above or to the east (half-open boxes)', () => {
    expect(cellFor(cells, 35.8, 51.2)?.id).toBe('north-tehran');
    expect(cellFor(cells, 35.7999, 51.2)?.id).toBe('west-tehran');
    expect(cellFor(cells, 35.6, 51.4)?.id).toBe('east-tehran');
    expect(cellFor(cells, 35.6, 51.3999)?.id).toBe('west-tehran');
  });

  it('returns null at or beyond the upper edges and outside the grid', () => {
    expect(cellFor(cells, 36.2, 51.4)).toBeNull();
    expect(cellFor(cells, 35.6, 52.2)).toBeNull();
    expect(cellFor(cells, 0, 0)).toBeNull();
  });

  it('absorbs float noise the way Python does (rounds to 6 decimals)', () => {
    expect(cellFor(cells, 35.4 - 1e-9, 51.2)?.id).toBe('west-tehran');
    expect(cellFor(cells, 35.8 - 1e-9, 51.2)?.id).toBe('north-tehran');
  });
});

describe('places', () => {
  const places = placesDoc.places;

  it('every place is in a cell, computed from its coordinates', () => {
    for (const p of places) expect(placeCell(cells, p)).not.toBeNull();
  });

  it('Shahr-e Rey is in East Tehran by computation, Azadi Square in West Tehran', () => {
    const byId = Object.fromEntries(places.map((p) => [p.id, p]));
    expect(placeCell(cells, byId.rey)?.name).toBe('East Tehran');
    expect(placeCell(cells, byId.azadi)?.name).toBe('West Tehran');
    expect(placeCell(cells, byId.tehranpars)?.name).toBe('East Tehran');
    expect(placeCell(cells, byId.karaj)?.name).toBe('Northwest Alborz');
    expect(placeCell(cells, byId.varamin)?.name).toBe('Southeast Plain');
  });

  it('matches the cell Python assigned to every place in the fixture', () => {
    for (const p of places) {
      const expected = fixture.points.find((f) => f.what === `place ${p.id}`)?.cell;
      expect(placeCell(cells, p)?.id).toBe(expected);
    }
  });
});
