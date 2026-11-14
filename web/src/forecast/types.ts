/** A forecast square's id, such as "west-tehran". */
export type CellId = string;

/** One line of data/predictions.json: one cell, one target date. */
export interface Entry {
  issued_at: string;
  target_date: string;
  cell_id: CellId;
  probability: number | null;
  predicted: 0 | 1 | null;
  model_version: number | string | null;
  outcome: 0 | 1 | null;
  outcome_mean_pm25: number | null;
  gap: boolean;
  gap_reason: string | null;
  cams_forecast_pm25: number | null;
  /** Version 2 entries only. When absent, `isLate` works it out from `issued_at`. */
  issued_late?: boolean;
}
