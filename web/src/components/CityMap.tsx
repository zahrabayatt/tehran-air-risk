import { memo, useMemo } from 'react';
import city from '../forecast/city.json';
import type { CellId } from '../forecast/types';
import { CELLS, HOODS, PLACES, type Word } from '../forecast/view';

/** What a square says on the map: its word, or null for a square with no forecast (grey). */
export type SquareState = Word | null;

const W = 560;
const H = 330;

type Pt = [number, number];

/** The drawing, worked out once: every shape is fixed, only the colours change. */
const GEO = (() => {
  const outline = city.outline as Pt[];
  const k = Math.cos((35.7 * Math.PI) / 180);
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const s = Math.min(540 / ((x1 - x0) * k), 300 / (y1 - y0));
  const ox = (W - (x1 - x0) * k * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  const P = ([lo, la]: Pt): Pt => [ox + (lo - x0) * k * s, oy + (y1 - la) * s];
  const f = (v: number) => v.toFixed(1);
  const path = (rings: number[][][]) =>
    rings.map((r) => `M${(r as Pt[]).map((p) => P(p).map(f).join(' ')).join('L')}Z`).join('');
  const outlinePoints = outline.map((p) => P(p).map(f).join(',')).join(' ');
  const hoods = HOODS.map((h) => path(h.g));
  const seams = path(city.groups.flatMap((g) => g.rings as number[][][]));
  // Square names sit at the middle of each square's part of the city.
  const pts = new Map<CellId, Pt[]>();
  HOODS.forEach((h) => {
    const list = pts.get(h.c) ?? [];
    for (const p of h.g[0] as Pt[]) list.push(p);
    pts.set(h.c, list);
  });
  const names = [...pts.entries()]
    .filter(([, v]) => v.length > 200)
    .map(([id, v]) => {
      const [x, y] = P([v.reduce((t, p) => t + p[0], 0) / v.length, v.reduce((t, p) => t + p[1], 0) / v.length]);
      return { id, x, y, text: CELLS.find((c) => c.id === id)?.name ?? id };
    });
  return { P, outlinePoints, hoods, seams, names };
})();

const klass = (s: SquareState) => (s === null ? 'tn' : s === 'OK' ? 't0' : 't1');

interface Props {
  /** The state of each square; a square missing from the map counts as no forecast. */
  squares: ReadonlyMap<CellId, SquareState>;
  /** The chosen neighbourhood (an index in city.json), if the choice is one. */
  hood: number | null;
  /** The chosen landmark's id, if the choice is one. */
  place: string | null;
  onPickHood: (index: number) => void;
}

/** Tehran's 377 neighbourhoods, each coloured by its square's forecast. Tapping one picks it. */
function CityMapView({ squares, hood, place, onPickHood }: Props) {
  const shapes = useMemo(
    () =>
      HOODS.map((h, i) => (
        <path key={i} data-hood={i} className={`hood ${klass(squares.get(h.c) ?? null)}`} d={GEO.hoods[i]} onClick={() => onPickHood(i)}>
          <title>{h.n}</title>
        </path>
      )),
    [squares, onPickHood],
  );
  const pl = place ? PLACES.find((p) => p.id === place) : undefined;
  const mark = pl ? GEO.P([pl.lon, pl.lat]) : null;
  return (
    <svg className="citysvg" id="citysvg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tehran's neighbourhoods, coloured by their square's forecast">
      <polygon points={GEO.outlinePoints} className="outside" />
      {shapes}
      <path d={GEO.seams} className="seams" pointerEvents="none" />
      {hood !== null ? <path d={GEO.hoods[hood]} className="chosen" pointerEvents="none" /> : null}
      {GEO.names.map((n) => (
        <text key={n.id} x={n.x} y={n.y} textAnchor="middle" className="sqname" pointerEvents="none">
          {n.text}
        </text>
      ))}
      {pl && mark ? (
        <>
          <circle cx={mark[0]} cy={mark[1]} r={5} className="dot" pointerEvents="none" />
          <text x={mark[0] + 8} y={mark[1] + 4} className="plname" pointerEvents="none">
            {pl.name}
          </text>
        </>
      ) : null}
    </svg>
  );
}

export const CityMap = memo(CityMapView);
