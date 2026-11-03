import { describe, expect, it } from 'vitest';
import grid from '../../public/data/grid.json';
import placesDoc from './places.json';
import { cellFor } from './cells';
import { OUTLINE_PATH, OUTLINE_SOURCE } from './outline';
import { makeProjection, outlinePoints } from './projection';
import type { GridCell } from './types';

const cells = grid.cells as GridCell[];
const proj = makeProjection(cells);

describe('projection', () => {
  it('maps the grid corners to the corners of the 864 by 800 frame', () => {
    expect(proj.width).toBe(864);
    expect(proj.height).toBe(800);
    const topLeft = proj.project(36.2, 50.6);
    const bottomRight = proj.project(35.0, 52.2);
    expect([topLeft.x, topLeft.y]).toEqual([0, 0]);
    expect(bottomRight.x).toBeCloseTo(864, 9);
    expect(bottomRight.y).toBeCloseTo(800, 9);
  });

  it('keeps one scale on both axes: a degree is 540 px east-west and 666.7 px north-south (1 / cos 35.6 degrees)', () => {
    expect(proj.pxPerDegLon).toBeCloseTo(540, 6);
    expect(proj.pxPerDegLat).toBeCloseTo(666.667, 2);
    expect(proj.pxPerDegLat / proj.pxPerDegLon).toBeCloseTo(1 / Math.cos((35.6 * Math.PI) / 180), 1);
  });

  it('lays each cell out as a 25% by 33.3% tile, row 0 on top', () => {
    for (const c of cells) {
      const t = proj.tile(c);
      expect(t.left).toBeCloseTo(c.col * 25, 6);
      expect(t.top).toBeCloseTo(c.row * 33.3333, 3);
      expect(t.width).toBeCloseTo(25, 6);
      expect(t.height).toBeCloseTo(33.3333, 3);
    }
  });

  it('puts every place inside the tile of the cell that cellFor gives it', () => {
    for (const p of placesDoc.places) {
      const { x, y } = proj.project(p.lat, p.lon);
      const c = cellFor(cells, p.lat, p.lon)!;
      const t = proj.tile(c);
      expect(x).toBeGreaterThanOrEqual((t.left / 100) * 864 - 1e-6);
      expect(x).toBeLessThan(((t.left + t.width) / 100) * 864 + 1e-6);
      expect(y).toBeGreaterThanOrEqual((t.top / 100) * 800 - 1e-6);
      expect(y).toBeLessThan(((t.top + t.height) / 100) * 800 + 1e-6);
    }
  });

  it('unproject undoes project', () => {
    const p = proj.unproject(proj.project(35.7, 51.34).x, proj.project(35.7, 51.34).y);
    expect(p.lat).toBeCloseTo(35.7, 9);
    expect(p.lon).toBeCloseTo(51.34, 9);
  });
});

describe('Tehran outline', () => {
  // Bounding box of OpenStreetMap relation 6663864 (the Tehran city boundary), as returned by Nominatim.
  const OSM_BBOX = { south: 35.5682071, north: 35.8284702, west: 51.0892219, east: 51.6063007 };

  it('is placed in lat/lon over the grid: its extent matches the OSM city boundary to within about half a kilometre', () => {
    const pts = outlinePoints(OUTLINE_PATH).map((p) => proj.unproject(p.x, p.y));
    expect(pts.length).toBeGreaterThan(50);
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    expect(Math.abs(Math.min(...lats) - OSM_BBOX.south)).toBeLessThan(0.005);
    expect(Math.abs(Math.max(...lats) - OSM_BBOX.north)).toBeLessThan(0.005);
    expect(Math.abs(Math.min(...lons) - OSM_BBOX.west)).toBeLessThan(0.005);
    expect(Math.abs(Math.max(...lons) - OSM_BBOX.east)).toBeLessThan(0.005);
  });

  it('lies in the middle of the grid, over the four central squares', () => {
    const ids = new Set(
      outlinePoints(OUTLINE_PATH).map((p) => {
        const g = proj.unproject(p.x, p.y);
        return cellFor(cells, g.lat, g.lon)?.id;
      }),
    );
    expect([...ids].sort()).toEqual(['east-tehran', 'north-tehran', 'northeast-tehran', 'west-tehran']);
  });

  it('states where it came from', () => {
    expect(OUTLINE_SOURCE).toMatch(/OpenStreetMap/);
    expect(OUTLINE_SOURCE).toMatch(/ODbL/);
  });
});
