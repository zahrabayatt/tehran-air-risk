import type { GridCell } from './types';

export interface Point {
  x: number;
  y: number;
}

export interface TileBox {
  /** Percent of the map's width and height. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Projection {
  width: number;
  height: number;
  pxPerDegLon: number;
  pxPerDegLat: number;
  project(lat: number, lon: number): Point;
  unproject(x: number, y: number): { lat: number; lon: number };
  tile(cell: GridCell): TileBox;
}

/** The map frame: the grid fills it, 864 by 800 as in docs/design/AirHome.dc.html. */
export const MAP_WIDTH = 864;
export const MAP_HEIGHT = 800;

/** Equirectangular mapping from the bounds in grid.json (north at the top) to the 864 by 800 frame. */
export function makeProjection(cells: GridCell[]): Projection {
  const latMin = Math.min(...cells.map((c) => c.lat_min));
  const latMax = Math.max(...cells.map((c) => c.lat_max));
  const lonMin = Math.min(...cells.map((c) => c.lon_min));
  const lonMax = Math.max(...cells.map((c) => c.lon_max));
  const pxPerDegLon = MAP_WIDTH / (lonMax - lonMin);
  const pxPerDegLat = MAP_HEIGHT / (latMax - latMin);
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    pxPerDegLon,
    pxPerDegLat,
    project: (lat, lon) => ({ x: (lon - lonMin) * pxPerDegLon, y: (latMax - lat) * pxPerDegLat }),
    unproject: (x, y) => ({ lat: latMax - y / pxPerDegLat, lon: lonMin + x / pxPerDegLon }),
    tile: (c) => ({
      left: ((c.lon_min - lonMin) / (lonMax - lonMin)) * 100,
      top: ((latMax - c.lat_max) / (latMax - latMin)) * 100,
      width: ((c.lon_max - c.lon_min) / (lonMax - lonMin)) * 100,
      height: ((c.lat_max - c.lat_min) / (latMax - latMin)) * 100,
    }),
  };
}

/** The vertices of an SVG path made of M and L commands. */
export function outlinePoints(path: string): Point[] {
  return [...path.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}
