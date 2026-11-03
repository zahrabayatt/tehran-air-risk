import { OUTLINE_PATH } from '../forecast/outline';
import type { Tile } from '../forecast/tiles';

export interface MapLabel {
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
  /** Draw a dot at (x, y). */
  dot?: boolean;
}

/** Where the chosen place is. Its name is in the side card; the map only marks the spot. */
export interface MapMarker {
  x: number;
  y: number;
}

type RiskMapProps = {
  tiles: Tile[];
  onPick: (cellId: string) => void;
  /** Names drawn on the map (the board's Karaj, Varamin and Damavand), at their real coordinates. */
  labels: MapLabel[];
  /** Where the chosen place is, or null when a square was picked instead. */
  marker: MapMarker | null;
  /** Position of the "Tehran" word. */
  cityLabel: { x: number; y: number };
};

/**
 * Twelve squares, one per CAMS cell, over Tehran's outline (OpenStreetMap, ODbL; no map tiles).
 * Each square is a real button: Tab reaches it, Enter or Space chooses it, and `aria-pressed` says which is chosen.
 */
export function RiskMap({ tiles, onPick, labels, marker, cityLabel }: RiskMapProps) {
  return (
    <div className="riskmap" role="group" aria-label="Forecast squares">
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.noData ? 'tile tile--none' : 'tile'}
          data-cell={t.id}
          aria-pressed={t.pressed}
          aria-label={t.aria}
          onClick={() => onPick(t.id)}
          style={{
            left: `${t.box.left}%`,
            top: `${t.box.top}%`,
            width: `${t.box.width}%`,
            height: `${t.box.height}%`,
            background: t.fill,
          }}
        >
          <span className={t.noData ? 'tile__none' : 'tile__value'}>{t.value}</span>
          {t.word ? <span className="tile__word">{t.word}</span> : null}
        </button>
      ))}
      <svg viewBox="0 0 864 800" aria-hidden="true" className="riskmap__overlay" data-testid="outline">
        <path
          data-outline=""
          d={OUTLINE_PATH}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <text x={cityLabel.x} y={cityLabel.y} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--ink)">
          Tehran
        </text>
        {labels.map((l) => (
          <g key={l.text}>
            {l.dot ? <circle cx={l.x} cy={l.y} r={5} fill="var(--ink)" /> : null}
            <text x={l.x} y={l.y + 26} textAnchor={l.anchor} fontSize={15} fill="var(--ink)" stroke="var(--bg)" strokeWidth={4} paintOrder="stroke">
              {l.text}
            </text>
          </g>
        ))}
        {marker ? (
          <circle cx={marker.x} cy={marker.y} r={7} fill="var(--ink)" stroke="var(--sf)" strokeWidth={3} data-testid="marker" />
        ) : null}
      </svg>
    </div>
  );
}
