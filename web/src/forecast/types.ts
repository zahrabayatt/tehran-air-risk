/** One CAMS grid cell, as written to public/data/grid.json by pipeline/export_grid.py. */
export interface GridCell {
  id: string;
  name: string;
  row: number;
  col: number;
  lat: number;
  lon: number;
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
}

/** A named place with approximate real coordinates (places.json). Its cell is computed, never stored. */
export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  landmark: string;
  /** Draw the name on the map. */
  onMap?: boolean;
}

/** One line of data/predictions.json: one cell, one target date. */
export interface Entry {
  issued_at: string;
  target_date: string;
  cell_id: string;
  probability: number | null;
  predicted: 0 | 1 | null;
  model_version: number | string | null;
  outcome: 0 | 1 | null;
  outcome_mean_pm25: number | null;
  gap: boolean;
  gap_reason: string | null;
  cams_forecast_pm25: number | null;
}

/** What the frozen model file says about itself (the parts this page shows). */
export interface ModelInfo {
  features: string[];
  cost: { held_out: number };
  baselines: { overall: { held_out_cost: number }; monthly: { held_out_cost: number } };
  beats_baselines: boolean;
}

export interface RateRow {
  days: number;
  rate: number;
}

/** history.json, the parts this page shows. */
export interface HistoryInfo {
  by_month: Record<string, Array<RateRow & { month: number }>>;
  by_year: Record<string, Array<RateRow & { year: number }>>;
}

/** profile.json, the parts this page shows. */
export interface ProfileInfo {
  labelled_range: { start: string; end: string };
  usable_cell_days: number;
  cell_count: number;
}

export type Layer = 'model' | 'cams';
