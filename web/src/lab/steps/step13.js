// Model Lab, step 13. Ported from the approved design draft docs/design/AirLabStep13.html:
// the markup, then mount(), which runs the step's interactive code once its markup is on the page.
// The ladder of input sets reads model.json (version 1 as deployed, and the lowest choosing cost of each
// version 2 set); the three real days and the year plot come from lab-rows.json.
import katex from 'katex';
import { css, el, fmt, onTheme } from '../kit.js';

export const html = `<div id="main" class="skel" aria-busy="true">
    <div class="skonly" aria-hidden="true">
      <section class="card"><div class="sk" style="width:90px;height:14px;margin-bottom:12px"></div><div class="sk" style="width:40%;height:30px;margin-bottom:12px"></div><div class="sk" style="width:70%;height:16px;margin-bottom:22px"></div>
        <div class="split"><div class="sk" style="height:220px;border-radius:14px"></div><div class="sk" style="height:220px;border-radius:14px"></div></div></section>
      <section class="card"><div class="sk" style="height:200px;border-radius:14px"></div></section>
    </div>
    <div class="live">
    <section class="card" aria-labelledby="st">
      <span class="tag">Step 13 of 17</span>
      <h2 id="st">Feature engineering</h2>
      <p class="goal">The model can only learn from the inputs you give it. Here are the two this model is built on: tomorrow's weather, which today's air cannot show, and the time of year, written so that 31 December sits next to 1 January.</p>
      <h3 class="sub">Same morning, different tomorrow</h3><div class="trio" id="trio"></div><p class="note2" id="trioNote"></p>
  <div class="two" style="margin-top:18px"><div class="box"><h3>Build a season input</h3><p class="zf">season = ( sin(2π × day / 365.25), cos(2π × day / 365.25) )</p>
    <p class="small">One number for the date would put 31 December and 1 January a whole year apart, though their air is alike. Two numbers, the date's place on a circle, put them side by side.</p>
    <p class="small"><b>The weather inputs</b> are tomorrow's wind, air ceiling, rain, temperature and humidity over the whole of tomorrow, from ECMWF's forecast run that starts at 03:30 Tehran time (step 2).</p></div>
   <div class="box"><h3>For the three days</h3><table class="zt" id="seaT"></table></div></div>
  <figure class="plot" style="margin-top:18px"><div class="phead"><b>How often tomorrow was unhealthy, through the year</b><div class="seg" role="group" aria-label="How the date is written" id="vseg"><button class="on" data-v="line" type="button">Day number</button><button data-v="circle" type="button">On a circle</button></div></div>
   <div class="pbox"><svg id="yr" viewBox="0 0 1060 380" width="100%" role="img" aria-label="Each week of the year, coloured by how often tomorrow was unhealthy"></svg></div>
   <figcaption class="note" id="yrNote"></figcaption></figure>
    </section>
    <section class="card" aria-labelledby="st2"><h2 id="st2" style="margin-top:0">Which inputs earn their place</h2>
  <p class="goal">The cost on the choosing months (May to November 2025) for each set of inputs the weather check tried. Lower is better.</p>
  <div class="ladder" id="ladder"></div>
  <p class="small" id="ladderNote"></p>
    </section>
    </div>
  </div>`;

export const mathHtml = `<div class="mrow" tabindex="0"><span id="m1"></span><p>The date as a point on a circle.</p></div>
        <div class="mrow" tabindex="0"><span id="m2"></span><p>The weather model's inputs: what today looked like, when in the year it is, and what tomorrow's weather is forecast to do.</p></div>`;

export const skHtml = '';

const CELLN = {
  'east-tehran': 'East Tehran',
  'far-east': 'Far east',
  'far-northeast': 'Far northeast',
  'far-southeast': 'Far southeast',
  'far-west': 'Far west',
  'north-tehran': 'North Tehran',
  'northeast-tehran': 'Northeast Tehran',
  'northwest-alborz': 'Northwest Alborz',
  'south-central': 'South central',
  'southeast-plain': 'Southeast plain',
  'southwest-plain': 'Southwest plain',
  'west-tehran': 'West Tehran',
};
const dateOf = (doy) => {
  const d = new Date(Date.UTC(2025, 0, 1));
  d.setUTCDate(doy);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
};
// The version 2 input sets, simplest first; each shows its lowest choosing cost over its lambdas.
const SETS = [
  ['pm_season', 'PM2.5 and season', 'history from March 2024 only'],
  ['all', 'All 14 inputs of today', 'every reading of today, no weather'],
  ['pm_season_wx', 'PM2.5, season and weather', 'adds the five weather inputs'],
  ['all_wx', 'All inputs and weather', ''],
];

/** Runs the step. `ctx.load(name)` gives its data; the returned function stops everything it started. */
export function mount(ctx) {
  const { dispose } = ctx.scope();
  const $ = (id) => document.getElementById(id);
  let weeks = [],
    view = 'line',
    live = true,
    ready = false;
  const off = [];
  const on = (t, ev, fn) => {
    t.addEventListener(ev, fn);
    off.push(() => t.removeEventListener(ev, fn));
  };

  function trio(R) {
    const d = R.train,
      c = (n) => d.cols.indexOf(n),
      rs = d.rows.filter((r) => r[c('pm2_5_mean')] >= 38 && r[c('pm2_5_mean')] <= 48);
    const a = rs.filter((r) => r[c('y')]).sort((p, q) => p[c('wx_wind')] - q[c('wx_wind')])[0],
      b = rs.filter((r) => !r[c('y')]).sort((p, q) => q[c('wx_wind')] - p[c('wx_wind')])[0],
      e = rs.filter((r) => !r[c('y')] && r !== b).sort((p, q) => q[c('wx_precip')] - p[c('wx_precip')])[0];
    const T = [a, b, e].filter(Boolean),
      F = [
        ['PM2.5 today', 'pm2_5_mean', 80, '--warn'],
        ['Wind tomorrow', 'wx_wind', 30, '--ac'],
        ['Air ceiling tomorrow', 'wx_blh', 2500, '--ac'],
        ['Rain tomorrow', 'wx_precip', 15, '--cn'],
      ];
    $('trio').innerHTML = T.map(
      (r) =>
        `<div class="flat"><div class="hd"><b>${dateOf(r[c('doy')])}</b><span>${CELLN[R.cells[r[c('cell')]]] || R.cells[r[c('cell')]]}</span></div><span class="out ${r[c('y')] ? 'u' : 'ok'}">Tomorrow: ${r[c('y')] ? 'unhealthy' : 'OK'}</span>` +
        F.map(
          ([nm, k, mx, col]) =>
            `<div class="rowb"><span>${nm}</span><div class="tr"><i style="width:${Math.min(100, (r[c(k)] / mx) * 100).toFixed(1)}%;background:var(${col})"></i></div><b>${fmt(r[c(k)], k === 'wx_blh' ? 0 : 1)}</b></div>`,
        ).join('') +
        '</div>',
    ).join('');
    $('trioNote').textContent = `All three mornings had about the same PM2.5 (${T.map((r) => fmt(r[c('pm2_5_mean')], 0)).join(', ')} μg/m³). Only the first stayed unhealthy: still air and a low air ceiling held the dust in. Wind or rain cleared the other two. Today's air alone cannot tell them apart; tomorrow's weather can.`;
    const sc = (doy) => {
      const an = (2 * Math.PI * doy) / 365.25;
      return [fmt(Math.sin(an), 2), fmt(Math.cos(an), 2)];
    };
    $('seaT').innerHTML =
      '<tr><th>Day</th><th>Day of year</th><th style="text-align:right">sine</th><th style="text-align:right">cosine</th></tr>' +
      T.map((r) => {
        const dd = r[c('doy')],
          [s, co] = sc(dd);
        return `<tr><td>${dateOf(dd)}</td><td>${dd}</td><td class="z">${s}</td><td class="z">${co}</td></tr>`;
      }).join('') +
      [
        ['31 December', 365],
        ['1 January', 1],
      ]
        .map(([nm, dd]) => `<tr><td>${nm}</td><td>${dd}</td><td class="z">${sc(dd)[0]}</td><td class="z">${sc(dd)[1]}</td></tr>`)
        .join('');
  }

  function drawYear() {
    const s = $('yr');
    s.innerHTML = '';
    if (!weeks.length) return;
    const mx = Math.max(...weeks.map((w) => w.share)),
      col = (w) => css(w.share > 0.15 ? '--warn' : '--ac'),
      op = (w) => 0.25 + (0.75 * w.share) / mx;
    if (view === 'line') {
      const L = 60,
        R = 1030,
        yb = 230,
        fx = (d) => L + ((d - 1) / 365) * (R - L);
      el(s, 'line', { x1: L, x2: R, y1: yb, y2: yb, stroke: css('--rule'), 'stroke-width': 2 });
      weeks.forEach((w) => {
        const h = (w.share / mx) * 150;
        el(s, 'rect', { x: fx(w.doy) - 7, y: yb - h, width: 14, height: h, rx: 3, fill: col(w), 'fill-opacity': op(w) });
      });
      [['1 Jan', 1], ['1 Apr', 91], ['1 Jul', 182], ['1 Oct', 274], ['31 Dec', 365]].forEach(([t, d]) =>
        el(s, 'text', { x: fx(d), y: yb + 22, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, t),
      );
      el(s, 'path', { d: `M${fx(365)} ${yb + 36} q ${-(fx(365) - fx(1)) / 2} 60 ${-(fx(365) - fx(1))} 0`, fill: 'none', stroke: css('--warn'), 'stroke-dasharray': '5 5' });
      el(s, 'text', { x: (L + R) / 2, y: yb + 92, 'text-anchor': 'middle', 'font-size': 13, fill: css('--warn') }, '31 December and 1 January: 364 apart as day numbers, though both are dusty winter days');
    } else {
      const cx = 530,
        cy = 190,
        r = 150;
      el(s, 'circle', { cx, cy, r, fill: 'none', stroke: css('--rule'), 'stroke-width': 2 });
      weeks.forEach((w) => {
        const a = (2 * Math.PI * w.doy) / 365.25;
        el(s, 'circle', { cx: cx + r * Math.sin(a), cy: cy - r * Math.cos(a), r: 4 + (10 * w.share) / mx, fill: col(w), 'fill-opacity': op(w) });
      });
      [['1 Jan', 1], ['1 Apr', 91], ['1 Jul', 182], ['1 Oct', 274]].forEach(([t, d]) => {
        const a = (2 * Math.PI * d) / 365.25;
        el(s, 'text', { x: cx + (r + 34) * Math.sin(a), y: cy - (r + 34) * Math.cos(a) + 5, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, t);
      });
      el(s, 'text', { x: cx, y: cy - 4, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'sine across,');
      el(s, 'text', { x: cx, y: cy + 14, 'text-anchor': 'middle', 'font-size': 13, fill: css('--mut') }, 'cosine up');
    }
    $('yrNote').textContent =
      view === 'line'
        ? 'Each bar is a week of the training days; its height and colour show how often tomorrow was unhealthy. As a single day number, the dusty weeks of late December and early January sit at opposite ends.'
        : 'The same weeks placed by sine and cosine of the date: the dusty winter weeks now sit together around the top, across New Year, and the model can learn one "winter" shape.';
  }

  function ladder(M) {
    const best = (fs) => M.candidates.filter((c) => c.feature_set === fs).reduce((a, c) => (c.selection_cost < a.selection_cost ? c : a));
    const rungs = [{ name: 'Version 1 (PM2.5 and season, full history)', sub: 'the model before the weather check', v: M.previous.cost.selection }];
    for (const [fs, name, sub] of SETS) {
      const c = best(fs);
      rungs.push({ name, sub: `${c.features.length} inputs, λ = ${c.lambda}` + (sub ? `, ${sub}` : ''), v: c.selection_cost, live: !!c.chosen });
    }
    const vs = rungs.map((r) => r.v),
      lo = Math.floor((Math.min(...vs) - 0.001) * 1000) / 1000,
      hi = Math.ceil((Math.max(...vs) + 0.0005) * 1000) / 1000;
    $('ladder').innerHTML =
      rungs
        .map(
          (r) =>
            `<div class="rung${r.live ? ' live' : ''}"><span class="lb">${r.name}${r.live ? '<span class="tag2">the weather model</span>' : ''}<small>${r.sub}</small></span><div class="tr"><i style="width:${(((r.v - lo) / (hi - lo)) * 100).toFixed(1)}%"></i></div><b>${r.v.toFixed(4)}</b></div>`,
        )
        .join('') + `<p class="small" style="margin:0">Bars start at ${lo.toFixed(3)} to show the differences.</p>`;
    const pct = Math.round((1 - best('all_wx').selection_cost / best('all').selection_cost) * 100);
    $('ladderNote').textContent = `Weather lowers the cost by about ${pct}%. On a quiet half-year that is a likely gain, not a sure one: in resamples of whole days it won 86% of the time. It is kept because it is the one input that can see tomorrow's air change. Adding inputs always lowers the training cost, so the real test is on days the model has never seen: steps 14 to 16.`;
  }

  const buttons = document.querySelectorAll('#main #vseg button');
  buttons.forEach((b) =>
    on(b, 'click', () => {
      if (!ready) return;
      view = b.dataset.v;
      buttons.forEach((x) => x.classList.toggle('on', x === b));
      drawYear();
    }),
  );
  off.push(onTheme(() => ready && drawYear()));
  katex.render('x_{\\sin}=\\sin\\frac{2\\pi d}{365.25},\\qquad x_{\\cos}=\\cos\\frac{2\\pi d}{365.25}', $('m1'), { throwOnError: false, displayMode: true });
  katex.render("\\mathbf x=[\\text{today's air},\\ \\text{season},\\ \\text{tomorrow's wind, air ceiling, rain, temperature, humidity}]", $('m2'), { throwOnError: false, displayMode: true });

  Promise.all([ctx.load('lab-rows'), ctx.load('model')]).then(([R, M]) => {
    if (!live) return;
    trio(R);
    ladder(M);
    const d = R.train,
      acc = {};
    d.rows.forEach((r) => {
      const dd = r[d.cols.indexOf('doy')],
        k = Math.min(51, Math.floor((dd - 1) / 7));
      (acc[k] = acc[k] || [0, 0])[0] += r[d.cols.indexOf('y')];
      acc[k][1]++;
    });
    weeks = Object.entries(acc).map(([k, [u, n]]) => ({ doy: +k * 7 + 3.5, share: u / n }));
    ready = true;
    const main = $('main');
    main.classList.remove('skel');
    main.setAttribute('aria-busy', 'false');
    drawYear();
  });
  return () => {
    live = false;
    off.forEach((f) => f());
    dispose();
  };
}
