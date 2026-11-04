import { useEffect } from 'react';
import history from '../../public/data/history.json';
import profile from '../../public/data/profile.json';
import { GITHUB_URL } from '../config';
import './data.css';

const AIR_API_URL = 'https://open-meteo.com/en/docs/air-quality-api';
const EPA_URL = 'https://www.govinfo.gov/content/pkg/FR-2024-03-06/html/2024-02637.htm';
const THRESHOLD_TEXT = `above ${profile.threshold} μg/m³`;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The inputs the deployed model reads, in the order of model/model.json. A test compares this list with
 * that file, so the page cannot drift from the model.
 */
export const DEPLOYED_FEATURES = ['pm2_5_mean', 'pm2_5_max', 'pm2_5_last', 'season_sin', 'season_cos'];

const count = (n: number) => n.toLocaleString('en-US');

/** Positive days as a percentage of days, with one decimal. A bare "0%" is only ever a real zero. */
export function share(positives: number, days: number): string {
  if (positives === 0) return '0%';
  const pct = (positives / days) * 100;
  return pct < 0.05 ? '<0.1%' : `${pct.toFixed(1)}%`;
}

const DAY_MS = 86_400_000;
/** Whole days from `start` to `end` inclusive, both "YYYY-MM-DD". */
const daysBetween = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1;
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });

/** A bar for a share of days, scaled to `max` (a fraction); the number beside it carries the meaning, so the bar is hidden from screen readers. */
function RateBar({ positives, days, max }: { positives: number; days: number; max: number }) {
  return (
    <span className="ratebar">
      <span className="ratebar__track" aria-hidden="true">
        <span className="ratebar__fill" style={{ width: `${max > 0 && days > 0 ? (positives / days / max) * 100 : 0}%` }} />
      </span>
      <span className="ratebar__value mono">{share(positives, days)}</span>
    </span>
  );
}

export function DataPage() {
  useEffect(() => {
    document.title = 'Tehran Air Risk: Data';
  }, []);

  const { rows, splits, missing_hours: missing } = profile;
  const range = profile.labelled_range;
  const daysPerCell = daysBetween(range.start, range.end);
  const excluded = profile.cell_count * daysPerCell - profile.usable_cell_days;
  const removedAtStart = profile.usable_cell_days - rows.labelled_windows;
  const pooledPositives = profile.yearly.reduce((sum, y) => sum + y.positives, 0);

  const parts = [
    { key: 'train', name: 'Training', use: 'Fits the model', ...splits.train },
    { key: 'selection', name: 'Selection', use: 'Chooses features and penalty strength', ...splits.selection },
    { key: 'held_out', name: 'Held-out', use: 'Reported once, never used to choose', ...splits.held_out },
  ];
  const selectionPositives = splits.selection.positives;

  const fraction = (r: { positives: number; days: number }) => r.positives / r.days;
  const westByYear = new Map(history.by_year['west-tehran'].map((r) => [r.year, r]));
  const yearMax = Math.max(...profile.yearly.map(fraction), ...[...westByYear.values()].map(fraction));
  const months = [...history.by_month.pooled].sort((a, b) => a.month - b.month);
  const monthMax = Math.max(...months.map(fraction));
  const cells = [...profile.cells].sort((a, b) => b.positives - a.positives);
  const cellMax = Math.max(...cells.map((c) => c.positives / c.labelled_days));

  const funnel = [
    {
      label: 'Labelled cell-days',
      note: `${profile.cell_count} squares, ${count(daysPerCell)} days each, every day with at least 20 of 24 hourly values`,
      rows: profile.usable_cell_days,
      removed: null,
    },
    {
      label: 'With a full 12-hour input window',
      note: 'The history starts mid-window, so the first two days of each square have no row',
      rows: rows.labelled_windows,
      removed: removedAtStart,
    },
    {
      label: 'After removing summer-time days',
      note: 'Iran used +04:30 summer time until 2022-09-21, which moves the 12:00 cutoff; those days give no row',
      rows: rows.labelled_windows - rows.dst_dropped,
      removed: rows.dst_dropped,
    },
    {
      label: 'After removing rows with incomplete inputs',
      note: 'A row needs all 12 hours of all 10 inputs; nothing is filled in',
      rows: rows.dataset,
      removed: rows.incomplete_inputs_dropped,
    },
  ];

  return (
    <main className="page data-page">
      <div>
        <h1>Modeled air, not measured air</h1>
        <p className="lede">
          Every value comes from the CAMS atmospheric model through Open-Meteo. None of it comes directly from a
          monitoring station in Tehran.
        </p>
      </div>

      <dl className="data-facts">
        <div>
          <dt>Source</dt>
          <dd>
            <a href={AIR_API_URL}>Open-Meteo Air Quality API</a>
          </dd>
        </div>
        <div>
          <dt>Licence</dt>
          <dd>CC-BY 4.0, CAMS and Open-Meteo attribution</dd>
        </div>
        <div>
          <dt>Period</dt>
          <dd>{`${longDate(range.start)} to ${longDate(range.end)}`}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>About 44 by 36 km, a 12-cell map grid</dd>
        </div>
      </dl>

      <section className="data-section" aria-labelledby="sources-h">
        <h2 id="sources-h">Sources and licences</h2>
        <div className="data-scroll" role="region" aria-label="Sources table" tabIndex={0}>
          <table className="data-table" aria-label="Sources and licences">
            <thead>
              <tr>
                <th scope="col">Used for</th>
                <th scope="col">Source</th>
                <th scope="col">Licence and credit</th>
              </tr>
            </thead>
            <tbody>
              {profile.sources.map((s) => (
                <tr key={s.source}>
                  <td>{s.use.split(':')[0]}</td>
                  <td>{s.source}</td>
                  <td className="muted">
                    {s.licence}. Credit: {s.attribution}.
                  </td>
                </tr>
              ))}
              <tr>
                <td>City outline on the map</td>
                <td>OpenStreetMap contributors</td>
                <td className="muted">ODbL. Credit: © OpenStreetMap contributors.</td>
              </tr>
              <tr>
                <td>The 35.4 μg/m³ breakpoint</td>
                <td>
                  <a href={EPA_URL}>U.S. EPA, 89 FR 16202 (2024-03-06), Appendix G to 40 CFR Part 58</a>
                </td>
                <td className="muted">U.S. government work. The label is a modelling choice, not an official category.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          The values are modeled (CAMS), not station measurements. Open-Meteo&apos;s free tier is for non-commercial use, so this site has no
          ads or subscriptions.
        </p>
      </section>

      <section className="data-section" aria-labelledby="split-h">
        <div>
          <h2 id="split-h">How days are split</h2>
          <p className="small">
            Kept in time order, so the model is always tested on days after those it learned from. Dates are the day
            being predicted.
          </p>
        </div>
        <div className="splitbar" aria-hidden="true">
          {parts.map((p) => (
            <span key={p.key} className={`splitbar__part splitbar__part--${p.key}`} style={{ flexGrow: p.rows }}>
              {p.name}
            </span>
          ))}
        </div>
        <div className="data-scroll" role="region" aria-label="Split table" tabIndex={0}>
          <table className="data-table" aria-label="How days are split">
            <thead>
              <tr>
                <th scope="col">Part</th>
                <th scope="col" className="num">
                  Rows
                </th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col" className="num">
                  Positive rate
                </th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.key}>
                  <th scope="row">{p.name}</th>
                  <td className="num mono">{count(p.rows)}</td>
                  <td className="mono">{p.start}</td>
                  <td className="mono">{p.end}</td>
                  <td className="num mono">{share(p.positives, p.rows)}</td>
                  <td className="muted">{p.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small">
          The selection months are one warm half-year with only {selectionPositives} positive days out of{' '}
          {count(splits.selection.rows)} ({share(splits.selection.positives, splits.selection.rows)}). That is little to choose
          between settings with, so only two feature sets and five penalty strengths were compared.
        </p>
      </section>

      <div className="data-two">
        <section className="data-section" aria-labelledby="funnel-h">
          <h2 id="funnel-h">From labelled days to model rows</h2>
          <ol className="funnel" aria-label="From labelled days to model rows">
            {funnel.map((f) => (
              <li key={f.label} className="funnel__row">
                <span className="funnel__label">
                  {f.label}
                  <span className="funnel__note">
                    {f.removed === null ? '' : `Removed ${count(f.removed)}. `}
                    {f.note}
                  </span>
                </span>
                <span className="funnel__track" aria-hidden="true">
                  <span className="funnel__bar" style={{ width: `${(f.rows / profile.usable_cell_days) * 100}%` }} />
                </span>
                <span className="funnel__count mono">{count(f.rows)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card data-quality" aria-labelledby="quality-h">
          <h2 id="quality-h">Data quality</h2>
          <dl className="data-pairs">
            <dt>Usable cell-days</dt>
            <dd className="mono">{count(profile.usable_cell_days)}</dd>
            <dt>Hours checked</dt>
            <dd className="mono">{count(missing.hours_checked)}</dd>
            <dt>Missing hours</dt>
            <dd className="mono">{count(missing.count)}</dd>
            <dt>Days excluded under 20 of 24 hours</dt>
            <dd className="mono">{count(excluded)}</dd>
            <dt>Rows dropped, summer-time days</dt>
            <dd className="mono">{count(rows.dst_dropped)}</dd>
            <dt>Rows dropped, incomplete inputs</dt>
            <dd className="mono">{count(rows.incomplete_inputs_dropped)}</dd>
          </dl>
          <p className="small">
            Hours checked are every hour from each square&apos;s first to last stored hour. An hour counts as missing if
            it is absent or any of its ten inputs is empty. Nothing is filled in or estimated.
          </p>
        </section>
      </div>

      <section className="data-section" aria-labelledby="years-h">
        <div>
          <h2 id="years-h">Days {THRESHOLD_TEXT}, by year</h2>
          <p className="small">
            Rates over all labelled days, pooled over the {profile.cell_count} squares: {share(pooledPositives, profile.usable_cell_days)} of{' '}
            {count(profile.usable_cell_days)} cell-days. They describe the whole history, including days the model was
            later tested on, so they are context and not what the model learned from.
          </p>
        </div>
        <div className="data-scroll" role="region" aria-label="Yearly rates table" tabIndex={0}>
          <table className="data-table" aria-label="Positive days by year">
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  Cell-days
                </th>
                <th scope="col">All {profile.cell_count} squares</th>
                <th scope="col">West Tehran square</th>
              </tr>
            </thead>
            <tbody>
              {profile.yearly.map((y) => {
                const west = westByYear.get(y.year);
                return (
                  <tr key={y.year}>
                    <th scope="row">
                      {y.year}
                      {y.days < 365 * profile.cell_count ? <span className="muted"> (partial)</span> : null}
                    </th>
                    <td className="num mono">{count(y.days)}</td>
                    <td>
                      <RateBar positives={y.positives} days={y.days} max={yearMax} />
                    </td>
                    <td>
                      <RateBar positives={west?.positives ?? 0} days={west?.days ?? 1} max={yearMax} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small">
          The rate changes from year to year. Part of that may come from changes in the CAMS model and not only the air,
          so the history should be read with care. 2022 starts on {longDate(range.start)} and 2026 ends on{' '}
          {longDate(range.end)}.
        </p>
      </section>

      <section className="data-section" aria-labelledby="months-h">
        <div>
          <h2 id="months-h">Days {THRESHOLD_TEXT}, by calendar month</h2>
          <p className="small">
            All labelled days, pooled over the {profile.cell_count} squares. High-pollution days are mostly a
            cold-season pattern, and the selection months (May to early November) are mostly the quiet part of the year.
          </p>
        </div>
        <div className="data-scroll" role="region" aria-label="Monthly rates table" tabIndex={0}>
          <table className="data-table" aria-label="Positive days by calendar month">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">
                  Cell-days
                </th>
                <th scope="col">All {profile.cell_count} squares</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{MONTH_NAMES[m.month - 1]}</th>
                  <td className="num mono">{count(m.days)}</td>
                  <td>
                    <RateBar positives={m.positives} days={m.days} max={monthMax} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="data-section" aria-labelledby="cells-h">
        <div>
          <h2 id="cells-h">Each map square</h2>
          <p className="small">
            Every square has {count(daysPerCell)} labelled days. The squares differ a great deal, so the pooled rate hides
            most of the story. Rates are over all labelled days.
          </p>
        </div>
        <div className="data-scroll" role="region" aria-label="Squares table" tabIndex={0}>
          <table className="data-table" aria-label="Each map square">
            <thead>
              <tr>
                <th scope="col">Square</th>
                <th scope="col" className="num">
                  Labelled days
                </th>
                <th scope="col">Days {THRESHOLD_TEXT}</th>
                <th scope="col" className="num">
                  Mean PM2.5 (μg/m³)
                </th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.name}</th>
                  <td className="num mono">{count(c.labelled_days)}</td>
                  <td>
                    <RateBar positives={c.positives} days={c.labelled_days} max={cellMax} />
                  </td>
                  <td className="num mono">{c.mean_pm25.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="data-section" aria-labelledby="fields-h">
        <h2 id="fields-h">Fields used</h2>
        <div className="data-scroll" role="region" aria-label="Fields table" tabIndex={0}>
          <table className="data-table" aria-label="Fields used">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Time available</th>
                <th scope="col">Use</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>PM2.5, PM10, NO2, SO2, CO, O3</td>
                <td>Modeled</td>
                <td>Hourly, today up to 12:00 Tehran time</td>
                <td className="muted">Input features: the mean of the 12 hours; for PM2.5 also its highest and latest hour</td>
              </tr>
              <tr>
                <td>Temperature, humidity, wind speed, precipitation</td>
                <td>Weather model</td>
                <td>Hourly, today up to 12:00 Tehran time</td>
                <td className="muted">Candidate input features, not kept in the deployed model</td>
              </tr>
              <tr>
                <td>Day of year</td>
                <td>Calendar</td>
                <td>Always known</td>
                <td className="muted">Input as sine and cosine</td>
              </tr>
              <tr>
                <td>Tomorrow&apos;s mean PM2.5</td>
                <td>Modeled</td>
                <td>After the target day</td>
                <td className="muted">Label only, never an input</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small">
          Fourteen candidate inputs were built from these fields. The deployed model reads {DEPLOYED_FEATURES.length}{' '}
          of them: <span className="mono">{DEPLOYED_FEATURES.join(', ')}</span>. The larger set scored worse on the
          selection months. CAMS&apos;s own forecast for tomorrow is never an input, because the model would then be a
          copy of that forecast.
        </p>
      </section>

      <section className="data-section" aria-labelledby="limits-h">
        <h2 id="limits-h">Limitations</h2>
        <ul className="data-limits" aria-label="Limitations">
          <li>
            The data is modeled, not station measurements, on squares of about 44 by 36 km. Every place inside a square
            shares one value, so nothing here is street-level or neighborhood-level. This is not an official alert or
            medical advice.
          </li>
          <li>
            Live inputs may differ from the stored history the model was trained on. Measured on 2026-11-03, the live
            values were identical to the stored ones for the seven days they overlap; whether hours are revised later has
            not been checked yet. The comparison is in the &quot;Live vs history&quot; section of{' '}
            {GITHUB_URL ? <a href={`${GITHUB_URL}/blob/main/docs/DATA_PROFILE.md`}>docs/DATA_PROFILE.md</a> : 'docs/DATA_PROFILE.md in the repository'}.
          </li>
          <li>
            The label is a day mean of modeled PM2.5 {THRESHOLD_TEXT}. The EPA cuts a mean to one decimal before it
            looks up a category, which would change 9 of the {count(profile.usable_cell_days)} cell-days, so the site
            claims no official category.
          </li>
          <li>
            The selection months are a warm half-year with {selectionPositives} positive days. That limits how well the
            model&apos;s settings could be chosen, and the Model Lab says so where it matters.
          </li>
          <li>
            The history is about four years. Part of the change between years may come from changes in the CAMS model, so
            a past rate is not a promise about the next one.
          </li>
        </ul>
        <p className="small">
          Numbers on this page are computed from <span className="mono">profile.json</span> and{' '}
          <span className="mono">history.json</span>, written by <span className="mono">training/export_data.py</span>.
        </p>
      </section>
    </main>
  );
}
