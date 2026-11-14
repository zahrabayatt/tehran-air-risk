// Model Lab, step 17. Ported from the approved design draft docs/design/AirLabStep17.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
// The worked example is lab-today.json: a real forecast of the live model (version 2, 19 inputs).
import katex from 'katex';
import { fmt, sigmoid } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:420px;border-radius:14px"></div><div class="sk" style="height:300px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 17 of 17</span>
      <h2 id="st">Today's forecast</h2>
      <p class="goal">Everything together, for one real day. Take today's numbers, scale them with the training averages, multiply by the weights, add b, and pass the sum through the sigmoid. Out comes the chance shown on the forecast page.</p>
      <div class="split wide"><div><div class="phead"><b id="hd"></b></div><div class="wrapt" tabindex="0" role="region" aria-label="The worked example, every input"><table class="tbl" id="t"></table></div>
   <p class="note">Scaled = (today − average) ÷ spread, with the average and spread of the training days. Adds = weight × scaled.</p></div>
  <div class="nota"><h3>From sum to chance</h3><div class="kv" id="kv"></div><p class="callout" id="co"></p>
   <p class="note" style="margin-top:12px"><a href="#/" style="color:var(--ac)">See it on the forecast page →</a></p></div></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The whole model is this one line.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The chance that tomorrow is unhealthy.</p></div>`;

export const skHtml = '';

// Plain names and units for the model's inputs (the names are the columns of lab-today.json's features).
const INFO = {
  pm2_5_mean: ['PM2.5 average', 'μg/m³'],
  pm10_mean: ['PM10 average', 'μg/m³'],
  no2_mean: ['NO2 average', 'μg/m³'],
  so2_mean: ['SO2 average', 'μg/m³'],
  co_mean: ['CO average', 'μg/m³'],
  o3_mean: ['O3 average', 'μg/m³'],
  pm2_5_max: ['PM2.5 highest hour', 'μg/m³'],
  pm2_5_last: ['PM2.5 last hour', 'μg/m³'],
  temp_mean: ['Temperature today', '°C'],
  rh_mean: ['Humidity today', '%'],
  wind_mean: ['Wind today', ''],
  precip_sum: ['Rain today', 'mm'],
  season_sin: ['Season, sine', ''],
  season_cos: ['Season, cosine', ''],
  wx_temp: ['Forecast temperature', '°C'],
  wx_rh: ['Forecast humidity', '%'],
  wx_wind: ['Forecast wind', 'km/h'],
  wx_precip: ['Forecast rain', 'mm'],
  wx_blh: ['Forecast air ceiling', 'm'],
};
const sg = (v, d) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const date = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let live = true;
  katex.render('z=\\sum_j w_j\\,\\frac{x_j-\\mu_j}{\\sigma_j}+b', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('f=g(z)=\\frac1{1+e^{-z}}', $('m2'), { throwOnError: false, displayMode: true });

  ctx.load('lab-today').then((d) => {
    if (!live) return;
    const z = d.x.map((v, j) => (v - d.mu[j]) / d.sigma[j]),
      add = z.map((v, j) => v * d.w[j]),
      sum = add.reduce((a, b) => a + b, 0),
      zz = sum + d.b,
      p = sigmoid(zz),
      dec = (f) => (f.startsWith('season') ? 3 : 1);
    $('hd').textContent = `${d.cell}, ${date(d.day)}, forecasting ${date(d.target)}`;
    $('t').innerHTML =
      '<tr><th>Input</th><th>Today</th><th>Average</th><th>Spread</th><th>Scaled</th><th>Weight</th><th>Adds</th></tr>' +
      d.features
        .map(
          (f, j) =>
            `<tr><td>${(INFO[f] || [f])[0]}</td><td>${sg(d.x[j], dec(f))}</td><td>${sg(d.mu[j], dec(f))}</td><td>${fmt(d.sigma[j], dec(f))}</td><td>${sg(z[j], 2)}</td><td>${sg(d.w[j], 3)}</td><td style="color:var(${add[j] >= 0 ? '--warn' : '--ac'})">${add[j] >= 0 ? '+' : ''}${sg(add[j], 3)}</td></tr>`,
        )
        .join('') +
      `<tr class="sum"><td colspan="6">Sum</td><td>${sg(sum, 3)}</td></tr>`;
    $('kv').innerHTML = `<span>sum of adds</span><b id="kvsum">${sg(sum, 3)}</b><span>plus b</span><b>${sg(d.b, 3)}</b><span>z</span><b id="kvz">${sg(zz, 3)}</b><span>chance, g(z)</span><b id="kvp">${fmt(p, 3)}</b><span>on the page</span><b>${Math.round(p * 10)} in 10</b><span>what came</span><b>${d.actual} μg/m³</b>`;
    // the input that adds the most, the band the chance fell in, and what really happened
    const top = add.reduce((a, v, j) => (v > add[a] ? j : a), 0),
      f = d.features[top],
      [nm, unit] = INFO[f] || [f, ''],
      unhealthy = d.actual > 35.4,
      cal = d.held && d.held.calib,
      k = cal ? cal.bins.findIndex((lo, i) => p >= lo && p < cal.bins[i + 1]) : -1,
      n = k >= 0 ? cal.counts_y1[k] + cal.counts_y0[k] : 0,
      came = n ? Math.round((cal.counts_y1[k] / n) * 10) : null;
    $('co').innerHTML = `The ${/^[A-Z][a-z]/.test(nm) ? nm[0].toLowerCase() + nm.slice(1) : nm} (${fmt(d.x[top], Math.abs(d.x[top]) >= 100 ? 0 : 1)}${unit ? ' ' + unit : ''}) pushed hardest, adding ${sg(add[top], 2)} to the sum. The model gave <b>about ${Math.round(p * 10)} in 10</b> and the day ${unhealthy ? 'turned unhealthy' : 'stayed OK'}. One day proves nothing either way${came === null ? '' : `; step 16 showed that in this band about ${came} in 10 such days come unhealthy`}. The last five rows are tomorrow's weather forecast, which version 1 could not see.`;
    const main = $('main');
    main.classList.remove('skel');
    main.setAttribute('aria-busy', 'false');
  });
  return () => {
    live = false;
    dispose();
  };
}
