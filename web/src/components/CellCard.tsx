import { THRESHOLD_TEXT, formatPercent, targetDateLabel } from '../forecast/headline';
import type { Entry, GridCell, Place } from '../forecast/types';

type CellCardProps = {
  cell: GridCell;
  place: Place | null;
  entry: Entry | undefined;
  target: string;
  /** Plain-language list of the model's inputs, or null when model.json did not load. */
  inputs: string | null;
};

/** The verdict for the chosen square: a model estimate against 35.4 μg/m³, never an official category. */
export function CellCard({ cell, place, entry, target, inputs }: CellCardProps) {
  const p = entry && !entry.gap ? entry.probability : null;
  const above = p !== null && p >= 0.5;
  const colour = above ? 'var(--warn)' : 'var(--ac)';
  return (
    <section className="card cellcard" data-testid="cell-card" aria-label="Chosen square">
      <div className="small" data-testid="cell-name">
        {place ? `${place.name} is in the ${cell.name} square` : `${cell.name} square`}
      </div>
      {p === null ? (
        <>
          <div className="cellcard__verdict">No forecast for this square</div>
          <p className="small">
            The model made no forecast for {cell.name} on {targetDateLabel(target)}. Nothing is shown rather than a guess.
          </p>
        </>
      ) : (
        <>
          <div className="cellcard__verdict">Likely {above ? 'above' : 'below'} {THRESHOLD_TEXT}</div>
          <div>
            <div className="cellcard__prob">
              <span className="cellcard__pct" style={{ color: colour }}>
                {formatPercent(p)}
              </span>
              <span className="small cellcard__label">
                chance of above <span className="nowrap">{THRESHOLD_TEXT}</span>
                <br />a model estimate
              </span>
            </div>
            <div className="bar" aria-hidden="true">
              <div className="bar__fill" style={{ width: `${p * 100}%`, background: colour }} />
              <div className="bar__mark" />
            </div>
            <div className="small bar__note">The mark shows the 50% decision point.</div>
          </div>
        </>
      )}
      <dl className="facts">
        {entry && !entry.gap ? (
          <>
            <dt>CAMS forecast here</dt>
            <dd className="mono">{entry.cams_forecast_pm25 === null ? 'No CAMS value' : `${entry.cams_forecast_pm25.toFixed(1)} μg/m³`}</dd>
          </>
        ) : null}
        <dt>Threshold</dt>
        <dd className="mono">{THRESHOLD_TEXT}</dd>
        {inputs ? (
          <>
            <dt>Model inputs</dt>
            <dd>{inputs}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
