import { formatPercent, shortDayLabel } from '../forecast/headline';
import type { LogRow, Verdict } from '../forecast/log';

type ForecastLogProps = {
  cellName: string;
  rows: LogRow[];
  /** Offered only when the map is hidden, so a square can still be chosen. */
  picker?: { value: string; options: Array<{ id: string; name: string }>; onChange: (id: string) => void };
};

const side = (v: 0 | 1) => (v === 1 ? '▲ Above' : '▼ Below');

const RESULT: Record<Verdict, string> = {
  match: '✓ Match',
  miss: '✕ Miss',
  pending: 'Waiting',
  none: 'Not counted',
};

/**
 * The record: what was forecast beside what happened. Each row is one target date. A miss is marked in
 * words and colour; a pending day says pending; a day with no forecast says so and is not counted either way.
 * There is deliberately no total or percentage of matches.
 */
export function ForecastLog({ cellName, rows, picker }: ForecastLogProps) {
  return (
    <section className="card logcard" aria-labelledby="log-h">
      <div>
        <h2 id="log-h">How past forecasts turned out</h2>
        <p className="small" data-testid="log-title">
          {rows.length > 0
            ? `${cellName}. Saved before each day begins, with the result added afterward, misses included.`
            : 'Saved before each day begins, with the result added afterward, misses included.'}
        </p>
      </div>
      {picker ? (
        <div className="field">
          <label htmlFor="log-cell">Square</label>
          <select id="log-cell" className="control" value={picker.value} onChange={(e) => picker.onChange(e.target.value)}>
            {picker.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p data-testid="log-empty">No forecasts have been recorded yet. Each day's forecast will appear here, with what happened beside it.</p>
      ) : (
        <div className="log-scroll" role="region" aria-label="Past forecasts table, scrollable" tabIndex={0}>
        <table className="log" aria-labelledby="log-h">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Forecast</th>
              <th scope="col">What happened</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} data-verdict={r.verdict} className={`log__row log__row--${r.verdict}`}>
                <th scope="row">{shortDayLabel(r.date)}</th>
                <td>
                  {r.probability === null || r.predicted === null ? (
                    'No forecast'
                  ) : (
                    <>
                      <span className="mono log__pct">{formatPercent(r.probability)}</span> {side(r.predicted)}
                    </>
                  )}
                </td>
                <td>{r.outcome === null ? 'Pending' : side(r.outcome)}</td>
                <td className="log__result">{RESULT[r.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
