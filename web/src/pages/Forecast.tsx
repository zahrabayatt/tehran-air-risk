import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CityMap, type SquareState } from '../components/CityMap';
import { loadForecastData, type ForecastData } from '../forecast/data';
import { dayHasEnded, isStale, runDateLabel, shortDayLabel, targetDateLabel, updatedLabel } from '../forecast/dates';
import { newestIssued, newestTarget } from '../forecast/days';
import { resolveNow } from '../forecast/now';
import type { CellId, Entry } from '../forecast/types';
import {
  CELLS, CITY_SQUARES, HOODS, PLACES, THRESHOLD, answer, cellName, chanceInTen, chanceText, currentEntries, isForecast, isLate,
  lastDays, outsideLine, pageTitle, squareFor, whyDiffer,
} from '../forecast/view';
import './forecast.css';

const BASE = import.meta.env.BASE_URL;
const OFFICIAL = 'https://airnow.tehran.ir/';
const START = 'p:azadi';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ForecastData };

function useForecastData() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    loadForecastData(BASE).then(
      (data) => live && setState({ status: 'ready', data }),
      (e: unknown) => live && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  return { state, retry: () => setAttempt((a) => a + 1) };
}

export function ForecastPage() {
  useEffect(() => {
    document.title = 'Tehran Air Risk: Forecast';
  }, []);
  // The clock is read once, so the page does not change under the reader. `window.__TAR_NOW__` is for tests only.
  const [now] = useState(() => resolveNow(window.__TAR_NOW__));
  const { state, retry } = useForecastData();

  if (state.status === 'loading') {
    return (
      <main className="page forecast">
        <h1>Tehran air tomorrow</h1>
        <p role="status" className="notice">
          Loading the forecast…
        </p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="page forecast">
        <h1>Tehran air tomorrow</h1>
        <div role="alert" className="notice notice--error">
          <p>
            <strong>The forecast did not load.</strong> {state.message}
          </p>
          <button type="button" className="btn" onClick={retry}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  return <Forecast entries={state.data.entries} now={now} />;
}

// The choices in the "Air at" list: the landmarks, then every neighbourhood by name. A key is "p:<landmark id>" or "h:<index in city.json>".
const HOOD_OPTIONS = HOODS.map((h, i) => ({ key: `h:${i}`, name: h.n })).sort((a, b) => a.name.localeCompare(b.name));

function Dots({ n }: { n: number }) {
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

const wordClass = (w: 'OK' | 'Unhealthy') => (w === 'OK' ? 'ok' : 'bad');

function Forecast({ entries, now }: { entries: Entry[]; now: Date }) {
  const [choice, setChoice] = useState(START);
  const onPickHood = useCallback((i: number) => setChoice(`h:${i}`), []);

  const empty = entries.length === 0;
  const issued = newestIssued(entries);
  const stale = !empty && isStale(now, issued as string);
  // The day shown is the newest target date in the file.
  const target = newestTarget(entries) ?? '';
  const current = useMemo(() => currentEntries(entries, target), [entries, target]);
  const cell: CellId = squareFor(choice);
  const entry = current.get(cell);

  // Every square, as the map and the four boxes show it. With no current forecast (empty or stale) all are grey.
  const squares = useMemo(() => {
    const m = new Map<CellId, SquareState>();
    if (empty || stale) return m;
    for (const c of CELLS) {
      const e = current.get(c.id);
      m.set(c.id, isForecast(e) ? answer(e.probability) : null);
    }
    return m;
  }, [empty, stale, current]);

  const tiles = useMemo(() => lastDays(entries, cell), [entries, cell]);
  const hood = choice.startsWith('h:') ? Number(choice.slice(2)) : null;
  const place = choice.startsWith('p:') ? choice.slice(2) : null;
  const late = entry ? isLate(entry) : false;
  const title = empty || stale ? 'Tehran air' : pageTitle(target, late, now);

  return (
    <main className="page forecast">
      <h1 id="title">{title}</h1>

      <section className="card hero" aria-label="Forecast">
        <div className="top">
          <div>
            <label className="pick" htmlFor="place">
              <span>Air at</span>
              <select id="place" value={choice} onChange={(e) => setChoice(e.target.value)}>
                <optgroup label="Landmarks">
                  {PLACES.map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Neighbourhoods">
                  {HOOD_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <p className="insq" data-testid="square">
              in the {cellName(cell)} square
            </p>
          </div>
          {!empty && !stale ? (
            <span className="dayline">
              <span data-testid="day">{targetDateLabel(target)}</span>
              {late && entry ? (
                <span className="badge" title={`Saved ${updatedLabel(entry.issued_at)}`} data-testid="late-badge">
                  made after the day began
                </span>
              ) : null}
            </span>
          ) : null}
        </div>

        {empty ? (
          <div className="nonews" role="status" data-testid="no-forecast">
            <p className="answer none">No forecasts yet</p>
            <p>The daily forecast has not run yet. The first one appears here after the next scheduled run.</p>
          </div>
        ) : stale ? (
          <div className="nonews" role="alert" data-testid="stale">
            <p className="answer none">No current forecast</p>
            <p>
              The latest forecast is more than 48 hours old, so it is hidden rather than shown out of date. Last made{' '}
              {runDateLabel(issued as string)}.
            </p>
          </div>
        ) : isForecast(entry) ? (
          <div data-testid="answer-card">
            <p className={`answer ${answer(entry.probability) === 'OK' ? 'clean' : 'dirty'}`} data-testid="answer">
              {answer(entry.probability) === 'OK' ? 'Probably OK' : 'Probably unhealthy'}
            </p>
            <div className="odds">
              <Dots n={chanceInTen(entry.probability)} />
              <span data-testid="odds">
                Chance of unhealthy air: <b>{chanceText(entry.probability)}</b>
              </span>
            </div>
            <Cams entry={entry} />
          </div>
        ) : (
          <div className="nonews" data-testid="gap">
            <p className="answer none">No forecast for this square</p>
            <p>
              The forecast could not be made for the {cellName(cell)} square for {targetDateLabel(target)}
              {entry?.gap_reason ? ` (${entry.gap_reason})` : ''}.
            </p>
          </div>
        )}

        {!empty && !stale && dayHasEnded(target, now) ? (
          <p className="small" data-testid="day-ended">
            {targetDateLabel(target)} has ended in Tehran. This is the last forecast made for it; the next one appears after the
            next scheduled run.
          </p>
        ) : null}

        <details>
          <summary>What counts as unhealthy?</summary>
          <p>
            The day's fine dust (PM2.5) averages above {THRESHOLD} μg/m³. From there, the US air quality scale calls air unhealthy for
            sensitive people: children, older people, and anyone with asthma or heart disease. In the air quality index Tehran's AQCC
            shows on <a href={OFFICIAL}>airnow.tehran.ir</a>, this is an index above 100, past "acceptable" (قابل قبول).
          </p>
        </details>
      </section>

      <section className="card" aria-labelledby="cityh">
        <h2 id="cityh">Across Tehran</h2>
        <p className="sub">The city falls in four forecast squares. Tap your neighbourhood.</p>
        <div className="city">
          <CityMap squares={squares} hood={hood} place={place} onPickHood={onPickHood} />
          <div>
            <div className="parts" data-testid="parts">
              {CITY_SQUARES.map((id) => {
                const e = current.get(id);
                const s = squares.get(id) ?? null;
                const n = HOODS.filter((h) => h.c === id).length;
                return (
                  <div key={id} className={`part ${s === null ? 'tn' : s === 'OK' ? 't0' : 't1'}${id === cell ? ' sel' : ''}`} data-cell={id}>
                    <span>
                      {cellName(id)} · {n} neighbourhood{n > 1 ? 's' : ''}
                    </span>
                    <b>{s === null ? 'No forecast' : s === 'OK' ? 'Probably OK' : 'Probably unhealthy'}</b>
                    <span>{isForecast(e) && s !== null ? chanceText(e.probability) : ''}</span>
                  </div>
                );
              })}
            </div>
            {!empty && !stale ? (
              <p className="around" data-testid="around">
                {outsideLine(entries, target)}
              </p>
            ) : null}
          </div>
        </div>
        <div className="key" data-testid="key">
          <span>
            <i className="t0" />
            OK
          </span>
          <span>
            <i className="t1" />
            Unhealthy
          </span>
          {[...squares.values()].some((s) => s === null) || squares.size === 0 ? (
            <span>
              <i className="tn" />
              No forecast
            </span>
          ) : null}
        </div>
        <details>
          <summary>Why one forecast for so many neighbourhoods?</summary>
          <p>
            The forecast is built from CAMS, a European air model that covers the whole world in squares of about 44 by 36 km. Every
            place inside one square gets the same numbers, and Tehran falls in four of them. Each neighbourhood takes the forecast of
            the square that holds most of it, so a neighbourhood on a border shares its larger side's forecast. A street-level forecast
            would need measurements from Tehran's air stations, which this project does not use yet.
          </p>
        </details>
      </section>

      {tiles.length > 0 ? (
        <section className="card" aria-labelledby="logh">
          <h2 id="logh">
            {tiles.length === 1 ? 'The last day' : `The last ${tiles.length} days`} in the {cellName(cell)} square
          </h2>
          <p className="sub">
            Each forecast against what happened, misses included. "Made late" marks a forecast made after its day had begun.
          </p>
          <div className="days" data-testid="days">
            {tiles.map((t, i) => (
              <div key={t.date} className={`day${i === tiles.length - 1 ? ' latest' : ''}`} data-testid="day-tile">
                <div className="dtop">
                  <span>{shortDayLabel(t.date)}</span>
                  {t.right === null ? null : (
                    <span className={`mark ${t.right ? 'ok' : 'miss'}`} aria-label={t.right ? 'right' : 'wrong'}>
                      {t.right ? '✓' : '✕'}
                    </span>
                  )}
                </div>
                <div className="row">
                  <span>Said</span>
                  {t.said === null ? <span className="chip wait">no forecast</span> : <span className={`chip ${wordClass(t.said)}`}>{t.said}</span>}
                </div>
                <div className="row">
                  <span>Was</span>
                  {t.was === null ? <span className="chip wait">not over</span> : <span className={`chip ${wordClass(t.was)}`}>{t.was}</span>}
                </div>
                <span className="late" title="This forecast was made after its day had begun">
                  {t.late ? 'made late' : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <p className="foot">
        Modelled air from CAMS, not station readings, and not an official alert or medical advice. For the official forecast see{' '}
        <a href={OFFICIAL}>airnow.tehran.ir</a>. <Link to="/lab">How the model works</Link> · <Link to="/data">Where the data comes from</Link>.
        Neighbourhoods: © OpenStreetMap contributors.
      </p>
    </main>
  );
}

/** The CAMS one-liner, with the "Why can they differ?" fold when the two disagree. */
function Cams({ entry }: { entry: Entry & { probability: number } }) {
  if (entry.cams_forecast_pm25 === null) return null;
  const camsAbove = entry.cams_forecast_pm25 > THRESHOLD;
  const agree = camsAbove === (answer(entry.probability) === 'Unhealthy');
  const word = camsAbove ? 'unhealthy' : 'OK';
  return (
    <div className="second" data-testid="cams">
      {agree ? (
        <>
          CAMS, the European air forecast, agrees: <b>{word}</b>.
        </>
      ) : (
        <>
          CAMS, the European air forecast, disagrees: it expects <b>{word}</b> air here.
          <details>
            <summary>Why can they differ?</summary>
            <p>{whyDiffer(entry)}</p>
          </details>
        </>
      )}
    </div>
  );
}
