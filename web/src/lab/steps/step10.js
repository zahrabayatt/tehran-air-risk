// Model Lab, step 10. Ported from the approved design draft docs/design/AirLabStep10.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
// The live model (version 2) has 19 inputs, so the worked day shows all 19 of them, with version 2's
// weights and scaling, instead of the draft's five.
import katex from 'katex';
import { fmt, num, sigmoid } from '../kit.js';

const THRESHOLD = 35.4;

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="sk" style="height:300px;border-radius:14px;margin-bottom:18px"></div><div class="split"><div class="sk" style="height:200px;border-radius:14px"></div><div class="sk" style="height:200px;border-radius:14px"></div></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 10 of 17</span>
      <h2 id="st">Vectorization</h2>
      <p class="goal">With many inputs, a prediction is many multiplications added up. A loop does them one by one; a dot product does them all at once, with the same answer, much faster.</p>
      <figure class="plot"><div class="phead"><b id="vhead">One day, many inputs</b><div class="hctl"><span id="adLab" class="adlab"></span></div></div>
   <div class="vec"><div class="vrow"><span class="vname">x <small>this day, scaled</small></span><div class="cells" id="xc"></div></div>
    <div class="vrow"><span class="vname">w <small>weights</small></span><div class="cells" id="wc"></div></div>
    <div class="vrow"><span class="vname">w × x</span><div class="cells" id="pc"></div></div></div>
   <div class="runbar"><div class="seg" role="group" aria-label="How to compute" id="mseg"><button class="on" data-m="loop" type="button">Loop, one at a time</button><button data-m="dot" type="button">Dot product, all at once</button></div>
    <button id="go" class="play2" type="button">▶ Run</button>
    <div class="result" aria-live="polite"><span>w · x + b =</span><b id="sum"></b><small id="sumNote"></small></div></div>
   <figcaption class="note" id="vnote"></figcaption></figure>
  <div class="two" style="margin-top:18px"><figure class="plot"><div class="phead"><b>Every day at once</b></div><div class="shapes" id="shapes"></div>
    <figcaption class="note" id="shnote"></figcaption></figure>
   <figure class="plot"><div class="phead"><b>How much faster</b></div><div class="race2" id="race"></div>
    <figcaption class="note">Training takes thousands of steps over every training day, for every candidate model. That is the difference between seconds and minutes.</figcaption></figure></div>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>For one day, a sum over the inputs.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>For all days at once: one matrix times a vector, then the sigmoid on each. NumPy runs this in fast compiled code.</p></div>`;

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
  season_sin: ['season, sine', ''],
  season_cos: ['season, cosine', ''],
  wx_temp: ['Forecast temperature', '°C'],
  wx_rh: ['Forecast humidity', '%'],
  wx_wind: ['Forecast wind', 'km/h'],
  wx_precip: ['Forecast rain', 'mm'],
  wx_blh: ['Forecast air ceiling', 'm'],
};
const fm = (v, d = 2) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const dateOf = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { setTimeout, dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let V = null,
    NAMES = [],
    UNITS = [],
    X = [],
    mode = 'loop',
    busy = false,
    live = true;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };
  const n = () => V.features.length;

  function cells() {
    const x = X;
    $('adLab').textContent = `${V.cell}, ${dateOf(V.day)}`;
    $('xc').innerHTML = x.map((v, j) => `<div class="cell" id="x${j}">${fm(v)}<small>${NAMES[j]}: ${fmt(V.x[j], Math.abs(V.x[j]) >= 100 ? 0 : 1)}${UNITS[j] ? ' ' + UNITS[j] : ''}</small></div>`).join('');
    $('wc').innerHTML = V.w.map((v, j) => `<div class="cell" id="w${j}">${fm(v, 3)}<small>${NAMES[j]}</small></div>`).join('');
    $('pc').innerHTML = x.map((v, j) => `<div class="cell prod" id="p${j}">${fm(v * V.w[j])}<small>${fm(v)} × ${fm(V.w[j], 3)}</small></div>`).join('');
    $('sum').textContent = '…';
    $('sumNote').textContent = 'press Run';
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function run() {
    if (busy) return;
    busy = true;
    cells();
    let total = 0;
    const hot = (j, v) =>
      ['x', 'w'].forEach((k) => {
        const e = $(k + j);
        if (e) e.classList.toggle('hot', v);
      });
    const nn = n();
    // the loop is paced so the whole run takes a few seconds however many inputs there are
    const step = Math.max(60, Math.round(2400 / nn));
    if (mode === 'loop') {
      for (let j = 0; j < nn; j++) {
        hot(j, true);
        await wait(step);
        if (!live) return;
        total += X[j] * V.w[j];
        $('p' + j).classList.add('on');
        $('sum').textContent = fm(total);
        $('sumNote').textContent = 'running total after ' + (j + 1) + ' of ' + nn;
        await wait(Math.round(step * 0.75));
        if (!live) return;
        hot(j, false);
      }
    } else {
      for (let j = 0; j < nn; j++) hot(j, true);
      await wait(400);
      if (!live) return;
      for (let j = 0; j < nn; j++) {
        $('p' + j).classList.add('on');
        total += X[j] * V.w[j];
      }
      await wait(250);
      if (!live) return;
      for (let j = 0; j < nn; j++) hot(j, false);
    }
    const z = total + V.b,
      p = sigmoid(z);
    $('sum').textContent = fm(z);
    const real = typeof V.actual === 'number' ? ` Tomorrow was ${V.actual > THRESHOLD ? 'unhealthy' : 'OK'}.` : '';
    $('sumNote').textContent = `(b = ${fm(V.b)} added). Through the sigmoid: a chance of ${fmt(p, 2)}, about ${Math.round(p * 10)} in 10.${real}`;
    busy = false;
  }
  function shapes(rows) {
    const nn = n();
    $('vhead').textContent = `One day, ${nn} inputs`;
    $('vnote').textContent = `Weights and scaling are version 2's, the model live today, trained on these ${nn} inputs. The highest hour of PM2.5 gets the largest weight: a sharp morning peak says more about tomorrow than the day's average.`;
    $('shnote').textContent = `The same dot product for every day is one matrix product: ${num(rows)} rows of ${nn} numbers times ${nn} weights gives ${num(rows)} values of z, and the sigmoid turns each into a chance.`;
    $('shapes').innerHTML = `<div class="mat" style="width:120px;height:150px">X<br>${num(rows)} × ${nn}</div><span class="op">·</span><div class="mat" style="width:34px;height:120px">w<br>${nn}</div><span class="op">+ b =</span><div class="mat" style="width:50px;height:150px">z<br>${num(rows)}</div>`;
    const v = V.vec,
      r = (v.numpy_ms / v.loop_ms) * 100;
    $('race').innerHTML = `<p class="small" style="margin:0 0 12px">A dot product of ${num(v.elements)} numbers, measured when the model was trained:</p>
   <div class="rrow"><span>Python loop</span><div class="rbar"><i style="width:100%" class="slow"></i></div><b>${fmt(v.loop_ms, 1)} ms</b></div>
   <div class="rrow"><span>NumPy @</span><div class="rbar"><i style="width:${r.toFixed(2)}%" class="fast"></i></div><b>${fmt(v.numpy_ms, 2)} ms</b></div>
   <p class="speed"><b>${Math.round(v.loop_ms / v.numpy_ms)}×</b> faster, the same result.</p>`;
  }
  on($('go'), 'click', () => {
    if (V) run();
  });
  $('mseg')
    .querySelectorAll('button')
    .forEach((b) =>
      on(b, 'click', () => {
        if (!V || busy) return;
        mode = b.dataset.m;
        $('mseg')
          .querySelectorAll('button')
          .forEach((x) => x.classList.toggle('on', x === b));
        cells();
      }),
    );
  katex.render('\\mathbf w\\cdot\\mathbf x=w_1x_1+w_2x_2+\\dots+w_nx_n=\\sum_{j=1}^{n}w_jx_j', $('m1'), { throwOnError: false, displayMode: true });
  katex.render('\\mathbf z=X\\mathbf w+b,\\qquad \\mathbf f=g(\\mathbf z)', $('m2'), { throwOnError: false, displayMode: true });

  Promise.all([ctx.load('lab-today'), ctx.load('lab-rows')]).then(([t, R]) => {
    if (!live) return;
    V = t;
    NAMES = t.features.map((f) => (INFO[f] ? INFO[f][0] : f));
    UNITS = t.features.map((f) => (INFO[f] ? INFO[f][1] : ''));
    X = t.x.map((v, j) => (v - t.mu[j]) / t.sigma[j]);
    const main = $('main');
    main.classList.remove('skel');
    main.setAttribute('aria-busy', 'false');
    cells();
    shapes(R.train.rows.length);
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
