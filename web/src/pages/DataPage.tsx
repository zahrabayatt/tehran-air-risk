import { useEffect, useState } from 'react';
import data from '../../public/data/data-page.json';
import { cautiousRuns, isOver, runsText } from '../lab/cautious';
import './data.css';

/**
 * The Data page. Layout and words follow docs/design/AirDataV2.html; every number comes from
 * web/public/data/data-page.json (training/export_site.py), none is typed here.
 */

interface CalibBin {
  from: number;
  to: number;
  yes: number;
  no: number;
}

const count = (n: number) => n.toLocaleString('en-US');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const MONTH_LETTERS = 'JFMAMJJASOND';
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Aug 2022" from "2022-08-04". */
const monthYear = (iso: string) => `${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "15 Mar 2024" from "2024-03-15". */
const dayMonthYear = (iso: string) => `${Number(iso.slice(8, 10))} ${monthYear(iso)}`;

/** A share as a number of dots out of ten. */
export const tenth = (v: number) => Math.min(10, Math.max(0, Math.round(v * 10)));

const wordsFor = (v: number) => {
  const n = tenth(v);
  return n === 0 ? 'under 1 in 10' : n === 10 && v < 1 ? 'almost 10 in 10' : `${n} in 10`;
};

const asBand = (c: CalibBin) => ({ lo: c.from, hi: c.to, s: c.yes / (c.yes + c.no), n: c.yes + c.no });

/** Unhealthy air came more often than the top of the range the model said (the same rule as Lab step 16). */
export const isShaded = (c: CalibBin) => isOver(asBand(c));

function Dots({ n }: { n: number }) {
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  );
}

const rangeLabel = (c: CalibBin) =>
  c.from === 0 ? 'under 1 in 10' : c.to === 1 ? '9 in 10 or more' : `${Math.round(c.from * 10)} to ${Math.round(c.to * 10)} in 10`;

function CalibNote({ calib }: { calib: CalibBin[] }) {
  const runs = cautiousRuns(calib.map(asBand));
  const got = (c: CalibBin) => c.yes / (c.yes + c.no);
  const others = calib.filter((c) => !isShaded(c)).map(rangeLabel);
  const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others.join('');
  // Two worked examples from the middle, taken only from rows that are shaded.
  const examples = [calib[4], calib[6]].filter((c) => c && isShaded(c));
  return (
    <p className="flag" id="calibnote">
      <b>Too cautious{runs.length ? ` from ${runsText(runs)}.` : '.'}</b> In the shaded rows unhealthy air came more often than
      the model said.
      {examples.length === 2 && (
        <>
          {' '}
          When it said {Math.round(examples[0].from * 10)} to {Math.round(examples[0].to * 10)} in 10, unhealthy air came about{' '}
          {tenth(got(examples[0]))} in 10; when it said {Math.round(examples[1].from * 10)} to {Math.round(examples[1].to * 10)} in
          10, it came about {tenth(got(examples[1]))} in 10.
        </>
      )}
      {others.length > 0 && <> In the other rows ({list}) it came no more often than the model said.</>} So read &quot;Probably
      OK&quot; with 3 or 4 dots as &quot;could go either way&quot;.
    </p>
  );
}

const SOURCES = [
  ['Air (PM2.5 and other pollutants)', 'Open-Meteo Air Quality API, CAMS global', 'CC-BY 4.0. Copernicus Atmosphere Monitoring Service and Open-Meteo.'],
  ['Weather forecast', 'Open-Meteo, ECMWF IFS (00 UTC run)', 'CC-BY 4.0. Open-Meteo and ECMWF.'],
  ['City and neighbourhood borders', 'OpenStreetMap', 'ODbL. © OpenStreetMap contributors.'],
  ['The 35.4 μg/m³ line', 'US EPA air quality index, 2024 update', 'US government work. A modelling choice, not an official category.'],
];

export function DataPage() {
  const { facts, rows, splits, calib, cost, baselines, cells } = data;
  const byRate = [...cells].sort((a, b) => b.rate - a.rate);
  useEffect(() => {
    document.title = 'Tehran Air Risk: Data';
  }, []);
  const [square, setSquare] = useState('west-tehran');
  const months = (data.by_month as Record<string, number[]>)[square];
  const top = Math.max(...months, 0.01);
  const squareName = cells.find((c) => c.id === square)?.name ?? square;

  const betterGuess = Math.min(baselines.overall, baselines.monthly);
  const times = Math.round((betterGuess / cost.held_out) * 2) / 2;

  const steps: [string, string, number][] = [
    ['Days with a result', 'at least 20 of 24 hours from the model, in 12 squares', facts.square_days],
    ['With a full morning window', 'the 12 hours up to noon in Tehran; the first two days of the history have none', rows.labelled_windows],
    [
      'Without the old summer-time days',
      'until September 2022 Iran moved its clocks, which moves noon; those days are left out',
      rows.dataset,
    ],
    [
      "With tomorrow's weather forecast",
      `the weather forecast as it was made each morning exists from ${monthYear(splits.train.start)} on`,
      rows.with_weather,
    ],
  ];

  return (
    <main className="page data-page">
      <h1>Where the forecast comes from</h1>
      <p className="lede">
        Every number on this site is modelled air, from the CAMS model through Open-Meteo. None of it is a reading from one of
        Tehran&apos;s air stations.
      </p>

      <ul className="facts" aria-label="Four facts">
        {[
          ['CAMS', 'modelled air, not station readings'],
          [`${monthYear(facts.start)} to ${monthYear(facts.end)}`, 'about four years of hours'],
          ['12 squares', 'about 44 by 36 km each; Tehran falls in four'],
          [count(facts.square_days), `days with a result (${count(facts.days_per_square)} in each square), no missing hours`],
        ].map(([b, s]) => (
          <li className="fact" key={b}>
            <b>{b}</b>
            <span>{s}</span>
          </li>
        ))}
      </ul>

      <section className="card" aria-labelledby="h-r">
        <h2 id="h-r">Can you trust &quot;about 3 in 10&quot;?</h2>
        <p className="sub">
          For a whole year the model was never trained on, every forecast was kept and checked. When the model gave a chance, how
          often did unhealthy air actually come? If its chances are honest, the two rows of dots match.
        </p>
        <div className="cr head" aria-hidden="true">
          <span>The model said</span>
          <span>Unhealthy air came</span>
          <span className="n">days</span>
        </div>
        <ul className="calib" aria-label="What the model said, and how often unhealthy air came">
          {calib.map((c) => {
            const n = c.yes + c.no;
            const got = c.yes / n;
            const said = (c.from + c.to) / 2;
            return (
              <li key={c.from} className={`cr${isShaded(c) ? ' off' : ''}`}>
                <span>
                  <span className="lbl">It said</span>
                  <Dots n={c.from === 0 ? 0 : tenth(said)} />
                  <small>{rangeLabel(c)}</small>
                </span>
                <span>
                  <span className="lbl">Unhealthy air came</span>
                  <Dots n={tenth(got)} />
                  <small>{wordsFor(got)}</small>
                </span>
                <span className="n">
                  {c.yes} of {n}
                </span>
              </li>
            );
          })}
        </ul>
        <CalibNote calib={calib} />
        <details>
          <summary>Compared with simple guesses</summary>
          <p className="note">
            On the same year, the model&apos;s cost (lower is better) was {cost.held_out.toFixed(3)}, against{' '}
            {baselines.overall.toFixed(3)} for always guessing the usual share of unhealthy days and {baselines.monthly.toFixed(3)}{' '}
            for guessing each calendar month&apos;s usual share. It is about {times} times as good as either.
          </p>
        </details>
      </section>

      <section className="card" aria-labelledby="h-s">
        <h2 id="h-s">When and where the air turns unhealthy</h2>
        <p className="sub">
          Share of days above the line, all days from {monthYear(facts.start)} to {monthYear(facts.end)}.
        </p>
        <label className="pick" htmlFor="sqpick">
          Square
          <select id="sqpick" value={square} onChange={(e) => setSquare(e.target.value)}>
            {byRate.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="months" role="img" aria-label={`${squareName}: share of unhealthy days by month`}>
          {months.map((v, i) => (
            <div className="mo" key={i}>
              <b>{Math.round(v * 100)}</b>
              <span className="track">
                <i style={{ height: `${(v / top) * 100}%` }} />
              </span>
              <span>{MONTH_LETTERS[i]}</span>
            </div>
          ))}
        </div>
        <ul className="sq" aria-label="Share of unhealthy days in each square">
          {byRate.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <b>{c.rate > 0 && c.rate < 0.005 ? 'under 1%' : pct(c.rate)}</b>
              <span className="muted">of days</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="h-u">
        <h2 id="h-u">How the days are used</h2>
        <p className="sub">Kept in time order, so the model is always tested on days after the ones it learned from.</p>
        <div className="time">
          <div className="t-learn">
            <b>Learn</b>
            <span>
              {dayMonthYear(splits.train.start)} to {dayMonthYear(splits.train.end)}: {count(splits.train.rows)} square-days. The
              model learns its weights.
            </span>
          </div>
          <div className="t-choose">
            <b>Choose</b>
            <span>
              {dayMonthYear(splits.selection.start)} to {dayMonthYear(splits.selection.end)}: {count(splits.selection.rows)}. Picks
              the version.
            </span>
          </div>
          <div className="t-test">
            <b>Test</b>
            <span>
              {dayMonthYear(splits.held_out.start)} to {dayMonthYear(splits.held_out.end)}: {count(splits.held_out.rows)}. The final
              check.
            </span>
          </div>
        </div>
        <p className="note">
          The test year was already used once, to check version 1 of the model. The weather model is chosen on the choosing months
          alone, and its test-year numbers are a second look at those days, said openly.
        </p>
      </section>

      <section className="card" aria-labelledby="h-d">
        <h2 id="h-d">From hours to forecast days</h2>
        <p className="sub">
          Each day in each square becomes one example: the morning&apos;s air and tomorrow&apos;s weather forecast, and whether
          the next day turned out unhealthy.
        </p>
        <ul className="steps" aria-label="From hours to forecast days">
          {steps.map(([t, s, v]) => (
            <li className="step" key={t}>
              <span>
                {t}
                <small>{s}</small>
              </span>
              <span className="bar" aria-hidden="true">
                <i style={{ width: `${(v / facts.square_days) * 100}%` }} />
              </span>
              <span className="n">{count(v)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="h-k">
        <h2 id="h-k">What the forecast cannot see</h2>
        <ul className="limits">
          <li>
            <b>Real readings.</b> CAMS is a model of the air, not a measurement. Tehran&apos;s air stations can show a different
            picture, especially in the city centre.
          </li>
          <li>
            <b>Streets and neighbourhoods.</b> One value covers a square of about 44 by 36 km.
          </li>
          <li>
            <b>Sudden events.</b> Dust storms from far away, fires, or a sudden change in traffic can surprise it.
          </li>
          <li>
            <b>Official categories.</b> It answers one question, above 35.4 μg/m³ or not. It is not an official alert or medical
            advice.
          </li>
        </ul>
        <details>
          <summary>Sources and licences</summary>
          <table className="sources">
            <thead>
              <tr>
                <th>Used for</th>
                <th>Source</th>
                <th>Licence and credit</th>
              </tr>
            </thead>
            <tbody>
              {SOURCES.map(([a, b, c]) => (
                <tr key={a}>
                  <td data-label="Used for">{a}</td>
                  <td data-label="Source">{b}</td>
                  <td data-label="Licence and credit">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </main>
  );
}
