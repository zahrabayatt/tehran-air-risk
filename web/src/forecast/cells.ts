import type { GridCell, Place } from './types';

/** Same as Python's round(x, 6): absorbs float noise on a grid line. */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The cell containing (lat, lon), or null outside the grid. Cells are half-open boxes, the same rule as
 * pipeline/grid.py cell_for: lat_min <= lat < lat_max and lon_min <= lon < lon_max, so a point on a line
 * belongs to the cell above it or to the east of it.
 */
export function cellFor(cells: GridCell[], lat: number, lon: number): GridCell | null {
  const la = round6(lat);
  const lo = round6(lon);
  return cells.find((c) => c.lat_min <= la && la < c.lat_max && c.lon_min <= lo && lo < c.lon_max) ?? null;
}

export function placeCell(cells: GridCell[], place: Pick<Place, 'lat' | 'lon'>): GridCell | null {
  return cellFor(cells, place.lat, place.lon);
}
