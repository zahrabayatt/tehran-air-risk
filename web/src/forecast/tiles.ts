import { DECISION_POINT, THRESHOLD_TEXT, formatPercent } from './headline';
import type { Projection, TileBox } from './projection';
import type { Entry, GridCell, Layer } from './types';

/** The threshold as a number, to compare a CAMS value with. Strictly greater is "above". */
export const THRESHOLD = 35.4;

export interface Tile {
  id: string;
  name: string;
  box: TileBox;
  /** Big text in the square: "91%", "41.3", or "No forecast". */
  value: string;
  /** "▲ Above", "▼ Below", or empty when there is nothing to compare. */
  word: string;
  aria: string;
  fill: string;
  pressed: boolean;
  noData: boolean;
}

export function layerLabel(layer: Layer): string {
  return layer === 'model' ? 'Model chance' : 'CAMS forecast';
}

export function legendText(layer: Layer): string {
  return layer === 'model'
    ? `Number: the model's chance that the day's average PM2.5 is above ${THRESHOLD_TEXT}. ▲ means 50% or more.`
    : `Number: PM2.5 forecast by CAMS, in μg/m³, compared with ${THRESHOLD_TEXT}. Display only, not used by the model.`;
}

/** Orange when above, teal when below; stronger the further from the dividing line (colours from the design board). */
function paint(above: boolean, strength: number): string {
  const a = (0.14 + Math.min(1, strength) * 0.46).toFixed(2);
  return above ? `rgba(234, 108, 32, ${a})` : `rgba(30, 140, 165, ${a})`;
}

/** One tile per cell, in grid order. `entries` is the current target date's entry for each cell, if any. */
export function buildTiles(
  cells: GridCell[],
  entries: Map<string, Entry>,
  layer: Layer,
  proj: Projection,
  selectedId: string | null,
): Tile[] {
  return cells.map((c) => {
    const e = entries.get(c.id);
    const base = { id: c.id, name: c.name, box: proj.tile(c), pressed: c.id === selectedId };
    // The accessible name starts with the square's name and then the visible text, so it always contains what is shown.
    const none = (value: string): Tile => ({
      ...base, value, word: '', aria: `${c.name}: ${value}`, fill: 'transparent', noData: true,
    });
    if (!e || e.gap || e.probability === null) return none('No forecast');

    if (layer === 'model') {
      const p = e.probability;
      const above = p >= DECISION_POINT;
      return {
        ...base,
        value: formatPercent(p),
        word: above ? '▲ Above' : '▼ Below',
        aria: `${c.name}: ${formatPercent(p)} ${above ? 'Above' : 'Below'}. Model chance that the day averages above 35.4 micrograms per cubic metre.`,
        fill: paint(above, Math.abs(p - DECISION_POINT) * 2),
        noData: false,
      };
    }
    const pm = e.cams_forecast_pm25;
    if (pm === null) return none('No CAMS value');
    const above = pm > THRESHOLD;
    return {
      ...base,
      value: pm.toFixed(1),
      word: above ? '▲ Above' : '▼ Below',
      aria: `${c.name}: ${pm.toFixed(1)} ${above ? 'Above' : 'Below'}. CAMS forecast in micrograms per cubic metre, compared with 35.4.`,
      fill: paint(above, Math.abs(pm - THRESHOLD) / 20),
      noData: false,
    };
  });
}
