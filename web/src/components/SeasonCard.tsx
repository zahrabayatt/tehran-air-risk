import { THRESHOLD_TEXT } from '../forecast/headline';
import type { MonthBar } from '../forecast/summary';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

type SeasonCardProps = {
  cellName: string;
  bars: MonthBar[];
  range: string;
  /** Share of all days over all squares, 0 to 1. */
  pooled: number;
};

/** Percent of days above the threshold in each month of the year, from the real CAMS history. */
export function SeasonCard({ cellName, bars, range, pooled }: SeasonCardProps) {
  return (
    <section className="card seasoncard" aria-labelledby="season-h">
      <div>
        <h2 id="season-h">The seasons decide a lot</h2>
        <p className="small">
          Percent of days above {THRESHOLD_TEXT} in {cellName}, by month of the year, {range}. Over all 12 squares together it is{' '}
          {(pooled * 100).toFixed(1)}% of days.
        </p>
      </div>
      <ul className="seasons">
        {bars.map((m) => (
          <li key={m.month} className="seasons__col">
            <span className="sr-only">
              {MONTH_NAMES[m.month - 1]}: {Math.round(m.percent)} percent of days
            </span>
            <span className="seasons__value mono" aria-hidden="true">
              {Math.round(m.percent)}
            </span>
            <div className="seasons__bar" aria-hidden="true" style={{ height: `${Math.max(2, m.percent)}%` }} />
            <span className="seasons__label" aria-hidden="true">
              {m.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
