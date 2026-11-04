import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CellCard } from '../components/CellCard';
import { ForecastLog } from '../components/ForecastLog';
import { RiskMap, type MapLabel, type MapMarker } from '../components/RiskMap';
import { SeasonCard } from '../components/SeasonCard';
import { GITHUB_URL } from '../config';
import { placeCell } from '../forecast/cells';
import { loadForecastData, type ForecastData } from '../forecast/data';
import {
  THRESHOLD_TEXT, cityHeadline, dayHasEnded, isStale, runDateLabel, targetDateLabel, updatedLabel, type CellForecast,
} from '../forecast/headline';
import { forecastLog } from '../forecast/log';
import { resolveNow } from '../forecast/now';
import placesDoc from '../forecast/places.json';
import { makeProjection } from '../forecast/projection';
import { describeInputs, monthlySeries, pooledRate, resultSentence, spanOfHistory } from '../forecast/summary';
import { buildTiles, layerLabel, legendText } from '../forecast/tiles';
import type { Entry, Layer, Place } from '../forecast/types';
import './forecast.css';

const BASE = import.meta.env.BASE_URL;
const PLACES = placesDoc.places as Place[];
const DEFAULT_CELL = 'west-tehran';
const DEFAULT_PLACE = 'azadi';
const WEST = 'west-tehran';
const EAST = 'east-tehran';

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
        <h1>Forecast</h1>
        <p role="status" className="notice">
          Loading the forecast…
        </p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="page forecast">
        <h1>Forecast</h1>
        <div role="alert" className="notice notice--error">
          <p>
            <strong>The forecast did not load.</strong> {state.message}
          </p>
          <button type="button" className="btn btn--outline" onClick={retry}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  return <Forecast data={state.data} now={now} />;
}

/** The latest entry per cell for the most recent target date. */
function currentEntries(entries: Entry[], target: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const e of entries) {
    if (e.target_date !== target) continue;
    const prev = out.get(e.cell_id);
    if (!prev || Date.parse(e.issued_at) >= Date.parse(prev.issued_at)) out.set(e.cell_id, e);
  }
  return out;
}

const asForecast = (e: Entry | undefined): CellForecast =>
  e && !e.gap && e.probability !== null ? { kind: 'forecast', probability: e.probability } : { kind: 'none' };

function Forecast({ data, now }: { data: ForecastData; now: Date }) {
  const { grid, entries, model, history, profile } = data;
  const proj = useMemo(() => makeProjection(grid), [grid]);
  const [layer, setLayer] = useState<Layer>('model');
  const startCell = grid.some((c) => c.id === DEFAULT_CELL) ? DEFAULT_CELL : grid[0].id;
  const [cellId, setCellId] = useState(startCell);
  const [placeId, setPlaceId] = useState(
    PLACES.some((p) => p.id === DEFAULT_PLACE && placeCell(grid, p)?.id === startCell) ? DEFAULT_PLACE : '',
  );

  const cell = grid.find((c) => c.id === cellId) ?? grid[0];
  const place = PLACES.find((p) => p.id === placeId) ?? null;

  const empty = entries.length === 0;
  const latestIssued = empty
    ? ''
    : entries.reduce((a, e) => (Date.parse(e.issued_at) > Date.parse(a) ? e.issued_at : a), entries[0].issued_at);
  const stale = !empty && isStale(now, latestIssued);
  const target = empty ? '' : entries.reduce((a, e) => (e.target_date > a ? e.target_date : a), entries[0].target_date);
  const current = useMemo(() => currentEntries(entries, target), [entries, target]);

  const pickPlace = (id: string) => {
    const p = PLACES.find((x) => x.id === id);
    const c = p ? placeCell(grid, p) : null;
    if (p && c) {
      setPlaceId(p.id);
      setCellId(c.id);
    } else {
      setPlaceId('');
    }
  };
  const pickCell = (id: string) => {
    setCellId(id);
    setPlaceId('');
  };

  const log = useMemo(() => forecastLog(entries, cell.id), [entries, cell.id]);
  const series = history ? monthlySeries(history, cell.id) : [];
  const inputs = model ? describeInputs(model.features) : null;

  const showMap = !empty && !stale;
  const dateLabel = targetDateLabel(target);
  const headline = showMap ? cityHeadline(asForecast(current.get(WEST)), asForecast(current.get(EAST)), dateLabel) : null;

  const tiles = useMemo(
    () => buildTiles(grid, current, layer, proj, cell.id),
    [grid, current, layer, proj, cell.id],
  );
  const labels: MapLabel[] = PLACES.filter((p) => p.onMap).map((p) => {
    const { x, y } = proj.project(p.lat, p.lon);
    return { x, y, text: p.name, anchor: 'middle', dot: true };
  });
  const markerPos = place ? proj.project(place.lat, place.lon) : null;
  const marker: MapMarker | null = markerPos;
  // Just below the outline, clear of the squares' own numbers and of the marker.
  const cityAt = proj.project(35.53, 51.33);

  return (
    <main className="page forecast">
      {empty ? (
        <section className="notice notice--lead">
          <h1>No forecasts yet</h1>
          <p>
            The daily forecast has not run yet, so there is nothing to show. The first forecast appears here after the next scheduled
            run, together with a record of how each one turned out.
          </p>
        </section>
      ) : null}

      {stale ? (
        <section role="alert" className="stale">
          <h1>No current forecast</h1>
          <p>
            The latest run is more than 48 hours old, so the forecast is hidden rather than shown out of date. Last run:{' '}
            {runDateLabel(latestIssued)}.
          </p>
        </section>
      ) : null}

      {showMap && headline ? (
        <>
          <div className="head">
            <div className="head__text">
              <div className="meta" data-testid="forecast-meta">
                <span>Forecast for {dateLabel}</span>
                <span className="chip" data-testid="updated">
                  Updated <time dateTime={latestIssued}>{updatedLabel(latestIssued)}</time>
                </span>
              </div>
              <h1>{headline.title}</h1>
              <p className="lede" data-testid="city-sub">
                {headline.sub}
              </p>
              {dayHasEnded(target, now) ? (
                <p className="small" data-testid="day-ended">
                  {dateLabel} has ended in Tehran. This is the last forecast issued for it; the next one appears after the next
                  scheduled run.
                </p>
              ) : null}
            </div>
            <div role="group" aria-label="Map layer" className="layers">
              {(['model', 'cams'] as const).map((l) => (
                <button key={l} type="button" aria-pressed={layer === l} className="layers__btn" onClick={() => setLayer(l)}>
                  {layerLabel(l)}
                </button>
              ))}
            </div>
          </div>

          <section className="mapgrid" aria-label="Forecast map">
            <div className="card mapcard">
              <RiskMap tiles={tiles} onPick={pickCell} labels={labels} marker={marker} cityLabel={cityAt} />
              <div className="mapnote">
                <span className="legend">
                  <span className="swatch swatch--below" aria-hidden="true" />▼ Below <span className="swatch swatch--above" aria-hidden="true" />▲ Above{' '}
                  <span data-testid="legend">{legendText(layer)}</span>
                </span>
                <span data-testid="map-note">
                  Each square is about 44 by 36 km. Everywhere inside it shares one forecast.
                </span>
              </div>
            </div>

            <aside className="side">
              <div className="card">
                <div className="field">
                  <label htmlFor="place">Check a place</label>
                  <select id="place" className="control" value={placeId} onChange={(e) => pickPlace(e.target.value)}>
                    <option value="">Select from the list, or tap the map</option>
                    {PLACES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <CellCard cell={cell} place={place} entry={current.get(cell.id)} target={target} inputs={inputs} />
              <div className="why">
                <strong>Why squares and not streets?</strong> The source model cannot see individual neighborhoods, so this map does not
                pretend to. It is modelled air, not readings from Tehran's stations, and it is not an official alert or medical advice.
              </div>
            </aside>
          </section>
        </>
      ) : null}

      <section className="twocol" aria-label="Record and seasons">
        <ForecastLog
          cellName={cell.name}
          rows={log}
          picker={
            showMap || empty
              ? undefined
              : { value: cell.id, options: grid.map((c) => ({ id: c.id, name: c.name })), onChange: pickCell }
          }
        />
        {history && profile && series.length > 0 ? (
          <SeasonCard cellName={cell.name} bars={series} range={spanOfHistory(profile).range} pooled={pooledRate(history)} />
        ) : null}
      </section>

      <section className="card limits" aria-labelledby="limits-h">
        <h2 id="limits-h">What to keep in mind</h2>
        <ul>
          <li>The values are modelled by CAMS and Open-Meteo, not measured at stations.</li>
          <li>Each square is about 44 by 36 km, and everywhere inside it shares one forecast. Nothing here is street-level.</li>
          <li>The chance is a model estimate that the day's average PM2.5 is above {THRESHOLD_TEXT}. It is not an official alert or medical advice.</li>
          <li>
            The model reads today's air up to noon in Tehran. When it forecasts live it may use forecast-based inputs, while its
            history used stored model runs, so a live forecast can behave differently from its test on past days.
          </li>
        </ul>
      </section>

      <section aria-label="About this project" className="card about">
        <div>
          <div className="small">The project</div>
          <div className="about__v">Logistic regression, written from scratch</div>
        </div>
        {profile ? (
          <div>
            <div className="small">Data</div>
            <div className="about__v">{spanOfHistory(profile).daysPerSquare.toLocaleString('en-US')} days of CAMS history per square</div>
          </div>
        ) : null}
        {model ? (
          <div className="about__result">
            <div className="small">On days it never trained on</div>
            <div className="about__v">{model.beats_baselines ? 'Beats both simple guesses' : 'Does not beat both simple guesses'}</div>
            <div className="small">{resultSentence(model)}</div>
          </div>
        ) : null}
        <div className="about__links">
          <Link to="/lab" className="btn btn--solid">
            See how it works
          </Link>
          {GITHUB_URL ? (
            <a href={GITHUB_URL} className="btn btn--link">
              GitHub
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
